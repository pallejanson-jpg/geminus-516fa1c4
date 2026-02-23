import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

const MAX_TOOL_ROUNDS = 7;
const AI_MODEL_PRIMARY = "google/gemini-2.5-pro";
const AI_MODEL_FALLBACK = "google/gemini-2.5-flash";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/* ─────────────────────────────────────────────
   Tool definitions for the AI model
   ───────────────────────────────────────────── */

const tools = [
  {
    type: "function",
    function: {
      name: "query_assets",
      description: "Query assets from the database with optional filters. Returns a list of matching assets or a count. Categories: Building, Building Storey, Space, Instance, Door. Use count_only=true to get counts without fetching all rows.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          category: { type: "string", description: "Filter by category (Building, Building Storey, Space, Instance, Door)" },
          level_fm_guid: { type: "string", description: "Filter by level/storey fm_guid" },
          in_room_fm_guid: { type: "string", description: "Filter by room fm_guid" },
          asset_type: { type: "string", description: "Filter by asset_type (e.g. brandsläckare, fläkt). Partial match." },
          name_search: { type: "string", description: "Search in name/common_name fields (partial match)" },
          attribute_search: { type: "string", description: "Search inside the attributes JSONB column. Use for NTA, BTA, material, installation year etc. Partial match on both keys and values." },
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
      name: "aggregate_assets",
      description: "Aggregate/group assets to get counts, total area, or average area per group. Much faster than fetching all rows and counting manually. Use this for questions like 'how many of each type?', 'total area per floor', etc.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          group_by: { type: "string", enum: ["asset_type", "category", "level_fm_guid"], description: "Field to group by" },
          metric: { type: "string", enum: ["count", "sum_area", "avg_area"], description: "What to calculate per group. Default: count" },
          category_filter: { type: "string", description: "Pre-filter by category before grouping (e.g. 'Instance', 'Space')" },
        },
        required: ["group_by"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_buildings",
      description: "Compare 2 or more buildings side by side. Returns summary data (floors, rooms, assets, area, open issues, work orders) for each building in a single call.",
      parameters: {
        type: "object",
        properties: {
          fm_guids: { type: "array", items: { type: "string" }, description: "Array of building fm_guids to compare" },
        },
        required: ["fm_guids"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "work_order_trends",
      description: "Analyze work order trends over time. Groups work orders by month or week to answer 'are fault reports increasing?' without fetching hundreds of rows.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          period: { type: "string", enum: ["week", "month"], description: "Group by week or month. Default: month" },
          months_back: { type: "number", description: "How many months of history to include. Default: 6" },
          status: { type: "string", description: "Filter by status" },
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
      description: "Query work orders (felanmälningar/arbetsordrar) with optional filters. Can filter by status, priority, category, and building.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          status: { type: "string", description: "Filter by status (open, in_progress, completed, closed)" },
          priority: { type: "string", description: "Filter by priority" },
          category: { type: "string", description: "Filter by category" },
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
          issue_type: { type: "string", description: "Filter by issue_type (fault, observation, etc.)" },
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
      description: "Get a comprehensive overview of a building: floors, rooms, assets, total area, open issues, and open work orders. Use this as a starting point when the user asks about a building.",
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
      description: "Free-text search across asset names, common names, and asset types. Use for finding specific items by name or type. Returns fm_guid for each result so you can create action buttons.",
      parameters: {
        type: "object",
        properties: {
          search_term: { type: "string", description: "Text to search for (e.g. 'brandslang', 'kontor 201')" },
          building_fm_guid: { type: "string", description: "Optionally limit search to a building" },
          limit: { type: "number", description: "Max rows (default 20)" },
        },
        required: ["search_term"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_documents",
      description: "Query documents (ritningar, handlingar, dokument) associated with a building. Can filter by file name, source system, or MIME type.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          file_name: { type: "string", description: "Search in file name (partial match)" },
          source_system: { type: "string", description: "Filter by source system (e.g. congeria)" },
          mime_type: { type: "string", description: "Filter by MIME type (e.g. application/pdf)" },
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
      name: "query_building_settings",
      description: "Get configuration/settings for buildings: favorites, geo coordinates, Ivion site IDs, hero images, FM Access links. Use to find which buildings have 360° panorama (ivion_site_id not null) or geo coordinates.",
      parameters: {
        type: "object",
        properties: {
          fm_guid: { type: "string", description: "Get settings for a specific building" },
          favorites_only: { type: "boolean", description: "If true, only return favorited buildings" },
          limit: { type: "number", description: "Max rows (default 50)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_saved_views",
      description: "Query saved camera views/bookmarks for a building. These are pre-configured viewpoints users have saved.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string", description: "Filter by building fm_guid" },
          limit: { type: "number", description: "Max rows (default 20)" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_annotation_symbols",
      description: "Query available annotation/marker symbols used for placing assets on the map/model. Returns categories and icon details.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Filter by category" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_floor_details",
      description: "Get detailed information about a specific floor/storey: all rooms with their areas, and all assets (equipment) on that floor.",
      parameters: {
        type: "object",
        properties: {
          floor_fm_guid: { type: "string", description: "The floor's fm_guid" },
        },
        required: ["floor_fm_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "senslinc_get_equipment",
      description: "Find IoT equipment/sensors linked to a specific FM GUID (room, asset, or building). Returns machine info, sensor data, and a dashboard URL for the Senslinc monitoring portal.",
      parameters: {
        type: "object",
        properties: {
          fm_guid: { type: "string", description: "The FM GUID of the room, asset, or building to look up in Senslinc" },
        },
        required: ["fm_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "senslinc_get_sites",
      description: "List all Senslinc-monitored sites (buildings) and optionally get all equipment for a specific site. Use to discover which buildings have IoT sensors.",
      parameters: {
        type: "object",
        properties: {
          site_code: { type: "string", description: "Optional site code to filter and get equipment for a specific site" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "senslinc_search_data",
      description: "Search time-series sensor data (temperature, CO2, humidity, energy) from Senslinc Elasticsearch. Build queries with time range, machine code, and property name filters.",
      parameters: {
        type: "object",
        properties: {
          workspace_key: { type: "string", description: "The Elasticsearch workspace/index key to search in. Use senslinc_get_indices to discover valid values." },
          time_range: { type: "string", description: "Time range for data, e.g. 'now-24h', 'now-7d', 'now-1M'. Default: 'now-24h'" },
          property_name: { type: "string", description: "Filter by property/metric name (e.g. 'temperature', 'co2', 'humidity')" },
          machine_code: { type: "string", description: "Filter by machine code (often the FM GUID)" },
          size: { type: "number", description: "Max results to return (default 100)" },
        },
        required: ["workspace_key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "senslinc_get_indices",
      description: "List available Senslinc Elasticsearch indices/workspaces. Use this to discover valid workspace_key values before calling senslinc_search_data.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  // ── Write tools ──
  {
    type: "function",
    function: {
      name: "create_work_order",
      description: "Create a new work order / fault report (felanmälan). Returns the created work order. IMPORTANT: Before calling this, present the details to the user and ask for confirmation. Only call after the user says yes.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title of the work order" },
          description: { type: "string", description: "Detailed description" },
          building_fm_guid: { type: "string", description: "Building fm_guid" },
          building_name: { type: "string", description: "Building name for display" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "Priority level. Default: medium" },
          category: { type: "string", description: "Category of the issue" },
          space_fm_guid: { type: "string", description: "Optional room fm_guid" },
          space_name: { type: "string", description: "Optional room name" },
        },
        required: ["title", "description", "building_fm_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_issue_status",
      description: "Update the status of a BCF issue. IMPORTANT: Before calling this, present the change to the user and ask for confirmation. Only call after the user says yes.",
      parameters: {
        type: "object",
        properties: {
          issue_id: { type: "string", description: "The UUID of the issue to update" },
          new_status: { type: "string", enum: ["open", "in_progress", "resolved", "closed"], description: "The new status" },
        },
        required: ["issue_id", "new_status"],
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
    args.count_only ? "*" : "fm_guid, name, common_name, category, asset_type, building_fm_guid, level_fm_guid, in_room_fm_guid, gross_area, attributes",
    args.count_only ? { count: "exact", head: true } : undefined
  );
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.category) query = query.eq("category", args.category);
  if (args.level_fm_guid) query = query.eq("level_fm_guid", args.level_fm_guid);
  if (args.in_room_fm_guid) query = query.eq("in_room_fm_guid", args.in_room_fm_guid);
  if (args.asset_type) query = query.ilike("asset_type", `%${args.asset_type}%`);
  if (args.name_search) query = query.or(`common_name.ilike.%${args.name_search}%,name.ilike.%${args.name_search}%`);
  if (args.attribute_search) query = query.ilike("attributes::text", `%${args.attribute_search}%`);
  if (!args.count_only) query = query.limit(args.limit || 50);

  const { data, count, error } = await query;
  if (error) throw error;
  return args.count_only ? { count } : data;
}

async function execAggregateAssets(supabase: any, args: any) {
  const groupBy = args.group_by;
  const metric = args.metric || "count";

  let query = supabase.from("assets").select(`${groupBy}, gross_area`);
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.category_filter) query = query.eq("category", args.category_filter);
  query = query.limit(5000);

  const { data, error } = await query;
  if (error) throw error;

  // Aggregate in code (Supabase JS doesn't do GROUP BY)
  const groups: Record<string, { count: number; sum_area: number }> = {};
  for (const row of data || []) {
    const key = row[groupBy] || "(tom)";
    if (!groups[key]) groups[key] = { count: 0, sum_area: 0 };
    groups[key].count++;
    if (row.gross_area) groups[key].sum_area += Number(row.gross_area);
  }

  const results = Object.entries(groups)
    .map(([key, v]) => ({
      [groupBy]: key,
      count: v.count,
      ...(metric === "sum_area" ? { total_area_m2: Math.round(v.sum_area * 100) / 100 } : {}),
      ...(metric === "avg_area" ? { avg_area_m2: v.count ? Math.round((v.sum_area / v.count) * 100) / 100 : 0 } : {}),
    }))
    .sort((a, b) => b.count - a.count);

  return { total_groups: results.length, groups: results.slice(0, 50) };
}

async function execCompareBuildings(supabase: any, args: any) {
  const results = await Promise.all(
    args.fm_guids.map((fmGuid: string) => execBuildingSummary(supabase, { fm_guid: fmGuid }))
  );
  return { comparison: results };
}

async function execWorkOrderTrends(supabase: any, args: any) {
  const monthsBack = args.months_back || 6;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);

  let query = supabase.from("work_orders")
    .select("created_at, status, priority, category")
    .gte("created_at", cutoff.toISOString())
    .order("created_at", { ascending: true })
    .limit(2000);

  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.status) query = query.eq("status", args.status);

  const { data, error } = await query;
  if (error) throw error;

  const period = args.period || "month";
  const buckets: Record<string, number> = {};
  for (const wo of data || []) {
    const d = new Date(wo.created_at);
    let key: string;
    if (period === "week") {
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      key = weekStart.toISOString().slice(0, 10);
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    buckets[key] = (buckets[key] || 0) + 1;
  }

  const trend = Object.entries(buckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, count]) => ({ period, count }));

  return {
    total: (data || []).length,
    period_type: period,
    months_back: monthsBack,
    trend,
  };
}

async function execQueryWorkOrders(supabase: any, args: any) {
  let query = supabase.from("work_orders").select(
    args.count_only ? "*" : "id, external_id, title, description, status, priority, category, building_fm_guid, building_name, space_fm_guid, space_name, assigned_to, reported_by, reported_at, due_date",
    args.count_only ? { count: "exact", head: true } : undefined
  );
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.status) query = query.eq("status", args.status);
  if (args.priority) query = query.eq("priority", args.priority);
  if (args.category) query = query.ilike("category", `%${args.category}%`);
  if (!args.count_only) query = query.order("created_at", { ascending: false }).limit(args.limit || 20);

  const { data, count, error } = await query;
  if (error) throw error;
  return args.count_only ? { count } : data;
}

async function execQueryIssues(supabase: any, args: any) {
  let query = supabase.from("bcf_issues").select(
    args.count_only ? "*" : "id, title, description, status, priority, issue_type, building_fm_guid, building_name, created_at, selected_object_ids",
    args.count_only ? { count: "exact", head: true } : undefined
  );
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.status) query = query.eq("status", args.status);
  if (args.priority) query = query.eq("priority", args.priority);
  if (args.issue_type) query = query.eq("issue_type", args.issue_type);
  if (!args.count_only) query = query.order("created_at", { ascending: false }).limit(args.limit || 20);

  const { data, count, error } = await query;
  if (error) throw error;
  return args.count_only ? { count } : data;
}

async function execBuildingSummary(supabase: any, args: any) {
  const fmGuid = args.fm_guid;
  const [assets, workOrders, issues, buildingRow, floors] = await Promise.all([
    supabase.from("assets").select("category, gross_area, asset_type").eq("building_fm_guid", fmGuid),
    supabase.from("work_orders").select("status, priority, category").eq("building_fm_guid", fmGuid),
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
    if (a.category === "Instance" && a.asset_type) {
      assetTypes[a.asset_type] = (assetTypes[a.asset_type] || 0) + 1;
    }
  });

  const woByStatus: Record<string, number> = {};
  (workOrders.data || []).forEach((w: any) => { woByStatus[w.status] = (woByStatus[w.status] || 0) + 1; });

  const issuesByStatus: Record<string, number> = {};
  (issues.data || []).forEach((i: any) => { issuesByStatus[i.status] = (issuesByStatus[i.status] || 0) + 1; });

  const topAssetTypes = Object.entries(assetTypes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => ({ type, count }));

  return {
    building_name: buildingRow.data?.common_name || buildingRow.data?.name || fmGuid,
    building_fm_guid: fmGuid,
    building_attributes: buildingRow.data?.attributes || {},
    floors_count: cats["Building Storey"] || 0,
    floors: (floors.data || []).map((f: any) => ({ fm_guid: f.fm_guid, name: f.common_name || f.name })),
    rooms: cats["Space"] || 0,
    assets: cats["Instance"] || 0,
    doors: cats["Door"] || 0,
    total_space_area_m2: Math.round(totalArea * 100) / 100,
    work_orders_by_status: woByStatus,
    total_work_orders: (workOrders.data || []).length,
    issues_by_status: issuesByStatus,
    total_issues: (issues.data || []).length,
    top_asset_types: topAssetTypes,
  };
}

async function execSearchAssets(supabase: any, args: any) {
  const term = `%${args.search_term}%`;
  let query = supabase
    .from("assets")
    .select("fm_guid, name, common_name, category, asset_type, building_fm_guid, level_fm_guid, in_room_fm_guid, gross_area")
    .or(`common_name.ilike.${term},name.ilike.${term},asset_type.ilike.${term}`);

  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  query = query.limit(args.limit || 20);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function execQueryDocuments(supabase: any, args: any) {
  let query = supabase.from("documents").select(
    args.count_only ? "*" : "id, file_name, file_path, mime_type, file_size, source_system, source_url, building_fm_guid, created_at",
    args.count_only ? { count: "exact", head: true } : undefined
  );
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.file_name) query = query.ilike("file_name", `%${args.file_name}%`);
  if (args.source_system) query = query.eq("source_system", args.source_system);
  if (args.mime_type) query = query.ilike("mime_type", `%${args.mime_type}%`);
  if (!args.count_only) query = query.order("created_at", { ascending: false }).limit(args.limit || 20);

  const { data, count, error } = await query;
  if (error) throw error;
  return args.count_only ? { count } : data;
}

async function execQueryBuildingSettings(supabase: any, args: any) {
  let query = supabase.from("building_settings").select("fm_guid, is_favorite, latitude, longitude, ivion_site_id, hero_image_url, fm_access_building_guid, rotation, start_view_id");
  if (args.fm_guid) query = query.eq("fm_guid", args.fm_guid);
  if (args.favorites_only) query = query.eq("is_favorite", true);
  query = query.limit(args.limit || 50);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function execQuerySavedViews(supabase: any, args: any) {
  let query = supabase.from("saved_views").select("id, name, description, building_fm_guid, building_name, view_mode, visualization_type, created_at");
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  query = query.order("created_at", { ascending: false }).limit(args.limit || 20);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function execQueryAnnotationSymbols(supabase: any, args: any) {
  let query = supabase.from("annotation_symbols").select("id, name, category, color, icon_url, is_default");
  if (args.category) query = query.eq("category", args.category);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function execGetFloorDetails(supabase: any, args: any) {
  const floorGuid = args.floor_fm_guid;
  const [rooms, assets] = await Promise.all([
    supabase.from("assets").select("fm_guid, name, common_name, gross_area").eq("level_fm_guid", floorGuid).eq("category", "Space").order("common_name"),
    supabase.from("assets").select("fm_guid, name, common_name, asset_type, in_room_fm_guid").eq("level_fm_guid", floorGuid).eq("category", "Instance").limit(100),
  ]);

  const totalArea = (rooms.data || []).reduce((sum: number, r: any) => sum + (Number(r.gross_area) || 0), 0);

  return {
    floor_fm_guid: floorGuid,
    rooms: (rooms.data || []).map((r: any) => ({ fm_guid: r.fm_guid, name: r.common_name || r.name, area_m2: r.gross_area })),
    room_count: (rooms.data || []).length,
    total_area_m2: Math.round(totalArea * 100) / 100,
    assets: (assets.data || []).map((a: any) => ({ fm_guid: a.fm_guid, name: a.common_name || a.name, type: a.asset_type, room_fm_guid: a.in_room_fm_guid })),
    asset_count: (assets.data || []).length,
  };
}

/* ── Write tool execution ── */

async function execCreateWorkOrder(supabase: any, args: any) {
  const externalId = `FR-GUNNAR-${Date.now()}`;
  const { data, error } = await supabase.from("work_orders").insert({
    external_id: externalId,
    title: args.title,
    description: args.description,
    building_fm_guid: args.building_fm_guid,
    building_name: args.building_name || null,
    priority: args.priority || "medium",
    category: args.category || null,
    space_fm_guid: args.space_fm_guid || null,
    space_name: args.space_name || null,
    status: "open",
    reported_by: "Gunnar AI",
  }).select().single();

  if (error) throw error;
  return { success: true, work_order: data };
}

async function execUpdateIssueStatus(supabase: any, args: any) {
  const updates: any = { status: args.new_status };
  if (args.new_status === "resolved") {
    updates.resolved_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("bcf_issues")
    .update(updates)
    .eq("id", args.issue_id)
    .select("id, title, status")
    .single();

  if (error) throw error;
  return { success: true, issue: data };
}

/* ─────────────────────────────────────────────
   Senslinc IoT helpers
   ───────────────────────────────────────────── */

async function callSenslincQuery(action: string, params: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const resp = await fetch(`${supabaseUrl}/functions/v1/senslinc-query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  return resp.json();
}

async function execSenslincGetEquipment(args: any) {
  return callSenslincQuery("get-dashboard-url", { fmGuid: args.fm_guid });
}

async function execSenslincGetSites(args: any) {
  if (args.site_code) {
    return callSenslincQuery("get-site-equipment", { siteCode: args.site_code });
  }
  return callSenslincQuery("get-sites", {});
}

async function execSenslincSearchData(args: any) {
  const timeRange = args.time_range || "now-24h";
  const size = args.size || 100;

  const must: any[] = [
    { range: { "@timestamp": { gte: timeRange, lte: "now" } } },
  ];
  const filter: any[] = [];
  if (args.machine_code) filter.push({ term: { machine_code: args.machine_code } });
  if (args.property_name) filter.push({ term: { property_name: args.property_name } });

  const query: Record<string, unknown> = {
    size,
    query: { bool: { must, filter } },
    sort: [{ "@timestamp": { order: "desc" } }],
  };

  return callSenslincQuery("search-data", {
    workspaceKey: args.workspace_key,
    query,
  });
}

async function execSenslincGetIndices() {
  return callSenslincQuery("get-indices", {});
}

async function executeTool(supabase: any, name: string, args: any) {
  switch (name) {
    case "query_assets": return execQueryAssets(supabase, args);
    case "aggregate_assets": return execAggregateAssets(supabase, args);
    case "compare_buildings": return execCompareBuildings(supabase, args);
    case "work_order_trends": return execWorkOrderTrends(supabase, args);
    case "query_work_orders": return execQueryWorkOrders(supabase, args);
    case "query_issues": return execQueryIssues(supabase, args);
    case "get_building_summary": return execBuildingSummary(supabase, args);
    case "search_assets": return execSearchAssets(supabase, args);
    case "query_documents": return execQueryDocuments(supabase, args);
    case "query_building_settings": return execQueryBuildingSettings(supabase, args);
    case "query_saved_views": return execQuerySavedViews(supabase, args);
    case "query_annotation_symbols": return execQueryAnnotationSymbols(supabase, args);
    case "get_floor_details": return execGetFloorDetails(supabase, args);
    case "senslinc_get_equipment": return execSenslincGetEquipment(args);
    case "senslinc_get_sites": return execSenslincGetSites(args);
    case "senslinc_search_data": return execSenslincSearchData(args);
    case "senslinc_get_indices": return execSenslincGetIndices();
    case "create_work_order": return execCreateWorkOrder(supabase, args);
    case "update_issue_status": return execUpdateIssueStatus(supabase, args);
    default: return { error: `Unknown tool: ${name}` };
  }
}

/* ─────────────────────────────────────────────
   Conversation memory helpers
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
  }

  const { data } = await query;
  if (data?.[0]) {
    const age = Date.now() - new Date(data[0].updated_at).getTime();
    // Only use if less than 24h old
    if (age < 24 * 60 * 60 * 1000) {
      return data[0];
    }
  }
  return null;
}

async function saveConversation(supabase: any, userId: string, buildingFmGuid: string | null, messages: any[]) {
  // Keep last 10 messages for memory
  const recentMessages = messages.slice(-10).map((m: any) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content.slice(0, 500) : "",
  }));

  // Upsert: find existing conversation for this user+building, update or create
  const { data: existing } = await supabase
    .from("gunnar_conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("building_fm_guid", buildingFmGuid || "")
    .order("updated_at", { ascending: false })
    .limit(1);

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
   Build system prompt with live context from DB
   ───────────────────────────────────────────── */

async function buildSystemPrompt(supabase: any, context: any, userProfile: any, previousConversation: any) {
  // Pre-fetch building directory for context
  let buildingDirectory = "";
  try {
    const { data: buildings } = await supabase
      .from("assets")
      .select("fm_guid, common_name, name")
      .eq("category", "Building")
      .order("common_name")
      .limit(50);

    if (buildings?.length) {
      const lines = buildings.map((b: any) => `  - "${b.common_name || b.name}" (fm_guid: ${b.fm_guid})`);
      buildingDirectory = `\nAVAILABLE BUILDINGS IN THE PORTFOLIO:\n${lines.join("\n")}`;
    }
  } catch (e) {
    console.error("Failed to fetch building directory:", e);
  }

  // Current context
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
  if (context?.viewerState) {
    const vs = context.viewerState;
    ctx += `\nViewer state: mode=${vs.viewMode}, visible floors=${vs.visibleFloorFmGuids?.length || 0}, selected objects=${vs.selectedFmGuids?.length || 0}`;
  }

  // User profile context
  let userCtx = "";
  if (userProfile) {
    const displayName = userProfile.display_name || "användaren";
    const role = userProfile.role || "user";
    userCtx = `\nUSER PROFILE:\n- Name: ${displayName}\n- Role: ${role}${role === "admin" ? " (has admin privileges, can manage work orders and issues)" : ""}`;
  }

  // Previous conversation memory
  let memoryCtx = "";
  if (previousConversation?.messages?.length) {
    const msgs = previousConversation.messages
      .filter((m: any) => m.role === "user" || m.role === "assistant")
      .slice(-4)
      .map((m: any) => `${m.role}: ${m.content}`)
      .join("\n");
    memoryCtx = `\nPREVIOUS CONVERSATION (from earlier session — you can reference this):\n${msgs}`;
  }

  return `You are Gunnar, an expert AI assistant for a facility management platform called Geminus. You are knowledgeable about buildings, BIM models, property management, and Swedish facility standards.

You have access to tools that query the database. ALWAYS use tools to get data – never guess or make up numbers. You can call multiple tools in sequence to build up a complete picture before answering.

${userCtx}
${ctx}
${buildingDirectory}
${memoryCtx}

SWEDISH FACILITY MANAGEMENT TERMINOLOGY:
- NTA (Nettoarea) = net area, the usable floor area inside a room/space
- BTA (Bruttoarea) = gross area, total area including walls
- BOA (Bostadsarea) = residential area
- LOA (Lokalarea) = premises area (offices, commercial)
- BRA (Bruksarea) = usable area
- ÖVA (Övrig area) = miscellaneous area
- SS 876001 = Swedish standard for facility management data
- SIS = Swedish Standards Institute
- Driftskostnad = operational cost
- Underhållskostnad = maintenance cost
- Felanmälan = fault report / work order
- Ärende = issue / case
- Våningsplan = storey / floor
- Rum / Utrymme = room / space
- Utrustning / Tillgång = equipment / asset
- Brandskyddsutrustning = fire safety equipment (IfcAlarm, IfcFireSuppressionTerminal)
- Ventilation = ventilation (IfcFan, IfcAirTerminal, IfcDuctSegment)
- El = electrical (IfcElectricDistributionBoard, IfcOutlet)
- VS = plumbing (IfcPipeFitting, IfcValve, IfcSanitaryTerminal)
- Energiförbrukning = energy consumption (typically kWh/m²/year, good = <100, average = 100-150, high = >150)

ASSET CATEGORIES in the database:
- "Building" – the building itself
- "Building Storey" – floors/levels  
- "Space" – rooms (rum)
- "Instance" – equipment, furniture, installations (utrustning)
- "Door" – doors (dörrar)

REASONING APPROACH — Think step by step:
Before answering any question, plan your approach:
1. What specific data do I need to answer this question?
2. Which tool(s) should I call to get that data?
3. Do I need to chain multiple calls (e.g., get building summary first, then drill into a specific floor)?
4. What calculations or comparisons should I make from the results?
5. What insights can I extract beyond the raw data?

PROBLEM-SOLVING APPROACH:
1. When asked about a building, start with get_building_summary to get an overview.
2. When asked to compare or analyze, use compare_buildings for side-by-side data, or aggregate_assets for grouping.
3. When asked about trends (e.g., "ökar felanmälningarna?"), use work_order_trends.
4. For "how many of each type" questions, use aggregate_assets instead of fetching all rows.
5. When the user asks a complex question, break it down: first identify what data you need, then call the right tools in sequence.
6. If a first query returns too many or too few results, refine with additional filters.
7. When listing items, always include their fm_guid so you can create action buttons.

WRITE OPERATIONS (create_work_order, update_issue_status):
- ALWAYS present what you're about to do and ask the user to confirm BEFORE calling the write tool.
- Format the confirmation as: "Jag föreslår att [action]. **Ska jag göra detta?** (svara ja/nej)"
- Only call the write tool after the user explicitly confirms.
- After a successful write, summarize what was created/updated.

FM ADVISOR MODE:
When the user asks for advice ("ge mig råd", "vad bör jag göra", "advisor"), perform a comprehensive FM analysis:
1. Call get_building_summary to get the building overview.
2. Call query_work_orders (status=open) and query_issues (status=open) to assess open problems.
3. Call aggregate_assets (group_by=asset_type, category_filter=Instance) to check equipment distribution.
4. Analyze the data against Swedish FM standards and best practices:
   - SS 876001:2019 for area classification and data quality
   - BBR (Boverkets byggregler) for fire safety requirements
   - Energy benchmarks: <100 kWh/m²/year = good, 100-150 = average, >150 = needs attention
   - Maintenance ratio: open work orders vs total assets — flag if >5%
   - Fire safety: check for brandslackare, brandlarmsknapp, branddorr coverage
   - Ventilation: verify presence of IfcFan, IfcAirTerminal per floor
5. Present findings as a structured FM advisory report with:
   - 🟢 Styrkor (strengths)
   - 🟡 Förbättringsområden (improvement areas)
   - 🔴 Risker/brister (risks/deficiencies)
   - 📋 Rekommenderade åtgärder (recommended actions) with priority

GUIDELINES:
1. Answer in the same language as the user (Swedish or English).
2. When the user has an active building, scope queries to that building by default.
3. Be concise but thorough. Use markdown formatting: **bold** for key numbers, bullet lists for multiple items, tables for comparisons.
4. After every answer, suggest 2-3 relevant follow-up questions. Write them as a numbered list at the very end, prefixed with "**Förslag:**" or "**Suggestions:**".
5. When referencing specific assets, floors, or rooms, ALWAYS include ACTION BUTTONS using this exact syntax:
   [🔍 Visa](action:flyTo:FM_GUID)  — fly the camera to an object
   [📍 Öppna](action:openViewer:FM_GUID) — open the 3D viewer for a building
   [🏢 Visa våning](action:showFloor:FM_GUID) — switch to a specific floor
   [🔎 Hitta i träd](action:selectInTree:FM_GUID1,FM_GUID2) — highlight objects in navigator
   [📋 Byt till 2D](action:switchTo2D:) — switch viewer to 2D mode
   [🧊 Byt till 3D](action:switchTo3D:) — switch viewer to 3D mode
6. ALWAYS add action buttons when listing specific assets, rooms, or floors. For example: "Rum **Kontor 201** [🔍 Visa](action:flyTo:abc-123)"
7. When listing multiple items in a table or list, add an action button next to each one.
8. When you receive data from tools, analyze it and provide insights, not just raw data. Calculate percentages, spot trends, highlight anomalies.
9. If the user asks something you can't answer with the available tools, say so clearly and suggest what they could do instead.
10. If the user previously discussed something (see PREVIOUS CONVERSATION), you can reference it naturally: "Som vi pratade om förut..."

SENSLINC (IoT / SENSOR DATA):
You have tools to query IoT sensor data from the Senslinc system.

RECOMMENDED WORKFLOW:
1. senslinc_get_sites — discover monitored buildings
2. senslinc_get_equipment(fm_guid) — find sensors for a room/asset/building, get dashboard URL
3. senslinc_get_indices — discover available workspace keys (REQUIRED before search_data)
4. senslinc_search_data(workspace_key, ...) — query time-series data

IMPORTANT:
- ALWAYS call senslinc_get_indices first to discover valid workspace_key values before using senslinc_search_data.
- Use senslinc_get_equipment to find machine_code values for filtering.
- Chain: get_equipment -> get_indices -> search_data for complete IoT queries.
- Present dashboard links as: [📊 Senslinc Dashboard](URL)
- Summarize readings with min/max/avg and flag anomalies.

EXAMPLE INTERACTIONS:

Example 1 — Building overview:
User: "Berätta om Tornet"
Thinking: I need building data. I'll use get_building_summary with the fm_guid for Tornet.
→ Call get_building_summary(fm_guid)
→ Present: floors, rooms, total area, open issues, top asset types with action buttons.

Example 2 — Counting by type:
User: "Hur många brandsläckare finns det?"
Thinking: This is an aggregation question. I'll use aggregate_assets filtered by category=Instance and group by asset_type, then look for fire-related types.
→ Call aggregate_assets(building_fm_guid, group_by="asset_type", category_filter="Instance")
→ Filter results for brandslackare/fire and present the count.

Example 3 — Trend analysis:
User: "Har felanmälningarna ökat den senaste tiden?"
Thinking: I need historical work order data grouped by month.
→ Call work_order_trends(building_fm_guid, period="month", months_back=6)
→ Analyze: compare recent months to earlier ones, calculate % change, identify spikes.

Example 4 — Creating a work order:
User: "Det läcker vatten i rum 305"
Thinking: The user is reporting a fault. I should propose creating a work order and ask for confirmation.
→ Respond: "Jag kan skapa en felanmälan: **Vattenläcka i rum 305**, prioritet hög. **Ska jag göra detta?**"
User: "Ja"
→ Call create_work_order(title, description, building_fm_guid, priority="high", space_name="305")`;
}

/* ─────────────────────────────────────────────
   AI API call helper with fallback
   ───────────────────────────────────────────── */

async function callAI(apiKey: string, messages: any[], options: { stream?: boolean; tools?: any[]; tool_choice?: string; model?: string } = {}) {
  const model = options.model || AI_MODEL_PRIMARY;
  const body: any = {
    model,
    messages,
    stream: options.stream ?? false,
  };
  if (options.tools) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice || "auto";
  }

  const resp = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const t = await resp.text();
    console.error(`AI call error (${model}):`, resp.status, t);

    // Fallback to flash if pro fails with 500
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

/* ─────────────────────────────────────────────
   Main handler with iterative tool-calling loop
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
    const { messages, context, proactive } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const userId = auth.userId!;

    // Fetch user profile and role in parallel
    const [profileResult, roleResult, previousConversation] = await Promise.all([
      supabase.from("profiles").select("display_name, avatar_url").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
      loadRecentConversation(supabase, userId, context?.currentBuilding?.fmGuid),
    ]);

    const userProfile = profileResult.data ? {
      ...profileResult.data,
      role: roleResult.data?.role || "user",
    } : null;

    // ── Proactive insights mode ──
    if (proactive && context?.currentBuilding) {
      const buildingGuid = context.currentBuilding.fmGuid;
      const buildingName = context.currentBuilding.name;

      // Quick parallel fetch for proactive insights
      const [openIssues, openWorkOrders] = await Promise.all([
        supabase.from("bcf_issues").select("title, priority, status", { count: "exact", head: false })
          .eq("building_fm_guid", buildingGuid).eq("status", "open").limit(5),
        supabase.from("work_orders").select("title, priority, status", { count: "exact", head: false })
          .eq("building_fm_guid", buildingGuid).eq("status", "open").limit(5),
      ]);

      const insights: string[] = [];
      const issueCount = openIssues.data?.length || 0;
      const woCount = openWorkOrders.data?.length || 0;

      if (issueCount > 0) {
        const highPriority = (openIssues.data || []).filter((i: any) => i.priority === "high" || i.priority === "critical");
        if (highPriority.length > 0) {
          insights.push(`⚠️ **${highPriority.length} högt prioriterade ärenden** i ${buildingName}`);
        } else {
          insights.push(`📋 **${issueCount} öppna ärenden** i ${buildingName}`);
        }
      }

      if (woCount > 0) {
        insights.push(`🔧 **${woCount} öppna arbetsordrar** att hantera`);
      }

      if (insights.length === 0) {
        insights.push(`✅ Inga öppna ärenden eller arbetsordrar i ${buildingName} just nu.`);
      }

      return new Response(JSON.stringify({ proactive_insights: insights }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = await buildSystemPrompt(supabase, context, userProfile, previousConversation);

    // Build conversation with system prompt
    const conversation: any[] = [{ role: "system", content: systemPrompt }, ...messages];

    // ── Iterative tool-calling loop ──
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await callAI(LOVABLE_API_KEY, conversation, { tools, tool_choice: "auto" });
      const result = await resp.json();
      const choice = result.choices?.[0];

      if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
        // No more tool calls — stream the final response
        const streamResp = await callAI(LOVABLE_API_KEY, conversation, { stream: true });

        // Save conversation memory in background (don't await)
        const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
        saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, userMsgs).catch(e =>
          console.error("Failed to save conversation:", e)
        );

        return new Response(streamResp.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Execute all tool calls for this round
      const toolCalls = choice.message.tool_calls;
      console.log(`Gunnar round ${round + 1}: executing ${toolCalls.length} tool(s):`, toolCalls.map((tc: any) => tc.function.name));

      // Add assistant message with tool_calls to conversation
      conversation.push(choice.message);

      // Execute tools in parallel
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

      conversation.push(...toolResults);
    }

    // If we exhausted all rounds, stream whatever we have
    console.log("Gunnar: max tool rounds reached, streaming final answer");

    // Save conversation memory
    const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
    saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, userMsgs).catch(e =>
      console.error("Failed to save conversation:", e)
    );

    const finalResp = await callAI(LOVABLE_API_KEY, conversation, { stream: true });
    return new Response(finalResp.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
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
