import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

// Fetch objects from Asset+ API
async function fetchAssetPlusObjects(
  accessToken: string, 
  filter: any[], 
  skip = 0, 
  take = 500
): Promise<{ data: any[]; hasMore: boolean }> {
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");

  if (!apiUrl || !apiKey) {
    throw new Error("Missing Asset+ API configuration");
  }

  const baseUrl = apiUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/PublishDataServiceGetMerged`;

  const requestBody = {
    filter,
    skip,
    take,
    requireTotalCount: false,
    outputType: "raw",
    apiKey,
  };

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
  
  return {
    data,
    hasMore: data.length === take,
  };
}

// Get count of objects modified after a date
async function getRemoteModifiedCount(
  accessToken: string,
  sinceDate: string
): Promise<number> {
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");

  if (!apiUrl || !apiKey) return -1;

  const baseUrl = apiUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/PublishDataServiceGetMerged`;

  // Filter for items modified after sinceDate
  const filter = [
    ["dateModified", ">", sinceDate],
    "and",
    [
      ["objectType", "=", 1], "or",
      ["objectType", "=", 2], "or",
      ["objectType", "=", 3], "or",
      ["objectType", "=", 4]
    ]
  ];

  const requestBody = {
    filter,
    skip: 0,
    take: 1,
    requireTotalCount: true, // Only for small check
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
    return result.totalCount ?? result.data?.length ?? 0;
  } catch {
    return -1;
  }
}

