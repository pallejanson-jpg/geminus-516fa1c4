import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Load .env from same directory
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, ".env");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch { /* .env optional if env vars already set */ }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINUS_APP_URL = process.env.GEMINUS_APP_URL || "https://geminus.lovable.app";
if (!SUPABASE_URL || !SUPABASE_KEY) {
  process.stderr.write("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY\n");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* â”€â”€â”€ Tool definitions â”€â”€â”€ */

const TOOLS = [
  {
    name: "list_buildings",
    description: "List all buildings in Geminus grouped by property (complex). Returns total_properties, total_buildings, and properties[] each with complex_fm_guid, name, designation and buildings[].",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "resolve_building_by_name",
    description: "Find a building by name or partial name. Returns fm_guid(s).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Building name or partial name" },
      },
      required: ["name"],
    },
  },
  {
    name: "get_building_summary",
    description: "Comprehensive building overview: number of floors, rooms, assets, total area, open issues, top asset types. NOTE: these counts are aggregated across ALL BIM models synced for the building — this tool does NOT tell you how many separate BIM models exist. Use list_bim_models for that.",
    inputSchema: {
      type: "object",
      properties: {
        fm_guid: { type: "string", description: "The building's fm_guid" },
      },
      required: ["fm_guid"],
    },
  },
  {
    name: "list_bim_models",
    description: "List the individual synced XKT/BIM models for a building (name + model_id per model). Use this — NOT get_building_summary — for 'which/how many BIM models exist' questions. A building can have several separate models (e.g. architecture, electrical, ventilation each as their own model).",
    inputSchema: {
      type: "object",
      properties: {
        building_guid: { type: "string", description: "The building's fm_guid" },
      },
      required: ["building_guid"],
    },
  },
  {
    name: "search_assets",
    description: "Free-text search across asset names and types. Returns up to 50 matches with fm_guid, name, category, asset_type.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search term" },
        building_guid: { type: "string", description: "Optional: scope to a specific building fm_guid" },
      },
      required: ["search"],
    },
  },
  {
    name: "get_assets_by_system",
    description: "Find assets by system/type (e.g. 'ventilation', 'el', 'sprinkler', 'IfcAlarm', 'pump'). Returns up to 50 assets.",
    inputSchema: {
      type: "object",
      properties: {
        system_query: { type: "string", description: "System or asset_type to search" },
        building_guid: { type: "string", description: "Optional: scope to a specific building fm_guid" },
      },
      required: ["system_query"],
    },
  },
  {
    name: "get_assets_in_room",
    description: "Get all assets located in a specific room.",
    inputSchema: {
      type: "object",
      properties: {
        room_guid: { type: "string", description: "The room's fm_guid" },
      },
      required: ["room_guid"],
    },
  },
  {
    name: "query_assets",
    description: "Flexible asset query with attribute filters. Useful for 'how many rooms have parquet floors', 'list all doors of type X'. Use mode='count' for numbers, 'list' for details, 'group' for breakdown by value.",
    inputSchema: {
      type: "object",
      properties: {
        building_guid: { type: "string", description: "Building fm_guid (required)" },
        category: { type: "string", description: "Asset category: 'Space' (rooms), 'Instance' (equipment), 'Building Storey' (floors)" },
        asset_type: { type: "string", description: "IFC type filter, e.g. 'IfcDoor'" },
        name_search: { type: "string", description: "Partial match on name" },
        attribute_key: { type: "string", description: "Attribute key to filter on, e.g. 'golvmaterial'" },
        attribute_value: { type: "string", description: "Attribute value to match, e.g. 'parkett'" },
        group_by: { type: "string", description: "Group results by this attribute key or 'asset_type'" },
        mode: { type: "string", enum: ["count", "list", "group"], description: "count=just the number, list=matching assets, group=counts per value" },
      },
      required: ["building_guid", "mode"],
    },
  },
  {
    name: "list_attribute_keys",
    description: "List available attribute keys (with example values) for assets in a building. Use before query_assets when you need to discover the right attribute key.",
    inputSchema: {
      type: "object",
      properties: {
        building_guid: { type: "string", description: "Building fm_guid" },
        category: { type: "string", description: "Asset category to sample (default 'Space' = rooms)" },
      },
      required: ["building_guid"],
    },
  },
  {
    name: "get_room_sensor_data",
    description: "Get cached sensor data (temperature, CO2, humidity, occupancy) for rooms in a building. Good for ranking questions like 'which room is warmest' or 'average CO2'.",
    inputSchema: {
      type: "object",
      properties: {
        building_guid: { type: "string", description: "Building fm_guid" },
        metric: { type: "string", enum: ["temperature", "co2", "humidity", "occupancy"], description: "Which metric to sort by (default: temperature)" },
        order: { type: "string", enum: ["asc", "desc"], description: "Sort order (default: desc = highest first)" },
      },
      required: ["building_guid"],
    },
  },
  {
    name: "query_faciliate",
    description: "Query Faciliate FM data: work orders (workorder), rental contracts (rentlandlord), planned maintenance (maintenance). Data is synced from Faciliate.",
    inputSchema: {
      type: "object",
      properties: {
        object_type: { type: "string", enum: ["workorder", "rentlandlord", "maintenance"], description: "Which Faciliate object type to query" },
        status: { type: "string", description: "Optional status filter, e.g. 'Ã–ppen', 'Avslutad'" },
        building: { type: "string", description: "Optional building name or ID filter" },
        search: { type: "string", description: "Optional free-text search on title/description" },
        mode: { type: "string", enum: ["count", "list"], description: "count=just the number, list=records (max 100)" },
      },
      required: ["object_type", "mode"],
    },
  },
];

