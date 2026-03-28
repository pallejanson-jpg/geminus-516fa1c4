import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

const MAX_TOOL_ROUNDS = 2;
const AI_MODEL_PRIMARY = "google/gemini-3-flash-preview";
const AI_MODEL_FALLBACK = "google/gemini-2.5-flash-lite";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/* ─────────────────────────────────────────────
   Tool definitions — 5 RPC + utility tools + format_response
   ───────────────────────────────────────────── */

const tools = [
  {
    type: "function",
    function: {
      name: "get_assets_by_system",
      description: "Find assets by system/asset_type (e.g. ventilation, el, sprinkler, IfcAlarm). Returns up to 200 assets.",
      parameters: {
        type: "object",
        properties: {
          system_query: { type: "string", description: "System or asset_type to search (e.g. 'ventilation', 'IfcAlarm', 'pump')" },
          building_guid: { type: "string", description: "Optional building fm_guid to scope query" },
        },
        required: ["system_query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_assets_in_room",
      description: "Get all assets in a specific room by room fm_guid.",
      parameters: {
        type: "object",
        properties: {
          room_guid: { type: "string", description: "The room's fm_guid" },
        },
        required: ["room_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_assets_by_category",
      description: "Find assets by category (Building, Building Storey, Space, Instance, Door).",
      parameters: {
        type: "object",
        properties: {
          cat: { type: "string", description: "Category to filter (e.g. 'Space', 'Instance')" },
          building_guid: { type: "string", description: "Optional building fm_guid to scope query" },
        },
        required: ["cat"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_assets",
      description: "Free-text search across asset names, common_names, and asset_types. Returns up to 200 matches.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Search term" },
          building_guid: { type: "string", description: "Optional building fm_guid to scope query" },
        },
        required: ["search"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_viewer_entities",
      description: "Resolve asset fm_guids to xeokit external_entity_ids for 3D viewer visualization. ALWAYS call this when the user wants to see/highlight/show assets in the viewer.",
      parameters: {
        type: "object",
        properties: {
          asset_ids: { type: "array", items: { type: "string" }, description: "Array of asset fm_guids to resolve" },
        },
        required: ["asset_ids"],
        additionalProperties: false,
      },
    },
  },
  // ── Utility tools (kept from original) ──
  {
    type: "function",
    function: {
      name: "resolve_building_by_name",
      description: "Find a building by name or partial name. Returns fm_guid(s). Use when user mentions a building by name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Building name or partial name" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_buildings",
      description: "List all buildings. Use when user asks 'what buildings do I have?'",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results (default 50)" },
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
      description: "Comprehensive building overview: floors, rooms, assets, area, issues.",
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
  // ── IoT / Sensor tools ──
  {
    type: "function",
    function: {
      name: "get_sensors_in_room",
      description: "Find sensors by type (temperature, co2, humidity, IfcSensor, IfcAlarm) in a specific room. Returns sensor assets with their attributes.",
      parameters: {
        type: "object",
        properties: {
          sensor_type: { type: "string", description: "Sensor type to search (e.g. 'temperature', 'co2', 'humidity', 'IfcSensor')" },
          room_guid: { type: "string", description: "The room's fm_guid" },
        },
        required: ["sensor_type", "room_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_latest_sensor_values",
      description: "Get latest sensor readings (temperature, CO2, humidity, value, unit, status) for given sensor asset fm_guids.",
      parameters: {
        type: "object",
        properties: {
          sensor_ids: { type: "array", items: { type: "string" }, description: "Array of sensor asset fm_guids" },
        },
        required: ["sensor_ids"],
        additionalProperties: false,
      },
    },
  },
  // ── Final structured response tool ──
  {
    type: "function",
    function: {
      name: "format_response",
      description: "ALWAYS call this as your LAST tool call. The chat message is the PRIMARY output. Include 2-3 buttons (clickable actions) and 2-3 suggestions (follow-up questions). Default action is 'none'. Only use viewer actions when user EXPLICITLY asks.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Short answer (max 2-3 sentences). Concrete, no fluff." },
          response_type: { type: "string", enum: ["answer", "navigation", "data_query", "action"], description: "Type of response: answer=general info, navigation=movement in building, data_query=data retrieval, action=trigger function" },
          action: { type: "string", enum: ["highlight", "filter", "colorize", "list", "none"], description: "Default 'none'. Only 'highlight'/'filter'/'colorize' when user explicitly asks." },
          buttons: { type: "array", items: { type: "string" }, description: "2-3 clickable ACTION buttons like 'Visa i modell', 'Filtrera dörrar', 'Byggnadsöversikt'. Must be concrete actions, never vague." },
          suggestions: { type: "array", items: { type: "string" }, description: "2-3 proactive follow-up questions like 'Vill du se våningar?', 'Ska vi filtrera på system?'" },
          asset_ids: { type: "array", items: { type: "string" }, description: "Asset fm_guids found" },
          external_entity_ids: { type: "array", items: { type: "string" }, description: "xeokit entity IDs for viewer (from get_viewer_entities)" },
          filters: {
            type: "object",
            properties: {
              system: { type: "string" },
              category: { type: "string" },
              room: { type: "string" },
            },
            additionalProperties: false,
          },
          sensor_data: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entity_id: { type: "string", description: "xeokit external_entity_id" },
                value: { type: "number" },
                type: { type: "string", description: "temperature, co2, humidity" },
                unit: { type: "string" },
                status: { type: "string", enum: ["normal", "warning", "critical"] },
              },
            },
            description: "Sensor readings mapped to viewer entities",
          },
          color_map: {
            type: "object",
            additionalProperties: {
              type: "array",
              items: { type: "number" },
              description: "RGB color [r, g, b] where each value is 0-1",
            },
            description: "Map of external_entity_id to RGB color for colorize action. Green=[0,0.8,0.2], Yellow=[1,0.9,0], Red=[1,0.2,0.1]",
          },
        },
        required: ["message", "action", "buttons", "suggestions"],
        additionalProperties: false,
      },
    },
  },
  // ── Adaptive Memory ──
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save a user instruction, correction, or preference. Use when user says 'remember', 'kom ihåg'.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
          memory_type: { type: "string", enum: ["instruction", "correction", "preference"] },
          building_fm_guid: { type: "string" },
        },
        required: ["content", "memory_type"],
        additionalProperties: false,
      },
    },
  },
];

