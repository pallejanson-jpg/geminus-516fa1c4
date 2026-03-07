import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const CHUNK_SIZE = 2000;

function chunkText(text: string, chunkSize = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    // Try to break at paragraph or sentence boundary
    if (end < text.length) {
      const lastPara = text.lastIndexOf("\n\n", end);
      if (lastPara > start + chunkSize * 0.5) end = lastPara;
      else {
        const lastSentence = text.lastIndexOf(". ", end);
        if (lastSentence > start + chunkSize * 0.5) end = lastSentence + 1;
      }
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(c => c.length > 10);
}

/** Extract text from PDF using AI (multimodal) */
async function extractPdfTextViaAI(pdfBytes: Uint8Array, apiKey: string): Promise<string> {
  // Convert to base64
  const base64 = btoa(String.fromCharCode(...pdfBytes));

  const resp = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract ALL text content from this PDF document. Return only the raw text, preserving structure with line breaks. Do not add commentary or formatting.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 8000,
      temperature: 0,
    }),
  });

  if (!resp.ok) {
    console.error("AI PDF extraction failed:", resp.status);
    // Fallback to basic regex extraction
    return extractPdfTextBasic(pdfBytes);
  }

  const result = await resp.json();
  return result.choices?.[0]?.message?.content || "";
}

