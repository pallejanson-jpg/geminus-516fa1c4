import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";
import { getGeminusPremiumCredentials } from "../_shared/credentials.ts";

const MAX_TOOL_ROUNDS = 8;
// Sonnet is the interactive default — fast time-to-first-token, strong tool use.
// Opus is the fallback for overload (5xx) and for genuinely hard reasoning.
const AI_MODEL_PRIMARY = "claude-sonnet-4-6";
const AI_MODEL_FALLBACK = "claude-opus-4-8";
const MAX_OUTPUT_TOKENS = 4096;

/* ─────────────────────────────────────────────
   IFC type → user-friendly Swedish name map
   ───────────────────────────────────────────── */
const IFC_SWEDISH: Record<string, string> = {
  IfcDoor: "dörrar", IfcWindow: "fönster", IfcWall: "väggar", IfcWallStandardCase: "väggar",
  IfcSlab: "bjälklag", IfcBeam: "balkar", IfcColumn: "pelare", IfcRoof: "tak",
  IfcStair: "trappor", IfcStairFlight: "trappor", IfcRailing: "räcken",
  IfcCovering: "ytbeklädnad", IfcFurniture: "möbler", IfcCurtainWall: "curtainväggar",
  IfcSensor: "sensorer", IfcAlarm: "larm", IfcActuator: "ställdon", IfcController: "styrenheter",
  IfcPipeSegment: "rör", IfcPipeFitting: "rördelar", IfcDuctSegment: "ventilationskanaler",
  IfcDuctFitting: "kanaldelar", IfcFlowTerminal: "don", IfcValve: "ventiler",
  IfcPump: "pumpar", IfcBoiler: "pannor", IfcElectricAppliance: "elapparater",
  IfcLightFixture: "belysning", IfcOutlet: "uttag", IfcSanitaryTerminal: "sanitetsporslin",
  IfcFireSuppressionTerminal: "sprinkler", IfcFlowStorageDevice: "behållare",
  IfcFlowTreatmentDevice: "reningsenheter", IfcEnergyConversionDevice: "energiomvandlare",
  IfcDistributionFlowElement: "installationer", IfcDistributionElement: "installationer",
  IfcBuildingElementProxy: "byggnadselement", IfcFurnishingElement: "inredning",
  IfcTransportElement: "transportelement", IfcFlowSegment: "ledningssegment",
  IfcFlowFitting: "kopplingar", IfcFlowController: "flödesregulatorer",
  IfcSpaceHeater: "radiatorer", IfcUnitaryEquipment: "aggregat",
  IfcCableCarrierSegment: "kabelstegar", IfcCableSegment: "kablar",
  IfcElectricDistributionBoard: "elcentraler", IfcSwitchingDevice: "strömbrytare",
  IfcProtectiveDevice: "skyddsenheter", IfcJunctionBox: "kopplingsdosor",
};

