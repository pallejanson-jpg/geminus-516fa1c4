import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, forbiddenResponse, corsHeaders } from "../_shared/auth.ts";

// Get Keycloak access token
async function getAccessToken(): Promise<string> {
  const keycloakUrl = Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
  const clientId = Deno.env.get("ASSET_PLUS_CLIENT_ID");
  const clientSecret = Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
  const username = Deno.env.get("ASSET_PLUS_USERNAME");
  const password = Deno.env.get("ASSET_PLUS_PASSWORD");

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
interface EndpointDiscoveryResult {
  url: string | null;
  fromCache: boolean;
  models?: any[];
}

async function discover3dModelsEndpoint(
  supabase: any,
  accessToken: string,
  apiUrl: string,
  apiKey: string,
  buildingFmGuid: string
): Promise<EndpointDiscoveryResult> {
  const CACHE_KEY = 'getmodels_url';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Check cache first
  const { data: cached } = await supabase
    .from('asset_plus_endpoint_cache')
    .select('value, updated_at')
    .eq('key', CACHE_KEY)
    .maybeSingle();

  if (cached?.value) {
    const cacheAge = Date.now() - new Date(cached.updated_at).getTime();
    if (cacheAge < CACHE_TTL_MS) {
      // Use cached endpoint
      const cachedUrl = `${cached.value}?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
      console.log(`Using cached 3D endpoint: ${cached.value}`);
      
      try {
        const res = await fetch(cachedUrl, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (res.ok) {
          const models = await res.json();
          if (Array.isArray(models)) {
            return { url: cached.value, fromCache: true, models };
          }
        }
      } catch (e) {
        console.log('Cached endpoint failed, will re-discover');
      }
    }
  }

  // Build candidate URLs to try
  const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
  const assetDbUrl = apiUrl.replace(/\/+$/, '');
  
  const candidatePaths = [
    `${baseUrl}/api/threed/GetModels`,
    `${baseUrl}/threed/GetModels`,
    `${assetDbUrl}/api/threed/GetModels`,
    `${assetDbUrl}/threed/GetModels`,
    `${assetDbUrl}/GetModels`,
    `${baseUrl}/api/v1/threed/GetModels`,
  ];

  // Try each candidate with different parameter styles
  for (const basePath of candidatePaths) {
    // Try with apiKey in query
    const urlWithQuery = `${basePath}?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
    
    try {
      console.log(`Trying: ${basePath}`);
      const res = await fetch(urlWithQuery, {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          console.log(`✅ Found working 3D endpoint: ${basePath}`);
          
          // Cache the working base path
          await supabase
            .from('asset_plus_endpoint_cache')
            .upsert({ 
              key: CACHE_KEY, 
              value: basePath,
              updated_at: new Date().toISOString()
            }, { onConflict: 'key' });
          
          return { url: basePath, fromCache: false, models: data };
        }
      }
    } catch (e) {
      console.debug(`Endpoint failed: ${basePath}`, e);
    }

    // Try with x-api-key header instead
    try {
      const urlWithFmGuid = `${basePath}?fmGuid=${buildingFmGuid}`;
      const res = await fetch(urlWithFmGuid, {
        headers: { 
          "Authorization": `Bearer ${accessToken}`,
          "x-api-key": apiKey
        }
      });
      
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          console.log(`✅ Found working 3D endpoint (header auth): ${basePath}`);
          
          await supabase
            .from('asset_plus_endpoint_cache')
            .upsert({ 
              key: CACHE_KEY, 
              value: basePath,
              updated_at: new Date().toISOString()
            }, { onConflict: 'key' });
          
          return { url: basePath, fromCache: false, models: data };
        }
      }
    } catch (e) {
      // Continue to next candidate
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
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");

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
      // Use minimal select and explicit sort to reduce memory pressure
      const result = await fetchAssetPlusObjects(accessToken, filter, skip, take, {
        useMinimalSelect: true,
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
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");

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

async function upsertAssets(supabase: any, items: any[]): Promise<number> {
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

  const { error } = await supabase
    .from('assets')
    .upsert(assets, { 
      onConflict: 'fm_guid',
      ignoreDuplicates: false 
    });

  if (error) throw error;
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

// Fetch all fm_guids from local DB, paginating past the 1000-row default limit
async function fetchAllLocalFmGuids(
  supabase: any,
  categories: string[],
  isLocal: boolean = false
): Promise<string[]> {
  const allGuids: string[] = [];
  const PAGE = 1000;
  let from = 0;
  let done = false;

  while (!done) {
    const { data, error } = await supabase
      .from('assets')
      .select('fm_guid')
      .in('category', categories)
      .eq('is_local', isLocal)
      .range(from, from + PAGE - 1);

    if (error) throw error;

    if (data && data.length > 0) {
      data.forEach((r: any) => allGuids.push(r.fm_guid));
      from += PAGE;
      if (data.length < PAGE) done = true;
    } else {
      done = true;
    }
  }
  return allGuids;
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
      
      const accessToken = await getAccessToken();
      
      // Get local counts by category
      const { count: structureCount } = await supabase
        .from('assets')
        .select('*', { count: 'exact', head: true })
        .in('category', ['Building', 'Building Storey', 'Space']);

      const { count: assetsCount } = await supabase
        .from('assets')
        .select('*', { count: 'exact', head: true })
        .eq('category', 'Instance');

      const { count: totalCount } = await supabase
        .from('assets')
        .select('*', { count: 'exact', head: true });

      // Get XKT models count from database
      const { count: xktCount } = await supabase
        .from('xkt_models')
        .select('*', { count: 'exact', head: true });

      // Get building count for XKT reference
      const { count: buildingCount } = await supabase
        .from('assets')
        .select('*', { count: 'exact', head: true })
        .eq('category', 'Building');

      // Get sync states
      const { data: syncStates } = await supabase
        .from('asset_sync_state')
        .select('*');

      // Get remote counts
      const remoteStructureCount = await getRemoteCountByTypes(accessToken, [1, 2, 3]);
      const remoteAssetsCount = await getRemoteCountByTypes(accessToken, [4]);
      const remoteTotalCount = remoteStructureCount + remoteAssetsCount;

      return new Response(
        JSON.stringify({
          success: true,
          structure: {
            localCount: structureCount || 0,
            remoteCount: remoteStructureCount,
            inSync: structureCount === remoteStructureCount,
            syncState: syncStates?.find((s: any) => s.subtree_id === 'structure'),
          },
          assets: {
            localCount: assetsCount || 0,
            remoteCount: remoteAssetsCount,
            inSync: assetsCount === remoteAssetsCount,
            syncState: syncStates?.find((s: any) => s.subtree_id === 'assets'),
          },
          xkt: {
            localCount: xktCount || 0,
            buildingCount: buildingCount || 0,
            syncState: syncStates?.find((s: any) => s.subtree_id === 'xkt'),
          },
          total: {
            localCount: totalCount || 0,
            remoteCount: remoteTotalCount,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC STRUCTURE (Buildings, Storeys, Spaces) ============
    if (action === 'sync-structure') {
      await updateSyncState(supabase, 'structure', 'running');
      const accessToken = await getAccessToken();
      console.log('Starting sync-structure (ObjectTypes 1, 2, 3) with orphan cleanup');

      const filter = [
        ["objectType", "=", 1], "or",
        ["objectType", "=", 2], "or",
        ["objectType", "=", 3]
      ];

      const remoteFmGuids = new Set<string>();
      let totalSynced = 0;
      let skip = 0;
      const take = 200;
      let hasMore = true;

      while (hasMore) {
        console.log(`Fetching structure at skip=${skip}...`);
        const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);
        
        // Collect all remote fmGuids for orphan detection
        result.data.forEach((item: any) => {
          remoteFmGuids.add(item.fmGuid);
        });

        if (result.data.length > 0) {
          const synced = await upsertAssets(supabase, result.data);
          totalSynced += synced;
          console.log(`Synced ${synced} structure items (total: ${totalSynced})`);
        }

        hasMore = result.hasMore;
        skip += take;
        await updateSyncState(supabase, 'structure', 'running', totalSynced);
      }

      // --- Orphan cleanup: remove local non-is_local objects not found in Asset+ ---
      console.log(`Total remote fmGuids: ${remoteFmGuids.size}. Checking for orphans...`);
      
      const localFmGuids = await fetchAllLocalFmGuids(supabase, ['Building', 'Building Storey', 'Space'], false);
      console.log(`Local non-is_local structure count: ${localFmGuids.length}`);
      
      const orphanFmGuids = localFmGuids.filter(guid => !remoteFmGuids.has(guid));
      
      let orphansRemoved = 0;
      if (orphanFmGuids.length > 0) {
        console.log(`Found ${orphanFmGuids.length} orphan structure objects to remove`);
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
            orphansRemoved += batch.length;
          }
        }
        console.log(`Removed ${orphansRemoved} orphan structure objects`);
      } else {
        console.log('No orphan structure objects found');
      }

      await updateSyncState(supabase, 'structure', 'completed', totalSynced);
      console.log(`Structure sync completed: ${totalSynced} items, ${orphansRemoved} orphans removed`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: orphansRemoved > 0 
            ? `Synkade ${totalSynced} objekt, tog bort ${orphansRemoved} föräldralösa objekt`
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
      
      const accessToken = await getAccessToken();
      console.log('Starting sync-assets-resumable');

      // Get all buildings from local DB
      const { data: buildings, error: buildingsError } = await supabase
        .from('assets')
        .select('fm_guid, common_name')
        .eq('category', 'Building')
        .order('common_name');

      if (buildingsError) throw buildingsError;

      if (!buildings || buildings.length === 0) {
        await updateSyncState(supabase, 'assets', 'failed', 0, 'No buildings found. Run structure sync first.');
        return new Response(
          JSON.stringify({ success: false, error: 'No buildings found. Run structure sync first.', interrupted: false }),
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
      const take = 200;

      while (currentBuildingIndex < totalBuildings && !interrupted) {
        const building = buildings[currentBuildingIndex];
        const buildingName = building.common_name || building.fm_guid;
        console.log(`Syncing assets for building ${currentBuildingIndex + 1}/${totalBuildings}: ${buildingName} (mode: ${pageMode})`);

        const filter = [
          ["buildingFmGuid", "=", building.fm_guid],
          "and",
          ["objectType", "=", 4]
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
              const synced = await upsertAssets(supabase, result.data);
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
      const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";
      
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

          console.log(`Building ${buildingName}: Found ${models.length} models`);

          // Process each model
          for (const model of models) {
            // Check timeout between models
            if (Date.now() - startTime > MAX_EXECUTION_TIME) {
              interrupted = true;
              break;
            }

            // Accept multiple possible URL field names
            const xktUrl = model.xktFileUrl || model.xkt_file_url || model.fileUrl || model.url;
            if (!xktUrl) {
              console.log(`Model ${model.id || 'unknown'}: No xkt URL found`);
              continue;
            }

            const modelId = model.id || model.modelId || xktUrl.split('/').pop()?.replace('.xkt', '') || `model_${Date.now()}`;
            const fileName = xktUrl.split('/').pop() || `${modelId}.xkt`;
            const storagePath = `${buildingFmGuid}/${fileName}`;

            // Check if already synced
            const { data: existingModel } = await supabase
              .from('xkt_models')
              .select('id')
              .eq('building_fm_guid', buildingFmGuid)
              .eq('model_id', modelId)
              .maybeSingle();

            if (existingModel) {
              console.log(`Model ${modelId} already synced`);
              continue;
            }

            try {
              // Resolve relative URLs
              let fullXktUrl = xktUrl;
              if (xktUrl.startsWith('/')) {
                const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
                fullXktUrl = baseUrl + xktUrl;
              }

              console.log(`Fetching XKT: ${fullXktUrl}`);
              
              // Fetch with timeout
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000);
              
              const xktRes = await fetch(fullXktUrl, {
                headers: { "Authorization": `Bearer ${accessToken}` },
                signal: controller.signal
              });
              
              clearTimeout(timeoutId);

              if (!xktRes.ok) {
                console.log(`Failed to fetch model ${modelId}: ${xktRes.status}`);
                continue;
              }

              const xktData = await xktRes.arrayBuffer();
              const fileSize = xktData.byteLength;
              
              if (fileSize < 1024) { // Skip files < 1KB (likely invalid)
                console.log(`Model ${modelId}: File too small (${fileSize} bytes), skipping`);
                continue;
              }
              
              console.log(`Model ${modelId}: Downloaded ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

              // Upload to storage
              const { error: uploadError } = await supabase.storage
                .from('xkt-models')
                .upload(storagePath, new Uint8Array(xktData), {
                  contentType: 'application/octet-stream',
                  upsert: true
                });

              let signedUrl: string | null = null;
              if (!uploadError) {
                const { data: urlData } = await supabase.storage
                  .from('xkt-models')
                  .createSignedUrl(storagePath, 86400 * 365);
                signedUrl = urlData?.signedUrl || null;
              } else {
                console.log(`Storage upload failed for ${modelId}:`, uploadError.message);
              }

              // Insert into database
              const { error: dbError } = await supabase
                .from('xkt_models')
                .upsert({
                  building_fm_guid: buildingFmGuid,
                  building_name: buildingName,
                  model_id: modelId,
                  model_name: model.name || model.modelName || fileName,
                  file_name: fileName,
                  file_url: signedUrl,
                  file_size: fileSize,
                  storage_path: storagePath,
                  source_url: fullXktUrl,
                  synced_at: new Date().toISOString(),
                }, { onConflict: 'building_fm_guid,model_id' });

              if (dbError) {
                console.log(`Database insert failed for ${modelId}:`, dbError.message);
                errors.push(`${buildingName}/${modelId}: DB error`);
                continue;
              }

              totalSynced++;
              console.log(`✅ Synced model ${modelId} for ${buildingName}`);
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
      const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";
      
      console.log(`Starting sync-xkt-building for: ${buildingFmGuid}`);

      // Get building name
      const { data: building } = await supabase
        .from('assets')
        .select('common_name')
        .eq('fm_guid', buildingFmGuid)
        .eq('category', 'Building')
        .maybeSingle();

      const buildingName = building?.common_name || buildingFmGuid;

      try {
        // Use robust endpoint discovery
        const discovery = await discover3dModelsEndpoint(supabase, accessToken, apiUrl, apiKey, buildingFmGuid);
        
        if (!discovery.url) {
          // 3D API not accessible from Edge Function environment
          // This is expected - models will be cached via Cache-on-Load in the viewer instead
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: '3D API ej tillgänglig från servern. Modeller cachas automatiskt när du öppnar 3D-viewern.',
              hint: 'cache-on-load',
              modelCount: 0 
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const models = discovery.models || [];
        
        if (models.length === 0) {
          return new Response(
            JSON.stringify({ success: true, message: 'No models found', modelCount: 0 }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`Building ${buildingName}: Found ${models.length} models`);
        let synced = 0;

        for (const model of models) {
          const xktUrl = model.xktFileUrl || model.xkt_file_url || model.fileUrl || model.url;
          if (!xktUrl) continue;

          const modelId = model.id || model.modelId || xktUrl.split('/').pop()?.replace('.xkt', '') || `model_${Date.now()}`;
          const fileName = xktUrl.split('/').pop() || `${modelId}.xkt`;
          const storagePath = `${buildingFmGuid}/${fileName}`;

          // Check if already synced
          const { data: existingModel } = await supabase
            .from('xkt_models')
            .select('id')
            .eq('building_fm_guid', buildingFmGuid)
            .eq('model_id', modelId)
            .maybeSingle();

          if (existingModel) {
            console.log(`Model ${modelId} already synced`);
            continue;
          }

          try {
            let fullXktUrl = xktUrl;
            if (xktUrl.startsWith('/')) {
              const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
              fullXktUrl = baseUrl + xktUrl;
            }

            console.log(`Fetching XKT: ${fullXktUrl}`);
            const xktRes = await fetch(fullXktUrl, {
              headers: { "Authorization": `Bearer ${accessToken}` }
            });

            if (!xktRes.ok) continue;

            const xktData = await xktRes.arrayBuffer();
            const fileSize = xktData.byteLength;
            
            if (fileSize < 1024) continue;
            
            console.log(`Model ${modelId}: Downloaded ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

            // Upload to storage
            const { error: uploadError } = await supabase.storage
              .from('xkt-models')
              .upload(storagePath, new Uint8Array(xktData), {
                contentType: 'application/octet-stream',
                upsert: true
              });

            let signedUrl: string | null = null;
            if (!uploadError) {
              const { data: urlData } = await supabase.storage
                .from('xkt-models')
                .createSignedUrl(storagePath, 86400 * 365);
              signedUrl = urlData?.signedUrl || null;
            }

            // Insert into database
            await supabase
              .from('xkt_models')
              .upsert({
                building_fm_guid: buildingFmGuid,
                building_name: buildingName,
                model_id: modelId,
                model_name: model.name || model.modelName || fileName,
                file_name: fileName,
                file_url: signedUrl,
                file_size: fileSize,
                storage_path: storagePath,
                source_url: fullXktUrl,
                synced_at: new Date().toISOString(),
              }, { onConflict: 'building_fm_guid,model_id' });

            synced++;
            console.log(`✅ Synced model ${modelId} for ${buildingName}`);
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            console.log(`Failed to sync model ${modelId}: ${errMsg}`);
          }
        }

        return new Response(
          JSON.stringify({ success: true, message: `Synced ${synced} models`, synced, buildingFmGuid }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        return new Response(
          JSON.stringify({ success: false, error: errMsg }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ============ CHECK DELTA (compare local vs remote) ============
    if (action === 'check-delta') {
      console.log('Starting check-delta');
      const accessToken = await getAccessToken();
      
      // Get remote structure counts and sample fmGuids
      const remoteStructureCount = await getRemoteCountByTypes(accessToken, [1, 2, 3]);
      
      // Get local structure counts - EXCLUDE is_local objects (locally created, not from Asset+)
      const { count: localStructureCount } = await supabase
        .from('assets')
        .select('*', { count: 'exact', head: true })
        .in('category', ['Building', 'Building Storey', 'Space'])
        .eq('is_local', false);
      
      // For detailed comparison, fetch a sample of fmGuids from both sides
      // This is a lightweight check - full comparison would require fetching all GUIDs
      const discrepancy = (localStructureCount || 0) - remoteStructureCount;
      const hasOrphans = discrepancy > 0;
      const hasMissing = discrepancy < 0;
      
      return new Response(
        JSON.stringify({
          success: true,
          localCount: localStructureCount || 0,
          remoteCount: remoteStructureCount,
          orphanCount: hasOrphans ? Math.abs(discrepancy) : 0,
          newCount: hasMissing ? Math.abs(discrepancy) : 0,
          inSync: discrepancy === 0,
          discrepancy,
          message: discrepancy === 0 
            ? 'Data är synkroniserad' 
            : hasOrphans 
              ? `${Math.abs(discrepancy)} objekt finns lokalt men inte i Asset+`
              : `${Math.abs(discrepancy)} objekt saknas lokalt`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC WITH CLEANUP (remove orphans) ============
    if (action === 'sync-with-cleanup') {
      console.log('Starting sync-with-cleanup');
      const accessToken = await getAccessToken();
      
      await updateSyncState(supabase, 'structure', 'running', undefined, undefined, {
        subtree_name: 'Byggnad/Plan/Rum (med rensning)'
      });
      
      // Step 1: Fetch all remote structure fmGuids
      const filter = [
        ["objectType", "=", 1], "or",
        ["objectType", "=", 2], "or",
        ["objectType", "=", 3]
      ];
      
      const remoteFmGuids = new Set<string>();
      let totalSynced = 0;
      let skip = 0;
      const take = 200;
      let hasMore = true;
      
      console.log('Fetching all remote structure objects...');
      
      while (hasMore) {
        const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);
        
        // Collect fmGuids and upsert
        result.data.forEach((item: any) => {
          remoteFmGuids.add(item.fmGuid);
        });
        
        if (result.data.length > 0) {
          const synced = await upsertAssets(supabase, result.data);
          totalSynced += synced;
        }
        
        hasMore = result.hasMore;
        skip += take;
        
        console.log(`Synced ${totalSynced} structure items, collected ${remoteFmGuids.size} GUIDs...`);
        await updateSyncState(supabase, 'structure', 'running', totalSynced);
      }
      
      console.log(`Total remote fmGuids: ${remoteFmGuids.size}`);
      
      // Step 2: Find local orphans (only check synced objects, not local-only)
      const localFmGuids = await fetchAllLocalFmGuids(supabase, ['Building', 'Building Storey', 'Space'], false);
      console.log(`Local non-is_local structure count: ${localFmGuids.length}`);
      
      const orphanFmGuids = localFmGuids.filter(guid => !remoteFmGuids.has(guid));
      
      console.log(`Found ${orphanFmGuids.length} orphan objects to remove`);
      
      // Step 3: Remove orphans in batches
      let removedCount = 0;
      const batchSize = 100;
      
      for (let i = 0; i < orphanFmGuids.length; i += batchSize) {
        const batch = orphanFmGuids.slice(i, i + batchSize);
        
        const { error: deleteError } = await supabase
          .from('assets')
          .delete()
          .in('fm_guid', batch);
        
        if (deleteError) {
          console.error(`Error deleting orphans batch ${i / batchSize}:`, deleteError);
        } else {
          removedCount += batch.length;
          console.log(`Removed ${removedCount}/${orphanFmGuids.length} orphans`);
        }
      }
      
      await updateSyncState(supabase, 'structure', 'completed', totalSynced);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: `Synkade ${totalSynced} objekt, tog bort ${removedCount} föräldralösa objekt`,
          totalSynced,
          orphansRemoved: removedCount,
          orphansFound: orphanFmGuids.length
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
      const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
      const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";
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
