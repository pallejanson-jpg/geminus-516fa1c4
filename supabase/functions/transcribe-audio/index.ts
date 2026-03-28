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

    const body = await req.json();
    const { audio, mimetype } = body;

    if (!audio) {
      return new Response(JSON.stringify({ error: "Missing 'audio' field (base64)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decode base64 to Uint8Array
    const binaryString = atob(audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const contentType = mimetype || "audio/webm";

    const dgRes = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&language=sv&smart_format=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentType,
        },
        body: bytes,
      }
    );

    if (!dgRes.ok) {
      const errText = await dgRes.text();
      console.error("Deepgram error:", errText);
      return new Response(JSON.stringify({ error: "Deepgram transcription failed", details: errText }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dgResult = await dgRes.json();
    const transcript =
      dgResult?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    return new Response(JSON.stringify({ transcript }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("transcribe-audio error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
