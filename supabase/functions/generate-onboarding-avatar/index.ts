import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Avatar prompts based on user role
const avatarPrompts: Record<string, string> = {
  fm_technician: "Professional digital avatar portrait of a friendly facility manager, wearing a navy blue safety vest over business casual clothes, warm smile, clean-shaven or well-groomed, modern futuristic office with holographic displays in background, soft professional lighting, photorealistic style, head and shoulders only, facing camera, neutral background gradient",
  property_manager: "Professional digital avatar portrait of a confident property manager, elegant business attire with blazer, approachable expression, modern office with panoramic city skyline view through windows, warm golden hour lighting, photorealistic style, head and shoulders only, facing camera, neutral background gradient",
  consultant: "Professional digital avatar portrait of an expert FM consultant, smart casual attire with open collar shirt, intelligent and friendly demeanor, high-tech workspace with data visualizations in background, balanced professional lighting, photorealistic style, head and shoulders only, facing camera, neutral background gradient",
  other: "Professional digital avatar portrait of a friendly business professional, neutral modern business attire, welcoming smile, clean contemporary office environment, soft balanced lighting, photorealistic style, head and shoulders only, facing camera, neutral background gradient"
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { role, goals } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const roleName = roleNames[role] || role || "Professional";
    const goalsList = (goals || [])
      .map((g: string) => goalDescriptions[g] || g)
      .join(", ");

    // Generate script (Anthropic) and avatar (Google Gemini image generation) in parallel
    const [scriptResult, avatarResult] = await Promise.allSettled([
      // Script generation
      fetch("https://api.anthropic.com/v1/messages", {
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
          system: `You are a friendly onboarding assistant for Geminus, a cutting-edge digital twin platform for facility management.

Your task is to generate a short, warm welcome message (2-3 paragraphs) for a new user.

Guidelines:
- Be professional yet warm and welcoming
- Tailor the message specifically to their role and goals
- Include 2-3 specific, actionable tips for getting started based on their goals
- Keep paragraphs concise (2-3 sentences each)
- Use encouraging language that makes them excited to explore
- Write in English only
- Do not use markdown formatting, just plain text
- End with an encouraging call-to-action`,
          messages: [
            {
              role: "user",
              content: `Generate a personalized welcome message for a new Geminus user with the following profile:

Role: ${roleName}
Goals: ${goalsList || "exploring the platform"}

Create a friendly, professional welcome that helps them feel confident getting started.`
            },
          ],
        }),
      }),

      // Avatar image generation — Google Gemini's image model has no Anthropic equivalent,
      // so this calls Google's Generative Language API directly instead.
      (async () => {
        if (!GOOGLE_AI_API_KEY) throw new Error("GOOGLE_AI_API_KEY is not configured");
        return fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GOOGLE_AI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: avatarPrompts[role] || avatarPrompts.other }] }],
            }),
          }
        );
      })(),
    ]);

    // Process script result
    let script = "";
    if (scriptResult.status === "fulfilled" && scriptResult.value.ok) {
      const scriptData = await scriptResult.value.json();
      script = scriptData.content?.[0]?.text || "";
    } else {
      console.error("Script generation failed:", scriptResult.status === "rejected" ? scriptResult.reason : "Response not ok");
      // Provide fallback script
      script = `Welcome to Geminus! We're excited to have you on board.

As a ${roleName}, you'll find powerful tools to help you manage your buildings more effectively. Our platform combines cutting-edge 3D visualization with comprehensive facility management capabilities.

Get started by exploring the 3D viewer to navigate your building models, or check out the inventory section to register and track your assets. If you need any help, our AI assistant is always available. Let's begin your journey!`;
    }

    // Process avatar result
    let avatarImage: string | null = null;
    if (avatarResult.status === "fulfilled" && avatarResult.value.ok) {
      const avatarData = await avatarResult.value.json();
      const imgPart = avatarData.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (imgPart?.inlineData?.data) {
        const mimeType = imgPart.inlineData.mimeType || "image/png";
        avatarImage = `data:${mimeType};base64,${imgPart.inlineData.data}`;
      }
    } else {
      console.error("Avatar generation failed:", avatarResult.status === "rejected" ? avatarResult.reason : "Response not ok");
      // avatarImage remains null - frontend will show fallback
    }

    return new Response(
      JSON.stringify({ 
        script, 
        avatarImage,
        success: true 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-onboarding-avatar error:", error);
    
    // Handle rate limits
    if (error instanceof Response) {
      if (error.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (error.status === 402) {
        return new Response(
          JSON.stringify({ error: "Service temporarily unavailable." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
