import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";
import { getSenslincCredentials } from "../_shared/credentials.ts";

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
  // ── Live IoT sensor data (via Senslinc) ──
  {
    type: "function",
    function: {
      name: "get_live_sensor_data",
      description: "Get LIVE IoT sensor readings (temperature, CO2, humidity, occupancy, light) for the current building or a specific room. Data comes from the Senslinc/InUse platform. Use when user asks about temperature, air quality, indoor climate, CO2, humidity, occupancy.",
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
    case "get_live_sensor_data":
      return execLiveSensorData(supabase, args);
    case "get_room_sensor_data":
      return execRoomSensorData(supabase, args);
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

/* ── Live IoT sensor data via Senslinc ── */

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
    const creds = await getSenslincCredentials(supabase, buildingGuid);
    if (!creds.apiUrl || !creds.email || !creds.password) {
      return { error: "No Senslinc/InUse credentials configured for this building", available: false };
    }

    const roomGuids = args.room_fm_guids as string[] | undefined;

    if (roomGuids?.length) {
      // Fetch data for specific rooms
      const results: any[] = [];
      for (const roomGuid of roomGuids.slice(0, 10)) {
        try {
          const { data } = await supabase.functions.invoke('senslinc-query', {
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
      return { available: results.length > 0, source: "Senslinc/InUse (live)", rooms: results, room_count: results.length };
    } else {
      // Building-level: get all machines for the site
      const { data } = await supabase.functions.invoke('senslinc-query', {
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
    source: "Senslinc/InUse (live)",
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
      const categoryLabel = category === "Space" ? "rum" : category === "Instance" ? "tillgångar" : category === "Door" ? "dörrar" : category === "Building Storey" ? "våningar" : category;

      if (totalCount === 0) {
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
        summary = `\n\nFördelning (topp): ${topTypes}`;
      }

      return {
        message: `Det finns **${totalCount}** ${categoryLabel} i ${buildingName}.${summary}`,
        response_type: "data_query", action: "none",
        buttons: makeButtons([
          { label: `Visa ${categoryLabel} i viewer`, action: "viewer_highlight", payload: { category } },
          { label: "Filtrera per våning", action: "floor_query" },
          { label: "Byggnadsöversikt", action: "building_summary" },
        ]),
        asset_ids: assetIds.slice(0, 50), external_entity_ids: [], filters: { category },
        suggestions: [`Visa ${categoryLabel} i viewer`, "Visa annan utrustning", "Vilka våningar finns?"],
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
              { label: `Visa ${system} i viewer`, action: "viewer_highlight", payload: { system } },
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

    case "iot_query": {
      if (!buildingGuid) {
        return {
          message: "Ingen byggnad är vald. Välj en byggnad först.",
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Visa alla byggnader", action: "list_buildings" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Vilka byggnader finns?"],
        };
      }
      const sensorType = intent.payload.sensor_type || "all";
      const roomGuids = intent.payload.room_guid ? [intent.payload.room_guid] : undefined;
      const sensorResult = await execLiveSensorData(supabase, { building_guid: buildingGuid, room_fm_guids: roomGuids });

      if (!sensorResult.available) {
        return {
          message: `Inga sensordata tillgängliga för ${buildingName}.`,
          response_type: "answer", action: "none",
          buttons: makeButtons([{ label: "Byggnadsöversikt", action: "building_summary" }]),
          asset_ids: [], external_entity_ids: [], filters: {},
          suggestions: ["Visa alla rum", "Byggnadsöversikt"],
        };
      }

      // Build response — handle both Senslinc live format and DB fallback format
      let message = "";
      const sensorData: any[] = [];
      const colorMap: Record<string, [number, number, number]> = {};
      const isDbSource = sensorResult.source?.includes("database");

      if (sensorResult.rooms?.length && !sensorResult.averages) {
        // Room-specific live data (single room query)
        const room = sensorResult.rooms[0];
        const roomName = room.machine_name || room.name || "Okänt rum";
        const parts: string[] = [];
        if (room.temperature !== null && room.temperature !== undefined) parts.push(`${room.temperature.toFixed(1)}°C`);
        if (room.co2 !== null && room.co2 !== undefined) parts.push(`CO₂: ${Math.round(room.co2)} ppm`);
        if (room.humidity !== null && room.humidity !== undefined) parts.push(`${room.humidity.toFixed(1)}% RH`);
        if (room.occupancy !== null && room.occupancy !== undefined) parts.push(`${Math.round(room.occupancy)}% beläggning`);
        message = `**Sensordata** för ${roomName}:\n${parts.join(" · ")}`;
      } else if (sensorResult.averages) {
        // Building-level data (both Senslinc and DB fallback)
        const avg = sensorResult.averages;
        const parts: string[] = [];
        if (avg.temperature !== null && avg.temperature !== undefined) parts.push(`Medeltemp: ${avg.temperature}°C`);
        if (avg.co2 !== null && avg.co2 !== undefined) parts.push(`CO₂: ${avg.co2} ppm`);
        if (avg.humidity !== null && avg.humidity !== undefined) parts.push(`Fuktighet: ${avg.humidity}%`);
        if (avg.occupancy !== null && avg.occupancy !== undefined) parts.push(`Beläggning: ${avg.occupancy}%`);

        const roomCount = sensorResult.room_count || sensorResult.machine_count || 0;
        message = `**Sensordata** för ${buildingName} (${roomCount} rum):\n${parts.join(" · ")}`;

        // Add highest/lowest info
        if (sensorResult.highest_temperature) {
          const ht = sensorResult.highest_temperature;
          message += `\n\nVarmast: **${ht.name || "Okänt rum"}** (${Math.round(ht.value * 10) / 10}°C)`;
        }
        if (sensorResult.lowest_temperature) {
          const lt = sensorResult.lowest_temperature;
          message += `\nKallast: **${lt.name || "Okänt rum"}** (${Math.round(lt.value * 10) / 10}°C)`;
        }
        if (sensorResult.highest_co2) {
          const hc = sensorResult.highest_co2;
          message += `\nHögst CO₂: **${hc.name || "Okänt rum"}** (${Math.round(hc.value)} ppm)`;
        }
        if (sensorResult.highest_humidity) {
          const hh = sensorResult.highest_humidity;
          message += `\nHögst fuktighet: **${hh.name || "Okänt rum"}** (${Math.round(hh.value * 10) / 10}%)`;
        }

        // Build color map for temperature visualization from rooms (DB) or machines (Senslinc)
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
        message = `${buildingName} har ${count} rum med sensordata, men inga aktuella mätvärden kunde hämtas just nu.`;
      }

      return {
        message,
        response_type: "data_query", action: Object.keys(colorMap).length > 0 ? "colorize" : "none",
        buttons: makeButtons([
          { label: "Byggnadsöversikt", action: "building_summary" },
          { label: "Visa alla rum", action: "category_query", payload: { category: "Space" } },
        ]),
        asset_ids: [], external_entity_ids: [], filters: {},
        suggestions: ["Visa temperatur i modell", "Vilka rum har hög CO2?", "Visa luftkvalitet"],
        sensor_data: sensorData.length > 0 ? sensorData : undefined,
        color_map: Object.keys(colorMap).length > 0 ? colorMap : undefined,
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

  // "hur många X" / "how many X"
  const countMatch = text.match(/^(hur\s+många|how\s+many|antal)\s+(.+)$/i);
  if (countMatch) {
    const core = extractCoreTerm(countMatch[2]);
    const cat = matchCategory(core);
    if (cat) return { action: "category_query", payload: { category: cat } };
    if (KNOWN_SYSTEMS[core]) return { action: "system_query", payload: { system: KNOWN_SYSTEMS[core] } };
    // Unknown object type → building summary shows all counts
    return { action: "building_summary", payload: {} };
  }

  // "vilka X finns" / "which X exist" / "lista X" / "list X"
  const listMatch = text.match(/^(vilka|which|lista|list)\s+(.+)$/i);
  if (listMatch) {
    const core = extractCoreTerm(listMatch[2]);
    const cat = matchCategory(core);
    if (cat) return { action: "category_query", payload: { category: cat } };
    if (KNOWN_SYSTEMS[core]) return { action: "system_query", payload: { system: KNOWN_SYSTEMS[core] } };
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
    if (KNOWN_SYSTEMS[core]) return { action: "system_query", payload: { system: KNOWN_SYSTEMS[core] } };
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

  // 1) Count/list questions get priority (prevents broad regex from catching them)
  const countIntent = detectCountOrListQuestion(text, buildingGuid);
  if (countIntent) return countIntent;

  // 2) IoT/sensor questions — route to live data (ranking questions included now via DB fallback)
  if (buildingGuid) {
    const iotMatch = text.match(/\b(temperatur|temperature|temp|co2|koldioxid|fuktighet|humidity|luftkvalitet|air quality|inomhusklimat|indoor climate|beläggning|occupancy|sensordata|sensor data|hur varmt|how warm|hur kallt|how cold|varmast|kallast|warmest|coldest)\b/i);
    if (iotMatch) {
      return { action: "iot_query", payload: { sensor_type: "all" } };
    }
  }

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
    if (KNOWN_SYSTEMS[core]) {
      return wantsViewer
        ? { action: "viewer_highlight", payload: { system: KNOWN_SYSTEMS[core] } }
        : { action: "system_query", payload: { system: KNOWN_SYSTEMS[core] } };
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
    if (KNOWN_SYSTEMS[core]) return { action: "viewer_highlight", payload: { system: KNOWN_SYSTEMS[core] } };
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

LANGUAGE & TERMINOLOGY — CRITICAL:
- ALWAYS respond in Swedish (unless user writes in English).
- NEVER use raw IFC/BIM category names in user-facing text. Translate them:
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

IoT / SENSOR DATA:
- For analytical/ranking questions (e.g. "which room is warmest", "average temperature", "humidity in room 232"), use get_room_sensor_data. This queries cached sensor attributes stored on rooms in the database.
- For real-time data, use get_live_sensor_data (fetches from Senslinc/InUse platform). It will automatically fall back to DB data if live data is unavailable.
- get_room_sensor_data supports: temperature, co2, humidity, occupancy. You can sort by any metric and filter by floor.
- ALWAYS prefer get_room_sensor_data for questions about rankings, averages, or specific room sensor values.

CRITICAL RULES:
1. NEVER write stop-answers like "Jag kunde inte slutföra sökningen". If data is missing, interpret and suggest alternatives.
2. Every response MUST have buttons and suggestions.
3. ALWAYS use tools to get data — never fabricate.
4. ALWAYS pass building_guid when available.
5. Respond in the SAME LANGUAGE as the user (default Swedish).
6. NEVER show UUIDs/GUIDs in message text.
7. Max 2-3 sentences in message.
8. NEVER use IFC class names (IfcXxx) in message text — always use Swedish terms.
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

/* ── SSE text streaming helper ── */

async function streamText(controller: ReadableStreamDefaultController, encoder: TextEncoder, text: string) {
  const words = text.split(/(\s+)/);
  let batch = "";
  for (let i = 0; i < words.length; i++) {
    batch += words[i];
    if (batch.length >= 8 || i === words.length - 1) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", content: batch })}\n\n`));
      } catch { break; }
      batch = "";
      if (i < words.length - 1) await new Promise(r => setTimeout(r, 20));
    }
  }
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

    // ── Full tool-calling loop with SSE streaming ──
    let systemPrompt = await buildSystemPrompt(supabase, context, userProfile, previousConversation);
    if (userMemories) systemPrompt += userMemories;

    const conversation: any[] = [{ role: "system", content: systemPrompt }, ...messages];

    const activeTools = context?.currentBuilding?.fmGuid
      ? tools.filter((t: any) => t.function.name !== "resolve_building_by_name")
      : tools;

    const sseHeaders = { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" };
    const encoder = new TextEncoder();
    const sse = (data: any) => `data: ${JSON.stringify(data)}\n\n`;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: any) => { try { controller.enqueue(encoder.encode(sse(data))); } catch {} };
        try {
          send({ type: "status", message: "Analyserar frågan…" });
          let formatResponseResult: any = null;
          let responded = false;

          for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const isLastRound = round === MAX_TOOL_ROUNDS - 1;
            const toolChoice = isLastRound
              ? { type: "function", function: { name: "format_response" } }
              : "auto";

            if (round > 0 && !formatResponseResult) send({ type: "status", message: "Bearbetar resultat…" });

            const resp = await callAI(LOVABLE_API_KEY, conversation, { tools: activeTools, tool_choice: toolChoice });
            const result = await resp.json();
            const choice = result.choices?.[0];

            if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
              const content = choice?.message?.content || "";
              console.log(`Gunnar: direct answer (${Date.now() - startTime}ms, round ${round + 1})`);
              await streamText(controller, encoder, content);
              send({ type: "meta", response_type: "answer", action: "none", buttons: generateFallbackButtons(context), asset_ids: [], external_entity_ids: [], filters: {}, suggestions: generateFallbackSuggestions({}, context) });
              send({ type: "done" });
              responded = true;
              const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
              saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content }]).catch(() => {});
              break;
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
                  return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: "Invalid arguments" }) };
                }
                try {
                  const toolResult = await executeTool(supabase, tc.function.name, args, LOVABLE_API_KEY);
                  if (tc.function.name === "format_response") formatResponseResult = toolResult;
                  return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify(toolResult) };
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
                response_type: formatResponseResult.response_type || "answer",
                action: formatResponseResult.action || "none",
                buttons: convertAiButtons(formatResponseResult.buttons, context),
                asset_ids: formatResponseResult.asset_ids || [],
                external_entity_ids: formatResponseResult.external_entity_ids || [],
                filters: formatResponseResult.filters || {},
                suggestions: formatResponseResult.suggestions?.length ? formatResponseResult.suggestions : generateFallbackSuggestions(formatResponseResult, context),
              };
              if (formatResponseResult.sensor_data?.length) structured.sensor_data = formatResponseResult.sensor_data;
              if (formatResponseResult.color_map && Object.keys(formatResponseResult.color_map).length) structured.color_map = formatResponseResult.color_map;

              const messageText = formatResponseResult.message || "";
              await streamText(controller, encoder, messageText);
              send({ type: "meta", ...structured });
              send({ type: "done" });
              responded = true;

              const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
              saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content: messageText }]).catch(() => {});
              break;
            }
          }

          if (!responded) {
            console.log(`Gunnar: max rounds reached (${Date.now() - startTime}ms)`);
            let lastAssistantText = "";
            for (let i = conversation.length - 1; i >= 0; i--) {
              if (conversation[i].role === "assistant" && typeof conversation[i].content === "string" && conversation[i].content.trim()) {
                lastAssistantText = conversation[i].content.trim();
                break;
              }
            }
            const fallbackMsg = lastAssistantText || "Jag har begränsad information om detta just nu.";
            await streamText(controller, encoder, fallbackMsg);
            send({ type: "meta", action: "none", buttons: defaultButtons(context), asset_ids: [], external_entity_ids: [], filters: {}, suggestions: ["Vilka system finns?", "Visa alla rum", "Öppna ärenden"] });
            send({ type: "done" });
          }
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
    console.error("Gunnar chat error:", e);
    const status = e?.status || 500;
    const message = e?.message || (e instanceof Error ? e.message : "Unknown error");
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
