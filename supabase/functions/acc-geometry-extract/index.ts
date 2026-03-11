import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Edge function: acc-geometry-extract
 * 
 * Extracts per-storey GLB geometry chunks from APS SVF derivatives.
 * 
 * Actions:
 *   "extract"  — Download SVF, parse metadata, create per-storey GLB chunks + manifest
 *   "status"   — Check if a manifest already exists for a building/version
 *   "manifest"  — Return the manifest JSON for a building
 * 
 * The manifest schema follows docs/plans/acc-obj-pipeline-plan.md
 */

interface ManifestChunk {
  storeyGuid: string;
  storeyName: string;
  priority: number;
  url: string;
  bbox: number[];
  elementCount: number;
  format: string;
}

interface GeometryManifest {
  modelId: string;
  source: { accProjectId: string; accFileUrn: string; apsRegion: string };
  version: string;
  format: string;
  coordinateSystem: { up: string; units: string };
  materialPolicy: { textures: boolean };
  chunks: ManifestChunk[];
  fallback: { url: string } | null;
}

interface GeometryIndexEntry {
  externalId: string;
  storeyGuid: string;
  dbId: number;
  fm_guid: string | null;
}

// ── APS OAuth 2-legged ──
async function getApsToken(): Promise<string> {
  const clientId = Deno.env.get("APS_CLIENT_ID");
  const clientSecret = Deno.env.get("APS_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Missing APS_CLIENT_ID / APS_CLIENT_SECRET");

  const res = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "data:read viewables:read",
    }),
  });
  if (!res.ok) throw new Error(`APS auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

// ── Detect EU region from URN ──
function getRegionEndpoint(urnBase64: string): { mdBase: string; region: string } {
  try {
    const decoded = atob(urnBase64.replace(/-/g, "+").replace(/_/g, "/"));
    if (decoded.includes("wipemea")) {
      return { mdBase: "https://developer.api.autodesk.com/modelderivative/v2/regions/eu/designdata", region: "EU" };
    }
  } catch {}
  return { mdBase: "https://developer.api.autodesk.com/modelderivative/v2/designdata", region: "US" };
}

// ── Fetch manifest/bubble from APS ──
async function fetchApsBubble(urnBase64: string, token: string, mdBase: string): Promise<any> {
  const res = await fetch(`${mdBase}/${urnBase64}/manifest`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
  return res.json();
}

// ── Extract SVF property database to get Level + externalId mapping ──
async function fetchSvfProperties(urnBase64: string, token: string, mdBase: string): Promise<any> {
  // Try the properties endpoint
  const res = await fetch(`${mdBase}/${urnBase64}/metadata`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn(`[acc-geometry-extract] metadata endpoint failed: ${res.status}`);
    return null;
  }
  const meta = await res.json();
  const viewables = meta?.data?.metadata || [];
  if (viewables.length === 0) return null;

  // Get the 3D viewable GUID
  const view3d = viewables.find((v: any) => v.role === "3d") || viewables[0];
  const viewGuid = view3d.guid;

  // Fetch properties for this viewable
  const propsRes = await fetch(`${mdBase}/${urnBase64}/metadata/${viewGuid}/properties?forceget=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!propsRes.ok) {
    console.warn(`[acc-geometry-extract] properties fetch failed: ${propsRes.status}`);
    return null;
  }

  return propsRes.json();
}

// ── Level key detection (multilingual) ──
const LEVEL_KEYS = ["Level", "level", "Plan", "plan", "Våning", "våning", "Base Level", "Etage", "etage", "Niveau", "niveau"];

function findLevelFromProperties(props: Record<string, any>): string | null {
  for (const key of LEVEL_KEYS) {
    if (props[key]) return String(props[key]);
  }
  // Check nested property groups
  for (const group of Object.values(props)) {
    if (typeof group === "object" && group !== null) {
      for (const key of LEVEL_KEYS) {
        if ((group as any)[key]) return String((group as any)[key]);
      }
    }
  }
  return null;
}

