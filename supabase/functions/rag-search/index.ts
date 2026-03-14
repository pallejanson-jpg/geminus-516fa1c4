import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { query, buildingFmGuid, sourceType, topK = 10 } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Step 1: Extract search keywords via AI
    const keywordResp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: "Extract 3-6 search keywords from the user query. Return ONLY a JSON array of strings, e.g. [\"keyword1\", \"keyword2\"]. Include Swedish and English variants where applicable.",
          },
          { role: "user", content: query },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    });

    let keywords: string[] = [query];
    if (keywordResp.ok) {
      const kwResult = await keywordResp.json();
      const kwContent = kwResult.choices?.[0]?.message?.content || "";
      try {
        const parsed = JSON.parse(kwContent.match(/\[[\s\S]*\]/)?.[0] || "[]");
        if (Array.isArray(parsed) && parsed.length > 0) keywords = parsed;
      } catch { /* use original query */ }
    }

    // Step 2: Full-text search in document_chunks using keywords
    let dbQuery = supabase
      .from("document_chunks")
      .select("id, content, file_name, source_type, source_id, building_fm_guid, chunk_index, metadata");

    if (buildingFmGuid) {
      dbQuery = dbQuery.or(`building_fm_guid.eq.${buildingFmGuid},building_fm_guid.is.null`);
    }
    if (sourceType) {
      dbQuery = dbQuery.eq("source_type", sourceType);
    }

    // Search with OR across keywords using ilike
    const orConditions = keywords.map(kw => `content.ilike.%${kw}%`).join(",");
    dbQuery = dbQuery.or(orConditions);

    const { data: chunks, error: dbErr } = await dbQuery.limit(50);
    if (dbErr) throw dbErr;

    if (!chunks?.length) {
      return new Response(JSON.stringify({
        success: true,
        data: { results: [], answer: "Inga relevanta dokument hittades.", query, keywords },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 3: AI reranking and answer generation
    const chunkSummaries = chunks.slice(0, 20).map((c, i) => ({
      index: i,
      file: c.file_name,
      sourceType: c.source_type,
      excerpt: c.content.slice(0, 500),
    }));

    const rerankResp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Du är en RAG-assistent för fastighetsförvaltning. Baserat på användarens fråga och de hittade dokumentchunkarna:
1. Ranka chunkarna efter relevans (returnera indexen)
2. Ge ett koncist svar baserat på det mest relevanta innehållet
3. Citera källan (filnamn)

Svara med JSON:
{
  "rankedIndices": [0, 3, 1],
  "answer": "Svaret på svenska...",
  "sources": ["filnamn1.pdf", "filnamn2.pdf"],
  "confidence": 0.0-1.0
}`,
          },
          {
            role: "user",
            content: `Fråga: ${query}\n\nDokumentchunkar:\n${JSON.stringify(chunkSummaries, null, 2)}`,
          },
        ],
        max_tokens: 2000,
        temperature: 0.2,
      }),
    });

    let ragResult = { rankedIndices: [] as number[], answer: "", sources: [] as string[], confidence: 0 };

    if (rerankResp.ok) {
      const rrResult = await rerankResp.json();
      const rrContent = rrResult.choices?.[0]?.message?.content || "";
      try {
        const parsed = JSON.parse(rrContent.match(/\{[\s\S]*\}/)?.[0] || "{}");
        ragResult = { ...ragResult, ...parsed };
      } catch {
        ragResult.answer = rrContent.slice(0, 1000);
      }
    }

    // Build ranked results
    const rankedChunks = (ragResult.rankedIndices.length > 0
      ? ragResult.rankedIndices.map(i => chunks[i]).filter(Boolean)
      : chunks
    ).slice(0, topK);

    return new Response(JSON.stringify({
      success: true,
      data: {
        results: rankedChunks.map(c => ({
          id: c.id,
          content: c.content,
          fileName: c.file_name,
          sourceType: c.source_type,
          buildingFmGuid: c.building_fm_guid,
        })),
        answer: ragResult.answer,
        sources: ragResult.sources,
        confidence: ragResult.confidence,
        query,
        keywords,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("rag-search error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
