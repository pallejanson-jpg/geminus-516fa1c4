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

    // ── Helper: recursively collect nodes by classId from perspective tree ──
    function collectByClassId(node: any, classId: number, results: any[], parentFloorName?: string) {
      const nodeClassId = node.classId || node.ClassId;
      const nodeName = node.objectName || node.ObjectName || node.name || "";
      
      // Track floor name for drawings under floors
      let currentFloorName = parentFloorName;
      if (nodeClassId === 105) {
        currentFloorName = nodeName;
      }
      
      if (nodeClassId === classId) {
        results.push({ ...node, _parentFloorName: currentFloorName });
      }
      
      const children = node.children || node.Children || [];
      for (const child of children) {
        collectByClassId(child, classId, results, currentFloorName);
      }
    }

    switch (action) {
      case "sync-drawings": {
        await updateSyncState("fm_access_drawings", "running");
        const buildings = await getBuildingsToSync();
        let totalSynced = 0;

        for (const b of buildings) {
          try {
            // Use perspective tree (perspectiveId=8) to find drawings (classId 106)
            const treeResult = await callFmAccess("get-perspective-tree", {
              guid: b.fm_access_building_guid,
              perspectiveId: "8",
            });
            
            if (!treeResult?.success) {
              console.log(`Perspective tree failed for ${b.fm_guid}:`, treeResult?.error);
              continue;
            }

            // Extract drawings (classId 106) from tree
            const drawings: any[] = [];
            const treeData = treeResult.data;
            if (Array.isArray(treeData)) {
              treeData.forEach((n: any) => collectByClassId(n, 106, drawings));
            } else if (treeData) {
              collectByClassId(treeData, 106, drawings);
            }

            console.log(`FM Access sync: Found ${drawings.length} drawings for building ${b.fm_guid}`);

            for (const d of drawings) {
              const drawingId = String(d.objectId || d.ObjectId || d.id || "");
              if (!drawingId) continue;

              await supabase.from("fm_access_drawings").upsert(
                {
                  building_fm_guid: b.fm_guid,
                  drawing_id: drawingId,
                  object_id: drawingId,
                  name: d.objectName || d.ObjectName || d.name || "",
                  class_name: "Ritning",
                  floor_name: d._parentFloorName || "",
                  tab_name: d._parentFloorName || "Ritningar",
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
            // Use perspective tree to find all objects, then check for documents
            // Documents in HDC are typically classId 108 or attached to objects
            const treeResult = await callFmAccess("get-perspective-tree", {
              guid: b.fm_access_building_guid,
              perspectiveId: "8",
            });
            
            if (!treeResult?.success) {
              console.log(`Perspective tree failed for ${b.fm_guid}:`, treeResult?.error);
              continue;
            }

            // Collect all nodes to check for document-like objects
            // Documents in HDC can be various classIds, collect everything non-structural
            const allNodes: any[] = [];
            const treeData = treeResult.data;
            
            function collectAllNodes(node: any) {
              const classId = node.classId || node.ClassId;
              // Collect nodes that aren't structural (buildings=103/104, floors=105, drawings=106, rooms=107)
              if (classId && ![103, 104, 105, 106, 107].includes(classId)) {
                allNodes.push(node);
              }
              const children = node.children || node.Children || [];
              for (const child of children) collectAllNodes(child);
            }
            
            if (Array.isArray(treeData)) {
              treeData.forEach((n: any) => collectAllNodes(n));
            } else if (treeData) {
              collectAllNodes(treeData);
            }

            console.log(`FM Access sync: Found ${allNodes.length} document-candidate nodes for building ${b.fm_guid}`);

            for (const doc of allNodes) {
              const documentId = String(doc.objectId || doc.ObjectId || doc.id || "");
              if (!documentId) continue;

              await supabase.from("fm_access_documents").upsert(
                {
                  building_fm_guid: b.fm_guid,
                  document_id: documentId,
                  object_id: documentId,
                  name: doc.objectName || doc.ObjectName || doc.name || "",
                  file_name: doc.objectName || doc.ObjectName || "",
                  class_name: doc.className || `classId:${doc.classId || doc.ClassId || ""}`,
                  synced_at: new Date().toISOString(),
                },
                { onConflict: "building_fm_guid,document_id" }
              );
              totalSynced++;
            }

            // Index ALL collected document nodes into document_chunks for semantic search
            for (const node of allNodes) {
              const nodeId = String(node.objectId || node.ObjectId || node.id || "");
              if (!nodeId) continue;
              const content = [
                node.objectName || node.ObjectName || node.name || "",
                node.className || "",
                `Typ: ${node.classId || node.ClassId || ""}`,
              ].filter(Boolean).join(" | ");

              if (content.trim().length > 3) {
                await supabase.from("document_chunks").upsert(
                  {
                    source_type: "fm_access",
                    source_id: `doc-${nodeId}`,
                    building_fm_guid: b.fm_guid,
                    file_name: node.objectName || node.ObjectName || "FM Access dokument",
                    content,
                    chunk_index: 0,
                    metadata: { system: "fm_access", type: "document", classId: node.classId || node.ClassId },
                  },
                  { onConflict: "source_type,source_id,chunk_index", ignoreDuplicates: false }
                );
              }
            }

            // Index drawings (classId 106) as document_chunks
            const drawings: any[] = [];
            if (Array.isArray(treeData)) {
              treeData.forEach((n: any) => collectByClassId(n, 106, drawings));
            } else if (treeData) {
              collectByClassId(treeData, 106, drawings);
            }

            for (const d of drawings) {
              const content = [
                d.objectName || d.ObjectName || "",
                d._parentFloorName || "",
                "Ritning",
              ].filter(Boolean).join(" | ");

              if (content.trim()) {
                const sourceId = String(d.objectId || d.ObjectId || "");
                await supabase.from("document_chunks").upsert(
                  {
                    source_type: "fm_access",
                    source_id: `drawing-${sourceId}`,
                    building_fm_guid: b.fm_guid,
                    file_name: d.objectName || d.ObjectName || "FM Access ritning",
                    content,
                    chunk_index: 0,
                    metadata: { system: "fm_access", type: "drawing", floor: d._parentFloorName },
                  },
                  { onConflict: "source_type,source_id,chunk_index", ignoreDuplicates: false }
                );
              }
            }

            // Index rooms (classId 107)
            const rooms: any[] = [];
            if (Array.isArray(treeData)) {
              treeData.forEach((n: any) => collectByClassId(n, 107, rooms));
            } else if (treeData) {
              collectByClassId(treeData, 107, rooms);
            }

            for (const room of rooms) {
              const roomId = String(room.objectId || room.ObjectId || "");
              if (!roomId) continue;
              const content = [
                room.objectName || room.ObjectName || "",
                room._parentFloorName || "",
                "Rum",
              ].filter(Boolean).join(" | ");

              if (content.trim()) {
                await supabase.from("document_chunks").upsert(
                  {
                    source_type: "fm_access",
                    source_id: `room-${roomId}`,
                    building_fm_guid: b.fm_guid,
                    file_name: room.objectName || room.ObjectName || "FM Access rum",
                    content,
                    chunk_index: 0,
                    metadata: { system: "fm_access", type: "room", floor: room._parentFloorName },
                  },
                  { onConflict: "source_type,source_id,chunk_index", ignoreDuplicates: false }
                );
              }
            }

            // Index floors (classId 105)
            const floors: any[] = [];
            if (Array.isArray(treeData)) {
              treeData.forEach((n: any) => collectByClassId(n, 105, floors));
            } else if (treeData) {
              collectByClassId(treeData, 105, floors);
            }

            for (const floor of floors) {
              const floorId = String(floor.objectId || floor.ObjectId || "");
              if (!floorId) continue;
              const content = [
                floor.objectName || floor.ObjectName || "",
                "Våningsplan",
              ].filter(Boolean).join(" | ");

              if (content.trim()) {
                await supabase.from("document_chunks").upsert(
                  {
                    source_type: "fm_access",
                    source_id: `floor-${floorId}`,
                    building_fm_guid: b.fm_guid,
                    file_name: floor.objectName || floor.ObjectName || "FM Access våning",
                    content,
                    chunk_index: 0,
                    metadata: { system: "fm_access", type: "floor" },
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
            const hierResult = await callFmAccess("get-perspective-tree", {
              guid: b.fm_access_building_guid,
              perspectiveId: "8",
            });
            if (!hierResult?.success) continue;

            // Collect guids from hierarchy
            function collectGuids(node: any, guids: string[]) {
              const guid = node.systemGuid || node.objectGuid || node.guid;
              if (guid) guids.push(guid);
              const children = node.children || node.Children || [];
              for (const child of children) collectGuids(child, guids);
            }
            const guids: string[] = [];
            const data = hierResult.data;
            if (Array.isArray(data)) data.forEach((n: any) => collectGuids(n, guids));
            else if (data) collectGuids(data, guids);

            console.log(`FM Access sync: Found ${guids.length} GUIDs for DoU lookup (building ${b.fm_guid}), checking first 100`);

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
