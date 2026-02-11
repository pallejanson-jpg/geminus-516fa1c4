import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, unauthorizedResponse, forbiddenResponse, corsHeaders } from "../_shared/auth.ts";

/**
 * acc-svf-to-gltf: Server-side SVF to GLB conversion
 * 
 * Uses the Model Derivative API to read SVF fragments and assemble them
 * into a single GLB (binary glTF) file stored in Supabase Storage.
 * 
 * This is needed because RVT files can only be translated to SVF/SVF2
 * by Autodesk, and SVF2 is a multi-file format that cannot be downloaded
 * as a single file for client-side conversion.
 * 
 * Pipeline:
 * 1. Get the SVF manifest from Model Derivative API
 * 2. Find the SVF bubble and its geometry/material resources
 * 3. Download all fragments, geometries, and materials
 * 4. Assemble into a minimal GLB (binary glTF 2.0)
 * 5. Upload to Supabase Storage
 * 6. Return signed URL
 */

// ============ APS TOKEN ============

async function getApsAccessToken(): Promise<string> {
  const clientId = Deno.env.get("APS_CLIENT_ID");
  const clientSecret = Deno.env.get("APS_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Missing APS credentials");

  const res = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Accept": "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "data:read data:write",
    }),
  });

  if (!res.ok) throw new Error(`APS auth failed (${res.status})`);
  const data = await res.json();
  return data.access_token;
}

// Try 3-legged token first
async function getAccToken(userId: string | null, serviceClient: any): Promise<string> {
  if (userId) {
    const { data: tokenRow } = await serviceClient
      .from("acc_oauth_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokenRow) {
      const isExpired = new Date(tokenRow.expires_at) < new Date();
      if (!isExpired) return tokenRow.access_token;

      // Try refresh
      try {
        const clientId = Deno.env.get("APS_CLIENT_ID")!;
        const clientSecret = Deno.env.get("APS_CLIENT_SECRET")!;
        const res = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokenRow.refresh_token,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await serviceClient.from("acc_oauth_tokens").update({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
          }).eq("user_id", userId);
          return data.access_token;
        }
      } catch { /* fall through to 2-legged */ }
    }
  }
  return getApsAccessToken();
}

// ============ SVF MANIFEST PARSING ============

interface SvfResource {
  urn: string;
  role: string;
  mime?: string;
  type?: string;
  guid?: string;
}

function collectResources(node: any, resources: SvfResource[] = []): SvfResource[] {
  if (node.urn) {
    resources.push({
      urn: node.urn,
      role: node.role || '',
      mime: node.mime,
      type: node.type,
      guid: node.guid,
    });
  }
  if (node.children) for (const c of node.children) collectResources(c, resources);
  if (node.derivatives) for (const d of node.derivatives) collectResources(d, resources);
  return resources;
}

// ============ GLB BUILDER ============

/**
 * Build a minimal GLB from downloaded OBJ-like geometry data.
 * This creates a valid glTF 2.0 binary with embedded buffers.
 */
function buildMinimalGlb(positions: Float32Array, indices: Uint32Array): Uint8Array {
  // Buffer: positions + indices
  const posBytes = positions.byteLength;
  const idxBytes = indices.byteLength;
  // Pad position buffer to 4-byte alignment
  const posPadded = posBytes + (posBytes % 4 === 0 ? 0 : 4 - posBytes % 4);
  const totalBufferSize = posPadded + idxBytes;

  const bufferData = new ArrayBuffer(totalBufferSize);
  new Float32Array(bufferData, 0, positions.length).set(positions);
  new Uint32Array(bufferData, posPadded, indices.length).set(indices);

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  const gltfJson: any = {
    asset: { version: "2.0", generator: "geminus-svf-converter" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        mode: 4, // TRIANGLES
      }],
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: positions.length / 3,
        type: "VEC3",
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
      },
      {
        bufferView: 1,
        componentType: 5125, // UNSIGNED_INT
        count: indices.length,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 }, // ARRAY_BUFFER
      { buffer: 0, byteOffset: posPadded, byteLength: idxBytes, target: 34963 }, // ELEMENT_ARRAY_BUFFER
    ],
    buffers: [{ byteLength: totalBufferSize }],
  };

  const jsonStr = JSON.stringify(gltfJson);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  // Pad JSON chunk to 4-byte alignment
  const jsonPadded = jsonBytes.length + (jsonBytes.length % 4 === 0 ? 0 : 4 - jsonBytes.length % 4);

  // GLB structure: 12-byte header + JSON chunk (8 + jsonPadded) + BIN chunk (8 + totalBufferSize)
  const glbSize = 12 + 8 + jsonPadded + 8 + totalBufferSize;
  const glb = new ArrayBuffer(glbSize);
  const view = new DataView(glb);
  const bytes = new Uint8Array(glb);

  // GLB Header
  view.setUint32(0, 0x46546C67, true); // magic "glTF"
  view.setUint32(4, 2, true); // version 2
  view.setUint32(8, glbSize, true); // total length

  // JSON chunk
  let offset = 12;
  view.setUint32(offset, jsonPadded, true); // chunk length
  view.setUint32(offset + 4, 0x4E4F534A, true); // "JSON"
  bytes.set(jsonBytes, offset + 8);
  // Pad with spaces
  for (let i = jsonBytes.length; i < jsonPadded; i++) {
    bytes[offset + 8 + i] = 0x20;
  }

  // BIN chunk
  offset = 12 + 8 + jsonPadded;
  view.setUint32(offset, totalBufferSize, true);
  view.setUint32(offset + 4, 0x004E4942, true); // "BIN\0"
  new Uint8Array(glb, offset + 8, totalBufferSize).set(new Uint8Array(bufferData));

  return new Uint8Array(glb);
}

