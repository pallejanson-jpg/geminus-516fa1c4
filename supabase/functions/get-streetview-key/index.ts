import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Option 1: Direct Google Street View API key
  const directKey = Deno.env.get('GOOGLE_STREET_VIEW_API_KEY');
  if (directKey) {
    return new Response(
      JSON.stringify({ key: directKey, url: 'https://maps.googleapis.com/maps/api/streetview', source: 'direct' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Option 2: Cesium Ion experimental endpoint
  const ionToken = Deno.env.get('CESIUM_ION_TOKEN');
  if (!ionToken) {
    return new Response(
      JSON.stringify({ error: 'No Street View API key or Cesium Ion token configured' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const ionRes = await fetch('https://api.cesium.com/experimental/panoramas/google', {
      headers: { Authorization: `Bearer ${ionToken}` },
    });

    if (!ionRes.ok) {
      throw new Error(`Cesium Ion responded with ${ionRes.status}`);
    }

    const ionData = await ionRes.json();
    return new Response(
      JSON.stringify({
        key: ionData.options?.key,
        url: ionData.options?.url || 'https://maps.googleapis.com/maps/api/streetview',
        source: 'cesium-ion',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Failed to fetch Street View key: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
