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
    const { buildingFmGuid, roomFmGuids } = await req.json();
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

    let query = supabase
      .from("assets")
      .select("fm_guid, name, common_name, attributes, category, asset_type, in_room_fm_guid, level_fm_guid, gross_area")
      .eq("building_fm_guid", buildingFmGuid);

    if (roomFmGuids?.length) {
      query = query.in("fm_guid", roomFmGuids);
    }

    const { data: assets, error: dbErr } = await query.limit(1000);
    if (dbErr) throw dbErr;

    const rooms = (assets || []).filter(a => a.category === "Space" || a.category === "IfcSpace");
    const equipment = (assets || []).filter(a =>
      a.category === "Instance" || a.category === "IfcSensor" || a.category === "IfcActuator" ||
      a.category === "IfcAlarm" || a.category === "IfcUnitaryEquipment" || a.category === "IfcFan" ||
      a.category === "IfcPump" || a.category === "IfcBoiler" || a.category === "IfcChiller"
    );

    const extractSensorData = (attrs: any) => {
      if (!attrs) return {};
      const sensors: Record<string, any> = {};
      for (const [key, val] of Object.entries(attrs)) {
        const lk = key.toLowerCase();
        if (lk.includes('temperature') || lk.includes('co2') || lk.includes('humidity') ||
            lk.includes('occupancy') || lk.includes('sensor') || lk.includes('energy')) {
          sensors[key] = val;
        }
      }
      return sensors;
    };

    const summary = {
      buildingFmGuid,
      totalRooms: rooms.length,
      totalEquipment: equipment.length,
      rooms: rooms.slice(0, 80).map(r => ({
        guid: r.fm_guid,
        name: r.name || r.common_name,
        area: r.gross_area,
        sensorData: extractSensorData(r.attributes),
      })),
      equipment: equipment.slice(0, 100).map(e => ({
        guid: e.fm_guid,
        name: e.name || e.common_name,
        type: e.asset_type || e.category,
        room: e.in_room_fm_guid,
        sensorData: extractSensorData(e.attributes),
      })),
    };

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      system: `You are an expert in predictive maintenance for buildings and facilities. Analyze sensor data and equipment information to identify potential issues BEFORE they occur.

ALWAYS respond with a JSON object using this structure:
{
  "predictions": [
    {
      "equipmentGuid": "guid or null",
      "roomGuid": "guid or null",
      "riskLevel": "high" | "medium" | "low",
      "category": "hvac" | "electrical" | "plumbing" | "structural" | "fire_safety" | "other",
      "title": "Short title",
      "description": "Description of risk and recommended action",
      "estimatedTimeToFailure": "e.g. '2-4 weeks'",
      "confidence": 0.0-1.0
    }
  ],
  "overallRiskScore": 0-100,
  "summary": "Brief summary of the building's maintenance status"
}

Base your analysis on:
- Temperature values outside normal ranges (20-22°C ideal)
- CO2 levels > 1000 ppm (ventilation issues)
- High humidity > 60% (mold/corrosion risk)
- Equipment age and type (older HVAC = higher risk)
- Patterns indicating degradation

If sensor data is available, use it to make concrete predictions. If data is limited, generate reasonable predictions based on equipment types and rooms.`,
      messages: [
        {
          role: "user",
          content: `Analyze this building data for predictive maintenance:\n\n${JSON.stringify(summary, null, 2)}`,
        },
      ],
    });

    const content = msg.content[0]?.type === "text" ? msg.content[0].text : "";

    let predictions;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      predictions = jsonMatch ? JSON.parse(jsonMatch[0]) : { predictions: [], overallRiskScore: 0, summary: "Could not analyze data" };
    } catch {
      predictions = { predictions: [], overallRiskScore: 0, summary: content.slice(0, 500) };
    }

    return new Response(JSON.stringify({ success: true, data: predictions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("predictive-maintenance error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
