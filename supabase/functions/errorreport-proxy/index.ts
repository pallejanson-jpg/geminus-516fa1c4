import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BASE_URL = "https://er-rep.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, qrKey, payload } = await req.json();

    if (!qrKey) {
      return new Response(
        JSON.stringify({ error: "qrKey is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiUrl = `${BASE_URL}/api/v1/errorreport/register/${encodeURIComponent(qrKey)}`;

    if (action === "get-config") {
      console.log(`[errorreport-proxy] GET config for key: ${qrKey}`);
      const response = await fetch(apiUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      const data = await response.text();
      console.log(`[errorreport-proxy] GET response status: ${response.status}`);
      console.log(`[errorreport-proxy] GET response body: ${data.substring(0, 500)}`);

      return new Response(data, {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "submit") {
      if (!payload) {
        return new Response(
          JSON.stringify({ error: "payload is required for submit action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[errorreport-proxy] PUT submit for key: ${qrKey}`);
      console.log(`[errorreport-proxy] PUT payload: ${JSON.stringify(payload).substring(0, 500)}`);

      const response = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.text();
      console.log(`[errorreport-proxy] PUT response status: ${response.status}`);
      console.log(`[errorreport-proxy] PUT response body: ${data.substring(0, 500)}`);

      return new Response(data, {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Use "get-config" or "submit".` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[errorreport-proxy] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