/* ─────────────────────────────────────────────
   Tool execution — RPC-based
   ───────────────────────────────────────────── */

async function executeTool(supabase: any, name: string, args: any, apiKey?: string) {
  switch (name) {
    case "get_assets_by_system": {
      const { data, error } = await supabase.rpc("get_assets_by_system", {
        system_query: args.system_query,
        building_guid: args.building_guid || null,
      });
      if (error) throw error;
      return data || [];
    }
    case "get_assets_in_room": {
      const { data, error } = await supabase.rpc("get_assets_in_room", {
        room_guid: args.room_guid,
      });
      if (error) throw error;
      return data || [];
    }
    case "get_assets_by_category": {
      const { data, error } = await supabase.rpc("get_assets_by_category", {
        cat: args.cat,
        building_guid: args.building_guid || null,
      });
      if (error) throw error;
      return data || [];
    }
    case "search_assets": {
      const { data, error } = await supabase.rpc("search_assets_rpc", {
        search: args.search,
        building_guid: args.building_guid || null,
      });
      if (error) throw error;
      return data || [];
    }
    case "get_viewer_entities": {
      const { data, error } = await supabase.rpc("get_viewer_entities", {
        asset_ids: args.asset_ids || [],
      });
      if (error) throw error;
      return data || [];
    }
    case "resolve_building_by_name":
      return execResolveBuildingByName(supabase, args);
    case "list_buildings":
      return execListBuildings(supabase, args);
    case "get_building_summary":
      return execBuildingSummary(supabase, args);
    case "get_sensors_in_room": {
      const { data, error } = await supabase.rpc("get_sensors_in_room", {
        sensor_type: args.sensor_type,
        room_guid: args.room_guid,
      });
      if (error) throw error;
      return data || [];
    }
    case "get_latest_sensor_values": {
      const { data, error } = await supabase.rpc("get_latest_sensor_values", {
        sensor_ids: args.sensor_ids || [],
      });
      if (error) throw error;
      return data || [];
    }
    case "format_response": {
      // Auto-resolve viewer entities from asset_ids if external_entity_ids not provided
      if (args.asset_ids?.length && (!args.external_entity_ids || args.external_entity_ids.length === 0)) {
        try {
          const { data } = await supabase.rpc("get_viewer_entities", { asset_ids: args.asset_ids });
          if (data?.length) {
            args.external_entity_ids = data.map((e: any) => e.external_entity_id).filter(Boolean);
          }
        } catch (e) { console.error("Auto-resolve entities failed:", e); }
      }
      return { formatted: true, ...args };
    }
    case "save_memory":
      return execSaveMemory(supabase, args, (globalThis as any).__currentUserId);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/* ─────────────────────────────────────────────
   Utility tool implementations (kept from original)
   ───────────────────────────────────────────── */

async function execResolveBuildingByName(supabase: any, args: any) {
  const searchName = `%${args.name}%`;
  const { data: buildings, error } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name, building_fm_guid, attributes")
    .eq("category", "Building")
    .or(`common_name.ilike.${searchName},name.ilike.${searchName}`)
    .limit(10);
  if (error) throw error;
  if (!buildings?.length) {
    const { data: allBuildings } = await supabase
      .from("assets")
      .select("fm_guid, name, common_name")
      .eq("category", "Building")
      .limit(50);
    return {
      found: false,
      message: `No building matching "${args.name}" found.`,
      available_buildings: (allBuildings || []).map((b: any) => ({
        fm_guid: b.fm_guid,
        name: b.common_name || b.name,
      })),
    };
  }
  return {
    found: true,
    buildings: buildings.map((b: any) => ({
      fm_guid: b.fm_guid,
      name: b.common_name || b.name,
      building_fm_guid: b.building_fm_guid || b.fm_guid,
    })),
  };
}

async function execListBuildings(supabase: any, args: any) {
  const limit = args.limit || 50;
  const { data, error } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name")
    .eq("category", "Building")
    .order("common_name", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const seen = new Map<string, string>();
  for (const b of data || []) {
    if (b.fm_guid && !seen.has(b.fm_guid)) {
      seen.set(b.fm_guid, b.common_name || b.name || b.fm_guid);
    }
  }
  return {
    total: seen.size,
    buildings: Array.from(seen, ([fm_guid, name]) => ({ fm_guid, name })),
  };
}

async function execBuildingSummary(supabase: any, args: any) {
  const fmGuid = args.fm_guid;
  const [assets, issues, buildingRow, floors] = await Promise.all([
    supabase.from("assets").select("category, gross_area, asset_type").eq("building_fm_guid", fmGuid),
    supabase.from("bcf_issues").select("status, priority").eq("building_fm_guid", fmGuid),
    supabase.from("assets").select("common_name, name, gross_area, attributes").eq("fm_guid", fmGuid).maybeSingle(),
    supabase.from("assets").select("fm_guid, common_name, name").eq("building_fm_guid", fmGuid).eq("category", "Building Storey").order("name"),
  ]);
  const cats: Record<string, number> = {};
  const assetTypes: Record<string, number> = {};
  let totalArea = 0;
  (assets.data || []).forEach((a: any) => {
    cats[a.category] = (cats[a.category] || 0) + 1;
    if (a.category === "Space" && a.gross_area) totalArea += Number(a.gross_area);
    if (a.category === "Instance" && a.asset_type) assetTypes[a.asset_type] = (assetTypes[a.asset_type] || 0) + 1;
  });
  const issuesByStatus: Record<string, number> = {};
  (issues.data || []).forEach((i: any) => { issuesByStatus[i.status] = (issuesByStatus[i.status] || 0) + 1; });
  const topAssetTypes = Object.entries(assetTypes).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, count]) => ({ type, count }));
  return {
    building_name: buildingRow.data?.common_name || buildingRow.data?.name || fmGuid,
    building_fm_guid: fmGuid,
    floors_count: cats["Building Storey"] || 0,
    floors: (floors.data || []).map((f: any) => ({ fm_guid: f.fm_guid, name: f.common_name || f.name })),
    rooms: cats["Space"] || 0,
    assets: cats["Instance"] || 0,
    doors: cats["Door"] || 0,
    total_space_area_m2: Math.round(totalArea * 100) / 100,
    issues_by_status: issuesByStatus,
    total_issues: (issues.data || []).length,
    top_asset_types: topAssetTypes,
  };
}

