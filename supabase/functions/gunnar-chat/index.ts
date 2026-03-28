import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

const MAX_TOOL_ROUNDS = 3;
const AI_MODEL_PRIMARY = "google/gemini-3-flash-preview";
const AI_MODEL_FALLBACK = "google/gemini-2.5-flash-lite";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/* ─────────────────────────────────────────────
   Structured button type — replaces plain strings
   ───────────────────────────────────────────── */

interface ActionButton {
  label: string;
  action: string;
  payload?: Record<string, string>;
}

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
  // ── Utility tools ──
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
      description: "Find sensors by type (temperature, co2, humidity, IfcSensor, IfcAlarm) in a specific room.",
      parameters: {
        type: "object",
        properties: {
          sensor_type: { type: "string", description: "Sensor type to search" },
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
      description: "Get latest sensor readings for given sensor asset fm_guids.",
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
      description: "ALWAYS call this as your LAST tool call. The chat message is the PRIMARY output. Include 2-3 buttons and 2-3 suggestions. Default action is 'none'. Only use viewer actions when user EXPLICITLY asks.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Short answer (max 2-3 sentences). Concrete, no fluff." },
          response_type: { type: "string", enum: ["answer", "navigation", "data_query", "action"] },
          action: { type: "string", enum: ["highlight", "filter", "colorize", "list", "none"], description: "Default 'none'. Only viewer actions when explicitly asked." },
          buttons: { type: "array", items: { type: "string" }, description: "2-3 clickable ACTION buttons" },
          suggestions: { type: "array", items: { type: "string" }, description: "2-3 proactive follow-up questions" },
          asset_ids: { type: "array", items: { type: "string" } },
          external_entity_ids: { type: "array", items: { type: "string" } },
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
                entity_id: { type: "string" },
                value: { type: "number" },
                type: { type: "string" },
                unit: { type: "string" },
                status: { type: "string", enum: ["normal", "warning", "critical"] },
              },
            },
          },
          color_map: {
            type: "object",
            additionalProperties: {
              type: "array",
              items: { type: "number" },
            },
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
   Utility tool implementations
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
   Structured button helpers
   ───────────────────────────────────────────── */

function makeButtons(buttons: ActionButton[]): ActionButton[] {
  return buttons;
}

function defaultButtons(context: any): ActionButton[] {
  const buildingName = context?.currentBuilding?.name;
  return [
    { label: buildingName ? `Byggnadsöversikt ${buildingName}` : "Byggnadsöversikt", action: "building_summary" },
    { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } },
    { label: "Sök utrustning", action: "search_prompt" },
  ];
}

/** Convert AI string[] buttons to structured ActionButton[] */
function convertAiButtons(aiButtons: string[], context: any): ActionButton[] {
  if (!aiButtons?.length) return defaultButtons(context);
  return aiButtons.map(label => buttonFromLabel(label, context));
}

/** Map a button label text to a structured action */
function buttonFromLabel(label: string, context: any): ActionButton {
  const lower = label.toLowerCase().trim();
  const buildingGuid = context?.currentBuilding?.fmGuid;

  // Building overview
  if (/^byggnadsöversikt/i.test(lower) || /^(building\s+)?overview/i.test(lower) || /^översikt/i.test(lower) || /^sammanfattning/i.test(lower)) {
    return { label, action: "building_summary" };
  }

  // "Visa alla rum" / "Show all rooms"
  if (/^visa alla rum/i.test(lower) || /^show all rooms/i.test(lower)) {
    return { label, action: "category_query", payload: { category: "Space" } };
  }

  // "Visa alla tillgångar" / "Show all assets"
  if (/^visa alla tillgångar/i.test(lower) || /^show all assets/i.test(lower) || /^alla tillgångar/i.test(lower)) {
    return { label, action: "category_query", payload: { category: "Instance" } };
  }

  // "Visa alla system"
  if (/^visa alla system/i.test(lower) || /^show all systems/i.test(lower)) {
    return { label, action: "building_summary" };
  }

  // "Visa öppna ärenden" / "Open issues"
  if (/^(visa\s+)?(öppna\s+)?ärenden/i.test(lower) || /^open\s+issues/i.test(lower)) {
    return { label, action: "issue_query" };
  }

  // "Sök utrustning" / "Search equipment"
  if (/^sök/i.test(lower) || /^search/i.test(lower)) {
    return { label, action: "search_prompt" };
  }

  // "Visa X i modell" / "Show X in viewer"
  const viewerMatch = lower.match(/^visa\s+(.+?)\s+i\s+(modell|viewer|3d)/i);
  if (viewerMatch) {
    return { label, action: "viewer_highlight", payload: { system: viewerMatch[1] } };
  }

  // "Visa ventilation" / "Visa dörrar" etc
  const visaMatch = lower.match(/^(visa|show|markera|highlight|filtrera)\s+(.+)$/i);
  if (visaMatch) {
    const subject = visaMatch[2].trim();
    // Check if it's a known category
    const catMatch = matchCategory(subject);
    if (catMatch) return { label, action: "category_query", payload: { category: catMatch } };
    // Otherwise treat as system query
    return { label, action: "system_query", payload: { system: subject } };
  }

  // "Filtrera per våning" / "Filter by floor"
  if (/^filtrera\s+per\s+våning/i.test(lower) || /^filter\s+by\s+floor/i.test(lower)) {
    return { label, action: "floor_query" };
  }

  // "Visa detaljer" / "Show details"
  if (/^visa detaljer/i.test(lower) || /^show details/i.test(lower)) {
    return { label, action: "detail_view" };
  }

  // Fallback — send as free text to AI
  return { label, action: "free_text" };
}

