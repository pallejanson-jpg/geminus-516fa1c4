import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, forbiddenResponse, corsHeaders } from "../_shared/auth.ts";

// ============ RETRY HELPER ============

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  { maxRetries = 3, baseDelayMs = 2000, retryOn = [502, 503, 504] } = {},
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (attempt < maxRetries && retryOn.includes(res.status)) {
        const body = await res.text();
        console.log(`[retry] Attempt ${attempt + 1}/${maxRetries + 1} got ${res.status}, retrying in ${baseDelayMs * (attempt + 1)}ms...`);
        await new Promise(r => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries && (err as Error).name === 'AbortError') {
        console.log(`[retry] Attempt ${attempt + 1}/${maxRetries + 1} timed out, retrying...`);
        await new Promise(r => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
      if (attempt < maxRetries) {
        console.log(`[retry] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${(err as Error).message}, retrying...`);
        await new Promise(r => setTimeout(r, baseDelayMs * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError || new Error(`fetchWithRetry: all ${maxRetries + 1} attempts failed`);
}

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
      scope: "data:read data:write data:create account:read",
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
  updatedAfter?: string,
): Promise<{ results: AccAsset[]; cursorState?: string }> {
  const cleanProjectId = projectId.replace(/^b\./, "");
  const regionHeaders = getRegionHeader(region);
  let url = `https://developer.api.autodesk.com/construction/assets/v2/projects/${cleanProjectId}/assets?limit=200`;
  if (cursorState) url += `&cursorState=${encodeURIComponent(cursorState)}`;
  // Incremental sync: only fetch assets updated after the last sync timestamp
  if (updatedAfter) url += `&filter[updatedAt]=${encodeURIComponent(updatedAfter)}`;

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

function isBimFile(filename: string, extensionType?: string): boolean {
  // Check Cloud Model types (Revit Cloud Worksharing)
  if (extensionType) {
    const cloudModelTypes = [
      'items:autodesk.bim360:C4RModel',
      'items:autodesk.bim360:File',
      'items:autodesk.core:File',
    ];
    if (cloudModelTypes.includes(extensionType)) {
      // For Cloud Models, check if filename hints at BIM
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      if (['rvt', 'ifc', 'nwc', 'dwg', 'nwd'].includes(ext)) return true;
      // C4RModel is always a Revit cloud model
      if (extensionType === 'items:autodesk.bim360:C4RModel') return true;
    }
  }
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

/**
 * Streaming LD-JSON parser for large property files.
 * Processes line-by-line from a ReadableStream, yielding parsed objects
 * without loading the entire response text into memory.
 */
async function* streamLDJSON(response: Response): AsyncGenerator<any> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    
    const lines = buffer.split('\n');
    // Keep the last partial line in the buffer
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed);
      } catch {
        // skip malformed lines
      }
    }
  }
  
  // Process any remaining data in the buffer
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer.trim());
    } catch {
      // skip
    }
  }
}

// Categories to skip when extracting instances (non-physical)
const SKIP_INSTANCE_CATEGORIES = new Set([
  'Revit Level', 'Levels', 'Revit Rooms', 'Rooms',
  'Views', 'Grids', 'Reference Planes', 'Sheets', 'Scope Boxes',
  'Matchline', 'Detail Items', 'Model Text', 'Lines', 'Filled Region',
  'Project Information', 'Material Assets', 'Schedules', 'Legends',
  'Cameras', 'Curtain Panels', 'Curtain Wall Mullions',
  'Mass', 'Rebar Shape', 'Analytical Links', 'Analytical Nodes',
  'Analytical Spaces', 'Analytical Surfaces',
  'Boundary Conditions', 'Internal Area Loads', 'Internal Line Loads', 'Internal Point Loads',
]);

// Room property field names to resolve (lowercase)
const ROOM_PROPERTY_FIELDS: Record<string, string[]> = {
  area: ['area', 'yta'],
  perimeter: ['perimeter', 'omkrets'],
  volume: ['volume', 'volym'],
  department: ['department', 'avdelning', 'funktionsnamn'],
  unboundedHeight: ['unbounded height', 'rumshöjd', 'rumshojd'],
  comments: ['comments', 'kommentarer'],
};