/* ── Adaptive Memory ── */

async function execSaveMemory(supabase: any, args: any, userId: string) {
  if (!userId) return { error: "No user context" };
  const { error } = await supabase.from("ai_memory").insert({
    user_id: userId,
    content: args.content,
    memory_type: args.memory_type || "instruction",
    building_fm_guid: args.building_fm_guid || null,
  });
  if (error) throw error;
  return { success: true, message: "Memory saved" };
}

async function loadUserMemories(supabase: any, userId: string, buildingFmGuid?: string): Promise<string> {
  let query = supabase
    .from("ai_memory")
    .select("content, memory_type, building_fm_guid")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (buildingFmGuid) {
    query = query.or(`building_fm_guid.is.null,building_fm_guid.eq.${buildingFmGuid}`);
  } else {
    query = query.is("building_fm_guid", null);
  }
  const { data } = await query;
  if (!data?.length) return "";
  const now = new Date();
  const valid = data.filter((m: any) => !m.expires_at || new Date(m.expires_at) > now);
  if (!valid.length) return "";
  const lines = valid.map((m: any) => {
    const prefix = m.memory_type === "correction" ? "⚠️" : m.memory_type === "preference" ? "🎯" : "📝";
    return `${prefix} ${m.content}`;
  });
  return `\n\nLEARNED CONTEXT (user preferences & corrections — ALWAYS respect these):\n${lines.join("\n")}`;
}

/* ─────────────────────────────────────────────
   Conversation memory
   ───────────────────────────────────────────── */

async function loadRecentConversation(supabase: any, userId: string, buildingFmGuid?: string) {
  let query = supabase
    .from("gunnar_conversations")
    .select("messages, summary, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (buildingFmGuid) {
    query = query.eq("building_fm_guid", buildingFmGuid);
  } else {
    query = query.is("building_fm_guid", null);
  }
  const { data } = await query;
  if (data?.[0]) {
    const age = Date.now() - new Date(data[0].updated_at).getTime();
    if (age < 24 * 60 * 60 * 1000) return data[0];
  }
  return null;
}

