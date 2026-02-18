import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Fetch active detection templates for context
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: templates } = await supabase
      .from("detection_templates")
      .select("name, object_type, description, default_category")
      .eq("is_active", true)
      .limit(10);

    const templateContext = templates && templates.length > 0
      ? `Known object types in this facility: ${templates.map((t: any) => `${t.object_type} (${t.default_category || "Övrigt"}): ${t.description || t.name}`).join("; ")}.`
      : "";

    const systemPrompt = `You are an expert at identifying building equipment and assets from photos taken during facility management inspections in Sweden. ${templateContext} Return ONLY valid JSON, no markdown, no explanation.`;

    const userPrompt = `Identify the main object in this photo. Return a JSON object with exactly these fields:
{
  "objectType": one of ["fire_extinguisher", "fire_alarm_button", "smoke_detector", "fire_hose", "electrical_panel", "door", "elevator", "staircase", "ventilation", "other"],
  "suggestedName": a short descriptive name in Swedish (e.g. "Brandsläckare 6kg", "Larmknapp plan 2", "Rökdetektor"),
  "confidence": a number between 0.0 and 1.0,
  "category": one of ["Brandskydd", "El", "VVS", "Ventilation", "Dörrar", "Transporter", "Övrigt"],
  "properties": {
    "brand": "brand name or null",
    "model": "model name or null",
    "size": "size or capacity or null",
    "color": "color description or null",
    "condition": "good/fair/poor or null",
    "text_visible": "any visible text on the object or null"
  }
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
              },
              { type: "text", text: userPrompt },
            ],
          },
        ],
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limits exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add funds to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errText = await response.text();
      throw new Error(`AI gateway error ${response.status}: ${errText}`);
    }

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    let result: any = null;
    try {
      // Strip potential markdown code fences
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      result = JSON.parse(cleaned);
    } catch (e) {
      console.error("[mobile-ai-scan] Failed to parse AI response:", content);
      return new Response(
        JSON.stringify({
          error: "Could not parse AI response",
          raw: content,
          objectType: "other",
          suggestedName: "",
          confidence: 0,
          category: "Övrigt",
          properties: {},
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[mobile-ai-scan] Result:", JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[mobile-ai-scan] Error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
