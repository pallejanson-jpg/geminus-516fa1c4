import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Get Keycloak access token
// Based on screenshot analysis: Uses client_credentials flow with audience parameter
async function getAccessToken(): Promise<string> {
  const keycloakUrl = Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
  const clientId = Deno.env.get("ASSET_PLUS_CLIENT_ID");
  const clientSecret = Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
  const username = Deno.env.get("ASSET_PLUS_USERNAME");
  const password = Deno.env.get("ASSET_PLUS_PASSWORD");
  const audience = Deno.env.get("ASSET_PLUS_AUDIENCE") || "asset-api"; // Default from screenshot

  if (!keycloakUrl || !clientId) {
    throw new Error("Missing Keycloak configuration (ASSET_PLUS_KEYCLOAK_URL, ASSET_PLUS_CLIENT_ID required)");
  }

  const keycloakUrlStr = keycloakUrl.trim();
  const clientIdStr = clientId;
  const clientSecretStr = clientSecret || "";
  const usernameStr = username || "";
  const passwordStr = password || "";

  // Accept either realm base URL or full token URL
  if (!/^https?:\/\//i.test(keycloakUrlStr)) {
    throw new Error(
      "Invalid ASSET_PLUS_KEYCLOAK_URL. It must start with https://"
    );
  }

  const tokenUrl = keycloakUrlStr.endsWith("/protocol/openid-connect/token")
    ? keycloakUrlStr
    : `${keycloakUrlStr.replace(/\/+$/, "")}/protocol/openid-connect/token`;

  try {
    new URL(tokenUrl);
  } catch {
    throw new Error("Invalid ASSET_PLUS_KEYCLOAK_URL format");
  }

  console.log(`Keycloak token request -> url=${tokenUrl} client_id=${clientIdStr}`);

  // Strategy 1: client_credentials with audience (as shown in screenshot)
  // This is the primary method based on the Faciliate screenshot
  async function requestClientCredentialsWithAudience(): Promise<{ res: Response; text: string }> {
    console.log("Trying client_credentials flow with audience...");
    
    const params: Record<string, string> = {
      grant_type: "client_credentials",
      client_id: clientIdStr,
      audience: audience,
    };
    
    if (clientSecretStr) {
      params.client_secret = clientSecretStr;
    }

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });

    const text = await res.text();
    console.log(`client_credentials response: ${res.status}`);
    return { res, text };
  }

  // Strategy 2: password grant (fallback if user mapping exists)
  async function requestPasswordToken(): Promise<{ res: Response; text: string }> {
    if (!usernameStr || !passwordStr) {
      return { res: new Response(null, { status: 400 }), text: "No username/password configured" };
    }
    
    console.log("Trying password grant flow...");
    
    const params: Record<string, string> = {
      grant_type: "password",
      client_id: clientIdStr,
      username: usernameStr,
      password: passwordStr,
    };
    
    if (clientSecretStr) {
      params.client_secret = clientSecretStr;
    }
    
    if (audience) {
      params.audience = audience;
    }

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });

    const text = await res.text();
    console.log(`password grant response: ${res.status}`);
    return { res, text };
  }

  // Strategy 3: client_credentials then token exchange
  async function requestTokenExchange(): Promise<{ res: Response; text: string }> {
    if (!usernameStr) {
      return { res: new Response(null, { status: 400 }), text: "No username configured for exchange" };
    }
    
    console.log("Trying token exchange flow...");
    
    // Step 1: Get machine token
    const m2mParams: Record<string, string> = {
      grant_type: "client_credentials",
      client_id: clientIdStr,
    };
    if (clientSecretStr) m2mParams.client_secret = clientSecretStr;
    if (audience) m2mParams.audience = audience;

    const m2mRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(m2mParams),
    });

    const m2mText = await m2mRes.text();
    if (!m2mRes.ok) {
      return { res: m2mRes, text: m2mText };
    }

    const m2mData = JSON.parse(m2mText);
    console.log("Got M2M token, exchanging...");

    // Step 2: Exchange for user token
    const exchangeParams: Record<string, string> = {
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      client_id: clientIdStr,
      subject_token: m2mData.access_token,
      requested_subject: usernameStr,
    };
    if (clientSecretStr) exchangeParams.client_secret = clientSecretStr;

    const exchangeRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(exchangeParams),
    });

    return { res: exchangeRes, text: await exchangeRes.text() };
  }

  // Try strategies in order based on screenshot analysis:
  // 1. client_credentials with audience (primary)
  const first = await requestClientCredentialsWithAudience();
  if (first.res.ok) {
    const data = JSON.parse(first.text);
    return data.access_token;
  }

  // 2. password grant (fallback)
  const second = await requestPasswordToken();
  if (second.res.ok) {
    const data = JSON.parse(second.text);
    return data.access_token;
  }

  // 3. token exchange
  const third = await requestTokenExchange();
  if (third.res.ok) {
    const data = JSON.parse(third.text);
    return data.access_token;
  }

  throw new Error(`Keycloak auth failed. Last response: ${first.res.status} - ${first.text}`);
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
    throw new Error("Missing Asset+ API configuration (ASSET_PLUS_API_URL, ASSET_PLUS_API_KEY)");
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