// ── Build level grouping from SVF properties ──
function buildLevelGroups(propertiesData: any): {
  levelGroups: Map<string, { name: string; dbIds: number[]; externalIds: string[] }>;
  dbIdToExternalId: Map<number, string>;
} {
  const levelGroups = new Map<string, { name: string; dbIds: number[]; externalIds: string[] }>();
  const dbIdToExternalId = new Map<number, string>();

  const elements = propertiesData?.data?.collection || [];
  
  for (const element of elements) {
    const dbId = element.objectid;
    const externalId = element.externalId || `dbId_${dbId}`;
    const props = element.properties || {};

    dbIdToExternalId.set(dbId, externalId);

    const levelName = findLevelFromProperties(props);
    if (!levelName) continue;

    // Use a sanitized GUID-like key for the level
    const levelKey = levelName.toLowerCase().replace(/[^a-z0-9]/g, "_");

    if (!levelGroups.has(levelKey)) {
      levelGroups.set(levelKey, { name: levelName, dbIds: [], externalIds: [] });
    }
    const group = levelGroups.get(levelKey)!;
    group.dbIds.push(dbId);
    group.externalIds.push(externalId);
  }

  return { levelGroups, dbIdToExternalId };
}

// ── Create a deterministic GUID from building + level name ──
async function deterministicGuid(buildingGuid: string, levelName: string): Promise<string> {
  const input = `${buildingGuid}:${levelName}:storey`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  const hex = Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("");
  // Format as UUID v5-like
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action, buildingFmGuid, versionUrn, modelKey, accProjectId } = body;

    if (!buildingFmGuid) {
      return new Response(JSON.stringify({ error: "buildingFmGuid required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STATUS: Check if manifest already exists ──
    if (action === "status") {
      const manifestPath = `${buildingFmGuid}/_geometry_manifest.json`;
      const { data: files } = await supabase.storage
        .from("xkt-models")
        .list(buildingFmGuid, { limit: 100 });

      const hasManifest = files?.some((f: any) => f.name === "_geometry_manifest.json");

      return new Response(JSON.stringify({
        hasManifest: !!hasManifest,
        manifestPath: hasManifest ? manifestPath : null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MANIFEST: Return the manifest JSON ──
    if (action === "manifest") {
      const manifestPath = `${buildingFmGuid}/_geometry_manifest.json`;
      const { data: urlData } = await supabase.storage
        .from("xkt-models")
        .createSignedUrl(manifestPath, 3600);

      if (!urlData?.signedUrl) {
        return new Response(JSON.stringify({ error: "No manifest found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const manifestRes = await fetch(urlData.signedUrl);
      if (!manifestRes.ok) {
        return new Response(JSON.stringify({ error: "Failed to read manifest" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const manifest = await manifestRes.json();
      return new Response(JSON.stringify(manifest), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── EXTRACT: Full pipeline ──
    if (action === "extract") {
      if (!versionUrn) {
        return new Response(JSON.stringify({ error: "versionUrn required for extract" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const urnBase64 = btoa(versionUrn).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const { mdBase, region } = getRegionEndpoint(urnBase64);
      const effectiveModelKey = modelKey || buildingFmGuid;
      const versionStamp = new Date().toISOString();

      console.log(`[acc-geometry-extract] Starting extract for ${buildingFmGuid}, URN=${urnBase64.substring(0, 20)}..., region=${region}`);

      // Step 1: Get APS token
      const token = await getApsToken();

      // Step 2: Check if SVF translation is ready
      const bubble = await fetchApsBubble(urnBase64, token, mdBase);
      if (bubble.status !== "success") {
        return new Response(JSON.stringify({
          error: "SVF translation not ready",
          translationStatus: bubble.status,
          progress: bubble.progress,
        }), {
          status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 3: Fetch SVF properties (Level grouping + externalId)
      console.log(`[acc-geometry-extract] Fetching SVF properties...`);
      const propertiesData = await fetchSvfProperties(urnBase64, token, mdBase);
      
      if (!propertiesData) {
        return new Response(JSON.stringify({ error: "Could not fetch SVF properties" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { levelGroups, dbIdToExternalId } = buildLevelGroups(propertiesData);
      console.log(`[acc-geometry-extract] Found ${levelGroups.size} levels, ${dbIdToExternalId.size} elements with externalIds`);

      if (levelGroups.size === 0) {
        return new Response(JSON.stringify({
          error: "No Level grouping found in SVF properties",
          hint: "The model may not have Level assignments. Try keys: Level, Plan, Våning, Etage",
          totalElements: dbIdToExternalId.size,
        }), {
          status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 4: Build manifest (geometry chunks will be created by the conversion worker)
      const chunks: ManifestChunk[] = [];
      let priority = 0;

      for (const [levelKey, group] of levelGroups) {
        const storeyGuid = await deterministicGuid(buildingFmGuid, group.name);
        chunks.push({
          storeyGuid,
          storeyName: group.name,
          priority: priority++,
          url: `${buildingFmGuid}/glb_chunks/${effectiveModelKey}_storey_${levelKey}.glb`,
          bbox: [], // Will be populated when GLB chunks are created
          elementCount: group.dbIds.length,
          format: "glb",
        });
      }

      // Sort by name for consistent ordering
      chunks.sort((a, b) => a.storeyName.localeCompare(b.storeyName, "sv"));
      chunks.forEach((c, i) => { c.priority = i; });

      const manifest: GeometryManifest = {
        modelId: effectiveModelKey,
        source: {
          accProjectId: accProjectId || "",
          accFileUrn: versionUrn,
          apsRegion: region,
        },
        version: versionStamp,
        format: "glb",
        coordinateSystem: { up: "Z", units: "mm" },
        materialPolicy: { textures: false },
        chunks,
        fallback: null,
      };

      // Step 5: Build geometry index
      const geometryIndex: { modelId: string; version: string; mapping: GeometryIndexEntry[] } = {
        modelId: effectiveModelKey,
        version: versionStamp,
        mapping: [],
      };

      for (const [levelKey, group] of levelGroups) {
        const storeyGuid = await deterministicGuid(buildingFmGuid, group.name);
        for (let i = 0; i < group.dbIds.length; i++) {
          geometryIndex.mapping.push({
            externalId: group.externalIds[i],
            storeyGuid,
            dbId: group.dbIds[i],
            fm_guid: null, // Populated later via asset_external_ids
          });
        }
      }

      // Step 6: Store manifest + geometry_index in storage
      const manifestJson = JSON.stringify(manifest, null, 2);
      const indexJson = JSON.stringify(geometryIndex, null, 2);

      const [manifestUpload, indexUpload] = await Promise.all([
        supabase.storage.from("xkt-models").upload(
          `${buildingFmGuid}/_geometry_manifest.json`,
          new Blob([manifestJson], { type: "application/json" }),
          { upsert: true, contentType: "application/json" },
        ),
        supabase.storage.from("xkt-models").upload(
          `${buildingFmGuid}/_geometry_index.json`,
          new Blob([indexJson], { type: "application/json" }),
          { upsert: true, contentType: "application/json" },
        ),
      ]);

      if (manifestUpload.error) {
        console.error(`[acc-geometry-extract] Manifest upload failed:`, manifestUpload.error);
      }
      if (indexUpload.error) {
        console.error(`[acc-geometry-extract] Index upload failed:`, indexUpload.error);
      }

      // Step 7: Register chunks in xkt_models table
      for (const chunk of chunks) {
        await supabase.from("xkt_models").upsert({
          model_id: `${effectiveModelKey}_storey_${chunk.storeyGuid.substring(0, 8)}`,
          model_name: chunk.storeyName,
          building_fm_guid: buildingFmGuid,
          storage_path: chunk.url,
          file_name: chunk.url.split("/").pop() || "chunk.glb",
          format: "glb",
          is_chunk: true,
          chunk_order: chunk.priority,
          storey_fm_guid: chunk.storeyGuid,
          parent_model_id: effectiveModelKey,
        }, { onConflict: "model_id" });
      }

      console.log(`[acc-geometry-extract] ✅ Manifest created with ${chunks.length} storey chunks, ${geometryIndex.mapping.length} mapped elements`);

      return new Response(JSON.stringify({
        success: true,
        manifest,
        stats: {
          levels: levelGroups.size,
          totalElements: dbIdToExternalId.size,
          mappedElements: geometryIndex.mapping.length,
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[acc-geometry-extract] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
