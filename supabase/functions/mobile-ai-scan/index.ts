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
    const { imageBase64, templateId } = await req.json();

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch active detection templates for context
    const { data: templates } = await supabase
      .from("detection_templates")
      .select("id, name, object_type, description, default_category, ai_prompt, default_symbol_id")
      .eq("is_active", true)
      .limit(20);

    // Fetch annotation symbols for matching
    const { data: symbols } = await supabase
      .from("annotation_symbols")
      .select("id, name, category, color, icon_url")
      .order("category, name");

    // Build template context
    let templateContext = "";
    let selectedTemplate: any = null;

    if (templateId && templates) {
      selectedTemplate = templates.find((t: any) => t.id === templateId);
    }

    if (selectedTemplate) {
      templateContext = `Focus on detecting: ${selectedTemplate.name} (${selectedTemplate.object_type}). ${selectedTemplate.ai_prompt || selectedTemplate.description || ""}`;
    } else if (templates && templates.length > 0) {
      templateContext = `Known object types in this facility: ${templates.map((t: any) => `${t.object_type} (${t.default_category || "Övrigt"}): ${t.description || t.name}`).join("; ")}.`;
    }

    // Build symbol list for AI matching
    const symbolContext = symbols && symbols.length > 0
      ? `\nAvailable annotation symbols (use these exact IDs): ${symbols.map((s: any) => `"${s.id}" = "${s.name}" (category: ${s.category})`).join("; ")}.`
      : "";

    const systemPrompt = `You are an expert at identifying building equipment and assets from photos taken during facility management inspections in Sweden. ${templateContext}${symbolContext} Return ONLY valid JSON, no markdown, no explanation.`;

    const userPrompt = `Identify the main object in this photo. Return a JSON object with exactly these fields:
{
  "objectType": one of ["fire_extinguisher", "fire_alarm_button", "smoke_detector", "fire_hose", "electrical_panel", "door", "elevator", "staircase", "ventilation", "hvac_unit", "sprinkler", "emergency_light", "access_control", "other"],
  "suggestedName": a short descriptive name in Swedish (e.g. "Brandsläckare 6kg ABC", "Larmknapp plan 2", "Rökdetektor optisk"),
  "description": a brief description in Swedish of what you see, including placement, condition and any notable details (1-2 sentences),
  "confidence": a number between 0.0 and 1.0,
  "category": one of ["Brandskydd", "El", "VVS", "Ventilation", "Dörrar", "Transporter", "Säkerhet", "Övrigt"],
  "suggestedSymbolId": the UUID of the best matching annotation symbol from the available list, or null if no good match,
  "properties": {
    "manufacturer": "manufacturer/brand name or null",
    "model": "model name/number or null",
    "size": "size, capacity or weight (e.g. '6kg', '2L') or null",
    "color": "color description or null",
    "condition": one of ["good", "fair", "poor"] or null,
    "text_visible": "any visible text, serial numbers, labels on the object or null",
    "material": "material type or null",
    "installation_type": "wall-mounted, ceiling-mounted, floor-standing, recessed, etc. or null"
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
        max_tokens: 800,
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
          description: "",
          confidence: 0,
          category: "Övrigt",
          suggestedSymbolId: null,
          properties: {},
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // If AI didn't suggest a symbol but we have a template with a default symbol, use that
    if (!result.suggestedSymbolId && selectedTemplate?.default_symbol_id) {
      result.suggestedSymbolId = selectedTemplate.default_symbol_id;
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
