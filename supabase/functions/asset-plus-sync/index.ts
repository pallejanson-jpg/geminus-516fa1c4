import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Get Keycloak access token
// Based on Asset+ documentation: Prioritize password grant, then token exchange
async function getAccessToken(): Promise<string> {
  const keycloakUrl = Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
  const clientId = Deno.env.get("ASSET_PLUS_CLIENT_ID");
  const clientSecret = Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
  const username = Deno.env.get("ASSET_PLUS_USERNAME");
  const password = Deno.env.get("ASSET_PLUS_PASSWORD");

  // Client secret may be optional if the Keycloak client is configured as "public".
  if (!keycloakUrl || !clientId) {
    throw new Error(
      "Missing Keycloak configuration (ASSET_PLUS_KEYCLOAK_URL and ASSET_PLUS_CLIENT_ID required)"
    );
  }

  const keycloakUrlStr = keycloakUrl.trim();

  // Accept either realm base URL or full token URL
  if (!/^https?:\/\//i.test(keycloakUrlStr)) {
    throw new Error("Invalid ASSET_PLUS_KEYCLOAK_URL. It must start with https://");
  }

  const tokenUrl = keycloakUrlStr.endsWith("/protocol/openid-connect/token")
    ? keycloakUrlStr
    : `${keycloakUrlStr.replace(/\/+$/, "")}/protocol/openid-connect/token`;

  console.log(`Keycloak token request -> url=${tokenUrl} client_id=${clientId}`);

  // Method 1: Password Grant (from documentation)
  // Requires: username, password, client_id, client_secret
  if (username && password) {
    console.log("Trying password grant flow (Method 1)...");
    
    const params = new URLSearchParams({
      grant_type: "password",
      username: username,
      password: password,
      client_id: clientId,
    });

    if (clientSecret) {
      params.set("client_secret", clientSecret);
    }

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });

    const text = await res.text();
    console.log(`Password grant response: ${res.status}`);
    
    if (res.ok) {
      const data = JSON.parse(text);
      console.log("Password grant successful!");
      return data.access_token;
    }
    
    console.log(`Password grant failed: ${text}`);

    // If the client is actually configured as a public client, sending a (wrong/empty) client_secret
    // can yield invalid_client. Retry once without client_secret.
    if (clientSecret && text.includes("invalid_client")) {
      console.log("Retrying password grant without client_secret (public client fallback)...");

      const publicParams = new URLSearchParams({
        grant_type: "password",
        username: username,
        password: password,
        client_id: clientId,
      });

      const publicRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: publicParams,
      });

      const publicText = await publicRes.text();
      console.log(`Public password grant response: ${publicRes.status}`);

      if (publicRes.ok) {
        const data = JSON.parse(publicText);
        console.log("Public password grant successful!");
        return data.access_token;
      }

      console.log(`Public password grant failed: ${publicText}`);
    }
  }

  // Method 2: Token Exchange (M2M) - fallback
  // Step 1: Get M2M token with client_credentials
  // Step 2: Exchange for user token
  if (username) {
    console.log("Trying token exchange flow (Method 2)...");

    if (!clientSecret) {
      console.log("Token exchange requires ASSET_PLUS_CLIENT_SECRET; skipping Method 2.");
      throw new Error(
        "Keycloak auth failed. Token exchange requires ASSET_PLUS_CLIENT_SECRET, and password grant also failed."
      );
    }
    
    // Step 1: client_credentials
    const m2mParams = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });

    const m2mRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: m2mParams,
    });

    const m2mText = await m2mRes.text();
    console.log(`M2M token response: ${m2mRes.status}`);

    if (m2mRes.ok) {
      const m2mData = JSON.parse(m2mText);
      console.log("Got M2M token, exchanging for user token...");

      // Step 2: Token exchange
      const exchangeParams = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: clientId,
        client_secret: clientSecret,
        subject_token: m2mData.access_token,
        requested_subject: username,
      });

      const exchangeRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: exchangeParams,
      });

      const exchangeText = await exchangeRes.text();
      console.log(`Token exchange response: ${exchangeRes.status}`);

      if (exchangeRes.ok) {
        const data = JSON.parse(exchangeText);
        console.log("Token exchange successful!");
        return data.access_token;
      }
      
      console.log(`Token exchange failed: ${exchangeText}`);
    } else {
      console.log(`M2M token failed: ${m2mText}`);
    }
  }

  throw new Error("Keycloak auth failed. Check credentials: CLIENT_ID, CLIENT_SECRET, USERNAME, PASSWORD");
}

