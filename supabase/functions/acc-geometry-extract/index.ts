import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Edge function: acc-geometry-extract
 * 
 * Extracts geometry from APS SVF derivatives and stores as GLB in Supabase Storage.
 * Uses 3-legged token for broader APS access, falling back to 2-legged.
 * 
 * Actions:
 *   "extract"  — Download geometry (OBJ/glTF from APS), parse SVF metadata for level grouping, store manifest
 *   "status"   — Check if a manifest already exists for a building/version
 *   "manifest" — Return the manifest JSON for a building
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

// ── 3-legged token helper (mirrors acc-sync pattern) ──
async function getThreeLeggedToken(userId: string, supabase: any): Promise<string | null> {
  const { data: tokenRow, error } = await supabase
    .from("acc_oauth_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !tokenRow) return null;

  const isExpired = new Date(tokenRow.expires_at) < new Date();
  if (!isExpired) return tokenRow.access_token;

  // Refresh expired token
  const clientId = Deno.env.get("APS_CLIENT_ID");
  const clientSecret = Deno.env.get("APS_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
      }),
    });

    if (!res.ok) {
      console.warn(`[acc-geometry-extract] Token refresh failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    await supabase.from("acc_oauth_tokens").update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRow.refresh_token,
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);

    console.log("[acc-geometry-extract] 3-legged token refreshed");
    return data.access_token;
  } catch (err) {
    console.error("[acc-geometry-extract] Token refresh error:", err);
    return null;
  }
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
      scope: "data:read data:write viewables:read",
    }),
  });
  if (!res.ok) throw new Error(`APS auth failed: ${res.status}`);
  return (await res.json()).access_token;
}

// ── Best available token (prefers 3-legged) ──
async function getBestToken(userId: string | null, supabase: any): Promise<{ token: string; is3Legged: boolean }> {
  if (userId) {
    const threeLeg = await getThreeLeggedToken(userId, supabase);
    if (threeLeg) {
      console.log("[acc-geometry-extract] Using 3-legged token");
      return { token: threeLeg, is3Legged: true };
    }
  }
  console.log("[acc-geometry-extract] Using 2-legged token");
  return { token: await getApsToken(), is3Legged: false };
}

// ── Detect EU region from URN ──
function getRegionEndpoint(urnBase64: string): { mdBase: string; region: string } {
  try {
    const decoded = atob(urnBase64.replace(/-/g, "+").replace(/_/g, "/"));
    if (decoded.includes("wipemea")) {
      return { mdBase: "https://developer.api.autodesk.com/modelderivative/v2/regions/eu/designdata", region: "EU" };
    }
  } catch { /* ignore */ }
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
// Handles APS async 202 responses with polling
async function fetchSvfProperties(urnBase64: string, token: string, mdBase: string): Promise<any> {
  const res = await fetch(`${mdBase}/${urnBase64}/metadata`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.warn(`[acc-geometry-extract] metadata endpoint failed: ${res.status}`);
    return null;
  }
  const meta = await res.json();
  const viewables = meta?.data?.metadata || [];
  if (viewables.length === 0) {
    console.warn("[acc-geometry-extract] No viewables in metadata response");
    return null;
  }

  const view3d = viewables.find((v: any) => v.role === "3d") || viewables[0];
  const viewGuid = view3d.guid;
  console.log(`[acc-geometry-extract] Using viewable guid=${viewGuid}, name=${view3d.name}, role=${view3d.role}`);

  // Fetch properties — may return 202 (processing) for large models
  let propsData: any = null;
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const propsRes = await fetch(`${mdBase}/${urnBase64}/metadata/${viewGuid}/properties?forceget=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (propsRes.status === 202) {
      console.log(`[acc-geometry-extract] Properties not ready (202), retrying in ${10 + attempt * 5}s (attempt ${attempt + 1}/${maxAttempts})`);
      await new Promise(r => setTimeout(r, (10 + attempt * 5) * 1000));
      continue;
    }

    if (!propsRes.ok) {
      console.warn(`[acc-geometry-extract] properties fetch failed: ${propsRes.status}`);
      const errBody = await propsRes.text();
      console.warn(`[acc-geometry-extract] properties error body: ${errBody.substring(0, 500)}`);
      return null;
    }

    propsData = await propsRes.json();
    break;
  }

  if (!propsData) {
    console.warn("[acc-geometry-extract] Properties not ready after max attempts");
    return null;
  }

  // Log the response structure for debugging
  const collection = propsData?.data?.collection || [];
  console.log(`[acc-geometry-extract] Properties response: ${collection.length} objects in collection`);
  if (collection.length > 0) {
    const sample = collection[0];
    console.log(`[acc-geometry-extract] Sample object keys: objectid=${sample.objectid}, name=${sample.name}, externalId=${sample.externalId}`);
    const propGroups = Object.keys(sample.properties || {});
    console.log(`[acc-geometry-extract] Sample property groups: ${propGroups.join(", ")}`);
    // Log first few property groups with their keys
    for (const group of propGroups.slice(0, 3)) {
      const groupKeys = Object.keys(sample.properties[group] || {});
      console.log(`[acc-geometry-extract]   ${group}: ${groupKeys.join(", ")}`);
    }
  }

  return { properties: propsData, viewGuid };
}

