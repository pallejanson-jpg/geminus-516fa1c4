import { supabase } from "@/integrations/supabase/client";

export type AssetPlusFilter = any[];

/**
 * Check if a building FMGUID originates from the ACC BIM sync pipeline.
 * ACC-sourced buildings already have assets from the BIM import and should NOT
 * trigger an Asset+ sync.
 */
export function isAccSourcedBuilding(fmGuid: string): boolean {
  return fmGuid.startsWith('acc-bim-') || fmGuid.startsWith('acc-');
}

/**
 * Fetch assets from the local synced database for Navigator tree.
 * This reads from the `assets` table which is populated by the asset-plus-sync edge function.
 * 
 * Note: Due to Supabase's default 1000 row limit, we paginate through all results.
 */
export async function fetchLocalAssets(categories?: string[]): Promise<any[]> {
  const allAssets: any[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("assets")
      .select("fm_guid, category, name, common_name, building_fm_guid, level_fm_guid, in_room_fm_guid, complex_common_name, attributes, is_local, created_in_model, asset_type, synced_at, annotation_placed, symbol_id, gross_area")
      .order("fm_guid", { ascending: true }) // Stable ordering for pagination
      .range(offset, offset + pageSize - 1);

    if (categories && categories.length > 0) {
      query = query.in("category", categories);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Failed to fetch local assets:", error);
      throw new Error(error.message || "Failed to fetch assets from database");
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      // Map database snake_case to camelCase for frontend compatibility
      const mapped = data.map((asset) => ({
        fmGuid: asset.fm_guid,
        category: asset.category,
        name: asset.name,
        commonName: asset.common_name,
        buildingFmGuid: asset.building_fm_guid,
        levelFmGuid: asset.level_fm_guid,
        inRoomFmGuid: asset.in_room_fm_guid,
        complexCommonName: asset.complex_common_name,
        attributes: asset.attributes,
        isLocal: asset.is_local,
        createdInModel: asset.created_in_model,
        assetType: asset.asset_type,
        syncedAt: asset.synced_at,
        annotationPlaced: asset.annotation_placed,
        symbolId: asset.symbol_id,
        grossArea: asset.gross_area,
      }));
      allAssets.push(...mapped);
      
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
      }
    }
  }

  return allAssets;
}

/**
 * Fetch assets (Instance) for a specific building on demand.
 * Used for lazy-loading assets when user opens AssetsView or expands a room in Navigator.
 */
export async function fetchAssetsForBuilding(buildingFmGuid: string): Promise<any[]> {
  const allAssets: any[] = [];
  const pageSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("assets")
      .select("fm_guid, category, name, common_name, building_fm_guid, level_fm_guid, in_room_fm_guid, complex_common_name, attributes, is_local, created_in_model, asset_type, synced_at, annotation_placed, symbol_id, coordinate_x, coordinate_y, coordinate_z, gross_area")
      .eq("building_fm_guid", buildingFmGuid)
      .eq("category", "Instance")
      .order("fm_guid", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error("Failed to fetch building assets:", error);
      throw new Error(error.message || "Failed to fetch building assets");
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      const mapped = data.map((asset) => ({
        fmGuid: asset.fm_guid,
        category: asset.category,
        name: asset.name,
        commonName: asset.common_name,
        buildingFmGuid: asset.building_fm_guid,
        levelFmGuid: asset.level_fm_guid,
        inRoomFmGuid: asset.in_room_fm_guid,
        complexCommonName: asset.complex_common_name,
        attributes: asset.attributes,
        isLocal: asset.is_local,
        createdInModel: asset.created_in_model,
        assetType: asset.asset_type,
        syncedAt: asset.synced_at,
        annotationPlaced: asset.annotation_placed,
        symbolId: asset.symbol_id,
        coordinateX: asset.coordinate_x,
        coordinateY: asset.coordinate_y,
        coordinateZ: asset.coordinate_z,
        grossArea: asset.gross_area,
      }));
      allAssets.push(...mapped);
      
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        offset += pageSize;
      }
    }
  }

  return allAssets;
}

/**
 * Fetch a flat list of objects from Asset+ API via edge function.
 * Note: This is proxied via a backend function so we never ship secrets to the browser.
 * @deprecated Use fetchLocalAssets() for better performance with synced data.
 */
