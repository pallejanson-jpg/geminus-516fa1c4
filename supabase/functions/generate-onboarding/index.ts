import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { role, goals } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    // Map role codes to human-readable names
    const roleNames: Record<string, string> = {
      fm_technician: "Facility Management Technician",
      property_manager: "Property Manager",
      consultant: "FM Consultant",
      other: "Professional",
    };

    // Map goal codes to human-readable descriptions
    const goalDescriptions: Record<string, string> = {
      inventory: "managing and registering facility inventory",
      viewer: "exploring 3D building models",
      insights: "analyzing building performance and data insights",
      navigate: "navigating between buildings and spaces",
    };

    const roleName = roleNames[role] || role || "Professional";
    const goalsList = (goals || [])
      .map((g: string) => goalDescriptions[g] || g)
      .join(", ");

    const systemPrompt = `You are a friendly onboarding assistant for Geminus, a cutting-edge digital twin platform for facility management.

Your task is to generate a short, warm welcome message (2-3 paragraphs) for a new user.

Guidelines:
- Be professional yet warm and welcoming
- Tailor the message specifically to their role and goals
- Include 2-3 specific, actionable tips for getting started based on their goals
- Keep paragraphs concise (2-3 sentences each)
- Use encouraging language that makes them excited to explore
- Write in English only
- Do not use markdown formatting, just plain text
- End with an encouraging call-to-action`;

    const userPrompt = `Generate a personalized welcome message for a new Geminus user with the following profile:

Role: ${roleName}
Goals: ${goalsList || "exploring the platform"}

Create a friendly, professional welcome that helps them feel confident getting started.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const errorText = await response.text();
      console.error("Anthropic API error:", response.status, errorText);
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const script = data.content?.[0]?.text || "";

    return new Response(
      JSON.stringify({ script, success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-onboarding error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
