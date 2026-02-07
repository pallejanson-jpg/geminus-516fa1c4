import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, forbiddenResponse, corsHeaders } from "../_shared/auth.ts";

// ============ APS OAUTH 2-LEGGED ============

async function getApsAccessToken(): Promise<string> {
  const clientId = Deno.env.get("APS_CLIENT_ID");
  const clientSecret = Deno.env.get("APS_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Missing APS credentials (APS_CLIENT_ID / APS_CLIENT_SECRET)");
  }

  const credentials = btoa(`${clientId}:${clientSecret}`);

  const res = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "data:read account:read",
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`APS auth failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ============ REGION HELPERS ============

function getBaseUrl(region?: string): string {
  // EMEA uses a different base URL for ACC/AEC Data Model APIs
  if (region?.toUpperCase() === "EMEA") {
    return "https://developer.api.autodesk.com";
  }
  return "https://developer.api.autodesk.com";
}

function getRegionHeader(region?: string): Record<string, string> {
  if (region?.toUpperCase() === "EMEA") {
    return { "region": "EMEA" };
  }
  return {};
}

// ============ ACC API HELPERS ============

interface LocationNode {
  id: string;
  parentId: string | null;
  type: string; // "Root" | "Area" | "Level"
  name: string;
  description: string | null;
  barcode: string | null;
  order: number;
}

interface AccAsset {
  id: string;
  clientAssetId: string;
  categoryId: string;
  description: string | null;
  locationId: string | null;
  barcode: string | null;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  customAttributes?: Record<string, any>;
}

async function fetchAllLocationNodes(
  token: string,
  projectId: string,
  region?: string,
): Promise<LocationNode[]> {
  const allNodes: LocationNode[] = [];
  let offset = 0;
  const limit = 10000;
  const cleanProjectId = projectId.replace(/^b\./, "");
  const regionHeaders = getRegionHeader(region);

  while (true) {
    const url = `https://developer.api.autodesk.com/construction/locations/v2/projects/${cleanProjectId}/trees/default/nodes?limit=${limit}&offset=${offset}`;
    const headers: Record<string, string> = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...regionHeaders,
    };

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Locations API failed (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    const nodes = data.results || [];
    allNodes.push(...nodes);

    if (nodes.length < limit || !data.pagination?.nextUrl) break;
    offset += limit;
  }

  return allNodes;
}

async function fetchAccAssets(
  token: string,
  projectId: string,
  region?: string,
  cursorState?: string,
): Promise<{ results: AccAsset[]; cursorState?: string }> {
  const cleanProjectId = projectId.replace(/^b\./, "");
  const regionHeaders = getRegionHeader(region);
  let url = `https://developer.api.autodesk.com/construction/assets/v2/projects/${cleanProjectId}/assets?limit=200`;
  if (cursorState) url += `&cursorState=${encodeURIComponent(cursorState)}`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...regionHeaders,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Assets API failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return {
    results: data.results || [],
    cursorState: data.pagination?.cursorState || undefined,
  };
}

async function fetchAccCategories(
  token: string,
  projectId: string,
  region?: string,
): Promise<Record<string, string>> {
  const cleanProjectId = projectId.replace(/^b\./, "");
  const regionHeaders = getRegionHeader(region);
  const url = `https://developer.api.autodesk.com/construction/assets/v1/projects/${cleanProjectId}/categories`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...regionHeaders,
    },
  });

  if (!res.ok) {
    console.log(`Categories API failed (${res.status}), continuing without category names`);
    return {};
  }

  const data = await res.json();
  const categories: Record<string, string> = {};
  for (const cat of (data.results || data || [])) {
    categories[cat.id] = cat.name || cat.id;
  }
  return categories;
}

async function fetchAccProjectsViaDataManagement(
  token: string,
  accountId: string,
  region?: string,
): Promise<any[]> {
  // Data Management API uses hub format "b.{accountId}"
  const cleanAccountId = accountId.replace(/^b\./, "");
  const hubId = `b.${cleanAccountId}`;
  const regionHeaders = getRegionHeader(region);
  const url = `https://developer.api.autodesk.com/project/v1/hubs/${hubId}/projects`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...regionHeaders,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Data Management Projects API failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  // Data Management API returns { data: [...] } with different shape
  const projects = data.data || [];
  return projects.map((p: any) => ({
    id: p.id?.replace(/^b\./, "") || p.id,
    name: p.attributes?.name || p.id,
    status: p.attributes?.status || "active",
    type: p.attributes?.type || null,
    startDate: p.attributes?.startDate || null,
    endDate: p.attributes?.endDate || null,
  }));
}

