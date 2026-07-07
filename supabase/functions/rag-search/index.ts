import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { verifyAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  try {
    const { query, buildingFmGuid, sourceType, topK = 10 } = await req.json();
    if (!query) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Step 1: Extract search keywords via AI
    const kwMsg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: "Extract 3-6 search keywords from the user query. Return ONLY a JSON array of strings, e.g. [\"keyword1\", \"keyword2\"]. Include relevant language variants where applicable.",
      messages: [{ role: "user", content: query }],
    });

    let keywords: string[] = [query];
    const kwContent = kwMsg.content[0]?.type === "text" ? kwMsg.content[0].text : "";
    try {
      const parsed = JSON.parse(kwContent.match(/\[[\s\S]*\]/)?.[0] || "[]");
      if (Array.isArray(parsed) && parsed.length > 0) keywords = parsed;
    } catch { /* use original query */ }

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

    const orConditions = keywords.map(kw => `content.ilike.%${kw}%`).join(",");
    dbQuery = dbQuery.or(orConditions);

    const { data: chunks, error: dbErr } = await dbQuery.limit(50);
    if (dbErr) throw dbErr;

    if (!chunks?.length) {
      return new Response(JSON.stringify({
        success: true,
        data: { results: [], answer: "No relevant documents found.", query, keywords },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 3: AI reranking and answer generation
    const chunkSummaries = chunks.slice(0, 20).map((c, i) => ({
      index: i,
      file: c.file_name,
      sourceType: c.source_type,
      excerpt: c.content.slice(0, 500),
    }));

    const rrMsg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system: `You are a RAG assistant for facility management. Based on the user's query and the retrieved document chunks:
1. Rank the chunks by relevance (return the indices)
2. Provide a concise answer based on the most relevant content
3. Cite the source (file name)

Respond with JSON:
{
  "rankedIndices": [0, 3, 1],
  "answer": "The answer...",
  "sources": ["filename1.pdf", "filename2.pdf"],
  "confidence": 0.0-1.0
}`,
      messages: [
        {
          role: "user",
          content: `Query: ${query}\n\nDocument chunks:\n${JSON.stringify(chunkSummaries, null, 2)}`,
        },
      ],
    });

    let ragResult = { rankedIndices: [] as number[], answer: "", sources: [] as string[], confidence: 0 };
    const rrContent = rrMsg.content[0]?.type === "text" ? rrMsg.content[0].text : "";
    try {
      const parsed = JSON.parse(rrContent.match(/\{[\s\S]*\}/)?.[0] || "{}");
      ragResult = { ...ragResult, ...parsed };
    } catch {
      ragResult.answer = rrContent.slice(0, 1000);
    }

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
