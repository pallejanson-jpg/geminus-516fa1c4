import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const token = Deno.env.get('CESIUM_ION_TOKEN');

  if (!token) {
    return new Response(
      JSON.stringify({ error: 'CESIUM_ION_TOKEN not configured' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ token }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