async function saveConversation(supabase: any, userId: string, buildingFmGuid: string | null, messages: any[]) {
  const recentMessages = messages.slice(-12).map((m: any) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content.slice(0, 500) : "",
  }));
  let lookupQuery = supabase
    .from("gunnar_conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (buildingFmGuid) {
    lookupQuery = lookupQuery.eq("building_fm_guid", buildingFmGuid);
  } else {
    lookupQuery = lookupQuery.is("building_fm_guid", null);
  }
  const { data: existing } = await lookupQuery;
  if (existing?.[0]) {
    await supabase
      .from("gunnar_conversations")
      .update({ messages: recentMessages, updated_at: new Date().toISOString() })
      .eq("id", existing[0].id);
  } else {
    await supabase
      .from("gunnar_conversations")
      .insert({
        user_id: userId,
        building_fm_guid: buildingFmGuid || null,
        messages: recentMessages,
      });
  }
}

/* ─────────────────────────────────────────────
   Intent router — fast-path for simple intents
   ───────────────────────────────────────────── */

interface FastPathResult {
  message: string;
  action: string;
  asset_ids: string[];
  external_entity_ids: string[];
  filters: Record<string, string>;
  suggestions: string[];
  sensor_data?: any[];
  color_map?: Record<string, [number, number, number]>;
}

function detectSimpleIntent(messages: any[]): string | null {
  if (!messages.length) return null;
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "user") return null;
  const text = lastMsg.content.toLowerCase().trim();
  if (/^(hej|hallå|tja|tjena|hi|hello|hey|god\s*(morgon|kväll|dag)|good\s*(morning|evening|day))[\s!.]*$/i.test(text)) return "greeting";
  if (/^(tack|thanks|thank\s*you|tackar)[\s!.]*$/i.test(text)) return "thanks";
  if (/^(hjälp|help|vad kan du|what can you do)[\s?!.]*$/i.test(text)) return "help";
  return null;
}

/** Detect viewer-centric intents that can be served via direct RPC */
function detectViewerIntent(messages: any[], context: any): { type: string; params: Record<string, string>; wantsViewer: boolean } | null {
  if (!messages.length) return null;
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "user") return null;
  const text = lastMsg.content.toLowerCase().trim();
  const buildingGuid = context?.currentBuilding?.fmGuid;

  // Detect if user explicitly wants viewer action
  const viewerKeywords = /(visa\s+i\s+(viewern|3d)|markera|highlight|show\s+in\s+(viewer|3d)|färglägg|colorize)/i;
  const wantsViewer = viewerKeywords.test(text);

  // "visa ventilation" / "show HVAC" / "hur många ventilationsaggregat"
  const systemMatch = text.match(/^(visa|show|markera|highlight|filtrera|filter|hur\s+många|how\s+many|vilka|which|finns\s+det)\s+(.+)$/i);
  if (systemMatch && buildingGuid) {
    const systemQuery = systemMatch[2].replace(/\s*(i viewern|in viewer|i 3d|finns|finns det|har vi)\s*/gi, "").trim();
    if (systemQuery.length >= 2 && systemQuery.length <= 50) {
      return { type: "show_system", params: { system: systemQuery, building_guid: buildingGuid }, wantsViewer };
    }
  }

  // "vad finns i rummet" / "objekt i rummet"
  if (context?.currentSpace?.fmGuid && /^(vad finns|objekt|assets|utrustning)\s*(i|in)\s*(rummet|detta rum|this room|the room)/i.test(text)) {
    return { type: "room_assets", params: { room_guid: context.currentSpace.fmGuid }, wantsViewer };
  }

  // "byggnadsöversikt" / "building overview"
  if (buildingGuid && /^(byggnadsöversikt|översikt|building overview|overview|sammanfattning|summary)/i.test(text)) {
    return { type: "building_summary", params: { fm_guid: buildingGuid }, wantsViewer: false };
  }

  return null;
}

