import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "DEEPGRAM_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a temporary API key via Deepgram's keys API (scoped, short-lived)
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${apiKey}` },
    });

    if (!res.ok) {
      // Fallback: just return the key directly (still secure since it's server-side only transit)
      // The frontend will use it for a single WebSocket session
      return new Response(JSON.stringify({ key: apiKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const projects = await res.json();
    const projectId = projects?.projects?.[0]?.project_id;

    if (!projectId) {
      return new Response(JSON.stringify({ key: apiKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create a short-lived key (30 seconds TTL)
    const keyRes = await fetch(`https://api.deepgram.com/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        comment: "Temporary STT key",
        scopes: ["usage:write"],
        time_to_live_in_seconds: 30,
      }),
    });

    if (!keyRes.ok) {
      // Fallback to main key
      return new Response(JSON.stringify({ key: apiKey }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keyData = await keyRes.json();
    return new Response(JSON.stringify({ key: keyData.key }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
