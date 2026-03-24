import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

const MAX_TOOL_ROUNDS = 3;
const AI_MODEL_PRIMARY = "google/gemini-3-flash-preview";
const AI_MODEL_FALLBACK = "google/gemini-2.5-flash-lite";
const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/* ─────────────────────────────────────────────
   Tool definitions
   ───────────────────────────────────────────── */

const tools = [
  {
    type: "function",
    function: {
      name: "query_assets",
      description: "Query assets with optional filters. Categories: Building, Building Storey, Space, Instance, Door. Use count_only=true for counts.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          category: { type: "string" },
          level_fm_guid: { type: "string" },
          in_room_fm_guid: { type: "string" },
          asset_type: { type: "string", description: "Partial match on asset_type" },
          name_search: { type: "string", description: "Partial match on name/common_name" },
          attribute_search: { type: "string", description: "Search in attributes JSONB" },
          count_only: { type: "boolean" },
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
      name: "aggregate_assets",
      description: "Group assets by field and get count/sum_area/avg_area. Fast for 'how many of each type?', 'total area per floor'.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          group_by: { type: "string", enum: ["asset_type", "category", "level_fm_guid"] },
          metric: { type: "string", enum: ["count", "sum_area", "avg_area"] },
          category_filter: { type: "string" },
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
      description: "Compare 2+ buildings side by side. Returns summary for each.",
      parameters: {
        type: "object",
        properties: {
          fm_guids: { type: "array", items: { type: "string" } },
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
      description: "Analyze work order trends by week/month. Answers 'are fault reports increasing?'",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          period: { type: "string", enum: ["week", "month"] },
          months_back: { type: "number" },
          status: { type: "string" },
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
      description: "Query work orders (felanmälningar) with filters on status/priority/category/building.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          category: { type: "string" },
          count_only: { type: "boolean" },
          limit: { type: "number" },
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
      description: "Query BCF issues (ärenden/avvikelser) with filters.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          issue_type: { type: "string" },
          count_only: { type: "boolean" },
          limit: { type: "number" },
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
      description: "Comprehensive building overview: floors, rooms, assets, area, issues, work orders.",
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
      description: "Free-text search across asset names and types. Returns fm_guid for action buttons.",
      parameters: {
        type: "object",
        properties: {
          search_term: { type: "string" },
          building_fm_guid: { type: "string" },
          limit: { type: "number" },
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
      description: "Query documents (ritningar, handlingar) for a building.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          file_name: { type: "string" },
          source_system: { type: "string" },
          mime_type: { type: "string" },
          count_only: { type: "boolean" },
          limit: { type: "number" },
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
      description: "Get building config: favorites, geo coords, Ivion site IDs, FM Access links.",
      parameters: {
        type: "object",
        properties: {
          fm_guid: { type: "string" },
          favorites_only: { type: "boolean" },
          limit: { type: "number" },
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
      description: "Query saved camera views/bookmarks for a building.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          limit: { type: "number" },
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
      description: "Query annotation/marker symbols.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string" },
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
      description: "Detailed info about a floor: rooms with areas, assets on that floor.",
      parameters: {
        type: "object",
        properties: {
          floor_fm_guid: { type: "string" },
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
      description: "Find IoT equipment/sensors linked to a FM GUID. Returns dashboard URL.",
      parameters: {
        type: "object",
        properties: {
          fm_guid: { type: "string" },
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
      description: "List Senslinc-monitored sites. Discover which buildings have IoT.",
      parameters: {
        type: "object",
        properties: {
          site_code: { type: "string" },
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
      description: "Search time-series sensor data (temperature, CO2, humidity, energy).",
      parameters: {
        type: "object",
        properties: {
          workspace_key: { type: "string" },
          time_range: { type: "string", description: "e.g. 'now-24h', 'now-7d'" },
          property_name: { type: "string" },
          machine_code: { type: "string" },
          size: { type: "number" },
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
      description: "List Senslinc Elasticsearch indices. Use to discover workspace_key values.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
  // ── FM Access tools ──
  {
    type: "function",
    function: {
      name: "fm_access_get_drawings",
      description: "Get drawings from FM Access grouped by discipline (Arkitekt, El, VVS). Requires fm_access_building_guid (use query_building_settings to find it).",
      parameters: {
        type: "object",
        properties: {
          fm_access_building_guid: { type: "string" },
        },
        required: ["fm_access_building_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fm_access_get_hierarchy",
      description: "Get full object hierarchy from FM Access for a building with counts.",
      parameters: {
        type: "object",
        properties: {
          fm_access_building_guid: { type: "string" },
        },
        required: ["fm_access_building_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fm_access_search_objects",
      description: "Search FM Access objects by text query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fm_access_get_floors",
      description: "Get floors from FM Access for a building.",
      parameters: {
        type: "object",
        properties: {
          fm_access_building_guid: { type: "string" },
        },
        required: ["fm_access_building_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fm_access_get_documents",
      description: "Get documents (DoU, technical documentation) from FM Access for a building. Requires fm_access_building_guid (use query_building_settings to find it).",
      parameters: {
        type: "object",
        properties: {
          fm_access_building_guid: { type: "string" },
        },
        required: ["fm_access_building_guid"],
        additionalProperties: false,
      },
    },
  },
  // ── Viewer control tools ──
  {
    type: "function",
    function: {
      name: "viewer_show_floor",
      description: "Generate action link to show a floor in 3D viewer.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          floor_fm_guid: { type: "string" },
          floor_name: { type: "string" },
        },
        required: ["building_fm_guid", "floor_fm_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "viewer_show_model",
      description: "Generate action link to isolate a BIM model. A-modell=Arkitekt, K=Konstruktion, V=VVS, E=El, S=Sprinkler.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          model_id: { type: "string" },
          model_name: { type: "string" },
        },
        required: ["building_fm_guid", "model_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "viewer_open_3d",
      description: "Generate action link to open 3D viewer for a building.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          floor_fm_guid: { type: "string" },
          floor_name: { type: "string" },
        },
        required: ["building_fm_guid"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "viewer_show_drawing",
      description: "Generate action link to show 2D drawing.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          floor_name: { type: "string" },
        },
        required: ["building_fm_guid"],
        additionalProperties: false,
      },
    },
  },
  // ── Document Q&A ──
  {
    type: "function",
    function: {
      name: "ask_about_documents",
      description: "Ask about document CONTENT. Searches pre-indexed chunks. Use for 'what does document X say?'",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          question: { type: "string" },
          file_name_filter: { type: "string" },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  // ── Help docs ──
  {
    type: "function",
    function: {
      name: "search_help_docs",
      description: "Search platform help documentation and knowledge base.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  },
  // ── Write tools ──
  {
    type: "function",
    function: {
      name: "create_work_order",
      description: "Create a work order / fault report. Ask user for confirmation FIRST.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          building_fm_guid: { type: "string" },
          building_name: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
          category: { type: "string" },
          space_fm_guid: { type: "string" },
          space_name: { type: "string" },
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
      description: "Update BCF issue status. Ask user for confirmation FIRST.",
      parameters: {
        type: "object",
        properties: {
          issue_id: { type: "string" },
          new_status: { type: "string", enum: ["open", "in_progress", "resolved", "closed"] },
        },
        required: ["issue_id", "new_status"],
        additionalProperties: false,
      },
    },
  },
  // ── FM Access local search ──
  {
    type: "function",
    function: {
      name: "search_fm_access_local",
      description: "Search locally synced FM Access data: drawings, documents, DoU instructions. Fast.",
      parameters: {
        type: "object",
        properties: {
          building_fm_guid: { type: "string" },
          search_term: { type: "string" },
          data_type: { type: "string", enum: ["drawings", "documents", "dou", "all"] },
          limit: { type: "number" },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  // ── Building name resolution ──
  {
    type: "function",
    function: {
      name: "resolve_building_by_name",
      description: "Find a building by its name or partial name. Returns fm_guid(s). ALWAYS use this first when user mentions a building by name and no building context is set.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Building name or partial name to search for" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  // ── List all buildings ──
  {
    type: "function",
    function: {
      name: "list_buildings",
      description: "List all buildings in the system. Use when user asks 'what buildings do I have?' or similar without specifying a name. Returns building names and fm_guids for selectBuilding buttons.",
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
  // ── Faciliate (SWG) tools ──
  {
    type: "function",
    function: {
      name: "query_faciliate",
      description: "Query Faciliate (SWG) for work orders, buildings, spaces, equipment.",
      parameters: {
        type: "object",
        properties: {
          objectType: { type: "string" },
          filter: { type: "string" },
          take: { type: "number" },
          loadlevel: { type: "string", enum: ["guid", "basic", "simple", "fullprimary", "loadmax"] },
        },
        required: ["objectType"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_faciliate_object",
      description: "Get a single Faciliate object by GUID.",
      parameters: {
        type: "object",
        properties: {
          objectType: { type: "string" },
          guid: { type: "string" },
          loadlevel: { type: "string", enum: ["guid", "basic", "simple", "fullprimary", "loadmax"] },
        },
        required: ["objectType", "guid"],
        additionalProperties: false,
      },
    },
  },
  // ── Adaptive Memory ──
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save a user instruction, correction, or preference for future reference. Use when user says 'kom ihåg', 'remember', 'nästa gång', 'jag föredrar', or corrects you.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "The instruction/correction/preference to remember" },
          memory_type: { type: "string", enum: ["instruction", "correction", "preference"] },
          building_fm_guid: { type: "string", description: "If memory is building-specific" },
        },
        required: ["content", "memory_type"],
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
  return { total: (data || []).length, period_type: period, months_back: monthsBack, trend };
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
    if (a.category === "Instance" && a.asset_type) assetTypes[a.asset_type] = (assetTypes[a.asset_type] || 0) + 1;
  });
  const woByStatus: Record<string, number> = {};
  (workOrders.data || []).forEach((w: any) => { woByStatus[w.status] = (woByStatus[w.status] || 0) + 1; });
  const issuesByStatus: Record<string, number> = {};
  (issues.data || []).forEach((i: any) => { issuesByStatus[i.status] = (issuesByStatus[i.status] || 0) + 1; });
  const topAssetTypes = Object.entries(assetTypes).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, count]) => ({ type, count }));
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
  let query = supabase.from("assets")
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
    reported_by: "Geminus AI",
  }).select().single();
  if (error) throw error;
  return { success: true, work_order: data };
}

async function execUpdateIssueStatus(supabase: any, args: any) {
  const updates: any = { status: args.new_status };
  if (args.new_status === "resolved") updates.resolved_at = new Date().toISOString();
  const { data, error } = await supabase.from("bcf_issues").update(updates).eq("id", args.issue_id).select("id, title, status").single();
  if (error) throw error;
  return { success: true, issue: data };
}

/* ── Senslinc IoT helpers ── */

async function callSenslincQuery(action: string, params: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const resp = await fetch(`${supabaseUrl}/functions/v1/senslinc-query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${anonKey}` },
    body: JSON.stringify({ action, ...params }),
  });
  return resp.json();
}

async function execSenslincGetEquipment(args: any) {
  return callSenslincQuery("get-dashboard-url", { fmGuid: args.fm_guid });
}
async function execSenslincGetSites(args: any) {
  return args.site_code ? callSenslincQuery("get-site-equipment", { siteCode: args.site_code }) : callSenslincQuery("get-sites", {});
}
async function execSenslincSearchData(args: any) {
  const must: any[] = [{ range: { "@timestamp": { gte: args.time_range || "now-24h", lte: "now" } } }];
  const filter: any[] = [];
  if (args.machine_code) filter.push({ term: { machine_code: args.machine_code } });
  if (args.property_name) filter.push({ term: { property_name: args.property_name } });
  return callSenslincQuery("search-data", {
    workspaceKey: args.workspace_key,
    query: { size: args.size || 100, query: { bool: { must, filter } }, sort: [{ "@timestamp": { order: "desc" } }] },
  });
}
async function execSenslincGetIndices() {
  return callSenslincQuery("get-indices", {});
}

/* ── FM Access helpers ── */

async function callFmAccessQuery(action: string, params: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const resp = await fetch(`${supabaseUrl}/functions/v1/fm-access-query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({ action, ...params }),
  });
  return resp.json();
}

async function execFmAccessGetDrawings(args: any) {
  const result = await callFmAccessQuery("get-drawings", { buildingId: args.fm_access_building_guid });
  if (!result?.success) return { error: result?.error || "Failed to get drawings" };
  const drawings = result.data || [];
  const grouped: Record<string, any[]> = {};
  for (const d of drawings) {
    const tab = d.tabName || d.className || "Övrigt";
    if (!grouped[tab]) grouped[tab] = [];
    grouped[tab].push({ id: d.objectId || d.drawingId, name: d.objectName || d.name, className: d.className });
  }
  return {
    total_drawings: drawings.length,
    tabs: Object.entries(grouped).map(([tab, items]) => ({ tab, count: items.length, drawings: items.slice(0, 5) })),
  };
}

async function execFmAccessGetHierarchy(args: any) {
  const result = await callFmAccessQuery("get-hierarchy", { buildingFmGuid: args.fm_access_building_guid });
  if (!result?.success) return { error: result?.error || "Failed to get hierarchy" };
  function countNodes(node: any): number { let c = 1; if (node.children) for (const ch of node.children) c += countNodes(ch); return c; }
  function countByClass(node: any, counts: Record<string, number>) {
    const cls = node.className || `ClassId:${node.classId || 'unknown'}`;
    counts[cls] = (counts[cls] || 0) + 1;
    if (node.children) for (const ch of node.children) countByClass(ch, counts);
  }
  const data = result.data;
  const totalObjects = Array.isArray(data) ? data.reduce((sum: number, n: any) => sum + countNodes(n), 0) : countNodes(data);
  const classCounts: Record<string, number> = {};
  if (Array.isArray(data)) data.forEach((n: any) => countByClass(n, classCounts)); else countByClass(data, classCounts);
  return {
    total_objects: totalObjects,
    by_class: Object.entries(classCounts).map(([cls, count]) => ({ class: cls, count })).sort((a, b) => b.count - a.count),
  };
}

async function execFmAccessSearchObjects(args: any) {
  const result = await callFmAccessQuery("search-objects", { query: args.query });
  if (!result?.success) return { error: result?.error || "Failed to search" };
  return result.data || [];
}

async function execFmAccessGetFloors(args: any) {
  const result = await callFmAccessQuery("get-floors", { buildingFmGuid: args.fm_access_building_guid });
  if (!result?.success) return { error: result?.error || "Failed to get floors" };
  return result.data || [];
}

async function execFmAccessGetDocuments(args: any) {
  const result = await callFmAccessQuery("get-documents", { buildingId: args.fm_access_building_guid });
  if (!result?.success) return { error: result?.error || "Failed to get documents" };
  const docs = result.data || [];
  return {
    total_documents: docs.length,
    documents: docs.slice(0, 30).map((d: any) => ({
      id: d.objectId || d.documentId,
      name: d.objectName || d.name,
      fileName: d.fileName,
      className: d.className,
    })),
  };
}

/* ── Document content Q&A ── */

async function execAskAboutDocuments(supabase: any, args: any, apiKey: string) {
  let query = supabase.from("document_chunks").select("content, file_name, chunk_index, metadata").eq("source_type", "document");
  if (args.building_fm_guid) query = query.eq("building_fm_guid", args.building_fm_guid);
  if (args.file_name_filter) query = query.ilike("file_name", `%${args.file_name_filter}%`);
  const keywords = args.question.replace(/[?!.,]/g, "").split(/\s+/).filter((w: string) => w.length > 2).slice(0, 5);
  if (keywords.length > 0) query = query.or(keywords.map((kw: string) => `content.ilike.%${kw}%`).join(","));
  query = query.order("chunk_index").limit(15);
  const { data: chunks, error } = await query;
  if (error) throw error;
  if (!chunks?.length) {
    let fb = supabase.from("document_chunks").select("content, file_name, chunk_index, metadata").eq("source_type", "document");
    if (args.building_fm_guid) fb = fb.eq("building_fm_guid", args.building_fm_guid);
    if (args.file_name_filter) fb = fb.ilike("file_name", `%${args.file_name_filter}%`);
    fb = fb.order("chunk_index").limit(10);
    const { data: fbChunks } = await fb;
    if (!fbChunks?.length) return { error: "Inga indexerade dokument hittades.", documents_searched: 0 };
    return await answerFromChunks(fbChunks, args.question, apiKey);
  }
  return await answerFromChunks(chunks, args.question, apiKey);
}

async function answerFromChunks(chunks: any[], question: string, apiKey: string) {
  const maxChars = 25000;
  let totalChars = 0;
  const selected: { name: string; content: string }[] = [];
  for (const chunk of chunks) {
    if (totalChars >= maxChars) break;
    const content = chunk.content.slice(0, maxChars - totalChars);
    selected.push({ name: chunk.file_name || "Okänt dokument", content });
    totalChars += content.length;
  }
  const docContext = selected.map(d => `--- ${d.name} ---\n${d.content}`).join("\n\n");
  const aiResp = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL_PRIMARY,
      messages: [
        { role: "system", content: "Answer based ONLY on the provided document content. Be concise. Respond in the same language as the question." },
        { role: "user", content: `Documents:\n\n${docContext}\n\n---\nQuestion: ${question}` },
      ],
      max_tokens: 1000,
      temperature: 0.2,
    }),
  });
  if (!aiResp.ok) return { error: "Kunde inte analysera dokumenten.", documents_searched: selected.length };
  const aiResult = await aiResp.json();
  return { answer: aiResult.choices?.[0]?.message?.content || "Inget svar.", documents_searched: selected.length, document_names: [...new Set(selected.map(d => d.name))] };
}

/* ── Help docs search ── */

async function execSearchHelpDocs(supabase: any, args: any, apiKey: string) {
  const keywords = args.question.replace(/[?!.,]/g, "").split(/\s+/).filter((w: string) => w.length > 2).slice(0, 6);
  let query = supabase.from("document_chunks").select("content, file_name, metadata").or("source_type.eq.help_doc,source_type.eq.api_docs");
  if (keywords.length > 0) query = query.or(keywords.map((kw: string) => `content.ilike.%${kw}%`).join(","));
  query = query.limit(10);
  const { data: chunks, error } = await query;
  if (error) throw error;
  if (!chunks?.length) return { answer: "Ingen hjälpdokumentation hittades.", sources: [] };
  const docContext = chunks.map((c: any) => `--- ${c.file_name || c.metadata?.app_name || "Help"} ---\n${c.content}`).join("\n\n");
  const aiResp = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL_PRIMARY,
      messages: [
        { role: "system", content: "Answer based on the provided help documentation. Be helpful and specific. Respond in the same language as the question." },
        { role: "user", content: `Help docs:\n\n${docContext}\n\n---\nQuestion: ${args.question}` },
      ],
      max_tokens: 1000,
      temperature: 0.2,
    }),
  });
  if (!aiResp.ok) return { error: "Kunde inte söka i hjälpdokumentation." };
  const aiResult = await aiResp.json();
  return { answer: aiResult.choices?.[0]?.message?.content || "Inget svar.", sources: [...new Set(chunks.map((c: any) => c.metadata?.app_name || c.file_name).filter(Boolean))] };
}

/* ── Viewer control tools ── */

function execViewerShowFloor(args: any) {
  const floorName = args.floor_name || "Våning";
  return {
    action_link: `[🏢 Visa ${floorName} i 3D](action:showFloorIn3D:${args.building_fm_guid}:${args.floor_fm_guid}:${encodeURIComponent(floorName)})`,
    instruction: `Use this action link in your response.`,
  };
}
function execViewerShowModel(args: any) {
  const modelName = args.model_name || args.model_id;
  return {
    action_link: `[🏗️ Visa ${modelName}](action:isolateModel:${args.building_fm_guid}:${args.model_id})`,
    instruction: `Use this action link in your response.`,
  };
}
function execViewerOpen3D(args: any) {
  const parts = [`action:openViewer3D:${args.building_fm_guid}`];
  if (args.floor_fm_guid) parts.push(args.floor_fm_guid);
  const label = args.floor_name ? `Öppna 3D (${args.floor_name})` : 'Öppna 3D-viewer';
  return { action_link: `[🧊 ${label}](${parts.join(':')})`, instruction: `Use this action link in your response.` };
}
function execViewerShowDrawing(args: any) {
  const floorName = args.floor_name || '';
  return {
    action_link: `[📐 Visa ritning${floorName ? ` (${floorName})` : ''}](action:showDrawing:${args.building_fm_guid}:${encodeURIComponent(floorName)})`,
    instruction: `Use this action link in your response.`,
  };
}

/* ── FM Access local search ── */

async function execSearchFmAccessLocal(supabase: any, args: any) {
  const dataType = args.data_type || "all";
  const limit = args.limit || 20;
  const results: Record<string, any> = {};
  if (dataType === "all" || dataType === "drawings") {
    let q = supabase.from("fm_access_drawings").select("drawing_id, name, class_name, floor_name, tab_name, building_fm_guid");
    if (args.building_fm_guid) q = q.eq("building_fm_guid", args.building_fm_guid);
    if (args.search_term) q = q.or(`name.ilike.%${args.search_term}%,class_name.ilike.%${args.search_term}%,floor_name.ilike.%${args.search_term}%`);
    q = q.limit(limit);
    const { data } = await q;
    results.drawings = data || [];
  }
  if (dataType === "all" || dataType === "documents") {
    let q = supabase.from("fm_access_documents").select("document_id, name, file_name, class_name, building_fm_guid");
    if (args.building_fm_guid) q = q.eq("building_fm_guid", args.building_fm_guid);
    if (args.search_term) q = q.or(`name.ilike.%${args.search_term}%,file_name.ilike.%${args.search_term}%,class_name.ilike.%${args.search_term}%`);
    q = q.limit(limit);
    const { data } = await q;
    results.documents = data || [];
  }
  if (dataType === "all" || dataType === "dou") {
    let q = supabase.from("fm_access_dou").select("title, content, doc_type, object_fm_guid, building_fm_guid");
    if (args.building_fm_guid) q = q.eq("building_fm_guid", args.building_fm_guid);
    if (args.search_term) q = q.or(`title.ilike.%${args.search_term}%,content.ilike.%${args.search_term}%`);
    q = q.limit(limit);
    const { data } = await q;
    results.dou = data || [];
  }
  if (args.search_term) {
    let chunkQ = supabase.from("document_chunks").select("content, file_name, metadata").eq("source_type", "fm_access").ilike("content", `%${args.search_term}%`).limit(5);
    if (args.building_fm_guid) chunkQ = chunkQ.eq("building_fm_guid", args.building_fm_guid);
    const { data: chunks } = await chunkQ;
    if (chunks?.length) results.semantic_matches = chunks;
  }
  return results;
}

/* ── Faciliate (SWG) tools ── */

async function execQueryFaciliate(args: any) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
  const res = await fetch(`${supabaseUrl}/functions/v1/faciliate-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ action: "list", objectType: args.objectType, filter: args.filter || undefined, take: args.take || 20, loadlevel: args.loadlevel || "simple" }),
  });
  const data = await res.json();
  if (data.status && data.status >= 400) return { error: `Faciliate returned status ${data.status}`, details: data.data };
  return data.data || data;
}

async function execGetFaciliateObject(args: any) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
  const res = await fetch(`${supabaseUrl}/functions/v1/faciliate-proxy`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({ action: "get", objectType: args.objectType, guid: args.guid, loadlevel: args.loadlevel || "fullprimary" }),
  });
  const data = await res.json();
  if (data.status && data.status >= 400) return { error: `Faciliate returned status ${data.status}`, details: data.data };
  return data.data || data;
}

/* ── Adaptive Memory ── */

async function execSaveMemory(supabase: any, args: any, userId: string) {
  if (!userId) return { error: "No user context" };
  const { error } = await supabase.from("ai_memory").insert({
    user_id: userId,
    content: args.content,
    memory_type: args.memory_type || "instruction",
    building_fm_guid: args.building_fm_guid || null,
    source_message: args.source_message || null,
  });
  if (error) throw error;
  return { success: true, message: "Memory saved" };
}

async function loadUserMemories(supabase: any, userId: string, buildingFmGuid?: string): Promise<string> {
  // Load up to 20 memories: global + building-specific
  let query = supabase
    .from("ai_memory")
    .select("content, memory_type, building_fm_guid")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  // Include both global (null building) and building-specific memories
  if (buildingFmGuid) {
    query = query.or(`building_fm_guid.is.null,building_fm_guid.eq.${buildingFmGuid}`);
  } else {
    query = query.is("building_fm_guid", null);
  }

  // Filter out expired memories
  const { data } = await query;
  if (!data?.length) return "";

  const now = new Date();
  const valid = data.filter((m: any) => !m.expires_at || new Date(m.expires_at) > now);
  if (!valid.length) return "";

  const lines = valid.map((m: any) => {
    const prefix = m.memory_type === "correction" ? "⚠️" : m.memory_type === "preference" ? "🎯" : "📝";
    const scope = m.building_fm_guid ? " (building-specific)" : "";
    return `${prefix} ${m.content}${scope}`;
  });

  return `\n\nLEARNED CONTEXT (user preferences & corrections — ALWAYS respect these):\n${lines.join("\n")}`;
}

/* ── Building name resolution ── */

async function execResolveBuildingByName(supabase: any, args: any) {
  const searchName = `%${args.name}%`;
  // Search in assets for buildings matching the name
  const { data: buildings, error } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name, building_fm_guid, attributes")
    .eq("category", "Building")
    .or(`common_name.ilike.${searchName},name.ilike.${searchName}`)
    .limit(10);
  if (error) throw error;
  if (!buildings?.length) {
    // Fallback: search building_settings with a join to assets
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
  // Deduplicate by fm_guid
  const seen = new Map<string, string>();
  for (const b of data || []) {
    if (b.fm_guid && !seen.has(b.fm_guid)) {
      seen.set(b.fm_guid, b.common_name || b.name || b.fm_guid);
    }
  }
  const buildings = Array.from(seen, ([fm_guid, name]) => ({ fm_guid, name }));
  return {
    total: buildings.length,
    buildings,
    instruction: "Present each building as a clickable selectBuilding action button: [Building Name](action:selectBuilding:fm_guid:encodedName)",
  };
}

/* ─────────────────────────────────────────────
   executeTool — ALIGNED with tool declarations
   ───────────────────────────────────────────── */

async function executeTool(supabase: any, name: string, args: any, apiKey?: string) {
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
    // Building resolution
    case "resolve_building_by_name": return execResolveBuildingByName(supabase, args);
    case "list_buildings": return execListBuildings(supabase, args);
    // Senslinc
    case "senslinc_get_equipment": return execSenslincGetEquipment(args);
    case "senslinc_get_sites": return execSenslincGetSites(args);
    case "senslinc_search_data": return execSenslincSearchData(args);
    case "senslinc_get_indices": return execSenslincGetIndices();
    // FM Access — LIVE API
    case "fm_access_get_drawings": return execFmAccessGetDrawings(args);
    case "fm_access_get_hierarchy": return execFmAccessGetHierarchy(args);
    case "fm_access_search_objects": return execFmAccessSearchObjects(args);
    case "fm_access_get_floors": return execFmAccessGetFloors(args);
    case "fm_access_get_documents": return execFmAccessGetDocuments(args);
    // FM Access — local search
    case "search_fm_access_local": return execSearchFmAccessLocal(supabase, args);
    // Document Q&A
    case "ask_about_documents": return execAskAboutDocuments(supabase, args, apiKey!);
    case "search_help_docs": return execSearchHelpDocs(supabase, args, apiKey!);
    // Viewer tools
    case "viewer_show_floor": return execViewerShowFloor(args);
    case "viewer_show_model": return execViewerShowModel(args);
    case "viewer_open_3d": return execViewerOpen3D(args);
    case "viewer_show_drawing": return execViewerShowDrawing(args);
    // Write tools
    case "create_work_order": return execCreateWorkOrder(supabase, args);
    case "update_issue_status": return execUpdateIssueStatus(supabase, args);
    // Faciliate
    case "query_faciliate": return execQueryFaciliate(args);
    case "get_faciliate_object": return execGetFaciliateObject(args);
    // Adaptive Memory
    case "save_memory": return execSaveMemory(supabase, args, (globalThis as any).__currentUserId);
    default: return { error: `Unknown tool: ${name}` };
  }
}

/* ─────────────────────────────────────────────
   Conversation memory — null-safe
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

  // Null-safe lookup: use .is() for null, .eq() for actual values
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

function detectSimpleIntent(messages: any[]): string | null {
  if (!messages.length) return null;
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role !== "user") return null;
  const text = lastMsg.content.toLowerCase().trim();

  // Greetings
  if (/^(hej|hallå|tja|tjena|hi|hello|hey|god\s*(morgon|kväll|dag)|good\s*(morning|evening|day))[\s!.]*$/i.test(text)) return "greeting";
  // Thank you
  if (/^(tack|thanks|thank\s*you|tackar)[\s!.]*$/i.test(text)) return "thanks";
  // Help/what can you do
  if (/^(hjälp|help|vad kan du|what can you do)[\s?!.]*$/i.test(text)) return "help";
  // FM Access capability question
  if (/fm\s*access/i.test(text) && /kan\s+du|can\s+you|klarar|stöd|support|frågor\s+om|questions?\s+about/i.test(text)) return "help_fm_access";
  // Language change
  if (/^(byt\s*(till\s*)?(svenska|engelska|english|swedish)|switch\s*(to\s*)?(swedish|english|svenska|engelska))[\s?!.]*$/i.test(text)) return "lang_change";

  return null;
}

function getSimpleIntentResponse(intent: string, text: string, speechLang: string): string {
  const isSv = speechLang === "sv-SE" || /^(hej|hallå|tja|tjena|tack|hjälp|byt|god)/i.test(text);

  switch (intent) {
    case "greeting":
      return isSv
        ? "Hej! Hur kan jag hjälpa dig idag?"
        : "Hello! How can I help you today?";
    case "thanks":
      return isSv
        ? "Varsågod! Finns det något mer jag kan hjälpa dig med?"
        : "You're welcome! Is there anything else I can help with?";
    case "help":
      return isSv
        ? "Jag kan hjälpa dig med:\n\n• **Byggnadsdata** — våningar, rum, ytor, utrustning\n• **Felanmälningar** — skapa, söka, följa upp\n• **Ritningar & dokument** — hitta och visa\n• **3D-navigering** — öppna viewer, visa våningar/modeller\n• **IoT-sensordata** — temperatur, CO2, energi\n• **Plattformshjälp** — hur funktioner fungerar\n\nVad vill du veta mer om?"
        : "I can help you with:\n\n• **Building data** — floors, rooms, areas, equipment\n• **Fault reports** — create, search, follow up\n• **Drawings & documents** — find and display\n• **3D navigation** — open viewer, show floors/models\n• **IoT sensor data** — temperature, CO2, energy\n• **Platform help** — how features work\n\nWhat would you like to know?";
    case "help_fm_access":
      return isSv
        ? "Ja, absolut! Jag kan hjälpa dig med FM Access-data:\n\n• **Ritningar** — söka och visa planritningar per våning\n• **Dokument** — hitta teknisk dokumentation kopplad till objekt\n• **DoU-instruktioner** — drift- och underhållsinstruktioner\n• **Objektsökning** — söka efter specifika objekt i FM Access\n• **Våningsplaner** — lista våningar och hierarki\n\nJag hämtar data direkt från FM Access (Tessel HDC) i realtid. Vad vill du veta?"
        : "Yes, absolutely! I can help you with FM Access data:\n\n• **Drawings** — search and display floor plans per level\n• **Documents** — find technical documentation linked to objects\n• **O&M instructions** — operation and maintenance instructions\n• **Object search** — search for specific objects in FM Access\n• **Floor plans** — list floors and hierarchy\n\nI fetch data directly from FM Access (Tessel HDC) in real-time. What would you like to know?";
    case "lang_change": {
      const wantsEn = /english|engelska/i.test(text);
      return wantsEn
        ? "Sure! [🇬🇧 Switch to English](action:changeLang:en-US)"
        : "Självklart! [🇸🇪 Byt till svenska](action:changeLang:sv-SE)";
    }
    default:
      return "";
  }
}

/** Create a fake SSE stream from a static string */
function createStaticStream(content: string): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      // Send as a single SSE chunk
      const data = JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] });
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

/* ─────────────────────────────────────────────
   Build system prompt — COMPRESSED
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
  if (context?.viewerState) {
    const vs = context.viewerState;
    ctx += `\nViewer: mode=${vs.viewMode}, floors=${vs.visibleFloorFmGuids?.length || 0}, selected=${vs.selectedFmGuids?.length || 0}`;
  }

  // Standalone AI mode — no viewer available
  if (context?.activeApp === 'ai-standalone') {
    ctx += `\n\nSTANDALONE AI MODE (CRITICAL):
You are running in the standalone AI app WITHOUT a 3D viewer.
- Do NOT use viewer tools (viewer_show_floor, viewer_show_model, viewer_open_3d, viewer_show_drawing).
- Do NOT generate viewer action links (action:flyTo, action:showFloor, action:showFloorIn3D, action:isolateModel, action:showDrawing, action:openViewer3D, action:switchTo2D, action:switchTo3D).
- Instead, answer with DATA ONLY (text, numbers, bullet points, tables).
- For "visa 3D", "öppna viewer", "show model" requests, respond: "I den fristående AI-appen kan jag inte visa 3D-modeller, men jag kan berätta om byggnaden. Öppna Geminus-appen för 3D-visning."
- You CAN still use ALL data tools: query_assets, get_building_summary, senslinc, fm_access, documents, resolve_building_by_name, etc.
- When no building context is set and user asks "vilka byggnader har jag" or similar, ALWAYS use list_buildings tool. Do NOT use query_assets for this. Present each building as a selectBuilding action button.
- selectBuilding and changeLang actions ARE allowed in standalone mode.`;
  }

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

  return `You are Geminus, an AI assistant for digital facility management. You help users with digital twins, IoT, drawings, equipment, and property systems.

CORE RULES:
1. ALWAYS use tools to get data — never guess or fabricate numbers/data.
2. If no data found, say so clearly. NEVER generate mock/placeholder data.
3. Respond in the SAME LANGUAGE as the user.
4. Be concise: max 3 sentences of running text, use bullet points for lists.
5. NEVER show UUIDs/GUIDs to the user — only in action link URLs.
6. ALWAYS end with 1-3 relevant next-step suggestions as clickable action buttons.
7. When disambiguating buildings, present them as clickable selectBuilding buttons.
8. NEVER respond with a clarifying question when the user asks a specific data question. Always attempt to answer first using tools. Only ask a clarifying question when the query is genuinely ambiguous AND you cannot proceed with any tool.
9. Analyze data and provide insights (%, trends, anomalies), not raw data dumps.
10. For greetings, respond naturally without action tokens. Keep it short.
11. NEVER output raw action tokens like [action:type:param]. ALL action links MUST use markdown link syntax: [Visible Label](action:type:param). Any action token without a visible label and markdown link syntax is FORBIDDEN.
12. NEVER use server-side tool names (like search_help_docs, list_buildings, query_assets, resolve_building_by_name, get_building_summary) as action tokens. Action tokens are ONLY for client-side UI navigation listed under ALLOWED ACTION TOKENS below. Tool names and action tokens are completely separate systems.

CRITICAL — FM ACCESS QUERIES (HIGHEST PRIORITY ROUTING):
When user asks about "FM Access", "ritningar", "dokument i FM Access", "DoU", "teknisk dokumentation", or references FM Access data:
→ NEVER use get_building_summary, query_assets, or aggregate_assets — those query LOCAL Geminus data, NOT FM Access.
→ If the user asks WHETHER you can answer FM Access questions (e.g. "kan du svara på frågor om fm access?"), answer YES and explain your FM Access capabilities (drawings, documents, DoU, object search, floor hierarchy) — do NOT run any data queries.
→ First call query_building_settings to get fm_access_building_guid for the current building.
→ Then use fm_access_get_drawings, fm_access_get_documents, fm_access_get_hierarchy, fm_access_get_floors, or fm_access_search_objects for LIVE FM Access data.
→ Use search_fm_access_local only for fast cached searches of previously synced FM Access data.
→ If fm_access_building_guid is null/missing, tell user: "Den här byggnaden har ingen FM Access-koppling konfigurerad."
→ All other building data (assets, work orders, issues, sensors) comes from Geminus backend — use normal tools for those.

CRITICAL — BUILDING DISCOVERY & NAME RESOLUTION:
When the user asks "vilka byggnader har du/jag", "which buildings", "lista byggnader", "what buildings do I have", or ANY question about listing/discovering ALL buildings:
→ ALWAYS use the list_buildings tool. Do NOT use query_assets or resolve_building_by_name for this.
→ Present ALL results as selectBuilding action buttons so the user can pick one.
→ Example: "Här är dina byggnader:\n\n[🏢 Småviken](action:selectBuilding:guid:Sm%C3%A5viken)\n[🏢 Tornet](action:selectBuilding:guid:Tornet)"

When the user mentions a SPECIFIC building by name (e.g. "Småviken", "Kranen", "Tornet") and no current building context is set:
→ ALWAYS call resolve_building_by_name FIRST to find the fm_guid.
→ Then use the resolved fm_guid in subsequent tool calls (query_assets, get_building_summary, etc.).
→ If multiple buildings match, present them as selectBuilding buttons and ask the user to choose.
→ NEVER give a generic greeting when the user asks a specific data question.

CRITICAL — ALARM/EQUIPMENT QUERIES:
When user asks about "alarm", "larm", "brandlarm", "utrustning", "installationer":
→ These are stored as assets with category="Instance" and asset_type containing e.g. "IfcAlarm", "IfcSensor", "IfcActuator", "IfcFireAlarm".
→ Use query_assets with asset_type filter (e.g. asset_type="Alarm" or "IfcAlarm") and building_fm_guid + level_fm_guid for floor filtering.
→ For floor filtering: first use get_building_summary to find the floor fm_guid, then filter by level_fm_guid.
→ "Plan 2" or "Våning 2" means filter by the floor whose name contains "2" or "Plan 2".

CRITICAL — ALWAYS ATTEMPT TO ANSWER:
If the user asks a data question, you MUST attempt to use tools to find the answer. NEVER respond with just a greeting or "how can I help" when a specific question was asked.

ALLOWED ACTION TOKENS (markdown links only):
- action:flyTo:<fmGuid>
- action:openViewer:<fmGuid>
- action:showFloor:<floorFmGuid>
- action:selectInTree:<fmGuid1,fmGuid2,...>
- action:switchTo2D / action:switchTo3D
- action:showFloorIn3D:<buildingGuid>:<floorGuid>:<encodedFloorName>
- action:isolateModel:<buildingGuid>:<modelId>
- action:showDrawing:<buildingGuid>:<encodedFloorName>
- action:openViewer3D:<buildingGuid>:<floorGuid>
- action:selectBuilding:<buildingGuid>:<encodedBuildingName>
- action:changeLang:<sv-SE|en-US>
- action:listVoices / action:selectVoice:<encodedVoiceName>
Do NOT generate any other action: tokens.

RESPONSE FORMAT:
1. Direct answer — short, bold key figures
2. Context (optional, max 2 sentences)
3. Next steps — clickable action buttons

SPEECH/LANGUAGE: When user asks to change language, offer changeLang action. When asking about voices, offer listVoices action.

VIEWER CONTROL: Use viewer_show_floor, viewer_show_model, viewer_open_3d, viewer_show_drawing tools. Include their action_link in your response. Model naming: A=Arkitekt, K=Konstruktion, V=VVS, E=El, S=Sprinkler.

WORK ORDERS: Always ask for confirmation before creating. Use create_work_order tool after user confirms.

DOCUMENT Q&A: Use ask_about_documents for content questions. Use query_documents for listing.

HELP/SUPPORT: Use search_help_docs tool when user asks about platform usage.

FACILIATE/SWG: Use query_faciliate and get_faciliate_object for external FM system data.

IoT/SENSORS: Use senslinc_get_sites to find monitored buildings, senslinc_get_indices for workspace keys, senslinc_search_data for time-series data.

ADAPTIVE MEMORY: When user gives instructions like "kom ihåg att...", "remember that...", "nästa gång, gör X", "jag föredrar...", or corrects you ("nej, det stämmer inte, det ska vara..."):
→ Call save_memory with the instruction/correction/preference.
→ Confirm briefly: "Noterat! Jag kommer ihåg det." (or English equivalent).
→ If LEARNED CONTEXT is present below, ALWAYS respect those preferences and corrections — they override default behavior.
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
    const { messages, context, proactive, advisor } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const userId = auth.userId!;
    // Store userId for tool execution context
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
        insights.push(highPriority.length > 0
          ? `⚠️ **${highPriority.length} high-priority issues** in ${buildingName}`
          : `📋 **${issueCount} open issues** in ${buildingName}`);
      }
      if (woCount > 0) insights.push(`🔧 **${woCount} open work orders** to handle`);
      if (insights.length === 0) insights.push(`✅ No open issues or work orders in ${buildingName} right now.`);
      return new Response(JSON.stringify({ proactive_insights: insights }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── FAST-PATH: detect simple intents and skip tool loop ──
    const simpleIntent = detectSimpleIntent(messages);
    if (simpleIntent && !advisor) {
      const lastText = messages[messages.length - 1]?.content || "";
      const speechLang = context?.speechLang || "sv-SE";
      const response = getSimpleIntentResponse(simpleIntent, lastText, speechLang);
      console.log(`Fast-path intent: ${simpleIntent} (${Date.now() - startTime}ms)`);

      // Save conversation
      const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
      saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content: response }]).catch(e =>
        console.error("Failed to save conversation:", e)
      );

      return new Response(createStaticStream(response), {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // ── Full tool-calling loop ──
    let systemPrompt = await buildSystemPrompt(supabase, context, userProfile, previousConversation);
    // Inject learned memories
    if (userMemories) systemPrompt += userMemories;

    if (advisor && context?.currentBuilding) {
      systemPrompt += `\n\nADVISOR MODE: Perform comprehensive FM analysis of "${context.currentBuilding.name}" (fm_guid: ${context.currentBuilding.fmGuid}). Call get_building_summary, query_work_orders, query_issues, aggregate_assets. Present a structured advisory report.`;
    }

    const conversation: any[] = [{ role: "system", content: systemPrompt }, ...messages];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await callAI(LOVABLE_API_KEY, conversation, { tools, tool_choice: "auto" });
      const result = await resp.json();
      const choice = result.choices?.[0];

      if (!choice?.message?.tool_calls || choice.message.tool_calls.length === 0) {
        // No tools needed — if the model already produced content, fake-stream it
        // Otherwise make a streaming call
        const existingContent = choice?.message?.content;
        if (existingContent) {
          console.log(`Gunnar: direct answer (${Date.now() - startTime}ms, round ${round + 1})`);
          const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
          saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, [...userMsgs, { role: "assistant", content: existingContent }]).catch(e =>
            console.error("Failed to save conversation:", e)
          );
          return new Response(createStaticStream(existingContent), {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
        }

        // Fallback: make a streaming call
        const streamResp = await callAI(LOVABLE_API_KEY, conversation, { stream: true });
        const userMsgs = messages.filter((m: any) => m.role === "user" || m.role === "assistant");
        saveConversation(supabase, userId, context?.currentBuilding?.fmGuid || null, userMsgs).catch(e =>
          console.error("Failed to save conversation:", e)
        );
        console.log(`Gunnar: streaming fallback (${Date.now() - startTime}ms, round ${round + 1})`);
        return new Response(streamResp.body, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
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
            console.error(`Tool ${tc.function.name} JSON parse error:`, parseErr, tc.function.arguments);
            return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: `Invalid tool arguments: ${parseErr}` }) };
          }
          try {
            const result = await executeTool(supabase, tc.function.name, args, LOVABLE_API_KEY);
            return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify(result) };
          } catch (err) {
            console.error(`Tool ${tc.function.name} error:`, err);
            return { role: "tool" as const, tool_call_id: tc.id, content: JSON.stringify({ error: String(err) }) };
          }
        })
      );

      conversation.push(...toolResults);
    }

    console.log(`Gunnar: max rounds reached, streaming final (${Date.now() - startTime}ms)`);
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