// Get total count from Asset+
async function getRemoteTotalCount(accessToken: string): Promise<number> {
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");

  if (!apiUrl || !apiKey) return -1;

  const baseUrl = apiUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/PublishDataServiceGetMerged`;

  const filter = [
    ["objectType", "=", 1], "or",
    ["objectType", "=", 2], "or",
    ["objectType", "=", 3], "or",
    ["objectType", "=", 4]
  ];

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
    source_updated_at: item.dateModified || null, // Track source modification date
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
      subtree_name: subtreeId === 'full' ? 'Full Sync' : subtreeId,
      ...updateData,
    }, { onConflict: 'subtree_id' });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { action = 'full-sync', buildingFmGuid } = body;
    
    console.log(`Action: ${action}`);

    // ============ CHECK SYNC STATUS ============
    if (action === 'check-sync-status') {
      const accessToken = await getAccessToken();
      
      // Get local stats
      const { count: localCount } = await supabase
        .from('assets')
        .select('*', { count: 'exact', head: true });

      const { data: lastSync } = await supabase
        .from('asset_sync_state')
        .select('last_sync_completed_at')
        .eq('subtree_id', 'full')
        .maybeSingle();

      // Get remote count
      const remoteCount = await getRemoteTotalCount(accessToken);
      
      // Check for modifications since last sync
      let modifiedCount = 0;
      if (lastSync?.last_sync_completed_at) {
        modifiedCount = await getRemoteModifiedCount(accessToken, lastSync.last_sync_completed_at);
      }

      const inSync = remoteCount === localCount && modifiedCount === 0;

      return new Response(
        JSON.stringify({
          success: true,
          inSync,
          localCount: localCount || 0,
          remoteCount,
          modifiedSinceLastSync: modifiedCount,
          lastSyncAt: lastSync?.last_sync_completed_at || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ INCREMENTAL SYNC ============
    if (action === 'incremental-sync') {
      await updateSyncState(supabase, 'full', 'running');
      
      const accessToken = await getAccessToken();

      // Get last sync date
      const { data: lastSync } = await supabase
        .from('asset_sync_state')
        .select('last_sync_completed_at')
        .eq('subtree_id', 'full')
        .maybeSingle();

      if (!lastSync?.last_sync_completed_at) {
        // No previous sync, do full sync instead
        console.log('No previous sync found, performing full sync');
      }

      const sinceDate = lastSync?.last_sync_completed_at || '1970-01-01T00:00:00Z';
      
      // Filter for modified items since last sync
      const filter = [
        ["dateModified", ">", sinceDate],
        "and",
        [
          ["objectType", "=", 1], "or",
          ["objectType", "=", 2], "or",
          ["objectType", "=", 3], "or",
          ["objectType", "=", 4]
        ]
      ];

      let totalSynced = 0;
      let skip = 0;
      const take = 500;
      let hasMore = true;

      while (hasMore) {
        console.log(`Incremental sync: skip=${skip}`);
        const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);
        
        if (result.data.length > 0) {
          const synced = await upsertAssets(supabase, result.data);
          totalSynced += synced;
          console.log(`Synced ${synced} modified items (total: ${totalSynced})`);
        }

        hasMore = result.hasMore;
        skip += take;
        await updateSyncState(supabase, 'full', 'running', totalSynced);
      }

      // Get final count
      const { count: finalCount } = await supabase
        .from('assets')
        .select('*', { count: 'exact', head: true });

      await updateSyncState(supabase, 'full', 'completed', finalCount || 0);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Incremental sync: ${totalSynced} modified items`,
          totalSynced,
          totalAssets: finalCount,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ BUILDING SYNC ============
    if (action === 'building-sync') {
      if (!buildingFmGuid) {
        return new Response(
          JSON.stringify({ success: false, error: 'buildingFmGuid is required for building-sync' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await updateSyncState(supabase, buildingFmGuid, 'running');
      const accessToken = await getAccessToken();
      console.log(`Building sync for: ${buildingFmGuid}`);

      // First, sync the building itself (objectType 1)
      const buildingFilter = [
        ["fmGuid", "=", buildingFmGuid],
        "and",
        ["objectType", "=", 1]
      ];

      let totalSynced = 0;
      const buildingResult = await fetchAssetPlusObjects(accessToken, buildingFilter, 0, 1);
      if (buildingResult.data.length > 0) {
        const synced = await upsertAssets(supabase, buildingResult.data);
        totalSynced += synced;
        console.log(`Synced building: ${synced} items`);
      }

      // Then sync Building Storeys (objectType 2) for this building
      const storeyFilter = [
        ["buildingFmGuid", "=", buildingFmGuid],
        "and",
        ["objectType", "=", 2]
      ];

      let skip = 0;
      const take = 500;
      let hasMore = true;

      while (hasMore) {
        console.log(`Fetching storeys at skip=${skip}...`);
        const result = await fetchAssetPlusObjects(accessToken, storeyFilter, skip, take);
        
        if (result.data.length > 0) {
          const synced = await upsertAssets(supabase, result.data);
          totalSynced += synced;
          console.log(`Synced ${synced} storeys (total: ${totalSynced})`);
        }

        hasMore = result.hasMore;
        skip += take;
        await updateSyncState(supabase, buildingFmGuid, 'running', totalSynced);
      }

      // Finally sync Spaces (objectType 3) for this building
      const spaceFilter = [
        ["buildingFmGuid", "=", buildingFmGuid],
        "and",
        ["objectType", "=", 3]
      ];

      skip = 0;
      hasMore = true;

      while (hasMore) {
        console.log(`Fetching spaces at skip=${skip}...`);
        const result = await fetchAssetPlusObjects(accessToken, spaceFilter, skip, take);
        
        if (result.data.length > 0) {
          const synced = await upsertAssets(supabase, result.data);
          totalSynced += synced;
          console.log(`Synced ${synced} spaces (total: ${totalSynced})`);
        }

        hasMore = result.hasMore;
        skip += take;
        await updateSyncState(supabase, buildingFmGuid, 'running', totalSynced);
      }

      await updateSyncState(supabase, buildingFmGuid, 'completed', totalSynced);
      console.log(`Building sync completed: ${totalSynced} assets`);

      return new Response(
        JSON.stringify({ success: true, message: `Synced ${totalSynced} assets for building`, totalSynced }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC ALL BUILDINGS (only objectType 1) ============
    if (action === 'sync-all-buildings') {
      await updateSyncState(supabase, 'buildings', 'running');
      const accessToken = await getAccessToken();
      console.log('Starting sync-all-buildings');

      const buildingFilter = [["objectType", "=", 1]];
      let totalSynced = 0;
      let skip = 0;
      const take = 500;
      let hasMore = true;

      while (hasMore) {
        console.log(`Fetching buildings at skip=${skip}...`);
        const result = await fetchAssetPlusObjects(accessToken, buildingFilter, skip, take);
        
        if (result.data.length > 0) {
          const synced = await upsertAssets(supabase, result.data);
          totalSynced += synced;
          console.log(`Synced ${synced} buildings (total: ${totalSynced})`);
        }

        hasMore = result.hasMore;
        skip += take;
        await updateSyncState(supabase, 'buildings', 'running', totalSynced);
      }

      await updateSyncState(supabase, 'buildings', 'completed', totalSynced);
      console.log(`All buildings sync completed: ${totalSynced} buildings`);

      return new Response(
        JSON.stringify({ success: true, message: `Synced ${totalSynced} buildings`, totalSynced }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ FULL SYNC ============
    await updateSyncState(supabase, 'full', 'running');
    const accessToken = await getAccessToken();
    console.log('Got access token');

    const filter = [
      ["objectType", "=", 1], "or",
      ["objectType", "=", 2], "or",
      ["objectType", "=", 3], "or",
      ["objectType", "=", 4]
    ];

    let totalSynced = 0;
    let skip = 0;
    const take = 500;
    let hasMore = true;
    let consecutiveEmptyBatches = 0;

    while (hasMore && consecutiveEmptyBatches < 3) {
      console.log(`Fetching batch at skip=${skip}...`);
      const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);
      
      if (result.data.length > 0) {
        const synced = await upsertAssets(supabase, result.data);
        totalSynced += synced;
        console.log(`Synced ${synced} items (total: ${totalSynced})`);
        consecutiveEmptyBatches = 0;
      } else {
        consecutiveEmptyBatches++;
      }

      hasMore = result.hasMore;
      skip += take;
      await updateSyncState(supabase, 'full', 'running', totalSynced);
    }

    await updateSyncState(supabase, 'full', 'completed', totalSynced);
    console.log(`Sync completed: ${totalSynced} assets`);

    return new Response(
      JSON.stringify({ success: true, message: `Synced ${totalSynced} assets`, totalSynced }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Sync error:", errorMessage);
    
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await updateSyncState(supabase, 'full', 'failed', undefined, errorMessage);
    } catch {}

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
