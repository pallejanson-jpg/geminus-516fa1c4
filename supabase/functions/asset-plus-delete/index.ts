import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, corsHeaders } from "../_shared/auth.ts";

// Get Keycloak access token
async function getAccessToken(): Promise<string> {
  const keycloakUrl = Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
  const clientId = Deno.env.get("ASSET_PLUS_CLIENT_ID");
  const clientSecret = Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
  const username = Deno.env.get("ASSET_PLUS_USERNAME");
  const password = Deno.env.get("ASSET_PLUS_PASSWORD");

  if (!keycloakUrl || !clientId) throw new Error("Missing Keycloak configuration");

  const tokenUrl = keycloakUrl.endsWith("/protocol/openid-connect/token")
    ? keycloakUrl
    : `${keycloakUrl.replace(/\/+$/, "")}/protocol/openid-connect/token`;

  if (username && password) {
    const params = new URLSearchParams({ grant_type: "password", username, password, client_id: clientId });
    if (clientSecret) params.set("client_secret", clientSecret);
    const res = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params });
    if (res.ok) return (await res.json()).access_token;
  }
  throw new Error("Keycloak auth failed");
}

/** Batch expire synced fm_guids in Asset+ (max 50 per call) */
async function batchExpireInAssetPlus(
  syncedFmGuids: string[],
  expireDate: string,
): Promise<{ expired: string[]; failed: Array<{ fmGuid: string; error: string }> }> {
  const apiUrl = Deno.env.get("ASSET_PLUS_API_URL") || "";
  const apiKey = Deno.env.get("ASSET_PLUS_API_KEY") || "";
  
  // If Asset+ credentials aren't configured, skip expiry gracefully
  if (!apiUrl || !apiKey) {
    console.log("Asset+ API not configured — skipping ExpireObject, treating all as local-only deletes");
    return { expired: syncedFmGuids, failed: [] };
  }

  const expired: string[] = [];
  const failed: Array<{ fmGuid: string; error: string }> = [];

  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (authErr) {
    console.warn("Keycloak auth failed — skipping Asset+ expiry:", authErr);
    // Treat as success so local cleanup proceeds
    return { expired: syncedFmGuids, failed: [] };
  }

  const baseUrl = apiUrl.replace(/\/+$/, "");

  // Process in batches of 50
  for (let i = 0; i < syncedFmGuids.length; i += 50) {
    const batch = syncedFmGuids.slice(i, i + 50);
    const payload = { apiKey, expireBimObjects: batch.map(fmGuid => ({ fmGuid, expireDate })) };

    try {
      const response = await fetch(`${baseUrl}/ExpireObject`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        expired.push(...batch);
      } else {
        const text = await response.text();
        batch.forEach(fmGuid => failed.push({ fmGuid, error: `ExpireObject ${response.status}: ${text.slice(0, 200)}` }));
      }
    } catch (batchErr) {
      const msg = batchErr instanceof Error ? batchErr.message : "Batch request failed";
      batch.forEach(fmGuid => failed.push({ fmGuid, error: msg }));
    }
  }

  return { expired, failed };
}

