import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CacheRequest {
  action: "check" | "get" | "store" | "invalidate-building";
  modelId?: string;
  buildingFmGuid?: string;
  xktData?: ArrayBuffer | string;
}

interface CacheResponse {
  success: boolean;
  cached?: boolean;
  url?: string;
  error?: string;
  deletedModels?: number;
  deletedFiles?: number;
}

/**
 * XKT Model Cache Edge Function
 * 
 * Caches XKT models in Supabase Storage to improve load times.
 * 
 * Actions:
 * - check: Check if a model is cached
 * - get: Get the cached model URL
 * - store: Store a model in cache
 * - invalidate-building: Delete all cached XKT data for a building
 */
serve(async (req) => {
  // Handle CORS preflight
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

    const body: CacheRequest = await req.json();
    const { action, modelId, buildingFmGuid, xktData } = body;

    if (action !== "invalidate-building" && !modelId) {
      throw new Error("modelId is required");
    }

    // Create a safe filename from modelId
    const safeModelId = modelId ? modelId.replace(/[^a-zA-Z0-9-_]/g, "_") : "";
    const buildingPath = buildingFmGuid ? `${buildingFmGuid}/` : "";
    const filePath = modelId ? `${buildingPath}${safeModelId}.xkt` : "";

    let response: CacheResponse;

    switch (action) {
      case "check": {
        // Check if the file exists in storage
        const { data, error } = await supabase.storage
          .from("xkt-models")
          .list(buildingPath || "", {
            limit: 1,
            search: `${safeModelId}.xkt`,
          });

        if (error) {
          throw error;
        }

        const exists = data && data.length > 0 && data.some(f => f.name === `${safeModelId}.xkt`);
        
        if (exists) {
          // Get signed URL for access
          const { data: urlData, error: urlError } = await supabase.storage
            .from("xkt-models")
            .createSignedUrl(filePath, 3600); // 1 hour expiry

          if (urlError) {
            throw urlError;
          }

          response = {
            success: true,
            cached: true,
            url: urlData.signedUrl,
          };
        } else {
          response = {
            success: true,
            cached: false,
          };
        }
        break;
      }

      case "get": {
        // Get signed URL for the cached model
        const { data: urlData, error: urlError } = await supabase.storage
          .from("xkt-models")
          .createSignedUrl(filePath, 3600);

        if (urlError) {
          // File might not exist
          response = {
            success: false,
            cached: false,
            error: "Model not cached",
          };
        } else {
          response = {
            success: true,
            cached: true,
            url: urlData.signedUrl,
          };
        }
        break;
      }

      case "store": {
        if (!xktData) {
          throw new Error("xktData is required for store action");
        }

        // Convert base64 to Uint8Array if needed
        let binaryData: Uint8Array;
        if (typeof xktData === "string") {
          // Assume base64 encoded
          const binaryString = atob(xktData);
          binaryData = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            binaryData[i] = binaryString.charCodeAt(i);
          }
        } else {
          binaryData = new Uint8Array(xktData);
        }

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("xkt-models")
          .upload(filePath, binaryData, {
            contentType: "application/octet-stream",
            upsert: true, // Overwrite if exists
          });

        if (uploadError) {
          throw uploadError;
        }

        // Get signed URL for immediate access
        const { data: urlData, error: urlError } = await supabase.storage
          .from("xkt-models")
          .createSignedUrl(filePath, 3600);

        if (urlError) {
          throw urlError;
        }

        console.log(`Cached XKT model: ${filePath}`);

        response = {
          success: true,
          cached: true,
          url: urlData.signedUrl,
        };
        break;
      }

      case "invalidate-building": {
        if (!buildingFmGuid) {
          throw new Error("buildingFmGuid is required for invalidate-building action");
        }

        const { error: dbDeleteError, count: deletedModels } = await supabase
          .from("xkt_models")
          .delete({ count: "exact" })
          .eq("building_fm_guid", buildingFmGuid);

        if (dbDeleteError) {
          throw dbDeleteError;
        }

        const { data: files, error: listError } = await supabase.storage
          .from("xkt-models")
          .list(buildingFmGuid, { limit: 1000 });

        if (listError) {
          throw listError;
        }

        const paths = (files ?? []).map((f) => `${buildingFmGuid}/${f.name}`);
        let deletedFiles = 0;

        if (paths.length > 0) {
          const { data: removed, error: removeError } = await supabase.storage
            .from("xkt-models")
            .remove(paths);

          if (removeError) {
            throw removeError;
          }

          deletedFiles = removed?.length ?? paths.length;
        }

        console.log(`Invalidated XKT cache for building ${buildingFmGuid}: db=${deletedModels ?? 0}, storage=${deletedFiles}`);

        response = {
          success: true,
          cached: false,
          deletedModels: deletedModels ?? 0,
          deletedFiles,
        };
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("XKT cache error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 200, // Return 200 to prevent frontend crashes
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
