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

  if (!keycloakUrl || !clientId || !clientSecret || !username || !password) {
    throw new Error("Missing Keycloak configuration");
  }

  const tokenUrl = `${keycloakUrl}/protocol/openid-connect/token`;
  
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: clientId,
      client_secret: clientSecret,
      username: username,
      password: password,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Keycloak auth failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Fetch objects from Asset+ API
async function fetchAssetPlusObjects(
  accessToken: string, 
  filter: any[], 
  skip = 0, 
  take = 1000
): Promise<{ items: any[]; totalCount: number }> {
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");

  if (!apiUrl || !apiKey) {
    throw new Error("Missing Asset+ API configuration");
  }

  const response = await fetch(`${apiUrl}/api/v2/object/list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      filter,
      skip,
      take,
      includeCount: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Asset+ API failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// Upsert assets to Supabase
async function upsertAssets(supabase: any, items: any[]): Promise<number> {
  if (items.length === 0) return 0;

  const assets = items.map((item: any) => ({
    fm_guid: item.fmGuid,
    category: item.category || 'Unknown',
    name: item.name || null,
    common_name: item.commonName || null,
    building_fm_guid: item.buildingFmGuid || null,
    level_fm_guid: item.levelFmGuid || null,
    in_room_fm_guid: item.inRoomFmGuid || null,
    complex_common_name: item.complexCommonName || null,
    gross_area: item.grossArea || null,
    asset_type: item.assetType || null,
    attributes: item,
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('assets')
    .upsert(assets, { 
      onConflict: 'fm_guid',
      ignoreDuplicates: false 
    });

  if (error) {
    console.error('Upsert error:', error);
    throw error;
  }

  return assets.length;
}

// Update sync state
async function updateSyncState(
  supabase: any, 
  subtreeId: string, 
  status: string, 
  totalAssets?: number, 
  errorMessage?: string
) {
  const updateData: any = {
    sync_status: status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'running') {
    updateData.last_sync_started_at = new Date().toISOString();
  } else if (status === 'completed') {
    updateData.last_sync_completed_at = new Date().toISOString();
    updateData.error_message = null;
  }

  if (totalAssets !== undefined) {
    updateData.total_assets = totalAssets;
  }

  if (errorMessage) {
    updateData.error_message = errorMessage;
  }

  await supabase
    .from('asset_sync_state')
    .upsert({
      subtree_id: subtreeId,
      subtree_name: subtreeId === 'full' ? 'Fullständig synk' : subtreeId,
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

    const { action = 'full-sync' } = await req.json().catch(() => ({}));
    
    console.log(`Starting ${action}...`);

    // Update status to running
    await updateSyncState(supabase, 'full', 'running');

    // Get access token
    const accessToken = await getAccessToken();
    console.log('Got Keycloak access token');

    // Categories to sync
    const categories = ['Building', 'Building Storey', 'Space', 'Door'];
    
    const filter = categories.flatMap((cat, i) => 
      i === 0 ? [["category", "=", cat]] : ["or", ["category", "=", cat]]
    ).flat();

    let totalSynced = 0;
    let skip = 0;
    const take = 1000;
    let hasMore = true;

    while (hasMore) {
      console.log(`Fetching batch at skip=${skip}...`);
      
      const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);
      const items = result.items || [];
      
      if (items.length > 0) {
        const synced = await upsertAssets(supabase, items);
        totalSynced += synced;
        console.log(`Synced ${synced} items (total: ${totalSynced})`);
      }

      hasMore = items.length === take;
      skip += take;

      // Update progress
      await updateSyncState(supabase, 'full', 'running', totalSynced);
    }

    // Mark as completed
    await updateSyncState(supabase, 'full', 'completed', totalSynced);

    console.log(`Sync completed. Total assets synced: ${totalSynced}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Synced ${totalSynced} assets`,
        totalSynced 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Sync error:", errorMessage);
    
    // Try to update sync state with error
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      await updateSyncState(supabase, 'full', 'failed', undefined, errorMessage);
    } catch (e) {
      console.error("Failed to update sync state:", e);
    }

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