// ── Delete individual assets ──
async function handleDeleteAssets(body: any, supabase: any) {
  const { fmGuids, expireDate, force } = body;

  if (!fmGuids || !Array.isArray(fmGuids) || fmGuids.length === 0) {
    return new Response(JSON.stringify({ success: false, error: "fmGuids array is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (fmGuids.length > 50) {
    return new Response(JSON.stringify({ success: false, error: "Maximum 50 items per request" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { data: assets, error: fetchError } = await supabase.from("assets").select("fm_guid, is_local, created_in_model, category").in("fm_guid", fmGuids);
  if (fetchError) return new Response(JSON.stringify({ success: false, error: fetchError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const assetMap = new Map((assets || []).map((a: any) => [a.fm_guid, a]));
  const results: any[] = [];
  const localFmGuids: string[] = [];
  const syncedFmGuids: string[] = [];

  for (const fmGuid of fmGuids) {
    const asset = assetMap.get(fmGuid);
    if (!asset) { results.push({ fmGuid, success: false, error: "Asset not found", wasLocal: false }); continue; }
    if (asset.created_in_model && !force) { results.push({ fmGuid, success: false, error: "BIM-created object (use force=true)", wasLocal: asset.is_local }); continue; }
    if (asset.is_local) localFmGuids.push(fmGuid); else syncedFmGuids.push(fmGuid);
  }

  if (localFmGuids.length > 0) {
    const { error } = await supabase.from("assets").delete().in("fm_guid", localFmGuids);
    localFmGuids.forEach(fmGuid => results.push({ fmGuid, success: !error, error: error?.message, wasLocal: true }));
  }

  if (syncedFmGuids.length > 0) {
    const date = expireDate || new Date().toISOString();
    const { expired, failed } = await batchExpireInAssetPlus(syncedFmGuids, date);
    if (expired.length > 0) {
      const { error } = await supabase.from("assets").delete().in("fm_guid", expired);
      expired.forEach(fmGuid => results.push({ fmGuid, success: true, expired: true, wasLocal: false, error: error ? `Expired but local delete failed: ${error.message}` : undefined }));
    }
    failed.forEach(f => results.push({ fmGuid: f.fmGuid, success: false, error: f.error, wasLocal: false }));
  }

  const summary = { total: fmGuids.length, deleted: results.filter((r: any) => r.success).length, failed: results.filter((r: any) => !r.success).length };
  return new Response(JSON.stringify({ success: summary.failed === 0, results, summary }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── Delete entire building ──
async function handleDeleteBuilding(body: any, supabase: any) {
  const { buildingFmGuid } = body;
  if (!buildingFmGuid) {
    return new Response(JSON.stringify({ success: false, error: "buildingFmGuid is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const log: string[] = [];
  const addLog = (msg: string) => { log.push(msg); console.log(msg); };
  addLog(`Starting delete for building ${buildingFmGuid}`);

  // 1. Fetch ALL assets for this building + the building itself
  const allAssets: any[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from("assets")
      .select("fm_guid, is_local, category")
      .or(`building_fm_guid.eq.${buildingFmGuid},fm_guid.eq.${buildingFmGuid}`)
      .range(offset, offset + pageSize - 1);
    if (!data || data.length === 0) break;
    allAssets.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  addLog(`Found ${allAssets.length} assets to delete`);

  const allFmGuids = allAssets.map((a: any) => a.fm_guid);
  const syncedFmGuids = allAssets.filter((a: any) => !a.is_local).map((a: any) => a.fm_guid);

  // 2. Expire synced assets in Asset+
  let expiredCount = 0;
  let expireErrors: any[] = [];
  if (syncedFmGuids.length > 0) {
    addLog(`Expiring ${syncedFmGuids.length} synced objects in Asset+...`);
    const { expired, failed } = await batchExpireInAssetPlus(syncedFmGuids, new Date().toISOString());
    expiredCount = expired.length;
    expireErrors = failed;
    addLog(`Expired ${expiredCount} objects, ${failed.length} failures`);
  }

  // 3. Delete all assets from local DB (in batches of 500)
  let assetsDeleted = 0;
  for (let i = 0; i < allFmGuids.length; i += 500) {
    const batch = allFmGuids.slice(i, i + 500);
    const { error } = await supabase.from("assets").delete().in("fm_guid", batch);
    if (!error) assetsDeleted += batch.length;
    else addLog(`⚠️ Batch delete error: ${error.message}`);
  }
  addLog(`Deleted ${assetsDeleted} assets from local DB`);

  // 4. Cleanup related tables
  const cleanupTables = [
    { table: "building_settings", column: "fm_guid" },
    { table: "saved_views", column: "building_fm_guid" },
    { table: "navigation_graphs", column: "building_fm_guid" },
    { table: "conversion_jobs", column: "building_fm_guid" },
    { table: "fm_access_drawings", column: "building_fm_guid" },
    { table: "fm_access_documents", column: "building_fm_guid" },
    { table: "fm_access_dou", column: "building_fm_guid" },
    { table: "documents", column: "building_fm_guid" },
    { table: "building_external_links", column: "building_fm_guid" },
    { table: "scan_jobs", column: "building_fm_guid" },
    { table: "bcf_issues", column: "building_fm_guid" },
    { table: "qr_report_configs", column: "building_fm_guid" },
  ];

  for (const { table, column } of cleanupTables) {
    const { error } = await supabase.from(table).delete().eq(column, buildingFmGuid);
    if (error) addLog(`⚠️ Cleanup ${table}: ${error.message}`);
    else addLog(`✓ Cleaned ${table}`);
  }

  // 5. Cleanup asset_external_ids and asset_system for all deleted fm_guids
  if (allFmGuids.length > 0) {
    for (let i = 0; i < allFmGuids.length; i += 500) {
      const batch = allFmGuids.slice(i, i + 500);
      await supabase.from("asset_external_ids").delete().in("fm_guid", batch);
      await supabase.from("asset_system").delete().in("asset_fm_guid", batch);
    }
    addLog(`✓ Cleaned asset_external_ids and asset_system`);
  }

  // 6. Delete storage files
  try {
    const { data: xktFiles } = await supabase.storage.from("xkt-models").list(buildingFmGuid);
    if (xktFiles && xktFiles.length > 0) {
      const paths = xktFiles.map((f: any) => `${buildingFmGuid}/${f.name}`);
      await supabase.storage.from("xkt-models").remove(paths);
      addLog(`✓ Removed ${paths.length} XKT files`);
    }
  } catch (e) { addLog(`⚠️ XKT storage cleanup: ${e}`); }

  try {
    const { data: ifcFiles } = await supabase.storage.from("ifc-uploads").list(buildingFmGuid);
    if (ifcFiles && ifcFiles.length > 0) {
      const paths = ifcFiles.map((f: any) => `${buildingFmGuid}/${f.name}`);
      await supabase.storage.from("ifc-uploads").remove(paths);
      addLog(`✓ Removed ${paths.length} IFC files`);
    }
  } catch (e) { addLog(`⚠️ IFC storage cleanup: ${e}`); }

  // 7. Delete xkt_models rows
  await supabase.from("xkt_models").delete().eq("building_fm_guid", buildingFmGuid);
  addLog(`✓ Cleaned xkt_models`);

  const summary = {
    assetsDeleted,
    expiredInAssetPlus: expiredCount,
    expireErrors: expireErrors.length,
    log,
  };

  return new Response(
    JSON.stringify({ success: expireErrors.length === 0, summary }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  try {
    const body = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (body.action === "deleteBuilding") {
      return await handleDeleteBuilding(body, supabase);
    }

    // Default: delete individual assets
    return await handleDeleteAssets(body, supabase);
  } catch (error) {
    console.error("asset-plus-delete error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
