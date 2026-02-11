import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

/* ─────────────────────────────────────────────
   Tool definitions for the AI model
   ───────────────────────────────────────────── */

const tools = [
  {
    type: "function",
    function: {
      name: "query_assets",
      description: "Query assets from the database with optional filters. Returns a list of matching assets or a count. Categories: Building, Building Storey, Space, Instance, Door.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          category: { type: "string", description: "Filter by category (Building, Building Storey, Space, Instance, Door)" },
          level_fm_guid: { type: "string", description: "Filter by level/storey fm_guid" },
          in_room_fm_guid: { type: "string", description: "Filter by room fm_guid" },
          asset_type: { type: "string", description: "Filter by asset_type (e.g. brandsläckare)" },
          count_only: { type: "boolean", description: "If true, return only the count" },
          limit: { type: "number", description: "Max rows to return (default 50)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_work_orders",
      description: "Query work orders (felanmälningar/arbetsordrar) with optional filters.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          status: { type: "string", description: "Filter by status (open, in_progress, completed, closed)" },
          priority: { type: "string", description: "Filter by priority" },
          count_only: { type: "boolean", description: "If true, return only the count" },
          limit: { type: "number", description: "Max rows to return (default 20)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_issues",
      description: "Query BCF issues (ärenden/avvikelser) with optional filters.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          status: { type: "string", description: "Filter by status (open, in_progress, resolved, closed)" },
          priority: { type: "string", description: "Filter by priority (low, medium, high, critical)" },
          count_only: { type: "boolean", description: "If true, return only the count" },
          limit: { type: "number", description: "Max rows to return (default 20)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_building_summary",
      description: "Get a comprehensive overview of a building: floors, rooms, assets, total area, open issues, and open work orders.",
      parameters: {
        type: "object",
        properties: {
          fm_guid: { type: "string", description: "The building's fm_guid" },
        },
        required: ["fm_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_assets",
      description: "Free-text search across asset names, common names, and asset types. Use for finding specific items.",
      parameters: {
        type: "object",
        properties: {
          search_term: { type: "string", description: "Text to search for" },
          building_fm_guid: { type: "string", description: "Optionally limit search to a building" },
          limit: { type: "number", description: "Max rows (default 20)" },
        },
        required: ["search_term"],
        additionalProperties: false,
      },
    },
  },
];

/* ─────────────────────────────────────────────
   Tool execution functions
   ───────────────────────────────────────────── */

async function execQueryAssets(supabase: any, args: any) {
  let query = supabase.from("assets").select(
    args.count_only ? "*" : "fm_guid, name, common_name, category, asset_type, building_fm_guid, level_fm_guid, in_room_fm_guid, gross_area",
    args.count_only ? { count: "exact", head: true } : undefined
  );
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.category) query = query.eq("category", args.category);
  if (args.level_fm_guid) query = query.eq("level_fm_guid", args.level_fm_guid);
  if (args.in_room_fm_guid) query = query.eq("in_room_fm_guid", args.in_room_fm_guid);
  if (args.asset_type) query = query.ilike("asset_type", `%${args.asset_type}%`);
  if (!args.count_only) query = query.limit(args.limit || 50);

  const { data, count, error } = await query;
  if (error) throw error;
  return args.count_only ? { count } : data;
}

async function execQueryWorkOrders(supabase: any, args: any) {
  let query = supabase.from("work_orders").select(
    args.count_only ? "*" : "id, external_id, title, description, status, priority, category, building_name, space_name, assigned_to, reported_at, due_date",
    args.count_only ? { count: "exact", head: true } : undefined
  );
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.status) query = query.eq("status", args.status);
  if (args.priority) query = query.eq("priority", args.priority);
  if (!args.count_only) query = query.order("created_at", { ascending: false }).limit(args.limit || 20);

  const { data, count, error } = await query;
  if (error) throw error;
  return args.count_only ? { count } : data;
}

async function execQueryIssues(supabase: any, args: any) {
  let query = supabase.from("bcf_issues").select(
    args.count_only ? "*" : "id, title, description, status, priority, issue_type, building_name, created_at",
    args.count_only ? { count: "exact", head: true } : undefined
  );
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.status) query = query.eq("status", args.status);
  if (args.priority) query = query.eq("priority", args.priority);
  if (!args.count_only) query = query.order("created_at", { ascending: false }).limit(args.limit || 20);

  const { data, count, error } = await query;
  if (error) throw error;
  return args.count_only ? { count } : data;
}

async function execBuildingSummary(supabase: any, args: any) {
  const fmGuid = args.fm_guid;
  const [assets, workOrders, issues, buildingRow] = await Promise.all([
    supabase.from("assets").select("category, gross_area").eq("building_fm_guid", fmGuid),
    supabase.from("work_orders").select("status").eq("building_fm_guid", fmGuid),
    supabase.from("bcf_issues").select("status").eq("building_fm_guid", fmGuid),
    supabase.from("assets").select("common_name, name, gross_area").eq("fm_guid", fmGuid).maybeSingle(),
  ]);

  const cats: Record<string, number> = {};
  let totalArea = 0;
  (assets.data || []).forEach((a: any) => {
    cats[a.category] = (cats[a.category] || 0) + 1;
    if (a.category === "Space" && a.gross_area) totalArea += Number(a.gross_area);
  });

  const openWO = (workOrders.data || []).filter((w: any) => w.status === "open").length;
  const openIssues = (issues.data || []).filter((i: any) => i.status === "open").length;

  return {
    building_name: buildingRow.data?.common_name || buildingRow.data?.name || fmGuid,
    floors: cats["Building Storey"] || 0,
    rooms: cats["Space"] || 0,
    assets: cats["Instance"] || 0,
    doors: cats["Door"] || 0,
    total_space_area_m2: Math.round(totalArea * 100) / 100,
    open_work_orders: openWO,
    total_work_orders: (workOrders.data || []).length,
    open_issues: openIssues,
    total_issues: (issues.data || []).length,
  };
}

async function execSearchAssets(supabase: any, args: any) {
  const term = `%${args.search_term}%`;
  let query = supabase
    .from("assets")
    .select("fm_guid, name, common_name, category, asset_type, building_fm_guid, level_fm_guid, in_room_fm_guid")
    .or(`common_name.ilike.${term},name.ilike.${term},asset_type.ilike.${term}`);

  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  query = query.limit(args.limit || 20);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function executeTool(supabase: any, name: string, args: any) {
  switch (name) {
    case "query_assets": return execQueryAssets(supabase, args);
    case "query_work_orders": return execQueryWorkOrders(supabase, args);
    case "query_issues": return execQueryIssues(supabase, args);
    case "get_building_summary": return execBuildingSummary(supabase, args);
    case "search_assets": return execSearchAssets(supabase, args);
    default: return { error: `Unknown tool: ${name}` };
  }
}

/* ─────────────────────────────────────────────
   System prompt
   ───────────────────────────────────────────── */

function buildSystemPrompt(context: any) {
  let ctx = "";
  if (context?.currentBuilding) {
    ctx += `\nThe user is currently viewing building: "${context.currentBuilding.name}" (fm_guid: ${context.currentBuilding.fmGuid}). Default queries to this building unless the user asks about something else.`;
  }
  if (context?.currentStorey) {
    ctx += `\nActive storey: "${context.currentStorey.name}" (fm_guid: ${context.currentStorey.fmGuid})`;
  }
  if (context?.currentSpace) {
    ctx += `\nActive room: "${context.currentSpace.name}" (fm_guid: ${context.currentSpace.fmGuid})`;
  }
  if (context?.activeApp) {
    ctx += `\nActive app view: ${context.activeApp}`;
  }

  return `You are Gunnar, an intelligent property assistant for a facility management platform called Geminus.

You have access to tools that query the database. Use them to answer questions about buildings, rooms, assets, work orders, and issues. ALWAYS use tools to get data – never guess or make up numbers.

${ctx}

ASSET CATEGORIES in the database:
- "Building" – the building itself
- "Building Storey" – floors/levels
- "Space" – rooms
- "Instance" – equipment, furniture, installations
- "Door" – doors

GUIDELINES:
1. Answer in the same language as the user (Swedish or English).
2. When the user has an active building, scope queries to that building by default.
3. Be concise. Use markdown formatting: **bold** for key numbers, bullet lists for multiple items.
4. After every answer, suggest 2-3 relevant follow-up questions the user might want to ask. Write them as a numbered list at the very end of your response, prefixed with "**Förslag:**" or "**Suggestions:**".
5. When referencing specific assets, floors, or rooms, include ACTION BUTTONS so users can navigate directly. Use this exact syntax:
   [🔍 Show in 3D](action:flyTo:FM_GUID)  — fly the camera to an object
   [📍 Navigate](action:openViewer:FM_GUID) — open the 3D viewer for a building
   [🏢 Show floor](action:showFloor:FM_GUID) — switch to a specific floor
   [🔎 Find in tree](action:selectInTree:FM_GUID1,FM_GUID2) — highlight objects in navigator
   [📋 Switch to 2D](action:switchTo2D:) — switch viewer to 2D mode
   [🧊 Switch to 3D](action:switchTo3D:) — switch viewer to 3D mode
6. ALWAYS add action buttons when listing specific assets, rooms, or floors. For example: "Room **Kontor 201** [🔍 Show](action:flyTo:abc-123)"
7. When listing multiple items in a table or list, add an action button next to each one.`;
}

/* ─────────────────────────────────────────────
   Main handler
   ───────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const { messages, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const systemPrompt = buildSystemPrompt(context);

    // ── First call: let AI decide if it needs tools ──
    const firstResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools,
        tool_choice: "auto",
        stream: false,
      }),
    });

    if (!firstResp.ok) {
      const t = await firstResp.text();
      console.error("AI first call error:", firstResp.status, t);
      if (firstResp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (firstResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const firstResult = await firstResp.json();
    const firstChoice = firstResult.choices?.[0];

    // ── If no tool calls, stream the answer directly ──
    if (!firstChoice?.message?.tool_calls || firstChoice.message.tool_calls.length === 0) {
      // Re-call with streaming for a nice UX
      const streamResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          stream: true,
        }),
      });
      if (!streamResp.ok) throw new Error("Streaming call failed");
      return new Response(streamResp.body, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // ── Execute tool calls ──
    const toolCalls = firstChoice.message.tool_calls;
    console.log(`Gunnar: executing ${toolCalls.length} tool call(s)`, toolCalls.map((tc: any) => tc.function.name));

    const toolResults = await Promise.all(
      toolCalls.map(async (tc: any) => {
        const args = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
        try {
          const result = await executeTool(supabase, tc.function.name, args);
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          };
        } catch (err) {
          console.error(`Tool ${tc.function.name} error:`, err);
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content: JSON.stringify({ error: String(err) }),
          };
        }
      })
    );

    // ── Second call: stream the final answer with tool results ──
    const secondMessages = [
      { role: "system", content: systemPrompt },
      ...messages,
      firstChoice.message, // assistant message with tool_calls
      ...toolResults,
    ];

    const secondResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: secondMessages,
        stream: true,
      }),
    });

    if (!secondResp.ok) throw new Error("Second streaming call failed");

    return new Response(secondResp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Gunnar chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
