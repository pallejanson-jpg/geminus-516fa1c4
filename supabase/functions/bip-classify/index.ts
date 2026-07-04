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
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
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

    const systemPrompt = `You are an expert on Swedish building classification systems, particularly BIP (Byggvarubedömningen i Projekt).
Your task is to match a given asset object against the most relevant BIP type designations.

Rules:
- Return the 3-5 best matching BIP codes
- Base the match on the object's name, type, IFC category and properties
- Each suggestion must have a confidence level (0.0-1.0)
- Include BSAB-E and AFF links if available
- ALWAYS respond via the tool call, never as free text`;

    const userPrompt = `Classify this object against BIP type designations:

${assetDescription}

Available BIP type designations (code | title | type designation | BSAB-E | main category):
${referenceText}`;

    // Call Anthropic directly with tool use for structured output
    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            name: "classify_bip",
            description: "Return ranked BIP classification suggestions for the asset",
            input_schema: {
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
                  },
                },
              },
              required: ["suggestions"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "classify_bip" },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("Anthropic API error:", aiResponse.status, errText);
      throw new Error(`Anthropic API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolUse = aiData.content?.find((b: any) => b.type === "tool_use");

    if (!toolUse) {
      throw new Error("AI did not return structured classification");
    }

    const result = toolUse.input;

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