export async function fetchAssetPlusData(filter: AssetPlusFilter): Promise<any[]> {
  const { data, error } = await supabase.functions.invoke("asset-plus-query", {
    body: { filter },
  });

  if (error) {
    throw new Error(error.message || "Asset+ fetch failed");
  }

  // Expected shape: { items: [...] }
  const items = (data as any)?.items;
  if (!Array.isArray(items)) return [];
  return items;
}

// Types for Asset+ object creation
export interface AssetProperty {
  name: string;
  value: string | number | boolean;
  dataType: number; // 0=String, 1=Int32, 2=Int64, 3=Decimal, 4=DateTime, 5=Bool
}

export interface CreateAssetPayload {
  parentSpaceFmGuid: string;
  designation: string;
  commonName?: string;
  properties?: AssetProperty[];
}

/**
 * Create a new asset (ObjectType 4) in Asset+ via edge function.
 * The asset will be linked to the specified parent Space.
 */
export async function createAssetPlusObject(payload: CreateAssetPayload): Promise<any> {
  const { data, error } = await supabase.functions.invoke("asset-plus-create", {
    body: payload,
  });

  if (error) {
    throw new Error(error.message || "Failed to create asset");
  }

  if (!data?.success) {
    throw new Error(data?.error || "Unknown error creating asset");
  }

  return data.asset;
}

// Types for property updates
export interface UpdatePropertyItem {
  name: string;
  value: string | number | boolean;
  dataType?: number;
}

export interface UpdateAssetResult {
  fmGuid: string;
  success: boolean;
  error?: string;
  synced?: boolean;
}

export interface UpdateAssetsResponse {
  success: boolean;
  message: string;
  results: UpdateAssetResult[];
  summary: {
    total: number;
    success: number;
    failed: number;
    syncedToAssetPlus: number;
    localOnly: number;
  };
}

/**
 * Update asset properties for one or more assets.
 * Automatically syncs to Asset+ for non-local assets (is_local = false).
 * 
 * @param fmGuids - Array of FM GUIDs to update
 * @param properties - Array of properties to update
 * @returns Update results including sync status per asset
 */
export async function updateAssetProperties(
  fmGuids: string[],
  properties: UpdatePropertyItem[]
): Promise<UpdateAssetsResponse> {
  const { data, error } = await supabase.functions.invoke("asset-plus-update", {
    body: { fmGuids, properties },
  });

  if (error) {
    throw new Error(error.message || "Failed to update assets");
  }

  return data as UpdateAssetsResponse;
}

/**
 * Update an existing asset in Asset+.
 * @deprecated Use updateAssetProperties() instead for better batch support
 */
export async function updateAssetPlus(payload: {
  fmGuid: string;
  properties: UpdatePropertyItem[];
}): Promise<UpdateAssetsResponse> {
  return updateAssetProperties([payload.fmGuid], payload.properties);
}

/**
 * Sync a local asset to Asset+ API.
 * This pushes an asset that was created locally (is_local=true) to the external Asset+ system.
 * 
 * Requirements:
 * - Asset must have in_room_fm_guid (parent space) - required by Asset+
 * - Asset should have a name/designation
 * 
 * @returns Success status and any error message
 */