// ── Level key detection (multilingual) ──
const LEVEL_KEYS = [
  "Level", "level", "Plan", "plan", "Våning", "våning",
  "Base Level", "Base Constraint", "Reference Level",
  "Etage", "etage", "Niveau", "niveau",
  "Schedule Level", "Building Story", "Building Storey",
];

function findLevelFromProperties(props: Record<string, any>): string | null {
  // Direct top-level check
  for (const key of LEVEL_KEYS) {
    if (props[key]) return String(props[key]);
  }
  // Nested group check (APS returns properties grouped by category like "Constraints", "Identity Data")
  for (const [groupName, group] of Object.entries(props)) {
    if (typeof group === "object" && group !== null && !Array.isArray(group)) {
      for (const key of LEVEL_KEYS) {
        if ((group as any)[key]) return String((group as any)[key]);
      }
    }
  }
  return null;
}

// ── Build level grouping from SVF properties ──
function buildLevelGroups(propertiesResult: any): {
  levelGroups: Map<string, { name: string; dbIds: number[]; externalIds: string[] }>;
  dbIdToExternalId: Map<number, string>;
  dbIdToLevel: Map<number, string>;
} {
  const levelGroups = new Map<string, { name: string; dbIds: number[]; externalIds: string[] }>();
  const dbIdToExternalId = new Map<number, string>();
  const dbIdToLevel = new Map<number, string>();

  const elements = propertiesResult?.properties?.data?.collection || [];
  
  let levelHits = 0;
  let levelMisses = 0;

  for (const element of elements) {
    const dbId = element.objectid;
    const externalId = element.externalId || `dbId_${dbId}`;
    const props = element.properties || {};

    dbIdToExternalId.set(dbId, externalId);

    const levelName = findLevelFromProperties(props);
    if (!levelName) {
      levelMisses++;
      continue;
    }

    levelHits++;
    dbIdToLevel.set(dbId, levelName);
    const levelKey = levelName.toLowerCase().replace(/[^a-z0-9]/g, "_");

    if (!levelGroups.has(levelKey)) {
      levelGroups.set(levelKey, { name: levelName, dbIds: [], externalIds: [] });
    }
    const group = levelGroups.get(levelKey)!;
    group.dbIds.push(dbId);
    group.externalIds.push(externalId);
  }

  console.log(`[acc-geometry-extract] Level assignment: ${levelHits} hits, ${levelMisses} misses out of ${elements.length} total`);
  
  // Log first missed element for debugging
  if (levelMisses > 0 && elements.length > 0) {
    const missedEl = elements.find((e: any) => !findLevelFromProperties(e.properties || {}));
    if (missedEl) {
      const groups = Object.keys(missedEl.properties || {});
      console.log(`[acc-geometry-extract] Sample missed element: name=${missedEl.name}, groups=[${groups.join(",")}]`);
    }
  }

  return { levelGroups, dbIdToExternalId, dbIdToLevel };
}

