import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, building_fm_guid } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Helper: call fm-access-query edge function internally
    async function callFmAccess(fmAction: string, params: Record<string, unknown> = {}) {
      const resp = await fetch(`${supabaseUrl}/functions/v1/fm-access-query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ action: fmAction, ...params }),
      });
      return resp.json();
    }

    // Get all buildings with fm_access_building_guid
    async function getBuildingsToSync(): Promise<{ fm_guid: string; fm_access_building_guid: string }[]> {
      if (building_fm_guid) {
        const { data } = await supabase
          .from("building_settings")
          .select("fm_guid, fm_access_building_guid")
          .eq("fm_guid", building_fm_guid)
          .not("fm_access_building_guid", "is", null)
          .single();
        return data ? [data] : [];
      }
      const { data } = await supabase
        .from("building_settings")
        .select("fm_guid, fm_access_building_guid")
        .not("fm_access_building_guid", "is", null);
      return data || [];
    }

    // Update sync state
    async function updateSyncState(syncType: string, status: string, totalItems?: number, error?: string) {
      await supabase.from("faciliate_sync_state").upsert(
        {
          sync_type: syncType,
          sync_status: status,
          total_items: totalItems ?? 0,
          ...(status === "running" ? { last_sync_started_at: new Date().toISOString() } : {}),
          ...(status === "completed" || status === "failed" ? { last_sync_completed_at: new Date().toISOString() } : {}),
          ...(error ? { error_message: error } : { error_message: null }),
        },
        { onConflict: "sync_type" }
      );
    }

    switch (action) {
      case "sync-drawings": {
        await updateSyncState("fm_access_drawings", "running");
        const buildings = await getBuildingsToSync();
        let totalSynced = 0;

        for (const b of buildings) {
          try {
            const result = await callFmAccess("get-drawings", { buildingId: b.fm_access_building_guid });
            if (!result?.success) {
              console.log(`Drawings failed for ${b.fm_guid}:`, result?.error);
              continue;
            }

            const drawings = result.data || [];
            for (const d of drawings) {
              const drawingId = String(d.objectId || d.drawingId || d.id || "");
              if (!drawingId) continue;

              await supabase.from("fm_access_drawings").upsert(
                {
                  building_fm_guid: b.fm_guid,
                  drawing_id: drawingId,
                  object_id: String(d.objectId || ""),
                  name: d.objectName || d.name || "",
                  class_name: d.className || "",
                  floor_name: d.floorName || "",
                  tab_name: d.tabName || d.className || "",
                  synced_at: new Date().toISOString(),
                },
                { onConflict: "building_fm_guid,drawing_id" }
              );
              totalSynced++;
            }
          } catch (err) {
            console.error(`Error syncing drawings for ${b.fm_guid}:`, err);
          }
        }

        await updateSyncState("fm_access_drawings", "completed", totalSynced);
        return new Response(
          JSON.stringify({ success: true, synced: totalSynced, buildings: buildings.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "sync-documents": {
        await updateSyncState("fm_access_documents", "running");
        const buildings = await getBuildingsToSync();
        let totalSynced = 0;

        for (const b of buildings) {
          try {
            const result = await callFmAccess("get-documents", { buildingId: b.fm_access_building_guid });
            if (!result?.success) {
              console.log(`Documents failed for ${b.fm_guid}:`, result?.error);
              continue;
            }

            const documents = result.data || [];
            for (const doc of documents) {
              const documentId = String(doc.objectId || doc.documentId || doc.id || "");
              if (!documentId) continue;

              await supabase.from("fm_access_documents").upsert(
                {
                  building_fm_guid: b.fm_guid,
                  document_id: documentId,
                  object_id: String(doc.objectId || ""),
                  name: doc.objectName || doc.name || "",
                  file_name: doc.fileName || "",
                  class_name: doc.className || "",
                  synced_at: new Date().toISOString(),
                },
                { onConflict: "building_fm_guid,document_id" }
              );
              totalSynced++;
            }

            // Index document metadata into document_chunks for semantic search
            for (const doc of documents) {
              const content = [
                doc.objectName || doc.name || "",
                doc.fileName || "",
                doc.className || "",
                doc.description || "",
              ].filter(Boolean).join(" | ");

              if (content.trim()) {
                await supabase.from("document_chunks").upsert(
                  {
                    source_type: "fm_access",
                    source_id: String(doc.objectId || doc.documentId || ""),
                    building_fm_guid: b.fm_guid,
                    file_name: doc.objectName || doc.name || doc.fileName || "FM Access dokument",
                    content,
                    chunk_index: 0,
                    metadata: { system: "fm_access", type: "document", className: doc.className },
                  },
                  { onConflict: "source_type,source_id,chunk_index", ignoreDuplicates: false }
                );
              }
            }
          } catch (err) {
            console.error(`Error syncing documents for ${b.fm_guid}:`, err);
          }
        }

        await updateSyncState("fm_access_documents", "completed", totalSynced);
        return new Response(
          JSON.stringify({ success: true, synced: totalSynced, buildings: buildings.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "sync-dou": {
        await updateSyncState("fm_access_dou", "running");
        const buildings = await getBuildingsToSync();
        let totalSynced = 0;

        for (const b of buildings) {
          try {
            // Get hierarchy to find objects, then get DoU for each
            const hierResult = await callFmAccess("get-hierarchy", { buildingFmGuid: b.fm_access_building_guid });
            if (!hierResult?.success) continue;

            // Collect guids from hierarchy
            function collectGuids(node: any, guids: string[]) {
              const guid = node.systemGuid || node.objectGuid || node.guid;
              if (guid) guids.push(guid);
              for (const child of node.children || []) collectGuids(child, guids);
            }
            const guids: string[] = [];
            const data = hierResult.data;
            if (Array.isArray(data)) data.forEach((n: any) => collectGuids(n, guids));
            else collectGuids(data, guids);

            // For each object, try to get DoU via proxy
            for (const guid of guids.slice(0, 100)) {
              try {
                const douResult = await callFmAccess("proxy", {
                  path: `/api/dou/byguid/${encodeURIComponent(guid)}`,
                  method: "GET",
                });
                if (douResult?.success && douResult.data) {
                  const items = Array.isArray(douResult.data) ? douResult.data : [douResult.data];
                  for (const item of items) {
                    if (!item.title && !item.content) continue;
                    await supabase.from("fm_access_dou").insert({
                      object_fm_guid: guid,
                      building_fm_guid: b.fm_guid,
                      title: item.title || item.name || "",
                      content: item.content || item.description || item.text || "",
                      doc_type: item.type || item.docType || "instruction",
                    });
                    totalSynced++;

                    // Index DoU content for semantic search
                    const chunkContent = `${item.title || ""}: ${item.content || item.description || ""}`;
                    if (chunkContent.trim().length > 5) {
                      await supabase.from("document_chunks").upsert(
                        {
                          source_type: "fm_access",
                          source_id: `dou-${guid}-${totalSynced}`,
                          building_fm_guid: b.fm_guid,
                          file_name: item.title || "DoU-instruktion",
                          content: chunkContent,
                          chunk_index: 0,
                          metadata: { system: "fm_access", type: "dou", object_guid: guid },
                        },
                        { onConflict: "source_type,source_id,chunk_index", ignoreDuplicates: false }
                      );
                    }
                  }
                }
              } catch {
                // DoU endpoint may not exist for all objects
              }
            }
          } catch (err) {
            console.error(`Error syncing DoU for ${b.fm_guid}:`, err);
          }
        }

        await updateSyncState("fm_access_dou", "completed", totalSynced);
        return new Response(
          JSON.stringify({ success: true, synced: totalSynced, buildings: buildings.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "sync-all": {
        // Run all syncs sequentially
        const results: Record<string, any> = {};
        for (const syncAction of ["sync-drawings", "sync-documents", "sync-dou"]) {
          try {
            const resp = await fetch(`${supabaseUrl}/functions/v1/fm-access-sync`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({ action: syncAction, building_fm_guid }),
            });
            results[syncAction] = await resp.json();
          } catch (err: any) {
            results[syncAction] = { success: false, error: err.message };
          }
        }

        return new Response(
          JSON.stringify({ success: true, results }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "get-status": {
        const { data } = await supabase
          .from("faciliate_sync_state")
          .select("*")
          .in("sync_type", ["fm_access_drawings", "fm_access_documents", "fm_access_dou"]);

        // Get counts
        const [drawings, documents, dou] = await Promise.all([
          supabase.from("fm_access_drawings").select("id", { count: "exact", head: true }),
          supabase.from("fm_access_documents").select("id", { count: "exact", head: true }),
          supabase.from("fm_access_dou").select("id", { count: "exact", head: true }),
        ]);

        return new Response(
          JSON.stringify({
            success: true,
            syncStates: data || [],
            counts: {
              drawings: drawings.count || 0,
              documents: documents.count || 0,
              dou: dou.count || 0,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (err: any) {
    console.error("fm-access-sync error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