/** Basic PDF text extraction fallback */
function extractPdfTextBasic(bytes: Uint8Array): string {
  const decoder = new TextDecoder("latin1");
  const raw = decoder.decode(bytes);
  const texts: string[] = [];
  const patterns = [/\(([^)]*)\)\s*Tj/g, /\[([^\]]*)\]\s*TJ/g];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      let extracted = match[1];
      if (pattern.source.includes("TJ")) {
        const parts: string[] = [];
        const pp = /\(([^)]*)\)/g;
        let pm;
        while ((pm = pp.exec(extracted)) !== null) parts.push(pm[1]);
        extracted = parts.join("");
      }
      extracted = extracted.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
      if (extracted.trim()) texts.push(extracted);
    }
  }
  return texts.join(" ").replace(/\s+/g, " ").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, building_fm_guid, source_id, url: singleUrl, app_name } = await req.json();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const firecrawlKey = Deno.env.get("FIRECRAWL_API_KEY");

    const supabase = createClient(supabaseUrl, serviceKey);

    if (action === "index-building-docs") {
      if (!building_fm_guid) {
        return new Response(JSON.stringify({ error: "building_fm_guid required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get documents for the building
      const { data: docs, error: docErr } = await supabase
        .from("documents")
        .select("id, file_name, file_path, mime_type")
        .eq("building_fm_guid", building_fm_guid)
        .or("mime_type.ilike.%pdf%,mime_type.ilike.%text%,mime_type.is.null")
        .limit(50);

      if (docErr) throw docErr;
      if (!docs?.length) {
        return new Response(JSON.stringify({ success: true, indexed: 0, message: "No documents found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let totalChunks = 0;
      let indexed = 0;

      for (const doc of docs) {
        try {
          const { data: fileData, error: dlErr } = await supabase.storage
            .from("documents")
            .download(doc.file_path);

          if (dlErr || !fileData) continue;

          let text = "";
          const mime = (doc.mime_type || "").toLowerCase();

          if (mime.includes("text") || doc.file_name?.endsWith(".txt")) {
            text = await fileData.text();
          } else if (mime.includes("pdf") || doc.file_name?.endsWith(".pdf")) {
            const bytes = new Uint8Array(await fileData.arrayBuffer());
            // Only use AI for smaller PDFs (< 5MB), fallback for larger
            if (bytes.length < 5 * 1024 * 1024) {
              text = await extractPdfTextViaAI(bytes, apiKey);
            } else {
              text = extractPdfTextBasic(bytes);
            }
          }

          if (!text.trim()) continue;

          // Delete old chunks for this document
          await supabase
            .from("document_chunks")
            .delete()
            .eq("source_type", "document")
            .eq("source_id", doc.id);

          // Chunk and insert
          const chunks = chunkText(text);
          const inserts = chunks.map((content, i) => ({
            source_type: "document",
            source_id: doc.id,
            building_fm_guid,
            file_name: doc.file_name,
            chunk_index: i,
            content,
            metadata: { mime_type: doc.mime_type, total_chunks: chunks.length },
          }));

          if (inserts.length > 0) {
            const { error: insertErr } = await supabase.from("document_chunks").insert(inserts);
            if (insertErr) console.error(`Insert error for ${doc.file_name}:`, insertErr);
            else {
              totalChunks += inserts.length;
              indexed++;
            }
          }
        } catch (e) {
          console.error(`Error indexing ${doc.file_name}:`, e);
        }
      }

      return new Response(JSON.stringify({ success: true, indexed, totalChunks, totalDocs: docs.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "index-help-docs") {
      if (!firecrawlKey) {
        return new Response(JSON.stringify({ error: "Firecrawl not configured. Connect Firecrawl in Settings." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get all help doc sources
      const { data: sources, error: srcErr } = await supabase
        .from("help_doc_sources")
        .select("*")
        .limit(100);

      if (srcErr) throw srcErr;
      if (!sources?.length) {
        return new Response(JSON.stringify({ success: true, indexed: 0, message: "No help doc sources configured" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let totalIndexed = 0;

      for (const source of sources) {
        try {
          // Scrape URL using Firecrawl
          const scrapeResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${firecrawlKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url: source.url,
              formats: ["markdown"],
              onlyMainContent: true,
            }),
          });

          if (!scrapeResp.ok) {
            console.error(`Firecrawl error for ${source.url}:`, scrapeResp.status);
            continue;
          }

          const scrapeData = await scrapeResp.json();
          const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";

          if (!markdown.trim()) continue;

          // Delete old chunks for this source
          await supabase
            .from("document_chunks")
            .delete()
            .eq("source_type", "help_doc")
            .eq("source_id", source.id);

          // Chunk and insert
          const chunks = chunkText(markdown);
          const inserts = chunks.map((content, i) => ({
            source_type: "help_doc",
            source_id: source.id,
            file_name: source.app_name,
            chunk_index: i,
            content,
            metadata: { url: source.url, app_name: source.app_name },
          }));

          if (inserts.length > 0) {
            const { error: insertErr } = await supabase.from("document_chunks").insert(inserts);
            if (!insertErr) {
              totalIndexed++;
              // Update source with chunk count and timestamp
              await supabase
                .from("help_doc_sources")
                .update({ last_indexed_at: new Date().toISOString(), chunk_count: chunks.length })
                .eq("id", source.id);
            }
          }
        } catch (e) {
          console.error(`Error indexing help doc ${source.url}:`, e);
        }
      }

      return new Response(JSON.stringify({ success: true, indexed: totalIndexed, totalSources: sources.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "index-single-url") {
      if (!firecrawlKey) {
        return new Response(JSON.stringify({ error: "Firecrawl not configured" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!singleUrl || !source_id) {
        return new Response(JSON.stringify({ error: "url and source_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const scrapeResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: singleUrl,
          formats: ["markdown"],
          onlyMainContent: true,
        }),
      });

      if (!scrapeResp.ok) {
        const errText = await scrapeResp.text();
        return new Response(JSON.stringify({ error: `Firecrawl error: ${scrapeResp.status}`, details: errText }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const scrapeData = await scrapeResp.json();
      const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";

      if (!markdown.trim()) {
        return new Response(JSON.stringify({ success: false, error: "No content extracted from URL" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Delete old chunks
      await supabase.from("document_chunks").delete().eq("source_type", "help_doc").eq("source_id", source_id);

      const chunks = chunkText(markdown);
      const inserts = chunks.map((content, i) => ({
        source_type: "help_doc",
        source_id,
        file_name: app_name || "Help Doc",
        chunk_index: i,
        content,
        metadata: { url: singleUrl, app_name: app_name || "" },
      }));

      const { error: insertErr } = await supabase.from("document_chunks").insert(inserts);
      if (insertErr) throw insertErr;

      // Update source
      await supabase
        .from("help_doc_sources")
        .update({ last_indexed_at: new Date().toISOString(), chunk_count: chunks.length })
        .eq("id", source_id);

      return new Response(JSON.stringify({ success: true, chunks: chunks.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use: index-building-docs, index-help-docs, index-single-url" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("index-documents error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
