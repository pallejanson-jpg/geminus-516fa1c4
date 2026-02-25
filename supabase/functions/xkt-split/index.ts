import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * XKT Split Edge Function
 *
 * Splits a monolithic XKT model into per-storey chunks using xeokit metadata.
 * The XKT v10 format stores object metadata (IFC type, parent hierarchy) inline,
 * which allows us to identify which triangles belong to which IfcBuildingStorey.
 *
 * Strategy:
 * 1. Download the monolithic XKT from storage
 * 2. Parse the XKT header to extract entity metadata
 * 3. Group entities by their parent IfcBuildingStorey
 * 4. Create per-storey XKT files with only relevant geometry
 * 5. Upload chunks to storage and update xkt_models table
 *
 * Actions:
 * - split: Split a model into per-storey chunks
 * - status: Check split status for a building
 * - list-chunks: List available chunks for a model
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { action, buildingFmGuid, modelId } = body;

    if (action === "status") {
      // Check if chunks exist for this building
      const { data: chunks, error } = await supabase
        .from("xkt_models")
        .select("model_id, model_name, storey_fm_guid, file_size, is_chunk, chunk_order")
        .eq("building_fm_guid", buildingFmGuid)
        .eq("is_chunk", true)
        .order("chunk_order");

      if (error) throw error;

      const { data: parentModels } = await supabase
        .from("xkt_models")
        .select("model_id, model_name, file_size")
        .eq("building_fm_guid", buildingFmGuid)
        .eq("is_chunk", false);

      return new Response(JSON.stringify({
        success: true,
        hasChunks: (chunks?.length ?? 0) > 0,
        chunkCount: chunks?.length ?? 0,
        chunks: chunks ?? [],
        parentModels: parentModels ?? [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "split") {
      if (!buildingFmGuid || !modelId) {
        throw new Error("buildingFmGuid and modelId are required");
      }

      // 1. Get the parent model metadata
      const { data: parentModel, error: pmError } = await supabase
        .from("xkt_models")
        .select("*")
        .eq("model_id", modelId)
        .eq("building_fm_guid", buildingFmGuid)
        .maybeSingle();

      if (pmError || !parentModel) {
        throw new Error(`Model ${modelId} not found for building ${buildingFmGuid}`);
      }

      // 2. Get storeys for this building
      const { data: storeys } = await supabase
        .from("assets")
        .select("fm_guid, common_name, name")
        .eq("building_fm_guid", buildingFmGuid)
        .in("category", ["Floor", "IfcBuildingStorey", "Building Storey"])
        .order("common_name");

      if (!storeys || storeys.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          error: "No storeys found for this building",
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 3. Download the XKT binary from storage
      const { data: signedUrl, error: urlError } = await supabase.storage
        .from("xkt-models")
        .createSignedUrl(parentModel.storage_path, 600);

      if (urlError || !signedUrl?.signedUrl) {
        throw new Error("Could not get signed URL for model");
      }

      const xktResponse = await fetch(signedUrl.signedUrl);
      if (!xktResponse.ok) {
        throw new Error(`Failed to download XKT: ${xktResponse.status}`);
      }

      const xktBuffer = await xktResponse.arrayBuffer();
      const xktBytes = new Uint8Array(xktBuffer);

      console.log(`[xkt-split] Downloaded ${modelId}: ${(xktBytes.byteLength / 1024 / 1024).toFixed(1)} MB`);

      // 4. Parse XKT v10 header to extract entity metadata
      // XKT v10 format: magic(4) + version(4) + numElements(4) + element headers + data
      // Each entity has: entityId, meshIds, ifcType, parent hierarchy
      //
      // NOTE: Full XKT binary parsing is complex. For Phase 1, we use a simplified approach:
      // We create "virtual chunks" that reference the same underlying storage file
      // but include storey metadata for the viewer to use for visibility filtering.
      // True binary splitting will be implemented in Phase 2 with a dedicated worker.

      const chunkRecords = [];
      for (let i = 0; i < storeys.length; i++) {
        const storey = storeys[i];
        const chunkId = `${modelId}__storey_${i}`;
        const chunkName = `${parentModel.model_name || 'Model'} — ${storey.common_name || storey.name || `Floor ${i}`}`;

        chunkRecords.push({
          building_fm_guid: buildingFmGuid,
          building_name: parentModel.building_name,
          model_id: chunkId,
          model_name: chunkName,
          file_name: parentModel.file_name, // Same file — viewer uses storey_fm_guid for filtering
          storage_path: parentModel.storage_path,
          file_size: parentModel.file_size,
          format: "xkt",
          is_chunk: true,
          chunk_order: i,
          parent_model_id: modelId,
          storey_fm_guid: storey.fm_guid,
          source_url: parentModel.source_url,
        });
      }

      // 5. Upsert chunk records
      const { error: upsertError } = await supabase
        .from("xkt_models")
        .upsert(chunkRecords, { onConflict: "model_id,building_fm_guid" });

      if (upsertError) {
        console.error("[xkt-split] Upsert error:", upsertError);
        throw upsertError;
      }

      console.log(`[xkt-split] Created ${chunkRecords.length} virtual chunks for ${modelId}`);

      return new Response(JSON.stringify({
        success: true,
        chunksCreated: chunkRecords.length,
        storeys: storeys.map(s => ({
          fmGuid: s.fm_guid,
          name: s.common_name || s.name,
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "list-chunks") {
      const { data: chunks, error } = await supabase
        .from("xkt_models")
        .select("model_id, model_name, storey_fm_guid, chunk_order, file_size, parent_model_id")
        .eq("building_fm_guid", buildingFmGuid)
        .eq("is_chunk", true)
        .order("chunk_order");

      if (error) throw error;

      return new Response(JSON.stringify({
        success: true,
        chunks: chunks ?? [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error("[xkt-split] Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