export async function syncAssetToAssetPlus(assetFmGuid: string): Promise<{ success: boolean; error?: string; asset?: any }> {
  // 1. Fetch asset from local database
  const { data: asset, error: fetchError } = await supabase
    .from("assets")
    .select("*")
    .eq("fm_guid", assetFmGuid)
    .maybeSingle();

  if (fetchError || !asset) {
    return { 
      success: false, 
      error: fetchError?.message || `Asset ${assetFmGuid} not found` 
    };
  }

  // 2. Validate - must have parent space
  if (!asset.in_room_fm_guid) {
    return {
      success: false,
      error: "Asset måste vara kopplad till ett rum (in_room_fm_guid) för att synkas till Asset+"
    };
  }

  // 3. Build properties array for Asset+ (only non-Lovable-specific fields)
  const properties: AssetProperty[] = [];
  
  // Add asset_type as a property
  if (asset.asset_type) {
    properties.push({
      name: "AssetCategory",
      value: asset.asset_type,
      dataType: 0, // String
    });
  }

  // Add inventory date
  properties.push({
    name: "InventoryDate",
    value: new Date().toISOString(),
    dataType: 4, // DateTime
  });

  // Add description from attributes if present
  const attrs = (asset.attributes as Record<string, any>) || {};
  if (attrs.description) {
    properties.push({
      name: "Description",
      value: String(attrs.description),
      dataType: 0, // String
    });
  }

  // 4. Call edge function to create in Asset+
  const payload: CreateAssetPayload = {
    parentSpaceFmGuid: asset.in_room_fm_guid,
    designation: asset.name || "Okänd",
    commonName: asset.common_name || undefined,
    properties: properties.length > 0 ? properties : undefined,
  };

  // Include existing fmGuid so Asset+ uses the same ID
  const requestBody = {
    ...payload,
    fmGuid: asset.fm_guid,
    // Include coordinates for local storage update
    coordinates: asset.coordinate_x != null ? {
      x: asset.coordinate_x,
      y: asset.coordinate_y,
      z: asset.coordinate_z,
    } : undefined,
  };

  const { data, error } = await supabase.functions.invoke("asset-plus-create", {
    body: requestBody,
  });

  if (error) {
    return {
      success: false,
      error: error.message || "Failed to sync to Asset+",
    };
  }

  if (!data?.success) {
    return {
      success: false,
      error: data?.error || "Unknown error syncing to Asset+",
    };
  }

  // 5. Update local database to mark as synced
  const { error: updateError } = await supabase
    .from("assets")
    .update({
      is_local: false,
      synced_at: new Date().toISOString(),
    })
    .eq("fm_guid", assetFmGuid);

  if (updateError) {
    console.warn("Failed to update local sync status:", updateError);
    // Don't fail - the sync to Asset+ succeeded
  }

  return {
    success: true,
    asset: data.asset,
  };
}

/**
 * Batch sync multiple local assets to Asset+.
 * @returns Summary of results
 */
export async function batchSyncAssetsToAssetPlus(assetFmGuids: string[]): Promise<{
  total: number;
  synced: number;
  failed: number;
  errors: Array<{ fmGuid: string; error: string }>;
}> {
  const results = {
    total: assetFmGuids.length,
    synced: 0,
    failed: 0,
    errors: [] as Array<{ fmGuid: string; error: string }>,
  };

  for (const fmGuid of assetFmGuids) {
    const result = await syncAssetToAssetPlus(fmGuid);
    if (result.success) {
      results.synced++;
    } else {
      results.failed++;
      results.errors.push({ fmGuid, error: result.error || "Unknown error" });
    }
  }

  return results;
}

/**
 * Fetch room sensor data for a building.
 * Returns rooms with their attributes for visualization purposes.
 */
export async function fetchRoomSensorData(buildingFmGuid: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("assets")
    .select("fm_guid, name, common_name, attributes")
    .eq("category", "Space")
    .or(`building_fm_guid.eq.${buildingFmGuid},building_fm_guid.eq.${buildingFmGuid.toLowerCase()},building_fm_guid.eq.${buildingFmGuid.toUpperCase()}`);

  if (error) {
    console.error("Failed to fetch room sensor data:", error);
    throw new Error(error.message || "Failed to fetch room sensor data");
  }

  return (data || []).map((room) => ({
    fmGuid: room.fm_guid,
    name: room.name,
    commonName: room.common_name,
    attributes: room.attributes,
  }));
}

/**
 * Check if a building has any synced assets (ObjectType 4), and if not, trigger a sync.
 * Returns true if sync was triggered, false if assets already exist.
 */
export async function syncBuildingAssetsIfNeeded(buildingFmGuid: string): Promise<{ synced: boolean; count: number }> {
  // Check local count
  const { count, error: countError } = await supabase
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("building_fm_guid", buildingFmGuid)
    .eq("category", "Instance");

  if (countError) {
    console.error("Failed to count assets:", countError);
    throw new Error(countError.message || "Failed to count assets");
  }

  if (count && count > 0) {
    console.log(`Building ${buildingFmGuid} already has ${count} assets`);
    return { synced: false, count };
  }

  console.log(`Building ${buildingFmGuid} has no assets, triggering sync...`);

  // Trigger sync for this building
  const { data, error } = await supabase.functions.invoke("asset-plus-sync", {
    body: { action: "sync-single-building", buildingFmGuid },
  });

  if (error) {
    console.error("Failed to sync building assets:", error);
    throw new Error(error.message || "Failed to sync building assets");
  }

  return { synced: true, count: data?.totalSynced || 0 };
}

/**
 * Ensure assets exist for a building - sync if needed.
 * Returns immediately if assets exist, otherwise triggers background sync.
 * This is used for proactive on-demand loading when navigating to a building.
 */