/* â”€â”€â”€ Tool implementations â”€â”€â”€ */

function cleanAttrKey(key) {
  return key.replace(/[0-9A-F]{40}$/i, "");
}

function extractAttrValue(attrs, key) {
  if (!attrs || typeof attrs !== "object") return undefined;
  const lowerKey = key.toLowerCase();
  const keys = Object.keys(attrs);
  const realKey =
    keys.find(k => k.toLowerCase() === lowerKey) ||
    keys.find(k => cleanAttrKey(k).toLowerCase() === lowerKey) ||
    keys.find(k => k.toLowerCase().startsWith(lowerKey));
  if (!realKey) return undefined;
  const raw = attrs[realKey];
  if (raw && typeof raw === "object" && "value" in raw) return raw.value;
  return raw;
}

function buildingDeepLink(fm_guid) {
  return `${GEMINUS_APP_URL}/?building=${fm_guid}`;
}

async function toolListBuildings() {
  const { data, error } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name, complex_common_name, attributes")
    .eq("category", "Building")
    .order("common_name", { ascending: true })
    .limit(200);
  if (error) throw error;

  // Group buildings by property (complexFmGuid from attributes)
  const propertyMap = new Map();
  const buildingsWithoutProperty = [];

  for (const b of data || []) {
    if (!b.fm_guid) continue;
    const attrs = b.attributes || {};
    const complexFmGuid = attrs.complexFmGuid;
    const complexCommonName = b.complex_common_name || attrs.complexCommonName;
    const complexDesignation = attrs.complexDesignation;
    const buildingEntry = {
      fm_guid: b.fm_guid,
      name: b.common_name || b.name || b.fm_guid,
      geminus_link: buildingDeepLink(b.fm_guid),
    };

    if (complexFmGuid) {
      if (!propertyMap.has(complexFmGuid)) {
        propertyMap.set(complexFmGuid, {
          complex_fm_guid: complexFmGuid,
          name: complexCommonName || complexFmGuid,
          designation: complexDesignation || null,
          buildings: [],
        });
      }
      propertyMap.get(complexFmGuid).buildings.push(buildingEntry);
    } else {
      buildingsWithoutProperty.push(buildingEntry);
    }
  }

  const properties = Array.from(propertyMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  // Append buildings without a property as a catch-all group (if any)
  if (buildingsWithoutProperty.length > 0) {
    properties.push({
      complex_fm_guid: null,
      name: "Other buildings",
      designation: null,
      buildings: buildingsWithoutProperty,
    });
  }

  return {
    total_properties: propertyMap.size,
    total_buildings: (data || []).length,
    properties,
  };
}

async function toolResolveBuildingByName(args) {
  const searchName = `%${args.name}%`;
  const { data: buildings, error } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name, building_fm_guid")
    .eq("category", "Building")
    .or(`common_name.ilike.${searchName},name.ilike.${searchName}`)
    .limit(10);
  if (error) throw error;
  if (!buildings?.length) {
    const { data: all } = await supabase.from("assets").select("fm_guid, name, common_name").eq("category", "Building").limit(50);
    return { found: false, message: `No building matching "${args.name}" found.`, available_buildings: (all || []).map(b => ({ fm_guid: b.fm_guid, name: b.common_name || b.name })) };
  }
  return { found: true, buildings: buildings.map(b => ({ fm_guid: b.fm_guid, name: b.common_name || b.name, building_fm_guid: b.building_fm_guid || b.fm_guid, geminus_link: buildingDeepLink(b.building_fm_guid || b.fm_guid) })) };
}

async function toolBuildingSummary(args) {
  const fmGuid = args.fm_guid;
  const [spaceCount, instanceCount, storeyCount, issues, buildingRow, floors] = await Promise.all([
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("building_fm_guid", fmGuid).eq("category", "Space"),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("building_fm_guid", fmGuid).eq("category", "Instance"),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("building_fm_guid", fmGuid).eq("category", "Building Storey"),
    supabase.from("bcf_issues").select("status, priority").eq("building_fm_guid", fmGuid),
    supabase.from("assets").select("common_name, name, gross_area").eq("fm_guid", fmGuid).maybeSingle(),
    supabase.from("assets").select("fm_guid, common_name, name").eq("building_fm_guid", fmGuid).eq("category", "Building Storey").order("name"),
  ]);
  const issuesByStatus = {};
  (issues.data || []).forEach(i => { issuesByStatus[i.status] = (issuesByStatus[i.status] || 0) + 1; });
  return {
    building_name: buildingRow.data?.common_name || buildingRow.data?.name || fmGuid,
    building_fm_guid: fmGuid,
    floors_count: storeyCount.count ?? 0,
    floors: (floors.data || []).map(f => ({ fm_guid: f.fm_guid, name: f.common_name || f.name })),
    rooms: spaceCount.count ?? 0,
    assets: instanceCount.count ?? 0,
    issues_by_status: issuesByStatus,
    total_issues: (issues.data || []).length,
  };
}

async function toolListBimModels(args) {
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
    models: models.map(m => ({ model_id: m.model_id, name: m.model_name || m.file_name })),
  };
}

