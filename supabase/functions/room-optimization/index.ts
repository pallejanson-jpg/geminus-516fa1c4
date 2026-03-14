import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { buildingFmGuid } = await req.json();
    if (!buildingFmGuid) {
      return new Response(JSON.stringify({ error: "buildingFmGuid required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all rooms with area and sensor data
    const { data: rooms, error: dbErr } = await supabase
      .from("assets")
      .select("fm_guid, name, common_name, gross_area, attributes, level_fm_guid, category")
      .eq("building_fm_guid", buildingFmGuid)
      .eq("category", "IfcSpace")
      .limit(500);

    if (dbErr) throw dbErr;

    // Get equipment counts per room
    const { data: equipment } = await supabase
      .from("assets")
      .select("in_room_fm_guid, category")
      .eq("building_fm_guid", buildingFmGuid)
      .not("in_room_fm_guid", "is", null)
      .not("category", "eq", "IfcSpace")
      .limit(1000);

    const equipPerRoom = new Map<string, number>();
    equipment?.forEach(e => {
      if (e.in_room_fm_guid) {
        equipPerRoom.set(e.in_room_fm_guid, (equipPerRoom.get(e.in_room_fm_guid) || 0) + 1);
      }
    });

    const roomSummary = (rooms || []).map(r => ({
      guid: r.fm_guid,
      name: r.name || r.common_name,
      area: r.gross_area,
      floor: r.level_fm_guid,
      equipmentCount: equipPerRoom.get(r.fm_guid) || 0,
      occupancy: r.attributes?.sensorOccupancy ?? r.attributes?.occupancy ?? null,
      temperature: r.attributes?.sensorTemperature ?? r.attributes?.temperature ?? null,
      co2: r.attributes?.sensorCo2 ?? r.attributes?.co2 ?? null,
    }));

    const aiResp = await fetch(AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `Du är expert på lokaloptimering och smart ytanvändning i fastigheter. Analysera rumsdata och föreslå optimeringar.

Svara med JSON:
{
  "utilizationScore": 0-100,
  "suggestions": [
    {
      "type": "underutilized" | "overcrowded" | "merge" | "convert" | "rezone",
      "roomGuids": ["guid1", "guid2"],
      "title": "Kort titel",
      "description": "Detaljerad beskrivning av förslaget",
      "potentialSaving": "t.ex. '15% ytbesparing'",
      "priority": "high" | "medium" | "low",
      "estimatedImpact": "Förväntad effekt"
    }
  ],
  "statistics": {
    "totalArea": 0,
    "avgOccupancy": 0,
    "underutilizedRooms": 0,
    "overcrowdedRooms": 0
  },
  "summary": "Övergripande sammanfattning"
}

Fokusera på:
- Rum med låg beläggning (< 30%) som kan slås samman eller konverteras
- Rum med hög beläggning (> 80%) som behöver avlastning
- Ytor utan sensorer som bör instrumenteras
- Energibesparingsförslag baserat på rumsanvändning`,
          },
          {
            role: "user",
            content: `Analysera dessa ${roomSummary.length} rum:\n\n${JSON.stringify(roomSummary, null, 2)}`,
          },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${aiResp.status}`);
    }

    const aiResult = await aiResp.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    let optimization;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      optimization = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [], summary: content.slice(0, 500) };
    } catch {
      optimization = { suggestions: [], summary: content.slice(0, 500) };
    }

    return new Response(JSON.stringify({ success: true, data: optimization }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("room-optimization error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
