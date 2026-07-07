import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { buildingFmGuid } = await req.json();
    if (!buildingFmGuid) {
      return new Response(JSON.stringify({ error: "buildingFmGuid required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: rooms, error: dbErr } = await supabase
      .from("assets")
      .select("fm_guid, name, common_name, gross_area, attributes, level_fm_guid, category")
      .eq("building_fm_guid", buildingFmGuid)
      .in("category", ["Space", "IfcSpace"])
      .limit(500);

    if (dbErr) throw dbErr;

    const { data: equipment } = await supabase
      .from("assets")
      .select("in_room_fm_guid, category")
      .eq("building_fm_guid", buildingFmGuid)
      .not("in_room_fm_guid", "is", null)
      .not("category", "in", '("Space","IfcSpace")')
      .limit(1000);

    const equipPerRoom = new Map<string, number>();
    equipment?.forEach(e => {
      if (e.in_room_fm_guid) {
        equipPerRoom.set(e.in_room_fm_guid, (equipPerRoom.get(e.in_room_fm_guid) || 0) + 1);
      }
    });

    const extractSensor = (attrs: any, ...keys: string[]) => {
      if (!attrs) return null;
      for (const key of keys) {
        if (attrs[key] !== undefined && attrs[key] !== null) return attrs[key];
      }
      for (const [k, v] of Object.entries(attrs)) {
        const lk = k.toLowerCase();
        for (const key of keys) {
          if (lk.includes(key.toLowerCase())) return v;
        }
      }
      return null;
    };

    const roomSummary = (rooms || []).map(r => ({
      guid: r.fm_guid,
      name: r.name || r.common_name,
      area: r.gross_area,
      floor: r.level_fm_guid,
      equipmentCount: equipPerRoom.get(r.fm_guid) || 0,
      occupancy: extractSensor(r.attributes, 'sensorOccupancy', 'occupancy'),
      temperature: extractSensor(r.attributes, 'sensorTemperature', 'temperature'),
      co2: extractSensor(r.attributes, 'sensorCo2', 'co2'),
      humidity: extractSensor(r.attributes, 'sensorHumidity', 'humidity'),
    }));

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: `You are an expert in space optimization and smart space utilization in buildings. Analyze room data and suggest optimizations.

Respond with JSON:
{
  "utilizationScore": 0-100,
  "suggestions": [
    {
      "type": "underutilized" | "overcrowded" | "merge" | "convert" | "rezone",
      "roomGuids": ["guid1", "guid2"],
      "title": "Short title",
      "description": "Detailed description of the suggestion",
      "potentialSaving": "e.g. '15% space savings'",
      "priority": "high" | "medium" | "low",
      "estimatedImpact": "Expected impact"
    }
  ],
  "statistics": {
    "totalArea": 0,
    "avgOccupancy": 0,
    "underutilizedRooms": 0,
    "overcrowdedRooms": 0
  },
  "summary": "Overall summary"
}

Focus on:
- Rooms with low occupancy (< 30%) that could be merged or converted
- Rooms with high occupancy (> 80%) that need relief
- Spaces without sensors that should be instrumented
- Energy savings suggestions based on room usage`,
      messages: [
        {
          role: "user",
          content: `Analyze these ${roomSummary.length} rooms:\n\n${JSON.stringify(roomSummary, null, 2)}`,
        },
      ],
    });

    const content = msg.content[0]?.type === "text" ? msg.content[0].text : "";

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
