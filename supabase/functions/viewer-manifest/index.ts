import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { buildingFmGuid } = await req.json();
    if (!buildingFmGuid) {
      return new Response(JSON.stringify({ error: "buildingFmGuid required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all data in parallel
    const [modelsRes, mappingsRes, storeysRes] = await Promise.all([
      // XKT models
      supabase
        .from("xkt_models")
        .select("model_id, model_name, file_name, storage_path, storey_fm_guid, is_chunk, chunk_order, parent_model_id, format")
        .eq("building_fm_guid", buildingFmGuid)
        .order("chunk_order"),
      // Geometry entity mappings
      supabase
        .from("geometry_entity_map")
        .select("asset_fm_guid, external_entity_id, entity_type, model_id, storey_fm_guid, source_model_name, source_storey_name, source_system")
        .eq("building_fm_guid", buildingFmGuid),
      // Floor assets
      supabase
        .from("assets")
        .select("fm_guid, common_name, name, category, attributes")
        .eq("building_fm_guid", buildingFmGuid)
        .eq("category", "Level"),
    ]);

    if (modelsRes.error) throw modelsRes.error;
    if (mappingsRes.error) throw mappingsRes.error;
    if (storeysRes.error) throw storeysRes.error;

    const models = modelsRes.data || [];
    const mappings = mappingsRes.data || [];
    const storeys = storeysRes.data || [];

    // ── Build floors list ──
    const floorMap = new Map<string, string>();
    // Priority 1: geometry_entity_map source_storey_name
    mappings
      .filter((m: any) => m.entity_type === 'storey' && m.source_storey_name)
      .forEach((m: any) => floorMap.set(m.asset_fm_guid, m.source_storey_name));
    // Priority 2: asset common_name
    storeys.forEach((s: any) => {
      if (!floorMap.has(s.fm_guid)) {
        floorMap.set(s.fm_guid, s.common_name || s.name || s.fm_guid);
      }
    });

    const floors = Array.from(floorMap.entries()).map(([fmGuid, name]) => ({
      fmGuid,
      name,
    }));

    // ── Build model list with floor relations ──
    // Group models by parent_model_id (chunks under parent)
    const parentModels = models.filter((m: any) => !m.is_chunk);
    const chunksByParent = new Map<string, any[]>();
    models.filter((m: any) => m.is_chunk).forEach((m: any) => {
      const key = m.parent_model_id || m.model_id;
      if (!chunksByParent.has(key)) chunksByParent.set(key, []);
      chunksByParent.get(key)!.push(m);
    });

    // Derive model-to-floor relations from mappings
    const modelFloorRelations = new Map<string, Set<string>>();
    mappings
      .filter((m: any) => m.model_id && m.storey_fm_guid)
      .forEach((m: any) => {
        if (!modelFloorRelations.has(m.model_id)) modelFloorRelations.set(m.model_id, new Set());
        modelFloorRelations.get(m.model_id)!.add(m.storey_fm_guid);
      });

    // Derive display name for each model from mappings
    const modelDisplayNames = new Map<string, string>();
    mappings
      .filter((m: any) => m.model_id && m.source_model_name)
      .forEach((m: any) => {
        if (!modelDisplayNames.has(m.model_id)) {
          modelDisplayNames.set(m.model_id, m.source_model_name);
        }
      });

    const modelList = (parentModels.length > 0 ? parentModels : models.filter((m: any) => !m.parent_model_id)).map((m: any) => ({
      modelId: m.model_id,
      displayName: modelDisplayNames.get(m.model_id) || m.model_name || m.file_name,
      fileName: m.file_name,
      storagePath: m.storage_path,
      format: m.format,
      storeyFmGuid: m.storey_fm_guid,
      floorFmGuids: Array.from(modelFloorRelations.get(m.model_id) || []),
      chunks: (chunksByParent.get(m.model_id) || []).map((c: any) => ({
        modelId: c.model_id,
        fileName: c.file_name,
        storagePath: c.storage_path,
        chunkOrder: c.chunk_order,
      })),
    }));

    // ── Entity-to-asset mappings (for viewer selection) ──
    const entityMap: Record<string, string> = {};
    mappings
      .filter((m: any) => m.external_entity_id)
      .forEach((m: any) => {
        entityMap[m.external_entity_id] = m.asset_fm_guid;
      });

    const manifest = {
      buildingFmGuid,
      generatedAt: new Date().toISOString(),
      floors,
      models: modelList,
      entityToAssetMap: entityMap,
      totalMappings: mappings.length,
    };

    return new Response(JSON.stringify(manifest), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("viewer-manifest error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
