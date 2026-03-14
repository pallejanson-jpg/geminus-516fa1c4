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

    // Get rooms with sensor attributes for this building
    let query = supabase
      .from("assets")
      .select("fm_guid, name, common_name, attributes, category, in_room_fm_guid, level_fm_guid")
      .eq("building_fm_guid", buildingFmGuid)
      .in("category", ["IfcSpace", "IfcSensor", "IfcActuator", "IfcAlarm", "IfcUnitaryEquipment", "IfcFan", "IfcPump", "IfcBoiler", "IfcChiller"]);

    if (roomFmGuids?.length) {
      query = query.in("fm_guid", roomFmGuids);
    }

    const { data: assets, error: dbErr } = await query.limit(500);
    if (dbErr) throw dbErr;

    // Separate rooms and equipment
    const rooms = (assets || []).filter(a => a.category === "IfcSpace");
    const equipment = (assets || []).filter(a => a.category !== "IfcSpace");

    // Build summary for AI analysis
    const summary = {
      buildingFmGuid,
      totalRooms: rooms.length,
      totalEquipment: equipment.length,
      rooms: rooms.slice(0, 50).map(r => ({
        guid: r.fm_guid,
        name: r.name || r.common_name,
        attributes: r.attributes || {},
      })),
      equipment: equipment.slice(0, 100).map(e => ({
        guid: e.fm_guid,
        name: e.name || e.common_name,
        type: e.category,
        room: e.in_room_fm_guid,
        attributes: e.attributes || {},
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
            content: `Du är en expert på prediktivt underhåll för fastigheter. Analysera sensordata och utrustningsinformation för att identifiera potentiella problem INNAN de uppstår.

Svara ALLTID med ett JSON-objekt med denna struktur:
{
  "predictions": [
    {
      "equipmentGuid": "guid eller null",
      "roomGuid": "guid eller null",
      "riskLevel": "high" | "medium" | "low",
      "category": "hvac" | "electrical" | "plumbing" | "structural" | "fire_safety" | "other",
      "title": "Kort titel på svenska",
      "description": "Beskrivning av risken och rekommenderad åtgärd",
      "estimatedTimeToFailure": "t.ex. '2-4 veckor'",
      "confidence": 0.0-1.0
    }
  ],
  "overallRiskScore": 0-100,
  "summary": "Kort sammanfattning av byggnadens underhållsstatus"
}

Basera analysen på:
- Temperaturvärden utanför normala intervall (20-22°C ideal)
- CO2-nivåer > 1000 ppm (ventilationsproblem)
- Hög fuktighet > 60% (mögel/korrosionsrisk)
- Utrustningsålder och typ (äldre HVAC = högre risk)
- Mönster som tyder på försämring

Om data saknas, generera rimliga prediktioner baserat på utrustningstyper och rum.`,
          },
          {
            role: "user",
            content: `Analysera denna byggnadsdata för prediktivt underhåll:\n\n${JSON.stringify(summary, null, 2)}`,
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
      predictions = jsonMatch ? JSON.parse(jsonMatch[0]) : { predictions: [], overallRiskScore: 0, summary: "Kunde inte analysera data" };
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
