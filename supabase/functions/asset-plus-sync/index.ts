import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, forbiddenResponse, corsHeaders } from "../_shared/auth.ts";
import { getAssetPlusCredentials } from "../_shared/credentials.ts";

// Module-level credential overrides (set per-request from building_settings)
let _creds = {
  apiUrl: '',
  apiKey: '',
  keycloakUrl: '',
  clientId: '',
  clientSecret: '',
  username: '',
  password: '',
};

// Get Keycloak access token
async function getAccessToken(): Promise<string> {
  const keycloakUrl = _creds.keycloakUrl || Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
  const clientId = _creds.clientId || Deno.env.get("ASSET_PLUS_CLIENT_ID");
  const clientSecret = _creds.clientSecret || Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
  const username = _creds.username || Deno.env.get("ASSET_PLUS_USERNAME");
  const password = _creds.password || Deno.env.get("ASSET_PLUS_PASSWORD");

  if (!keycloakUrl || !clientId) {
    throw new Error("Missing Keycloak configuration");
  }

  const keycloakUrlStr = keycloakUrl.trim();
  const tokenUrl = keycloakUrlStr.endsWith("/protocol/openid-connect/token")
    ? keycloakUrlStr
    : `${keycloakUrlStr.replace(/\/+$/, "")}/protocol/openid-connect/token`;

  // Password Grant flow
  if (username && password) {
    const params = new URLSearchParams({
      grant_type: "password",
      username,
      password,
      client_id: clientId,
    });
    if (clientSecret) params.set("client_secret", clientSecret);

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    if (res.ok) {
      const data = await res.json();
      return data.access_token;
    }

    // Retry without client_secret for public clients
    if (clientSecret) {
      const publicParams = new URLSearchParams({
        grant_type: "password",
        username,
        password,
        client_id: clientId,
      });
      const publicRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: publicParams,
      });
      if (publicRes.ok) {
        const data = await publicRes.json();
        return data.access_token;
      }
    }
  }

  throw new Error("Keycloak auth failed");
}

// ============ ROBUST 3D ENDPOINT DISCOVERY ============
// Uses Asset+ OpenAPI endpoints:
//   GET /GetAllRelatedModels?fmguid={buildingFmGuid}  → BimModel[]
//   GET /GetXktData?modelid={modelId}&context=Building → XKT binary
interface EndpointDiscoveryResult {
  url: string | null;
  fromCache: boolean;
  models?: any[];
}

async function discover3dModelsEndpoint(
  supabase: any,
  accessToken: string,
  apiUrl: string,
  _apiKey: string,
  buildingFmGuid: string
): Promise<EndpointDiscoveryResult> {
  const CACHE_KEY = 'getallrelatedmodels_url';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Helper: try a base URL and return models if successful
  async function tryBase(base: string): Promise<{ url: string; models: any[] } | null> {
    const endpoint = `${base}/GetAllRelatedModels`;
    const fullUrl = `${endpoint}?fmguid=${buildingFmGuid}`;
    try {
      console.log(`Trying: ${fullUrl}`);
      const res = await fetch(fullUrl, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('json')) return null;
      const data = await res.json();
      const modelArray = Array.isArray(data) ? data
        : Array.isArray(data?.models) ? data.models
        : Array.isArray(data?.items) ? data.items
        : Array.isArray(data?.data) ? data.data
        : null;
      if (modelArray) {
        console.log(`✅ Found working 3D endpoint: ${base} (${modelArray.length} models)`);
        return { url: base, models: modelArray };
      }
    } catch (e) {
      console.debug(`Endpoint failed: ${fullUrl}`, e);
    }
    return null;
  }

  // Check cache first
  const { data: cached } = await supabase
    .from('asset_plus_endpoint_cache')
    .select('value, updated_at')
    .eq('key', CACHE_KEY)
    .maybeSingle();

  if (cached?.value) {
    const cacheAge = Date.now() - new Date(cached.updated_at).getTime();
    if (cacheAge < CACHE_TTL_MS) {
      console.log(`Using cached 3D base: ${cached.value}`);
      const result = await tryBase(cached.value);
      if (result) {
        return { url: result.url, fromCache: true, models: result.models };
      }
      console.log('Cached endpoint failed, will re-discover');
    }
  }

  // Invalidate old getmodels_url cache key from previous logic
  await supabase.from('asset_plus_endpoint_cache').delete().eq('key', 'getmodels_url');

  // Build candidate base URLs to try
  const assetDbUrl = apiUrl.replace(/\/+$/, '');
  const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');

  const candidateBases = [
    assetDbUrl,                          // e.g. https://host/api/v1/AssetDB
    `${baseUrl}/asset`,                  // e.g. https://host/asset
    baseUrl,                             // e.g. https://host
    `${baseUrl}/api/v1/AssetDB`,         // explicit
  ];
  // Deduplicate
  const unique = [...new Set(candidateBases)];

  for (const base of unique) {
    const result = await tryBase(base);
    if (result) {
      // Cache the working base
      await supabase
        .from('asset_plus_endpoint_cache')
        .upsert({
          key: CACHE_KEY,
          value: result.url,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });

      return { url: result.url, fromCache: false, models: result.models };
    }
  }

  console.log('❌ No working 3D endpoint found');
  return { url: null, fromCache: false };
}

// Minimal field projection to reduce MongoDB sort memory usage
const MINIMAL_SELECT_FIELDS = [
  "fmGuid", "objectType", "designation", "commonName", 
  "buildingFmGuid", "levelFmGuid", "inRoomFmGuid", 
  "complexCommonName", "grossArea", "objectTypeValue", 
  "createdInModel", "dateModified"
];

// Helper to detect MongoDB sort memory limit error
function isSortMemoryError(errorText: string): boolean {
  return errorText.includes('Sort exceeded memory limit') || 
         errorText.includes('allowDiskUse:true') ||
         errorText.includes('memory limit');
}

// Sleep helper for backoff
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch objects from Asset+ API with adaptive retry for sort memory errors
interface FetchOptions {
  useMinimalSelect?: boolean;
  useExplicitSort?: boolean;
  cursorFmGuid?: string; // For cursor-based pagination (avoids high skip)
}

async function fetchAssetPlusObjects(
  accessToken: string, 
  filter: any[], 
  skip = 0, 
  take = 200,
  options: FetchOptions = {}
): Promise<{ data: any[]; hasMore: boolean; lastFmGuid?: string }> {
  const apiUrl = _creds.apiUrl || Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = _creds.apiKey || Deno.env.get("ASSET_PLUS_API_KEY");

  if (!apiUrl || !apiKey) {
    throw new Error("Missing Asset+ API configuration");
  }

  const baseUrl = apiUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/PublishDataServiceGetMerged`;

  // Build request with optimizations for large datasets
  const requestBody: any = {
    filter,
    skip,
    take,
    requireTotalCount: false,
    outputType: "raw",
    apiKey,
  };

  // Add explicit sort on fmGuid to help MongoDB use indexes
  if (options.useExplicitSort !== false) {
    requestBody.sort = [{ selector: "fmGuid", desc: false }];
  }

  // Add field projection to reduce document size during sort
  if (options.useMinimalSelect) {
    requestBody.select = MINIMAL_SELECT_FIELDS;
  }

  // For cursor-based pagination, modify filter to use fmGuid > lastGuid
  let effectiveFilter = filter;
  let effectiveSkip = skip;
  if (options.cursorFmGuid) {
    // Append cursor condition: AND fmGuid > cursorFmGuid
    effectiveFilter = [...filter, "and", ["fmGuid", ">", options.cursorFmGuid]];
    effectiveSkip = 0; // Reset skip when using cursor
    requestBody.filter = effectiveFilter;
    requestBody.skip = 0;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Asset+ API failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const data = result.data || [];
  
  // Extract last fmGuid for cursor pagination
  const lastFmGuid = data.length > 0 ? data[data.length - 1].fmGuid : undefined;
  
  return {
    data,
    hasMore: data.length === take,
    lastFmGuid,
  };
}

// Adaptive fetch with retry and backoff for sort memory errors
async function fetchWithAdaptiveRetry(
  accessToken: string,
  filter: any[],
  skip: number,
  initialTake: number,
  cursorFmGuid?: string | null
): Promise<{ data: any[]; hasMore: boolean; lastFmGuid?: string; usedTake: number; switchedToCursor: boolean }> {
  const takeSizes = [initialTake, 100, 50, 25];
  let lastError: Error | null = null;
  
  for (const take of takeSizes) {
    try {
      // Fetch full objects (including user-defined properties) with explicit sort
      const result = await fetchAssetPlusObjects(accessToken, filter, skip, take, {
        useMinimalSelect: false,
        useExplicitSort: true,
        cursorFmGuid: cursorFmGuid || undefined,
      });
      
      return {
        ...result,
        usedTake: take,
        switchedToCursor: !!cursorFmGuid,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (isSortMemoryError(lastError.message)) {
        console.log(`Sort memory error at take=${take}, skip=${skip}. Retrying with smaller batch...`);
        // Add jitter before retry
        await sleep(250 + Math.random() * 250);
        continue;
      }
      
      // Non-recoverable error, throw immediately
      throw error;
    }
  }
  
  // All batch sizes failed - suggest cursor mode
  throw new Error(`SORT_MEMORY_LIMIT: Even smallest batch (25) failed. ${lastError?.message}`);
}

// Get count for specific object types
async function getRemoteCountByTypes(
  accessToken: string,
  objectTypes: number[]
): Promise<number> {
  const apiUrl = _creds.apiUrl || Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = _creds.apiKey || Deno.env.get("ASSET_PLUS_API_KEY");

  if (!apiUrl || !apiKey) return -1;

  const baseUrl = apiUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/PublishDataServiceGetMerged`;

  // Build filter for specified object types
  const filter: any[] = [];
  objectTypes.forEach((type, idx) => {
    if (idx > 0) filter.push("or");
    filter.push(["objectType", "=", type]);
  });

  const requestBody = {
    filter,
    skip: 0,
    take: 1,
    requireTotalCount: true,
    outputType: "raw",
    apiKey,
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) return -1;
    
    const result = await response.json();
    return result.totalCount ?? -1;
  } catch {
    return -1;
  }
}

// Get total count from Asset+
async function getRemoteTotalCount(accessToken: string): Promise<number> {
  return getRemoteCountByTypes(accessToken, [1, 2, 3, 4]);
}

function objectTypeToCategory(objectType: number): string {
  const categories: Record<number, string> = {
    0: 'Complex',
    1: 'Building',
    2: 'Building Storey',
    3: 'Space',
    4: 'Instance',
  };
  return categories[objectType] || 'Unknown';
}

// Write geometry mapping rows for synced Asset+ objects
async function upsertGeometryMappings(supabase: any, items: any[]): Promise<void> {
  if (items.length === 0) return;

  const now = new Date().toISOString();
  const rows = items.map((item: any) => {
    const category = objectTypeToCategory(item.objectType);
    const entityType = category === 'Building' ? 'building'
      : category === 'Building Storey' ? 'storey'
      : category === 'Space' ? 'space'
      : 'instance';

    // Extract parent BIM model info from attributes
    const parentModelGuid = item.parentBimObjectId || null;
    const parentModelName = item.parentCommonName || null;

    return {
      building_fm_guid: item.buildingFmGuid || item.fmGuid,
      asset_fm_guid: item.fmGuid,
      source_system: 'asset_plus',
      external_entity_id: item.originalSystemId || item.fmGuid,
      entity_type: entityType,
      model_id: parentModelGuid || null,
      storey_fm_guid: item.levelFmGuid || null,
      source_model_guid: parentModelGuid,
      source_model_name: parentModelName,
      source_storey_name: entityType === 'storey' ? (item.levelName || item.commonName || item.designation || null) : null,
      metadata: {},
      last_seen_at: now,
    };
  });

  // Batch upsert in chunks of 500
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('geometry_entity_map')
      .upsert(chunk, { onConflict: 'source_system,building_fm_guid,asset_fm_guid,COALESCE(model_id, \'\')' })
      .then((res: any) => res, (err: any) => {
        // Fallback: try individual inserts if batch upsert fails on unique index
        console.debug('Batch geometry mapping upsert failed, using individual inserts');
        return { error: err };
      });
    
    if (error) {
      // Try one-by-one as fallback for unique index with COALESCE
      for (const row of chunk) {
        await supabase.from('geometry_entity_map').upsert(row).then(() => {}, () => {});
      }
    }
  }
}

async function upsertAssets(supabase: any, items: any[], options?: { skipGeometryMapping?: boolean }): Promise<number> {
  if (items.length === 0) return 0;

  const assets = items.map((item: any) => ({
    fm_guid: item.fmGuid,
    category: objectTypeToCategory(item.objectType),
    name: item.designation || null,
    common_name: item.commonName || null,
    building_fm_guid: item.buildingFmGuid || null,
    level_fm_guid: item.levelFmGuid || null,
    in_room_fm_guid: item.inRoomFmGuid || null,
    complex_common_name: item.complexCommonName || null,
    gross_area: item.grossArea || null,
    asset_type: item.objectTypeValue || null,
    created_in_model: item.createdInModel !== undefined ? item.createdInModel : true,
    source_updated_at: item.dateModified || null,
    attributes: item,
    synced_at: new Date().toISOString(),
  }));

  // Upsert in chunks of 100 to avoid Postgres statement timeouts on large batches
  const UPSERT_CHUNK = 100;
  for (let i = 0; i < assets.length; i += UPSERT_CHUNK) {
    const chunk = assets.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from('assets')
      .upsert(chunk, { 
        onConflict: 'fm_guid',
        ignoreDuplicates: false 
      });
    if (error) throw error;
  }

  // Also populate geometry entity map (skip during bulk sync for performance)
  if (!options?.skipGeometryMapping) {
    try {
      await upsertGeometryMappings(supabase, items);
    } catch (e) {
      console.debug('geometry_entity_map upsert failed (non-fatal):', e);
    }
  }

  return assets.length;
}

