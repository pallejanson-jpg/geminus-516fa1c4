import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Verify user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { assetName, assetType, category, ifcType, attributes, fmGuids } = body;

    // Fetch BIP subcategories + maincategories from reference table
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: subcategories, error: subError } = await serviceClient
      .from("bip_reference")
      .select("ref_id, code, title, usercode_syntax, bsab_e, aff, etim, parent_id")
      .eq("ref_type", "subcategory")
      .order("code");

    if (subError) throw subError;

    const { data: maincategories } = await serviceClient
      .from("bip_reference")
      .select("ref_id, code, title")
      .eq("ref_type", "maincategory");

    if (!subcategories || subcategories.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No BIP reference data found. Please run BIP import first.",
          suggestions: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build a compact reference string for AI
    const mcMap = new Map((maincategories || []).map((m: any) => [m.ref_id, m]));

    const referenceLines = subcategories.map((sc: any) => {
      const mc = mcMap.get(sc.parent_id);
      const mcTitle = mc ? mc.title : "";
      const parts = [
        sc.code,
        sc.title,
        sc.usercode_syntax || "",
        sc.bsab_e || "",
        mcTitle,
      ];
      return parts.join(" | ");
    });

    const referenceText = referenceLines.join("\n");

    // Build asset description
    const attrSummary = attributes
      ? Object.entries(attributes)
          .slice(0, 20)
          .map(([k, v]) => {
            const val = v && typeof v === "object" && "value" in (v as any) ? (v as any).value : v;
            return `${k}: ${val}`;
          })
          .join(", ")
      : "";

    const assetDescription = [
      assetName && `Name: ${assetName}`,
      assetType && `Type: ${assetType}`,
      category && `Category: ${category}`,
      ifcType && `IFC Type: ${ifcType}`,
      attrSummary && `Properties: ${attrSummary}`,
    ]
      .filter(Boolean)
      .join("\n");

    const systemPrompt = `Du är en expert på svenska byggklassificeringssystem, särskilt BIP (Byggvarubedömningen i Projekt).
Din uppgift är att matcha ett givet tillgångsobjekt (asset) mot de mest relevanta BIP-typbeteckningarna.

Regler:
- Returnera de 3-5 bäst matchande BIP-koderna
- Basera matchningen på objektets namn, typ, IFC-kategori och egenskaper
- Varje förslag ska ha en konfidensnivå (0.0-1.0)
- Inkludera BSAB-E och AFF-kopplingar om de finns
- Svara ALLTID via tool-anropet, aldrig som fri text`;

    const userPrompt = `Klassificera detta objekt mot BIP-typbeteckningar:

${assetDescription}

Tillgängliga BIP-typbeteckningar (kod | titel | typbeteckning | BSAB-E | huvudkategori):
${referenceText}`;

    // Call Lovable AI Gateway with tool calling for structured output
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "classify_bip",
              description: "Return ranked BIP classification suggestions for the asset",
              parameters: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        code: { type: "string", description: "BIP subcategory code, e.g. 'EA2'" },
                        title: { type: "string", description: "BIP title" },
                        usercode_syntax: { type: "string", description: "Typbeteckning syntax, e.g. 'EA2xx-i'" },
                        bsab_e: { type: "string", description: "BSAB-E code" },
                        aff: { type: "string", description: "AFF code if available" },
                        confidence: { type: "number", description: "Confidence score 0.0-1.0" },
                        reasoning: { type: "string", description: "Brief explanation for the match" },
                      },
                      required: ["code", "title", "confidence"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["suggestions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "classify_bip" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("AI did not return structured classification");
    }

    const result = JSON.parse(toolCall.function.arguments);

    return new Response(
      JSON.stringify({
        success: true,
        suggestions: result.suggestions || [],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("bip-classify error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        suggestions: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