function matchCategory(text: string): string | null {
  const lower = text.toLowerCase();
  const categoryMap: Record<string, string> = {
    "rum": "Space", "rooms": "Space", "alla rum": "Space",
    "dörrar": "Door", "dörr": "Door", "doors": "Door",
    "tillgångar": "Instance", "assets": "Instance", "alla tillgångar": "Instance",
    "våningar": "Building Storey", "floors": "Building Storey", "våning": "Building Storey",
  };
  return categoryMap[lower] || null;
}

/* ─────────────────────────────────────────────
   Intent router — fast-path for simple intents
   ───────────────────────────────────────────── */

interface FastPathResult {
  message: string;
  response_type: string;
  action: string;
  buttons: ActionButton[];
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
  if (/^(ja|ja\s*tack|okej|ok|japp|jepp|yes|yeah|sure|absolut|gärna|visst|precis|exakt|stämmer|korrekt)[\s!.]*$/i.test(text)) return "confirmation";
  return null;
}

/* ─────────────────────────────────────────────
   Button action detection — catches clicks on structured buttons
   ───────────────────────────────────────────── */

interface ButtonActionIntent {
  action: string;
  payload: Record<string, string>;
}

/** Check if the incoming message is a structured button action (JSON) or matches a known button label */
function detectButtonAction(messages: any[], context: any): ButtonActionIntent | null {
  if (!messages.length) return null;
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "user") return null;
  const text = lastMsg.content.trim();

  // Try to parse as JSON action (from structured button clicks)
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.action) {
        return { action: parsed.action, payload: parsed.payload || {} };
      }
    } catch { /* not JSON, continue */ }
  }

  // Match known button labels to actions (backwards compatibility with text buttons)
  const lower = text.toLowerCase();
  const buildingGuid = context?.currentBuilding?.fmGuid;

  // Exact or near-exact matches for common button texts
  if (/^byggnadsöversikt/i.test(lower)) return { action: "building_summary", payload: {} };
  if (/^visa alla rum$/i.test(lower) || /^show all rooms$/i.test(lower)) return { action: "category_query", payload: { category: "Space" } };
  if (/^visa alla tillgångar$/i.test(lower) || /^show all assets$/i.test(lower) || /^alla tillgångar$/i.test(lower)) return { action: "category_query", payload: { category: "Instance" } };
  if (/^visa alla system$/i.test(lower) || /^show all systems$/i.test(lower) || /^vilka system finns/i.test(lower)) return { action: "building_summary", payload: {} };
  if (/^visa (öppna\s+)?ärenden$/i.test(lower) || /^öppna ärenden$/i.test(lower) || /^open issues$/i.test(lower)) return { action: "issue_query", payload: {} };
  if (/^sök utrustning$/i.test(lower) || /^search equipment$/i.test(lower)) return { action: "search_prompt", payload: {} };
  if (/^visa ventilation$/i.test(lower) || /^show hvac$/i.test(lower)) return { action: "system_query", payload: { system: "ventilation" } };
  if (/^visa våningar$/i.test(lower) || /^show floors$/i.test(lower)) return { action: "floor_list", payload: {} };
  if (/^filtrera per våning$/i.test(lower)) return { action: "floor_query", payload: {} };
  if (/^visa detaljer$/i.test(lower)) return { action: "detail_view", payload: {} };

  // "Visa X i modell" pattern
  const viewerMatch = lower.match(/^visa\s+(.+?)\s+i\s+(modell|viewer|3d)$/i);
  if (viewerMatch) return { action: "viewer_highlight", payload: { system: viewerMatch[1] } };

  // "Finns det andra typer av utrustning?" — common AI-generated suggestion
  if (/^finns det (andra|fler|mer) typer/i.test(lower)) return { action: "building_summary", payload: {} };
  
  // "Visa annan utrustning"
  if (/^visa (annan|annan typ|annat)\s+(utrustning|system)/i.test(lower)) return { action: "building_summary", payload: {} };

  return null;
}

