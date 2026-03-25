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
    const { buildingFmGuid, roomFmGuids } = await req.json();
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

    // Get rooms and equipment — use actual category values from the database
    let query = supabase
      .from("assets")
      .select("fm_guid, name, common_name, attributes, category, asset_type, in_room_fm_guid, level_fm_guid, gross_area")
      .eq("building_fm_guid", buildingFmGuid);

    if (roomFmGuids?.length) {
      query = query.in("fm_guid", roomFmGuids);
    }

    const { data: assets, error: dbErr } = await query.limit(1000);
    if (dbErr) throw dbErr;

    // Separate rooms and equipment using actual DB categories
    const rooms = (assets || []).filter(a => a.category === "Space" || a.category === "IfcSpace");
    const equipment = (assets || []).filter(a => a.category === "Instance" || a.category === "IfcSensor" || a.category === "IfcActuator" || a.category === "IfcAlarm" || a.category === "IfcUnitaryEquipment" || a.category === "IfcFan" || a.category === "IfcPump" || a.category === "IfcBoiler" || a.category === "IfcChiller");

    // Extract sensor data from room attributes
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

    // Build summary for AI analysis
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

    // Call AI for predictive maintenance analysis
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
            content: `You are an expert in predictive maintenance for buildings and facilities. Analyze sensor data and equipment information to identify potential issues BEFORE they occur.

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
          },
          {
            role: "user",
            content: `Analyze this building data for predictive maintenance:\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
        max_tokens: 4000,
        temperature: 0.3,
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${aiResp.status}`);
    }

    const aiResult = await aiResp.json();
    const content = aiResult.choices?.[0]?.message?.content || "";

    // Parse JSON from AI response
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