// ============ SVF GEOMETRY EXTRACTION ============

/**
 * Download and parse SVF geometry from the Model Derivative API.
 * 
 * The approach:
 * 1. Get the manifest to find the SVF bubble
 * 2. Download the SVF viewable (the packed binary that contains geometry)
 * 3. Parse the pack file to extract mesh data
 * 4. Build a GLB from the extracted geometry
 * 
 * For simplicity, we download the raw SVF resource and attempt to extract
 * position/index data from the binary pack files.
 */
async function extractSvfGeometry(
  token: string,
  urnBase64: string,
  resources: SvfResource[],
  log: (msg: string) => void,
  mdBase: string = "https://developer.api.autodesk.com/modelderivative/v2/designdata",
): Promise<{ positions: Float32Array; indices: Uint32Array } | null> {
  // Find geometry resources - look for pack files (role=graphics or Autodesk.CloudPlatform.PackFile)
  const packResources = resources.filter(r =>
    r.role === 'graphics' ||
    r.mime === 'application/autodesk-svf' ||
    r.urn?.includes('Resource/') ||
    r.type === 'resource'
  );

  log(`Found ${packResources.length} potential geometry resources out of ${resources.length} total`);

  if (packResources.length === 0) {
    // Try downloading ANY resource to see what we get
    log('No pack files found, trying first available resource...');
    if (resources.length === 0) return null;
  }

  // For SVF, the geometry is typically in pack files within the bubble.
  // We need to download the viewable root (the SVF file itself) which contains
  // references to all geometry fragments.
  
  // Find the main SVF viewable
  const svfViewable = resources.find(r =>
    r.mime === 'application/autodesk-svf' ||
    r.role === 'graphics' ||
    r.role === 'viewable'
  );

  if (!svfViewable) {
    log('No SVF viewable found in resources');
    return null;
  }

  log(`Downloading SVF viewable: ${svfViewable.urn?.substring(0, 80)}...`);
  
  const encodedUrn = encodeURIComponent(svfViewable.urn);
  const downloadUrl = `${mdBase}/${urnBase64}/manifest/${encodedUrn}`;
  
  const res = await fetch(downloadUrl, {
    headers: { "Authorization": `Bearer ${token}` },
  });

  if (!res.ok) {
    log(`Failed to download SVF viewable: ${res.status}`);
    return null;
  }

  const data = new Uint8Array(await res.arrayBuffer());
  log(`Downloaded SVF data: ${(data.byteLength / 1024 / 1024).toFixed(2)} MB`);

  // SVF pack files contain geometry in a proprietary binary format.
  // For a basic extraction, we look for mesh data patterns.
  // This is a simplified approach - for production, use forge-convert-utils.
  
  // Try to find embedded mesh data by looking for common patterns
  // SVF geometry fragments typically contain:
  // - Float32 position arrays
  // - Uint16/Uint32 index arrays
  // - Transformation matrices
  
  // For now, create a placeholder geometry if we can't parse the SVF directly.
  // The actual SVF parsing would require implementing the full SVF binary format reader.
  
  // Return null to indicate we need to try a different approach
  log('SVF binary parsing requires forge-convert-utils. Trying OBJ fallback...');
  return null;
}

/**
 * Alternative: Try to get OBJ format from the manifest
 * (Autodesk may have already generated OBJ for some file types)
 */
