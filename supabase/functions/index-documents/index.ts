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

    if (action === "index-api-docs") {
      // Index built-in API documentation as help docs
      const apiDocs: { name: string; content: string }[] = [
        {
          name: "Asset+ API",
          content: `Asset+ API Integration - BIM-based asset management system.

Authentication: OAuth2 via Keycloak (password grant) + API Key in payload.
Token endpoint: POST {KEYCLOAK_URL}/protocol/openid-connect/token with grant_type=password, username, password, client_id, client_secret.

Object Types: 0=Complex, 1=Building, 2=Level, 3=Space, 4=Instance.
Data Types: 0=String, 1=Int32, 2=Int64, 3=Decimal, 4=DateTime, 5=Bool.

Key Endpoints:
- POST /PublishDataServiceGetMerged - Main query endpoint for objects with properties. Params: outputType, apiKey, filter.
- GET /GetObjectsByPage - Paginated object retrieval. Params: skip, take, objectType.
- POST /GetObjectByFmGuid - Get object by FMGUID.
- POST /AddObject - Create new object. Requires: objectType, designation, commonName, parent.
- POST /AddObjectList - Create multiple objects.
- POST /UpdateBimObjectsPropertiesData - Update properties. Params: FmGuid, UpdateProperties[].
- POST /UpsertRelationships - Move object to new parent. Only for createdInModel=false.
- POST /ExpireObject - Soft-delete with expiration date.
- POST /PublishRevision - Publish revision.

Constraints: BIM objects (createdInModel=true) cannot be moved via API. Objects must stay within same Building. Buildings/Levels/Spaces require designation and commonName.

Edge Functions: asset-plus-query, asset-plus-create, asset-plus-update, asset-plus-sync.
Sync uses resumable approach with pagination for 80k+ assets.`,
        },
        {
          name: "FM Access API",
          content: `FM Access (Tessel HDC) API Integration - 2D floor plans, drawings, and document management.

Authentication: OAuth2 via Keycloak + custom X-Authorization header (NOT standard Authorization) + X-Hdc-Version-Id header.
Step 1: POST token endpoint with grant_type=password, client_id, username, password.
Step 2: GET /api/systeminfo/json to get defaultVersion.versionId.
Step 3: All calls need X-Authorization: Bearer {token} and X-Hdc-Version-Id: {versionId}.

Secrets: FM_ACCESS_TOKEN_URL, FM_ACCESS_CLIENT_ID, FM_ACCESS_API_URL, FM_ACCESS_USERNAME, FM_ACCESS_PASSWORD.

Available Actions:
- test-connection - Test auth and get version ID.
- get-floors - List floors (param: buildingFmGuid).
- get-drawings - List drawings (param: buildingId).
- get-documents - List documents (param: buildingId).
- get-drawing-pdf - PDF download URL (param: drawingId).
- get-viewer-url - Authenticated 2D viewer URL (params: buildingId, floorId).
- get-object-by-guid - Object details (param: guid).
- get-hierarchy - Full subtree (param: buildingFmGuid).
- search-objects - Quick search (param: query).
- create-object, update-object, delete-object - CRUD operations.
- proxy - Generic proxy to any HDC endpoint.

HDC Class IDs: 102=Fastighet, 103=Byggnad, 105=Plan, 106=Ritning, 107=Rum.
FMGUID is the primary key for cross-system mapping.`,
        },
        {
          name: "Faciliate (SWG) API",
          content: `Faciliate (SWG) REST v2 API - Facility management system for work orders, contracts, and buildings.

Authentication: JWT Bearer Token. Endpoint: POST {SWG_SUPPORT_URL}/api/auth/login with username and password.
Secrets: SWG_SUPPORT_URL, SWG_SUPPORT_USERNAME, SWG_SUPPORT_PASSWORD, SWG_SUPPORT_JWT.

Load Levels: guid (just GUID), basic (GUID+name), simple (basic fields), fullprimary (all primary fields), loadmax (all fields with relations).

Key Endpoints:
- GET /api/v2/workorder - List work orders. Params: filter, take, skip, loadlevel.
- GET /api/v2/workorder/{guid} - Get work order by GUID.
- POST /api/v2/workorder - Create work order.
- PUT /api/v2/workorder/{guid} - Update work order.
- GET /api/v2/building - List buildings.
- GET /api/v2/space - List spaces.
- GET /api/v2/equipment - List equipment.
- GET /api/v2/contract - List contracts.
- GET /api/v2/customer - List tenants/customers.

Filter syntax: 'Status eq "Active"', 'Description like "%brand%"'.
Integration strategy: Hybrid — live proxy for active work orders (<30 days), sync pipeline for buildings/leases/historical data.`,
        },
        {
          name: "Senslinc API",
          content: `Senslinc IoT Platform - Sensors, measurement data, alarms, and monitoring.

Authentication: Basic Auth with email and password.
Secrets: SENSLINC_API_URL, SENSLINC_EMAIL, SENSLINC_PASSWORD.

Key Endpoints:
- GET /api/sites - List all monitored sites/buildings.
- GET /api/sites/{code}/equipment - Equipment for a specific site.
- GET /api/equipment/{fmGuid} - Sensors linked to a specific FM GUID (room, asset, building).
- GET /api/indices - List available Elasticsearch indices/workspaces.
- POST /api/search/{workspace_key} - Query time-series sensor data.

Search Parameters: time_range (e.g. 'now-24h', 'now-7d'), property_name (temperature, co2, humidity, energy), machine_code (FM GUID), size (max results).

Measurement types: temperature (°C), co2 (ppm), humidity (%), energy (kWh).
Data is stored in Elasticsearch and queried via workspace keys discovered through the indices endpoint.`,
        },
        {
          name: "Ivion API",
          content: `Ivion API - 360° panorama imagery and POI management for indoor navigation.

Authentication: JWT-based. POST /auth/login with username and password returns accessToken + refreshToken. Access tokens expire after ~15 minutes, refresh via POST /auth/refresh.
Secrets: IVION_API_URL, IVION_USERNAME, IVION_PASSWORD, IVION_ACCESS_TOKEN, IVION_REFRESH_TOKEN.

Data Model: Site → Dataset (floor scan) → Image (360° panorama). Sites also have POIs linked to images.

Key Endpoints:
- GET /sites - List all sites.
- GET /sites/{siteId} - Get site details.
- GET /sites/{siteId}/datasets - List datasets (per-floor scans).
- GET /datasets/{datasetId}/images - List 360° images in dataset.
- GET /images/{imageId} - Get specific image.
- GET /sites/{siteId}/pois - List POIs for site.
- POST /pois - Create POI. Params: name, siteId, imageId, position {x,y,z}, metadata.
- PUT /pois/{poiId} - Update POI.
- DELETE /pois/{poiId} - Delete POI.

Geminus Integration: Buildings map to Ivion sites via building_settings.ivion_site_id. Assets with 3D coordinates sync as POIs. Edge function: ivion-poi.`,
        },
      ];

      // Delete existing api_docs chunks
      await supabase.from("document_chunks").delete().eq("source_type", "api_docs");

      let totalChunks = 0;
      for (const doc of apiDocs) {
        const chunks = chunkText(doc.content);
        const inserts = chunks.map((content, i) => ({
          source_type: "api_docs",
          source_id: doc.name,
          file_name: doc.name,
          chunk_index: i,
          content,
          metadata: { app_name: doc.name, type: "api_documentation" },
        }));

        if (inserts.length > 0) {
          const { error: insertErr } = await supabase.from("document_chunks").insert(inserts);
          if (!insertErr) totalChunks += inserts.length;
          else console.error(`Insert error for ${doc.name}:`, insertErr);
        }
      }

      return new Response(JSON.stringify({ success: true, indexed: apiDocs.length, totalChunks }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use: index-building-docs, index-help-docs, index-single-url, index-api-docs" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("index-documents error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