async function updateSyncState(
  supabase: any, 
  subtreeId: string, 
  status: string, 
  totalAssets?: number, 
  errorMessage?: string,
  extraData?: Record<string, any>
) {
  const updateData: any = {
    sync_status: status,
    updated_at: new Date().toISOString(),
    ...extraData,
  };

  if (status === 'running') {
    updateData.last_sync_started_at = new Date().toISOString();
    updateData.error_message = null;
  } else if (status === 'completed') {
    updateData.last_sync_completed_at = new Date().toISOString();
    updateData.error_message = null;
  }

  if (totalAssets !== undefined) updateData.total_assets = totalAssets;
  if (errorMessage) updateData.error_message = errorMessage;

  await supabase
    .from('asset_sync_state')
    .upsert({
      subtree_id: subtreeId,
      subtree_name: getSubtreeName(subtreeId),
      ...updateData,
    }, { onConflict: 'subtree_id' });
}

function getSubtreeName(subtreeId: string): string {
  const names: Record<string, string> = {
    'structure': 'Byggnad/Plan/Rum',
    'assets': 'Alla Tillgångar',
    'xkt': 'XKT-filer',
    'full': 'Full Sync',
    'buildings': 'Byggnader',
  };
  return names[subtreeId] || subtreeId;
}

// Auto-detect and mark stale "running" syncs as interrupted
async function markStaleRunningAsInterrupted(supabase: any) {
  const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
  const now = Date.now();

  const { data: runningSyncs } = await supabase
    .from('asset_sync_state')
    .select('*')
    .eq('sync_status', 'running');

  if (!runningSyncs) return;

  for (const sync of runningSyncs) {
    const updatedAt = new Date(sync.updated_at).getTime();
    if (now - updatedAt > STALE_THRESHOLD_MS) {
      console.log(`Marking stale sync as interrupted: ${sync.subtree_id}`);
      await supabase
        .from('asset_sync_state')
        .update({
          sync_status: 'interrupted',
          error_message: 'Previous run timed out. Click sync button to resume.',
          updated_at: new Date().toISOString()
        })
        .eq('subtree_id', sync.subtree_id);
    }
  }
}

// Prefixes for non-Asset+ data sources that should be excluded from orphan cleanup
const NON_ASSETPLUS_PREFIXES = ['acc-bim-', 'acc-'];

function isNonAssetPlusGuid(fmGuid: string): boolean {
  return NON_ASSETPLUS_PREFIXES.some(prefix => fmGuid.startsWith(prefix));
}

