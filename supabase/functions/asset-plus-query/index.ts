import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { filter } = await req.json();

    // Build query based on filter
    let query = supabase.from("assets").select("*");

    // Parse filter array: [["category", "=", "Building"], "or", ["category", "=", "Space"], ...]
    if (Array.isArray(filter) && filter.length > 0) {
      const categories: string[] = [];
      
      for (const item of filter) {
        if (Array.isArray(item) && item.length === 3) {
          const [field, op, value] = item;
          if (field === "category" && op === "=") {
            categories.push(value);
          }
        }
      }

      if (categories.length > 0) {
        query = query.in("category", categories);
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error("Database query error:", error);
      return new Response(
        JSON.stringify({ error: error.message, items: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map database columns to camelCase for frontend compatibility
    const items = (data || []).map((row: any) => ({
      fmGuid: row.fm_guid,
      category: row.category,
      name: row.name,
      commonName: row.common_name,
      complexCommonName: row.complex_common_name,
      buildingFmGuid: row.building_fm_guid,
      levelFmGuid: row.level_fm_guid,
      inRoomFmGuid: row.in_room_fm_guid,
      grossArea: row.gross_area,
      assetType: row.asset_type,
      attributes: row.attributes,
    }));

    return new Response(
      JSON.stringify({ items }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("asset-plus-query error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", items: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