async function toolSearchAssets(args) {
  const { data, error } = await supabase.rpc("search_assets_rpc", {
    search: args.search,
    building_guid: args.building_guid || null,
  });
  if (error) throw error;
  return (data || []).slice(0, 50).map(a => ({ fm_guid: a.fm_guid, name: a.common_name || a.name, category: a.category, asset_type: a.asset_type }));
}

async function toolGetAssetsBySystem(args) {
  const { data, error } = await supabase.rpc("get_assets_by_system", {
    system_query: args.system_query,
    building_guid: args.building_guid || null,
  });
  if (error) throw error;
  return (data || []).slice(0, 50);
}

async function toolGetAssetsInRoom(args) {
  const { data, error } = await supabase.rpc("get_assets_in_room", { room_guid: args.room_guid });
  if (error) throw error;
  return data || [];
}

async function toolQueryAssets(args) {
  const buildingGuid = args.building_guid;
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
  let rows = data || [];

  if (args.attribute_key) {
    const wanted = args.attribute_value ? String(args.attribute_value).toLowerCase() : null;
    rows = rows.filter(r => {
      const v = extractAttrValue(r.attributes, args.attribute_key);
      if (v === undefined || v === null || v === "") return false;
      if (!wanted) return true;
      return String(v).toLowerCase().includes(wanted);
    });
  }

  const base = { count: rows.length, scanned: (data || []).length, category: category || "all" };

  if (mode === "group") {
    const groupKey = args.group_by || args.attribute_key;
    const groups = {};
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
      assets: rows.slice(0, 200).map(r => ({
        fm_guid: r.fm_guid,
        name: r.common_name || r.name,
        asset_type: r.asset_type,
        ...(args.attribute_key ? { attribute_value: extractAttrValue(r.attributes, args.attribute_key) } : {}),
      })),
    };
  }

  return base;
}