// Fetch all fm_guids from local DB, paginating past the 1000-row default limit
// excludeNonAssetPlus: when true, filters out fm_guids with non-Asset+ prefixes (e.g. acc-bim-*)
// Returns objects with fm_guid and building_fm_guid for scope-aware orphan detection
async function fetchAllLocalFmGuids(
  supabase: any,
  categories: string[],
  isLocal: boolean = false,
  excludeNonAssetPlus: boolean = false
): Promise<{ fm_guid: string; building_fm_guid: string | null }[]> {
  const allItems: { fm_guid: string; building_fm_guid: string | null }[] = [];
  const PAGE = 1000;
  let from = 0;
  let done = false;

  while (!done) {
    const { data, error } = await supabase
      .from('assets')
      .select('fm_guid, building_fm_guid')
      .in('category', categories)
      .eq('is_local', isLocal)
      .range(from, from + PAGE - 1);

    if (error) throw error;

    if (data && data.length > 0) {
      data.forEach((r: any) => allItems.push({ fm_guid: r.fm_guid, building_fm_guid: r.building_fm_guid }));
      from += PAGE;
      if (data.length < PAGE) done = true;
    } else {
      done = true;
    }
  }

  if (excludeNonAssetPlus) {
    return allItems.filter(item => !isNonAssetPlusGuid(item.fm_guid));
  }
  return allItems;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify authentication - sync operations require admin
  const auth = await verifyAuth(req);
  if (!auth.authenticated) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { action = 'full-sync', buildingFmGuid } = body;

    // Resolve per-building credentials (falls back to env vars)
    _creds = await getAssetPlusCredentials(supabase, buildingFmGuid);
    // Only admins can run full sync operations
    const adminOnlyActions = ['full-sync', 'sync-structure', 'sync-assets-chunked', 'sync-assets-resumable', 'sync-xkt', 'sync-xkt-resumable'];
    if (adminOnlyActions.includes(action) && !auth.isAdmin) {
      return forbiddenResponse("Only admins can run full sync operations");
    }
    
    console.log(`Action: ${action} (user: ${auth.userId}, admin: ${auth.isAdmin})`);


    // ============ CHECK SYNC STATUS ============
    if (action === 'check-sync-status') {
      // Auto-mark stale syncs
      await markStaleRunningAsInterrupted(supabase);

      // --- Phase 1: Fast DB-only counts (no API dependency) ---
      const [
        { count: localStructureCount },
        { count: localAssetCount },
        { count: xktCount },
        { count: buildingCount },
        { data: syncStates },
      ] = await Promise.all([
        supabase.from('assets').select('*', { count: 'exact', head: true }).in('category', ['Building', 'Building Storey', 'Space']),
        supabase.from('assets').select('*', { count: 'exact', head: true }).in('category', ['Instance']),
        supabase.from('xkt_models' as any).select('*', { count: 'exact', head: true }),
        supabase.from('assets').select('*', { count: 'exact', head: true }).eq('category', 'Building'),
        supabase.from('asset_sync_state').select('*'),
      ]);

      const localTotal = (localStructureCount || 0) + (localAssetCount || 0);

      // --- Phase 2: Try remote counts (with timeout) ---
      let remoteStructureCount = -1;
      let remoteAssetsCount = -1;
      let remoteTotalCount = -1;
      let remoteError: string | null = null;

      try {
        const accessToken = await getAccessToken();
        const timeoutMs = 12000;
        const withTimeout = <T>(p: Promise<T>): Promise<T> =>
          Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))]);

        const [rStructure, rAssets] = await Promise.all([
          withTimeout(getRemoteCountByTypes(accessToken, [1, 2, 3])),
          withTimeout(getRemoteCountByTypes(accessToken, [4])),
        ]);
        remoteStructureCount = rStructure;
        remoteAssetsCount = rAssets;
        remoteTotalCount = rStructure + rAssets;
      } catch (remoteErr: any) {
        remoteError = remoteErr.message || 'Failed to fetch remote counts';
        console.warn('check-sync-status: remote counts unavailable:', remoteError);
      }

      const structureInSync = remoteStructureCount >= 0 ? (localStructureCount || 0) === remoteStructureCount : null;
      const assetsInSync = remoteAssetsCount >= 0 ? (localAssetCount || 0) === remoteAssetsCount : null;

      return new Response(
        JSON.stringify({
          success: true,
          ...(remoteError ? { remoteError } : {}),
          structure: {
            localCount: localStructureCount || 0,
            remoteCount: remoteStructureCount >= 0 ? remoteStructureCount : null,
            inSync: structureInSync,
            syncState: syncStates?.find((s: any) => s.subtree_id === 'structure'),
          },
          assets: {
            localCount: localAssetCount || 0,
            remoteCount: remoteAssetsCount >= 0 ? remoteAssetsCount : null,
            inSync: assetsInSync,
            syncState: syncStates?.find((s: any) => s.subtree_id === 'assets'),
          },
          xkt: {
            localCount: xktCount || 0,
            buildingCount: buildingCount || 0,
            syncState: syncStates?.find((s: any) => s.subtree_id === 'xkt'),
          },
          total: {
            localCount: localTotal,
            remoteCount: remoteTotalCount >= 0 ? remoteTotalCount : null,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC STRUCTURE — RESUMABLE (Buildings, Storeys, Spaces) ============
    if (action === 'sync-structure') {
      const force = body?.force === true;

      // Skip guard: if structure was synced recently and not forced, return immediately
      if (!force) {
        const { data: structState } = await supabase
          .from('asset_sync_state')
          .select('sync_status, last_sync_completed_at')
          .eq('subtree_id', 'structure')
          .maybeSingle();

        if (structState?.sync_status === 'completed' && structState?.last_sync_completed_at) {
          const msSince = Date.now() - new Date(structState.last_sync_completed_at).getTime();
          if (msSince < 5 * 60 * 1000) {
            console.log(`Structure synced ${Math.round(msSince / 1000)}s ago, skipping (use force:true to override)`);
            return new Response(
              JSON.stringify({ success: true, interrupted: false, skipped: true, totalSynced: 0, message: 'Structure synced recently' }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }

      const MAX_EXECUTION_TIME = 45000; // 45s guard (60s edge fn limit)
      const startTime = Date.now();
      await updateSyncState(supabase, 'structure', 'running');
      const accessToken = await getAccessToken();

      // Load or create progress record
      const { data: existingProgress } = await supabase
        .from('asset_sync_progress')
        .select('*')
        .eq('job', 'structure_objects')
        .maybeSingle();

      let skip = existingProgress?.skip || 0;
      let totalSynced = existingProgress?.total_synced || 0;
      const phase = existingProgress?.page_mode || 'upsert'; // 'upsert' or 'cleanup'

      console.log(`Starting resumable sync-structure phase=${phase} skip=${skip} totalSynced=${totalSynced}`);

      if (phase === 'upsert') {
        // Filter: structure objects (1=Building, 2=Storey, 3=Space) that are NOT expired
        const filter = [
          "(", ["objectType", "=", 1], "or", ["objectType", "=", 2], "or", ["objectType", "=", 3], ")",
          "and",
          ["expireDate", "=", null]
        ];

        const take = 200;
        let hasMore = true;

        while (hasMore) {
          // Timeout guard
          if (Date.now() - startTime > MAX_EXECUTION_TIME) {
            console.log(`Structure upsert timeout at skip=${skip}, totalSynced=${totalSynced}`);
            await supabase.from('asset_sync_progress').upsert({
              job: 'structure_objects',
              skip,
              total_synced: totalSynced,
              page_mode: 'upsert',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'job' });
            await updateSyncState(supabase, 'structure', 'running', totalSynced);

            return new Response(
              JSON.stringify({ success: true, interrupted: true, phase: 'upsert', totalSynced }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          console.log(`Fetching structure at skip=${skip}...`);
          const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);

          if (result.data.length > 0) {
            const synced = await upsertAssets(supabase, result.data);
            totalSynced += synced;
            console.log(`Synced ${synced} structure items (total: ${totalSynced})`);
          }

          hasMore = result.hasMore;
          skip += take;
          await updateSyncState(supabase, 'structure', 'running', totalSynced);
        }

        // Upsert phase complete — transition to cleanup
        console.log(`Structure upsert done: ${totalSynced} items. Starting orphan cleanup...`);
        await supabase.from('asset_sync_progress').upsert({
          job: 'structure_objects',
          skip: 0,
          total_synced: totalSynced,
          page_mode: 'cleanup',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'job' });

        // Check timeout before cleanup
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          return new Response(
            JSON.stringify({ success: true, interrupted: true, phase: 'cleanup', totalSynced }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // ---- Cleanup phase ----
      // Re-fetch all remote fm_guids for orphan detection (structure is ~2800, fits in memory)
      console.log('Running orphan cleanup for structure...');
      const cleanupFilter = [
        "(", ["objectType", "=", 1], "or", ["objectType", "=", 2], "or", ["objectType", "=", 3], ")",
        "and",
        ["expireDate", "=", null]
      ];
      const remoteFmGuids = new Set<string>();
      let cleanupSkip = 0;
      const cleanupTake = 500;
      let cleanupHasMore = true;

      while (cleanupHasMore) {
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          console.log('Timeout during orphan fetch — will retry next invocation');
          return new Response(
            JSON.stringify({ success: true, interrupted: true, phase: 'cleanup', totalSynced }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const result = await fetchAssetPlusObjects(accessToken, cleanupFilter, cleanupSkip, cleanupTake);
        result.data.forEach((item: any) => remoteFmGuids.add(item.fmGuid));
        cleanupHasMore = result.hasMore;
        cleanupSkip += cleanupTake;
      }

      console.log(`Total remote fmGuids: ${remoteFmGuids.size}. Checking for orphans...`);
      const localFmGuids = await fetchAllLocalFmGuids(supabase, ['Building', 'Building Storey', 'Space'], false, true);
      console.log(`Local non-is_local structure count (excl. ACC): ${localFmGuids.length}`);

      const orphanFmGuids = localFmGuids.filter(item => !remoteFmGuids.has(item.fm_guid));
      let orphansRemoved = 0;
      if (orphanFmGuids.length > 0) {
        console.log(`Found ${orphanFmGuids.length} orphan structure objects to remove`);
        const batchSize = 100;
        for (let i = 0; i < orphanFmGuids.length; i += batchSize) {
          const batch = orphanFmGuids.slice(i, i + batchSize).map(item => item.fm_guid);
          const { error: deleteError } = await supabase
            .from('assets')
            .delete()
            .in('fm_guid', batch);
          if (deleteError) {
            console.error(`Error deleting orphans batch:`, deleteError);
          } else {
            orphansRemoved += batch.length;
          }
        }
        console.log(`Removed ${orphansRemoved} orphan structure objects`);
      } else {
        console.log('No orphan structure objects found');
      }

      // Done — clean up progress record
      await supabase.from('asset_sync_progress').delete().eq('job', 'structure_objects');
      await updateSyncState(supabase, 'structure', 'completed', totalSynced);
      console.log(`Structure sync completed: ${totalSynced} items, ${orphansRemoved} orphans removed`);

      return new Response(
        JSON.stringify({
          success: true,
          interrupted: false,
          message: orphansRemoved > 0
            ? `Synced ${totalSynced} structure items, removed ${orphansRemoved} orphans`
            : `Synced ${totalSynced} structure items`,
          totalSynced,
          orphansRemoved,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC ASSETS RESUMABLE (replaces sync-assets-chunked) ============
    if (action === 'sync-assets-resumable' || action === 'sync-assets-chunked') {
      const MAX_EXECUTION_TIME = 45000; // 45 seconds (conservative for 60s limit)
      const startTime = Date.now();
      const force = body?.force === true;
      const targetBuildingFmGuid = body?.buildingFmGuid || null;

      // Skip guard: if assets were synced recently and not forced, return immediately
      if (!force && !targetBuildingFmGuid) {
        const { data: assetsState } = await supabase
          .from('asset_sync_state')
          .select('sync_status, last_sync_completed_at')
          .eq('subtree_id', 'assets')
          .maybeSingle();

        if (assetsState?.sync_status === 'completed' && assetsState?.last_sync_completed_at) {
          const msSince = Date.now() - new Date(assetsState.last_sync_completed_at).getTime();
          if (msSince < 5 * 60 * 1000) {
            console.log(`Assets synced ${Math.round(msSince / 1000)}s ago, skipping (use force:true to override)`);
            return new Response(
              JSON.stringify({ success: true, interrupted: false, skipped: true, totalSynced: 0, message: 'Assets synced recently' }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }
      
      const accessToken = await getAccessToken();
      console.log(`Starting sync-assets-resumable (target: ${targetBuildingFmGuid || 'all'}, force: ${force})`);

      // Get all buildings from local DB
      const { data: allBuildings, error: buildingsError } = await supabase
        .from('assets')
        .select('fm_guid, common_name')
        .eq('category', 'Building')
        .order('common_name');

      if (buildingsError) throw buildingsError;

      if (!allBuildings || allBuildings.length === 0) {
        await updateSyncState(supabase, 'assets', 'failed', 0, 'No buildings found. Run structure sync first.');
        return new Response(
          JSON.stringify({ success: false, error: 'No buildings found. Run structure sync first.', interrupted: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Filter to target building if specified
      const buildings = targetBuildingFmGuid
        ? allBuildings.filter((b: any) => b.fm_guid === targetBuildingFmGuid)
        : allBuildings;

      if (buildings.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: `Building ${targetBuildingFmGuid} not found locally.`, interrupted: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load progress cursor (now includes cursor_fm_guid and page_mode)
      const { data: progress } = await supabase
        .from('asset_sync_progress')
        .select('*')
        .eq('job', 'assets_instances')
        .maybeSingle();

      let currentBuildingIndex = progress?.current_building_index || 0;
      let currentSkip = progress?.skip || 0;
      let totalSynced = progress?.total_synced || 0;
      let cursorFmGuid: string | null = progress?.cursor_fm_guid || null;
      let pageMode: 'skip' | 'cursor' = (progress?.page_mode as 'skip' | 'cursor') || 'skip';
      const totalBuildings = buildings.length;

      // If we're past the last building, we're done
      if (currentBuildingIndex >= totalBuildings) {
        // Clear progress
        await supabase.from('asset_sync_progress').delete().eq('job', 'assets_instances');
        await updateSyncState(supabase, 'assets', 'completed', totalSynced, undefined, {
          subtree_name: 'Alla Tillgångar'
        });
        return new Response(
          JSON.stringify({ success: true, message: `Completed: ${totalSynced} assets`, totalSynced, interrupted: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await updateSyncState(supabase, 'assets', 'running', totalSynced);
      let interrupted = false;
      let softError: string | null = null;
      const take = 500; // Increased for throughput — geometry mapping deferred to post-sync

      while (currentBuildingIndex < totalBuildings && !interrupted) {
        const building = buildings[currentBuildingIndex];
        const buildingName = building.common_name || building.fm_guid;
        console.log(`Syncing assets for building ${currentBuildingIndex + 1}/${totalBuildings}: ${buildingName} (mode: ${pageMode})`);

        // --- Incremental sync: check last_asset_sync_at ---
        let lastSyncAt: string | null = null;
        if (!force && currentSkip === 0 && pageMode === 'skip') {
          const { data: bSettings } = await supabase
            .from('building_settings')
            .select('last_asset_sync_at')
            .eq('fm_guid', building.fm_guid)
            .maybeSingle();
          lastSyncAt = bSettings?.last_asset_sync_at || null;
        }

        // --- Quick count check: skip if counts match and not forced ---
        if (!force && currentSkip === 0 && pageMode === 'skip') {
          const { count: localAssetCount } = await supabase
            .from('assets')
            .select('*', { count: 'exact', head: true })
            .eq('building_fm_guid', building.fm_guid)
            .eq('category', 'Instance');

          if (localAssetCount && localAssetCount > 0 && lastSyncAt) {
            // We have assets and a previous sync timestamp — try incremental
            const incrFilter: any[] = [
              ["buildingFmGuid", "=", building.fm_guid],
              "and",
              ["objectType", "=", 4],
              "and",
              ["dateModified", ">", lastSyncAt]
            ];
            try {
              const incrResult = await fetchAssetPlusObjects(accessToken, incrFilter, 0, 1, {
                useMinimalSelect: true,
                useExplicitSort: false,
              });
              if (incrResult.data.length === 0) {
                console.log(`Building ${buildingName}: no changes since ${lastSyncAt}, skipping`);
                currentBuildingIndex++;
                currentSkip = 0;
                cursorFmGuid = null;
                pageMode = 'skip';
                continue;
              }
              console.log(`Building ${buildingName}: changes detected since ${lastSyncAt}, syncing incrementally`);
            } catch (e) {
              console.log(`Incremental check failed for ${buildingName}, doing full sync`);
            }
          }
        }

        const filter = [
          ["buildingFmGuid", "=", building.fm_guid],
          "and",
          ["objectType", "=", 4],
          "and",
          ["expireDate", "=", null]
        ];

        let hasMore = true;

        while (hasMore) {
          // Check timeout before each batch
          if (Date.now() - startTime > MAX_EXECUTION_TIME) {
            console.log(`Timeout approaching at building ${currentBuildingIndex + 1}/${totalBuildings}, skip=${currentSkip}`);
            interrupted = true;
            break;
          }

          try {
            // Use adaptive fetch with backoff for sort memory errors
            const result = await fetchWithAdaptiveRetry(
              accessToken, 
              filter, 
              pageMode === 'cursor' ? 0 : currentSkip, 
              take,
              pageMode === 'cursor' ? cursorFmGuid : null
            );
            
            if (result.data.length > 0) {
              const synced = await upsertAssets(supabase, result.data, { skipGeometryMapping: true });
              totalSynced += synced;
              
              // Update cursor for next iteration
              if (result.lastFmGuid) {
                cursorFmGuid = result.lastFmGuid;
              }
            }

            hasMore = result.hasMore;
            
            // Update skip only in skip mode
            if (pageMode === 'skip') {
              currentSkip += result.usedTake;
            }

            // Save progress after each batch
            await supabase
              .from('asset_sync_progress')
              .upsert({
                job: 'assets_instances',
                building_fm_guid: building.fm_guid,
                current_building_index: currentBuildingIndex,
                skip: currentSkip,
                cursor_fm_guid: cursorFmGuid,
                page_mode: pageMode,
                total_buildings: totalBuildings,
                total_synced: totalSynced,
                last_error: null,
                updated_at: new Date().toISOString()
              }, { onConflict: 'job' });

            // Update sync state (heartbeat)
            await updateSyncState(supabase, 'assets', 'running', totalSynced, undefined, {
              subtree_name: `Alla Tillgångar (${currentBuildingIndex + 1}/${totalBuildings} - ${pageMode})`
            });
            
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            
            if (errMsg.startsWith('SORT_MEMORY_LIMIT')) {
              // All batch sizes failed - switch to cursor mode if not already
              if (pageMode === 'skip' && currentSkip > 10000) {
                console.log(`Switching to cursor mode at skip=${currentSkip} due to sort memory limit`);
                pageMode = 'cursor';
                
                // Need to get the last fmGuid we have for this building
                const { data: lastAsset } = await supabase
                  .from('assets')
                  .select('fm_guid')
                  .eq('building_fm_guid', building.fm_guid)
                  .eq('category', 'Instance')
                  .order('fm_guid', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                
                cursorFmGuid = lastAsset?.fm_guid || null;
                
                // Save the mode switch
                await supabase
                  .from('asset_sync_progress')
                  .upsert({
                    job: 'assets_instances',
                    building_fm_guid: building.fm_guid,
                    current_building_index: currentBuildingIndex,
                    skip: currentSkip,
                    cursor_fm_guid: cursorFmGuid,
                    page_mode: 'cursor',
                    total_buildings: totalBuildings,
                    total_synced: totalSynced,
                    last_error: 'Switched to cursor mode',
                    updated_at: new Date().toISOString()
                  }, { onConflict: 'job' });
                
                softError = 'SWITCHED_TO_CURSOR_MODE';
                // Don't break - continue with cursor mode
                continue;
              } else {
                // Already in cursor mode or skip is low - this is a hard failure
                throw error;
              }
            }
            
            // Other errors - save and re-throw
            await supabase
              .from('asset_sync_progress')
              .upsert({
                job: 'assets_instances',
                building_fm_guid: building.fm_guid,
                current_building_index: currentBuildingIndex,
                skip: currentSkip,
                cursor_fm_guid: cursorFmGuid,
                page_mode: pageMode,
                total_buildings: totalBuildings,
                total_synced: totalSynced,
                last_error: errMsg.substring(0, 500),
                updated_at: new Date().toISOString()
              }, { onConflict: 'job' });
            
            throw error;
          }
        }

        if (!interrupted) {
          // Move to next building - reset pagination state
          currentBuildingIndex++;
          currentSkip = 0;
          cursorFmGuid = null;
          pageMode = 'skip'; // Reset to skip mode for new building

          // Update last_asset_sync_at for this building
          await supabase
            .from('building_settings')
            .upsert({
              fm_guid: building.fm_guid,
              last_asset_sync_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: 'fm_guid' });
          
          // Save progress
          await supabase
            .from('asset_sync_progress')
            .upsert({
              job: 'assets_instances',
              building_fm_guid: currentBuildingIndex < totalBuildings ? buildings[currentBuildingIndex].fm_guid : null,
              current_building_index: currentBuildingIndex,
              skip: 0,
              cursor_fm_guid: null,
              page_mode: 'skip',
              total_buildings: totalBuildings,
              total_synced: totalSynced,
              last_error: null,
              updated_at: new Date().toISOString()
            }, { onConflict: 'job' });
        }
      }

      if (!interrupted && currentBuildingIndex >= totalBuildings) {
        // Clear progress on completion
        await supabase.from('asset_sync_progress').delete().eq('job', 'assets_instances');
        await updateSyncState(supabase, 'assets', 'completed', totalSynced, undefined, {
          subtree_name: 'Alla Tillgångar'
        });
      } else {
        await updateSyncState(supabase, 'assets', 'running', totalSynced, `Progress: building ${currentBuildingIndex + 1}/${totalBuildings} (${pageMode})`, {
          subtree_name: `Alla Tillgångar (${currentBuildingIndex + 1}/${totalBuildings})`
        });
      }

      console.log(`Assets sync ${interrupted ? 'paused' : 'completed'}: ${totalSynced} items`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: interrupted 
            ? `Synced ${totalSynced} assets (${currentBuildingIndex + 1}/${totalBuildings} buildings). Call again to continue.`
            : `Completed: ${totalSynced} assets from ${totalBuildings} buildings`, 
          totalSynced,
          interrupted,
          softError,
          progress: {
            currentBuildingIndex,
            totalBuildings,
            currentSkip,
            pageMode,
            cursorFmGuid
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ RESET ASSETS PROGRESS (admin-only) ============
    if (action === 'reset-assets-progress') {
      console.log('Resetting assets sync progress');
      
      // Delete progress record
      await supabase.from('asset_sync_progress').delete().eq('job', 'assets_instances');
      
      // Update sync state to interrupted
      await updateSyncState(supabase, 'assets', 'interrupted', undefined, 'Progress reset by admin');
      
      return new Response(
        JSON.stringify({ success: true, message: 'Assets sync progress reset. You can start a fresh sync.' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ RESET STRUCTURE PROGRESS (admin-only) ============
    if (action === 'reset-structure-progress') {
      console.log('Resetting structure sync progress');
      
      await supabase.from('asset_sync_progress').delete().eq('job', 'structure_objects');
      await updateSyncState(supabase, 'structure', 'interrupted', undefined, 'Progress reset by admin');
      
      return new Response(
        JSON.stringify({ success: true, message: 'Structure sync progress reset.' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC SINGLE BUILDING ASSETS (ObjectType 4 for one building) ============
    if (action === 'sync-single-building') {
      if (!buildingFmGuid) {
        return new Response(
          JSON.stringify({ success: false, error: 'buildingFmGuid is required' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const syncStateId = `building-assets-${buildingFmGuid}`;
      await updateSyncState(supabase, syncStateId, 'running');
      const accessToken = await getAccessToken();
      console.log(`Starting sync-single-building for: ${buildingFmGuid}`);

      const filter = [
        ["buildingFmGuid", "=", buildingFmGuid],
        "and",
        ["objectType", "=", 4]
      ];

      let totalSynced = 0;
      let skip = 0;
      // Keep batches small to avoid Asset+ backend Mongo sort memory limits
      const take = 200;
      let hasMore = true;

      while (hasMore) {
        console.log(`Fetching assets at skip=${skip}...`);
        const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);
        
        if (result.data.length > 0) {
          const synced = await upsertAssets(supabase, result.data);
          totalSynced += synced;
          console.log(`Synced ${synced} assets (total: ${totalSynced})`);
        }

        hasMore = result.hasMore;
        skip += take;
        await updateSyncState(supabase, syncStateId, 'running', totalSynced);
      }

      await updateSyncState(supabase, syncStateId, 'completed', totalSynced);

      // Update last_asset_sync_at for this building
      await supabase
        .from('building_settings')
        .upsert({
          fm_guid: buildingFmGuid,
          last_asset_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'fm_guid' });

      console.log(`Single building sync completed: ${totalSynced} assets`);

      return new Response(
        JSON.stringify({ success: true, message: `Synced ${totalSynced} assets for building`, totalSynced, buildingFmGuid }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC XKT MODELS RESUMABLE ============
    if (action === 'sync-xkt' || action === 'sync-xkt-resumable' || action === 'cache-all-xkt') {
      const MAX_EXECUTION_TIME = 45000; // 45 seconds
      const startTime = Date.now();
      
      const accessToken = await getAccessToken();
      const apiUrl = _creds.apiUrl || Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = _creds.apiKey || Deno.env.get("ASSET_PLUS_API_KEY") || "";
      
      console.log('Starting sync-xkt-resumable');

      // Get all buildings from local DB
      const { data: buildings, error: buildingsError } = await supabase
        .from('assets')
        .select('fm_guid, common_name')
        .eq('category', 'Building')
        .order('common_name');

      if (buildingsError) throw buildingsError;

      if (!buildings || buildings.length === 0) {
        await updateSyncState(supabase, 'xkt', 'failed', 0, 'No buildings found.');
        return new Response(
          JSON.stringify({ success: false, error: 'No buildings found.', interrupted: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load progress cursor
      const { data: progress } = await supabase
        .from('asset_sync_progress')
        .select('*')
        .eq('job', 'xkt_models')
        .maybeSingle();

      let currentBuildingIndex = progress?.current_building_index || 0;
      let totalSynced = progress?.total_synced || 0;
      const totalBuildings = buildings.length;

      // If we're past the last building, we're done
      if (currentBuildingIndex >= totalBuildings) {
        await supabase.from('asset_sync_progress').delete().eq('job', 'xkt_models');
        await updateSyncState(supabase, 'xkt', 'completed', totalSynced, undefined, {
          subtree_name: 'XKT-filer'
        });
        return new Response(
          JSON.stringify({ success: true, message: `Completed: ${totalSynced} models`, synced: totalSynced, interrupted: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await updateSyncState(supabase, 'xkt', 'running', totalSynced);
      let interrupted = false;
      const errors: string[] = [];
      let allRevisions: any[] = [];
      let revisionsFetched = false;

      while (currentBuildingIndex < totalBuildings && !interrupted) {
        // Check timeout
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          console.log(`Timeout approaching at building ${currentBuildingIndex + 1}/${totalBuildings}`);
          interrupted = true;
          break;
        }

        const building = buildings[currentBuildingIndex];
        const buildingFmGuid = building.fm_guid;
        const buildingName = building.common_name || buildingFmGuid;

        // Fetch building asset attributes for parentBimObjectId fallback
        let buildingParentBimObjId = '';
        try {
          const { data: bldgAsset } = await supabase
            .from('assets')
            .select('attributes')
            .eq('fm_guid', buildingFmGuid)
            .eq('category', 'Building')
            .maybeSingle();
          if (bldgAsset?.attributes) {
            const attrs = typeof bldgAsset.attributes === 'string' ? JSON.parse(bldgAsset.attributes) : bldgAsset.attributes;
            buildingParentBimObjId = attrs.parentBimObjectId || attrs.buildingBimObjectId || '';
          }
        } catch {}

        try {
          // Use robust endpoint discovery
          const discovery = await discover3dModelsEndpoint(supabase, accessToken, apiUrl, apiKey, buildingFmGuid);
          
          if (!discovery.url) {
            console.log(`Building ${buildingName}: No 3D models endpoint available`);
            currentBuildingIndex++;
            continue;
          }

          const models = discovery.models || [];
          
          if (models.length === 0) {
            console.log(`Building ${buildingName}: No XKT models available`);
            currentBuildingIndex++;
            continue;
          }

          console.log(`Building ${buildingName}: Found ${models.length} models from GetAllRelatedModels`);
          // Log ALL fields for debugging
          for (const m of models) {
            console.log(`  Model FULL: ${JSON.stringify(m)}`);
          }

          // Build bimObjectId lookup from GetAllRelatedModels models
          const bimObjectIdMap = new Map<string, string>();
          for (const m of models) {
            const mId = m.modelId || m.id || m.ModelId;
            const bimObjId = m.bimObjectId || m.BimObjectId || m.fmGuid || m.FmGuid;
            if (mId && bimObjId) bimObjectIdMap.set(String(mId), String(bimObjId));
          }

          // Fetch model revisions to get actual modelId for GetXktData
          // GetAllModelRevisions returns {modelId, revisionId, entityName, modelName, status}
          // The revision's modelId is what GetXktData needs
          if (!revisionsFetched) {
            const revisionsUrl = `${discovery.url}/GetAllModelRevisions`;
            try {
              const revRes = await fetch(revisionsUrl, {
                headers: { "Authorization": `Bearer ${accessToken}` }
              });
              if (revRes.ok) {
                const revData = await revRes.json();
                allRevisions = revData?.modelRevisions || (Array.isArray(revData) ? revData : []);
                console.log(`Loaded ${allRevisions.length} model revisions`);
                // Log first 3 revisions with ALL fields for debugging
                for (let ri = 0; ri < Math.min(3, allRevisions.length); ri++) {
                  console.log(`  RevFull[${ri}]: ${JSON.stringify(allRevisions[ri])}`);
                }
                // Log revisions matching Småviken
                const smavikenRevs = allRevisions.filter((r: any) => 
                  String(r.entityName || '').toLowerCase().includes('småviken') ||
                  String(r.entityName || '').toLowerCase().includes('smaviken')
                );
                if (smavikenRevs.length > 0) {
                  console.log(`  🔍 Found ${smavikenRevs.length} Småviken revisions:`);
                  for (const sr of smavikenRevs) {
                    console.log(`    SmåvikenRev: ${JSON.stringify(sr)}`);
                  }
                }
              } else {
                console.log(`GetAllModelRevisions failed: ${revRes.status}`);
              }
            } catch (e) {
              console.log(`GetAllModelRevisions error: ${e}`);
            }
            revisionsFetched = true;
          }

          // Always build sync list from GetAllRelatedModels (which carries bimObjectId).
          // Enrich with revisionId and missing modelId from GetAllModelRevisions when available.
          // IMPORTANT: Match revisions using bimObjectId first (exact), then scope name
          // matching to the same building (entityName) to avoid cross-building collisions.
          const buildingNameLower = String(buildingName).toLowerCase();
          
          // Also look up stored modelIds from assets table (Building Storey attributes)
          let storedModelIds: Record<string, string> = {};
          try {
            const { data: storeys } = await supabase
              .from('assets')
              .select('name, attributes')
              .eq('building_fm_guid', buildingFmGuid)
              .eq('category', 'Building Storey')
              .not('attributes', 'is', null);
            if (storeys) {
              for (const s of storeys) {
                const attrs = typeof s.attributes === 'string' ? JSON.parse(s.attributes) : s.attributes;
                if (attrs?.xktModelId) {
                  const key = String(s.name || '').toLowerCase();
                  if (key) storedModelIds[key] = attrs.xktModelId;
                }
              }
            }
            if (Object.keys(storedModelIds).length > 0) {
              console.log(`  Found ${Object.keys(storedModelIds).length} stored modelIds from assets table`);
            }
          } catch {}
          
          const modelsToSync = models.map((m: any) => {
            const rawModelId = m.modelId || m.id || m.ModelId || '';
            const bimObjId = m.bimObjectId || m.BimObjectId || '';
            const mName = m.name || m.modelName || m.Name || `Model`;
            const modelNameLower = String(mName).toLowerCase();
            
            // Step A: Match by bimObjectId (exact)
            let matchedRev = bimObjId ? allRevisions.find((rev: any) => {
              const revBim = String(rev.bimObjectId || rev.BimObjectId || '');
              return revBim && revBim === bimObjId;
            }) : null;
            
            // Step B: Match by modelId (exact)
            if (!matchedRev && rawModelId) {
              matchedRev = allRevisions.find((rev: any) => String(rev.modelId || '') === String(rawModelId));
            }
            
            // Step C: Match by name, but ONLY within the same building (entityName filter)
            if (!matchedRev && modelNameLower) {
              const buildingScopedRevs = allRevisions.filter((rev: any) => {
                const revEntity = String(rev.entityName || '').toLowerCase();
                return revEntity && revEntity === buildingNameLower;
              });
              matchedRev = buildingScopedRevs.find((rev: any) => {
                const revName = String(rev.modelName || '').toLowerCase();
                return revName && (revName === modelNameLower || revName.includes(modelNameLower) || modelNameLower.includes(revName));
              });
            }
            
            // Resolve modelId: prefer revision's modelId, then stored modelId, then raw, then bimObjId
            const storedId = storedModelIds[modelNameLower] || '';
            const resolvedModelId = String(matchedRev?.modelId || storedId || rawModelId || bimObjId || '');
            
            if (matchedRev?.modelId) {
              console.log(`  ✓ ${mName}: matched revision modelId=${matchedRev.modelId} (entityName=${matchedRev.entityName})`);
            } else if (storedId) {
              console.log(`  ◆ ${mName}: using stored modelId=${storedId} from assets table`);
            } else {
              console.log(`  ⚠ ${mName}: no revision match, using fallback modelId=${resolvedModelId}`);
            }
            
            return {
              modelId: resolvedModelId,
              revisionId: matchedRev?.revisionId || m.revisionId || m.RevisionId || '',
              modelName: mName,
              entityName: buildingName,
              _bimObjectId: bimObjId || m.fmGuid || m.FmGuid || '',
              fmGuid: m.fmGuid || m.FmGuid || '',
              externalGuid: m.externalGuid || m.ExternalGuid || '',
              _resolvedFromRevision: !!matchedRev?.modelId,
            };
          }).filter((m: any) => !!m.modelId);
          
          // Store resolved modelIds back to assets table for future use
          for (const m of modelsToSync) {
            if (m._resolvedFromRevision && m.modelId) {
              try {
                const mNameLower = String(m.modelName).toLowerCase();
                // Find matching Building Storey by name pattern
                const { data: storeyRows } = await supabase
                  .from('assets')
                  .select('id, attributes, name')
                  .eq('building_fm_guid', buildingFmGuid)
                  .eq('category', 'Building Storey')
                  .ilike('name', `%${m.modelName}%`);
                if (storeyRows && storeyRows.length > 0) {
                  for (const row of storeyRows) {
                    const existing = typeof row.attributes === 'string' ? JSON.parse(row.attributes) : (row.attributes || {});
                    if (existing.xktModelId !== m.modelId) {
                      await supabase.from('assets').update({
                        attributes: { ...existing, xktModelId: m.modelId }
                      }).eq('id', row.id);
                      console.log(`  💾 Stored modelId=${m.modelId} in Building Storey "${row.name}"`);
                    }
                  }
                }
              } catch {}
            }
          }
          
          console.log(`Building ${buildingName}: ${modelsToSync.length} models to sync (from GetAllRelatedModels, ${allRevisions.length} total revisions)`);
          
          if (modelsToSync.length === 0) {
            console.log(`No models to sync for ${buildingName}, skipping`);
            currentBuildingIndex++;
            continue;
          }

          // apiKey already declared at top of sync-xkt action

          for (const rev of modelsToSync) {
            if (Date.now() - startTime > MAX_EXECUTION_TIME) {
              interrupted = true;
              break;
            }

            const revModelId = rev.modelId;
            const revisionId = rev.revisionId || '';
            const modelName = rev.modelName || rev.entityName || `Model ${revModelId}`;
            const fileName = `${revModelId}.xkt`;
            const storagePath = `${buildingFmGuid}/${fileName}`;

            // Check if already synced
            const { data: existingModel } = await supabase
              .from('xkt_models')
              .select('id, source_updated_at')
              .eq('building_fm_guid', buildingFmGuid)
              .eq('model_id', revModelId)
              .maybeSingle();

            const forceSync = body?.force === true;
            if (existingModel && !forceSync) {
              const storedRevision = existingModel.source_updated_at || '';
              // Only skip if BOTH revision values are non-empty and match
              if (revisionId && storedRevision && storedRevision === revisionId) {
                console.log(`Model ${revModelId} (${modelName}) unchanged (revision ${revisionId})`);
                continue;
              }
              // Missing revision info → always re-download to ensure freshness
              console.log(`Model ${revModelId} (${modelName}) revision mismatch or missing, re-downloading`);
            }

            try {
              // Build identifier fallback chain for XKT download
              const bimObjId = rev._bimObjectId || bimObjectIdMap.get(String(revModelId)) || '';
              const modelFmGuid = rev.fmGuid || rev.FmGuid || '';
              const externalGuid = rev.externalGuid || rev.ExternalGuid || '';
              
              // Try multiple identifier combinations
              let xktData: ArrayBuffer | null = null;
              let usedIdentifier = '';
              
              // Find matched revision for additional identifiers
              const matchedRev = allRevisions.find((r: any) => String(r.modelId || '') === String(revModelId));
              const revBimObjId = matchedRev?.bimObjectId || matchedRev?.BimObjectId || '';
              const revEntityId = matchedRev?.entityId || matchedRev?.EntityId || '';
              
              const idCombos: { param: string; value: string; label: string }[] = [
                { param: 'bimobjectid', value: bimObjId, label: 'bimobjectid(model)' },
                { param: 'bimobjectid', value: revBimObjId, label: 'bimobjectid(revision)' },
                { param: 'externalguid', value: externalGuid, label: 'externalguid(model)' },
                { param: 'bimobjectid', value: buildingParentBimObjId, label: 'bimobjectid(building.parent)' },
                { param: 'externalguid', value: modelFmGuid, label: 'externalguid(model.fmGuid)' },
                { param: 'bimobjectid', value: buildingFmGuid, label: 'bimobjectid(buildingFmGuid)' },
                { param: 'externalguid', value: buildingFmGuid, label: 'externalguid(buildingFmGuid)' },
                { param: 'bimobjectid', value: revEntityId, label: 'bimobjectid(revision.entityId)' },
              ];
              // Deduplicate by value
              const seen = new Set<string>();
              const dedupCombos = idCombos.filter(c => {
                if (!c.value) return false;
                const key = `${c.param}=${c.value}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              
              const availableIds = dedupCombos.map(c => c.label);
              console.log(`  ${modelName} (${revModelId}): trying ${availableIds.length} identifiers: ${availableIds.join(', ')}`);
              
              // Strategy 1: Try with modelid + secondary param combos
              for (const combo of dedupCombos) {
                const url = `${discovery.url}/GetXktData?modelid=${revModelId}&${combo.param}=${encodeURIComponent(combo.value)}&context=Building&apiKey=${apiKey}`;
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 30000);
                  const res = await fetch(url, {
                    headers: { "Authorization": `Bearer ${accessToken}` },
                    signal: controller.signal
                  });
                  clearTimeout(timeoutId);
                  if (res.ok) {
                    const data = await res.arrayBuffer();
                    if (data.byteLength >= 1024) {
                      xktData = data;
                      usedIdentifier = combo.label;
                      break;
                    }
                  }
                } catch {}
              }
              
              // Strategy 2: Try bimobjectid-only (no modelid param at all)
              if (!xktData) {
                const bimOnlyUrl = `${discovery.url}/GetXktData?bimobjectid=${bimObjId}&context=Building&apiKey=${apiKey}`;
                console.log(`  Strategy 2: bimobjectid-only → ${bimOnlyUrl}`);
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 15000);
                  const res = await fetch(bimOnlyUrl, {
                    headers: { "Authorization": `Bearer ${accessToken}` },
                    signal: controller.signal
                  });
                  clearTimeout(timeoutId);
                  console.log(`  Strategy 2 response: ${res.status}`);
                  if (res.ok) {
                    const data = await res.arrayBuffer();
                    if (data.byteLength >= 1024) {
                      xktData = data;
                      usedIdentifier = 'bimobjectid-only';
                    }
                  }
                } catch (e) { console.log(`  Strategy 2 error: ${e}`); }
              }
              
              // Strategy 3: Try modelid-only (no secondary identifier)
              if (!xktData) {
                const url = `${discovery.url}/GetXktData?modelid=${revModelId}&context=Building&apiKey=${apiKey}`;
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 15000);
                  const res = await fetch(url, {
                    headers: { "Authorization": `Bearer ${accessToken}` },
                    signal: controller.signal
                  });
                  clearTimeout(timeoutId);
                  if (res.ok) {
                    const data = await res.arrayBuffer();
                    if (data.byteLength >= 1024) {
                      xktData = data;
                      usedIdentifier = 'modelid-only';
                    }
                  }
                } catch {}
              }
              
              // Strategy 4: Try with bimobjectid as the modelid value
              if (!xktData) {
                const url = `${discovery.url}/GetXktData?modelid=${bimObjId}&bimobjectid=${bimObjId}&context=Building&apiKey=${apiKey}`;
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 15000);
                  const res = await fetch(url, {
                    headers: { "Authorization": `Bearer ${accessToken}` },
                    signal: controller.signal
                  });
                  clearTimeout(timeoutId);
                  if (res.ok) {
                    const data = await res.arrayBuffer();
                    if (data.byteLength >= 1024) {
                      xktData = data;
                      usedIdentifier = 'bimobjectid-as-modelid';
                    }
                  }
                } catch {}
              }

              if (!xktData) {
                console.log(`Failed to fetch ${modelName} (${revModelId}): all identifier combos returned 404`);
                errors.push(`${buildingName}/${revModelId}: 404 all combos`);
                continue;
              }

              const fileSize = xktData.byteLength;
              console.log(`Model ${revModelId} (${modelName}): Downloaded ${(fileSize / 1024 / 1024).toFixed(2)} MB via ${usedIdentifier}`);

              // Upload to storage with no-cache to prevent stale CDN delivery
              const { error: uploadError } = await supabase.storage
                .from('xkt-models')
                .upload(storagePath, new Uint8Array(xktData), {
                  contentType: 'application/octet-stream',
                  upsert: true,
                  cacheControl: '0',
                });

              let signedUrl: string | null = null;
              if (!uploadError) {
                const { data: urlData } = await supabase.storage
                  .from('xkt-models')
                  .createSignedUrl(storagePath, 86400 * 365);
                signedUrl = urlData?.signedUrl || null;
              } else {
                console.log(`Storage upload failed for ${revModelId}:`, uploadError.message);
              }

              // Insert into database
              const { error: dbError } = await supabase
                .from('xkt_models')
                .upsert({
                  building_fm_guid: buildingFmGuid,
                  building_name: buildingName,
                  model_id: revModelId,
                  model_name: modelName,
                  file_name: fileName,
                  file_url: signedUrl,
                  file_size: fileSize,
                  storage_path: storagePath,
                  source_url: `GetXktData via ${usedIdentifier}`,
                  source_updated_at: revisionId || new Date().toISOString(),
                  synced_at: new Date().toISOString(),
                }, { onConflict: 'building_fm_guid,model_id' });

              if (dbError) {
                console.log(`Database insert failed for ${revModelId}:`, dbError.message);
                errors.push(`${buildingName}/${revModelId}: DB error`);
                continue;
              }

              totalSynced++;
              console.log(`✅ Synced model ${revModelId} (${modelName}) for ${buildingName}`);
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              if (errMsg.includes('aborted')) {
                console.log(`Model ${modelId}: Fetch timeout, skipping`);
              } else {
                console.log(`Failed to sync model ${modelId}: ${errMsg}`);
              }
            }
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error(`Error syncing building ${buildingName}:`, errMsg);
          errors.push(`${buildingName}: ${errMsg}`);
        }

        if (!interrupted) {
          currentBuildingIndex++;
          
          // Save progress
          await supabase
            .from('asset_sync_progress')
            .upsert({
              job: 'xkt_models',
              building_fm_guid: currentBuildingIndex < totalBuildings ? buildings[currentBuildingIndex].fm_guid : null,
              current_building_index: currentBuildingIndex,
              skip: 0,
              total_buildings: totalBuildings,
              total_synced: totalSynced,
              updated_at: new Date().toISOString()
            }, { onConflict: 'job' });

          await updateSyncState(supabase, 'xkt', 'running', totalSynced, undefined, {
            subtree_name: `XKT-filer (${currentBuildingIndex}/${totalBuildings})`
          });
        }
      }

      if (!interrupted && currentBuildingIndex >= totalBuildings) {
        await supabase.from('asset_sync_progress').delete().eq('job', 'xkt_models');
        await updateSyncState(supabase, 'xkt', 'completed', totalSynced, 
          errors.length > 0 ? errors.slice(0, 5).join('; ') : undefined, {
          subtree_name: 'XKT-filer'
        });
      } else if (interrupted) {
        // Save progress for resume
        await supabase
          .from('asset_sync_progress')
          .upsert({
            job: 'xkt_models',
            building_fm_guid: currentBuildingIndex < totalBuildings ? buildings[currentBuildingIndex].fm_guid : null,
            current_building_index: currentBuildingIndex,
            skip: 0,
            total_buildings: totalBuildings,
            total_synced: totalSynced,
            updated_at: new Date().toISOString()
          }, { onConflict: 'job' });
      }

      console.log(`XKT sync ${interrupted ? 'paused' : 'completed'}: ${totalSynced} models`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: interrupted 
            ? `Synced ${totalSynced} models (${currentBuildingIndex}/${totalBuildings} buildings). Call again to continue.`
            : `Completed: ${totalSynced} models`,
          synced: totalSynced,
          interrupted,
          progress: {
            currentBuildingIndex,
            totalBuildings
          },
          errors: errors.length > 0 ? errors : undefined 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC XKT FOR SINGLE BUILDING (on-demand) ============
    if (action === 'sync-xkt-building') {
      if (!buildingFmGuid) {
        return new Response(
          JSON.stringify({ success: false, error: 'buildingFmGuid is required' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const accessToken = await getAccessToken();
      const apiUrl = _creds.apiUrl || Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = _creds.apiKey || Deno.env.get("ASSET_PLUS_API_KEY") || "";
      
      console.log(`Starting sync-xkt-building for: ${buildingFmGuid}`);

      // Get building name AND attributes (for parentBimObjectId fallback)
      const { data: building } = await supabase
        .from('assets')
        .select('common_name, attributes')
        .eq('fm_guid', buildingFmGuid)
        .eq('category', 'Building')
        .maybeSingle();

      const buildingName = building?.common_name || buildingFmGuid;
      const buildingAttrs = typeof building?.attributes === 'string'
        ? JSON.parse(building.attributes)
        : (building?.attributes || {});
      const buildingParentBimObjectId = buildingAttrs.parentBimObjectId || buildingAttrs.buildingBimObjectId || '';

      try {
        // Use robust endpoint discovery
        const discovery = await discover3dModelsEndpoint(supabase, accessToken, apiUrl, apiKey, buildingFmGuid);
        
        if (!discovery.url) {
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: '3D API ej tillgänglig från servern. Modeller cachas automatiskt när du öppnar 3D-viewern.',
              hint: 'cache-on-load',
              modelCount: 0,
              synced: 0
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const models = discovery.models || [];
        
        if (models.length === 0) {
          return new Response(
            JSON.stringify({ success: true, message: 'No models found', modelCount: 0, synced: 0 }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`Building ${buildingName}: Found ${models.length} models`);
        let synced = 0;
        const modelErrors: string[] = [];

        // Fetch revisions for update detection
        let revisions: any[] = [];
        try {
          const revUrl = `${discovery.url}/GetAllModelRevisions`;
          const revRes = await fetch(revUrl, { headers: { "Authorization": `Bearer ${accessToken}` } });
          if (revRes.ok) {
            const revData = await revRes.json();
            revisions = revData?.modelRevisions || (Array.isArray(revData) ? revData : []);
            console.log(`Loaded ${revisions.length} revisions for update detection`);
          }
        } catch (e) { console.log(`GetAllModelRevisions error: ${e}`); }

        // Build revision lookup: modelId → revisionId
        const revisionMap = new Map<string, string>();
        for (const rev of revisions) {
          if (rev.modelId) revisionMap.set(String(rev.modelId), rev.revisionId || '');
        }

        // Helper: try fetching XKT with multiple identifier combinations
        async function tryFetchXkt(
          baseUrl: string,
          modelId: string,
          identifiers: { param: string; value: string; label: string }[],
          token: string,
          key: string
        ): Promise<{ data: ArrayBuffer; usedIdentifier: string } | null> {
          for (const id of identifiers) {
            if (!id.value) continue;
            const url = `${baseUrl}/GetXktData?modelid=${modelId}&${id.param}=${encodeURIComponent(id.value)}&context=Building&apiKey=${key}`;
            console.log(`Trying XKT: ${id.label} → ${url.replace(/apiKey=[^&]+/, 'apiKey=***')}`);
            try {
              const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
              if (res.ok) {
                const data = await res.arrayBuffer();
                if (data.byteLength >= 1024) {
                  console.log(`✓ XKT download succeeded with ${id.label} (${(data.byteLength / 1024 / 1024).toFixed(2)} MB)`);
                  return { data, usedIdentifier: id.label };
                }
                console.log(`XKT too small with ${id.label} (${data.byteLength} bytes), trying next`);
              } else {
                console.log(`XKT ${res.status} with ${id.label}, trying next`);
              }
            } catch (e) {
              console.log(`XKT fetch error with ${id.label}: ${e}`);
            }
          }
          return null;
        }

        for (const model of models) {
          const rawModelId = model.modelId || model.id || model.ModelId || '';
          const modelName = model.name || model.modelName || model.Name || `Model`;
          const matchedRevisionId = revisions.find((rev: any) => {
            const revName = String(rev.modelName || '').toLowerCase();
            const modelNameLower = String(modelName).toLowerCase();
            return (rawModelId && String(rev.modelId || '') === String(rawModelId)) || (!!revName && !!modelNameLower && (revName === modelNameLower || revName.includes(modelNameLower) || modelNameLower.includes(revName)));
          })?.modelId || '';
          const modelId = rawModelId || matchedRevisionId || `model_${Date.now()}`;
          const bimObjectId = model.bimObjectId || model.BimObjectId || '';
          const modelFmGuid = model.fmGuid || model.FmGuid || '';
          const externalGuid = model.externalGuid || model.ExternalGuid || '';
          const fileName = `${modelId}.xkt`;
          const storagePath = `${buildingFmGuid}/${fileName}`;

          // Revision-based update detection
          const forceSync = body?.force === true;
          const revisionId = revisionMap.get(String(modelId)) || '';
          const { data: existingModel } = await supabase
            .from('xkt_models')
            .select('id, source_updated_at')
            .eq('building_fm_guid', buildingFmGuid)
            .eq('model_id', modelId)
            .maybeSingle();

          if (existingModel && !forceSync) {
            const storedRevision = existingModel.source_updated_at || '';
            if (revisionId && storedRevision === revisionId) {
              console.log(`Model ${modelId} (${modelName}) unchanged (revision ${revisionId})`);
              continue;
            }
            console.log(`Model ${modelId} (${modelName}) has new revision, re-downloading`);
          }

          try {
            // Build identifier fallback chain
            const identifiers = [
              { param: 'bimobjectid', value: bimObjectId, label: `bimobjectid=${bimObjectId.substring(0,8)}` },
              { param: 'externalguid', value: externalGuid, label: `externalguid(model)=${externalGuid.substring(0,8)}` },
              { param: 'bimobjectid', value: buildingParentBimObjectId, label: `bimobjectid(building.parentBimObjectId)=${buildingParentBimObjectId.substring(0,8)}` },
              { param: 'externalguid', value: modelFmGuid, label: `externalguid(model.fmGuid)=${modelFmGuid.substring(0,8)}` },
              { param: 'externalguid', value: buildingFmGuid, label: `externalguid(buildingFmGuid)=${buildingFmGuid.substring(0,8)}` },
            ];

            const result = await tryFetchXkt(discovery.url!, modelId, identifiers, accessToken, apiKey);

            if (!result) {
              const errMsg = `Model ${modelId} (${modelName}): All identifier combinations returned 404`;
              console.log(errMsg);
              modelErrors.push(errMsg);
              continue;
            }

            const xktData = result.data;
            const fileSize = xktData.byteLength;
            console.log(`Model ${modelId} (${modelName}): Downloaded ${(fileSize / 1024 / 1024).toFixed(2)} MB via ${result.usedIdentifier}`);

            // Upload to storage with no-cache
            const { error: uploadError } = await supabase.storage
              .from('xkt-models')
              .upload(storagePath, new Uint8Array(xktData), {
                contentType: 'application/octet-stream',
                upsert: true,
                cacheControl: '0',
              });

            let signedUrl: string | null = null;
            if (!uploadError) {
              const { data: urlData } = await supabase.storage
                .from('xkt-models')
                .createSignedUrl(storagePath, 86400 * 365);
              signedUrl = urlData?.signedUrl || null;
            }

            // Insert into database with revision tracking
            await supabase
              .from('xkt_models')
              .upsert({
                building_fm_guid: buildingFmGuid,
                building_name: buildingName,
                model_id: modelId,
                model_name: modelName,
                file_name: fileName,
                file_url: signedUrl,
                file_size: fileSize,
                storage_path: storagePath,
                source_url: `GetXktData via ${result.usedIdentifier}`,
                source_updated_at: revisionId || new Date().toISOString(),
                synced_at: new Date().toISOString(),
              }, { onConflict: 'building_fm_guid,model_id' });

            synced++;
            console.log(`✅ Synced model ${modelId} for ${buildingName}`);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.log(`Failed to sync model ${modelId}: ${errMsg}`);
            modelErrors.push(`${modelId}: ${errMsg}`);
          }
        }

        const allFailed = synced === 0 && modelErrors.length > 0;
        return new Response(
          JSON.stringify({
            success: !allFailed,
            message: allFailed
              ? `Failed to download any models. ${modelErrors.length} errors.`
              : `Synced ${synced} models`,
            synced,
            buildingFmGuid,
            errors: modelErrors.length > 0 ? modelErrors : undefined,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        return new Response(
          JSON.stringify({ success: false, error: errMsg, synced: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ============ CHECK DELTA (compare local vs remote) ============
    if (action === 'check-delta') {
      console.log('Starting check-delta');
      const accessToken = await getAccessToken();
      
      // Get remote total count (structure + instances)
      const remoteStructureCount = await getRemoteCountByTypes(accessToken, [1, 2, 3]);
      const remoteInstanceCount = await getRemoteCountByTypes(accessToken, [4]);
      const remoteTotalCount = remoteStructureCount + remoteInstanceCount;
      
      // Get remote building GUIDs to identify which buildings are in Asset+
      const remoteBuildingGuids = new Set<string>();
      let skip = 0;
      const take = 200;
      let hasMore = true;
      while (hasMore) {
        const result = await fetchAssetPlusObjects(accessToken, [["objectType", "=", 1]], skip, take);
        result.data.forEach((item: any) => remoteBuildingGuids.add(item.fmGuid));
        hasMore = result.hasMore;
        skip += take;
      }
      console.log(`Remote building GUIDs for scope check: ${remoteBuildingGuids.size}`);
      
      // Get local structure counts - include BOTH is_local=false AND is_local=true
      // We want to count ALL local objects that belong to Asset+ buildings
      const syncedStructure = await fetchAllLocalFmGuids(supabase, ['Building', 'Building Storey', 'Space'], false, true);
      const localStructure = await fetchAllLocalFmGuids(supabase, ['Building', 'Building Storey', 'Space'], true, true);
      const allStructureItems = [...syncedStructure, ...localStructure];
      
      // Also count instances
      const syncedInstances = await fetchAllLocalFmGuids(supabase, ['Instance'], false, true);
      const localInstances = await fetchAllLocalFmGuids(supabase, ['Instance'], true, true);
      const allInstanceItems = [...syncedInstances, ...localInstances];
      
      const allLocalItems = [...allStructureItems, ...allInstanceItems];
      
      // Filter out objects belonging to buildings not in Asset+ (IFC-only buildings)
      const scopedLocalItems = allLocalItems.filter(item => {
        if (item.building_fm_guid && !remoteBuildingGuids.has(item.building_fm_guid)) {
          return false;
        }
        // Building-level objects: must themselves be a remote building
        if (!item.building_fm_guid && !remoteBuildingGuids.has(item.fm_guid)) {
          return false;
        }
        return true;
      });
      
      const localScopedCount = scopedLocalItems.length;
      const ifcOnlyCount = allLocalItems.length - localScopedCount;
      
      const discrepancy = localScopedCount - remoteTotalCount;
      const hasOrphans = discrepancy > 0;
      const hasMissing = discrepancy < 0;
      
      console.log(`check-delta: local=${localScopedCount} (excl ${ifcOnlyCount} IFC-only), remote=${remoteTotalCount}, diff=${discrepancy}`);
      
      return new Response(
        JSON.stringify({
          success: true,
          localCount: localScopedCount,
          remoteCount: remoteTotalCount,
          orphanCount: hasOrphans ? Math.abs(discrepancy) : 0,
          newCount: hasMissing ? Math.abs(discrepancy) : 0,
          inSync: discrepancy === 0,
          discrepancy,
          ifcOnlyExcluded: ifcOnlyCount,
          canPush: hasOrphans,
          message: discrepancy === 0 
            ? 'Data är synkroniserad' 
            : hasOrphans 
              ? `${Math.abs(discrepancy)} objekt finns lokalt men inte i Asset+`
              : `${Math.abs(discrepancy)} objekt saknas lokalt`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC WITH CLEANUP (bidirectional: pull remote + push local) ============
    if (action === 'sync-with-cleanup') {
      console.log('Starting sync-with-cleanup (bidirectional)');
      const accessToken = await getAccessToken();
      const apiUrl = _creds.apiUrl || Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = _creds.apiKey || Deno.env.get("ASSET_PLUS_API_KEY") || "";
      const baseUrl = apiUrl.replace(/\/+$/, "");
      
      await updateSyncState(supabase, 'structure', 'running', undefined, undefined, {
        subtree_name: 'Byggnad/Plan/Rum (tvåvägs-synk)'
      });
      
      // ── Step 1: Pull all remote objects (structure + instances) ──
      const remoteFmGuids = new Set<string>();
      const remoteBuildingGuids = new Set<string>();
      let totalSynced = 0;
      
      for (const objectType of [1, 2, 3, 4]) {
        let skip = 0;
        const take = 200;
        let hasMore = true;
        
        while (hasMore) {
          const result = await fetchAssetPlusObjects(accessToken, [["objectType", "=", objectType]], skip, take);
          
          result.data.forEach((item: any) => {
            remoteFmGuids.add(item.fmGuid);
            if (objectType === 1) remoteBuildingGuids.add(item.fmGuid);
          });
          
          // Upsert structure objects locally (types 1-3)
          if (objectType <= 3 && result.data.length > 0) {
            const synced = await upsertAssets(supabase, result.data);
            totalSynced += synced;
          }
          
          hasMore = result.hasMore;
          skip += take;
        }
        
        console.log(`Fetched remote objectType ${objectType}: ${objectType === 1 ? remoteBuildingGuids.size : '...'} items`);
      }
      
      console.log(`Total remote fmGuids: ${remoteFmGuids.size} (${remoteBuildingGuids.size} buildings), synced ${totalSynced} structure`);
      await updateSyncState(supabase, 'structure', 'running', totalSynced);
      
      // ── Step 2: Remove orphans (local objects not in remote, within Asset+ scope) ──
      const localSyncedItems = await fetchAllLocalFmGuids(supabase, ['Building', 'Building Storey', 'Space'], false, true);
      
      const orphanFmGuids = localSyncedItems
        .filter(item => {
          if (item.building_fm_guid && !remoteFmGuids.has(item.building_fm_guid)) return false;
          return !remoteFmGuids.has(item.fm_guid);
        })
        .map(item => item.fm_guid);
      
      console.log(`Found ${orphanFmGuids.length} orphan objects to remove`);
      
      let removedCount = 0;
      const batchSize = 100;
      for (let i = 0; i < orphanFmGuids.length; i += batchSize) {
        const batch = orphanFmGuids.slice(i, i + batchSize);
        const { error: deleteError } = await supabase
          .from('assets')
          .delete()
          .in('fm_guid', batch);
        if (deleteError) {
          console.error(`Error deleting orphans batch:`, deleteError);
        } else {
          removedCount += batch.length;
        }
      }
      
      // ── Step 3: Push local objects missing from Asset+ ──
      // Collect ALL local objects (both is_local true and false) in Asset+ building scope
      const categoriesToPush = ['Building Storey', 'Space', 'Instance'];
      const allLocalObjects: any[] = [];
      
      for (const category of categoriesToPush) {
        for (const isLocal of [false, true]) {
          const PAGE = 1000;
          let from = 0;
          let done = false;
          while (!done) {
            const { data, error } = await supabase
              .from('assets')
              .select('fm_guid, building_fm_guid, level_fm_guid, in_room_fm_guid, category, name, common_name, is_local')
              .eq('category', category)
              .eq('is_local', isLocal)
              .range(from, from + PAGE - 1);
            if (error) throw error;
            if (data && data.length > 0) {
              allLocalObjects.push(...data);
              from += PAGE;
              if (data.length < PAGE) done = true;
            } else {
              done = true;
            }
          }
        }
      }
      
      // Filter to objects in Asset+ buildings, not already in remote, exclude ACC-prefixed
      const missingObjects = allLocalObjects.filter(obj => {
        if (isNonAssetPlusGuid(obj.fm_guid)) return false;
        if (remoteFmGuids.has(obj.fm_guid)) return false;
        if (obj.building_fm_guid && !remoteBuildingGuids.has(obj.building_fm_guid)) return false;
        return true;
      });
      
      console.log(`Found ${missingObjects.length} local objects to push to Asset+`);
      
      // Sort by hierarchy: Storey → Space → Instance
      const categoryOrder: Record<string, number> = { 'Building Storey': 1, 'Space': 2, 'Instance': 3 };
      const categoryToObjectType: Record<string, number> = { 'Building Storey': 2, 'Space': 3, 'Instance': 4 };
      missingObjects.sort((a, b) => (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99));
      
      let pushedCount = 0;
      let pushFailedCount = 0;
      const pushErrors: Array<{ fmGuid: string; error: string }> = [];
      
      for (const obj of missingObjects) {
        try {
          const objectType = categoryToObjectType[obj.category] || 4;
          
          let parentFmGuid: string | null = null;
          if (objectType === 2) parentFmGuid = obj.building_fm_guid;
          else if (objectType === 3) parentFmGuid = obj.level_fm_guid || obj.building_fm_guid;
          else if (objectType === 4) parentFmGuid = obj.in_room_fm_guid || obj.building_fm_guid;
          
          if (!parentFmGuid) {
            pushFailedCount++;
            pushErrors.push({ fmGuid: obj.fm_guid, error: 'No parent found' });
            continue;
          }
          
          const payload = {
            BimObjectWithParents: [{
              BimObject: {
                ObjectType: objectType,
                Designation: obj.name || obj.common_name || 'Unknown',
                CommonName: obj.common_name || obj.name || 'Unknown',
                ExternalType: obj.common_name || obj.name || 'Unknown',
                APIKey: apiKey,
                FmGuid: obj.fm_guid,
                UsedIdentifier: 1,
              },
              ParentFmGuid: parentFmGuid,
              UsedIdentifier: 1,
            }],
          };
          
          const response = await fetch(`${baseUrl}/AddObjectList`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
          });
          
          if (response.ok) {
            await supabase
              .from('assets')
              .update({ is_local: false, synced_at: new Date().toISOString() })
              .eq('fm_guid', obj.fm_guid);
            pushedCount++;
            console.log(`✅ Pushed ${obj.category} ${obj.fm_guid} to Asset+`);
          } else {
            const errorText = await response.text();
            pushFailedCount++;
            pushErrors.push({ fmGuid: obj.fm_guid, error: errorText || `HTTP ${response.status}` });
          }
        } catch (err) {
          pushFailedCount++;
          pushErrors.push({ fmGuid: obj.fm_guid, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }
      
      await updateSyncState(supabase, 'structure', 'completed', totalSynced);
      
      const messageParts: string[] = [];
      if (totalSynced > 0) messageParts.push(`synkade ${totalSynced} objekt`);
      if (removedCount > 0) messageParts.push(`tog bort ${removedCount} föräldralösa`);
      if (pushedCount > 0) messageParts.push(`skapade ${pushedCount} i Asset+`);
      if (pushFailedCount > 0) messageParts.push(`${pushFailedCount} push misslyckades`);
      if (messageParts.length === 0) messageParts.push('allt redan synkroniserat');
      
      return new Response(
        JSON.stringify({
          success: true,
          message: messageParts.join(', ').replace(/^./, c => c.toUpperCase()),
          totalSynced,
          orphansRemoved: removedCount,
          pushed: pushedCount,
          pushFailed: pushFailedCount,
          pushErrors: pushErrors.slice(0, 20),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ PUSH LOCAL TO REMOTE ============
    if (action === 'push-local-to-remote') {
      console.log('Starting push-local-to-remote');
      
      // Fetch all local-only assets that have a parent room
      const { data: localAssets, error: localError } = await supabase
        .from('assets')
        .select('*')
        .eq('is_local', true)
        .eq('category', 'Instance')
        .not('in_room_fm_guid', 'is', null);
      
      if (localError) {
        return new Response(
          JSON.stringify({ success: false, error: localError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (!localAssets || localAssets.length === 0) {
        return new Response(
          JSON.stringify({ success: true, pushed: 0, failed: 0, errors: [], message: 'No local assets to push' }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      console.log(`Found ${localAssets.length} local assets to push`);
      
      const accessToken = await getAccessToken();
      const apiUrl = _creds.apiUrl || Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = _creds.apiKey || Deno.env.get("ASSET_PLUS_API_KEY") || "";
      const baseUrl = apiUrl.replace(/\/+$/, "");
      
      let pushed = 0;
      let failed = 0;
      const errors: Array<{ fmGuid: string; error: string }> = [];
      
      // Process in batches of 10
      const BATCH_SIZE = 10;
      for (let i = 0; i < localAssets.length; i += BATCH_SIZE) {
        const batch = localAssets.slice(i, i + BATCH_SIZE);
        
        for (const asset of batch) {
          try {
            // Build AddObject payload
            const bimObject: any = {
              apiKey,
              objectType: 4, // Instance
              designation: asset.name || 'Unknown',
              inRoomFmGuid: asset.in_room_fm_guid,
            };
            
            if (asset.fm_guid) bimObject.fmGuid = asset.fm_guid;
            if (asset.common_name) bimObject.commonName = asset.common_name;
            
            const response = await fetch(`${baseUrl}/AddObject`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
              },
              body: JSON.stringify(bimObject),
            });
            
            const responseText = await response.text();
            
            if (response.ok) {
              // Mark as synced
              await supabase
                .from('assets')
                .update({
                  is_local: false,
                  synced_at: new Date().toISOString(),
                })
                .eq('fm_guid', asset.fm_guid);
              
              pushed++;
              console.log(`Pushed ${asset.fm_guid} to Asset+`);
            } else {
              failed++;
              errors.push({ fmGuid: asset.fm_guid, error: responseText || `HTTP ${response.status}` });
            }
          } catch (err) {
            failed++;
            errors.push({ 
              fmGuid: asset.fm_guid, 
              error: err instanceof Error ? err.message : 'Unknown error' 
            });
          }
        }
      }
      
      return new Response(
        JSON.stringify({
          success: failed === 0,
          pushed,
          failed,
          errors,
          message: `Pushed ${pushed} assets, ${failed} failed`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ PUSH MISSING TO ASSET+ (IFC/ACC/local objects not yet in Asset+) ============
    if (action === 'push-missing-to-assetplus') {
      console.log('Starting push-missing-to-assetplus');
      const accessToken = await getAccessToken();
      const apiUrl = _creds.apiUrl || Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = _creds.apiKey || Deno.env.get("ASSET_PLUS_API_KEY") || "";
      const baseUrl = apiUrl.replace(/\/+$/, "");

      // Step 1: Fetch ALL remote fmGuids (structure + instances)
      const remoteFmGuids = new Set<string>();
      const remoteBuildingGuids = new Set<string>();
      
      // Fetch all remote objects (types 1-4)
      for (const objectType of [1, 2, 3, 4]) {
        let skip = 0;
        const take = 200;
        let hasMore = true;
        while (hasMore) {
          const result = await fetchAssetPlusObjects(accessToken, [["objectType", "=", objectType]], skip, take);
          result.data.forEach((item: any) => {
            remoteFmGuids.add(item.fmGuid);
            if (objectType === 1) remoteBuildingGuids.add(item.fmGuid);
          });
          hasMore = result.hasMore;
          skip += take;
        }
      }
      console.log(`Remote: ${remoteFmGuids.size} total objects, ${remoteBuildingGuids.size} buildings`);

      // Step 2: Find local objects not in remote, scoped to Asset+ buildings
      // Include both is_local=true and is_local=false (IFC/ACC created)
      const categories = ['Building Storey', 'Space', 'Instance'];
      const allLocalObjects: any[] = [];
      
      // Only query objects belonging to known Asset+ buildings to avoid huge scans
      const buildingGuidsArr = [...remoteBuildingGuids];
      for (const bGuid of buildingGuidsArr) {
        for (const category of categories) {
          const PAGE = 500;
          let from = 0;
          let done = false;
          while (!done) {
            const { data, error } = await supabase
              .from('assets')
              .select('fm_guid, building_fm_guid, level_fm_guid, in_room_fm_guid, category, name, common_name, is_local')
              .eq('category', category)
              .eq('building_fm_guid', bGuid)
              .range(from, from + PAGE - 1);
            if (error) throw error;
            if (data && data.length > 0) {
              allLocalObjects.push(...data);
              from += PAGE;
              if (data.length < PAGE) done = true;
            } else {
              done = true;
            }
          }
        }
      }

      // Filter: only objects in Asset+ buildings, not already in remote, exclude ACC-prefixed
      const missingObjects = allLocalObjects.filter(obj => {
        if (isNonAssetPlusGuid(obj.fm_guid)) return false;
        if (remoteFmGuids.has(obj.fm_guid)) return false;
        // Must belong to an Asset+ building
        if (obj.building_fm_guid && !remoteBuildingGuids.has(obj.building_fm_guid)) return false;
        return true;
      });

      console.log(`Found ${missingObjects.length} local objects missing from Asset+`);

      if (missingObjects.length === 0) {
        return new Response(
          JSON.stringify({ success: true, pushed: 0, failed: 0, message: 'Alla objekt finns redan i Asset+' }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Step 3: Push to Asset+ using AddObjectList, sorted by hierarchy
      // Process structure first (Storey → Space), then Instances
      const categoryOrder: Record<string, number> = { 'Building Storey': 1, 'Space': 2, 'Instance': 3 };
      const categoryToObjectType: Record<string, number> = { 'Building Storey': 2, 'Space': 3, 'Instance': 4 };
      missingObjects.sort((a, b) => (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99));

      let pushed = 0;
      let failed = 0;
      const errors: Array<{ fmGuid: string; error: string }> = [];

      for (const obj of missingObjects) {
        try {
          const objectType = categoryToObjectType[obj.category] || 4;
          
          // Determine parent
          let parentFmGuid: string | null = null;
          if (objectType === 2) {
            // Building Storey → parent is the building
            parentFmGuid = obj.building_fm_guid;
          } else if (objectType === 3) {
            // Space → parent is level, fallback to building
            parentFmGuid = obj.level_fm_guid || obj.building_fm_guid;
          } else if (objectType === 4) {
            // Instance → parent is room, fallback to building
            parentFmGuid = obj.in_room_fm_guid || obj.building_fm_guid;
          }

          if (!parentFmGuid) {
            console.warn(`Skipping ${obj.fm_guid} — no parent found`);
            failed++;
            errors.push({ fmGuid: obj.fm_guid, error: 'No parent found' });
            continue;
          }

          const payload = {
            BimObjectWithParents: [{
              BimObject: {
                ObjectType: objectType,
                Designation: obj.name || obj.common_name || 'Unknown',
                CommonName: obj.common_name || obj.name || 'Unknown',
                ExternalType: obj.common_name || obj.name || 'Unknown',
                APIKey: apiKey,
                FmGuid: obj.fm_guid,
                UsedIdentifier: 1,
              },
              ParentFmGuid: parentFmGuid,
              UsedIdentifier: 1,
            }],
          };

          const response = await fetch(`${baseUrl}/AddObjectList`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            // Mark as synced
            await supabase
              .from('assets')
              .update({
                is_local: false,
                synced_at: new Date().toISOString(),
              })
              .eq('fm_guid', obj.fm_guid);
            
            pushed++;
            console.log(`✅ Pushed ${obj.category} ${obj.fm_guid} (${obj.name}) to Asset+`);
          } else {
            const errorText = await response.text();
            failed++;
            errors.push({ fmGuid: obj.fm_guid, error: errorText || `HTTP ${response.status}` });
            console.warn(`❌ Failed to push ${obj.fm_guid}: ${response.status}`);
          }
        } catch (err) {
          failed++;
          errors.push({ 
            fmGuid: obj.fm_guid, 
            error: err instanceof Error ? err.message : 'Unknown error' 
          });
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          pushed,
          failed,
          total: missingObjects.length,
          errors: errors.slice(0, 20), // Limit error details
          message: `Skapade ${pushed} objekt i Asset+${failed > 0 ? `, ${failed} misslyckades` : ''}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC SYSTEMS (extract system data from existing assets) ============
    if (action === 'sync-systems') {
      const MAX_EXECUTION_TIME = 45000;
      const startTime = Date.now();
      
      console.log('Starting sync-systems: extracting system data from Asset+ properties');

      // Get buildings to process (optionally filter to single building)
      let buildingsQuery = supabase
        .from('assets')
        .select('fm_guid, common_name')
        .eq('category', 'Building')
        .order('common_name');
      
      if (buildingFmGuid) {
        buildingsQuery = buildingsQuery.eq('fm_guid', buildingFmGuid);
      }

      const { data: buildings, error: buildingsError } = await buildingsQuery;
      if (buildingsError) throw buildingsError;
      if (!buildings || buildings.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'No buildings found.' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Load progress cursor
      const { data: progress } = await supabase
        .from('asset_sync_progress')
        .select('*')
        .eq('job', 'systems')
        .maybeSingle();

      let currentBuildingIndex = progress?.current_building_index || 0;
      let totalSystemsCreated = progress?.total_synced || 0;
      let totalLinksCreated = 0;
      const totalBuildings = buildings.length;
      let interrupted = false;

      // Helper: infer discipline from system name
      const inferDiscipline = (name: string): string => {
        const n = name.toLowerCase();
        if (/\b(lb|lk|lt|la|le|luft|ventil|air|ahu|fläkt|fan|don|tilluft|frånluft|supply|exhaust|duct|kanal)/i.test(n)) return 'Ventilation';
        if (/\b(vs|vv|kv|radiator|värme|heat|fjärrvärme|pump|shunt)/i.test(n)) return 'Heating';
        if (/\b(kyl|cool|chiller|kk)/i.test(n)) return 'Cooling';
        if (/\b(el|kraft|power|belysning|light|ström|ups|central)/i.test(n)) return 'Electrical';
        if (/\b(va|avlopp|vatten|water|plumb|sanitet|tappvatten|spillvatten|dagvatten)/i.test(n)) return 'Plumbing';
        if (/\b(brand|fire|sprinkler|smoke|rök|detektor)/i.test(n)) return 'FireProtection';
        if (/\b(styr|ddc|plc|bus|bacnet|modbus|sensor)/i.test(n)) return 'Automation';
        return 'Other';
      };

      // System name property keys to look for in Asset+ attributes
      const SYSTEM_PROPERTY_KEYS = [
        'systemName', 'SystemName', 'System Name', 'system_name', 'systemnamn', 'Systemnamn',
        'System Classification', 'systemClassification',
        'System Abbreviation', 'systemAbbreviation',
        'System Type', 'systemType', 'systemtyp', 'Systemtyp',
      ];

      while (currentBuildingIndex < totalBuildings && !interrupted) {
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          interrupted = true;
          break;
        }

        const building = buildings[currentBuildingIndex];
        const bFmGuid = building.fm_guid;
        const bName = building.common_name || bFmGuid;
        console.log(`Processing systems for building ${currentBuildingIndex + 1}/${totalBuildings}: ${bName}`);

        // Fetch all Instance assets for this building from local DB (they already have attributes from sync)
        const instances: any[] = [];
        let from = 0;
        const PAGE = 200;
        let fetchDone = false;
        while (!fetchDone) {
          const { data, error } = await supabase
            .from('assets')
            .select('fm_guid, common_name, name, asset_type, attributes, in_room_fm_guid, level_fm_guid')
            .eq('building_fm_guid', bFmGuid)
            .eq('category', 'Instance')
            .order('fm_guid')
            .range(from, from + PAGE - 1);
          if (error) {
            console.error(`  DB error fetching instances page ${from}: ${error.message}`);
            throw error;
          }
          if (data && data.length > 0) {
            instances.push(...data);
            from += PAGE;
            if (data.length < PAGE) fetchDone = true;
          } else {
            fetchDone = true;
          }
        }

        console.log(`  Found ${instances.length} instances for ${bName}`);

        // Extract system names from attributes
        const systemMap = new Map<string, { name: string; type: string; discipline: string; assetFmGuids: string[] }>();

        for (const inst of instances) {
          const attrs = inst.attributes || {};
          let systemName: string | null = null;
          let systemType: string | null = null;

          // Check top-level attribute keys
          for (const key of SYSTEM_PROPERTY_KEYS) {
            const val = attrs[key];
            if (val && typeof val === 'string' && val.trim()) {
              if (key.toLowerCase().includes('type') || key.toLowerCase().includes('typ')) {
                systemType = val.trim();
              } else {
                systemName = val.trim();
              }
            }
          }

          // Also check nested property sets (some Asset+ data has properties inside sub-objects)
          if (!systemName && attrs.properties && typeof attrs.properties === 'object') {
            for (const [pKey, pVal] of Object.entries(attrs.properties as Record<string, any>)) {
              const lk = pKey.toLowerCase();
              if ((lk.includes('system') && lk.includes('name')) || lk === 'systemnamn') {
                if (typeof pVal === 'string' && pVal.trim()) {
                  systemName = pVal.trim();
                }
              }
            }
          }

          if (!systemName) continue;

          if (!systemMap.has(systemName)) {
            systemMap.set(systemName, {
              name: systemName,
              type: systemType || 'Unknown',
              discipline: inferDiscipline(systemName),
              assetFmGuids: [],
            });
          }
          systemMap.get(systemName)!.assetFmGuids.push(inst.fm_guid);
        }

        console.log(`  Found ${systemMap.size} systems in ${bName}`);

        // Upsert systems and create asset_system links
        for (const [sysName, sysData] of systemMap) {
          if (Date.now() - startTime > MAX_EXECUTION_TIME) {
            interrupted = true;
            break;
          }

          // Generate a stable fm_guid for the system based on building + name
          const systemFmGuid = `sys-${bFmGuid}-${sysName}`.substring(0, 200);

          // Upsert system
          const { data: existingSystem } = await supabase
            .from('systems')
            .select('id')
            .eq('fm_guid', systemFmGuid)
            .maybeSingle();

          let systemId: string;
          if (existingSystem) {
            systemId = existingSystem.id;
            // Update
            await supabase
              .from('systems')
              .update({
                name: sysData.name,
                system_type: sysData.type,
                discipline: sysData.discipline,
                source: 'asset_plus',
                building_fm_guid: bFmGuid,
                updated_at: new Date().toISOString(),
              })
              .eq('id', systemId);
          } else {
            const { data: newSystem, error: insertError } = await supabase
              .from('systems')
              .insert({
                fm_guid: systemFmGuid,
                name: sysData.name,
                system_type: sysData.type,
                discipline: sysData.discipline,
                source: 'asset_plus',
                building_fm_guid: bFmGuid,
              })
              .select('id')
              .single();

            if (insertError) {
              console.error(`  Failed to create system ${sysName}:`, insertError.message);
              continue;
            }
            systemId = newSystem.id;
            totalSystemsCreated++;
          }

          // Batch upsert asset_system links
          const links = sysData.assetFmGuids.map(fmGuid => ({
            asset_fm_guid: fmGuid,
            system_id: systemId,
          }));

          // Process in batches of 100
          for (let i = 0; i < links.length; i += 100) {
            const batch = links.slice(i, i + 100);
            const { error: linkError } = await supabase
              .from('asset_system')
              .upsert(batch, { onConflict: 'asset_fm_guid,system_id' });
            if (linkError) {
              console.error(`  Failed to link assets to system ${sysName}:`, linkError.message);
            } else {
              totalLinksCreated += batch.length;
            }
          }
        }

        // Also store asset_external_ids for all instances in this building
        const extIdBatches: any[] = [];
        for (const inst of instances) {
          extIdBatches.push({
            fm_guid: inst.fm_guid,
            source: 'asset_plus',
            external_id: inst.fm_guid, // Asset+ uses fmGuid as its own external ID
            last_seen_at: new Date().toISOString(),
          });
        }

        // Upsert external IDs in batches
        for (let i = 0; i < extIdBatches.length; i += 200) {
          const batch = extIdBatches.slice(i, i + 200);
          await supabase
            .from('asset_external_ids')
            .upsert(batch, { onConflict: 'fm_guid,source' });
        }

        if (!interrupted) {
          currentBuildingIndex++;
          // Save progress
          await supabase
            .from('asset_sync_progress')
            .upsert({
              job: 'systems',
              building_fm_guid: currentBuildingIndex < totalBuildings ? buildings[currentBuildingIndex].fm_guid : null,
              current_building_index: currentBuildingIndex,
              skip: 0,
              total_buildings: totalBuildings,
              total_synced: totalSystemsCreated,
              last_error: null,
              updated_at: new Date().toISOString()
            }, { onConflict: 'job' });
        }
      }

      if (!interrupted && currentBuildingIndex >= totalBuildings) {
        await supabase.from('asset_sync_progress').delete().eq('job', 'systems');
      } else if (interrupted) {
        await supabase
          .from('asset_sync_progress')
          .upsert({
            job: 'systems',
            building_fm_guid: currentBuildingIndex < totalBuildings ? buildings[currentBuildingIndex].fm_guid : null,
            current_building_index: currentBuildingIndex,
            skip: 0,
            total_buildings: totalBuildings,
            total_synced: totalSystemsCreated,
            updated_at: new Date().toISOString()
          }, { onConflict: 'job' });
      }

      console.log(`Systems sync ${interrupted ? 'paused' : 'completed'}: ${totalSystemsCreated} systems, ${totalLinksCreated} links`);

      return new Response(
        JSON.stringify({
          success: true,
          message: interrupted
            ? `Synkade ${totalSystemsCreated} system (${currentBuildingIndex}/${totalBuildings} byggnader). Anropa igen för att fortsätta.`
            : `Klart: ${totalSystemsCreated} system, ${totalLinksCreated} kopplingar från ${totalBuildings} byggnader`,
          systemsCreated: totalSystemsCreated,
          linksCreated: totalLinksCreated,
          interrupted,
          progress: { currentBuildingIndex, totalBuildings }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ DIAGNOSTIC: Dump revision data ============
    if (action === 'dump-revisions') {
      const accessToken = await getAccessToken();
      const apiUrl = _creds.apiUrl || Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = _creds.apiKey || Deno.env.get("ASSET_PLUS_API_KEY") || "";
      const buildingFmGuid = body?.buildingFmGuid || '';
      const discovery = await discover3dModelsEndpoint(supabase, accessToken, apiUrl, apiKey, buildingFmGuid);
      if (!discovery.url) {
        return new Response(JSON.stringify({ error: 'No 3D endpoint' }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const revRes = await fetch(`${discovery.url}/GetAllModelRevisions`, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      const revData = await revRes.json();
      const allRevs = revData?.modelRevisions || (Array.isArray(revData) ? revData : []);
      const { data: bldg } = await supabase.from('assets').select('common_name').eq('fm_guid', buildingFmGuid).eq('category', 'Building').maybeSingle();
      const bName = bldg?.common_name || '';
      const filtered = bName ? allRevs.filter((r: any) => String(r.entityName || '').toLowerCase() === bName.toLowerCase()) : allRevs;
      
      // XKT fetch test: try multiple strategies with the latest Published revision
      const xktTests: any[] = [];
      // Find latest published A-modell revision
      const aModelRevs = filtered.filter((r: any) => r.modelName === 'A-modell');
      const publishedRevs = aModelRevs.filter((r: any) => r.status === 4);
      const latestPublished = publishedRevs.sort((a: any, b: any) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime())[0];
      
      if (latestPublished) {
        // Test 1: modelid=modelId (bimObjectId)
        const url1 = `${discovery.url}/GetXktData?modelid=${latestPublished.modelId}&context=Building&apiKey=${apiKey}`;
        const r1 = await fetch(url1, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const b1 = await r1.text();
        xktTests.push({ strategy: 'modelid=modelId only', url: url1, status: r1.status, bodyLen: b1.length, body: b1.substring(0, 200) });
        
        // Test 2: modelid=revisionId 
        const url2 = `${discovery.url}/GetXktData?modelid=${latestPublished.revisionId}&context=Building&apiKey=${apiKey}`;
        const r2 = await fetch(url2, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const b2 = await r2.text();
        xktTests.push({ strategy: 'modelid=revisionId', url: url2, status: r2.status, bodyLen: b2.length, body: b2.substring(0, 200) });

        // Test 3: modelid=modelId&bimobjectid=modelId 
        const url3 = `${discovery.url}/GetXktData?modelid=${latestPublished.modelId}&bimobjectid=${latestPublished.modelId}&context=Building&apiKey=${apiKey}`;
        const r3 = await fetch(url3, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const b3 = await r3.text();
        xktTests.push({ strategy: 'modelid+bimobjectid=modelId', url: url3, status: r3.status, bodyLen: b3.length, body: b3.substring(0, 200) });
        
        // Test 4: modelid=revisionId&bimobjectid=modelId
        const url4 = `${discovery.url}/GetXktData?modelid=${latestPublished.revisionId}&bimobjectid=${latestPublished.modelId}&context=Building&apiKey=${apiKey}`;
        const r4 = await fetch(url4, { headers: { "Authorization": `Bearer ${accessToken}` } });
        const b4 = await r4.text();
        xktTests.push({ strategy: 'modelid=revisionId+bimobjectid=modelId', url: url4, status: r4.status, bodyLen: b4.length, body: b4.substring(0, 200) });
        
        // Test 5: different context values
        for (const ctx of ['Default', 'Asset', 'Level']) {
          const url5 = `${discovery.url}/GetXktData?modelid=${latestPublished.modelId}&bimobjectid=${latestPublished.modelId}&context=${ctx}&apiKey=${apiKey}`;
          const r5 = await fetch(url5, { headers: { "Authorization": `Bearer ${accessToken}` } });
          const b5 = await r5.text();
          xktTests.push({ strategy: `context=${ctx}`, url: url5, status: r5.status, bodyLen: b5.length, body: b5.substring(0, 200) });
        }
      }
      
      return new Response(JSON.stringify({
        totalRevisions: allRevs.length,
        buildingName: bName,
        latestPublishedAModell: latestPublished || null,
        xktTests,
        matchedRevisions: filtered,
        models: discovery.models,
      }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ============ DEFAULT: Unknown action ============
    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("asset-plus-sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