/** Execute a button action deterministically — no AI needed */
async function executeButtonAction(supabase: any, intent: ButtonActionIntent, context: any): Promise<FastPathResult | null> {
  const buildingGuid = context?.currentBuilding?.fmGuid;
  const buildingName = context?.currentBuilding?.name || "byggnaden";

  switch (intent.action) {
    case "building_summary": {
      if (!buildingGuid) {
        return {
          message: "Ingen byggnad är vald. Välj en byggnad först.",
          response_type: "answer", action: "none",
          buttons: makeButtons([
            { label: "Visa alla byggnader", action: "list_buildings" },
          ]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Vilka byggnader finns?"],
        };
      }
      const summary = await execBuildingSummary(supabase, { fm_guid: buildingGuid });
      const topTypes = summary.top_asset_types?.slice(0, 3).map((t: any) => `${t.count}× ${t.type}`).join(", ") || "";
      return {
        message: `**${summary.building_name}**\n\n• ${summary.floors_count} våningar, ${summary.rooms} rum, ${summary.assets} tillgångar\n• Total yta: ${summary.total_space_area_m2} m²\n• ${summary.total_issues} ärenden${summary.total_issues > 0 ? ` (${Object.entries(summary.issues_by_status).map(([s, n]) => `${n} ${s}`).join(", ")})` : ""}${topTypes ? `\n• Vanligaste typer: ${topTypes}` : ""}`,
        response_type: "answer", action: "none",
        buttons: makeButtons([
          { label: "Visa alla rum", action: "category_query", payload: { category: "Space" } },
          { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } },
          { label: "Visa öppna ärenden", action: "issue_query" },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Vilka system finns?", "Visa alla tillgångar", "Visa dörrar"],
      };
    }

    case "category_query": {
      const category = intent.payload.category || "Instance";
      if (!buildingGuid) {
        return {
          message: "Ingen byggnad är vald. Välj en byggnad först.",
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Visa alla byggnader", action: "list_buildings" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Vilka byggnader finns?"],
        };
      }
      const { data: assets } = await supabase.rpc("get_assets_by_category", { cat: category, building_guid: buildingGuid });
      const assetList = assets || [];
      const assetIds = assetList.map((a: any) => a.fm_guid);
      const categoryLabel = category === "Space" ? "rum" : category === "Instance" ? "tillgångar" : category === "Door" ? "dörrar" : category;

      if (assetList.length === 0) {
        return {
          message: `Inga ${categoryLabel} hittades i ${buildingName}.`,
          response_type: "data_query", action: "none",
          buttons: makeButtons([
            { label: "Byggnadsöversikt", action: "building_summary" },
            { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } },
          ]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Vilka system finns?", "Sök utrustning"],
        };
      }

      // Summarize by asset_type for Instance, by name for Space
      let summary = "";
      if (category === "Instance") {
        const types: Record<string, number> = {};
        assetList.forEach((a: any) => { const t = a.asset_type || "okänd"; types[t] = (types[t] || 0) + 1; });
        const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${n}× ${t}`).join(", ");
        summary = `\n\nFördelning: ${topTypes}`;
      }

      return {
        message: `Det finns **${assetList.length}** ${categoryLabel} i ${buildingName}.${summary}`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: `Visa ${categoryLabel} i modell`, action: "viewer_highlight", payload: { category } },
          { label: "Filtrera per våning", action: "floor_query" },
          { label: "Byggnadsöversikt", action: "building_summary" },
        ]),
        asset_ids: assetIds.slice(0, 50), external_entity_ids: [], filters: { category },
        suggestions: [`Visa ${categoryLabel} i modell`, "Visa annan utrustning", "Vilka våningar finns?"],
      };
    }

    case "system_query": {
      const system = intent.payload.system || "ventilation";
      if (!buildingGuid) {
        return {
          message: "Ingen byggnad är vald.",
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Visa alla byggnader", action: "list_buildings" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Vilka byggnader finns?"],
        };
      }
      const { data: assets } = await supabase.rpc("get_assets_by_system", { system_query: system, building_guid: buildingGuid });
      const assetList = assets || [];
      if (assetList.length === 0) {
        // Try category fallback — maybe it's a category not a system
        const catMatch = matchCategory(system);
        if (catMatch) {
          return executeButtonAction(supabase, { action: "category_query", payload: { category: catMatch } }, context);
        }
        // Try free search
        const { data: searchResults } = await supabase.rpc("search_assets_rpc", { search: system, building_guid: buildingGuid });
        if (searchResults?.length) {
          const types: Record<string, number> = {};
          searchResults.forEach((a: any) => { const t = a.asset_type || a.category || "okänd"; types[t] = (types[t] || 0) + 1; });
          const typeSummary = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${n}× ${t}`).join(", ");
          return {
            message: `Hittade **${searchResults.length}** objekt som matchar "${system}" i ${buildingName}: ${typeSummary}.`,
            response_type: "data_query", action: "none",
            buttons: makeButtons([
              { label: `Visa ${system} i modell`, action: "viewer_highlight", payload: { system } },
              { label: "Byggnadsöversikt", action: "building_summary" },
            ]),
            asset_ids: searchResults.slice(0, 50).map((a: any) => a.fm_guid), external_entity_ids: [], filters: { system },
            suggestions: ["Visa i modell", "Visa annan utrustning"],
          };
        }
        return {
          message: `Inga "${system}"-objekt hittades i ${buildingName}. Prova en annan sökning.`,
          response_type: "data_query", action: "none",
          buttons: makeButtons([
            { label: "Byggnadsöversikt", action: "building_summary" },
            { label: "Sök utrustning", action: "search_prompt" },
          ]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Vilka system finns?", "Visa alla tillgångar"],
        };
      }
      const assetIds = assetList.map((a: any) => a.fm_guid);
      const types: Record<string, number> = {};
      assetList.forEach((a: any) => { const t = a.asset_type || a.common_name || "okänd"; types[t] = (types[t] || 0) + 1; });
      const typeSummary = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${n}× ${t}`).join(", ");
      return {
        message: `Det finns **${assetList.length}** ${system}-objekt i ${buildingName}.\n\nFördelning: ${typeSummary}.`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: `Visa ${system} i modell`, action: "viewer_highlight", payload: { system } },
          { label: "Filtrera per våning", action: "floor_query" },
          { label: "Byggnadsöversikt", action: "building_summary" },
        ]),
        asset_ids: assetIds.slice(0, 50), external_entity_ids: [], filters: { system },
        suggestions: [`Visa ${system} i modell`, "Visa annan utrustning", "Vilka rum har detta system?"],
      };
    }

    case "viewer_highlight": {
      const system = intent.payload.system || intent.payload.category;
      if (!buildingGuid || !system) {
        return {
          message: "Ingen byggnad eller system att visa.",
          response_type: "answer", action: "none",
          buttons: makeButtons(defaultButtons(context)),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [],
        };
      }
      // Get assets by system or category
      let assetList: any[] = [];
      if (intent.payload.category) {
        const { data } = await supabase.rpc("get_assets_by_category", { cat: intent.payload.category, building_guid: buildingGuid });
        assetList = data || [];
      } else {
        const { data } = await supabase.rpc("get_assets_by_system", { system_query: system, building_guid: buildingGuid });
        assetList = data || [];
      }
      const assetIds = assetList.map((a: any) => a.fm_guid);
      let entityIds: string[] = [];
      if (assetIds.length > 0) {
        try {
          const { data: entities } = await supabase.rpc("get_viewer_entities", { asset_ids: assetIds.slice(0, 200) });
          entityIds = (entities || []).map((e: any) => e.external_entity_id).filter(Boolean);
        } catch { /* ignore */ }
      }
      return {
        message: `Markerar **${entityIds.length}** ${system}-objekt i viewern.`,
        response_type: "action", action: entityIds.length > 0 ? "highlight" : "none",
        buttons: makeButtons([
          { label: "Byggnadsöversikt", action: "building_summary" },
          { label: "Filtrera per våning", action: "floor_query" },
        ]),
        asset_ids: assetIds.slice(0, 50), external_entity_ids: entityIds,
        filters: intent.payload.category ? { category: intent.payload.category } : { system: system },
        suggestions: ["Visa annan utrustning", "Filtrera per våning"],
      };
    }

    case "issue_query": {
      if (!buildingGuid) {
        return {
          message: "Ingen byggnad är vald.",
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Visa alla byggnader", action: "list_buildings" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [],
        };
      }
      const { data: issues } = await supabase
        .from("bcf_issues")
        .select("id, title, status, priority")
        .eq("building_fm_guid", buildingGuid)
        .order("created_at", { ascending: false })
        .limit(20);
      const issueList = issues || [];
      if (issueList.length === 0) {
        return {
          message: `✅ Inga ärenden i ${buildingName}.`,
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Byggnadsöversikt", action: "building_summary" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Visa alla tillgångar", "Visa ventilation"],
        };
      }
      const byStatus: Record<string, number> = {};
      issueList.forEach((i: any) => { byStatus[i.status] = (byStatus[i.status] || 0) + 1; });
      const statusSummary = Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(", ");
      return {
        message: `**${issueList.length} ärenden** i ${buildingName}: ${statusSummary}.`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: "Byggnadsöversikt", action: "building_summary" },
          { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Visa högprioriterade ärenden", "Byggnadsöversikt"],
      };
    }

    case "search_prompt": {
      return {
        message: "Vad vill du söka efter? Skriv ett nyckelord eller systemnamn.",
        response_type: "answer", action: "none",
        buttons: makeButtons([
          { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } },
          { label: "Visa dörrar", action: "category_query", payload: { category: "Door" } },
          { label: "Visa sensorer", action: "system_query", payload: { system: "IfcSensor" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Ventilation", "Dörrar", "Pumpar"],
      };
    }

    case "floor_query":
    case "floor_list": {
      if (!buildingGuid) {
        return {
          message: "Ingen byggnad är vald.",
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Visa alla byggnader", action: "list_buildings" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [],
        };
      }
      const { data: floors } = await supabase
        .from("assets")
        .select("fm_guid, common_name, name")
        .eq("building_fm_guid", buildingGuid)
        .eq("category", "Building Storey")
        .order("name");
      const floorList = floors || [];
      if (floorList.length === 0) {
        return {
          message: `Inga våningar registrerade i ${buildingName}.`,
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Byggnadsöversikt", action: "building_summary" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [],
        };
      }
      const floorNames = floorList.map((f: any) => f.common_name || f.name).join(", ");
      return {
        message: `**${floorList.length} våningar** i ${buildingName}: ${floorNames}.`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: "Byggnadsöversikt", action: "building_summary" },
          { label: "Visa alla rum", action: "category_query", payload: { category: "Space" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Visa rum per våning", "Visa ventilation"],
      };
    }

    case "list_buildings": {
      const result = await execListBuildings(supabase, { limit: 20 });
      if (result.total === 0) {
        return {
          message: "Inga byggnader hittades.",
          response_type: "answer", action: "none",
          buttons: makeButtons([]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [],
        };
      }
      const names = result.buildings.map((b: any) => b.name).join(", ");
      return {
        message: `**${result.total} byggnader**: ${names}.`,
        response_type: "answer", action: "none",
        buttons: makeButtons(result.buildings.slice(0, 3).map((b: any) => ({
          label: `Översikt ${b.name}`, action: "building_summary",
        }))),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: result.buildings.slice(0, 3).map((b: any) => `Berätta om ${b.name}`),
      };
    }

    case "detail_view": {
      return {
        message: "Vilken typ av detaljer vill du se?",
        response_type: "answer", action: "none",
        buttons: makeButtons([
          { label: "Visa alla rum", action: "category_query", payload: { category: "Space" } },
          { label: "Visa alla tillgångar", action: "category_query", payload: { category: "Instance" } },
          { label: "Visa dörrar", action: "category_query", payload: { category: "Door" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Visa ventilation", "Visa sensorer"],
      };
    }

    default:
      return null;
  }
}

/* ─────────────────────────────────────────────
   Known BIM object types and system names
   ───────────────────────────────────────────── */

const KNOWN_OBJECT_TYPES: Record<string, { category: string }> = {
  "dörrar": { category: "Door" }, "dörr": { category: "Door" }, "doors": { category: "Door" }, "door": { category: "Door" },
  "rum": { category: "Space" }, "rooms": { category: "Space" }, "spaces": { category: "Space" },
  "våningar": { category: "Building Storey" }, "floors": { category: "Building Storey" },
};

const KNOWN_SYSTEMS: Record<string, string> = {
  "ventilation": "ventilation", "hvac": "ventilation", "vvs": "ventilation",
  "el": "IfcElectric", "electrical": "IfcElectric", "elektricitet": "IfcElectric",
  "sprinkler": "sprinkler", "brand": "IfcAlarm", "fire": "IfcAlarm",
  "vatten": "IfcPipe", "water": "IfcPipe", "avlopp": "IfcPipe",
  "värme": "heating", "heating": "heating", "kyla": "cooling", "cooling": "cooling",
  "pumpar": "pump", "pump": "pump", "pumps": "pump",
  "fönster": "IfcWindow", "fönstren": "IfcWindow", "windows": "IfcWindow",
  "väggar": "IfcWall", "vägg": "IfcWall", "walls": "IfcWall",
  "sensorer": "IfcSensor", "sensor": "IfcSensor", "sensors": "IfcSensor",
  "brandlarm": "IfcAlarm", "larm": "IfcAlarm", "alarm": "IfcAlarm", "alarms": "IfcAlarm",
  "armaturer": "IfcLightFixture", "armatur": "IfcLightFixture",
  "rör": "IfcPipeSegment", "pipes": "IfcPipeSegment",
  "ventiler": "IfcValve", "ventil": "IfcValve", "valves": "IfcValve",
};

/** Detect short input: bare building name, object type, or system name */
function detectShortInput(messages: any[], context: any): ButtonActionIntent | null {
  if (!messages.length) return null;
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "user") return null;
  const text = lastMsg.content.trim();
  const lower = text.toLowerCase();
  const buildingGuid = context?.currentBuilding?.fmGuid;
  const buildingName = context?.currentBuilding?.name?.toLowerCase();

  const wordCount = text.split(/\s+/).length;
  if (wordCount > 4) return null;

  // Match building name
  if (buildingGuid && buildingName && (lower === buildingName || buildingName.includes(lower) || lower.includes(buildingName))) {
    return { action: "building_summary", payload: {} };
  }

  // Match known category-type objects (dörrar, rum, våningar → category query)
  if (buildingGuid && KNOWN_OBJECT_TYPES[lower]) {
    return { action: "category_query", payload: { category: KNOWN_OBJECT_TYPES[lower].category } };
  }

  // Match known system
  if (buildingGuid && KNOWN_SYSTEMS[lower]) {
    return { action: "system_query", payload: { system: KNOWN_SYSTEMS[lower] } };
  }

  // "berätta om X" / "tell me about X" / "vad finns i X" / "sammanfatta X"
  const aboutMatch = lower.match(/^(berätta\s+om|tell\s+me\s+about|vad\s+(finns|har)\s+(i|om)|sammanfatta|om)\s+(.+)$/);
  if (aboutMatch && buildingGuid) {
    const subject = aboutMatch[4]?.trim();
    if (subject && buildingName && (subject === buildingName || buildingName.includes(subject))) {
      return { action: "building_summary", payload: {} };
    }
    if (subject && subject.length >= 2) {
      // Check if it's a known category
      if (KNOWN_OBJECT_TYPES[subject]) {
        return { action: "category_query", payload: { category: KNOWN_OBJECT_TYPES[subject].category } };
      }
      if (KNOWN_SYSTEMS[subject]) {
        return { action: "system_query", payload: { system: KNOWN_SYSTEMS[subject] } };
      }
      return { action: "system_query", payload: { system: subject } };
    }
  }

  return null;
}

/** Detect viewer-centric intents that can be served via direct RPC */
function detectViewerIntent(messages: any[], context: any): ButtonActionIntent | null {
  if (!messages.length) return null;
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "user") return null;
  const text = lastMsg.content.toLowerCase().trim();
  const buildingGuid = context?.currentBuilding?.fmGuid;

  // Detect if user explicitly wants viewer action
  const viewerKeywords = /(visa\s+i\s+(viewern|3d)|markera|highlight|show\s+in\s+(viewer|3d)|färglägg|colorize)/i;
  const wantsViewer = viewerKeywords.test(text);

  // "byggnadsöversikt" / "building overview"
  if (buildingGuid && /^(byggnadsöversikt|översikt|building overview|overview|sammanfattning|summary)/i.test(text)) {
    return { action: "building_summary", payload: {} };
  }

  // "vad finns i rummet" / "objekt i rummet"
  if (context?.currentSpace?.fmGuid && /^(vad finns|objekt|assets|utrustning)\s*(i|in)\s*(rummet|detta rum|this room|the room)/i.test(text)) {
    return { action: "room_query", payload: { room_guid: context.currentSpace.fmGuid, wantsViewer: wantsViewer ? "true" : "false" } };
  }

  // "visa X" / "show X" / "filtrera X"  -- broader match
  const systemMatch = text.match(/^(visa|show|markera|highlight|filtrera|filter|hur\s+många|how\s+many|vilka|which|finns\s+det)\s+(.+)$/i);
  if (systemMatch && buildingGuid) {
    const raw = systemMatch[2].replace(/\s*(i viewern|in viewer|i 3d|finns|finns det|har vi)\s*/gi, "").trim();
    if (raw.length < 2 || raw.length > 50) return null;

    // Check known categories first
    const catMatch = matchCategory(raw);
    if (catMatch) {
      return wantsViewer
        ? { action: "viewer_highlight", payload: { category: catMatch } }
        : { action: "category_query", payload: { category: catMatch } };
    }

    // Check known systems
    if (KNOWN_SYSTEMS[raw]) {
      return wantsViewer
        ? { action: "viewer_highlight", payload: { system: KNOWN_SYSTEMS[raw] } }
        : { action: "system_query", payload: { system: KNOWN_SYSTEMS[raw] } };
    }

    // Generic — route to system_query (with search fallback built in)
    return wantsViewer
      ? { action: "viewer_highlight", payload: { system: raw } }
      : { action: "system_query", payload: { system: raw } };
  }

  return null;
}

function getSimpleIntentResponse(intent: string, text: string, previousConversation?: any): any {
  const isSv = /^(hej|hallå|tja|tjena|tack|hjälp|god|ja|okej|ok|japp|jepp|visst|absolut|gärna|precis|exakt|stämmer|korrekt)/i.test(text);
  let message = "";
  let buttons: ActionButton[] = [];
  let suggestions: string[] = [];
  switch (intent) {
    case "greeting":
      message = isSv ? "Hej! Hur kan jag hjälpa dig idag?" : "Hello! How can I help you today?";
      buttons = isSv
        ? [{ label: "Byggnadsöversikt", action: "building_summary" }, { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } }, { label: "Sök utrustning", action: "search_prompt" }]
        : [{ label: "Building overview", action: "building_summary" }, { label: "Show HVAC", action: "system_query", payload: { system: "ventilation" } }, { label: "Search equipment", action: "search_prompt" }];
      suggestions = isSv ? ["Vilka system finns?", "Visa alla rum"] : ["What systems exist?", "Show all rooms"];
      break;
    case "thanks":
      message = isSv ? "Varsågod! Finns det något mer jag kan hjälpa dig med?" : "You're welcome! Is there anything else I can help with?";
      buttons = isSv
        ? [{ label: "Byggnadsöversikt", action: "building_summary" }, { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } }, { label: "Sök utrustning", action: "search_prompt" }]
        : [{ label: "Building overview", action: "building_summary" }, { label: "Show HVAC", action: "system_query", payload: { system: "ventilation" } }, { label: "Search equipment", action: "search_prompt" }];
      suggestions = isSv ? ["Visa alla tillgångar", "Öppna ärenden"] : ["Show all assets", "Open issues"];
      break;
    case "help":
      message = isSv
        ? "Jag kan hjälpa dig med byggnadsdata, system, 3D-navigering och sökning."
        : "I can help with building data, systems, 3D navigation and search.";
      buttons = isSv
        ? [{ label: "Byggnadsöversikt", action: "building_summary" }, { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } }, { label: "Sök utrustning", action: "search_prompt" }]
        : [{ label: "Building overview", action: "building_summary" }, { label: "Show HVAC", action: "system_query", payload: { system: "ventilation" } }, { label: "Search equipment", action: "search_prompt" }];
      suggestions = isSv ? ["Vilka system finns?", "Visa alla rum", "Öppna ärenden"] : ["What systems exist?", "Show all rooms", "Open issues"];
      break;
    case "confirmation": {
      const prevMsgs = previousConversation?.messages || [];
      const lastAssistant = [...prevMsgs].reverse().find((m: any) => m.role === "assistant");
      if (lastAssistant?.content) {
        message = isSv ? "Bra! Vad vill du göra härnäst?" : "Great! What would you like to do next?";
      } else {
        message = isSv ? "Vad kan jag hjälpa dig med?" : "What can I help you with?";
      }
      buttons = isSv
        ? [{ label: "Byggnadsöversikt", action: "building_summary" }, { label: "Visa ventilation", action: "system_query", payload: { system: "ventilation" } }, { label: "Sök utrustning", action: "search_prompt" }]
        : [{ label: "Building overview", action: "building_summary" }, { label: "Show HVAC", action: "system_query", payload: { system: "ventilation" } }, { label: "Search equipment", action: "search_prompt" }];
      suggestions = isSv ? ["Vilka system finns?", "Visa alla rum", "Öppna ärenden"] : ["What systems exist?", "Show all rooms", "Open issues"];
      break;
    }
  }
  return { message, response_type: "answer", action: "none", buttons, asset_ids: [], external_entity_ids: [], filters: {}, suggestions };
}

/* ─────────────────────────────────────────────
   System prompt — simplified, honest about loop
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

  const buildingAlreadyResolved = context?.currentBuilding?.fmGuid
    ? `\nIMPORTANT: The current building "${context.currentBuilding.name}" (fm_guid: ${context.currentBuilding.fmGuid}) is ALREADY resolved. Do NOT call resolve_building_by_name for it. Always pass building_guid="${context.currentBuilding.fmGuid}" to data tools.`
    : "";

  return `You are Geminus AI — an interactive interface for digital twin / BIM applications.

YOUR GOAL: Help the user forward. Minimize typing. Maximize clickable options. Always give next steps.

RESPONSE FORMAT (via format_response tool — call it LAST, after data tools):
- message: Short, concrete (max 2-3 sentences). No fluff.
- buttons: 2-3 clickable ACTION buttons (e.g. "Visa i modell", "Filtrera dörrar", "Byggnadsöversikt").
- suggestions: 2-3 proactive follow-up questions.
- action: Default "none". Only "highlight"/"filter"/"colorize" when user EXPLICITLY asks to see things in the viewer/3D.

TOOL CALLING FLOW:
- You have up to 2 rounds for data tools, then the final round forces format_response.
- Round 1: call ONE data tool (e.g. get_building_summary, get_assets_by_system, get_assets_by_category).
- Round 2 (if needed): call ONE more data tool OR format_response.
- Round 3: format_response is forced — always produce a structured answer.
- PREFER calling just ONE data tool then format_response (2 rounds total).

CRITICAL RULES:
1. NEVER write stop-answers like "Jag kunde inte slutföra sökningen". If data is missing, interpret and suggest alternatives.
2. Every response MUST have buttons and suggestions.
3. ALWAYS use tools to get data — never fabricate.
4. ALWAYS pass building_guid when available.
5. Respond in the SAME LANGUAGE as the user.
6. NEVER show UUIDs/GUIDs in message text.
7. Max 2-3 sentences in message.
${buildingAlreadyResolved}
${userCtx}${ctx}${modelsCtx}${memoryCtx}`;
}

/* ─────────────────────────────────────────────
   AI API call helper with fallback
   ───────────────────────────────────────────── */

async function callAI(apiKey: string, messages: any[], options: { stream?: boolean; tools?: any[]; tool_choice?: string | object; model?: string } = {}) {
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

/** Generate fallback buttons when AI doesn't provide them */
function generateFallbackButtons(context: any): ActionButton[] {
  return defaultButtons(context);
}

/** Generate fallback suggestions when AI doesn't provide them */
function generateFallbackSuggestions(result: any, context: any): string[] {
  const buildingName = context?.currentBuilding?.name;
  if (result?.action === "colorize") {
    return ["Visa temperatur i fler rum", "Vilka sensorer finns?", "Byggnadsöversikt"];
  }
  return [
    buildingName ? `Vilka system finns i ${buildingName}?` : "Vilka system finns?",
    "Visa alla rum",
    "Öppna ärenden",
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

    // Helper to save and respond
    const respond = (result: FastPathResult, logLabel: string) => {
      console.log(`${logLabel} (${Date.now() - startTime}ms)`);
      const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
      saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content: result.message }]).catch(e =>
        console.error("Failed to save conversation:", e)
      );
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    };

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

    // ── FAST-PATH 1: Simple intents (hej, tack, hjälp, ja) ──
    const simpleIntent = detectSimpleIntent(messages);
    if (simpleIntent) {
      const lastText = messages[messages.length - 1]?.content || "";
      const response = getSimpleIntentResponse(simpleIntent, lastText, previousConversation);
      return respond(response, `Fast-path intent: ${simpleIntent}`);
    }

    // ── FAST-PATH 2: Structured button actions (JSON or known label) ──
    const buttonAction = detectButtonAction(messages, context);
    if (buttonAction) {
      try {
        const result = await executeButtonAction(supabase, buttonAction, context);
        if (result) {
          return respond(result, `Fast-path button: ${buttonAction.action}`);
        }
      } catch (e) {
        console.error("Button action failed, falling back:", e);
      }
    }

    // ── FAST-PATH 3: Short input (building name, object type, system) ──
    const shortIntent = detectShortInput(messages, context);
    if (shortIntent) {
      try {
        const result = await executeButtonAction(supabase, shortIntent, context);
        if (result) {
          return respond(result, `Fast-path short: ${shortIntent.action}`);
        }
      } catch (e) {
        console.error("Short input failed, falling back:", e);
      }
    }

    // ── FAST-PATH 4: Viewer intents (visa X, filtrera X) ──
    const viewerIntent = detectViewerIntent(messages, context);
    if (viewerIntent) {
      try {
        const result = await executeButtonAction(supabase, viewerIntent, context);
        if (result) {
          return respond(result, `Fast-path viewer: ${viewerIntent.action}`);
        }
      } catch (e) {
        console.error("Viewer intent failed, falling back:", e);
      }
    }

    // ── Full tool-calling loop (complex questions only) ──
    let systemPrompt = await buildSystemPrompt(supabase, context, userProfile, previousConversation);
    if (userMemories) systemPrompt += userMemories;

    const conversation: any[] = [{ role: "system", content: systemPrompt }, ...messages];

    // Filter out resolve_building_by_name when building is already in context
    const activeTools = context?.currentBuilding?.fmGuid
      ? tools.filter((t: any) => t.function.name !== "resolve_building_by_name")
      : tools;

    let formatResponseResult: any = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const isLastRound = round === MAX_TOOL_ROUNDS - 1;
      const toolChoice = isLastRound
        ? { type: "function", function: { name: "format_response" } }
        : "auto";
      const resp = await callAI(LOVABLE_API_KEY, conversation, { tools: activeTools, tool_choice: toolChoice });
      const result = await resp.json();
      const choice = result.choices?.[0];

      if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
        const content = choice?.message?.content || "";
        console.log(`Gunnar: direct answer (${Date.now() - startTime}ms, round ${round + 1})`);
        const structuredResponse = {
          message: content,
          response_type: "answer" as const,
          action: "none" as const,
          buttons: generateFallbackButtons(context),
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

      if (formatResponseResult) {
        console.log(`Gunnar: format_response received (${Date.now() - startTime}ms, round ${round + 1})`);
        const structured: any = {
          message: formatResponseResult.message || "",
          response_type: formatResponseResult.response_type || "answer",
          action: formatResponseResult.action || "none",
          buttons: convertAiButtons(formatResponseResult.buttons, context),
          asset_ids: formatResponseResult.asset_ids || [],
          external_entity_ids: formatResponseResult.external_entity_ids || [],
          filters: formatResponseResult.filters || {},
          suggestions: formatResponseResult.suggestions?.length
            ? formatResponseResult.suggestions
            : generateFallbackSuggestions(formatResponseResult, context),
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

    // Max rounds — try to extract last useful AI content
    console.log(`Gunnar: max rounds reached (${Date.now() - startTime}ms)`);
    let lastAssistantText = "";
    for (let i = conversation.length - 1; i >= 0; i--) {
      if (conversation[i].role === "assistant" && typeof conversation[i].content === "string" && conversation[i].content.trim()) {
        lastAssistantText = conversation[i].content.trim();
        break;
      }
    }
    const buildingName = context?.currentBuilding?.name || "byggnaden";
    const fallback = {
      message: lastAssistantText || `Jag har begränsad information om detta just nu. Här är vad du kan göra:`,
      response_type: "answer",
      action: "none",
      buttons: defaultButtons(context),
      asset_ids: [],
      external_entity_ids: [],
      filters: {},
      suggestions: ["Vilka system finns?", "Visa alla rum", "Öppna ärenden"],
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