// ── Deterministic GUID from building + level name ──
async function deterministicGuid(buildingGuid: string, levelName: string): Promise<string> {
  const input = `${buildingGuid}:${levelName}:storey`;
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ── Request OBJ translation from APS Model Derivative ──
async function requestObjTranslation(urnBase64: string, token: string, mdBase: string): Promise<boolean> {
  const jobUrl = mdBase.replace("/designdata", "/designdata/job");
  console.log(`[acc-geometry-extract] Requesting OBJ translation at ${jobUrl}`);
  
  const res = await fetch(jobUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-ads-force": "true",
    },
    body: JSON.stringify({
      input: { urn: urnBase64 },
      output: {
        formats: [{
          type: "obj",
          advanced: { exportFileStructure: "single", unit: "mm" },
        }],
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[acc-geometry-extract] OBJ translation request failed (${res.status}): ${errText}`);
    return false;
  }

  console.log("[acc-geometry-extract] OBJ translation job submitted");
  return true;
}

// ── Poll APS manifest until OBJ derivative is ready ──
async function pollForObjDerivative(
  urnBase64: string, token: string, mdBase: string,
  maxAttempts = 15,
): Promise<{ objUrn: string; mtlUrn: string | null } | null> {
  const delays = [10000, 15000, 20000, 25000, 30000];
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const delay = delays[Math.min(attempt, delays.length - 1)];
    console.log(`[acc-geometry-extract] Polling for OBJ derivative (attempt ${attempt + 1}/${maxAttempts}, wait ${delay / 1000}s)...`);
    await new Promise(r => setTimeout(r, delay));

    const bubble = await fetchApsBubble(urnBase64, token, mdBase);
    
    const objOutput = bubble.derivatives?.find((d: any) => d.outputType === "obj");
    if (objOutput) {
      if (objOutput.status === "success") {
        const objFiles: any[] = [];
        function findObjFiles(node: any) {
          if (node.urn) objFiles.push(node);
          if (node.children) node.children.forEach(findObjFiles);
        }
        findObjFiles(objOutput);
        
        if (objFiles.length > 0) {
          const mtlFile = objFiles.find((f: any) => f.urn?.endsWith(".mtl"));
          const objFile = objFiles.find((f: any) => !f.urn?.endsWith(".mtl")) || objFiles[0];
          console.log(`[acc-geometry-extract] OBJ derivative ready: ${objFile.urn?.substring(0, 60)}`);
          return { objUrn: objFile.urn, mtlUrn: mtlFile?.urn || null };
        }
      } else if (objOutput.status === "failed") {
        console.error("[acc-geometry-extract] OBJ translation failed:", objOutput.messages);
        return null;
      }
    }
  }

  console.warn("[acc-geometry-extract] OBJ derivative not ready after max attempts");
  return null;
}

// ── Download a derivative file from APS ──
async function downloadDerivative(urnBase64: string, derivUrn: string, token: string, mdBase: string): Promise<ArrayBuffer | null> {
  const encodedDerivUrn = encodeURIComponent(derivUrn);
  const url = `${mdBase}/${urnBase64}/manifest/${encodedDerivUrn}`;
  
  console.log(`[acc-geometry-extract] Downloading derivative: ${derivUrn.substring(0, 80)}...`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error(`[acc-geometry-extract] Derivative download failed: ${res.status}`);
    const errText = await res.text();
    console.error(`[acc-geometry-extract] Download error: ${errText.substring(0, 300)}`);
    return null;
  }

  const data = await res.arrayBuffer();
  console.log(`[acc-geometry-extract] Downloaded ${(data.byteLength / 1024 / 1024).toFixed(2)} MB`);
  return data;
}

// ── Build a minimal GLB from OBJ text ──
function objToGlb(objText: string): ArrayBuffer {
  const vertices: number[] = [];
  const indices: number[] = [];
  const lines = objText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) {
      const parts = trimmed.split(/\s+/);
      vertices.push(parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0, parseFloat(parts[3]) || 0);
    } else if (trimmed.startsWith("f ")) {
      const parts = trimmed.split(/\s+/).slice(1);
      const faceIndices = parts.map(p => parseInt(p.split("/")[0]) - 1);
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
      }
    }
  }

  if (vertices.length === 0) {
    console.warn("[acc-geometry-extract] OBJ had 0 vertices, creating empty GLB placeholder");
    return buildGlb(new Float32Array([0,0,0, 1,0,0, 0,1,0]), new Uint32Array([0,1,2]));
  }

  console.log(`[acc-geometry-extract] OBJ parsed: ${vertices.length / 3} vertices, ${indices.length / 3} triangles`);
  return buildGlb(new Float32Array(vertices), new Uint32Array(indices));
}

// ── Build a minimal GLB binary ──
function buildGlb(vertices: Float32Array, indices: Uint32Array, materialColor?: [number, number, number]): ArrayBuffer {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const numVerts = vertices.length / 3;
  for (let i = 0; i < numVerts; i++) {
    const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const vertexByteLength = vertices.byteLength;
  const indexByteLength = indices.byteLength;
  const indexPadding = (4 - (indexByteLength % 4)) % 4;
  const totalBinLength = vertexByteLength + indexByteLength + indexPadding;

  const color = materialColor || [0.7, 0.7, 0.7];
  const gltfJson: any = {
    asset: { version: "2.0", generator: "geminus-acc-geometry-extract" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...color, 1.0], metallicFactor: 0.1, roughnessFactor: 0.8 }, doubleSided: true }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: numVerts, type: "VEC3", min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      { bufferView: 1, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertexByteLength, target: 34962 },
      { buffer: 0, byteOffset: vertexByteLength, byteLength: indexByteLength, target: 34963 },
    ],
    buffers: [{ byteLength: totalBinLength }],
  };

  const jsonString = JSON.stringify(gltfJson);
  const jsonBytes = new TextEncoder().encode(jsonString);
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunkLength = jsonBytes.length + jsonPadding;
  const totalLength = 12 + 8 + jsonChunkLength + 8 + totalBinLength;

  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  const u8 = new Uint8Array(glb);

  let offset = 0;
  view.setUint32(offset, 0x46546C67, true); offset += 4;
  view.setUint32(offset, 2, true); offset += 4;
  view.setUint32(offset, totalLength, true); offset += 4;

  view.setUint32(offset, jsonChunkLength, true); offset += 4;
  view.setUint32(offset, 0x4E4F534A, true); offset += 4;
  u8.set(jsonBytes, offset); offset += jsonBytes.length;
  for (let i = 0; i < jsonPadding; i++) u8[offset++] = 0x20;

  view.setUint32(offset, totalBinLength, true); offset += 4;
  view.setUint32(offset, 0x004E4942, true); offset += 4;
  u8.set(new Uint8Array(vertices.buffer, vertices.byteOffset, vertices.byteLength), offset); offset += vertexByteLength;
  u8.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), offset); offset += indexByteLength;
  for (let i = 0; i < indexPadding; i++) u8[offset++] = 0;

  return glb;
}

// ── Find and download SVF geometry as a raw binary (the SVF itself contains geometry) ──
async function downloadSvfGeometry(
  urnBase64: string,
  token: string,
  mdBase: string,
  bubble: any,
): Promise<ArrayBuffer | null> {
  // Find the SVF derivative
  const allDerivs: any[] = [];
  function collectAll(node: any) {
    if (node.urn) allDerivs.push(node);
    if (node.children) node.children.forEach(collectAll);
    if (node.derivatives) node.derivatives.forEach(collectAll);
  }
  collectAll(bubble);

  // Look for F2D or graphics role derivatives that might be downloadable
  const graphicsDeriv = allDerivs.find(d =>
    d.role === "graphics" && d.mime && d.mime !== "application/autodesk-svf" && d.mime !== "application/autodesk-svf2"
  );
  
  if (graphicsDeriv) {
    console.log(`[acc-geometry-extract] Found downloadable graphics derivative: mime=${graphicsDeriv.mime}`);
    return await downloadDerivative(urnBase64, graphicsDeriv.urn, token, mdBase);
  }

  return null;
}

// ── Download and store real geometry from APS ──
async function downloadRealGeometry(
  urnBase64: string,
  token: string,
  is3Legged: boolean,
  mdBase: string,
  buildingFmGuid: string,
  modelKey: string,
  supabase: any,
): Promise<{ fallbackPath: string | null; glbBytes: number }> {

  const bubble = await fetchApsBubble(urnBase64, token, mdBase);
  const allDerivs: any[] = [];
  function collectDerivs(node: any) {
    if (node.urn) allDerivs.push({ urn: node.urn, role: node.role, mime: node.mime, outputType: node.outputType, name: node.name });
    if (node.children) node.children.forEach(collectDerivs);
    if (node.derivatives) node.derivatives.forEach(collectDerivs);
  }
  collectDerivs(bubble);
  console.log(`[acc-geometry-extract] Found ${allDerivs.length} derivatives in bubble`);
  // Log all derivative types for debugging
  const derivSummary = allDerivs.map(d => `${d.role || "?"}/${d.mime || d.outputType || "?"}`).slice(0, 15);
  console.log(`[acc-geometry-extract] Derivative types: ${derivSummary.join(", ")}`);

  let geometryData: ArrayBuffer | null = null;

  // Priority 1: Existing glTF/GLB derivative
  const gltfDeriv = allDerivs.find(d =>
    d.mime === 'model/gltf-binary' || d.mime === 'model/gltf+json' || d.name?.endsWith('.glb') || d.name?.endsWith('.gltf')
  );
  if (gltfDeriv) {
    console.log("[acc-geometry-extract] Found existing glTF derivative, downloading...");
    geometryData = await downloadDerivative(urnBase64, gltfDeriv.urn, token, mdBase);
  }

  // Priority 2: Existing completed OBJ derivative
  if (!geometryData) {
    const objOutput = bubble.derivatives?.find((d: any) => d.outputType === "obj" && d.status === "success");
    if (objOutput) {
      const objFiles: any[] = [];
      function findObjFiles(node: any) {
        if (node.urn) objFiles.push(node);
        if (node.children) node.children.forEach(findObjFiles);
      }
      findObjFiles(objOutput);
      const objFile = objFiles.find((f: any) => !f.urn?.endsWith(".mtl"));
      if (objFile) {
        console.log("[acc-geometry-extract] Found existing OBJ derivative, downloading...");
        const objData = await downloadDerivative(urnBase64, objFile.urn, token, mdBase);
        if (objData && objData.byteLength > 100) {
          const objText = new TextDecoder().decode(objData);
          geometryData = objToGlb(objText);
        }
      }
    }
  }

  // Priority 3: Request new OBJ translation (try 3-legged first, fallback to 2-legged)
  if (!geometryData) {
    console.log("[acc-geometry-extract] No existing geometry — requesting OBJ translation...");
    
    let requested = await requestObjTranslation(urnBase64, token, mdBase);
    
    // If 3-legged fails with 403, retry with 2-legged token which has data:write scope
    if (!requested && is3Legged) {
      console.log("[acc-geometry-extract] 3-legged OBJ request failed, retrying with 2-legged token...");
      try {
        const twoLegToken = await getApsToken();
        requested = await requestObjTranslation(urnBase64, twoLegToken, mdBase);
        
        if (requested) {
          // Use 2-legged token for polling too
          const objResult = await pollForObjDerivative(urnBase64, twoLegToken, mdBase);
          if (objResult) {
            const objData = await downloadDerivative(urnBase64, objResult.objUrn, twoLegToken, mdBase);
            if (objData && objData.byteLength > 100) {
              const firstBytes = new Uint8Array(objData.slice(0, 4));
              if (firstBytes[0] === 0x67 && firstBytes[1] === 0x6C && firstBytes[2] === 0x54 && firstBytes[3] === 0x46) {
                geometryData = objData;
              } else {
                const objText = new TextDecoder().decode(objData);
                geometryData = objToGlb(objText);
              }
            }
          }
        }
      } catch (err) {
        console.error("[acc-geometry-extract] 2-legged fallback failed:", err);
      }
    } else if (requested) {
      // Poll with the same token
      const objResult = await pollForObjDerivative(urnBase64, token, mdBase);
      if (objResult) {
        const objData = await downloadDerivative(urnBase64, objResult.objUrn, token, mdBase);
        if (objData && objData.byteLength > 100) {
          const firstBytes = new Uint8Array(objData.slice(0, 4));
          if (firstBytes[0] === 0x67 && firstBytes[1] === 0x6C && firstBytes[2] === 0x54 && firstBytes[3] === 0x46) {
            geometryData = objData;
          } else {
            const objText = new TextDecoder().decode(objData);
            geometryData = objToGlb(objText);
          }
        }
      }
    }
  }

  if (!geometryData || geometryData.byteLength < 100) {
    console.warn("[acc-geometry-extract] Could not obtain any real geometry from APS");
    return { fallbackPath: null, glbBytes: 0 };
  }

  // Store as monolithic fallback GLB
  const fallbackStoragePath = `${buildingFmGuid}/${modelKey}_full.glb`;
  const { error: uploadErr } = await supabase.storage.from("xkt-models").upload(
    fallbackStoragePath,
    new Blob([geometryData], { type: "model/gltf-binary" }),
    { upsert: true, contentType: "model/gltf-binary" },
  );

  if (uploadErr) {
    console.error("[acc-geometry-extract] Failed to upload monolithic GLB:", uploadErr);
    return { fallbackPath: null, glbBytes: 0 };
  }

  console.log(`[acc-geometry-extract] Monolithic GLB stored: ${fallbackStoragePath} (${(geometryData.byteLength / 1024 / 1024).toFixed(1)} MB)`);
  return { fallbackPath: fallbackStoragePath, glbBytes: geometryData.byteLength };
}

// ── Enrich geometry_index with fm_guid from asset_external_ids ──
async function enrichWithFmGuids(
  geometryIndex: { mapping: GeometryIndexEntry[] },
  supabase: any,
): Promise<number> {
  if (geometryIndex.mapping.length === 0) return 0;

  const externalIds = geometryIndex.mapping.map(m => m.externalId).filter(id => !id.startsWith("dbId_"));
  if (externalIds.length === 0) return 0;

  let enriched = 0;
  const fmGuidMap = new Map<string, string>();
  
  for (let i = 0; i < externalIds.length; i += 500) {
    const batch = externalIds.slice(i, i + 500);
    const { data } = await supabase
      .from("asset_external_ids")
      .select("external_id, fm_guid")
      .in("external_id", batch);
    
    if (data) {
      data.forEach((row: any) => fmGuidMap.set(row.external_id, row.fm_guid));
    }
  }

  for (const entry of geometryIndex.mapping) {
    const fmGuid = fmGuidMap.get(entry.externalId);
    if (fmGuid) {
      entry.fm_guid = fmGuid;
      enriched++;
    }
  }

  return enriched;
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
    const { action, buildingFmGuid, versionUrn, modelKey, accProjectId, userId } = body;

    if (!buildingFmGuid) {
      return new Response(JSON.stringify({ error: "buildingFmGuid required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STATUS ──
    if (action === "status") {
      const { data: files } = await supabase.storage
        .from("xkt-models")
        .list(buildingFmGuid, { limit: 100 });

      const hasManifest = files?.some((f: any) => f.name === "_geometry_manifest.json");
      return new Response(JSON.stringify({ hasManifest: !!hasManifest }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── MANIFEST ──
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

      return new Response(JSON.stringify(await manifestRes.json()), {
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

      // Idempotency check
      const { data: existingFiles } = await supabase.storage
        .from("xkt-models")
        .list(buildingFmGuid, { limit: 100 });
      
      const existingManifest = existingFiles?.find((f: any) => f.name === "_geometry_manifest.json");
      if (existingManifest && !body.force) {
        console.log(`[acc-geometry-extract] Manifest already exists, skipping (use force=true)`);
        return new Response(JSON.stringify({ success: true, skipped: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const urnBase64 = btoa(versionUrn).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const { mdBase, region } = getRegionEndpoint(urnBase64);
      const effectiveModelKey = modelKey || buildingFmGuid;
      const versionStamp = new Date().toISOString();

      console.log(`[acc-geometry-extract] Starting extract for ${buildingFmGuid}, region=${region}`);

      // Step 1: Get best token (3-legged preferred)
      const { token, is3Legged } = await getBestToken(userId || null, supabase);

      // Step 2: Check SVF translation status
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

      // Step 3: Fetch SVF properties for level grouping
      console.log("[acc-geometry-extract] Fetching SVF properties...");
      const propertiesResult = await fetchSvfProperties(urnBase64, token, mdBase);
      
      if (!propertiesResult) {
        console.warn("[acc-geometry-extract] Properties unavailable — continuing without level data");
      }

      const { levelGroups, dbIdToExternalId } = propertiesResult
        ? buildLevelGroups(propertiesResult)
        : { levelGroups: new Map(), dbIdToExternalId: new Map(), dbIdToLevel: new Map() };
      console.log(`[acc-geometry-extract] Found ${levelGroups.size} levels, ${dbIdToExternalId.size} elements`);

      // Step 4: Download real geometry from APS (OBJ/glTF → GLB)
      const { fallbackPath, glbBytes } = await downloadRealGeometry(
        urnBase64, token, is3Legged, mdBase,
        buildingFmGuid, effectiveModelKey, supabase,
      );

      // Step 5: Build manifest with level metadata
      const manifestChunks: ManifestChunk[] = [];
      let priority = 0;

      for (const [_levelKey, group] of levelGroups) {
        const storeyGuid = await deterministicGuid(buildingFmGuid, group.name);
        manifestChunks.push({
          storeyGuid,
          storeyName: group.name,
          priority: priority++,
          url: "",
          bbox: [],
          elementCount: group.dbIds.length,
          format: "glb",
        });
      }

      // Sort by name
      manifestChunks.sort((a, b) => a.storeyName.localeCompare(b.storeyName, "sv"));
      manifestChunks.forEach((c, i) => { c.priority = i; });

      const manifest: GeometryManifest = {
        modelId: effectiveModelKey,
        source: { accProjectId: accProjectId || "", accFileUrn: versionUrn, apsRegion: region },
        version: versionStamp,
        format: "glb",
        coordinateSystem: { up: "Z", units: "mm" },
        materialPolicy: { textures: false },
        chunks: manifestChunks,
        fallback: fallbackPath ? { url: fallbackPath } : null,
      };

      // Step 6: Build geometry index
      const geometryIndex: { modelId: string; version: string; mapping: GeometryIndexEntry[] } = {
        modelId: effectiveModelKey,
        version: versionStamp,
        mapping: [],
      };

      for (const [_levelKey, group] of levelGroups) {
        const storeyGuid = await deterministicGuid(buildingFmGuid, group.name);
        for (let i = 0; i < group.dbIds.length; i++) {
          geometryIndex.mapping.push({
            externalId: group.externalIds[i],
            storeyGuid,
            dbId: group.dbIds[i],
            fm_guid: null,
          });
        }
      }

      const enrichedCount = await enrichWithFmGuids(geometryIndex, supabase);

      // Step 7: Store manifest + index
      const [manifestUpload, indexUpload] = await Promise.all([
        supabase.storage.from("xkt-models").upload(
          `${buildingFmGuid}/_geometry_manifest.json`,
          new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
          { upsert: true, contentType: "application/json" },
        ),
        supabase.storage.from("xkt-models").upload(
          `${buildingFmGuid}/_geometry_index.json`,
          new Blob([JSON.stringify(geometryIndex, null, 2)], { type: "application/json" }),
          { upsert: true, contentType: "application/json" },
        ),
      ]);

      if (manifestUpload.error) console.error("[acc-geometry-extract] Manifest upload failed:", manifestUpload.error);
      if (indexUpload.error) console.error("[acc-geometry-extract] Index upload failed:", indexUpload.error);

      console.log(`[acc-geometry-extract] ✅ Pipeline complete: ${manifestChunks.length} level metadata entries, ${geometryIndex.mapping.length} mapped, ${enrichedCount} fm_guids, fallback=${!!fallbackPath} (${(glbBytes / 1024 / 1024).toFixed(1)} MB)`);

      return new Response(JSON.stringify({
        success: true,
        manifest,
        stats: {
          levels: levelGroups.size,
          totalElements: dbIdToExternalId.size,
          mappedElements: geometryIndex.mapping.length,
          enrichedFmGuids: enrichedCount,
          hasFallback: !!fallbackPath,
          fallbackSizeMB: +(glbBytes / 1024 / 1024).toFixed(1),
          tokenType: is3Legged ? "3-legged" : "2-legged",
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