/** Execute fast-path intent via direct RPC — chat-first, viewer only when explicitly requested */
async function executeFastPath(supabase: any, intent: { type: string; params: Record<string, string>; wantsViewer: boolean }, context: any): Promise<FastPathResult | null> {
  const buildingName = context?.currentBuilding?.name || "byggnaden";

  switch (intent.type) {
    case "show_system": {
      const { data: assets } = await supabase.rpc("get_assets_by_system", {
        system_query: intent.params.system,
        building_guid: intent.params.building_guid || null,
      });
      const assetList = assets || [];
      if (assetList.length === 0) {
        return {
          message: `Inga "${intent.params.system}"-objekt hittades i ${buildingName}.`,
          action: "none", asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [`Visa alla tillgångar`, `Sök efter annan utrustning`, `Byggnadsöversikt`],
        };
      }
      const assetIds = assetList.map((a: any) => a.fm_guid);

      // Build informative text summary
      const types: Record<string, number> = {};
      assetList.forEach((a: any) => { const t = a.asset_type || a.common_name || "okänd"; types[t] = (types[t] || 0) + 1; });
      const typeSummary = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${n}× ${t}`).join(", ");

      if (intent.wantsViewer) {
        // User explicitly wants viewer action
        let entityIds: string[] = [];
        try {
          const { data: entities } = await supabase.rpc("get_viewer_entities", { asset_ids: assetIds });
          entityIds = (entities || []).map((e: any) => e.external_entity_id).filter(Boolean);
        } catch (_) {}
        return {
          message: `Hittade **${assetList.length}** ${intent.params.system}-objekt i ${buildingName}: ${typeSummary}.${entityIds.length > 0 ? ` Markerar ${entityIds.length} i viewern.` : ""}`,
          action: entityIds.length > 0 ? "highlight" : "list",
          asset_ids: assetIds.slice(0, 50), external_entity_ids: entityIds,
          filters: { system: intent.params.system },
          suggestions: [`Hur många rum har ${intent.params.system}?`, `Byggnadsöversikt`, `Sök annan utrustning`],
        };
      }
      // Chat-first: just answer the question
      return {
        message: `Det finns **${assetList.length}** ${intent.params.system}-objekt i ${buildingName}.\n\nFördelning: ${typeSummary}.`,
        action: "none", asset_ids: assetIds.slice(0, 50), external_entity_ids: [], filters: {},
        suggestions: [`Markera ${intent.params.system} i viewern`, `Vilka rum har ${intent.params.system}?`, `Byggnadsöversikt`],
      };
    }
    case "room_assets": {
      const { data: assets } = await supabase.rpc("get_assets_in_room", { room_guid: intent.params.room_guid });
      const assetList = assets || [];
      const roomName = context?.currentSpace?.name || "rummet";
      if (assetList.length === 0) {
        return {
          message: `Inga tillgångar registrerade i ${roomName}.`,
          action: "none", asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [`Visa ventilation i ${buildingName}`, `Byggnadsöversikt`, `Sök efter utrustning`],
        };
      }
      const assetIds = assetList.map((a: any) => a.fm_guid);
      const cats: Record<string, number> = {};
      assetList.forEach((a: any) => { cats[a.category] = (cats[a.category] || 0) + 1; });
      const catSummary = Object.entries(cats).map(([c, n]) => `${n} ${c}`).join(", ");

      if (intent.wantsViewer) {
        let entityIds: string[] = [];
        try {
          const { data: entities } = await supabase.rpc("get_viewer_entities", { asset_ids: assetIds });
          entityIds = (entities || []).map((e: any) => e.external_entity_id).filter(Boolean);
        } catch (_) {}
        return {
          message: `**${assetList.length}** objekt i ${roomName}: ${catSummary}.${entityIds.length > 0 ? ` Markerar ${entityIds.length} i viewern.` : ""}`,
          action: entityIds.length > 0 ? "highlight" : "list",
          asset_ids: assetIds.slice(0, 50), external_entity_ids: entityIds,
          filters: { room: intent.params.room_guid },
          suggestions: [`Visa ventilation i ${roomName}`, `Byggnadsöversikt`, `Visa alla rum`],
        };
      }
      return {
        message: `I ${roomName} finns **${assetList.length}** objekt: ${catSummary}.`,
        action: "none", asset_ids: assetIds.slice(0, 50), external_entity_ids: [], filters: {},
        suggestions: [`Markera objekten i viewern`, `Visa ventilation i ${roomName}`, `Byggnadsöversikt`],
      };
    }
    case "building_summary": {
      const summary = await execBuildingSummary(supabase, { fm_guid: intent.params.fm_guid });
      return {
        message: `**${summary.building_name}**\n\n• ${summary.floors_count} våningar, ${summary.rooms} rum, ${summary.assets} tillgångar\n• Total yta: ${summary.total_space_area_m2} m²\n• ${summary.total_issues} ärenden${summary.total_issues > 0 ? ` (${Object.entries(summary.issues_by_status).map(([s, n]) => `${n} ${s}`).join(", ")})` : ""}`,
        action: "none", asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: [`Visa ventilation`, `Visa alla rum`, `Visa öppna ärenden`],
      };
    }
    default:
      return null;
  }
}

function getSimpleIntentResponse(intent: string, text: string): any {
  const isSv = /^(hej|hallå|tja|tjena|tack|hjälp|god)/i.test(text);
  let message = "";
  let suggestions: string[] = [];
  switch (intent) {
    case "greeting":
      message = isSv ? "Hej! Hur kan jag hjälpa dig idag?" : "Hello! How can I help you today?";
      suggestions = isSv ? ["Visa ventilation", "Byggnadsöversikt", "Vad finns i rummet?"] : ["Show HVAC", "Building overview", "What's in this room?"];
      break;
    case "thanks":
      message = isSv ? "Varsågod! Finns det något mer jag kan hjälpa dig med?" : "You're welcome! Is there anything else I can help with?";
      suggestions = isSv ? ["Visa alla tillgångar", "Byggnadsöversikt", "Sök utrustning"] : ["Show all assets", "Building overview", "Search equipment"];
      break;
    case "help":
      message = isSv
        ? "Jag kan hjälpa dig med:\n\n• **Byggnadsdata** — våningar, rum, ytor, utrustning\n• **System** — ventilation, el, VVS\n• **3D-navigering** — visa och markera objekt i viewern\n• **Sökning** — hitta specifika tillgångar\n\nVad vill du veta mer om?"
        : "I can help you with:\n\n• **Building data** — floors, rooms, areas, equipment\n• **Systems** — ventilation, electrical, HVAC\n• **3D navigation** — show and highlight objects in the viewer\n• **Search** — find specific assets\n\nWhat would you like to know?";
      suggestions = isSv ? ["Visa ventilation", "Byggnadsöversikt", "Sök utrustning"] : ["Show HVAC", "Building overview", "Search equipment"];
      break;
  }
  return { message, action: "none", asset_ids: [], external_entity_ids: [], filters: {}, suggestions };
}

/* ─────────────────────────────────────────────
   System prompt — structured output focused
   ───────────────────────────────────────────── */

async function buildSystemPrompt(supabase: any, context: any, userProfile: any, previousConversation: any) {
  let modelsCtx = "";
  const bGuid = context?.currentBuilding?.fmGuid;
  if (bGuid) {
    try {
      const { data: models } = await supabase
        .from("xkt_models")
        .select("model_id, model_name, file_name")
        .eq("building_fm_guid", bGuid)
        .eq("is_chunk", false)
        .order("model_name")
        .limit(20);
      if (models?.length) {
        modelsCtx = `\nBIM MODELS for current building:\n${models.map((m: any) => `  - "${m.model_name || m.file_name}" (model_id: ${m.model_id})`).join("\n")}`;
      }
    } catch (e) { console.error("Failed to fetch models:", e); }
  }

  let ctx = "";
  if (context?.currentBuilding) ctx += `\nCurrent building: "${context.currentBuilding.name}" (fm_guid: ${context.currentBuilding.fmGuid}). Default queries to this building.`;
  if (context?.currentStorey) ctx += `\nActive floor: "${context.currentStorey.name}" (fm_guid: ${context.currentStorey.fmGuid})`;
  if (context?.currentSpace) ctx += `\nActive room: "${context.currentSpace.name}" (fm_guid: ${context.currentSpace.fmGuid})`;
  if (context?.activeApp) ctx += `\nActive app: ${context.activeApp}`;

  let userCtx = "";
  if (userProfile) {
    userCtx = `\nUser: ${userProfile.display_name || "user"} (${userProfile.role || "user"})`;
  }

  let memoryCtx = "";
  if (previousConversation?.messages?.length) {
    const msgs = previousConversation.messages
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .slice(-4)
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n");
    memoryCtx = `\nPrevious conversation:\n${msgs}`;
  }

  return `You are Geminus AI, a structured assistant for digital twin / BIM applications. You have access to building data and can optionally control a 3D xeokit viewer.

CRITICAL — CHAT-FIRST PRINCIPLE:
Your PRIMARY output is the chat message. Always give a complete, informative text answer.
Viewer actions (highlight, filter, colorize) are SECONDARY and should ONLY be used when:
- The user EXPLICITLY asks to "visa i viewern", "markera", "highlight", "show in 3D", "färglägg"
- NOT by default. Most questions should be answered with action="none" or action="list".

CORE RULES:
1. ALWAYS use tools to get data — never guess or fabricate.
2. Use the appropriate RPC tool: get_assets_by_system, get_assets_in_room, get_assets_by_category, or search_assets.
3. You do NOT need to call get_viewer_entities separately — format_response auto-resolves.
4. ALWAYS end with format_response as your LAST tool call.
5. If no results found, explain in the message and return empty arrays.
6. Respond in the SAME LANGUAGE as the user.
7. NEVER show UUIDs/GUIDs to the user in the message text.
8. Do NOT hallucinate system names, asset types, or relationships.
9. Max 200 assets per query — enforced server-side.
10. MINIMIZE tool rounds — call data tool AND format_response in the SAME round when possible.

ACTION TYPES for format_response:
- "none" — DEFAULT. Answer the question in chat text only.
- "list" — Display data as a list in chat, no viewer action.
- "highlight" — ONLY when user explicitly asks to show/mark in viewer.
- "filter" — ONLY when user explicitly asks to filter in viewer.
- "colorize" — ONLY when user explicitly asks to color-code in viewer.

EXAMPLES:
User: "hur många ventilationsaggregat finns?" → get_assets_by_system("ventilation") → format_response(action="none", message="Det finns 42 ventilationsaggregat...")
User: "visa ventilation i viewern" → get_assets_by_system("ventilation") → format_response(action="highlight", asset_ids=[...])
User: "markera alla brandlarm" → get_assets_by_system("IfcAlarm") → format_response(action="highlight", asset_ids=[...])
User: "vilka pumpar finns?" → search_assets("pump") → format_response(action="list", message="Hittade 5 pumpar: ...")
User: "vad är temperaturen i rummet?" → get_sensors_in_room → get_latest_sensor_values → format_response(action="none", message="Temperaturen är 22.3°C...")
User: "visa temperaturen i viewern" → same sensors → format_response(action="colorize", color_map={...})

IoT / SENSOR DATA:
- When user asks about temperature, CO2, humidity:
  1. get_sensors_in_room(sensor_type, room_guid)
  2. get_latest_sensor_values(sensor_ids)
  3. format_response — use action="none" by default, "colorize" only if user asks to show in viewer

INTERACTION STYLE:
1. Give complete answers in the chat message — this is the primary output.
2. Suggest 2-3 relevant follow-up questions.
3. Be concise, friendly, and actionable.
4. MINIMIZE rounds — combine data retrieval and format_response in the SAME round.
${userCtx}${ctx}${modelsCtx}${memoryCtx}`;
}

/* ─────────────────────────────────────────────
   AI API call helper with fallback
   ───────────────────────────────────────────── */

async function callAI(apiKey: string, messages: any[], options: { stream?: boolean; tools?: any[]; tool_choice?: string; model?: string } = {}) {
  const model = options.model || AI_MODEL_PRIMARY;
  const body: any = { model, messages, stream: options.stream ?? false };
  if (options.tools) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice || "auto";
  }
  const resp = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error(`AI call error (${model}):`, resp.status, t);
    if (resp.status >= 500 && model === AI_MODEL_PRIMARY) {
      console.log("Falling back to", AI_MODEL_FALLBACK);
      return callAI(apiKey, messages, { ...options, model: AI_MODEL_FALLBACK });
    }
    if (resp.status === 429) throw { status: 429, message: "Rate limit exceeded. Please try again in a moment." };
    if (resp.status === 402) throw { status: 402, message: "AI credits exhausted." };
    throw new Error(`AI gateway error: ${resp.status}`);
  }
  return resp;
}

/** Generate fallback suggestions when AI doesn't provide them */
function generateFallbackSuggestions(result: any, context: any): string[] {
  const buildingName = context?.currentBuilding?.name;
  const hasAssets = result?.asset_ids?.length > 0;
  const action = result?.action || "none";

  if (action === "highlight" || action === "filter") {
    return [
      buildingName ? `Byggnadsöversikt för ${buildingName}` : "Byggnadsöversikt",
      "Visa ventilation",
      "Sök efter utrustning",
    ];
  }
  if (action === "colorize") {
    return [
      "Visa temperatur i fler rum",
      "Byggnadsöversikt",
      "Visa alla sensorer",
    ];
  }
  return [
    buildingName ? `Visa ventilation i ${buildingName}` : "Visa ventilation",
    "Byggnadsöversikt",
    "Sök utrustning",
  ];
}

/* ─────────────────────────────────────────────
   Main handler
   ───────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  try {
    const startTime = Date.now();
    const { messages, context, proactive } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userId = auth.userId!;
    (globalThis as any).__currentUserId = userId;

    const [profileResult, roleResult, previousConversation, userMemories] = await Promise.all([
      supabase.from("profiles").select("display_name, avatar_url").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      loadRecentConversation(supabase, userId, context?.currentBuilding?.fmGuid),
      loadUserMemories(supabase, userId, context?.currentBuilding?.fmGuid),
    ]);

    const userProfile = profileResult.data ? { ...profileResult.data, role: roleResult.data?.role || "user" } : null;

    // ── Proactive insights mode ──
    if (proactive && context?.currentBuilding) {
      const buildingGuid = context.currentBuilding.fmGuid;
      const buildingName = context.currentBuilding.name;
      const [openIssues] = await Promise.all([
        supabase.from("bcf_issues").select("title, priority, status", { count: "exact", head: false })
          .eq("building_fm_guid", buildingGuid).eq("status", "open").limit(5),
      ]);
      const insights: string[] = [];
      const issueCount = openIssues.data?.length || 0;
      if (issueCount > 0) {
        const highPriority = (openIssues.data || []).filter((i: any) => i.priority === "high" || i.priority === "critical");
        insights.push(highPriority.length > 0
          ? `⚠️ **${highPriority.length} high-priority issues** in ${buildingName}`
          : `📋 **${issueCount} open issues** in ${buildingName}`);
      }
      if (insights.length === 0) insights.push(`✅ No open issues in ${buildingName} right now.`);
      return new Response(JSON.stringify({ proactive_insights: insights }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── FAST-PATH: detect simple intents ──
    const simpleIntent = detectSimpleIntent(messages);
    if (simpleIntent) {
      const lastText = messages[messages.length - 1]?.content || "";
      const response = getSimpleIntentResponse(simpleIntent, lastText);
      console.log(`Fast-path intent: ${simpleIntent} (${Date.now() - startTime}ms)`);
      const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
      saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content: response.message }]).catch(e =>
        console.error("Failed to save conversation:", e)
      );
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── FAST-PATH: detect viewer intents (system/room/overview) ──
    const viewerIntent = detectViewerIntent(messages, context);
    if (viewerIntent) {
      try {
        const fastResult = await executeFastPath(supabase, viewerIntent, context);
        if (fastResult) {
          console.log(`Fast-path viewer intent: ${viewerIntent.type} (${Date.now() - startTime}ms)`);
          const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
          saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content: fastResult.message }]).catch(e =>
            console.error("Failed to save conversation:", e)
          );
          return new Response(JSON.stringify(fastResult), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.error("Fast-path viewer intent failed, falling back to AI:", e);
      }
    }

    // ── Full tool-calling loop ──
    let systemPrompt = await buildSystemPrompt(supabase, context, userProfile, previousConversation);
    if (userMemories) systemPrompt += userMemories;

    const conversation: any[] = [{ role: "system", content: systemPrompt }, ...messages];

    let formatResponseResult: any = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await callAI(LOVABLE_API_KEY, conversation, { tools, tool_choice: "auto" });
      const result = await resp.json();
      const choice = result.choices?.[0];

      if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
        // No tools — AI gave a direct text answer
        const content = choice?.message?.content || "";
        console.log(`Gunnar: direct answer (${Date.now() - startTime}ms, round ${round + 1})`);
        // Wrap in structured format
        const structuredResponse = {
          message: content,
          action: "none" as const,
          asset_ids: [],
          external_entity_ids: [],
          filters: {},
          suggestions: generateFallbackSuggestions({}, context),
        };
        const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
        saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content }]).catch(e =>
          console.error("Failed to save conversation:", e)
        );
        return new Response(JSON.stringify(structuredResponse), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const toolCalls = choice.message.tool_calls;
      console.log(`Gunnar round ${round + 1}: ${toolCalls.length} tool(s): ${toolCalls.map((tc: any) => tc.function.name).join(", ")} (${Date.now() - startTime}ms)`);

      conversation.push(choice.message);

      const toolResults = await Promise.all(
        toolCalls.map(async (tc: any) => {
          let args: any;
          try {
            args = typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments;
          } catch (parseErr) {
            console.error(`Tool ${tc.function.name} JSON parse error:`, parseErr);
            return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: `Invalid arguments` }) };
          }
          try {
            const result = await executeTool(supabase, tc.function.name, args, LOVABLE_API_KEY);
            // Capture format_response result
            if (tc.function.name === "format_response") {
              formatResponseResult = result;
            }
            return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify(result) };
          } catch (err) {
            console.error(`Tool ${tc.function.name} error:`, err);
            return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: String(err) }) };
          }
        })
      );

      conversation.push(...toolResults);

      // If format_response was called, we're done
      if (formatResponseResult) {
        console.log(`Gunnar: format_response received (${Date.now() - startTime}ms, round ${round + 1})`);
        const structured: any = {
          message: formatResponseResult.message || "",
          action: formatResponseResult.action || "none",
          asset_ids: formatResponseResult.asset_ids || [],
          external_entity_ids: formatResponseResult.external_entity_ids || [],
          filters: formatResponseResult.filters || {},
          suggestions: generateFallbackSuggestions(formatResponseResult, context),
        };
        if (formatResponseResult.sensor_data?.length) structured.sensor_data = formatResponseResult.sensor_data;
        if (formatResponseResult.color_map && Object.keys(formatResponseResult.color_map).length) structured.color_map = formatResponseResult.color_map;
        const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
        saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content: structured.message }]).catch(e =>
          console.error("Failed to save conversation:", e)
        );
        return new Response(JSON.stringify(structured), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Max rounds — return last content
    console.log(`Gunnar: max rounds reached (${Date.now() - startTime}ms)`);
    const fallback = {
      message: "Jag kunde inte slutföra sökningen. Försök med en mer specifik fråga.",
      action: "none",
      asset_ids: [],
      external_entity_ids: [],
      filters: {},
      suggestions: ["Visa ventilation", "Byggnadsöversikt", "Sök utrustning"],
    };
    return new Response(JSON.stringify(fallback), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("Gunnar chat error:", e);
    const status = e?.status || 500;
    const message = e?.message || (e instanceof Error ? e.message : "Unknown error");
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