async function tryDownloadObjDerivative(
  token: string,
  urnBase64: string,
  resources: SvfResource[],
  log: (msg: string) => void,
  mdBase: string = "https://developer.api.autodesk.com/modelderivative/v2/designdata",
): Promise<Uint8Array | null> {
  // Look for OBJ derivatives
  const objResource = resources.find(r =>
    r.mime === 'application/octet-stream' && r.role === 'graphics' ||
    r.urn?.endsWith('.obj')
  );

  if (!objResource) {
    log('No OBJ derivative found');
    return null;
  }

  const encodedUrn = encodeURIComponent(objResource.urn);
  const url = `${mdBase}/${urnBase64}/manifest/${encodedUrn}`;
  
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  if (!res.ok) return null;

  return new Uint8Array(await res.arrayBuffer());
}

// ============ MAIN HANDLER ============

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await verifyAuth(req);
    if (!auth.authenticated) return unauthorizedResponse(auth.error);
    if (!auth.isAdmin) return forbiddenResponse();

    const body = await req.json();
    const { versionUrn, buildingFmGuid, fileName } = body;

    if (!versionUrn) {
      return new Response(
        JSON.stringify({ success: false, error: "versionUrn is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = await getAccToken(auth.userId, supabase);
    const urnBase64 = btoa(versionUrn).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    // Detect EMEA region from URN
    const decodedUrnSvf = (() => { try { return atob(urnBase64.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } })();
    const isEmeaSvf = decodedUrnSvf.includes('wipemea');
    const mdBase = isEmeaSvf
      ? "https://developer.api.autodesk.com/modelderivative/v2/regions/eu/designdata"
      : "https://developer.api.autodesk.com/modelderivative/v2/designdata";

    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(`[svf-to-gltf] ${msg}`);
      logs.push(msg);
    };

    log(`Starting SVF to GLB conversion for ${fileName || versionUrn.substring(0, 40)}...`);
    log(`Region: ${isEmeaSvf ? 'EMEA' : 'US'}`);

    // Step 1: Get manifest
    log('Fetching manifest...');
    const manifestRes = await fetch(
      `${mdBase}/${urnBase64}/manifest`,
      { headers: { "Authorization": `Bearer ${token}` } },
    );

    if (!manifestRes.ok) {
      const errText = await manifestRes.text();
      return new Response(
        JSON.stringify({ success: false, error: `Manifest failed (${manifestRes.status}): ${errText}`, logs }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const manifest = await manifestRes.json();

    if (manifest.status !== "success") {
      return new Response(
        JSON.stringify({ success: false, error: `Translation not complete (status: ${manifest.status})`, logs }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Collect all resources from the manifest
    const resources = collectResources(manifest);
    log(`Found ${resources.length} resources in manifest`);

    // Log resource summary
    const roleCounts: Record<string, number> = {};
    for (const r of resources) {
      const key = `${r.role || 'unknown'}:${r.mime || 'unknown'}`;
      roleCounts[key] = (roleCounts[key] || 0) + 1;
    }
    log(`Resource types: ${JSON.stringify(roleCounts)}`);

    // Strategy 1: Try to find an existing OBJ/glTF derivative
    const gltfResource = resources.find(r =>
      r.mime === 'model/gltf-binary' || r.mime === 'model/gltf+json'
    );
    const objResource = resources.find(r =>
      r.role === 'graphics' && (r.mime === 'application/octet-stream' || r.urn?.includes('.obj'))
    );

    let glbData: Uint8Array | null = null;

    if (gltfResource) {
      log('Found existing glTF derivative, downloading...');
      const encodedUrn = encodeURIComponent(gltfResource.urn);
      const url = `${mdBase}/${urnBase64}/manifest/${encodedUrn}`;
      const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
      if (res.ok) {
        glbData = new Uint8Array(await res.arrayBuffer());
        log(`Downloaded glTF: ${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB`);
      }
    }

    // Strategy 2: Request a new OBJ translation if no single-file derivative exists
    if (!glbData) {
      log('No single-file derivative found. Requesting OBJ translation...');
      
      // Trigger OBJ translation
      const objJobRes = await fetch(`${mdBase}/job`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-ads-force": "true",
        },
        body: JSON.stringify({
          input: { urn: urnBase64 },
          output: {
            formats: [{ type: "obj" }],
          },
        }),
      });

      if (objJobRes.ok) {
        const jobData = await objJobRes.json();
        log(`OBJ translation job submitted: ${jobData.result || 'pending'}`);

        // Poll for OBJ completion (max 5 minutes)
        const maxPollTime = 300000;
        const pollInterval = 10000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxPollTime) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          const checkRes = await fetch(
            `${mdBase}/${urnBase64}/manifest`,
            { headers: { "Authorization": `Bearer ${token}` } },
          );

          if (!checkRes.ok) continue;
          const checkManifest = await checkRes.json();

          // Check if OBJ derivative is ready
          const allDerivs: SvfResource[] = [];
          collectResources(checkManifest, allDerivs);

          const objDeriv = allDerivs.find(d =>
            d.mime === 'application/octet-stream' && d.role === 'graphics'
          );

          // Check overall status
          const objOutputDone = checkManifest.derivatives?.some((d: any) =>
            d.outputType === 'obj' && d.status === 'success'
          );
          const objOutputFailed = checkManifest.derivatives?.some((d: any) =>
            d.outputType === 'obj' && d.status === 'failed'
          );

          if (objOutputFailed) {
            log('OBJ translation failed. This file type may not support OBJ export.');
            break;
          }

          if (objOutputDone && objDeriv) {
            log('OBJ derivative ready, downloading...');
            const encodedUrn = encodeURIComponent(objDeriv.urn);
            const url = `${mdBase}/${urnBase64}/manifest/${encodedUrn}`;
            const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
            if (res.ok) {
              const objData = new Uint8Array(await res.arrayBuffer());
              log(`Downloaded OBJ: ${(objData.byteLength / 1024 / 1024).toFixed(2)} MB`);
              
              // Convert OBJ text to simple GLB
              const objText = new TextDecoder().decode(objData);
              glbData = convertObjToGlb(objText, log);
            }
            break;
          }

          const elapsed = Math.round((Date.now() - startTime) / 1000);
          log(`Waiting for OBJ translation... (${elapsed}s)`);
        }
      } else {
        const errText = await objJobRes.text();
        log(`OBJ translation request failed: ${objJobRes.status} - ${errText}`);
        
        // RVT files may not support OBJ - this is expected
        if (objJobRes.status === 400 || objJobRes.status === 403) {
          log('This file type does not support OBJ export (likely RVT).');
        }
      }
    }

    // Strategy 3: Download the SVF viewable data directly and try to extract geometry
    if (!glbData) {
      log('Attempting direct SVF geometry extraction...');
      const geom = await extractSvfGeometry(token, urnBase64, resources, log);
      if (geom) {
        glbData = buildMinimalGlb(geom.positions, geom.indices);
        log(`Built GLB from SVF geometry: ${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB`);
      }
    }

    if (!glbData) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Kunde inte konvertera modellen till 3D-format. " +
                 "RVT-filer stöder inte OBJ-export via Autodesk API, och SVF-geometri kräver specialiserad parsing. " +
                 "Hierarkidata (byggnader, våningar, rum) synkas via BIM-synk.",
          logs,
          formatLimitation: true,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Upload GLB to storage
    const safeName = (fileName || 'model').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const storagePath = `${buildingFmGuid || 'acc-derivatives'}/acc-glb-${safeName}.glb`;
    
    log(`Uploading GLB to storage: ${storagePath} (${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB)`);

    const blob = new Blob([glbData], { type: "model/gltf-binary" });
    const { error: uploadError } = await supabase.storage
      .from("xkt-models")
      .upload(storagePath, blob, { contentType: "model/gltf-binary", upsert: true });

    if (uploadError) {
      return new Response(
        JSON.stringify({ success: false, error: `Upload failed: ${uploadError.message}`, logs }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Generate signed URL
    const { data: urlData } = await supabase.storage
      .from("xkt-models")
      .createSignedUrl(storagePath, 3600);

    log('GLB conversion and upload complete!');

    return new Response(
      JSON.stringify({
        success: true,
        downloadUrl: urlData?.signedUrl || null,
        storagePath,
        fileSize: glbData.byteLength,
        logs,
        message: `Modell konverterad till GLB (${(glbData.byteLength / 1024 / 1024).toFixed(2)} MB)`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (error) {
    console.error("SVF-to-GLB error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============ OBJ TO GLB CONVERTER ============

function convertObjToGlb(objText: string, log: (msg: string) => void): Uint8Array | null {
  const positions: number[] = [];
  const indices: number[] = [];
  const vertices: number[] = [];

  const lines = objText.split('\n');
  let faceCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('v ')) {
      const parts = trimmed.split(/\s+/);
      vertices.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
    } else if (trimmed.startsWith('f ')) {
      const parts = trimmed.split(/\s+/).slice(1);
      // Parse face vertices (format: v, v/vt, v/vt/vn, or v//vn)
      const faceIndices = parts.map(p => parseInt(p.split('/')[0]) - 1);
      
      // Triangulate polygon faces (fan triangulation)
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
        faceCount++;
      }
    }
  }

  if (vertices.length === 0) {
    log('OBJ contains no vertices');
    return null;
  }

  log(`OBJ parsed: ${vertices.length / 3} vertices, ${faceCount} triangles`);

  const posArray = new Float32Array(vertices);
  const idxArray = new Uint32Array(indices);

  return buildMinimalGlb(posArray, idxArray);
}
