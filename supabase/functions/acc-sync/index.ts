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

// ============ 3-LEGGED TOKEN HELPER ============

/**
 * Try to get a valid 3-legged access token for the given user.
 * Returns the token string if available (refreshing if expired),
 * or null if no 3-legged session exists.
 */
async function getThreeLeggedToken(userId: string, serviceClient: any): Promise<string | null> {
  const { data: tokenRow, error } = await serviceClient
    .from("acc_oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !tokenRow) return null;

  const isExpired = new Date(tokenRow.expires_at) < new Date();

  if (!isExpired) {
    return tokenRow.access_token;
  }

  // Try to refresh
  try {
    const clientId = Deno.env.get("APS_CLIENT_ID")!;
    const clientSecret = Deno.env.get("APS_CLIENT_SECRET")!;

    const res = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) {
      console.error(`3-legged token refresh failed (${res.status})`);
      // Delete invalid tokens
      await serviceClient.from("acc_oauth_tokens").delete().eq("user_id", userId);
      return null;
    }

    const data = await res.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

    await serviceClient
      .from("acc_oauth_tokens")
      .update({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    console.log("3-legged token refreshed successfully");
    return data.access_token;
  } catch (err) {
    console.error("3-legged token refresh error:", err);
    return null;
  }
}

/**
 * Get the best available token for ACC API calls.
 * Prefers 3-legged (user) token, falls back to 2-legged (app) token.
 */
async function getAccToken(userId: string | null, serviceClient: any): Promise<{ token: string; is3Legged: boolean }> {
  if (userId) {
    const threeLeggedToken = await getThreeLeggedToken(userId, serviceClient);
    if (threeLeggedToken) {
      console.log("Using 3-legged (user) token for ACC API calls");
      return { token: threeLeggedToken, is3Legged: true };
    }
  }
  console.log("Using 2-legged (app) token for ACC API calls");
  const token = await getApsAccessToken();
  return { token, is3Legged: false };
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
// ============ BIM SYNC HELPERS ============

function isBimFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ['rvt', 'ifc', 'nwc', 'dwg', 'nwd'].includes(ext);
}

function parseLDJSON(text: string): any[] {
  return text.split('\n')
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

async function extractBimHierarchy(
  token: string,
  projectId: string,
  versionUrns: string[],
  regionHeaders: Record<string, string>,
): Promise<{ levels: any[]; rooms: any[]; fieldsMap: Record<string, string>; indexState: string }> {
  const cleanProjectId = projectId.replace(/^b\./, "");

  // Step 1: POST to batch-status to start/check indexing
  const batchUrl = `https://developer.api.autodesk.com/construction/index/v2/projects/${cleanProjectId}/indexes:batch-status`;

  const batchRes = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...regionHeaders,
    },
    body: JSON.stringify({
      versions: versionUrns.map(urn => ({ versionUrn: urn })),
    }),
  });

  if (!batchRes.ok) {
    const errorText = await batchRes.text();
    throw new Error(`Model Properties batch-status failed (${batchRes.status}): ${errorText}`);
  }

  const batchData = await batchRes.json();
  const indexes = batchData.indexes || [];

  if (indexes.length === 0) {
    throw new Error('No indexes returned from batch-status');
  }

  // Step 2: Poll until all indexes are FINISHED (max ~45 seconds)
  const maxPollTime = 45000;
  const pollInterval = 3000;
  const startTime = Date.now();

  let allFinished = false;
  let currentIndexes = indexes;

  while (!allFinished && (Date.now() - startTime) < maxPollTime) {
    allFinished = currentIndexes.every((idx: any) => idx.state === 'FINISHED');
    if (allFinished) break;

    const hasProcessing = currentIndexes.some((idx: any) =>
      idx.state === 'PROCESSING' || idx.state === 'QUEUED'
    );
    if (!hasProcessing) break;

    await new Promise(resolve => setTimeout(resolve, pollInterval));

    // Re-check status
    const recheckRes = await fetch(batchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...regionHeaders,
      },
      body: JSON.stringify({
        versions: versionUrns.map(urn => ({ versionUrn: urn })),
      }),
    });

    if (recheckRes.ok) {
      const recheckData = await recheckRes.json();
      currentIndexes = recheckData.indexes || currentIndexes;
    }
  }

  // Check final state
  const finishedIndexes = currentIndexes.filter((idx: any) => idx.state === 'FINISHED');
  const overallState = allFinished ? 'FINISHED' :
    currentIndexes.some((idx: any) => idx.state === 'PROCESSING' || idx.state === 'QUEUED') ? 'PROCESSING' : 'PARTIAL';

  if (finishedIndexes.length === 0) {
    return { levels: [], rooms: [], fieldsMap: {}, indexState: overallState };
  }

  // Step 3: Fetch fields and properties from finished indexes
  const allLevels: any[] = [];
  const allRooms: any[] = [];
  const fieldsMap: Record<string, string> = {};

  for (const idx of finishedIndexes) {
    try {
      // Fetch fields
      if (idx.fieldsUrl) {
        const fieldsRes = await fetch(idx.fieldsUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (fieldsRes.ok) {
          const fieldsText = await fieldsRes.text();
          const fields = parseLDJSON(fieldsText);
          for (const field of fields) {
            if (field.key && field.name) {
              fieldsMap[field.key] = field.name;
            }
          }
        }
      }

      // Fetch properties
      if (idx.propertiesUrl) {
        const propsRes = await fetch(idx.propertiesUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (propsRes.ok) {
          const propsText = await propsRes.text();
          const props = parseLDJSON(propsText);

          // Known keys: p5eddc473 = Category, p153cb174 = Name
          let categoryKey = 'p5eddc473';
          let nameKey = 'p153cb174';
          let elevationKey = 'pdf1348b1';
          let levelKey = 'pbadfe721';

          // Try to find keys from fieldsMap
          for (const [key, name] of Object.entries(fieldsMap)) {
            const lowerName = (name as string).toLowerCase();
            if (lowerName === 'category' || lowerName === 'kategori') categoryKey = key;
            if (lowerName === 'name' || lowerName === 'namn') nameKey = key;
            if (lowerName === 'elevation' || lowerName === 'höjd') elevationKey = key;
            if (lowerName === 'level' || lowerName === 'våning' || lowerName === 'nivå') levelKey = key;
          }

          for (const obj of props) {
            const category = obj.props?.[categoryKey] || '';
            const name = obj.props?.[nameKey] || '';
            const externalId = obj.externalId || obj.svf2Id?.toString() || '';

            if (category === 'Revit Level' || category === 'Levels') {
              allLevels.push({
                externalId,
                name,
                elevation: obj.props?.[elevationKey] || null,
                objectId: obj.objectId,
                versionUrn: idx.versionUrn,
              });
            } else if (category === 'Revit Rooms' || category === 'Rooms') {
              allRooms.push({
                externalId,
                name,
                level: obj.props?.[levelKey] || null,
                objectId: obj.objectId,
                versionUrn: idx.versionUrn,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error processing index ${idx.indexId}:`, err);
    }
  }

  console.log(`BIM hierarchy: ${allLevels.length} levels, ${allRooms.length} rooms from ${finishedIndexes.length} models`);
  return { levels: allLevels, rooms: allRooms, fieldsMap, indexState: overallState };
}

async function upsertBimAssets(
  supabase: any,
  folderName: string,
  folderId: string,
  levels: any[],
  rooms: any[],
  accProjectId: string,
): Promise<{ building: number; levels: number; rooms: number }> {
  const buildingFmGuid = `acc-bim-building-${folderId.replace(/[^a-zA-Z0-9-]/g, '')}`;

  // 1. Upsert building
  const buildingAsset = {
    fm_guid: buildingFmGuid,
    category: 'Building',
    name: null,
    common_name: folderName,
    building_fm_guid: buildingFmGuid,
    attributes: {
      source: 'acc-bim',
      acc_project_id: accProjectId,
      acc_folder_id: folderId,
    },
    synced_at: new Date().toISOString(),
  };

  await supabase.from('assets').upsert(buildingAsset, { onConflict: 'fm_guid', ignoreDuplicates: false });

  // 2. Upsert levels
  const levelAssets = levels.map(level => ({
    fm_guid: `acc-bim-level-${level.externalId}`,
    category: 'Building Storey',
    name: null,
    common_name: level.name || `Level ${level.externalId}`,
    building_fm_guid: buildingFmGuid,
    level_fm_guid: `acc-bim-level-${level.externalId}`,
    attributes: {
      source: 'acc-bim',
      acc_project_id: accProjectId,
      acc_folder_id: folderId,
      bim_external_id: level.externalId,
      bim_elevation: level.elevation,
      bim_object_id: level.objectId,
      bim_version_urn: level.versionUrn,
    },
    synced_at: new Date().toISOString(),
  }));

  // 3. Upsert rooms with level matching
  const levelNameMap = new Map<string, string>();
  for (const level of levels) {
    levelNameMap.set(level.name, `acc-bim-level-${level.externalId}`);
  }

  const roomAssets = rooms.map(room => {
    let levelFmGuid: string | null = null;
    if (room.level) {
      levelFmGuid = levelNameMap.get(room.level) || null;
      if (!levelFmGuid) {
        for (const [levelName, levelGuid] of levelNameMap) {
          if (room.level.includes(levelName) || levelName.includes(room.level)) {
            levelFmGuid = levelGuid;
            break;
          }
        }
      }
    }

    return {
      fm_guid: `acc-bim-room-${room.externalId}`,
      category: 'Space',
      name: null,
      common_name: room.name || `Room ${room.externalId}`,
      building_fm_guid: buildingFmGuid,
      level_fm_guid: levelFmGuid,
      attributes: {
        source: 'acc-bim',
        acc_project_id: accProjectId,
        acc_folder_id: folderId,
        bim_external_id: room.externalId,
        bim_level_ref: room.level,
        bim_object_id: room.objectId,
        bim_version_urn: room.versionUrn,
      },
      synced_at: new Date().toISOString(),
    };
  });

  // Batch upsert
  const allAssets = [...levelAssets, ...roomAssets];
  for (let i = 0; i < allAssets.length; i += 200) {
    const chunk = allAssets.slice(i, i + 200);
    const { error } = await supabase.from('assets').upsert(chunk, { onConflict: 'fm_guid', ignoreDuplicates: false });
    if (error) throw error;
  }

  return { building: 1, levels: levelAssets.length, rooms: roomAssets.length };
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

    const body = await req.json();
    const { action, projectId, region } = body;
    console.log(`ACC Sync action: ${action} (user: ${auth.userId})`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    switch (action) {
      // ---- TEST CONNECTION ----
      case "test-connection": {
        // Test both 2-legged and 3-legged
        const { token, is3Legged } = await getAccToken(auth.userId, supabase);
        return new Response(
          JSON.stringify({
            success: true,
            message: is3Legged 
              ? "Anslutning via användarinloggning lyckades!" 
              : "Anslutning till Autodesk lyckades (app-token)!",
            tokenPreview: token.substring(0, 8) + "...",
            is3Legged,
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

        const { token } = await getAccToken(auth.userId, supabase);
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
          const { token, is3Legged } = await getAccToken(auth.userId, supabase);
          console.log(`Using ${is3Legged ? '3-legged' : '2-legged'} token for location sync`);
          const nodes = await fetchAllLocationNodes(token, projectId, region);
          console.log(`Fetched ${nodes.length} location nodes from ACC`);

          const mapped = buildLocationTree(nodes);
          console.log(`Mapped ${mapped.length} nodes (excl. root)`);

          const upserted = await upsertLocationAssets(supabase, mapped, projectId);

          // Save project ID and region to cache for future reference
          await supabase
            .from("asset_plus_endpoint_cache")
            .upsert(
              { key: "acc_project_id", value: projectId, updated_at: new Date().toISOString() },
              { onConflict: "key" },
            );

          if (region) {
            await supabase
              .from("asset_plus_endpoint_cache")
              .upsert(
                { key: "acc_region", value: region, updated_at: new Date().toISOString() },
                { onConflict: "key" },
              );
          }

          await updateSyncState(supabase, "acc-locations", "completed", upserted);

          const buildings = mapped.filter(m => m.category === "Building").length;
          const storeys = mapped.filter(m => m.category === "Building Storey").length;
          const spaces = mapped.filter(m => m.category === "Space").length;

          // Build a helpful message depending on the result
          let message: string;
          let hint: string | undefined;
          if (buildings === 0 && storeys === 0 && spaces === 0) {
            message = "ACC-projektet har inga platser konfigurerade i Locations-modulen (bara root-nod).";
            hint = "Platsdata (byggnader, plan, rum) kan finnas i BIM-modellerna istället. Prova 'Visa mappar' för att se projektets mappstruktur och BIM-filer.";
          } else {
            message = `Synkade ${upserted} platser: ${buildings} byggnader, ${storeys} våningar, ${spaces} rum`;
          }

          return new Response(
            JSON.stringify({
              success: true,
              message,
              hint,
              totalNodes: nodes.length,
              buildings,
              storeys,
              spaces,
              emptyLocations: buildings === 0 && storeys === 0 && spaces === 0,
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
          const { token, is3Legged } = await getAccToken(auth.userId, supabase);
          console.log(`Using ${is3Legged ? '3-legged' : '2-legged'} token for asset sync`);

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

        // Get saved project ID and region
        const { data: cachedValues } = await supabase
          .from("asset_plus_endpoint_cache")
          .select("key, value")
          .in("key", ["acc_project_id", "acc_region"]);

        const savedProjectId = cachedValues?.find((c: any) => c.key === "acc_project_id")?.value || null;
        const savedRegion = cachedValues?.find((c: any) => c.key === "acc_region")?.value || null;

        return new Response(
          JSON.stringify({
            success: true,
            locationsSyncState: syncStates?.find((s: any) => s.subtree_id === "acc-locations") || null,
            assetsSyncState: syncStates?.find((s: any) => s.subtree_id === "acc-assets") || null,
            localLocationCount: locCount || 0,
            localAssetCount: assetCount || 0,
            savedProjectId,
            savedRegion,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ---- LIST FOLDERS (Data Management API) ----
      case "list-folders": {
        if (!projectId) {
          return new Response(
            JSON.stringify({ success: false, error: "projectId is required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { token } = await getAccToken(auth.userId, supabase);
        const accountId = Deno.env.get("ACC_ACCOUNT_ID");
        if (!accountId) {
          return new Response(
            JSON.stringify({ success: false, error: "ACC_ACCOUNT_ID not configured" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const cleanAccountId = accountId.replace(/^b\./, "");
        const hubId = `b.${cleanAccountId}`;
        const cleanProjectId = projectId.replace(/^b\./, "");
        const fullProjectId = `b.${cleanProjectId}`;
        const regionHeaders = getRegionHeader(region);

        // Step 1: Get top folders
        const topFoldersUrl = `https://developer.api.autodesk.com/project/v1/hubs/${hubId}/projects/${fullProjectId}/topFolders`;
        console.log(`Fetching top folders: ${topFoldersUrl}`);
        const topRes = await fetch(topFoldersUrl, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            ...regionHeaders,
          },
        });

        if (!topRes.ok) {
          const errorText = await topRes.text();
          return new Response(
            JSON.stringify({ success: false, error: `Top folders API failed (${topRes.status}): ${errorText}` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const topData = await topRes.json();
        const topFolders = topData.data || [];
        console.log(`Found ${topFolders.length} top-level folders`);

        // Step 2: Find "Project Files" folder (or similar)
        const projectFilesFolder = topFolders.find((f: any) => {
          const name = f.attributes?.name?.toLowerCase() || "";
          return name.includes("project file") || name.includes("projektfiler") || name === "project files";
        }) || topFolders[0]; // Fallback to first folder

        if (!projectFilesFolder) {
          return new Response(
            JSON.stringify({ success: true, folders: [], message: "No top-level folders found" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const rootFolderId = projectFilesFolder.id;
        const rootFolderName = projectFilesFolder.attributes?.name || "Root";
        console.log(`Using root folder: "${rootFolderName}" (${rootFolderId})`);

        // Step 3: List contents of root folder (sub-folders = buildings)
        const contentsUrl = `https://developer.api.autodesk.com/data/v1/projects/${fullProjectId}/folders/${rootFolderId}/contents`;
        const contentsRes = await fetch(contentsUrl, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            ...regionHeaders,
          },
        });

        if (!contentsRes.ok) {
          const errorText = await contentsRes.text();
          return new Response(
            JSON.stringify({ success: false, error: `Folder contents API failed (${contentsRes.status}): ${errorText}` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const contentsData = await contentsRes.json();
        const allItems = contentsData.data || [];
        const topIncluded = contentsData.included || [];

        // Separate folders (buildings) and items (loose files)
        const subFolders = allItems.filter((item: any) => item.type === "folders");
        const looseItems = allItems.filter((item: any) => item.type === "items");

        console.log(`Found ${subFolders.length} sub-folders, ${looseItems.length} loose items`);

        // Step 4: For each sub-folder, fetch its contents (BIM files)
        const folders: any[] = [];
        for (const folder of subFolders) {
          const folderId = folder.id;
          const folderName = folder.attributes?.name || folderId;

          try {
            const subUrl = `https://developer.api.autodesk.com/data/v1/projects/${fullProjectId}/folders/${folderId}/contents`;
            const subRes = await fetch(subUrl, {
              headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json",
                ...regionHeaders,
              },
            });

            let items: any[] = [];
            if (subRes.ok) {
              const subData = await subRes.json();
              const subIncluded = subData.included || [];
              items = (subData.data || [])
                .filter((item: any) => item.type === "items")
                .map((item: any) => {
                  const fileName = item.attributes?.displayName || item.attributes?.name || item.id;
                  const versionUrn = item.relationships?.tip?.data?.id || null;
                  const derivativeUrn = versionUrn
                    ? (subIncluded.find((v: any) => v.id === versionUrn)?.relationships?.derivatives?.data?.id || null)
                    : null;
                  return {
                    id: item.id,
                    name: fileName,
                    type: item.attributes?.fileType || item.attributes?.extension?.type || "unknown",
                    size: item.attributes?.storageSize || null,
                    createTime: item.attributes?.createTime || null,
                    versionUrn: isBimFile(fileName) ? versionUrn : null,
                    derivativeUrn: isBimFile(fileName) ? derivativeUrn : null,
                  };
                });
            }

            folders.push({
              id: folderId,
              name: folderName,
              items,
            });
          } catch (err) {
            console.error(`Error fetching contents of folder "${folderName}":`, err);
            folders.push({ id: folderId, name: folderName, items: [], error: true });
          }
        }

        // Include any top-level items not in subfolders
        const topLevelItems = looseItems.map((item: any) => {
          const fileName = item.attributes?.displayName || item.attributes?.name || item.id;
          const versionUrn = item.relationships?.tip?.data?.id || null;
          const derivativeUrn = versionUrn
            ? (topIncluded.find((v: any) => v.id === versionUrn)?.relationships?.derivatives?.data?.id || null)
            : null;
          return {
            id: item.id,
            name: fileName,
            type: item.attributes?.fileType || item.attributes?.extension?.type || "unknown",
            size: item.attributes?.storageSize || null,
            createTime: item.attributes?.createTime || null,
            versionUrn: isBimFile(fileName) ? versionUrn : null,
            derivativeUrn: isBimFile(fileName) ? derivativeUrn : null,
          };
        });

        return new Response(
          JSON.stringify({
            success: true,
            rootFolder: rootFolderName,
            folders,
            topLevelItems,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ---- SYNC BIM DATA (Model Properties API) ----
      case "sync-bim-data": {
        const { folderName, folderId, items: folderItems } = body;

        if (!projectId || !folderId || !folderItems) {
          return new Response(
            JSON.stringify({ success: false, error: "projectId, folderId, and items are required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { token } = await getAccToken(auth.userId, supabase);
        const regionHeaders = getRegionHeader(region);

        // Filter to BIM items with valid versionUrns
        const bimItems = (folderItems as any[]).filter(
          (item: any) => item.versionUrn && isBimFile(item.name)
        );

        if (bimItems.length === 0) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Inga BIM-filer med versionUrn hittades i denna mapp. Se till att mappen innehåller RVT/IFC-filer.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        console.log(`sync-bim-data: ${bimItems.length} BIM files in folder "${folderName}"`);
        const versionUrns = bimItems.map((item: any) => item.versionUrn);

        try {
          // Extract BIM hierarchy via Model Properties API
          const { levels, rooms, fieldsMap, indexState } = await extractBimHierarchy(
            token, projectId, versionUrns, regionHeaders,
          );

          if (indexState === 'PROCESSING') {
            return new Response(
              JSON.stringify({
                success: false,
                state: 'PROCESSING',
                message: 'Indexeringen pågår fortfarande hos Autodesk. Prova igen om 30-60 sekunder.',
                modelsIndexed: 0,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          if (levels.length === 0 && rooms.length === 0) {
            return new Response(
              JSON.stringify({
                success: true,
                message: `Indexering klar men inga våningsplan eller rum hittades i ${bimItems.length} BIM-modell(er). Modellerna kanske inte innehåller Revit Levels/Rooms.`,
                indexState,
                fieldsFound: Object.keys(fieldsMap).length,
                building: 0,
                levels: 0,
                rooms: 0,
                modelsIndexed: bimItems.length,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Upsert to database
          const result = await upsertBimAssets(
            supabase, folderName, folderId, levels, rooms, projectId,
          );

          const message = `Skapade: ${result.building} byggnad, ${result.levels} våningsplan, ${result.rooms} rum från ${bimItems.length} modell(er)`;

          // Update sync state
          await updateSyncState(supabase, "acc-bim", "completed", result.levels + result.rooms + result.building);

          return new Response(
            JSON.stringify({
              success: true,
              message,
              indexState,
              ...result,
              modelsIndexed: bimItems.length,
              fieldsFound: Object.keys(fieldsMap).length,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error(`sync-bim-data error: ${errMsg}`);
          return new Response(
            JSON.stringify({ success: false, error: errMsg }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      // ---- LIST MODEL SETS (Model Coordination API - alternative to DM API) ----
      case "list-model-sets": {
        if (!projectId) {
          return new Response(
            JSON.stringify({ success: false, error: "projectId is required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { token } = await getAccToken(auth.userId, supabase);
        const containerId = projectId.replace(/^b\./, "");
        const regionHeaders = getRegionHeader(region);

        console.log(`list-model-sets: containerId=${containerId}`);

        // Step 1: List all model sets in the project
        const msUrl = `https://developer.api.autodesk.com/bim360/modelcoordination/v3/containers/${containerId}/modelsets`;
        console.log(`Fetching model sets: ${msUrl}`);
        const msRes = await fetch(msUrl, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
            ...regionHeaders,
          },
        });

        if (!msRes.ok) {
          const errorText = await msRes.text();
          console.error(`Model sets API failed: ${msRes.status} - ${errorText}`);
          return new Response(
            JSON.stringify({ success: false, error: `Model Coordination API failed (${msRes.status}): ${errorText}` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const msData = await msRes.json();
        const modelSets = msData.modelSets || msData.items || msData || [];
        console.log(`Found ${Array.isArray(modelSets) ? modelSets.length : 'unknown'} model sets`);

        // Step 2: For each model set, get its latest version to find model URNs
        const results: any[] = [];
        const modelSetList = Array.isArray(modelSets) ? modelSets : [modelSets];
        
        for (const ms of modelSetList.slice(0, 5)) { // Limit to 5 for testing
          const msId = ms.modelSetId || ms.id;
          const msName = ms.name || ms.modelSetId || 'Unknown';
          
          try {
            // Get latest version of this model set
            const versionUrl = `https://developer.api.autodesk.com/bim360/modelcoordination/v3/containers/${containerId}/modelsets/${msId}:latest`;
            const versionRes = await fetch(versionUrl, {
              headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json",
                ...regionHeaders,
              },
            });

            let versionData = null;
            if (versionRes.ok) {
              versionData = await versionRes.json();
            } else {
              const vErr = await versionRes.text();
              console.warn(`Version fetch failed for ${msName}: ${versionRes.status} - ${vErr}`);
            }

            results.push({
              modelSetId: msId,
              name: msName,
              status: ms.status,
              folderUrn: ms.folderUrn || null,
              latestVersion: versionData ? {
                versionNumber: versionData.versionNumber,
                documentCount: versionData.documentCount || versionData.documents?.length,
                documents: (versionData.documents || []).slice(0, 10).map((d: any) => ({
                  displayName: d.displayName,
                  versionUrn: d.versionUrn,
                  bubbleUrn: d.bubbleUrn,
                  isHead: d.isHead,
                })),
              } : null,
            });
          } catch (err) {
            console.warn(`Error fetching model set ${msName}:`, err);
            results.push({ modelSetId: msId, name: msName, error: true });
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            rawModelSetsKeys: Array.isArray(modelSets) ? undefined : Object.keys(msData),
            totalModelSets: modelSetList.length,
            modelSets: results,
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