async function fetchAccProjects(
  token: string,
  accountId: string,
  region?: string,
): Promise<any[]> {
  const cleanAccountId = accountId.replace(/^b\./, "");
  const regionHeaders = getRegionHeader(region);
  const url = `https://developer.api.autodesk.com/construction/admin/v1/accounts/${cleanAccountId}/projects?limit=100`;

  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      ...regionHeaders,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Projects API failed (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.results || data || [];
}

// ============ LOCATION TREE MAPPING ============

interface MappedNode {
  node: LocationNode;
  depth: number;
  category: string;
  buildingFmGuid: string | null;
  levelFmGuid: string | null;
}

function buildLocationTree(nodes: LocationNode[]): MappedNode[] {
  // Build parent->children map
  const childrenMap: Record<string, LocationNode[]> = {};
  let rootNode: LocationNode | null = null;

  for (const node of nodes) {
    if (node.type === "Root" || !node.parentId) {
      rootNode = node;
      continue;
    }
    const parentId = node.parentId;
    if (!childrenMap[parentId]) childrenMap[parentId] = [];
    childrenMap[parentId].push(node);
  }

  if (!rootNode) {
    // No root found, treat first parentId=null as root
    const noParent = nodes.filter(n => !n.parentId);
    if (noParent.length > 0) rootNode = noParent[0];
  }

  if (!rootNode) return [];

  // BFS from root, assign depth-based categories
  const mapped: MappedNode[] = [];
  const queue: { node: LocationNode; depth: number; buildingGuid: string | null; levelGuid: string | null }[] = [];

  // Children of root are depth 1
  const rootChildren = childrenMap[rootNode.id] || [];
  for (const child of rootChildren) {
    queue.push({ node: child, depth: 1, buildingGuid: null, levelGuid: null });
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    const { node, depth } = item;

    let category: string;
    let buildingGuid = item.buildingGuid;
    let levelGuid = item.levelGuid;

    if (depth === 1) {
      category = "Building";
      buildingGuid = node.id;
    } else if (depth === 2) {
      category = "Building Storey";
      levelGuid = node.id;
    } else {
      category = "Space";
    }

    mapped.push({
      node,
      depth,
      category,
      buildingFmGuid: buildingGuid,
      levelFmGuid: levelGuid,
    });

    // Queue children
    const children = childrenMap[node.id] || [];
    for (const child of children) {
      queue.push({
        node: child,
        depth: depth + 1,
        buildingGuid: buildingGuid,
        levelGuid: depth >= 2 ? levelGuid : null, // Level only set from depth 2+
      });
    }
  }

  return mapped;
}

// ============ UPSERT HELPERS ============

async function upsertLocationAssets(
  supabase: any,
  mappedNodes: MappedNode[],
  accProjectId: string,
): Promise<number> {
  if (mappedNodes.length === 0) return 0;

  const assets = mappedNodes.map(m => ({
    fm_guid: `acc-${m.node.id}`,
    category: m.category,
    name: null,
    common_name: m.node.name,
    building_fm_guid: m.category === "Building" ? `acc-${m.node.id}` : (m.buildingFmGuid ? `acc-${m.buildingFmGuid}` : null),
    level_fm_guid: m.category === "Building Storey" ? `acc-${m.node.id}` : (m.levelFmGuid ? `acc-${m.levelFmGuid}` : null),
    in_room_fm_guid: null,
    attributes: {
      source: "acc",
      acc_project_id: accProjectId,
      acc_node_id: m.node.id,
      acc_node_type: m.node.type,
      acc_barcode: m.node.barcode,
      acc_depth: m.depth,
    },
    synced_at: new Date().toISOString(),
  }));

  // Batch upsert in chunks of 200
  let total = 0;
  for (let i = 0; i < assets.length; i += 200) {
    const chunk = assets.slice(i, i + 200);
    const { error } = await supabase
      .from("assets")
      .upsert(chunk, { onConflict: "fm_guid", ignoreDuplicates: false });
    if (error) throw error;
    total += chunk.length;
  }

  return total;
}

async function upsertAccAssets(
  supabase: any,
  accAssets: AccAsset[],
  locationMap: Map<string, MappedNode>,
  categoryMap: Record<string, string>,
  accProjectId: string,
): Promise<number> {
  if (accAssets.length === 0) return 0;

  const assets = accAssets.map(a => {
    // Resolve location to building/level/room
    let buildingFmGuid: string | null = null;
    let levelFmGuid: string | null = null;
    let inRoomFmGuid: string | null = null;

    if (a.locationId) {
      const locNode = locationMap.get(a.locationId);
      if (locNode) {
        if (locNode.category === "Space") {
          inRoomFmGuid = `acc-${locNode.node.id}`;
          levelFmGuid = locNode.levelFmGuid ? `acc-${locNode.levelFmGuid}` : null;
          buildingFmGuid = locNode.buildingFmGuid ? `acc-${locNode.buildingFmGuid}` : null;
        } else if (locNode.category === "Building Storey") {
          levelFmGuid = `acc-${locNode.node.id}`;
          buildingFmGuid = locNode.buildingFmGuid ? `acc-${locNode.buildingFmGuid}` : null;
        } else if (locNode.category === "Building") {
          buildingFmGuid = `acc-${locNode.node.id}`;
        }
      }
    }

    const categoryName = a.categoryId ? (categoryMap[a.categoryId] || null) : null;

    return {
      fm_guid: `acc-asset-${a.id}`,
      category: "Instance",
      name: a.clientAssetId || null,
      common_name: a.description || a.clientAssetId || null,
      building_fm_guid: buildingFmGuid,
      level_fm_guid: levelFmGuid,
      in_room_fm_guid: inRoomFmGuid,
      asset_type: categoryName,
      attributes: {
        source: "acc",
        acc_project_id: accProjectId,
        acc_asset_id: a.id,
        acc_category_id: a.categoryId,
        acc_barcode: a.barcode,
        acc_custom_attributes: a.customAttributes,
      },
      synced_at: new Date().toISOString(),
    };
  });

  let total = 0;
  for (let i = 0; i < assets.length; i += 200) {
    const chunk = assets.slice(i, i + 200);
    const { error } = await supabase
      .from("assets")
      .upsert(chunk, { onConflict: "fm_guid", ignoreDuplicates: false });
    if (error) throw error;
    total += chunk.length;
  }

  return total;
}

// ============ SYNC STATE HELPERS ============

async function updateSyncState(
  supabase: any,
  subtreeId: string,
  status: string,
  totalAssets?: number,
  errorMessage?: string,
) {
  const updateData: any = {
    subtree_id: subtreeId,
    subtree_name: subtreeId === "acc-locations" ? "ACC Platser" : "ACC Tillgångar",
    sync_status: status,
    updated_at: new Date().toISOString(),
  };

  if (status === "running") {
    updateData.last_sync_started_at = new Date().toISOString();
    updateData.error_message = null;
  } else if (status === "completed") {
    updateData.last_sync_completed_at = new Date().toISOString();
    updateData.error_message = null;
  }

  if (totalAssets !== undefined) updateData.total_assets = totalAssets;
  if (errorMessage) updateData.error_message = errorMessage;

  await supabase
    .from("asset_sync_state")
    .upsert(updateData, { onConflict: "subtree_id" });
}

// ============ MAIN HANDLER ============

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await verifyAuth(req);
    if (!auth.authenticated) {
      return unauthorizedResponse(auth.error);
    }
    if (!auth.isAdmin) {
      return forbiddenResponse();
    }

    const { action, projectId, region } = await req.json();
    console.log(`ACC Sync action: ${action} (user: ${auth.userId})`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    switch (action) {
      // ---- TEST CONNECTION ----
      case "test-connection": {
        const token = await getApsAccessToken();
        return new Response(
          JSON.stringify({
            success: true,
            message: "Anslutning till Autodesk lyckades!",
            tokenPreview: token.substring(0, 8) + "...",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ---- LIST PROJECTS ----
      case "list-projects": {
        const accountId = Deno.env.get("ACC_ACCOUNT_ID");
        if (!accountId) {
          return new Response(
            JSON.stringify({ success: false, error: "ACC_ACCOUNT_ID not configured" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const token = await getApsAccessToken();
        let projects: any[] = [];
        let usedApi = "";

        // Strategy 1: Try Data Management API first (lower permission requirements)
        try {
          console.log("Trying Data Management API for project list...");
          projects = await fetchAccProjectsViaDataManagement(token, accountId, region);
          usedApi = "data-management";
          console.log(`Data Management API returned ${projects.length} projects`);
        } catch (dmError) {
          console.log(`Data Management API failed: ${dmError instanceof Error ? dmError.message : String(dmError)}`);
          
          // Strategy 2: Fallback to Construction Admin API
          try {
            console.log("Falling back to Construction Admin API...");
            const rawProjects = await fetchAccProjects(token, accountId, region);
            projects = rawProjects.map((p: any) => ({
              id: p.id,
              name: p.name,
              status: p.status,
              type: p.type,
              startDate: p.startDate,
              endDate: p.endDate,
            }));
            usedApi = "admin";
            console.log(`Admin API returned ${projects.length} projects`);
          } catch (adminError) {
            console.error(`Both APIs failed. Admin error: ${adminError instanceof Error ? adminError.message : String(adminError)}`);
            return new Response(
              JSON.stringify({
                success: false,
                error: `Kunde inte hämta projekt. Data Management API och Admin API misslyckades båda. Du kan ange projekt-ID manuellt istället.\n\nAdmin-fel: ${adminError instanceof Error ? adminError.message : String(adminError)}`,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            projects,
            usedApi,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ---- SYNC LOCATIONS ----
      case "sync-locations": {
        if (!projectId) {
          return new Response(
            JSON.stringify({ success: false, error: "projectId is required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        await updateSyncState(supabase, "acc-locations", "running");

        try {
          const token = await getApsAccessToken();
          const nodes = await fetchAllLocationNodes(token, projectId, region);
          console.log(`Fetched ${nodes.length} location nodes from ACC`);

          const mapped = buildLocationTree(nodes);
          console.log(`Mapped ${mapped.length} nodes (excl. root)`);

          const upserted = await upsertLocationAssets(supabase, mapped, projectId);

          // Save project ID to cache for future reference
          await supabase
            .from("asset_plus_endpoint_cache")
            .upsert(
              { key: "acc_project_id", value: projectId, updated_at: new Date().toISOString() },
              { onConflict: "key" },
            );

          await updateSyncState(supabase, "acc-locations", "completed", upserted);

          const buildings = mapped.filter(m => m.category === "Building").length;
          const storeys = mapped.filter(m => m.category === "Building Storey").length;
          const spaces = mapped.filter(m => m.category === "Space").length;

          return new Response(
            JSON.stringify({
              success: true,
              message: `Synkade ${upserted} platser: ${buildings} byggnader, ${storeys} våningar, ${spaces} rum`,
              totalNodes: nodes.length,
              buildings,
              storeys,
              spaces,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          await updateSyncState(supabase, "acc-locations", "failed", undefined, errMsg);
          throw error;
        }
      }

      // ---- SYNC ASSETS ----
      case "sync-assets": {
        if (!projectId) {
          return new Response(
            JSON.stringify({ success: false, error: "projectId is required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        await updateSyncState(supabase, "acc-assets", "running");

        try {
          const token = await getApsAccessToken();

          // First, fetch location tree to resolve locationId -> building/level/room
          const nodes = await fetchAllLocationNodes(token, projectId, region);
          const mapped = buildLocationTree(nodes);
          const locationMap = new Map<string, MappedNode>();
          for (const m of mapped) {
            locationMap.set(m.node.id, m);
          }

          // Fetch categories
          const categoryMap = await fetchAccCategories(token, projectId, region);

          // Fetch all assets with pagination
          let totalSynced = 0;
          let cursorState: string | undefined;

          do {
            const page = await fetchAccAssets(token, projectId, region, cursorState);
            console.log(`Fetched ${page.results.length} assets (cursor: ${cursorState ? "yes" : "start"})`);

            if (page.results.length > 0) {
              const upserted = await upsertAccAssets(
                supabase,
                page.results,
                locationMap,
                categoryMap,
                projectId,
              );
              totalSynced += upserted;
            }

            cursorState = page.cursorState;
          } while (cursorState);

          await updateSyncState(supabase, "acc-assets", "completed", totalSynced);

          return new Response(
            JSON.stringify({
              success: true,
              message: `Synkade ${totalSynced} tillgångar från ACC`,
              totalSynced,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          await updateSyncState(supabase, "acc-assets", "failed", undefined, errMsg);
          throw error;
        }
      }

      // ---- CHECK STATUS ----
      case "check-status": {
        const { data: syncStates } = await supabase
          .from("asset_sync_state")
          .select("*")
          .in("subtree_id", ["acc-locations", "acc-assets"]);

        // Count ACC-sourced items in local DB
        const { count: locCount } = await supabase
          .from("assets")
          .select("id", { count: "exact", head: true })
          .like("fm_guid", "acc-%")
          .neq("category", "Instance");

        const { count: assetCount } = await supabase
          .from("assets")
          .select("id", { count: "exact", head: true })
          .like("fm_guid", "acc-asset-%");

        // Get saved project ID
        const { data: cachedProject } = await supabase
          .from("asset_plus_endpoint_cache")
          .select("value")
          .eq("key", "acc_project_id")
          .maybeSingle();

        return new Response(
          JSON.stringify({
            success: true,
            locationsSyncState: syncStates?.find((s: any) => s.subtree_id === "acc-locations") || null,
            assetsSyncState: syncStates?.find((s: any) => s.subtree_id === "acc-assets") || null,
            localLocationCount: locCount || 0,
            localAssetCount: assetCount || 0,
            savedProjectId: cachedProject?.value || null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }
  } catch (error) {
    console.error("ACC Sync error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