export async function ensureBuildingAssets(
  buildingFmGuid: string,
  options?: { waitForSync?: boolean }
): Promise<{ hasAssets: boolean; count: number; syncing: boolean }> {
  // ACC-sourced buildings already have assets from BIM sync — skip Asset+ sync
  if (isAccSourcedBuilding(buildingFmGuid)) {
    console.log(`ensureBuildingAssets: ${buildingFmGuid} is ACC-sourced, skipping Asset+ sync`);
    return { hasAssets: false, count: 0, syncing: false };
  }

  // 1. Check local count
  const { count, error: countError } = await supabase
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("building_fm_guid", buildingFmGuid)
    .eq("category", "Instance");

  if (countError) {
    console.error("Failed to count assets:", countError);
    return { hasAssets: false, count: 0, syncing: false };
  }

  if (count && count > 0) {
    return { hasAssets: true, count, syncing: false };
  }

  // 2. Trigger background sync
  console.log(`No assets for ${buildingFmGuid}, triggering sync...`);
  
  const syncPromise = supabase.functions.invoke("asset-plus-sync", {
    body: { action: "sync-single-building", buildingFmGuid }
  });

  if (options?.waitForSync) {
    try {
      await syncPromise;
      // Re-check count
      const { count: newCount } = await supabase
        .from("assets")
        .select("*", { count: "exact", head: true })
        .eq("building_fm_guid", buildingFmGuid)
        .eq("category", "Instance");
      return { hasAssets: (newCount || 0) > 0, count: newCount || 0, syncing: false };
    } catch (e) {
      console.warn("Asset sync failed:", e);
      return { hasAssets: false, count: 0, syncing: false };
    }
  }

  // Fire-and-forget background sync
  syncPromise.catch(e => console.warn("Background asset sync failed:", e));

  return { hasAssets: false, count: 0, syncing: true };
}

// ============ DELETE / EXPIRE ============

export interface DeleteAssetsResult {
  fmGuid: string;
  success: boolean;
  error?: string;
  wasLocal: boolean;
  expired?: boolean;
}

export interface DeleteAssetsResponse {
  success: boolean;
  results: DeleteAssetsResult[];
  summary: {
    total: number;
    deleted: number;
    failed: number;
    localDeleted: number;
    expiredInAssetPlus: number;
  };
}

/**
 * Delete one or more assets. Local assets are deleted directly,
 * synced assets are expired in Asset+ then removed locally.
 * BIM-created objects are protected unless force=true.
 */
export async function deleteAssets(
  fmGuids: string[],
  options?: { force?: boolean; expireDate?: string }
): Promise<DeleteAssetsResponse> {
  const { data, error } = await supabase.functions.invoke("asset-plus-delete", {
    body: {
      fmGuids,
      force: options?.force,
      expireDate: options?.expireDate,
    },
  });

  if (error) {
    throw new Error(error.message || "Failed to delete assets");
  }

  return data as DeleteAssetsResponse;
}

/**
 * Push all local-only assets to Asset+ via the sync edge function.
 * Returns summary of pushed objects.
 */
export async function pushLocalAssetsToRemote(): Promise<{
  success: boolean;
  pushed: number;
  failed: number;
  errors: Array<{ fmGuid: string; error: string }>;
}> {
  const { data, error } = await supabase.functions.invoke("asset-plus-sync", {
    body: { action: "push-local-to-remote" },
  });

  if (error) {
    throw new Error(error.message || "Failed to push local assets");
  }

  return data as any;
}

/**
 * Get count of local-only assets (not yet synced to Asset+).
 */
export async function getLocalAssetCount(): Promise<number> {
  const { count, error } = await supabase
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("is_local", true);

  if (error) {
    console.error("Failed to count local assets:", error);
    return 0;
  }

  return count || 0;
}

// ============ DELETE BUILDING ============

export interface DeleteBuildingResponse {
  success: boolean;
  summary: {
    assetsDeleted: number;
    expiredInAssetPlus: number;
    expireErrors: number;
    log: string[];
  };
}

/**
 * Delete an entire building and all its assets, related data, and storage files.
 * Synced assets are expired in Asset+ before deletion.
 */
export async function deleteBuilding(buildingFmGuid: string): Promise<DeleteBuildingResponse> {
  const { data, error } = await supabase.functions.invoke("asset-plus-delete", {
    body: { action: "deleteBuilding", buildingFmGuid },
  });

  if (error) {
    throw new Error(error.message || "Failed to delete building");
  }

  return data as DeleteBuildingResponse;
}