async function extractBimHierarchy(
  token: string,
  projectId: string,
  versionUrns: string[],
  regionHeaders: Record<string, string>,
): Promise<{ levels: any[]; rooms: any[]; instances: any[]; fieldsMap: Record<string, string>; indexState: string }> {
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

  // Log index states for diagnostics
  const statesSummary = indexes.map((idx: any) => `${idx.versionUrn?.slice(-20)}:${idx.state}`).join(', ');
  console.log(`[BIM Index] States: ${statesSummary}`);

  // Step 2: Poll until all indexes are FINISHED (max ~30 seconds to leave room for processing)
  const maxPollTime = 30000;
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

  console.log(`[BIM Index] Finished: ${finishedIndexes.length}/${currentIndexes.length}, state: ${overallState}`);

  if (finishedIndexes.length === 0) {
    const nonFinishedStates = currentIndexes.map((idx: any) => idx.state).join(', ');
    console.log(`[BIM Index] No finished indexes. States: ${nonFinishedStates}`);
    return { levels: [], rooms: [], instances: [], fieldsMap: {}, indexState: overallState };
  }

  // Step 3: Fetch fields and properties from finished indexes
  const allLevels: any[] = [];
  const allRooms: any[] = [];
  const allInstances: any[] = [];
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

      // Fetch properties — use streaming parser for large LD-JSON files to avoid OOM
      if (idx.propertiesUrl) {
        const propsRes = await fetch(idx.propertiesUrl, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (propsRes.ok && propsRes.body) {
          // Stream and collect props without loading entire text into memory
          const props: any[] = [];
          for await (const obj of streamLDJSON(propsRes)) {
            props.push(obj);
          }

          // === Dynamic field key resolution ===
          let categoryKey = '';
          let nameKey = '';
          let elevationKey = '';
          let levelKey = '';
          let numberKey = '';
          let roomNameKey = '';
          let departmentKey = '';

          // Room property keys
          const roomPropKeys: Record<string, string> = {};

          // System property keys
          let systemNameKey = '';
          let systemTypeKey = '';
          let systemClassKey = '';
          let systemAbbrKey = '';

          // Build reverse map: lowercase field name -> key
          for (const [key, name] of Object.entries(fieldsMap)) {
            const lowerName = (name as string).toLowerCase().trim();
            if (lowerName === 'category' || lowerName === 'kategori') categoryKey = key;
            if (lowerName === 'name' || lowerName === 'namn') nameKey = key;
            if (lowerName === 'elevation' || lowerName === 'höjd' || lowerName === 'elev') elevationKey = key;
            if (lowerName === 'level' || lowerName === 'våning' || lowerName === 'nivå') levelKey = key;
            if (lowerName === 'number' || lowerName === 'nummer') numberKey = key;
            if (lowerName === 'room name' || lowerName === 'room_name' || lowerName === 'rumsnamn' || lowerName === 'room: name') roomNameKey = key;
            if (lowerName === 'department' || lowerName === 'avdelning' || lowerName === 'funktionsnamn') departmentKey = key;

            // Resolve room property fields
            for (const [propName, aliases] of Object.entries(ROOM_PROPERTY_FIELDS)) {
              if (aliases.includes(lowerName) && !roomPropKeys[propName]) {
                roomPropKeys[propName] = key;
              }
            }

            // Resolve system property fields
            if (/^(system\s*name|systemnamn|system_name)$/.test(lowerName)) systemNameKey = key;
            if (/^(system\s*type|systemtyp|system_type)$/.test(lowerName)) systemTypeKey = key;
            if (/^(system\s*classification|systemklassificering)$/.test(lowerName)) systemClassKey = key;
            if (/^(system\s*abbreviation|systemförkortning|system_abbreviation)$/.test(lowerName)) systemAbbrKey = key;
          }

          // Resolve "type name" / "family" field
          let typeNameKey = '';
          for (const [key, name] of Object.entries(fieldsMap)) {
            const lowerName = (name as string).toLowerCase().trim();
            if (/^(family|type.?name|typ|family name|family and type)$/.test(lowerName)) {
              typeNameKey = key;
              break;
            }
          }
          if (!typeNameKey) typeNameKey = 'pdf772b6f';

          // Resolve "Room" field for instance-to-room linking
          let roomRefKey = '';
          for (const [key, name] of Object.entries(fieldsMap)) {
            const lowerName = (name as string).toLowerCase().trim();
            if (lowerName === 'room' || lowerName === 'rum') {
              roomRefKey = key;
              break;
            }
          }

          // Fallback to hardcoded keys if not found
          if (!categoryKey) categoryKey = 'p5eddc473';
          if (!nameKey) nameKey = 'p153cb174';
          if (!elevationKey) elevationKey = 'pdf1348b1';
          if (!levelKey) levelKey = 'pbadfe721';

          // Debug logging
          console.log(`[BIM Fields] category=${categoryKey}, name=${nameKey}, elevation=${elevationKey}, level=${levelKey}, number=${numberKey}, roomName=${roomNameKey}, department=${departmentKey}, typeName=${typeNameKey}, roomRef=${roomRefKey}`);
          console.log(`[BIM Fields] Room prop keys: ${JSON.stringify(roomPropKeys)}`);
          console.log(`[BIM Fields] System keys: systemName=${systemNameKey}, systemType=${systemTypeKey}, systemClass=${systemClassKey}, systemAbbr=${systemAbbrKey}`);
          console.log(`[BIM Fields] Total fields: ${Object.keys(fieldsMap).length}`);
          const fieldEntries = Object.entries(fieldsMap).map(([k, v]) => `${k}=${v}`).join(', ');
          console.log(`[BIM Fields] All fields: ${fieldEntries.substring(0, 2000)}`);

          let debugLevelLogged = false;
          let debugRoomLogged = false;
          let debugInstanceLogged = false;
          const categoryCounts: Record<string, number> = {};

          for (const obj of props) {
            const category = obj.props?.[categoryKey] || '';
            const rawName = obj.props?.[nameKey] || '';
            const number = numberKey ? (obj.props?.[numberKey] || '') : '';
            const roomNameVal = roomNameKey ? (obj.props?.[roomNameKey] || '') : '';
            const departmentVal = departmentKey ? (obj.props?.[departmentKey] || '') : '';
            const externalId = obj.externalId || obj.svf2Id?.toString() || '';

            // Track category counts
            if (category) {
              categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            }

            if (category === 'Revit Level' || category === 'Levels' || category === 'IfcBuildingStorey') {
              if (!debugLevelLogged) {
                console.log(`[BIM Debug] First level props: ${JSON.stringify(obj.props).substring(0, 1500)}`);
                debugLevelLogged = true;
              }

              let levelName = rawName;
              if (!levelName || levelName === externalId || levelName.length > 40 || levelName === 'Level') {
                const elev = obj.props?.[elevationKey];
                levelName = elev != null ? `Level ${parseFloat(elev).toFixed(1)}m` : `Level ${obj.objectId || externalId.slice(-8)}`;
              }
              allLevels.push({
                externalId,
                name: levelName,
                elevation: obj.props?.[elevationKey] || null,
                objectId: obj.objectId,
                versionUrn: idx.versionUrn,
              });
            } else if (
              category === 'Revit Rooms' || category === 'Rooms' || category === 'IfcSpace' ||
              category === 'Spaces' || category === 'Rum' ||
              /room/i.test(category) || /space/i.test(category)
            ) {
              if (!debugRoomLogged) {
                console.log(`[BIM Debug] First room props: ${JSON.stringify(obj.props).substring(0, 1500)}`);
                debugRoomLogged = true;
              }

              const typeNameVal = typeNameKey ? (obj.props?.[typeNameKey] || '') : '';

              // Determine the best descriptive name for the room
              // Priority: Name field (ACC "Name") > Room Name > Type/Family Name > Department
              let descriptiveName = '';
              
              // The ACC "Name" field typically contains the Room Name (e.g. "TRAPPA")
              // But we need to check it's not just the number or a GUID
              const nameIsNumber = rawName && rawName === number;
              const nameIsGuid = rawName && (rawName === externalId || rawName.length > 40);
              const nameIsGeneric = rawName === 'Room';
              
              if (rawName && !nameIsNumber && !nameIsGuid && !nameIsGeneric) {
                // Strip Revit ID suffix like " [3767053]"
                const strippedName = rawName.replace(/\s*\[[\d]+\]\s*$/, '').trim();
                // Strip number prefix if it duplicates designation
                const finalName = number && strippedName.startsWith(number)
                  ? strippedName.substring(number.length).trim()
                  : strippedName;
                if (finalName && finalName !== number) descriptiveName = finalName;
              }
              
              // Fallbacks if Name didn't give us a descriptive name
              if (!descriptiveName && roomNameVal && roomNameVal !== externalId) {
                descriptiveName = roomNameVal;
              }
              if (!descriptiveName && typeNameVal && typeNameVal !== externalId && typeNameVal !== 'Room') {
                descriptiveName = typeNameVal;
              }
              if (!descriptiveName && departmentVal && departmentVal !== externalId) {
                descriptiveName = departmentVal;
              }

              // Designation = Number (e.g. "K1-205", "08001")
              const designation = number || '';

              // common_name follows Asset+ convention: "Number Description" or just Number
              let roomCommonName = '';
              if (designation && descriptiveName) {
                roomCommonName = `${designation} ${descriptiveName}`;
              } else if (designation) {
                roomCommonName = designation;
              } else if (descriptiveName) {
                roomCommonName = descriptiveName;
              } else {
                roomCommonName = `Room ${obj.objectId || externalId.slice(-8)}`;
              }

              // Extract room properties
              const roomProperties: Record<string, any> = {};
              for (const [propName, propKey] of Object.entries(roomPropKeys)) {
                const val = obj.props?.[propKey];
                if (val !== undefined && val !== null && val !== '') {
                  roomProperties[propName] = val;
                }
              }

              allRooms.push({
                externalId,
                name: descriptiveName || null, // name = descriptive name (e.g. "TRAPPA")
                number: designation,           // number = designation (e.g. "10026")
                commonName: roomCommonName.trim(),
                level: obj.props?.[levelKey] || null,
                objectId: obj.objectId,
                versionUrn: idx.versionUrn,
                properties: roomProperties,
              });
            } else if (category && !SKIP_INSTANCE_CATEGORIES.has(category)) {
              // Instance extraction - physical elements
              if (!debugInstanceLogged) {
                console.log(`[BIM Debug] First instance (${category}) props: ${JSON.stringify(obj.props).substring(0, 1500)}`);
                debugInstanceLogged = true;
              }

              const typeNameVal = typeNameKey ? (obj.props?.[typeNameKey] || '') : '';
              const levelRef = obj.props?.[levelKey] || null;
              const roomRef = roomRefKey ? (obj.props?.[roomRefKey] || null) : null;

              // Resolve system properties
              const sysName = systemNameKey ? (obj.props?.[systemNameKey] || null) : null;
              const sysType = systemTypeKey ? (obj.props?.[systemTypeKey] || null) : null;
              const sysClass = systemClassKey ? (obj.props?.[systemClassKey] || null) : null;
              const sysAbbr = systemAbbrKey ? (obj.props?.[systemAbbrKey] || null) : null;

              // Build a descriptive name: prefer type/family, then raw name
              let instanceName = '';
              if (typeNameVal && typeNameVal !== externalId && typeNameVal.length < 100) {
                instanceName = typeNameVal;
              } else if (rawName && rawName !== externalId && rawName.length < 100) {
                instanceName = rawName.replace(/\s*\[[\d]+\]\s*$/, '').trim();
              }

              // Collect ALL instance properties for attributes
              const instanceProperties: Record<string, any> = {};
              if (obj.props) {
                for (const [propKey, propValue] of Object.entries(obj.props)) {
                  if (propValue === undefined || propValue === null || propValue === '') continue;
                  const fieldName = (fieldsMap as Record<string, string>)[propKey] || propKey;
                  instanceProperties[fieldName] = propValue;
                }
              }

              allInstances.push({
                externalId,
                name: instanceName || null,
                category,
                level: levelRef,
                room: roomRef,
                objectId: obj.objectId,
                versionUrn: idx.versionUrn,
                systemName: sysName || sysAbbr || null,
                systemType: sysType || sysClass || null,
                properties: instanceProperties,
              });
            }
          }

          // Log category counts for diagnostics
          const catEntries = Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => `${cat}: ${count}`)
            .join(', ');
          console.log(`[BIM Categories] ${catEntries}`);
        }
      }
    } catch (err) {
      console.error(`Error processing index ${idx.indexId}:`, err);
    }
  }

  console.log(`BIM hierarchy: ${allLevels.length} levels, ${allRooms.length} rooms, ${allInstances.length} instances from ${finishedIndexes.length} models`);

  if (allRooms.length === 0 && allInstances.length > 0) {
    // Collect all seen categories for diagnostic
    const allCats = new Set<string>();
    // Re-scan category counts from last index
    console.warn(`[BIM WARNING] 0 rooms found but ${allInstances.length} instances exist. Room categories may use unexpected names. Check [BIM Categories] log above for all category names.`);
  }

  // === Post-processing: fix level names using room references ===
  const roomLevelRefs = new Set<string>();
  for (const room of allRooms) {
    if (room.level) roomLevelRefs.add(room.level);
  }

  if (roomLevelRefs.size > 0 && allLevels.length > 0) {
    const levelsHaveBadNames = allLevels.every(l =>
      /^Level\s+[0-9a-f]{6,}/i.test(l.name) || /^Level\s+\d+\.\d+m$/.test(l.name)
    );

    if (levelsHaveBadNames) {
      console.log(`[BIM Fix] Levels have GUID-like names. Room level refs: ${[...roomLevelRefs].join(', ')}`);

      const sortedLevels = [...allLevels].sort((a, b) => {
        const ea = a.elevation != null ? parseFloat(a.elevation) : (a.objectId || 0);
        const eb = b.elevation != null ? parseFloat(b.elevation) : (b.objectId || 0);
        return (ea as number) - (eb as number);
      });

      const sortedRefs = [...roomLevelRefs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (sortedLevels.length === sortedRefs.length) {
        for (let i = 0; i < sortedLevels.length; i++) {
          const oldName = sortedLevels[i].name;
          sortedLevels[i].name = sortedRefs[i];
          const origLevel = allLevels.find(l => l.externalId === sortedLevels[i].externalId);
          if (origLevel) origLevel.name = sortedRefs[i];
          console.log(`[BIM Fix] Level "${oldName}" -> "${sortedRefs[i]}"`);
        }
      } else {
        console.log(`[BIM Fix] Level count (${sortedLevels.length}) != ref count (${sortedRefs.length}), assigning by order`);
        for (let i = 0; i < Math.min(sortedLevels.length, sortedRefs.length); i++) {
          const origLevel = allLevels.find(l => l.externalId === sortedLevels[i].externalId);
          if (origLevel) {
            console.log(`[BIM Fix] Level "${origLevel.name}" -> "${sortedRefs[i]}"`);
            origLevel.name = sortedRefs[i];
          }
        }
      }
    }
  }

  return { levels: allLevels, rooms: allRooms, instances: allInstances, fieldsMap, indexState: overallState };
}