async function toolListAttributeKeys(args) {
  const category = args.category || "Space";
  const { data, error } = await supabase
    .from("assets")
    .select("attributes")
    .eq("building_fm_guid", args.building_guid)
    .eq("category", category)
    .not("attributes", "is", null)
    .limit(300);
  if (error) throw error;
  const keys = {};
  for (const row of data || []) {
    if (!row.attributes || typeof row.attributes !== "object") continue;
    for (const [k, raw] of Object.entries(row.attributes)) {
      const v = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
      const key = cleanAttrKey(k);
      if (!keys[key]) keys[key] = { count: 0, example: String(v ?? "").slice(0, 60) };
      keys[key].count++;
    }
  }
  const sorted = Object.entries(keys).sort((a, b) => b[1].count - a[1].count).slice(0, 80).map(([key, info]) => ({ key, count: info.count, example: info.example }));
  return { category, sampled_assets: (data || []).length, keys: sorted };
}

async function toolGetRoomSensorData(args) {
  const { data, error } = await supabase.rpc("get_room_sensor_data", {
    p_building_guid: args.building_guid,
    p_floor_guid: args.floor_guid || null,
    p_metric: args.metric || "temperature",
    p_sort_order: args.order || "desc",
  });
  if (error) throw error;
  const rooms = (data || []).filter(r => r.temperature !== null || r.co2 !== null || r.humidity !== null || r.occupancy !== null);
  if (!rooms.length) return { available: false, error: "No sensor data found" };
  const temps = rooms.map(r => r.temperature).filter(v => v !== null);
  const co2s = rooms.map(r => r.co2).filter(v => v !== null);
  return {
    available: true,
    room_count: rooms.length,
    rooms: rooms.slice(0, 30).map(r => ({ fm_guid: r.fm_guid, name: r.common_name || r.name, temperature: r.temperature, co2: r.co2, humidity: r.humidity, occupancy: r.occupancy })),
    averages: {
      temperature: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
      co2: co2s.length ? Math.round(co2s.reduce((a, b) => a + b, 0) / co2s.length) : null,
    },
  };
}

async function toolQueryFaciliate(args) {
  const mode = args.mode || "count";
  const selectCols = mode === "count" ? "id" : "source_guid, title, status, building_name, building_id, room_cad_key, synced_at";
  let query = supabase
    .from("faciliate_records")
    .select(selectCols, mode === "count" ? { count: "exact", head: true } : undefined)
    .eq("object_type", args.object_type);
  if (args.status) query = query.ilike("status", `%${args.status}%`);
  if (args.building) {
    const b = String(args.building).replace(/[%,]/g, "");
    query = query.or(`building_name.ilike.%${b}%,building_id.eq.${args.building}`);
  }
  if (args.search) query = query.ilike("title", `%${String(args.search).replace(/[%,]/g, "")}%`);

  if (mode === "count") {
    const { count, error } = await query;
    if (error) throw error;
    return { object_type: args.object_type, count: count ?? 0 };
  }

  const { data, error } = await query.limit(100);
  if (error) throw error;
  return {
    object_type: args.object_type,
    count: (data || []).length,
    records: (data || []).map(r => ({ guid: r.source_guid, title: r.title, status: r.status, building: r.building_name || r.building_id, room_guid: r.room_cad_key || undefined })),
    last_synced: data?.[0]?.synced_at || null,
  };
}

/* â”€â”€â”€ MCP server â”€â”€â”€ */

const server = new Server(
  { name: "geminus-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result;
    switch (name) {
      case "list_buildings":            result = await toolListBuildings(); break;
      case "resolve_building_by_name":  result = await toolResolveBuildingByName(args); break;
      case "get_building_summary":      result = await toolBuildingSummary(args); break;
      case "list_bim_models":           result = await toolListBimModels(args); break;
      case "search_assets":             result = await toolSearchAssets(args); break;
      case "get_assets_by_system":      result = await toolGetAssetsBySystem(args); break;
      case "get_assets_in_room":        result = await toolGetAssetsInRoom(args); break;
      case "query_assets":              result = await toolQueryAssets(args); break;
      case "list_attribute_keys":       result = await toolListAttributeKeys(args); break;
      case "get_room_sensor_data":      result = await toolGetRoomSensorData(args); break;
      case "query_faciliate":           result = await toolQueryFaciliate(args); break;
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("Geminus MCP server running\n");
