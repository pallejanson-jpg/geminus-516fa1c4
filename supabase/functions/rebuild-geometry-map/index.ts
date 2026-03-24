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

    // 1. Fetch all assets for this building
    const allAssets: any[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("assets")
        .select("fm_guid, category, common_name, name, building_fm_guid, level_fm_guid, in_room_fm_guid, attributes, asset_type")
        .eq("building_fm_guid", buildingFmGuid)
        .order("fm_guid")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allAssets.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // 2. Fetch all xkt_models for this building
    const { data: xktModels, error: xktErr } = await supabase
      .from("xkt_models")
      .select("model_id, model_name, building_fm_guid, storey_fm_guid, file_name")
      .eq("building_fm_guid", buildingFmGuid);
    if (xktErr) throw xktErr;

    // 3. Fetch existing asset_external_ids for this building's assets
    const assetGuids = allAssets.map(a => a.fm_guid);
    const externalIds: any[] = [];
    // Batch fetch in chunks of 500
    for (let i = 0; i < assetGuids.length; i += 500) {
      const chunk = assetGuids.slice(i, i + 500);
      const { data } = await supabase
        .from("asset_external_ids")
        .select("fm_guid, external_id, source")
        .in("fm_guid", chunk);
      if (data) externalIds.push(...data);
    }

    // Build external_id lookup
    const extIdMap = new Map<string, { external_id: string; source: string }>();
    externalIds.forEach(e => {
      if (!extIdMap.has(e.fm_guid)) {
        extIdMap.set(e.fm_guid, { external_id: e.external_id, source: e.source });
      }
    });

    // Build model lookup from xkt_models
    const modelsByStorey = new Map<string, { model_id: string; model_name: string }>();
    (xktModels || []).forEach((m: any) => {
      if (m.storey_fm_guid) {
        modelsByStorey.set(m.storey_fm_guid, { model_id: m.model_id, model_name: m.model_name });
      }
    });

    // Categorize assets
    const categoryToEntityType: Record<string, string> = {
      Building: 'building',
      Level: 'storey',
      Space: 'space',
      Instance: 'instance',
    };

    // Build storey name lookup from Level assets
    const storeyNames = new Map<string, string>();
    allAssets.filter(a => a.category === 'Level').forEach(a => {
      storeyNames.set(a.fm_guid, a.common_name || a.name || a.fm_guid);
    });

    // Find model name from attributes
    const getModelName = (asset: any): string | null => {
      const attrs = asset.attributes || {};
      return attrs.parentCommonName || attrs.parentBimObjectId || null;
    };

    // 4. Build mapping rows
    const rows: any[] = [];
    for (const asset of allAssets) {
      const entityType = categoryToEntityType[asset.category] || 'instance';
      const ext = extIdMap.get(asset.fm_guid);
      const modelInfo = asset.level_fm_guid ? modelsByStorey.get(asset.level_fm_guid) : null;
      const storeyGuid = entityType === 'storey' ? asset.fm_guid : asset.level_fm_guid;
      const storeyName = storeyGuid ? storeyNames.get(storeyGuid) : null;
      const modelName = getModelName(asset);

      rows.push({
        building_fm_guid: buildingFmGuid,
        asset_fm_guid: asset.fm_guid,
        source_system: ext?.source || 'asset_plus',
        entity_type: entityType,
        external_entity_id: ext?.external_id || null,
        model_id: modelInfo?.model_id || null,
        storey_fm_guid: storeyGuid || null,
        source_model_guid: null,
        source_model_name: modelName || modelInfo?.model_name || null,
        source_storey_name: storeyName || null,
        last_seen_at: new Date().toISOString(),
        metadata: {},
      });
    }

    // 5. Delete existing mappings for this building, then insert fresh
    await supabase
      .from("geometry_entity_map")
      .delete()
      .eq("building_fm_guid", buildingFmGuid);

    // Insert in batches
    let inserted = 0;
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error: insertErr } = await supabase
        .from("geometry_entity_map")
        .insert(batch);
      if (insertErr) {
        console.error("Insert batch error:", insertErr);
      } else {
        inserted += batch.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      building: buildingFmGuid,
      totalAssets: allAssets.length,
      totalModels: (xktModels || []).length,
      mappingsCreated: inserted,
      externalIdsFound: externalIds.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("rebuild-geometry-map error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