async function upsertBimAssets(
  supabase: any,
  folderName: string,
  folderId: string,
  levels: any[],
  rooms: any[],
  instances: any[],
  accProjectId: string,
): Promise<{ building: number; levels: number; rooms: number; instances: number }> {
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

  // 3. Upsert rooms with level matching and properties
  const levelNameMap = new Map<string, string>();
  for (const level of levels) {
    levelNameMap.set(level.name, `acc-bim-level-${level.externalId}`);
  }

  // Room number -> fm_guid map for instance linking
  const roomNumberMap = new Map<string, string>();

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

    const roomFmGuid = `acc-bim-room-${room.externalId}`;
    if (room.number) {
      roomNumberMap.set(room.number, roomFmGuid);
    }

    // Build attributes with room properties
    const attributes: Record<string, any> = {
      source: 'acc-bim',
      acc_project_id: accProjectId,
      acc_folder_id: folderId,
      bim_external_id: room.externalId,
      bim_level_ref: room.level,
      bim_object_id: room.objectId,
      bim_version_urn: room.versionUrn,
    };

    // Add room properties as Asset+ compatible attributes array
    const propertyAttributes: { name: string; value: any; dataType: string }[] = [];
    if (room.properties) {
      for (const [propName, propValue] of Object.entries(room.properties)) {
        const numVal = typeof propValue === 'string' ? parseFloat(propValue) : propValue;
        propertyAttributes.push({
          name: propName,
          value: propValue,
          dataType: typeof numVal === 'number' && !isNaN(numVal as number) ? 'Double' : 'String',
        });
      }
    }
    if (propertyAttributes.length > 0) {
      attributes.bim_properties = propertyAttributes;
    }

    // Extract area for gross_area column
    let grossArea: number | null = null;
    if (room.properties?.area) {
      const areaVal = typeof room.properties.area === 'string' ? parseFloat(room.properties.area) : room.properties.area;
      if (typeof areaVal === 'number' && !isNaN(areaVal)) {
        grossArea = Math.round(areaVal * 100) / 100; // Round to 2 decimals
      }
    }

    return {
      fm_guid: roomFmGuid,
      category: 'Space',
      name: room.name || null, // descriptive name (e.g. "TRAPPA")
      common_name: room.commonName || room.name || `Room ${room.externalId}`,
      building_fm_guid: buildingFmGuid,
      level_fm_guid: levelFmGuid,
      gross_area: grossArea,
      attributes,
      synced_at: new Date().toISOString(),
    };
  });

  // Batch upsert levels + rooms
  const structureAssets = [...levelAssets, ...roomAssets];
  for (let i = 0; i < structureAssets.length; i += 200) {
    const chunk = structureAssets.slice(i, i + 200);
    const { error } = await supabase.from('assets').upsert(chunk, { onConflict: 'fm_guid', ignoreDuplicates: false });
    if (error) throw error;
  }

  // 4. Upsert instances (doors, windows, walls, etc.)
  let instanceCount = 0;
  if (instances.length > 0) {
    const instanceAssets = instances.map(inst => {
      // Resolve level
      let levelFmGuid: string | null = null;
      if (inst.level) {
        levelFmGuid = levelNameMap.get(inst.level) || null;
        if (!levelFmGuid) {
          for (const [levelName, levelGuid] of levelNameMap) {
            if (inst.level.includes(levelName) || levelName.includes(inst.level)) {
              levelFmGuid = levelGuid;
              break;
            }
          }
        }
      }

      // Resolve room reference
      let inRoomFmGuid: string | null = null;
      if (inst.room) {
        // Room ref could be a room number or name
        inRoomFmGuid = roomNumberMap.get(inst.room) || null;
      }

      // Build bim_properties array from collected instance properties
      const instAttributes: Record<string, any> = {
        source: 'acc-bim',
        acc_project_id: accProjectId,
        acc_folder_id: folderId,
        bim_external_id: inst.externalId,
        bim_category: inst.category,
        bim_object_id: inst.objectId,
        bim_version_urn: inst.versionUrn,
      };

      if (inst.properties && Object.keys(inst.properties).length > 0) {
        const propertyAttributes: { name: string; value: any; dataType: string }[] = [];
        for (const [propName, propValue] of Object.entries(inst.properties)) {
          const numVal = typeof propValue === 'string' ? parseFloat(propValue) : propValue;
          propertyAttributes.push({
            name: propName,
            value: propValue,
            dataType: typeof numVal === 'number' && !isNaN(numVal as number) ? 'Double' : 'String',
          });
        }
        instAttributes.bim_properties = propertyAttributes;
      }

      return {
        fm_guid: `acc-bim-instance-${inst.externalId}`,
        category: 'Instance',
        name: null,
        common_name: inst.name || inst.category || `Instance ${inst.externalId}`,
        asset_type: inst.category,
        building_fm_guid: buildingFmGuid,
        level_fm_guid: levelFmGuid,
        in_room_fm_guid: inRoomFmGuid,
        attributes: instAttributes,
        synced_at: new Date().toISOString(),
      };
    });

    // Batch upsert in chunks of 200
    for (let i = 0; i < instanceAssets.length; i += 200) {
      const chunk = instanceAssets.slice(i, i + 200);
      const { error } = await supabase.from('assets').upsert(chunk, { onConflict: 'fm_guid', ignoreDuplicates: false });
      if (error) {
        console.error(`Instance upsert error (batch ${i / 200}):`, error);
        throw error;
      }
      instanceCount += chunk.length;
    }
    console.log(`[BIM Instances] Upserted ${instanceCount} instances`);
  }

  // 5. Extract and upsert systems from instance system properties
  const systemGroups = new Map<string, { type: string | null; memberFmGuids: string[] }>();
  for (const inst of instances) {
    const sysName = inst.systemName;
    if (!sysName) continue;
    if (!systemGroups.has(sysName)) {
      systemGroups.set(sysName, { type: inst.systemType || null, memberFmGuids: [] });
    }
    systemGroups.get(sysName)!.memberFmGuids.push(`acc-bim-instance-${inst.externalId}`);
  }

  let systemCount = 0;
  if (systemGroups.size > 0) {
    // Infer discipline from system name
    const inferDiscipline = (name: string): string => {
      const lower = name.toLowerCase();
      if (/vent|air|lb|duct|ta|fra/.test(lower)) return 'Ventilation';
      if (/heat|radi|vs|vv/.test(lower)) return 'Heating';
      if (/cool|kyl|ka/.test(lower)) return 'Cooling';
      if (/elec|el-|circuit|kraft/.test(lower)) return 'Electrical';
      if (/plumb|pipe|va|avlopp/.test(lower)) return 'Plumbing';
      if (/fire|brand|sprink/.test(lower)) return 'FireProtection';
      return 'Other';
    };

    const sysRows = [...systemGroups.entries()].map(([name, data]) => ({
      fm_guid: `sys-${buildingFmGuid}-${name}`,
      name,
      system_type: data.type || 'Unknown',
      discipline: inferDiscipline(name),
      source: 'acc',
      building_fm_guid: buildingFmGuid,
      is_active: true,
    }));

    const { data: upsertedSystems } = await supabase
      .from('systems')
      .upsert(sysRows, { onConflict: 'fm_guid' })
      .select('id, fm_guid');

    const sysDbMap = new Map<string, string>();
    if (upsertedSystems) {
      for (const s of upsertedSystems) sysDbMap.set(s.fm_guid, s.id);
    }

    // Upsert asset_system relations
    const assetSysRows: Array<{ asset_fm_guid: string; system_id: string }> = [];
    for (const [name, data] of systemGroups) {
      const dbId = sysDbMap.get(`sys-${buildingFmGuid}-${name}`);
      if (!dbId) continue;
      for (const memberFmGuid of data.memberFmGuids) {
        assetSysRows.push({ asset_fm_guid: memberFmGuid, system_id: dbId });
      }
    }

    if (assetSysRows.length > 0) {
      for (let i = 0; i < assetSysRows.length; i += 500) {
        const chunk = assetSysRows.slice(i, i + 500);
        await supabase.from('asset_system').upsert(chunk, { onConflict: 'asset_fm_guid,system_id' });
      }
    }

    systemCount = systemGroups.size;
    console.log(`[BIM Systems] Upserted ${systemCount} systems with ${assetSysRows.length} asset-system links`);
  }

  // 6. Store external ID mappings for reconciliation
  const allExtIds = [
    ...levels.map(l => ({ fm_guid: `acc-bim-level-${l.externalId}`, source: 'acc', external_id: l.externalId, last_seen_at: new Date().toISOString() })),
    ...rooms.map(r => ({ fm_guid: `acc-bim-room-${r.externalId}`, source: 'acc', external_id: r.externalId, last_seen_at: new Date().toISOString() })),
    ...instances.map(i => ({ fm_guid: `acc-bim-instance-${i.externalId}`, source: 'acc', external_id: i.externalId, last_seen_at: new Date().toISOString() })),
  ];

  if (allExtIds.length > 0) {
    for (let i = 0; i < allExtIds.length; i += 500) {
      const chunk = allExtIds.slice(i, i + 500);
      await supabase.from('asset_external_ids').upsert(chunk, { onConflict: 'fm_guid,source' });
    }
    console.log(`[BIM ExtIDs] Stored ${allExtIds.length} external ID mappings`);
  }

  return { building: 1, levels: levelAssets.length, rooms: roomAssets.length, instances: instanceCount, systems: systemCount };
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
        // Accept accountId from frontend (from list-hubs) or fall back to secrets
        const frontendAccountId = body.accountId;
        const regionUpper = (region || 'US').toUpperCase();
        const accountId = frontendAccountId ||
          (regionUpper === 'EMEA'
            ? (Deno.env.get("ACC_ACCOUNT_ID_EMEA") || Deno.env.get("ACC_ACCOUNT_ID"))
            : (Deno.env.get("ACC_ACCOUNT_ID_US") || Deno.env.get("ACC_ACCOUNT_ID")));
        
        if (!accountId) {
          return new Response(
            JSON.stringify({ success: false, error: `ACC_ACCOUNT_ID not configured. Use list-hubs to auto-discover hubs.` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        console.log(`[list-projects] Using Account ID: ${accountId.substring(0, 8)}... (region: ${regionUpper}, from: ${frontendAccountId ? 'frontend' : 'secrets'})`);

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

          // Incremental sync: check last successful sync timestamp
          const { data: syncState } = await supabase
            .from("asset_sync_state")
            .select("last_sync_completed_at")
            .eq("subtree_id", "acc-assets")
            .maybeSingle();
          const lastSyncAt = body.fullSync ? undefined : (syncState?.last_sync_completed_at || undefined);
          if (lastSyncAt) {
            console.log(`[sync-assets] Incremental sync: fetching assets updated after ${lastSyncAt}`);
          } else {
            console.log(`[sync-assets] Full sync: no previous sync timestamp found`);
          }

          // First, fetch location tree to resolve locationId -> building/level/room
          const nodes = await fetchAllLocationNodes(token, projectId, region);
          const mapped = buildLocationTree(nodes);
          const locationMap = new Map<string, MappedNode>();
          for (const m of mapped) {
            locationMap.set(m.node.id, m);
          }

          // Fetch categories
          const categoryMap = await fetchAccCategories(token, projectId, region);

          // Fetch assets with pagination (incremental if available)
          let totalSynced = 0;
          let cursorState: string | undefined;

          do {
            const page = await fetchAccAssets(token, projectId, region, cursorState, lastSyncAt);
            console.log(`Fetched ${page.results.length} assets (cursor: ${cursorState ? "yes" : "start"}, incremental: ${!!lastSyncAt})`);

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
              message: lastSyncAt
                ? `Inkrementell synk: ${totalSynced} uppdaterade tillgångar sedan ${new Date(lastSyncAt).toLocaleString('sv-SE')}`
                : `Synkade ${totalSynced} tillgångar från ACC`,
              totalSynced,
              incremental: !!lastSyncAt,
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
        // Accept accountId from frontend (from list-hubs) or fall back to secrets
        const frontendAccountId2 = body.accountId;
        const regionUpper2 = (region || 'US').toUpperCase();
        const accountId = frontendAccountId2 ||
          (regionUpper2 === 'EMEA'
            ? (Deno.env.get("ACC_ACCOUNT_ID_EMEA") || Deno.env.get("ACC_ACCOUNT_ID"))
            : (Deno.env.get("ACC_ACCOUNT_ID_US") || Deno.env.get("ACC_ACCOUNT_ID")));
        
        if (!accountId) {
          return new Response(
            JSON.stringify({ success: false, error: `ACC_ACCOUNT_ID not configured. Use list-hubs to auto-discover hubs.` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        console.log(`[list-folders] Using Account ID: ${accountId.substring(0, 8)}... (from: ${frontendAccountId2 ? 'frontend' : 'secrets'})`);

        const cleanAccountId = accountId.replace(/^b\./, "");
        const hubId = `b.${cleanAccountId}`;
        const cleanProjectId = projectId.replace(/^b\./, "");
        const fullProjectId = `b.${cleanProjectId}`;
        const regionHeaders = getRegionHeader(region);

        // Helper: fetch all pages of a folder's contents
        async function fetchAllFolderContents(folderId: string): Promise<{ items: any[]; folders: any[]; included: any[] }> {
          const allItems: any[] = [];
          const allFolders: any[] = [];
          const allIncluded: any[] = [];
          let url: string | null = `https://developer.api.autodesk.com/data/v1/projects/${fullProjectId}/folders/${folderId}/contents`;

          while (url) {
            const res = await fetch(url, {
              headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json",
                ...regionHeaders,
              },
            });

            if (!res.ok) {
              const errorText = await res.text();
              console.error(`Folder contents failed for ${folderId} (${res.status}): ${errorText}`);
              break;
            }

            const data = await res.json();
            const pageData = data.data || [];
            const pageIncluded = data.included || [];

            for (const item of pageData) {
              if (item.type === "folders") {
                allFolders.push(item);
              } else {
                allItems.push(item);
              }
            }
            allIncluded.push(...pageIncluded);

            // Follow pagination
            url = data.links?.next?.href || data.links?.next || null;
          }

          return { items: allItems, folders: allFolders, included: allIncluded };
        }

        // Helper: map an item to our format
        function mapItem(item: any, included: any[]): any {
          const fileName = item.attributes?.displayName || item.attributes?.name || item.id;
          const extensionType = item.attributes?.extension?.type || "";
          
          // Try primary path first (tip relationship)
          let versionUrn = item.relationships?.tip?.data?.id || null;
          
          // Fallback for Cloud Models: find version in included array
          if (!versionUrn && included && included.length > 0) {
            const relatedVersion = included.find((v: any) =>
              v.type === 'versions' && v.relationships?.item?.data?.id === item.id
            );
            if (relatedVersion) {
              versionUrn = relatedVersion.id;
              console.log(`[mapItem] Found versionUrn via included array for "${fileName}": ${versionUrn?.slice(-30)}`);
            }
          }
          
          // Fallback: use item's own ID if it looks like a version URN
          if (!versionUrn && item.id && item.id.includes('urn:adsk.wipprod:dm.lineage:')) {
            versionUrn = item.id;
            console.log(`[mapItem] Using item lineage ID as versionUrn for "${fileName}": ${versionUrn?.slice(-30)}`);
          }
          
          const derivativeUrn = versionUrn
            ? (included.find((v: any) => v.id === versionUrn)?.relationships?.derivatives?.data?.id || null)
            : null;
          const isBim = isBimFile(fileName, extensionType);
          return {
            id: item.id,
            name: fileName,
            type: item.attributes?.fileType || extensionType || "unknown",
            extensionType,
            size: item.attributes?.storageSize || null,
            createTime: item.attributes?.createTime || null,
            versionUrn: isBim ? versionUrn : null,
            derivativeUrn: isBim ? derivativeUrn : null,
            isBim,
          };
        }

        // Helper: recursively fetch folder tree (max depth)
        async function fetchFolderTree(folderId: string, folderName: string, depth: number, maxDepth: number): Promise<any> {
          const { items, folders: subFolders, included } = await fetchAllFolderContents(folderId);

          const mappedItems = items.map(item => mapItem(item, included));
          const children: any[] = [];

          if (depth < maxDepth) {
            for (const sf of subFolders) {
              const sfName = sf.attributes?.name || sf.id;
              try {
                const child = await fetchFolderTree(sf.id, sfName, depth + 1, maxDepth);
                children.push(child);
              } catch (err) {
                console.error(`Error fetching sub-folder "${sfName}":`, err);
                children.push({ id: sf.id, name: sfName, items: [], children: [], error: true });
              }
            }
          } else if (subFolders.length > 0) {
            // At max depth, just list sub-folders without traversing
            for (const sf of subFolders) {
              children.push({
                id: sf.id,
                name: sf.attributes?.name || sf.id,
                items: [],
                children: [],
                truncated: true,
              });
            }
          }

          // Count total items including nested
          const totalItemCount = mappedItems.length + children.reduce((sum: number, c: any) => sum + (c.totalItemCount || c.items?.length || 0), 0);

          return {
            id: folderId,
            name: folderName,
            items: mappedItems,
            children,
            totalItemCount,
          };
        }

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
        }) || topFolders[0];

        if (!projectFilesFolder) {
          return new Response(
            JSON.stringify({ success: true, folders: [], message: "No top-level folders found" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const rootFolderId = projectFilesFolder.id;
        const rootFolderName = projectFilesFolder.attributes?.name || "Root";
        console.log(`Using root folder: "${rootFolderName}" (${rootFolderId})`);

        // Step 3: Fetch root contents with pagination
        const { items: rootItems, folders: rootSubFolders, included: rootIncluded } = await fetchAllFolderContents(rootFolderId);

        console.log(`Found ${rootSubFolders.length} sub-folders, ${rootItems.length} loose items (with pagination)`);

        // Step 4: Recursively fetch each sub-folder tree (max depth 3)
        const folders: any[] = [];
        for (const folder of rootSubFolders) {
          const folderName = folder.attributes?.name || folder.id;
          try {
            const tree = await fetchFolderTree(folder.id, folderName, 1, 3);
            folders.push(tree);
          } catch (err) {
            console.error(`Error fetching folder tree "${folderName}":`, err);
            folders.push({ id: folder.id, name: folderName, items: [], children: [], error: true });
          }
        }

        // Top-level items
        const topLevelItems = rootItems.map(item => mapItem(item, rootIncluded));

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

      // ---- SYNC BIM DATA (Model Properties API) - single file at a time ----
      case "sync-bim-data": {
        const { folderName, folderId, items: folderItems, singleItem } = body;

        if (!projectId || !folderId) {
          return new Response(
            JSON.stringify({ success: false, error: "projectId and folderId are required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { token } = await getAccToken(auth.userId, supabase);
        const regionHeaders = getRegionHeader(region);

        // If singleItem is provided, process just that one file
        // Otherwise fall back to folderItems (legacy behavior)
        let bimItems: any[];
        if (singleItem) {
          bimItems = [singleItem].filter((item: any) => item.versionUrn && isBimFile(item.name));
        } else if (folderItems) {
          bimItems = (folderItems as any[]).filter(
            (item: any) => item.versionUrn && isBimFile(item.name)
          );
        } else {
          return new Response(
            JSON.stringify({ success: false, error: "singleItem or items are required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (bimItems.length === 0) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Inga BIM-filer med versionUrn hittades. Se till att filen är en RVT/IFC-fil.",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        console.log(`sync-bim-data: ${bimItems.length} BIM file(s) in folder "${folderName}" (single=${!!singleItem})`);
        const versionUrns = bimItems.map((item: any) => item.versionUrn);

        try {
          // Extract BIM hierarchy via Model Properties API
          const { levels, rooms, instances, fieldsMap, indexState } = await extractBimHierarchy(
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

          if (levels.length === 0 && rooms.length === 0 && instances.length === 0) {
            return new Response(
              JSON.stringify({
                success: true,
                message: `Indexering klar men inga våningsplan, rum eller instanser hittades i ${bimItems.length} BIM-modell(er).`,
                indexState,
                fieldsFound: Object.keys(fieldsMap).length,
                building: 0,
                levels: 0,
                rooms: 0,
                instances: 0,
                modelsIndexed: bimItems.length,
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Upsert to database
          const result = await upsertBimAssets(
            supabase, folderName, folderId, levels, rooms, instances, projectId,
          );

          const message = `Skapade: ${result.building} byggnad, ${result.levels} våningsplan, ${result.rooms} rum, ${result.instances} instanser från ${bimItems.length} modell(er)`;

          // Update sync state
          await updateSyncState(supabase, "acc-bim", "completed", result.levels + result.rooms + result.instances + result.building);

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

      // ---- TRANSLATE MODEL (Model Derivative API) ----
      case "translate-model": {
        const { versionUrn } = body;
        if (!versionUrn) {
          return new Response(
            JSON.stringify({ success: false, error: "versionUrn is required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { token } = await getAccToken(auth.userId, supabase);

        // Base64-encode the URN (URL-safe base64)
        const urnBase64 = btoa(versionUrn).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // Check if translation already exists
        const { data: existing } = await supabase
          .from("acc_model_translations")
          .select("translation_status, derivative_urn, started_at")
          .eq("version_urn", versionUrn)
          .maybeSingle();

        // A1: If already done, return alreadyDone
        if (existing?.translation_status === "success" && existing?.derivative_urn) {
          return new Response(
            JSON.stringify({ success: true, status: "success", message: "Modellen är redan översatt.", alreadyDone: true }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // A2: If a translation is already in progress (started < 60 min ago), don't restart
        if (existing && (existing.translation_status === "pending" || existing.translation_status === "inprogress")) {
          const startedAt = existing.started_at ? new Date(existing.started_at).getTime() : 0;
          const sixtyMinAgo = Date.now() - 60 * 60 * 1000;
          if (startedAt > sixtyMinAgo) {
            console.log(`[translate-model] Translation already in progress (status=${existing.translation_status}, started=${existing.started_at}). Skipping job restart.`);
            return new Response(
              JSON.stringify({ success: true, status: "pending", message: "Översättning pågår redan. Fortsätter att bevaka status..." }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        // Request SVF (for metadata) + IFC (for per-storey XKT tiling via existing pipeline)
        // SVF2 is not supported for all designs (406 error), so we use SVF
        // IFC derivative enables reuse of the ifc-to-xkt pipeline with real storey tiling
        const requestIfc = body.requestIfc !== false; // default true
        const outputFormats: any[] = [
          { type: "svf", views: ["3d"] },
        ];
        if (requestIfc) {
          outputFormats.push({ type: "ifc" });
        }
        const translationBody = {
          input: { urn: urnBase64 },
          output: { formats: outputFormats },
        };
        console.log(`[translate-model] Requesting formats: ${JSON.stringify(translationBody.output.formats)}`);
        console.log(`[translate-model] Request body: ${JSON.stringify(translationBody)}`);

        // EMEA URNs (wipemea) require the EU-specific endpoint
        const decodedUrn = atob(urnBase64.replace(/-/g, '+').replace(/_/g, '/'));
        const isEmea = decodedUrn.includes('wipemea');
        const mdEndpoint = isEmea
          ? "https://developer.api.autodesk.com/modelderivative/v2/regions/eu/designdata/job"
          : "https://developer.api.autodesk.com/modelderivative/v2/designdata/job";
        console.log(`[translate-model] isEmea=${isEmea}, endpoint=${mdEndpoint}`);
        let jobRes = await fetchWithRetry(mdEndpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
            "x-ads-force": "true",
          },
          body: JSON.stringify(translationBody),
        });

        // If 3-legged token fails with 403, retry with 2-legged (app) token
        if (jobRes.status === 403) {
          console.log("[translate-model] 3-legged token got 403, retrying with 2-legged app token...");
          const appToken = await getApsAccessToken();
          jobRes = await fetchWithRetry(mdEndpoint, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${appToken}`,
              "Content-Type": "application/json",
              "x-ads-force": "true",
            },
            body: JSON.stringify(translationBody),
          });
        }

        if (!jobRes.ok) {
          const errorText = await jobRes.text();
          console.error(`Model Derivative job failed (${jobRes.status}): ${errorText}`);
          const hint = jobRes.status === 403
            ? ". Kontrollera att Model Derivative API är aktiverat i Autodesk Developer Portal för din APS-app, och logga ut/in från Autodesk i inställningarna."
            : "";
          return new Response(
            JSON.stringify({ success: false, error: `Translation job failed (${jobRes.status}): ${errorText}${hint}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const jobData = await jobRes.json();
        console.log("Translation job started:", JSON.stringify(jobData).substring(0, 500));

        // Upsert status
        await supabase.from("acc_model_translations").upsert({
          version_urn: versionUrn,
          building_fm_guid: body.buildingFmGuid || null,
          folder_id: body.folderId || null,
          file_name: body.fileName || null,
          translation_status: "pending",
          output_format: "svf",
          started_at: new Date().toISOString(),
        }, { onConflict: "version_urn" });

        // A1: Always return "pending" when job is started (not "success")
        return new Response(
          JSON.stringify({
            success: true,
            status: "pending",
            urn: urnBase64,
            message: "Översättningsjobb startat. Kontrollera status med check-translation.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ---- CHECK TRANSLATION STATUS ----
      case "check-translation": {
        const { versionUrn } = body;
        if (!versionUrn) {
          return new Response(
            JSON.stringify({ success: false, error: "versionUrn is required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { token } = await getAccToken(auth.userId, supabase);
        const urnBase64 = btoa(versionUrn).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // A3: Use EU endpoint for wipemea URNs
        const decodedUrnCheck = atob(urnBase64.replace(/-/g, '+').replace(/_/g, '/'));
        const isEmeaCheck = decodedUrnCheck.includes('wipemea');
        const mdBaseCheck = isEmeaCheck
          ? "https://developer.api.autodesk.com/modelderivative/v2/regions/eu/designdata"
          : "https://developer.api.autodesk.com/modelderivative/v2/designdata";
        const manifestUrl = `${mdBaseCheck}/${urnBase64}/manifest`;
        console.log(`[check-translation] isEmea=${isEmeaCheck}, url=${manifestUrl}`);

        let manifestRes = await fetchWithRetry(manifestUrl, {
          headers: { "Authorization": `Bearer ${token}` },
        });

        // A4: If 403, fallback to 2-legged app token
        if (manifestRes.status === 403) {
          console.log("[check-translation] 3-legged token got 403, retrying with 2-legged app token...");
          const appToken = await getApsAccessToken();
          manifestRes = await fetchWithRetry(manifestUrl, {
            headers: { "Authorization": `Bearer ${appToken}` },
          });
        }

        if (!manifestRes.ok) {
          const errorText = await manifestRes.text();
          return new Response(
            JSON.stringify({ success: false, error: `Manifest check failed (${manifestRes.status}): ${errorText}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const manifest = await manifestRes.json();
        const overallStatus = manifest.status; // "pending", "inprogress", "success", "failed"
        const progress = manifest.progress || "0%";

        // Find all derivatives (SVF2 + any geometry resources)
        const derivatives: any[] = [];
        function findDerivatives(node: any) {
          if (node.type === "resource" && node.role) {
            derivatives.push({ urn: node.urn, role: node.role, mime: node.mime, type: node.type, outputType: node.outputType });
          }
          if (node.children) {
            for (const child of node.children) findDerivatives(child);
          }
          if (node.derivatives) {
            for (const d of node.derivatives) findDerivatives(d);
          }
        }
        findDerivatives(manifest);

        // Update DB status
        const updateData: any = { translation_status: overallStatus };
        if (overallStatus === "success") {
          updateData.completed_at = new Date().toISOString();
          // Find the main geometry derivative URN (SVF2 or SVF)
          const geomDeriv = derivatives.find(d => d.role === "graphics" && (d.mime?.includes("svf") || d.mime?.includes("autodesk")));
          if (geomDeriv) updateData.derivative_urn = geomDeriv.urn;
        } else if (overallStatus === "failed") {
          updateData.error_message = manifest.messages?.map((m: any) => m.message).join("; ") || "Translation failed";
        }

        await supabase.from("acc_model_translations").update(updateData).eq("version_urn", versionUrn);

        // When translation succeeds, trigger pipelines (non-blocking)
        if (overallStatus === "success" && body.buildingFmGuid) {
          // Check if IFC derivative is available — if so, download and feed into ifc-to-xkt pipeline
          const ifcDeriv = derivatives.find(d => 
            d.outputType === 'ifc' || d.mime === 'application/octet-stream' && d.role === 'graphics'
          );

          if (ifcDeriv) {
            console.log(`[check-translation] IFC derivative found — downloading for XKT conversion pipeline`);
            // Download IFC derivative and upload to ifc-uploads, then trigger ifc-to-xkt
            const ifcDownloadUrl = `${mdBaseCheck}/${urnBase64}/manifest/${encodeURIComponent(ifcDeriv.urn)}`;
            fetch(ifcDownloadUrl, {
              headers: { "Authorization": `Bearer ${token}` },
            }).then(async (ifcRes) => {
              if (!ifcRes.ok) {
                console.warn(`[check-translation] IFC download failed: ${ifcRes.status}`);
                return;
              }
              const ifcData = await ifcRes.arrayBuffer();
              const ifcPath = `${body.buildingFmGuid}/acc-derived-${Date.now()}.ifc`;
              const ifcBlob = new Blob([ifcData], { type: "application/octet-stream" });
              const { error: uploadErr } = await supabase.storage
                .from("ifc-uploads")
                .upload(ifcPath, ifcBlob, { contentType: "application/octet-stream", upsert: true });
              
              if (uploadErr) {
                console.warn(`[check-translation] IFC upload failed:`, uploadErr.message);
                return;
              }
              console.log(`[check-translation] IFC uploaded (${(ifcData.byteLength/1024/1024).toFixed(1)}MB), triggering ifc-to-xkt...`);
              
              // Trigger ifc-to-xkt for real per-storey tiling
              await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ifc-to-xkt`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                },
                body: JSON.stringify({
                  ifcStoragePath: ifcPath,
                  buildingFmGuid: body.buildingFmGuid,
                  modelName: body.fileName?.replace(/\.[^.]+$/, '') || "ACC Model",
                }),
              }).then(r => console.log(`[check-translation] ifc-to-xkt triggered: ${r.status}`))
                .catch(e => console.warn(`[check-translation] ifc-to-xkt trigger failed:`, e));
            }).catch(e => console.warn(`[check-translation] IFC derivative download failed:`, e));
          }

          // Also trigger GLB geometry extract as fallback/parallel path
          console.log(`[check-translation] Translation success — triggering acc-geometry-extract for ${body.buildingFmGuid}`);
          fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/acc-geometry-extract`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              action: "extract",
              buildingFmGuid: body.buildingFmGuid,
              versionUrn,
              modelKey: body.modelKey || body.buildingFmGuid,
              accProjectId: body.accProjectId || "",
              userId: auth.userId || null,
            }),
          }).then(r => console.log(`[check-translation] Geometry extract triggered: ${r.status}`))
            .catch(e => console.warn(`[check-translation] Geometry extract trigger failed:`, e));
        }

        return new Response(
          JSON.stringify({
            success: true,
            status: overallStatus,
            progress,
            derivativeCount: derivatives.length,
            derivatives: derivatives.slice(0, 20),
            hasSvf2: manifest.derivatives?.some((d: any) => d.outputType === "svf2") || false,
            geometryExtractTriggered: overallStatus === "success" && !!body.buildingFmGuid,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // ---- DOWNLOAD DERIVATIVE (streams geometry to storage) ----
      case "download-derivative": {
        const { versionUrn, derivativeUrn: specifiedDerivUrn } = body;
        if (!versionUrn) {
          return new Response(
            JSON.stringify({ success: false, error: "versionUrn is required" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { token } = await getAccToken(auth.userId, supabase);
        const urnBase64 = btoa(versionUrn).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        // Detect EMEA region from URN
        const decodedUrnDl = (() => { try { return atob(urnBase64.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } })();
        const isEmeaDl = decodedUrnDl.includes('wipemea');
        const mdBaseDl = isEmeaDl
          ? "https://developer.api.autodesk.com/modelderivative/v2/regions/eu/designdata"
          : "https://developer.api.autodesk.com/modelderivative/v2/designdata";

        // If no specific derivative URN, fetch manifest to find it
        let derivUrn = specifiedDerivUrn;
        if (!derivUrn) {
          const manifestRes = await fetch(
            `${mdBaseDl}/${urnBase64}/manifest`,
            { headers: { "Authorization": `Bearer ${token}` } },
          );
          if (!manifestRes.ok) {
            return new Response(
              JSON.stringify({ success: false, error: "Failed to fetch manifest" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          const manifest = await manifestRes.json();
          if (manifest.status !== "success") {
            // Return 202 (Accepted) for pending/inprogress so the client can retry
            const isPending = manifest.status === "pending" || manifest.status === "inprogress";
            return new Response(
              JSON.stringify({ 
                success: false, 
                pending: isPending,
                translationStatus: manifest.status,
                error: `Translation not complete (status: ${manifest.status})` 
              }),
              { status: isPending ? 202 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          // Find OBJ or glTF derivative if available from SVF2 manifest
          const allDerivs: any[] = [];
          function collectDerivs(node: any) {
            if (node.urn) allDerivs.push({ urn: node.urn, role: node.role, mime: node.mime, outputType: node.outputType, name: node.name });
            if (node.children) node.children.forEach(collectDerivs);
            if (node.derivatives) node.derivatives.forEach(collectDerivs);
          }
          collectDerivs(manifest);

          // Log all derivatives for debugging
          console.log(`[download-derivative] Available derivatives (${allDerivs.length}):`, JSON.stringify(allDerivs.map(d => ({ role: d.role, mime: d.mime, outputType: d.outputType, name: d.name, urn: d.urn?.substring(0, 60) }))));

          // Look for downloadable single-file formats: glTF/GLB first, then OBJ
          const gltfDeriv = allDerivs.find(d => 
            d.mime === 'model/gltf-binary' || d.mime === 'model/gltf+json' || d.name?.endsWith('.glb') || d.name?.endsWith('.gltf')
          );
          const objDeriv = allDerivs.find(d => 
            d.outputType === 'obj' && d.role === 'graphics'
          );

          // SVF2 is a multi-file streaming format, not directly downloadable as a single file
          const hasSvf2Only = !gltfDeriv && !objDeriv;

          if (hasSvf2Only) {
            console.log(`[download-derivative] Only SVF2 derivatives found. SVF2 translation succeeded but no single-file geometry available.`);
            console.log(`[download-derivative] This is expected for SVF2-only translations. The model needs a separate OBJ/glTF translation job, or use Autodesk Viewer directly.`);
            return new Response(
              JSON.stringify({ 
                success: false, 
                error: "SVF2-översättning klar men ingen nedladdningsbar geometri (OBJ/glTF) hittades. " +
                       "SVF2 är ett streaming-format som inte kan laddas ner som en enstaka fil. " +
                       "Överväg att använda Autodesk Viewer för denna modell.",
                formatLimitation: true,
                svf2Complete: true,
                availableFormats: allDerivs.map(d => d.outputType || d.mime).filter(Boolean),
              }),
              { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          derivUrn = gltfDeriv?.urn || objDeriv?.urn;
          const selectedFormat = gltfDeriv ? 'gltf' : 'obj';
          console.log(`[download-derivative] Selected format: ${selectedFormat}, URN: ${derivUrn?.substring(0, 60)}`);
        }

        if (!derivUrn) {
          return new Response(
            JSON.stringify({ success: false, error: "Ingen nedladdningsbar geometri hittades." }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Download the derivative file
        const encodedDerivUrn = encodeURIComponent(derivUrn);
        const downloadUrl = `${mdBaseDl}/${urnBase64}/manifest/${encodedDerivUrn}`;

        console.log(`Downloading derivative: ${downloadUrl.substring(0, 120)}...`);

        const downloadRes = await fetch(downloadUrl, {
          headers: { "Authorization": `Bearer ${token}` },
        });

        if (!downloadRes.ok) {
          const errorText = await downloadRes.text();
          return new Response(
            JSON.stringify({ success: false, error: `Derivative download failed (${downloadRes.status}): ${errorText.substring(0, 200)}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Read the derivative as ArrayBuffer and upload to storage
        const derivData = await downloadRes.arrayBuffer();
        const fileSize = derivData.byteLength;
        console.log(`Downloaded derivative: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

        // Generate a storage path
        const buildingFmGuid = body.buildingFmGuid || "acc-derivatives";
        const fileName = body.fileName?.replace(/\.[^.]+$/, '') || "model";
        const storagePath = `${buildingFmGuid}/acc-deriv-${fileName}.bin`;

        // Upload to xkt-models storage bucket
        const blob = new Blob([derivData], { type: "application/octet-stream" });
        const { error: uploadError } = await supabase.storage
          .from("xkt-models")
          .upload(storagePath, blob, { contentType: "application/octet-stream", upsert: true });

        if (uploadError) {
          console.error("Derivative upload failed:", uploadError);
          return new Response(
            JSON.stringify({ success: false, error: `Storage upload failed: ${uploadError.message}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // Generate signed URL
        const { data: urlData } = await supabase.storage
          .from("xkt-models")
          .createSignedUrl(storagePath, 3600);

        return new Response(
          JSON.stringify({
            success: true,
            storagePath,
            downloadUrl: urlData?.signedUrl || null,
            fileSize,
            derivativeUrn: derivUrn,
            message: `Derivative nedladdad (${(fileSize / 1024 / 1024).toFixed(2)} MB) och uppladdad till lagring.`,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
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

      // ---- LIST HUBS ----
      case "list-hubs": {
        // Fetches all hubs (accounts) the app has access to via /project/v1/hubs
        // This replaces the need for hard-coded ACC_ACCOUNT_ID_US / ACC_ACCOUNT_ID_EMEA secrets
        const { token } = await getAccToken(auth.userId, supabase);

        const res = await fetch("https://developer.api.autodesk.com/project/v1/hubs", {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json",
          },
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error(`[list-hubs] Failed (${res.status}): ${errorText}`);
          return new Response(
            JSON.stringify({ success: false, error: `Could not fetch hubs (${res.status}): ${errorText}` }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const data = await res.json();
        const hubs = (data.data || []).map((hub: any) => {
          // Region is embedded in the hub attributes
          const region = hub.attributes?.region || 
            (hub.id?.startsWith('b.') && hub.attributes?.extension?.data?.region) ||
            (hub.attributes?.extension?.schema?.href?.includes('eu') ? 'EMEA' : 'US');
          return {
            id: hub.id, // e.g. "b.xxxx-yyyy"
            name: hub.attributes?.name || hub.id,
            region: region,
            // Strip b. prefix for use as accountId
            accountId: hub.id?.replace(/^b\./, '') || hub.id,
          };
        });

        console.log(`[list-hubs] Found ${hubs.length} hubs`);
        return new Response(
          JSON.stringify({ success: true, hubs }),
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