// Fetch objects from Asset+ API using PublishDataServiceGetMerged endpoint
// Based on Asset+ Sync documentation: https://js.devexpress.com/Documentation/Guide/Data_Binding/Data_Layer/#Reading_Data
async function fetchAssetPlusObjects(
  accessToken: string, 
  filter: any[], 
  skip = 0, 
  take = 500  // Reduced batch size to avoid memory overflow
): Promise<{ data: any[]; hasMore: boolean }> {
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");

  if (!apiUrl || !apiKey) {
    throw new Error("Missing Asset+ API configuration (ASSET_PLUS_API_URL, ASSET_PLUS_API_KEY)");
  }

  // Normalize the base URL (remove trailing slashes)
  const baseUrl = apiUrl.replace(/\/+$/, "");
  
  // Use PublishDataServiceGetMerged endpoint as documented
  // Note: Endpoint name is "PublishDataServiceGetMerged" (single path segment, not /PublishDataService/GetMerged)
  const endpoint = `${baseUrl}/PublishDataServiceGetMerged`;
  
  console.log(`Calling Asset+ API: ${endpoint} (skip=${skip}, take=${take})`);

  // Request body format from documentation - includes apiKey in body
  // IMPORTANT: Removed requireTotalCount to avoid MongoDB sort memory overflow error
  // The Asset+ backend uses MongoDB which has a 100MB sort limit
  const requestBody = {
    filter,
    skip,
    take,
    requireTotalCount: false, // Disabled to avoid sort memory overflow
    outputType: "raw", // Required per documentation to get raw values
    apiKey, // API key goes in body per documentation examples
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
    console.error(`Asset+ API error response: ${errorText}`);
    throw new Error(`Asset+ API failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const data = result.data || [];
  
  // Determine if there's more data by checking if we got a full batch
  return {
    data,
    hasMore: data.length === take,
  };
}

// Map objectType to category string
function objectTypeToCategory(objectType: number): string {
  const categories: Record<number, string> = {
    0: 'Complex',
    1: 'Building',
    2: 'Building Storey',
    3: 'Space',
    4: 'Door',
  };
  return categories[objectType] || 'Unknown';
}

// Upsert assets to Supabase
async function upsertAssets(supabase: any, items: any[]): Promise<number> {
  if (items.length === 0) return 0;

  const assets = items.map((item: any) => ({
    fm_guid: item.fmGuid,
    category: objectTypeToCategory(item.objectType),
    name: item.designation || null, // designation is the object's name/number
    common_name: item.commonName || null,
    building_fm_guid: item.buildingFmGuid || null,
    level_fm_guid: item.levelFmGuid || null,
    in_room_fm_guid: item.inRoomFmGuid || null,
    complex_common_name: item.complexCommonName || null,
    gross_area: item.grossArea || null,
    asset_type: item.ObjectTypeValue || null,
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

    // ObjectType values from Asset+ documentation:
    // 0 = Complex, 1 = Building, 2 = Level (Building Storey), 3 = Space, 4 = Instance (Door, etc.)
    // Filter to sync: Building (1), Level (2), Space (3), Door/Instance (4)
    const filter = [
      ["objectType", "=", 1],
      "or",
      ["objectType", "=", 2],
      "or",
      ["objectType", "=", 3],
      "or",
      ["objectType", "=", 4]
    ];

    let totalSynced = 0;
    let skip = 0;
    const take = 500; // Smaller batch size to avoid MongoDB memory issues
    let hasMore = true;
    let consecutiveEmptyBatches = 0;
    const maxEmptyBatches = 3; // Safety limit

    while (hasMore && consecutiveEmptyBatches < maxEmptyBatches) {
      console.log(`Fetching batch at skip=${skip}...`);
      
      const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);
      const items = result.data || [];
      
      if (items.length > 0) {
        const synced = await upsertAssets(supabase, items);
        totalSynced += synced;
        console.log(`Synced ${synced} items (total: ${totalSynced})`);
        consecutiveEmptyBatches = 0;
      } else {
        consecutiveEmptyBatches++;
        console.log(`Empty batch ${consecutiveEmptyBatches}/${maxEmptyBatches}`);
      }

      hasMore = result.hasMore;
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
        // Return 200 so frontend callers using invoke() don't crash on non-2xx responses.
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
