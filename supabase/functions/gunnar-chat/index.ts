import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Initialize Supabase client to query asset data
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get asset statistics for context
    const [categoryCounts, sampleSpaces, sampleDoors] = await Promise.all([
      supabase.from("assets").select("category").then(({ data }) => {
        const counts: Record<string, number> = {};
        data?.forEach((item) => {
          counts[item.category] = (counts[item.category] || 0) + 1;
        });
        return counts;
      }),
      supabase.from("assets").select("fm_guid, common_name, name, attributes").eq("category", "Space").limit(50),
      supabase.from("assets").select("fm_guid, common_name, name, attributes").eq("category", "Door").limit(50),
    ]);

    // Extract unique attribute keys from spaces to understand the data model
    const spaceAttributes = new Set<string>();
    sampleSpaces.data?.forEach((space) => {
      if (space.attributes && typeof space.attributes === "object") {
        Object.keys(space.attributes).forEach((key) => {
          // Filter out internal keys and get human-readable names
          const attr = (space.attributes as Record<string, any>)[key];
          if (attr && typeof attr === "object" && attr.name) {
            spaceAttributes.add(attr.name);
          }
        });
      }
    });

    // Build context about the data
    const dataContext = `
You are Gunnar, a helpful AI data assistant for a facilities management system. You have access to building asset data.

CURRENT DATA SUMMARY:
- Categories and counts: ${JSON.stringify(categoryCounts)}
- Total assets: ${Object.values(categoryCounts).reduce((a, b) => a + b, 0)}

SPACE ATTRIBUTES AVAILABLE (for querying rooms/spaces):
${Array.from(spaceAttributes).slice(0, 30).join(", ")}

Common attributes include:
- "Floor Covering" or "Golvmaterial" - floor material (codes like G01, G02, etc.)
- "Ceiling Covering" - ceiling material
- "Wall Covering" - wall material  
- "NTA" - net area in square meters
- "Rumsnamn" / "Long Name" - room name
- "Rumsnummer" - room number
- "Hyresobjekt" - rental object

SAMPLE SPACE DATA (first few rooms):
${JSON.stringify(sampleSpaces.data?.slice(0, 5).map(s => ({
  fmGuid: s.fm_guid,
  name: s.common_name || s.name,
  floorCovering: s.attributes?.floorcoveringFD9E593FE947F821E0E39C1A31A684FF78E0A23A?.value,
  area: s.attributes?.nta51780ACD4DD0DA970F071C4F197E361479BC375A?.value,
})), null, 2)}

INSTRUCTIONS:
1. Answer questions about the building data accurately based on the available information
2. When users ask about counts or statistics, provide specific numbers
3. When users ask to find specific items (e.g., "rooms with concrete floors"), you can indicate that you found matching items
4. If asked to show items in the navigator tree, respond with a JSON block containing fmGuids like this:
   \`\`\`json
   {"action": "selectInTree", "fmGuids": ["guid1", "guid2", ...]}
   \`\`\`
5. Be helpful, concise, and professional
6. If you don't have enough data to answer, say so clearly

The user's question might be in Swedish or English - respond in the same language.
`;

    // Check if the user wants to query specific data
    const lastUserMessage = messages[messages.length - 1]?.content || "";
    
    // Detect if we need to do a specific query
    let additionalContext = "";
    
    // Check for floor covering queries
    if (lastUserMessage.toLowerCase().includes("golv") || 
        lastUserMessage.toLowerCase().includes("floor") ||
        lastUserMessage.toLowerCase().includes("betong") ||
        lastUserMessage.toLowerCase().includes("concrete")) {
      
      // Query all spaces with their floor covering
      const { data: allSpaces } = await supabase
        .from("assets")
        .select("fm_guid, common_name, name, attributes")
        .eq("category", "Space");
      
      // Filter spaces by floor covering if needed
      const spacesWithFloors = allSpaces?.map((s) => ({
        fmGuid: s.fm_guid,
        name: s.common_name || s.name,
        floorCovering: (s.attributes as any)?.floorcoveringFD9E593FE947F821E0E39C1A31A684FF78E0A23A?.value ||
                       (s.attributes as any)?.golvmaterial54D5F51909E146BD7A9089F8FDE5C7C8265E5B0F?.value,
      })).filter(s => s.floorCovering);

      additionalContext = `\n\nFLOOR COVERING DATA FOR ALL SPACES:\n${JSON.stringify(spacesWithFloors, null, 2)}`;
    }

    // Check for fire extinguisher queries
    if (lastUserMessage.toLowerCase().includes("brandsläckare") || 
        lastUserMessage.toLowerCase().includes("fire extinguisher") ||
        lastUserMessage.toLowerCase().includes("brand")) {
      
      const { data: fireEquipment, count } = await supabase
        .from("assets")
        .select("fm_guid, common_name, name, category, attributes", { count: "exact" })
        .or("common_name.ilike.%brand%,name.ilike.%brand%,common_name.ilike.%fire%,name.ilike.%fire%");
      
      additionalContext += `\n\nFIRE-RELATED EQUIPMENT SEARCH RESULTS (${count || 0} items):\n${JSON.stringify(fireEquipment?.slice(0, 20), null, 2)}`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: dataContext + additionalContext },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Gunnar chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