function translateIfcType(ifcType: string): string {
  return IFC_SWEDISH[ifcType] || ifcType.replace(/^Ifc/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/* ─────────────────────────────────────────────
   Structured button type — replaces plain strings
   ───────────────────────────────────────────── */

interface ActionButton {
  label: string;
  action: string;
  payload?: Record<string, string>;
}

/* ─────────────────────────────────────────────
   Tool definitions — 5 RPC + utility tools + present_results
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
      description: "Comprehensive building overview: floors, rooms, assets, area, issues. NOTE: floors/rooms/assets are aggregated across ALL BIM models synced for the building — this tool does NOT tell you how many separate BIM models exist. Use list_bim_models for that.",
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
      name: "list_bim_models",
      description: "List the individual synced XKT/BIM models for a building (name + model_id per model). Use this — NOT get_building_summary — whenever the user asks 'which/how many BIM models exist' ('vilka/hur många BIM-modeller finns'). A building can have several separate models (e.g. architecture, electrical, ventilation each as their own model).",
      parameters: {
        type: "object",
        properties: {
          building_guid: { type: "string", description: "The building's fm_guid" },
        },
        required: ["building_guid"],
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
  // ── Live IoT sensor data (via Geminus Premium) ──
  {
    type: "function",
    function: {
      name: "get_live_sensor_data",
      description: "Get LIVE IoT sensor readings (temperature, CO2, humidity, occupancy, light) for the current building or a specific room. Data comes from the Geminus Premium platform. Use when user asks about temperature, air quality, indoor climate, CO2, humidity, occupancy.",
      parameters: {
        type: "object",
        properties: {
          building_guid: { type: "string", description: "Building fm_guid (required)" },
          room_fm_guids: { type: "array", items: { type: "string" }, description: "Optional: specific room fm_guids to query. If omitted, returns building-level overview." },
        },
        required: ["building_guid"],
        additionalProperties: false,
      },
    },
  },
  // ── Room sensor data from DB attributes ──
  {
    type: "function",
    function: {
      name: "get_room_sensor_data",
      description: "Get cached sensor data (temperature, CO2, humidity, occupancy) for rooms in a building. Data comes from room attributes in the database. Use for ranking questions like 'which room is warmest', 'average temperature', 'humidity in room X'. Prefer this over get_live_sensor_data for analytical/ranking questions.",
      parameters: {
        type: "object",
        properties: {
          building_guid: { type: "string", description: "Building fm_guid (required)" },
          floor_guid: { type: "string", description: "Optional: filter by floor fm_guid" },
          metric: { type: "string", enum: ["temperature", "co2", "humidity", "occupancy"], description: "Which metric to sort by (default: temperature)" },
          order: { type: "string", enum: ["asc", "desc"], description: "Sort order (default: desc = highest first)" },
        },
        required: ["building_guid"],
        additionalProperties: false,
      },
    },
  },
  // ── Flexible asset query with attribute filters & aggregation ──
  {
    type: "function",
    function: {
      name: "query_assets",
      description: "Flexible asset query with attribute filters and aggregation. Use for questions about asset/room properties stored in attributes (e.g. 'hur många rum har golvmaterial parkett?', 'vilka golvmaterial finns?') and for filtering objects by type/name (e.g. all doors of type 'Innerdörr'). If you don't know the exact attribute key, call list_attribute_keys first.",
      parameters: {
        type: "object",
        properties: {
          building_guid: { type: "string", description: "Building fm_guid (required)" },
          category: { type: "string", description: "Asset category: 'Space' (rooms), 'Instance' (equipment/components), 'Building Storey' (floors). Defaults to 'Space' when attribute filters are used." },
          asset_type: { type: "string", description: "IFC type filter, e.g. 'IfcDoor' (partial match)" },
          name_search: { type: "string", description: "Partial match on name/common_name, e.g. 'innerdörr'" },
          attribute_key: { type: "string", description: "Attribute key to filter on (case-insensitive; exact or prefix match, so 'golvmaterial' matches GUID-suffixed keys)" },
          attribute_value: { type: "string", description: "Attribute value to match (partial, case-insensitive), e.g. 'parkett'" },
          group_by: { type: "string", description: "Group results by this attribute key, or 'asset_type'. Use with mode='group'." },
          mode: { type: "string", enum: ["count", "list", "group"], description: "count = just the number; list = matching assets (fm_guids + names, max 200); group = counts per value of group_by" },
        },
        required: ["building_guid", "mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_attribute_keys",
      description: "List the attribute keys (with example values) that exist on assets in a building. Call this before query_assets when you need to find the right attribute key (e.g. for floor material / golvmaterial).",
      parameters: {
        type: "object",
        properties: {
          building_guid: { type: "string", description: "Building fm_guid (required)" },
          category: { type: "string", description: "Asset category to sample (default 'Space' = rooms)" },
        },
        required: ["building_guid"],
        additionalProperties: false,
      },
    },
  },
  // ── Faciliate FM data (work orders, contracts, maintenance) ──
  {
    type: "function",
    function: {
      name: "query_faciliate",
      description: "Query Faciliate FM data: work orders (arbetsorder), fault reports (felanmälan), rental contracts (hyreskontrakt, object_type 'rentlandlord') and planned maintenance (planerat underhåll, 'maintenance'). Data is a cached copy synced from Faciliate. Use for questions about work order status, open issues, contracts, and maintenance plans.",
      parameters: {
        type: "object",
        properties: {
          object_type: { type: "string", enum: ["workorder", "rentlandlord", "maintenance"], description: "Which Faciliate object type to query" },
          status: { type: "string", description: "Optional status filter, partial match on the status title (e.g. 'Öppen', 'Avslutad')" },
          building: { type: "string", description: "Optional building filter — matches building name (e.g. 'Småviken') or Faciliate building ID. If the cache has no building info yet, the result flags building_filter_unavailable." },
          fm_guid: { type: "string", description: "Optional FM GUID filter — matches room_cad_key, floor_cad_key, or building_cad_key. Use to find work orders for a specific room, floor, or building selected in the viewer." },
          search: { type: "string", description: "Optional free-text match on title/description" },
          mode: { type: "string", enum: ["count", "list"], description: "count = just the number; list = matching records (max 100)" },
        },
        required: ["object_type", "mode"],
        additionalProperties: false,
      },
    },
  },
  // ── Structured UI/viewer results tool ──
  {
    type: "function",
    function: {
      name: "present_results",
      description: "Present structured UI results to the user: viewer action, clickable buttons and follow-up suggestions. Call this ONCE after your data tools and BEFORE writing your final text answer. Default action is 'none'. Only use viewer actions (highlight/filter/colorize) when the user EXPLICITLY asks to see things in the viewer/3D.",
      parameters: {
        type: "object",
        properties: {
          response_type: { type: "string", enum: ["answer", "navigation", "data_query", "action"] },
          action: { type: "string", enum: ["highlight", "filter", "colorize", "list", "show_drawing", "none"], description: "Default 'none'. Only viewer actions when explicitly asked. 'show_drawing' opens the Geminus Base 2D drawing for a floor (requires the drawing field)." },
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
            description: "For action 'colorize': map asset fm_guid → [R,G,B] (0-255). fm_guids are auto-resolved to viewer entity ids.",
            additionalProperties: {
              type: "array",
              items: { type: "number" },
            },
          },
          drawing: {
            type: "object",
            description: "For action 'show_drawing': which Geminus Base 2D drawing to open",
            properties: {
              building_fm_guid: { type: "string" },
              storey_fm_guid: { type: "string" },
              storey_name: { type: "string", description: "Floor display name, e.g. 'Plan 2'" },
            },
            additionalProperties: false,
          },
        },
        required: ["action", "buttons", "suggestions"],
        additionalProperties: false,
      },
    },
  },
  // ── Insights AI analysis ──
  {
    type: "function",
    function: {
      name: "run_predictive_maintenance",
      description: "Run AI-powered predictive maintenance analysis for a building. Analyzes sensor data and equipment to identify risks BEFORE they occur. Returns predictions with risk levels, categories, estimated time to failure. Use when user asks about maintenance risks, upcoming failures, equipment health, or 'vilket underhåll behövs'.",
      parameters: {
        type: "object",
        properties: {
          building_guid: { type: "string", description: "The building's fm_guid (required)" },
          room_guids: { type: "array", items: { type: "string" }, description: "Optional: limit analysis to specific room fm_guids" },
        },
        required: ["building_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_room_optimization",
      description: "Run AI-powered space optimization analysis for a building. Analyzes room utilization and suggests merges, conversions, and rezoning. Use when user asks about space efficiency, underutilized rooms, space savings, or 'hur används lokalerna'.",
      parameters: {
        type: "object",
        properties: {
          building_guid: { type: "string", description: "The building's fm_guid (required)" },
        },
        required: ["building_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_documents",
      description: "Search building documents, manuals, drawings, and reports using natural language. Returns relevant document excerpts and a synthesized answer. Use when user asks about specific information in documents, technical specs, or 'vad står det i dokumenten om X'.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language search query" },
          building_guid: { type: "string", description: "Optional: scope search to a specific building" },
          source_type: { type: "string", description: "Optional: filter by document type (e.g. 'drawing', 'manual')" },
        },
        required: ["query"],
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

/** Convert OpenAI-style tool definitions to Anthropic Messages API format */
function toAnthropicTools(defs: any[]): Anthropic.Tool[] {
  return defs.map((t: any) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/* ─────────────────────────────────────────────
   Tool execution — RPC-based
   ───────────────────────────────────────────── */

async function executeTool(supabase: any, name: string, args: any) {
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
    case "list_bim_models":
      return execListBimModels(supabase, args);
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
    case "get_live_sensor_data":
      return execLiveSensorData(supabase, args);
    case "get_room_sensor_data":
      return execRoomSensorData(supabase, args);
    case "query_assets":
      return execQueryAssets(supabase, args);
    case "list_attribute_keys":
      return execListAttributeKeys(supabase, args);
    case "query_faciliate":
      return execQueryFaciliate(supabase, args);
    case "present_results": {
      // Auto-resolve viewer entities from asset_ids if external_entity_ids not provided
      if (args.asset_ids?.length && (!args.external_entity_ids || args.external_entity_ids.length === 0)) {
        try {
          const { data } = await supabase.rpc("get_viewer_entities", { asset_ids: args.asset_ids });
          if (data?.length) {
            args.external_entity_ids = data.map((e: any) => e.external_entity_id).filter(Boolean);
          }
        } catch (e) { console.error("Auto-resolve entities failed:", e); }
      }
      // Re-key color_map from asset fm_guids to viewer entity ids (colorize requires exact entity ids)
      if (args.color_map && Object.keys(args.color_map).length) {
        try {
          const { data } = await supabase.rpc("get_viewer_entities", { asset_ids: Object.keys(args.color_map) });
          if (data?.length) {
            const byFmGuid = new Map<string, string>();
            for (const e of data) {
              if (e.asset_fm_guid && e.external_entity_id) byFmGuid.set(e.asset_fm_guid, e.external_entity_id);
            }
            const remapped: Record<string, any> = {};
            for (const [k, color] of Object.entries(args.color_map)) {
              remapped[byFmGuid.get(k) || k] = color;
            }
            args.color_map = remapped;
          }
        } catch (e) { console.error("Color map entity resolve failed:", e); }
      }
      return { presented: true, ...args };
    }
    case "run_predictive_maintenance":
      return execPredictiveMaintenance(supabase, args);
    case "run_room_optimization":
      return execRoomOptimization(supabase, args);
    case "search_documents":
      return execSearchDocuments(supabase, args);
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

  // Use COUNT queries to avoid Supabase default 1000-row limit
  const [
    spaceCount, instanceCount, storeyCount, doorCount,
    issues, buildingRow, floors, topAssetTypesResult, areaResult,
  ] = await Promise.all([
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("building_fm_guid", fmGuid).eq("category", "Space"),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("building_fm_guid", fmGuid).eq("category", "Instance"),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("building_fm_guid", fmGuid).eq("category", "Building Storey"),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("building_fm_guid", fmGuid).eq("category", "Instance").eq("asset_type", "IfcDoor"),
    supabase.from("bcf_issues").select("status, priority").eq("building_fm_guid", fmGuid),
    supabase.from("assets").select("common_name, name, gross_area, attributes").eq("fm_guid", fmGuid).maybeSingle(),
    supabase.from("assets").select("fm_guid, common_name, name").eq("building_fm_guid", fmGuid).eq("category", "Building Storey").order("name"),
    // Get top asset_types via a sample of instances
    supabase.from("assets").select("asset_type").eq("building_fm_guid", fmGuid).eq("category", "Instance").limit(1000),
    // Get spaces with attributes for area extraction
    supabase.from("assets").select("gross_area, attributes").eq("building_fm_guid", fmGuid).eq("category", "Space").limit(1000),
  ]);

  // Calculate total area from attributes (NTA) or gross_area
  let totalArea = 0;
  (areaResult.data || []).forEach((a: any) => {
    // 1. gross_area column
    if (a.gross_area && Number(a.gross_area) > 0) { totalArea += Number(a.gross_area); return; }
    // 2. NTA attribute (key starts with 'nta', value is {value: N} or direct number)
    if (a.attributes && typeof a.attributes === 'object') {
      for (const key of Object.keys(a.attributes)) {
        if (key.toLowerCase().startsWith('nta')) {
          const ntaVal = a.attributes[key];
          if (ntaVal && typeof ntaVal === 'object' && typeof ntaVal.value === 'number') {
            totalArea += ntaVal.value; return;
          }
          const num = Number(ntaVal);
          if (num > 0) { totalArea += num; return; }
        }
      }
    }
  });

  // Count asset types
  const assetTypes: Record<string, number> = {};
  (topAssetTypesResult.data || []).forEach((a: any) => {
    if (a.asset_type) assetTypes[a.asset_type] = (assetTypes[a.asset_type] || 0) + 1;
  });

  const issuesByStatus: Record<string, number> = {};
  (issues.data || []).forEach((i: any) => { issuesByStatus[i.status] = (issuesByStatus[i.status] || 0) + 1; });
  const topAssetTypes = Object.entries(assetTypes).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, count]) => ({ type, count }));

  const rooms = spaceCount.count ?? 0;
  const assets = instanceCount.count ?? 0;
  const floorsCount = storeyCount.count ?? 0;
  const doors = doorCount.count ?? 0;

  return {
    building_name: buildingRow.data?.common_name || buildingRow.data?.name || fmGuid,
    building_fm_guid: fmGuid,
    floors_count: floorsCount,
    floors: (floors.data || []).map((f: any) => ({ fm_guid: f.fm_guid, name: f.common_name || f.name })),
    rooms,
    assets,
    doors,
    total_space_area_m2: Math.round(totalArea * 100) / 100,
    issues_by_status: issuesByStatus,
    total_issues: (issues.data || []).length,
    top_asset_types: topAssetTypes,
  };
}

async function execListBimModels(supabase: any, args: any) {
  const fmGuid = args.building_guid;
  const { data, error } = await supabase
    .from("xkt_models")
    .select("model_id, model_name, file_name")
    .eq("building_fm_guid", fmGuid)
    .eq("is_chunk", false)
    .order("model_name");
  if (error) throw error;
  const models = data || [];
  return {
    building_fm_guid: fmGuid,
    model_count: models.length,
    models: models.map((m: any) => ({ model_id: m.model_id, name: m.model_name || m.file_name })),
  };
}

/* ── Flexible asset query with attribute filters ── */

/** Strip the 40-char hex GUID suffix Geminus Plus appends to custom property keys */
function cleanAttrKey(key: string): string {
  return key.replace(/[0-9A-F]{40}$/i, "");
}

/** Extract an attribute value by key (case-insensitive, exact or prefix — Geminus Plus
 *  suffixes custom keys with GUIDs, e.g. "golvmaterial54D5F519...");
 *  handles both direct values and {value: X} objects */
function extractAttrValue(attrs: any, key: string): any {
  if (!attrs || typeof attrs !== "object") return undefined;
  const lowerKey = key.toLowerCase();
  const keys = Object.keys(attrs);
  const realKey =
    keys.find(k => k.toLowerCase() === lowerKey) ||
    keys.find(k => cleanAttrKey(k).toLowerCase() === lowerKey) ||
    keys.find(k => k.toLowerCase().startsWith(lowerKey));
  if (!realKey) return undefined;
  const raw = attrs[realKey];
  if (raw && typeof raw === "object" && "value" in raw) return (raw as any).value;
  return raw;
}

async function execQueryAssets(supabase: any, args: any) {
  const buildingGuid = args.building_guid;
  if (!buildingGuid) return { error: "building_guid required" };
  const mode = args.mode || "count";
  const usesAttributes = !!(args.attribute_key || (args.group_by && args.group_by !== "asset_type"));
  const category = args.category || (usesAttributes ? "Space" : undefined);

  const SCAN_LIMIT = 4000;
  let query = supabase
    .from("assets")
    .select(usesAttributes ? "fm_guid, name, common_name, asset_type, attributes" : "fm_guid, name, common_name, asset_type")
    .eq("building_fm_guid", buildingGuid)
    .limit(SCAN_LIMIT);
  if (category) query = query.eq("category", category);
  if (args.asset_type) query = query.ilike("asset_type", `%${args.asset_type}%`);
  if (args.name_search) {
    const term = String(args.name_search).replace(/[%,()]/g, "");
    query = query.or(`name.ilike.%${term}%,common_name.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  let rows: any[] = data || [];
  const scanned = rows.length;

  if (args.attribute_key) {
    const wanted = args.attribute_value ? String(args.attribute_value).toLowerCase() : null;
    rows = rows.filter((r: any) => {
      const v = extractAttrValue(r.attributes, args.attribute_key);
      if (v === undefined || v === null || v === "") return false;
      if (!wanted) return true;
      return String(v).toLowerCase().includes(wanted);
    });
  }

  const base = {
    count: rows.length,
    scanned,
    truncated: scanned >= SCAN_LIMIT,
    category: category || "all",
  };

  if (mode === "group") {
    const groupKey = args.group_by || args.attribute_key;
    if (!groupKey) return { error: "group_by (or attribute_key) required for mode='group'" };
    const groups: Record<string, number> = {};
    for (const r of rows) {
      const v = groupKey === "asset_type" ? r.asset_type : extractAttrValue(r.attributes, groupKey);
      const label = v === undefined || v === null || v === "" ? "(saknas)" : String(v);
      groups[label] = (groups[label] || 0) + 1;
    }
    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([value, count]) => ({ value, count }));
    return { ...base, group_by: groupKey, groups: sorted };
  }

  if (mode === "list") {
    return {
      ...base,
      assets: rows.slice(0, 200).map((r: any) => ({
        fm_guid: r.fm_guid,
        name: r.common_name || r.name,
        asset_type: r.asset_type,
        ...(args.attribute_key ? { attribute_value: extractAttrValue(r.attributes, args.attribute_key) } : {}),
      })),
    };
  }

  return base;
}

async function execListAttributeKeys(supabase: any, args: any) {
  const buildingGuid = args.building_guid;
  if (!buildingGuid) return { error: "building_guid required" };
  const category = args.category || "Space";
  const { data, error } = await supabase
    .from("assets")
    .select("attributes")
    .eq("building_fm_guid", buildingGuid)
    .eq("category", category)
    .not("attributes", "is", null)
    .limit(300);
  if (error) throw error;
  const keys: Record<string, { count: number; example: string }> = {};
  for (const row of data || []) {
    if (!row.attributes || typeof row.attributes !== "object") continue;
    for (const [k, raw] of Object.entries(row.attributes)) {
      const v = raw && typeof raw === "object" && "value" in (raw as any) ? (raw as any).value : raw;
      const key = cleanAttrKey(k); // GUID-suffixed custom keys collapse to their readable prefix
      if (!keys[key]) keys[key] = { count: 0, example: String(v ?? "").slice(0, 60) };
      keys[key].count++;
    }
  }
  const sorted = Object.entries(keys).sort((a, b) => b[1].count - a[1].count).slice(0, 80)
    .map(([key, info]) => ({ key, count: info.count, example: info.example }));
  return { category, sampled_assets: (data || []).length, keys: sorted };
}

/** Query the Faciliate cache (synced by the local VPN connector into faciliate_records). */
async function execQueryFaciliate(supabase: any, args: any) {
  const objectType = args.object_type;
  if (!objectType) return { error: "object_type required" };
  const mode = args.mode || "count";

  // Is building-level filtering even possible yet? (connector must have synced building info)
  const { count: withBuilding } = await supabase
    .from("faciliate_records").select("id", { count: "exact", head: true })
    .eq("object_type", objectType).not("building_name", "is", null);
  const buildingDataAvailable = (withBuilding ?? 0) > 0;

  const selectCols = mode === "count" ? "id" : "source_guid, title, status, building_id, building_name, room_cad_key, floor_cad_key, building_cad_key, synced_at";
  let query = supabase
    .from("faciliate_records")
    .select(selectCols, mode === "count" ? { count: "exact", head: true } : undefined)
    .eq("object_type", objectType);
  if (args.status) query = query.ilike("status", `%${args.status}%`);
  const building = args.building || args.building_id;
  if (building) {
    query = query.or(`building_name.ilike.%${String(building).replace(/[%,]/g, "")}%,building_id.eq.${building}`);
  }
  if (args.fm_guid) {
    const g = String(args.fm_guid).trim().toLowerCase();
    query = query.or(`room_cad_key.eq.${g},floor_cad_key.eq.${g},building_cad_key.eq.${g}`);
  }
  if (args.search) query = query.ilike("title", `%${String(args.search).replace(/[%,]/g, "")}%`);

  if (mode === "count") {
    const { count, error } = await query;
    if (error) throw error;
    // Guard against the misleading "global total answers a building question" case.
    if (building && !buildingDataAvailable) {
      return { object_type: objectType, count: count ?? 0, building_filter_unavailable: true,
        note: "I cannot break this down per building right now — this is the total count." };
    }
    return { object_type: objectType, count: count ?? 0, filtered_by_building: building || null };
  }

  const { data, error } = await query.limit(100);
  if (error) throw error;
  const rows = data || [];
  const label = objectType === "rentlandlord" ? "rental contracts" : objectType === "maintenance" ? "planned maintenance" : "work orders";
  if (rows.length === 0) {
    return {
      object_type: objectType,
      count: 0,
      hint: `I have no information about ${label} right now.`,
    };
  }
  return {
    object_type: objectType,
    count: rows.length,
    building_filter_unavailable: building && !buildingDataAvailable ? true : undefined,
    records: rows.map((r: any) => ({ guid: r.source_guid, title: r.title, status: r.status, building: r.building_name || r.building_id, room_guid: r.room_cad_key || undefined })),
    last_synced: rows[0]?.synced_at || null,
  };
}

/* ── Live IoT sensor data via Geminus Premium ── */

/** Extract sensor values from a machine data row (handles many field name variants) */
function extractSensorValues(row: any): { temperature: number | null; co2: number | null; humidity: number | null; occupancy: number | null; light: number | null } {
  if (!row) return { temperature: null, co2: null, humidity: null, occupancy: null, light: null };
  return {
    temperature: row.temperature_mean ?? row.temperature ?? row.temp ?? row.Temperature ?? null,
    co2: row.co2_mean ?? row.co2 ?? row.CO2 ?? null,
    humidity: row.humidity_mean ?? row.humidity ?? row.Humidity ?? row.rh ?? null,
    occupancy: row.occupation_mean ?? row.occupancy ?? row.occupation ?? row.Occupancy ?? null,
    light: row.light_mean ?? row.light ?? row.Light ?? row.lux ?? null,
  };
}

async function execLiveSensorData(supabase: any, args: any) {
  const buildingGuid = args.building_guid;
  if (!buildingGuid) return { error: "building_guid required" };

  try {
    const creds = await getGeminusPremiumCredentials(supabase, buildingGuid);
    if (!creds.apiUrl || !creds.email || !creds.password) {
      return { error: "No Geminus Premium credentials configured for this building", available: false };
    }

    const roomGuids = args.room_fm_guids as string[] | undefined;

    if (roomGuids?.length) {
      // Fetch data for specific rooms
      const results: any[] = [];
      for (const roomGuid of roomGuids.slice(0, 10)) {
        try {
          const { data } = await supabase.functions.invoke('geminus-premium-query', {
            body: { action: 'get-machine-data', fmGuid: roomGuid, buildingFmGuid: buildingGuid, days: 1 },
          });
          if (data?.success && data.data?.machine) {
            const m = data.data.machine;
            const latest = m.latest_values || (Array.isArray(data.data.machineData) && data.data.machineData.length > 0 ? data.data.machineData[data.data.machineData.length - 1] : null);
            const vals = extractSensorValues(latest);
            // Also try to resolve room name from assets
            let roomName = m.name || m.label || roomGuid;
            try {
              const { data: asset } = await supabase.from("assets").select("common_name, name").eq("fm_guid", roomGuid).maybeSingle();
              if (asset?.common_name || asset?.name) roomName = asset.common_name || asset.name;
            } catch { /* ignore */ }
            results.push({ room_fm_guid: roomGuid, machine_name: roomName, ...vals, dashboard_url: data.data.dashboardUrl || '' });
          }
        } catch (e) {
          console.warn(`[LiveSensor] Failed for room ${roomGuid}:`, e);
        }
      }
      return { available: results.length > 0, source: "Geminus Premium (live)", rooms: results, room_count: results.length };
    } else {
      // Building-level: get all machines for the site
      const { data } = await supabase.functions.invoke('geminus-premium-query', {
        body: { action: 'get-building-sensor-data', fmGuid: buildingGuid },
      });

      if (!data?.success || !data.data) {
        return { available: false, error: data?.error || "No sensor data available for this building" };
      }

      const machines = data.data.machines || [];
      const totalMachines = machines.length;
      console.log(`[LiveSensor] Building has ${totalMachines} machines, checking latest_values...`);

      // Check if latest_values are populated
      const hasLatestValues = machines.some((m: any) => m.latest_values !== null && m.latest_values !== undefined);

      if (hasLatestValues) {
        // Direct extraction from latest_values
        const parsed = machines.slice(0, 50).map((m: any) => ({
          name: m.name || m.code, code: m.code,
          ...extractSensorValues(m.latest_values),
          dashboard_url: m.dashboard_url || '',
        }));
        return buildSensorSummary(parsed, totalMachines, data.data.site);
      }

      // latest_values is null — fall back to DB sensor attributes
      console.log(`[LiveSensor] latest_values all null, falling back to DB room sensor data`);
      return execRoomSensorData(supabase, { building_guid: buildingGuid });
    }
  } catch (err: any) {
    console.error("[LiveSensor] Error:", err);
    // Fall back to DB sensor attributes on any error
    console.log(`[LiveSensor] Falling back to DB room sensor data after error`);
    return execRoomSensorData(supabase, { building_guid: args.building_guid });
  }
}

/** Get sensor data from room attributes in the database */
async function execRoomSensorData(supabase: any, args: any) {
  const buildingGuid = args.building_guid;
  if (!buildingGuid) return { error: "building_guid required" };

  try {
    const { data, error } = await supabase.rpc("get_room_sensor_data", {
      p_building_guid: buildingGuid,
      p_floor_guid: args.floor_guid || null,
      p_metric: args.metric || "temperature",
      p_sort_order: args.order || "desc",
    });
    if (error) throw error;

    const rooms = data || [];
    if (rooms.length === 0) {
      return { available: false, source: "database", error: "No rooms with sensor data found for this building" };
    }

    // Filter rooms that have at least one sensor value
    const withData = rooms.filter((r: any) => r.temperature !== null || r.co2 !== null || r.humidity !== null || r.occupancy !== null);
    if (withData.length === 0) {
      return { available: false, source: "database", error: "Rooms found but no sensor values available" };
    }

    // Calculate averages
    const temps = withData.map((r: any) => r.temperature).filter((v: any) => v !== null) as number[];
    const co2s = withData.map((r: any) => r.co2).filter((v: any) => v !== null) as number[];
    const hums = withData.map((r: any) => r.humidity).filter((v: any) => v !== null) as number[];
    const occs = withData.map((r: any) => r.occupancy).filter((v: any) => v !== null) as number[];

    const byTemp = withData.filter((r: any) => r.temperature !== null).sort((a: any, b: any) => b.temperature - a.temperature);
    const byCo2 = withData.filter((r: any) => r.co2 !== null).sort((a: any, b: any) => b.co2 - a.co2);
    const byHum = withData.filter((r: any) => r.humidity !== null).sort((a: any, b: any) => b.humidity - a.humidity);

    return {
      available: true,
      source: "database (cached sensor attributes)",
      room_count: withData.length,
      total_rooms: rooms.length,
      rooms: withData.slice(0, 50).map((r: any) => ({
        fm_guid: r.fm_guid,
        name: r.common_name || r.name || r.fm_guid,
        level_fm_guid: r.level_fm_guid,
        temperature: r.temperature,
        co2: r.co2,
        humidity: r.humidity,
        occupancy: r.occupancy,
      })),
      averages: {
        temperature: temps.length > 0 ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
        co2: co2s.length > 0 ? Math.round(co2s.reduce((a, b) => a + b, 0) / co2s.length) : null,
        humidity: hums.length > 0 ? Math.round((hums.reduce((a, b) => a + b, 0) / hums.length) * 10) / 10 : null,
        occupancy: occs.length > 0 ? Math.round((occs.reduce((a, b) => a + b, 0) / occs.length) * 10) / 10 : null,
      },
      highest_temperature: byTemp.length > 0 ? { name: byTemp[0].common_name || byTemp[0].name, value: byTemp[0].temperature, fm_guid: byTemp[0].fm_guid } : null,
      lowest_temperature: byTemp.length > 0 ? { name: byTemp[byTemp.length - 1].common_name || byTemp[byTemp.length - 1].name, value: byTemp[byTemp.length - 1].temperature, fm_guid: byTemp[byTemp.length - 1].fm_guid } : null,
      highest_co2: byCo2.length > 0 ? { name: byCo2[0].common_name || byCo2[0].name, value: byCo2[0].co2, fm_guid: byCo2[0].fm_guid } : null,
      highest_humidity: byHum.length > 0 ? { name: byHum[0].common_name || byHum[0].name, value: byHum[0].humidity, fm_guid: byHum[0].fm_guid } : null,
    };
  } catch (err: any) {
    console.error("[RoomSensorData] Error:", err);
    return { available: false, source: "database", error: err.message || "Failed to query room sensor data" };
  }
}

function buildSensorSummary(machines: any[], totalMachines: number, site: any, isSample = false) {
  const temps = machines.map(m => m.temperature).filter((v: any) => v !== null) as number[];
  const co2s = machines.map(m => m.co2).filter((v: any) => v !== null) as number[];
  const hums = machines.map(m => m.humidity).filter((v: any) => v !== null) as number[];

  // Sort to find highest/lowest
  const byTemp = machines.filter(m => m.temperature !== null).sort((a, b) => b.temperature - a.temperature);
  const byCo2 = machines.filter(m => m.co2 !== null).sort((a, b) => b.co2 - a.co2);

  return {
    available: true,
    source: "Geminus Premium (live)",
    site_name: site?.name || '',
    dashboard_url: site?.dashboard_url || '',
    machine_count: totalMachines,
    sampled: isSample,
    sample_size: machines.length,
    machines,
    averages: {
      temperature: temps.length > 0 ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
      co2: co2s.length > 0 ? Math.round(co2s.reduce((a, b) => a + b, 0) / co2s.length) : null,
      humidity: hums.length > 0 ? Math.round((hums.reduce((a, b) => a + b, 0) / hums.length) * 10) / 10 : null,
    },
    highest_temperature: byTemp.length > 0 ? { name: byTemp[0].name, value: byTemp[0].temperature, code: byTemp[0].code } : null,
    lowest_temperature: byTemp.length > 0 ? { name: byTemp[byTemp.length - 1].name, value: byTemp[byTemp.length - 1].temperature, code: byTemp[byTemp.length - 1].code } : null,
    highest_co2: byCo2.length > 0 ? { name: byCo2[0].name, value: byCo2[0].co2, code: byCo2[0].code } : null,
  };
}

/* ── Insights AI analysis ── */

async function execPredictiveMaintenance(supabase: any, args: any) {
  const { data, error } = await supabase.functions.invoke("predictive-maintenance", {
    body: { buildingFmGuid: args.building_guid, roomFmGuids: args.room_guids || null },
  });
  if (error) return { error: error.message || "predictive-maintenance function failed" };
  if (!data?.success) return { error: data?.error || "Analysis failed" };
  return data.data;
}

async function execRoomOptimization(supabase: any, args: any) {
  const { data, error } = await supabase.functions.invoke("room-optimization", {
    body: { buildingFmGuid: args.building_guid },
  });
  if (error) return { error: error.message || "room-optimization function failed" };
  if (!data?.success) return { error: data?.error || "Analysis failed" };
  return data.data;
}

async function execSearchDocuments(supabase: any, args: any) {
  const { data, error } = await supabase.functions.invoke("rag-search", {
    body: { query: args.query, buildingFmGuid: args.building_guid || null, sourceType: args.source_type || null },
  });
  if (error) return { error: error.message || "rag-search function failed" };
  if (!data?.success) return { error: data?.error || "Search failed" };
  return data.data;
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
    { label: buildingName ? `Building Overview ${buildingName}` : "Building Overview", action: "building_summary" },
    { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } },
    { label: "Search equipment", action: "search_prompt" },
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

  // Building overview — capture a named building if present ("Översikt Akerselva Atrium")
  const ovMatch = lower.match(/^(?:byggnadsöversikt|översikt|building overview|overview|sammanfattning)\s+(.+)$/i);
  if (ovMatch) {
    return { label, action: "building_summary", payload: { name: ovMatch[1].trim() } };
  }
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

  // "Visa X i viewer" / "Show X in viewer" / "Visa X i modell"
  const viewerMatch = lower.match(/^visa\s+(.+?)\s+i\s+(modell|viewer|3d)/i);
  if (viewerMatch) {
    return { label: label.replace(/i modell/i, "i viewer"), action: "viewer_highlight", payload: { system: viewerMatch[1] } };
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
  if (categoryMap[lower]) return categoryMap[lower];
  const folded = foldAccents(lower);
  for (const [k, v] of Object.entries(categoryMap)) if (foldAccents(k) === folded) return v;
  return null;
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
  navigate_to_viewer?: boolean;
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
  const ovMatch2 = lower.match(/^(?:byggnadsöversikt|översikt|overview|building overview)\s+(.+)$/i);
  if (ovMatch2) return { action: "building_summary", payload: { name: ovMatch2[1].trim() } };
  if (/^byggnadsöversikt/i.test(lower) || /^översikt$/i.test(lower)) return { action: "building_summary", payload: {} };
  if (/^visa alla rum$/i.test(lower) || /^show all rooms$/i.test(lower)) return { action: "category_query", payload: { category: "Space" } };
  if (/^visa alla tillgångar$/i.test(lower) || /^show all assets$/i.test(lower) || /^alla tillgångar$/i.test(lower)) return { action: "category_query", payload: { category: "Instance" } };
  if (/^visa alla system$/i.test(lower) || /^show all systems$/i.test(lower) || /^vilka system finns/i.test(lower)) return { action: "building_summary", payload: {} };
  if (/^visa (öppna\s+)?ärenden$/i.test(lower) || /^öppna ärenden$/i.test(lower) || /^open issues$/i.test(lower)) return { action: "issue_query", payload: {} };
  if (/^sök utrustning$/i.test(lower) || /^search equipment$/i.test(lower)) return { action: "search_prompt", payload: {} };
  if (/^visa ventilation$/i.test(lower) || /^show hvac$/i.test(lower)) return { action: "system_query", payload: { system: "ventilation" } };
  if (/^visa våningar$/i.test(lower) || /^show floors$/i.test(lower)) return { action: "floor_list", payload: {} };
  if (/^filtrera per våning$/i.test(lower)) return { action: "floor_query", payload: {} };
  if (/^visa detaljer$/i.test(lower)) return { action: "detail_view", payload: {} };

  // "Visa X i viewer/modell" pattern
  const viewerMatch2 = lower.match(/^visa\s+(.+?)\s+i\s+(modell|viewer|3d)$/i);
  if (viewerMatch2) return { action: "viewer_highlight", payload: { system: viewerMatch2[1] } };

  // "Finns det andra typer av utrustning?" — common AI-generated suggestion
  if (/^finns det (andra|fler|mer) typer/i.test(lower)) return { action: "building_summary", payload: {} };
  
  // "Visa annan utrustning"
  if (/^visa (annan|annan typ|annat)\s+(utrustning|system)/i.test(lower)) return { action: "building_summary", payload: {} };

  return null;
}

/** Execute a button action deterministically — no AI needed */
async function executeButtonAction(supabase: any, intent: ButtonActionIntent, context: any): Promise<FastPathResult | null> {
  const buildingGuid = context?.currentBuilding?.fmGuid;
  const buildingName = context?.currentBuilding?.name || "the building";

  switch (intent.action) {
    case "building_summary": {
      // Resolve which building: explicit fm_guid → named building → active context.
      let summaryGuid = intent.payload?.fm_guid || buildingGuid;
      if (!summaryGuid && intent.payload?.name) {
        const resolved: any = await execResolveBuildingByName(supabase, { name: intent.payload.name });
        if (resolved.found && resolved.buildings?.length) {
          summaryGuid = resolved.buildings[0].building_fm_guid || resolved.buildings[0].fm_guid;
        } else {
          return {
            message: `I cannot find a building named "${intent.payload.name}".`,
            response_type: "answer", action: "none",
            buttons: makeButtons([{ label: "Show all buildings", action: "list_buildings" }]),
            asset_ids: [], external_entity_ids: [], filters: {},
            suggestions: ["Which buildings exist?"],
          };
        }
      }
      if (!summaryGuid) {
        return {
          message: "Which building would you like to see? Here are all buildings.",
          response_type: "answer", action: "none",
          buttons: makeButtons([
            { label: "Show all buildings", action: "list_buildings" },
          ]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Which buildings exist?"],
        };
      }
      const summary = await execBuildingSummary(supabase, { fm_guid: summaryGuid });
      const topTypes = summary.top_asset_types?.slice(0, 3).map((t: any) => `${t.count}× ${translateIfcType(t.type)}`).join(", ") || "";
      return {
        message: `**${summary.building_name}**\n\n• ${summary.floors_count} floors, ${summary.rooms} rooms, ${summary.assets} assets\n• Total area: ${summary.total_space_area_m2} m²\n• ${summary.total_issues} issues${summary.total_issues > 0 ? ` (${Object.entries(summary.issues_by_status).map(([s, n]) => `${n} ${s}`).join(", ")})` : ""}${topTypes ? `\n• Most common types: ${topTypes}` : ""}`,
        response_type: "answer", action: "none",
        buttons: makeButtons([
          { label: "Show all rooms", action: "category_query", payload: { category: "Space" } },
          { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } },
          { label: "Show open issues", action: "issue_query" },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Which systems exist?", "Show all assets", "Show doors"],
      };
    }

    case "category_query": {
      const category = intent.payload.category || "Instance";
      if (!buildingGuid) {
        return null; // Fall through to AI — it can resolve the building from conversation
      }

      // Door is stored as category="Instance" + asset_type="IfcDoor", not category="Door"
      const isDoorQuery = category === "Door";

      // Use COUNT query for accurate total (RPC has LIMIT 200)
      const countQuery = isDoorQuery
        ? supabase.from("assets").select("id", { count: "exact", head: true })
            .eq("building_fm_guid", buildingGuid).eq("category", "Instance").eq("asset_type", "IfcDoor")
        : supabase.from("assets").select("id", { count: "exact", head: true })
            .eq("building_fm_guid", buildingGuid).eq("category", category);

      const rpcQuery = isDoorQuery
        ? supabase.rpc("get_assets_by_system", { system_query: "IfcDoor", building_guid: buildingGuid })
        : supabase.rpc("get_assets_by_category", { cat: category, building_guid: buildingGuid });

      const [countResult, rpcResult] = await Promise.all([countQuery, rpcQuery]);

      const totalCount = countResult.count ?? 0;
      const assetList = rpcResult.data || [];
      const assetIds = assetList.map((a: any) => a.fm_guid);
      const categoryLabel = category === "Space" ? "rooms" : category === "Instance" ? "assets" : category === "Door" ? "doors" : category === "Building Storey" ? "floors" : category;

      if (totalCount === 0) {
        return {
          message: `No ${categoryLabel} found in ${buildingName}.`,
          response_type: "data_query", action: "none",
          buttons: makeButtons([
            { label: "Building Overview", action: "building_summary" },
            { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } },
          ]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Which systems exist?", "Search equipment"],
        };
      }

      // Summarize by asset_type for Instance, by name for Space
      let summary = "";
      if (category === "Instance") {
        const types: Record<string, number> = {};
        assetList.forEach((a: any) => { const t = a.asset_type || "unknown"; types[t] = (types[t] || 0) + 1; });
        const topTypes = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${n}× ${translateIfcType(t)}`).join(", ");
        summary = `\n\nBreakdown (top): ${topTypes}`;
      }

      return {
        message: `There are **${totalCount}** ${categoryLabel} in ${buildingName}.${summary}`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: `Show ${categoryLabel} in viewer`, action: "viewer_highlight", payload: { category } },
          { label: "Filter by floor", action: "floor_query" },
          { label: "Building Overview", action: "building_summary" },
        ]),
        asset_ids: assetIds.slice(0, 50), external_entity_ids: [], filters: { category },
        suggestions: [`Show ${categoryLabel} in viewer`, "Show other equipment", "Which floors exist?"],
      };
    }

    case "system_query": {
      const system = intent.payload.system || "ventilation";
      if (!buildingGuid) {
        return null; // Fall through to AI
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
          searchResults.forEach((a: any) => { const t = a.asset_type || a.category || "unknown"; types[t] = (types[t] || 0) + 1; });
          const typeSummary = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${n}× ${t}`).join(", ");
          return {
            message: `Found **${searchResults.length}** objects matching "${system}" in ${buildingName}: ${typeSummary}.`,
            response_type: "data_query", action: "none",
            buttons: makeButtons([
              { label: `Show ${system} in viewer`, action: "viewer_highlight", payload: { system } },
              { label: "Building Overview", action: "building_summary" },
            ]),
            asset_ids: searchResults.slice(0, 50).map((a: any) => a.fm_guid), external_entity_ids: [], filters: { system },
            suggestions: ["Show in viewer", "Show other equipment"],
          };
        }
        return {
          message: `No "${system}" objects found in ${buildingName}. Try a different search.`,
          response_type: "data_query", action: "none",
          buttons: makeButtons([
            { label: "Building Overview", action: "building_summary" },
            { label: "Search equipment", action: "search_prompt" },
          ]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Which systems exist?", "Show all assets"],
        };
      }
      const assetIds = assetList.map((a: any) => a.fm_guid);
      const types: Record<string, number> = {};
      assetList.forEach((a: any) => { const t = a.asset_type || a.common_name || "unknown"; types[t] = (types[t] || 0) + 1; });
      const typeSummary = Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => `${n}× ${t}`).join(", ");
      return {
        message: `There are **${assetList.length}** ${system} objects in ${buildingName}.\n\nBreakdown: ${typeSummary}.`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: `Show ${system} in viewer`, action: "viewer_highlight", payload: { system } },
          { label: "Filter by floor", action: "floor_query" },
          { label: "Building Overview", action: "building_summary" },
        ]),
        asset_ids: assetIds.slice(0, 50), external_entity_ids: [], filters: { system },
        suggestions: [`Show ${system} in viewer`, "Show other equipment", "Which rooms have this system?"],
      };
    }

    case "viewer_highlight": {
      const system = intent.payload.system || intent.payload.category;
      if (!buildingGuid || !system) {
        return null; // Fall through to AI
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
        message: entityIds.length > 0
          ? `Highlighting **${entityIds.length}** ${system} objects in the viewer.`
          : `Opening viewer for ${buildingName}. (No geometry objects found for ${system} to highlight.)`,
        response_type: "action", action: "highlight",
        buttons: makeButtons([
          { label: "Building Overview", action: "building_summary" },
          { label: "Filter by floor", action: "floor_query" },
        ]),
        asset_ids: assetIds.slice(0, 50), external_entity_ids: entityIds,
        filters: intent.payload.category ? { category: intent.payload.category } : { system: system },
        suggestions: ["Show other equipment", "Filter by floor"],
        navigate_to_viewer: true,
      };
    }

    case "issue_query": {
      if (!buildingGuid) {
        return null; // Fall through to AI
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
          message: `✅ No issues in ${buildingName}.`,
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Building Overview", action: "building_summary" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Show all assets", "Show ventilation"],
        };
      }
      const byStatus: Record<string, number> = {};
      issueList.forEach((i: any) => { byStatus[i.status] = (byStatus[i.status] || 0) + 1; });
      const statusSummary = Object.entries(byStatus).map(([s, n]) => `${n} ${s}`).join(", ");
      return {
        message: `**${issueList.length} issues** in ${buildingName}: ${statusSummary}.`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: "Building Overview", action: "building_summary" },
          { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Show high-priority issues", "Building Overview"],
      };
    }

    case "search_prompt": {
      return {
        message: "What would you like to search for? Enter a keyword or system name.",
        response_type: "answer", action: "none",
        buttons: makeButtons([
          { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } },
          { label: "Show doors", action: "category_query", payload: { category: "Door" } },
          { label: "Show sensors", action: "system_query", payload: { system: "IfcSensor" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Ventilation", "Doors", "Pumps"],
      };
    }

    case "floor_query":
    case "floor_list": {
      if (!buildingGuid) {
        return null; // Fall through to AI
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
          message: `No floors registered in ${buildingName}.`,
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Building Overview", action: "building_summary" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [],
        };
      }
      const floorNames = floorList.map((f: any) => f.common_name || f.name).join(", ");
      return {
        message: `**${floorList.length} floors** in ${buildingName}: ${floorNames}.`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: "Building Overview", action: "building_summary" },
          { label: "Show all rooms", action: "category_query", payload: { category: "Space" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Show rooms per floor", "Show ventilation"],
      };
    }

    case "list_buildings": {
      const result = await execListBuildings(supabase, { limit: 20 });
      if (result.total === 0) {
        return {
          message: "No buildings found.",
          response_type: "answer", action: "none",
          buttons: makeButtons([]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: [],
        };
      }
      const names = result.buildings.map((b: any) => b.name).join(", ");
      return {
        message: `**${result.total} buildings**: ${names}.`,
        response_type: "answer", action: "none",
        buttons: makeButtons(result.buildings.slice(0, 5).map((b: any) => ({
          label: `Overview ${b.name}`, action: "building_summary", payload: { fm_guid: b.fm_guid, name: b.name },
        }))),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: result.buildings.slice(0, 3).map((b: any) => `Overview ${b.name}`),
      };
    }

    case "detail_view": {
      return {
        message: "What type of details would you like to see?",
        response_type: "answer", action: "none",
        buttons: makeButtons([
          { label: "Show all rooms", action: "category_query", payload: { category: "Space" } },
          { label: "Show all assets", action: "category_query", payload: { category: "Instance" } },
          { label: "Show doors", action: "category_query", payload: { category: "Door" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Show ventilation", "Show sensors"],
      };
    }

    case "iot_query": {
      if (!buildingGuid) {
        return null; // Fall through to AI
      }
      const sensorType = intent.payload.sensor_type || "all";
      const roomGuids = intent.payload.room_guid ? [intent.payload.room_guid] : undefined;
      const sensorResult: any = await execLiveSensorData(supabase, { building_guid: buildingGuid, room_fm_guids: roomGuids });

      if (!sensorResult.available) {
        return {
          message: `No sensor data available for ${buildingName}.`,
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Building Overview", action: "building_summary" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Show all rooms", "Building Overview"],
        };
      }

      // Build response — handle both Geminus Premium live format and DB fallback format
      let message = "";
      const sensorData: any[] = [];
      const colorMap: Record<string, [number, number, number]> = {};
      const isDbSource = sensorResult.source?.includes("database");

      if (sensorResult.rooms?.length && !sensorResult.averages) {
        // Room-specific live data (single room query)
        const room = sensorResult.rooms[0];
        const roomName = room.machine_name || room.name || "Unknown room";
        const parts: string[] = [];
        if (room.temperature !== null && room.temperature !== undefined) parts.push(`${room.temperature.toFixed(1)}°C`);
        if (room.co2 !== null && room.co2 !== undefined) parts.push(`CO₂: ${Math.round(room.co2)} ppm`);
        if (room.humidity !== null && room.humidity !== undefined) parts.push(`${room.humidity.toFixed(1)}% RH`);
        if (room.occupancy !== null && room.occupancy !== undefined) parts.push(`${Math.round(room.occupancy)}% occupancy`);
        message = `**Sensor data** for ${roomName}:\n${parts.join(" · ")}`;
      } else if (sensorResult.averages) {
        // Building-level data (both Geminus Premium and DB fallback)
        const avg = sensorResult.averages;
        const parts: string[] = [];
        if (avg.temperature !== null && avg.temperature !== undefined) parts.push(`Avg temp: ${avg.temperature}°C`);
        if (avg.co2 !== null && avg.co2 !== undefined) parts.push(`CO₂: ${avg.co2} ppm`);
        if (avg.humidity !== null && avg.humidity !== undefined) parts.push(`Humidity: ${avg.humidity}%`);
        if (avg.occupancy !== null && avg.occupancy !== undefined) parts.push(`Occupancy: ${avg.occupancy}%`);

        const roomCount = sensorResult.room_count || sensorResult.machine_count || 0;
        message = `**Sensor data** for ${buildingName} (${roomCount} rooms):\n${parts.join(" · ")}`;

        // Add highest/lowest info
        if (sensorResult.highest_temperature) {
          const ht = sensorResult.highest_temperature;
          message += `\n\nWarmest: **${ht.name || "Unknown room"}** (${Math.round(ht.value * 10) / 10}°C)`;
        }
        if (sensorResult.lowest_temperature) {
          const lt = sensorResult.lowest_temperature;
          message += `\nCoolest: **${lt.name || "Unknown room"}** (${Math.round(lt.value * 10) / 10}°C)`;
        }
        if (sensorResult.highest_co2) {
          const hc = sensorResult.highest_co2;
          message += `\nHighest CO₂: **${hc.name || "Unknown room"}** (${Math.round(hc.value)} ppm)`;
        }
        if (sensorResult.highest_humidity) {
          const hh = sensorResult.highest_humidity;
          message += `\nHighest humidity: **${hh.name || "Unknown room"}** (${Math.round(hh.value * 10) / 10}%)`;
        }

        // Build color map for temperature visualization from rooms (DB) or machines (Geminus Premium)
        const items = sensorResult.rooms || sensorResult.machines || [];
        if (sensorType === "all" || sensorType === "temperature") {
          for (const m of items) {
            const id = m.fm_guid || m.code;
            const t = m.temperature;
            if (t !== null && t !== undefined && id) {
              let color: [number, number, number] = [0, 200, 0];
              if (t < 18) color = [0, 100, 255];
              else if (t < 20) color = [100, 200, 255];
              else if (t > 26) color = [255, 50, 50];
              else if (t > 24) color = [255, 150, 0];
              else if (t > 22) color = [255, 220, 0];
              colorMap[id] = color;
            }
          }
        }
      }

      // If message is still empty, provide a helpful fallback
      if (!message) {
        const count = sensorResult.room_count || sensorResult.machine_count || 0;
        message = `${buildingName} has ${count} rooms with sensor data, but no current readings could be retrieved right now.`;
      }

      return {
        message,
        response_type: "data_query", action: Object.keys(colorMap).length > 0 ? "colorize" : "none",
        buttons: makeButtons([
          { label: "Building Overview", action: "building_summary" },
          { label: "Show all rooms", action: "category_query", payload: { category: "Space" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Show temperature in viewer", "Which rooms have high CO2?", "Show air quality"],
        sensor_data: sensorData.length > 0 ? sensorData : undefined,
        color_map: Object.keys(colorMap).length > 0 ? colorMap : undefined,
      };
    }

    case "room_sensor_query": {
      if (!buildingGuid) {
        return null; // Fall through to AI
      }
      const metric = intent.payload.metric || "temperature";
      const order = intent.payload.order || "desc";
      const res: any = await execRoomSensorData(supabase, { building_guid: buildingGuid, metric, order });
      if (!res.available) {
        return {
          message: `No sensor data registered for ${buildingName}.`,
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Building Overview", action: "building_summary" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Show all rooms", "Building Overview"],
        };
      }
      const unit = metric === "temperature" ? "°C" : metric === "co2" ? " ppm" : metric === "humidity" ? "%" : "%";
      const label = metric === "temperature" ? "temperature" : metric === "co2" ? "CO₂" : metric === "humidity" ? "humidity" : "occupancy";
      const avg = res.averages?.[metric];
      const hi = metric === "co2" ? res.highest_co2 : metric === "humidity" ? res.highest_humidity : res.highest_temperature;
      const lo = res.lowest_temperature;
      let message = `**${label}** i ${buildingName} (${res.room_count} rum med data):`;
      if (avg !== null && avg !== undefined) message += `\n• Average: **${avg}${unit}**`;
      if (hi) message += `\n• Highest: **${hi.name}** (${Math.round(hi.value * 10) / 10}${unit})`;
      if (metric === "temperature" && lo) message += `\n• Lowest: **${lo.name}** (${Math.round(lo.value * 10) / 10}${unit})`;
      // Temperature colorize map (same scale as iot_query)
      const colorMap: Record<string, [number, number, number]> = {};
      if (metric === "temperature") {
        for (const r of res.rooms || []) {
          const t = r.temperature;
          if (t !== null && t !== undefined && r.fm_guid) {
            let color: [number, number, number] = [0, 200, 0];
            if (t < 18) color = [0, 100, 255]; else if (t < 20) color = [100, 200, 255];
            else if (t > 26) color = [255, 50, 50]; else if (t > 24) color = [255, 150, 0]; else if (t > 22) color = [255, 220, 0];
            colorMap[r.fm_guid] = color;
          }
        }
      }
      return {
        message,
        response_type: "data_query", action: Object.keys(colorMap).length > 0 ? "colorize" : "none",
        buttons: makeButtons([
          { label: "Show temperature in viewer", action: "iot_query", payload: { sensor_type: "temperature" } },
          { label: "Building Overview", action: "building_summary" },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Which room has the highest CO₂?", "What is the average humidity?", "Show all rooms"],
        color_map: Object.keys(colorMap).length > 0 ? colorMap : undefined,
      };
    }

    case "faciliate_count": {
      const objectType = intent.payload.object_type || "workorder";
      const label = objectType === "rentlandlord" ? "rental contracts" : objectType === "maintenance" ? "planned maintenance records" : "work orders";
      const res: any = await execQueryFaciliate(supabase, { object_type: objectType, mode: "count" });
      if (res.hint) {
        return {
          message: res.hint,
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Building Overview", action: "building_summary" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Show work orders", "Building Overview"],
        };
      }
      return {
        message: `There are **${res.count}** ${label} in Faciliate.`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: "Show examples", action: "free_text" },
          { label: "Building Overview", action: "building_summary" },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Show some work orders", "How many rental contracts exist?", "How many maintenance records exist?"],
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

/** Lowercase + strip diacritics so missing å/ä/ö still matches ("dorrar" → "dörrar", "manga" → "många"). */
function foldAccents(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase().normalize("NFD")) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x300 && c <= 0x36f) continue; // skip combining diacritics
    out += ch;
  }
  return out;
}
const KNOWN_OBJECT_TYPES_FOLDED: Record<string, { category: string }> =
  Object.fromEntries(Object.entries(KNOWN_OBJECT_TYPES).map(([k, v]) => [foldAccents(k), v]));
const KNOWN_SYSTEMS_FOLDED: Record<string, string> =
  Object.fromEntries(Object.entries(KNOWN_SYSTEMS).map(([k, v]) => [foldAccents(k), v]));
/** Accent-tolerant lookups for the fast-path dictionaries. */
function lookupObjectType(word: string): { category: string } | null {
  return KNOWN_OBJECT_TYPES[word] || KNOWN_OBJECT_TYPES_FOLDED[foldAccents(word)] || null;
}
function lookupSystem(word: string): string | null {
  return KNOWN_SYSTEMS[word] || KNOWN_SYSTEMS_FOLDED[foldAccents(word)] || null;
}

// IoT / sensor keywords that should trigger live sensor data lookup
const IOT_KEYWORDS = new Set([
  "temperatur", "temperature", "temp",
  "co2", "koldioxid", "carbon dioxide",
  "fuktighet", "humidity", "fukt",
  "luftkvalitet", "air quality", "inomhusklimat", "indoor climate",
  "beläggning", "occupancy", "beläggninsgrad",
  "sensorer", "sensors", "iot", "sensordata", "sensor data",
  "ljus", "light", "belysning",
  "hur varmt", "how warm", "hur kallt", "how cold",
]);

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
  const ot = lookupObjectType(lower);
  if (buildingGuid && ot) {
    return { action: "category_query", payload: { category: ot.category } };
  }

  // Match known system
  const sys = lookupSystem(lower);
  if (buildingGuid && sys) {
    return { action: "system_query", payload: { system: sys } };
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
      const sot = lookupObjectType(subject);
      if (sot) {
        return { action: "category_query", payload: { category: sot.category } };
      }
      const ssys = lookupSystem(subject);
      if (ssys) {
        return { action: "system_query", payload: { system: ssys } };
      }
      return { action: "system_query", payload: { system: subject } };
    }
  }

  return null;
}

/** Strip noise words from a Swedish/English query to extract the core object term */
function extractCoreTerm(raw: string): string {
  return raw
    .replace(/\b(har|finns|det|i|på|för|alla|samtliga|i byggnaden|in building|the|a|an|we|have|are|there|vi|den|denna|detta|rummet|byggnaden|huset)\b/gi, "")
    .replace(/[?!.,]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detect count/listing questions like "hur många rum", "vilka system finns", "antal dörrar" */
function detectCountOrListQuestion(text: string, buildingGuid: string | null): ButtonActionIntent | null {
  if (!buildingGuid) return null;

  // "hur många X" / "how many X"  (tolerate missing å: "hur manga")
  const countMatch = text.match(/^(hur\s+m[åa]nga|how\s+many|antal)\s+(.+)$/i);
  if (countMatch) {
    const core = extractCoreTerm(countMatch[2]);
    const cat = matchCategory(core);
    if (cat) return { action: "category_query", payload: { category: cat } };
    const sys = lookupSystem(core);
    if (sys) return { action: "system_query", payload: { system: sys } };
    // Unknown object type (e.g. attribute questions like "rum med parkett") → let the AI handle it
    return null;
  }

  // "vilka X finns" / "which X exist" / "lista X" / "list X"
  const listMatch = text.match(/^(vilka|which|lista|list)\s+(.+)$/i);
  if (listMatch) {
    const core = extractCoreTerm(listMatch[2]);
    const cat = matchCategory(core);
    if (cat) return { action: "category_query", payload: { category: cat } };
    const sys = lookupSystem(core);
    if (sys) return { action: "system_query", payload: { system: sys } };
    // "vilka system finns" → building summary
    if (/system/i.test(core)) return { action: "building_summary", payload: {} };
    // Unknown → let AI handle it
    return null;
  }

  // "finns det X" / "is there X" / "har vi X"
  const existsMatch = text.match(/^(finns\s+det|is\s+there|har\s+vi|have\s+we)\s+(.+)$/i);
  if (existsMatch) {
    const core = extractCoreTerm(existsMatch[2]);
    const cat = matchCategory(core);
    if (cat) return { action: "category_query", payload: { category: cat } };
    const sys = lookupSystem(core);
    if (sys) return { action: "system_query", payload: { system: sys } };
    // Unknown → let AI handle it
    return null;
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

  // Drawings/documents are handled by the AI (show_drawing action) — never fast-path them
  if (/\b(ritning|ritningen|ritningar|drawing|dokument|document)/i.test(text)) return null;

  const folded = foldAccents(text);

  // 0) Faciliate counts (work orders / fault reports / contracts / maintenance) → cache.
  // Only fast-path the GLOBAL count. If the user scopes to a building ("för/i <namn>")
  // or there's an active building, defer to the AI so it can filter (and be honest if
  // building info isn't synced) instead of returning a misleading total.
  const facMatch = folded.match(/\b(hur\s+m[a]nga|antal|how\s+many)\b.*\b(arbetsorder|arbetsordrar|felanmal|workorder|hyreskontrakt|kontrakt|rentlandlord|underhall|maintenance)/);
  if (facMatch) {
    const buildingScoped = /\b(for|i|pa)\s+\S/.test(folded) || !!context?.currentBuilding?.fmGuid;
    if (buildingScoped) return null; // let the AI handle building-scoped Faciliate questions
    const obj = /hyreskontrakt|kontrakt|rentlandlord/.test(folded) ? "rentlandlord"
      : /underhall|maintenance/.test(folded) ? "maintenance" : "workorder";
    return { action: "faciliate_count", payload: { object_type: obj } };
  }

  // 1) Count/list questions get priority (prevents broad regex from catching them)
  const countIntent = detectCountOrListQuestion(text, buildingGuid);
  if (countIntent) return countIntent;

  // 2) Analytical sensor questions (average / warmest / highest) → DB sensor cache (fast).
  // No \b boundaries: Swedish compounds like "medeltemperaturen" are single words.
  if (buildingGuid) {
    const analytical = /(medel|genomsnitt|average|varmast|kallast|warmest|coldest|hogst|lagst|highest|lowest)/.test(folded);
    const tempWord = /(varmast|kallast|warmest|coldest)/.test(folded);
    const metricWord = /(temperatur|temp|co2|koldioxid|fukt|humid|belaggning|occupancy|luftkvalitet|inomhusklimat)/.test(folded);
    if (analytical && (tempWord || metricWord)) {
      const metric = /(co2|koldioxid)/.test(folded) ? "co2"
        : /(fukt|humid)/.test(folded) ? "humidity"
        : /(belag|occup)/.test(folded) ? "occupancy"
        : "temperature";
      const order = /(kallast|lagst|coldest|lowest|minst)/.test(folded) ? "asc" : "desc";
      return { action: "room_sensor_query", payload: { metric, order } };
    }
    // 3) Other IoT/sensor questions — live data (auto-falls back to DB cache)
    const iotMatch = text.match(/\b(temperatur|temperature|temp|co2|koldioxid|fuktighet|humidity|luftkvalitet|air quality|inomhusklimat|indoor climate|beläggning|occupancy|sensordata|sensor data|hur varmt|how warm|hur kallt|how cold)\b/i);
    if (iotMatch) {
      return { action: "iot_query", payload: { sensor_type: "all" } };
    }
  }

  // Detect if user explicitly wants viewer action
  const viewerKeywords = /(visa\s+i\s+(viewern|3d|modell)|markera|highlight|show\s+in\s+(viewer|3d)|färglägg|colorize)/i;
  const wantsViewer = viewerKeywords.test(text);

  // "byggnadsöversikt" / "building overview"
  if (buildingGuid && /^(byggnadsöversikt|översikt|building overview|overview|sammanfattning|summary)/i.test(text)) {
    return { action: "building_summary", payload: {} };
  }

  // "vad finns i rummet" / "objekt i rummet"
  if (context?.currentSpace?.fmGuid && /^(vad finns|objekt|assets|utrustning)\s*(i|in)\s*(rummet|detta rum|this room|the room)/i.test(text)) {
    return { action: "room_query", payload: { room_guid: context.currentSpace.fmGuid, wantsViewer: wantsViewer ? "true" : "false" } };
  }

  // "visa X" / "show X" / "filtrera X" — only match explicit show/filter commands
  const showMatch = text.match(/^(visa|show|filtrera|filter)\s+(.+)$/i);
  if (showMatch && buildingGuid) {
    const core = extractCoreTerm(showMatch[2]);
    if (core.length < 2 || core.length > 40) return null;

    // Check known categories first
    const catMatch = matchCategory(core);
    if (catMatch) {
      return wantsViewer
        ? { action: "viewer_highlight", payload: { category: catMatch } }
        : { action: "category_query", payload: { category: catMatch } };
    }

    // Check known systems
    const coreSys = lookupSystem(core);
    if (coreSys) {
      return wantsViewer
        ? { action: "viewer_highlight", payload: { system: coreSys } }
        : { action: "system_query", payload: { system: coreSys } };
    }

    // If core is clean and short (likely a real object name), try system_query
    if (core.split(/\s+/).length <= 3) {
      return wantsViewer
        ? { action: "viewer_highlight", payload: { system: core } }
        : { action: "system_query", payload: { system: core } };
    }

    // Longer/complex → let AI handle it
    return null;
  }

  // Explicit viewer commands (markera/highlight)
  const highlightMatch = text.match(/^(markera|highlight)\s+(.+)$/i);
  if (highlightMatch && buildingGuid) {
    const core = extractCoreTerm(highlightMatch[2]);
    if (core.length < 2) return null;
    const catMatch = matchCategory(core);
    if (catMatch) return { action: "viewer_highlight", payload: { category: catMatch } };
    const hlSys = lookupSystem(core);
    if (hlSys) return { action: "viewer_highlight", payload: { system: hlSys } };
    if (core.split(/\s+/).length <= 3) return { action: "viewer_highlight", payload: { system: core } };
    return null;
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
      message = "Hello! How can I help you today?";
      buttons = [{ label: "Building Overview", action: "building_summary" }, { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } }, { label: "Search equipment", action: "search_prompt" }];
      suggestions = ["What systems exist?", "Show all rooms"];
      break;
    case "thanks":
      message = "You're welcome! Is there anything else I can help with?";
      buttons = [{ label: "Building Overview", action: "building_summary" }, { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } }, { label: "Search equipment", action: "search_prompt" }];
      suggestions = ["Show all assets", "Open issues"];
      break;
    case "help":
      message = "I can help with building data, systems, 3D navigation and search.";
      buttons = [{ label: "Building Overview", action: "building_summary" }, { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } }, { label: "Search equipment", action: "search_prompt" }];
      suggestions = ["What systems exist?", "Show all rooms", "Open issues"];
      break;
    case "confirmation": {
      const prevMsgs = previousConversation?.messages || [];
      const lastAssistant = [...prevMsgs].reverse().find((m: any) => m.role === "assistant");
      if (lastAssistant?.content) {
        message = "Great! What would you like to do next?";
      } else {
        message = "What can I help you with?";
      }
      buttons = [{ label: "Building Overview", action: "building_summary" }, { label: "Show ventilation", action: "system_query", payload: { system: "ventilation" } }, { label: "Search equipment", action: "search_prompt" }];
      suggestions = ["What systems exist?", "Show all rooms", "Open issues"];
      break;
    }
  }
  return { message, response_type: "answer", action: "none", buttons, asset_ids: [], external_entity_ids: [], filters: {}, suggestions };
}

/* ─────────────────────────────────────────────
   System prompt — static cacheable core + dynamic context
   ───────────────────────────────────────────── */

// Static core — no interpolation, so the prompt-cache prefix (tools + this block) stays stable.
const STATIC_SYSTEM_PROMPT = `You are Geminus AI — an interactive interface for digital twin / BIM applications.

YOUR GOAL: Help the user forward. Minimize typing. Maximize clickable options. Always give next steps.

LANGUAGE & TERMINOLOGY:
- Respond in Swedish (unless user writes in English).
- Never use raw IFC/BIM category names in user-facing text. Translate them:
  • "Instance" → "utrustning" eller "komponenter"
  • "Space" → "rum"
  • "Building Storey" → "våning" / "våningar"
  • "Building" → "byggnad"
  • "IfcDoor" → "dörrar"
  • "IfcWindow" → "fönster"
  • "IfcWall" / "IfcWallStandardCase" → "väggar"
  • "IfcSlab" → "bjälklag"
  • "IfcBeam" → "balkar"
  • "IfcColumn" → "pelare"
  • "IfcRoof" → "tak"
  • "IfcStair" / "IfcStairFlight" → "trappor"
  • "IfcRailing" → "räcken"
  • "IfcCovering" → "ytbeklädnad"
  • "IfcFurniture" → "möbler"
  • "IfcSensor" / "IfcAlarm" → "sensorer" / "larm"
  • "IfcPipeSegment" → "rör"
  • "IfcDuctSegment" → "ventilationskanaler"
  • "IfcFlowTerminal" → "don" (ventilationsdon, tappställen)
  • "IfcValve" → "ventiler"
  • "IfcPump" → "pumpar"
  • "IfcBoiler" → "pannor"
  • Other "Ifc..." types → describe in plain Swedish (e.g. "elinstallation", "VS-komponenter")
- Use category names a fastighetsförvaltare or drifttekniker would understand.
- When listing asset types, translate to plain Swedish (e.g. "52 dörrar, 120 ventilationsdon, 38 rör").

TOOL CALLING FLOW:
- Use data tools to gather facts before answering — never fabricate building data.
- Work silently between tool calls: do not narrate ("Jag kollar...", "Låt mig hämta..."). Only write text as your final answer.
- When you have results to show, call present_results ONCE (after data tools, before your final answer) with:
  • action: Default "none". Only "highlight"/"filter"/"colorize" when the user explicitly asks to see things in the viewer/3D.
  • buttons: 2-3 clickable ACTION buttons (e.g. "Visa i viewer", "Filtrera dörrar", "Byggnadsöversikt").
  • suggestions: 2-3 proactive follow-up questions.
  • asset_ids / external_entity_ids / color_map when relevant for the viewer.
- Write your final answer text and call present_results in the SAME response (text first, then the present_results call) — do not split them across turns. This keeps responses fast.
- Your plain text IS the chat message shown to the user: short and concrete, max 2-3 sentences.

IoT / SENSOR DATA:
- For analytical/ranking questions (e.g. "which room is warmest", "average temperature", "humidity in room 232"), use get_room_sensor_data. This queries cached sensor attributes stored on rooms in the database.
- For real-time data, use get_live_sensor_data (fetches from Geminus Premium platform). It will automatically fall back to DB data if live data is unavailable.
- get_room_sensor_data supports: temperature, co2, humidity, occupancy. You can sort by any metric and filter by floor.
- Prefer get_room_sensor_data for questions about rankings, averages, or specific room sensor values.

ASSET PROPERTY QUERIES (attributes):
- For questions about asset/room properties like golvmaterial, material, ytskikt etc., use query_assets with attribute filters.
- If you don't know the exact attribute key: call list_attribute_keys first and pick the best matching key.
- Example "hur många rum har parkett?": list_attribute_keys → find the floor material key → query_assets(category="Space", attribute_key=<key>, attribute_value="parkett", mode="count").
- Example "vilka golvmaterial finns?": query_assets(mode="group", group_by=<key>).
- If the result has truncated=true, mention that the count is based on the first 4000 assets.

VIEWER VISUALIZATION (colorize):
- To color specific objects (e.g. "visa alla innerdörrar blåa i 3D"): query_assets(mode="list", category="Instance", asset_type="IfcDoor", name_search="innerdörr") → present_results with action="colorize" and color_map mapping EACH matching asset fm_guid to [R,G,B] (0-255). fm_guids are auto-resolved to viewer entity ids.
- RGB examples: blå=[0,100,255], röd=[255,60,60], grön=[0,200,0], gul=[255,220,0], orange=[255,150,0].

FACILIATE FM DATA (work orders, contracts, maintenance):
- For questions about work orders/fault reports (arbetsorder, felanmälan), rental contracts (hyreskontrakt) or planned maintenance (planerat underhåll), use query_faciliate.
- object_type: "workorder" (work orders & fault reports), "rentlandlord" (contracts), "maintenance" (planned maintenance).
- status filter matches the status TITLE: use "Öppen" for open, "Avslutad" for closed (not numbers).
- BUILDING SCOPE: when the user asks about a specific building (e.g. "för Småviken"), pass building="<name>" to query_faciliate. If the result has building_filter_unavailable=true, give the TOTAL and add a brief plain note that you can't break it down per building right now. NEVER present a global total as if it were the building's count.
- Example "hur många öppna arbetsordrar finns?": query_faciliate(object_type="workorder", status="Öppen", mode="count").
- TONE ON MISSING DATA: if a tool returns a hint/note that you have no information, relay it in plain everyday language. NEVER mention internal plumbing — no "cache", "synk", "connector", "databas", "administratör". Just say e.g. "Jag har ingen information om planerat underhåll just nu." Do NOT state as fact that there are zero records.
- When listing work orders, format as a clean numbered/bulleted list (not a wide table): "**Titel** — status" per line. Suggest concrete follow-ups (e.g. "Visa bara öppna", "Visa felanmälningar").

PREDICTIVE MAINTENANCE & SPACE OPTIMIZATION (Insights AI):
- For questions about maintenance risks, equipment health, upcoming failures, or "vilket underhåll behövs" / "vilken utrustning är i riskzonen": call run_predictive_maintenance(building_guid). It returns predictions with riskLevel (high/medium/low), category, estimatedTimeToFailure, and an overallRiskScore. Summarize highlights — start with high-risk items.
- For questions about space efficiency, underutilized rooms, space savings, or "hur används lokalerna": call run_room_optimization(building_guid). It returns utilizationScore, statistics, and suggestions with type/priority. Summarize the score and top 2-3 suggestions.
- These analyses take a few seconds. Don't say "Jag analyserar..." — just call the tool and report results.
- You CAN combine these with colorize: for predictive maintenance, map room_guids to risk colors (high=[255,60,60], medium=[255,180,0], low=[0,200,0]); for optimization, color underutilized rooms orange, overcrowded rooms red.

DOCUMENT SEARCH (RAG):
- For questions about what's written in documents, technical specs, product manuals, or "vad säger dokumentationen om X": call search_documents(query, building_guid).
- Report the answer field directly. Cite sources from the sources array. If confidence < 0.5, note that the answer may be incomplete.
- If no documents are found, say "Inga dokument hittades som svarar på din fråga."

2D DRAWINGS (Geminus Base):
- When the user asks to see the drawing ("ritningen") for a floor: resolve the floor via get_building_summary (it returns floors with fm_guid + name), then call present_results with action="show_drawing" and drawing={building_fm_guid, storey_fm_guid, storey_name}. storey_name is the floor's display name (e.g. "Plan 2"). This opens the Geminus Base 2D drawing.

RULES:
1. Never write stop-answers like "Jag kunde inte slutföra sökningen". If data is missing, interpret and suggest alternatives.
2. Every response should include buttons and suggestions via present_results.
3. Always pass building_guid to data tools when available.
4. Respond in the SAME LANGUAGE as the user (default Swedish).
5. Never show UUIDs/GUIDs in message text.
6. Max 2-3 sentences in the final answer.
7. Never use IFC class names (IfcXxx) in the final answer — always use Swedish terms.
8. When currentBuilding is null but the user's request or recent conversation names a building (e.g. "Visa ventilation" after asking about "Småviken's temperature"), call resolve_building_by_name FIRST with that building name, then proceed. NEVER respond with "Ingen byggnad är vald" when the building is implied by context — always infer and resolve.
9. After sensor/temperature data answers (e.g. "varmaste rummen", ranking by temperature/CO₂), always include a "Visa i 3D" button in present_results with action="colorize" so the user can jump directly to the color visualization.
10. For "vilka/hur många BIM-modeller finns" questions, ALWAYS call list_bim_models — NEVER answer from get_building_summary's floor/room/asset counts, and never assume there is only one model. A building is commonly made up of several separate models (architecture, el, ventilation, etc.) synced from Geminus Plus.`;

async function buildDynamicContext(supabase: any, context: any, userProfile: any, previousConversation: any) {
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

  // When no building is selected, scan conversation for implicit building context
  let implicitBuildingCtx = "";
  if (!context?.currentBuilding?.fmGuid && previousConversation?.messages?.length) {
    try {
      const { data: buildings } = await supabase
        .from("assets")
        .select("fm_guid, common_name, name")
        .eq("category", "Building")
        .limit(50);
      if (buildings?.length) {
        const prevText = previousConversation.messages
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .slice(-6)
          .map((m: any) => typeof m.content === "string" ? m.content : JSON.stringify(m.content))
          .join(" ")
          .toLowerCase();
        for (const b of buildings) {
          const bName = (b.common_name || b.name || "").toLowerCase().trim();
          if (bName.length >= 4 && prevText.includes(bName)) {
            implicitBuildingCtx = `\nIMPLICIT BUILDING FROM CONVERSATION: "${b.common_name || b.name}" (fm_guid: ${b.fm_guid}). The recent conversation strongly implies this is the target building. Pass fm_guid="${b.fm_guid}" directly to viewer and data tools — do NOT call resolve_building_by_name again.`;
            break;
          }
        }
      }
    } catch (e) { console.error("Implicit building scan failed:", e); }
  }

  const buildingAlreadyResolved = context?.currentBuilding?.fmGuid
    ? `\nThe current building "${context.currentBuilding.name}" (fm_guid: ${context.currentBuilding.fmGuid}) is ALREADY resolved. Do NOT call resolve_building_by_name for it. Always pass building_guid="${context.currentBuilding.fmGuid}" to data tools.`
    : "";

  return `CURRENT SESSION CONTEXT:${buildingAlreadyResolved}${userCtx}${ctx}${modelsCtx}${memoryCtx}${implicitBuildingCtx}`;
}

/* ─────────────────────────────────────────────
   Claude API — streamed agentic round with model fallback
   ───────────────────────────────────────────── */

function getAnthropicClient(): Anthropic {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  return new Anthropic({ apiKey });
}

/** Run one model round with token streaming. Falls back to the secondary model on 5xx/529. */
async function runClaudeRound(
  client: Anthropic,
  params: {
    system: any;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.Tool[];
    onTextDelta: (text: string) => void;
  },
  model = AI_MODEL_PRIMARY,
): Promise<Anthropic.Message> {
  try {
    const stream = client.messages.stream({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Thinking disabled on the interactive path: the tools do the work, and
      // skipping the thinking pre-amble cuts seconds off time-to-first-token.
      system: params.system,
      messages: params.messages,
      tools: params.tools,
    });
    stream.on("text", params.onTextDelta);
    return await stream.finalMessage();
  } catch (err: any) {
    if (err instanceof Anthropic.RateLimitError) {
      throw { status: 429, message: "Rate limit exceeded. Please try again in a moment." };
    }
    if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500 && model === AI_MODEL_PRIMARY) {
      console.warn(`Claude ${model} failed (${err.status}), falling back to ${AI_MODEL_FALLBACK}`);
      return runClaudeRound(client, params, AI_MODEL_FALLBACK);
    }
    console.error(`Claude API error (${model}):`, err?.status, err?.message || err);
    throw err;
  }
}

/** Generate fallback suggestions when AI doesn't provide them */
function generateFallbackSuggestions(result: any, context: any): string[] {
  const buildingName = context?.currentBuilding?.name;
  if (result?.action === "colorize") {
    return ["Show temperature in more rooms", "Which sensors are available?", "Building overview"];
  }
  return [
    buildingName ? `Which systems exist in ${buildingName}?` : "Which systems exist?",
    "Show all rooms",
    "Open issues",
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
    const anthropic = getAnthropicClient();

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

    // ── Full agentic loop: Claude + tools + SSE token streaming ──
    let dynamicContext = await buildDynamicContext(supabase, context, userProfile, previousConversation);
    if (userMemories) dynamicContext += userMemories;

    // Static block carries the cache breakpoint → tools + core prompt are cached across turns.
    const systemBlocks = [
      { type: "text", text: STATIC_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: dynamicContext },
    ];

    // Anthropic requires the first message to be from the user
    const conversation: Anthropic.MessageParam[] = messages
      .filter((m: any) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m: any) => ({ role: m.role, content: m.content }));
    while (conversation.length && conversation[0].role !== "user") conversation.shift();
    if (conversation.length === 0) {
      return new Response(JSON.stringify({ error: "No user message provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const activeTools = toAnthropicTools(
      context?.currentBuilding?.fmGuid
        ? tools.filter((t: any) => t.function.name !== "resolve_building_by_name")
        : tools
    );

    const sseHeaders = { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" };
    const encoder = new TextEncoder();
    const sse = (data: any) => `data: ${JSON.stringify(data)}\n\n`;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => { try { controller.enqueue(encoder.encode(sse(data))); } catch {} };
        try {
          send({ type: "status", message: "Analyzing query…" });

          let presentMeta: any = null;
          let fullText = "";

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            if (round > 0) send({ type: "status", message: "Processing results…" });

            // Buffer this round's text; only the FINAL round's text is the answer.
            // Intermediate rounds may contain step narration which we must not show.
            let roundText = "";
            const response = await runClaudeRound(anthropic, {
              system: systemBlocks,
              messages: conversation,
              tools: activeTools,
              onTextDelta: (delta: string) => { roundText += delta; },
            });

            conversation.push({ role: "assistant", content: response.content });

            const toolUses = response.content.filter((b: any) => b.type === "tool_use");

            // Terminal: a plain answer with no tool calls — this text is the answer.
            if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
              if (roundText.trim()) { fullText = roundText; send({ type: "delta", content: roundText }); }
              console.log(`Geminus AI: final answer (${Date.now() - startTime}ms, round ${round + 1}, stop_reason: ${response.stop_reason})`);
              break;
            }

            console.log(`Geminus AI round ${round + 1}: ${toolUses.length} tool(s): ${toolUses.map((t: any) => t.name).join(", ")} (${Date.now() - startTime}ms)`);

            const toolResults = await Promise.all(
              toolUses.map(async (tu: any) => {
                try {
                  const result = await executeTool(supabase, tu.name, tu.input || {});
                  if (tu.name === "present_results") {
                    presentMeta = result;
                    // Keep the loop context lean — the metadata goes to the frontend, not back to the model
                    return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify({ ok: true }) };
                  }
                  return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify(result) };
                } catch (err) {
                  console.error(`Tool ${tu.name} error:`, err);
                  return { type: "tool_result" as const, tool_use_id: tu.id, content: JSON.stringify({ error: String(err) }), is_error: true };
                }
              })
            );
            conversation.push({ role: "user", content: toolResults });

            // Terminal: model wrote its answer text AND called present_results in
            // the same turn — flush that text and stop (no extra round needed).
            if (presentMeta && roundText.trim()) {
              fullText = roundText;
              send({ type: "delta", content: roundText });
              console.log(`Geminus AI: text + present_results same turn, done (${Date.now() - startTime}ms, round ${round + 1})`);
              break;
            }
            // Otherwise roundText (if any) was intermediate narration — discard it.
          }

          // Guard: the model finished without any user-facing text
          if (!fullText.trim()) {
            fullText = "Here is the result — see the options below.";
            send({ type: "delta", content: fullText });
          }

          const structured: any = {
            response_type: presentMeta?.response_type || "answer",
            action: presentMeta?.action || "none",
            buttons: convertAiButtons(presentMeta?.buttons, context),
            asset_ids: presentMeta?.asset_ids || [],
            external_entity_ids: presentMeta?.external_entity_ids || [],
            filters: presentMeta?.filters || {},
            suggestions: presentMeta?.suggestions?.length ? presentMeta.suggestions : generateFallbackSuggestions(presentMeta, context),
          };
          if (presentMeta?.sensor_data?.length) structured.sensor_data = presentMeta.sensor_data;
          if (presentMeta?.color_map && Object.keys(presentMeta.color_map).length) structured.color_map = presentMeta.color_map;
          if (presentMeta?.drawing) structured.drawing = presentMeta.drawing;

          send({ type: "meta", ...structured });
          send({ type: "done" });

          const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
          saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content: fullText }]).catch(() => {});
        } catch (err: any) {
          console.error("SSE stream error:", err);
          const send2 = (data: any) => { try { controller.enqueue(encoder.encode(sse(data))); } catch {} };
          send2({ type: "error", message: err?.message || "Unknown error", status: err?.status });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: sseHeaders });
  } catch (e: any) {
    console.error("Geminus AI error:", e);
    const status = e?.status || 500;
    const message = e?.message || (e instanceof Error ? e.message : "Unknown error");
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
