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
      console.log('Starting sync-structure (ObjectTypes 1, 2, 3)');

      const filter = [
        ["objectType", "=", 1], "or",
        ["objectType", "=", 2], "or",
        ["objectType", "=", 3]
      ];

      let totalSynced = 0;
      let skip = 0;
      const take = 500;
      let hasMore = true;

      while (hasMore) {
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

      await updateSyncState(supabase, 'structure', 'completed', totalSynced);
      console.log(`Structure sync completed: ${totalSynced} items`);

      return new Response(
        JSON.stringify({ success: true, message: `Synced ${totalSynced} structure items`, totalSynced }),
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
      const take = 500;
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

    // ============ SYNC ASSETS CHUNKED (ObjectType 4 per building with timeout guard) ============
    if (action === 'sync-assets-chunked') {
      const MAX_EXECUTION_TIME = 50000; // 50 seconds (Supabase limit is 60s)
      const startTime = Date.now();
      
      await updateSyncState(supabase, 'assets', 'running');
      const accessToken = await getAccessToken();
      console.log('Starting sync-assets-chunked (ObjectType 4 by building)');

      // Get all buildings from local DB
      const { data: buildings, error: buildingsError } = await supabase
        .from('assets')
        .select('fm_guid, common_name')
        .eq('category', 'Building');

      if (buildingsError) throw buildingsError;

      if (!buildings || buildings.length === 0) {
        await updateSyncState(supabase, 'assets', 'failed', 0, 'No buildings found. Run structure sync first.');
        return new Response(
          JSON.stringify({ success: false, error: 'No buildings found. Run structure sync first.' }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let totalSynced = 0;
      const totalBuildings = buildings.length;
      let interrupted = false;

      for (let i = 0; i < buildings.length; i++) {
        // Check timeout before processing each building
        if (Date.now() - startTime > MAX_EXECUTION_TIME) {
          console.log(`Timeout guard triggered at building ${i + 1}/${totalBuildings}`);
          interrupted = true;
          await updateSyncState(supabase, 'assets', 'interrupted', totalSynced, `Interrupted at building ${i + 1}/${totalBuildings}. Run again to continue.`);
          break;
        }

        const building = buildings[i];
        console.log(`Syncing assets for building ${i + 1}/${totalBuildings}: ${building.common_name || building.fm_guid}`);

        const filter = [
          ["buildingFmGuid", "=", building.fm_guid],
          "and",
          ["objectType", "=", 4]
        ];

        let skip = 0;
        const take = 500;
        let hasMore = true;
        let buildingSynced = 0;

        while (hasMore) {
          // Check timeout before each batch
          if (Date.now() - startTime > MAX_EXECUTION_TIME) {
            console.log(`Timeout guard triggered during building ${building.common_name}`);
            interrupted = true;
            break;
          }

          const result = await fetchAssetPlusObjects(accessToken, filter, skip, take);
          
          if (result.data.length > 0) {
            const synced = await upsertAssets(supabase, result.data);
            buildingSynced += synced;
            totalSynced += synced;
          }

          hasMore = result.hasMore;
          skip += take;
        }

        if (interrupted) break;

        console.log(`Building ${building.common_name}: ${buildingSynced} assets`);
        await updateSyncState(supabase, 'assets', 'running', totalSynced, undefined, {
          subtree_name: `Alla Tillgångar (${i + 1}/${totalBuildings})`
        });
      }

      if (!interrupted) {
        await updateSyncState(supabase, 'assets', 'completed', totalSynced, undefined, {
          subtree_name: 'Alla Tillgångar'
        });
      }
      console.log(`Assets sync ${interrupted ? 'interrupted' : 'completed'}: ${totalSynced} items from ${totalBuildings} buildings`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: interrupted 
            ? `Partial sync: ${totalSynced} assets. Run again to continue.`
            : `Synced ${totalSynced} assets from ${totalBuildings} buildings`, 
          totalSynced,
          interrupted 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ SYNC XKT MODELS (stores in database + storage) ============
    if (action === 'sync-xkt' || action === 'cache-all-xkt') {
      await updateSyncState(supabase, 'xkt', 'running');
      const accessToken = await getAccessToken();
      const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
      const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");
      
      console.log('Starting sync-xkt (syncing to database + storage)');

      // Get all buildings from local DB
      const { data: buildings, error: buildingsError } = await supabase
        .from('assets')
        .select('fm_guid, common_name')
        .eq('category', 'Building');

      if (buildingsError) throw buildingsError;

      if (!buildings || buildings.length === 0) {
        await updateSyncState(supabase, 'xkt', 'failed', 0, 'No buildings found.');
        return new Response(
          JSON.stringify({ success: false, error: 'No buildings found.' }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let synced = 0;
      let skipped = 0;
      const totalBuildings = buildings.length;
      const errors: string[] = [];

      for (let i = 0; i < buildings.length; i++) {
        const building = buildings[i];
        const buildingFmGuid = building.fm_guid;
        const buildingName = building.common_name || buildingFmGuid;

        try {
          // Try multiple API paths - the threed API endpoint might differ between environments
          const baseUrl = apiUrl?.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '') || '';
          
          // Try the primary path
          let modelsUrl = `${baseUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
          
          // Debug logging for first building
          if (i === 0) {
            console.log(`DEBUG: apiUrl = ${apiUrl}`);
            console.log(`DEBUG: baseUrl = ${baseUrl}`);
            console.log(`DEBUG: modelsUrl = ${modelsUrl}`);
          }
          
          let modelsRes = await fetch(modelsUrl, {
            headers: { "Authorization": `Bearer ${accessToken}` }
          });

          // If 404, try alternate path without /api prefix
          if (modelsRes.status === 404) {
            const altUrl = `${baseUrl}/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
            console.log(`Primary path 404, trying alternate: ${altUrl}`);
            modelsRes = await fetch(altUrl, {
              headers: { "Authorization": `Bearer ${accessToken}` }
            });
          }

          // If still 404, try with v1/AssetDB path (some APIs use this)
          if (modelsRes.status === 404) {
            const altUrl2 = `${apiUrl?.replace(/\/+$/, '')}/GetModels?fmGuid=${buildingFmGuid}`;
            console.log(`Alternate path 404, trying AssetDB path: ${altUrl2}`);
            modelsRes = await fetch(altUrl2, {
              headers: { 
                "Authorization": `Bearer ${accessToken}`,
                "x-api-key": apiKey || ''
              }
            });
          }

          if (!modelsRes.ok) {
            console.log(`Building ${buildingName}: No models endpoint available (${modelsRes.status})`);
            // This is not an error - some buildings may not have 3D models
            continue;
          }

          let models: any[];
          try {
            models = await modelsRes.json();
          } catch {
            console.log(`Building ${buildingName}: Invalid JSON response from models endpoint`);
            continue;
          }
          
          if (!Array.isArray(models) || models.length === 0) {
            console.log(`Building ${buildingName}: No XKT models available`);
            continue;
          }

          console.log(`Building ${buildingName}: Found ${models.length} models`);

          // Process each model
          for (const model of models) {
            if (!model.xktFileUrl) {
              console.log(`Model ${model.id || 'unknown'}: No xktFileUrl`);
              continue;
            }

            const modelId = model.id || model.modelId || model.xktFileUrl.split('/').pop()?.replace('.xkt', '') || `model_${Date.now()}`;
            const fileName = model.xktFileUrl.split('/').pop() || `${modelId}.xkt`;
            const storagePath = `${buildingFmGuid}/${fileName}`;

            // Check if already synced in database
            const { data: existingModel } = await supabase
              .from('xkt_models')
              .select('id')
              .eq('building_fm_guid', buildingFmGuid)
              .eq('model_id', modelId)
              .maybeSingle();

            if (existingModel) {
              console.log(`Model ${modelId} already synced`);
              skipped++;
              continue;
            }

            try {
              console.log(`Fetching XKT: ${model.xktFileUrl}`);
              
              // Fetch XKT file - may need auth
              const xktRes = await fetch(model.xktFileUrl, {
                headers: { "Authorization": `Bearer ${accessToken}` }
              });

              if (!xktRes.ok) {
                console.log(`Failed to fetch model ${modelId}: ${xktRes.status}`);
                continue;
              }

              const xktData = await xktRes.arrayBuffer();
              const fileSize = xktData.byteLength;
              
              if (fileSize === 0) {
                console.log(`Model ${modelId}: Empty XKT data (0 bytes), skipping`);
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

              if (uploadError) {
                console.log(`Storage upload failed for ${modelId}:`, uploadError.message);
                // Continue anyway to save the record pointing to source
              }

              // Get signed URL for storage (if upload succeeded)
              let signedUrl: string | null = null;
              if (!uploadError) {
                const { data: urlData } = await supabase.storage
                  .from('xkt-models')
                  .createSignedUrl(storagePath, 86400 * 365); // 1 year
                signedUrl = urlData?.signedUrl || null;
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
                  source_url: model.xktFileUrl,
                  synced_at: new Date().toISOString(),
                }, { onConflict: 'building_fm_guid,model_id' });

              if (dbError) {
                console.log(`Database insert failed for ${modelId}:`, dbError.message);
                errors.push(`${buildingName}/${modelId}: DB error`);
                continue;
              }

              synced++;
              console.log(`Synced model ${modelId} for ${buildingName} (${fileSize} bytes)`);
            } catch (e) {
              const errMsg = e instanceof Error ? e.message : String(e);
              console.log(`Failed to sync model ${modelId}: ${errMsg}`);
            }
          }
          
          await updateSyncState(supabase, 'xkt', 'running', synced, undefined, {
            subtree_name: `XKT-filer (${i + 1}/${totalBuildings})`
          });
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error(`Error syncing building ${buildingName}:`, errMsg);
          errors.push(`${buildingName}: ${errMsg}`);
        }
      }

      const status = errors.length > 0 && synced === 0 ? 'failed' : 'completed';
      await updateSyncState(supabase, 'xkt', status, synced, errors.length > 0 ? errors.slice(0, 5).join('; ') : undefined, {
        subtree_name: 'XKT-filer'
      });
      
      console.log(`XKT sync completed: ${synced} models synced, ${skipped} already synced`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Synkade ${synced} modeller, ${skipped} redan synkade`, 
          synced,
          skipped,
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
      const apiUrl = Deno.env.get("ASSET_PLUS_API_URL");
      const apiKey = Deno.env.get("ASSET_PLUS_API_KEY");
      
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
        const baseUrl = apiUrl?.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '') || '';
        let modelsUrl = `${baseUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
        
        let modelsRes = await fetch(modelsUrl, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });

        // Try alternate paths if 404
        if (modelsRes.status === 404) {
          const altUrl = `${baseUrl}/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`;
          modelsRes = await fetch(altUrl, {
            headers: { "Authorization": `Bearer ${accessToken}` }
          });
        }

        if (!modelsRes.ok) {
          console.log(`Building ${buildingName}: No models endpoint available (${modelsRes.status})`);
          return new Response(
            JSON.stringify({ success: true, message: 'No 3D models available', modelCount: 0 }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        let models: any[];
        try {
          models = await modelsRes.json();
        } catch {
          return new Response(
            JSON.stringify({ success: false, error: 'Invalid models response' }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        if (!Array.isArray(models) || models.length === 0) {
          return new Response(
            JSON.stringify({ success: true, message: 'No models found', modelCount: 0 }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        console.log(`Building ${buildingName}: Found ${models.length} models`);
        let synced = 0;

        for (const model of models) {
          if (!model.xktFileUrl) continue;

          const modelId = model.id || model.modelId || model.xktFileUrl.split('/').pop()?.replace('.xkt', '') || `model_${Date.now()}`;
          const fileName = model.xktFileUrl.split('/').pop() || `${modelId}.xkt`;
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
            console.log(`Fetching XKT: ${model.xktFileUrl}`);
            const xktRes = await fetch(model.xktFileUrl, {
              headers: { "Authorization": `Bearer ${accessToken}` }
            });

            if (!xktRes.ok) continue;

            const xktData = await xktRes.arrayBuffer();
            const fileSize = xktData.byteLength;
            
            if (fileSize === 0) continue;
            
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
                source_url: model.xktFileUrl,
                synced_at: new Date().toISOString(),
              }, { onConflict: 'building_fm_guid,model_id' });

            synced++;
            console.log(`Synced model ${modelId}`);
          } catch (e) {
            console.log(`Failed to sync model ${modelId}: ${e}`);
          }
        }

        console.log(`XKT sync for building completed: ${synced} models`);

        return new Response(
          JSON.stringify({ success: true, modelCount: synced }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`Error syncing XKT for building ${buildingName}:`, errMsg);
        return new Response(
          JSON.stringify({ success: false, error: errMsg }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ============ BUILDING SYNC (legacy - single building hierarchy) ============
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

    // ============ FULL SYNC (legacy) ============
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
