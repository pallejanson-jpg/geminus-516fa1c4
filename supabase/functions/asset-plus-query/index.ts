import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // TODO: Implement real Asset+ proxy (Keycloak OAuth + API calls).
    // For now we return a clear error so the UI can show an empty/failed state.
    return new Response(
      JSON.stringify({
        error: "Asset+ is not configured yet",
        items: [],
      }),
      {
        status: 501,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("asset-plus-query error", error);
    return new Response(JSON.stringify({ error: "Internal server error", items: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
