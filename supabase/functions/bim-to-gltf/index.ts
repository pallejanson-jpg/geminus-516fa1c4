import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Download WASM files and redirect so web-ifc can find them in Deno edge */
async function ensureWasm(): Promise<string> {
  const dir = "/tmp/web-ifc-wasm";
  try { await Deno.mkdir(dir, { recursive: true }); } catch (_) { /* exists */ }

  const files = ["web-ifc.wasm", "web-ifc-node.wasm"];
  const baseUrl = "https://unpkg.com/web-ifc@0.0.57";

  for (const file of files) {
    const dest = `${dir}/${file}`;
    try {
      await Deno.stat(dest);
    } catch {
      console.log(`[bim-to-gltf] Downloading ${file}...`);
      const resp = await fetch(`${baseUrl}/${file}`);
      if (resp.ok) {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        await Deno.writeFile(dest, bytes);
        console.log(`[bim-to-gltf] Saved ${file} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        console.warn(`[bim-to-gltf] Could not download ${file}: ${resp.status}`);
      }
    }
  }

  // Redirect Deno.readFileSync from internal npm path to /tmp
  const expectedPrefix = "/var/tmp/sb-compile-edge-runtime/node_modules/localhost/web-ifc/0.0.57/tmp/web-ifc-wasm/";
  const originalReadFileSync = Deno.readFileSync;
  // @ts-ignore - monkey-patching for WASM resolution
  Deno.readFileSync = (path: string | URL) => {
    const p = typeof path === "string" ? path : path.toString();
    if (p.startsWith(expectedPrefix)) {
      const fileName = p.substring(expectedPrefix.length);
      const redirected = `${dir}/${fileName}`;
      console.log(`[bim-to-gltf] WASM redirect: ${p} -> ${redirected}`);
      return originalReadFileSync(redirected);
    }
    return originalReadFileSync(path);
  };

  console.log(`[bim-to-gltf] WASM ready at ${dir}/`);
  return dir + "/";
}

/**
 * Edge function: bim-to-gltf
 * Converts IFC files to GLB format for Cesium globe display.
 * 
 * Actions:
 *   "check"  — check if a cached GLB exists for a building
 *   "convert" — convert IFC → GLB, cache, and return signed URL
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { action, buildingFmGuid } = await req.json();

    if (!buildingFmGuid) {
      return new Response(
        JSON.stringify({ error: "buildingFmGuid is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const glbPath = `${buildingFmGuid}/model.glb`;

    // ── CHECK: return cached GLB URL if it exists ──
    if (action === "check") {
      const { data: files } = await supabase.storage
        .from("glb-models")
        .list(buildingFmGuid, { limit: 1 });

      if (files && files.length > 0) {
        const { data: urlData } = await supabase.storage
          .from("glb-models")
          .createSignedUrl(glbPath, 3600);

        if (urlData?.signedUrl) {
          return new Response(
            JSON.stringify({ cached: true, glbUrl: urlData.signedUrl }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Check if IFC source exists
      const { data: ifcFiles } = await supabase.storage
        .from("ifc-uploads")
        .list(buildingFmGuid, { limit: 10 });

      const ifcFile = ifcFiles?.find(f => f.name.toLowerCase().endsWith(".ifc"));

      // Check if XKT source exists
      const { data: xktFiles } = await supabase.storage
        .from("xkt-models")
        .list(buildingFmGuid, { limit: 50 });

      const xktFile = xktFiles?.find(f => f.name.toLowerCase().endsWith(".xkt"));

      const { data: accTranslation } = await supabase
        .from("acc_model_translations")
        .select("version_urn")
        .eq("building_fm_guid", buildingFmGuid)
        .eq("translation_status", "success")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return new Response(
        JSON.stringify({
          cached: false,
          hasIfc: !!ifcFile,
          ifcFileName: ifcFile?.name || null,
          hasXkt: !!xktFile,
          xktFileName: xktFile?.name || null,
          hasAccTranslation: !!accTranslation?.version_urn,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── CONVERT: IFC → GLB ──
    if (action === "convert") {
      console.log(`[bim-to-gltf] Starting conversion for ${buildingFmGuid}`);

      // 1. Try IFC source first
      const { data: ifcFiles } = await supabase.storage
        .from("ifc-uploads")
        .list(buildingFmGuid, { limit: 10 });

      const ifcFile = ifcFiles?.find(f => f.name.toLowerCase().endsWith(".ifc"));

      if (ifcFile) {
        const ifcPath = `${buildingFmGuid}/${ifcFile.name}`;
        console.log(`[bim-to-gltf] Downloading IFC: ${ifcPath}`);

        const { data: ifcBlob, error: dlError } = await supabase.storage
          .from("ifc-uploads")
          .download(ifcPath);

        if (dlError || !ifcBlob) {
          throw new Error(`Failed to download IFC: ${dlError?.message || "no data"}`);
        }

        const ifcBuffer = await ifcBlob.arrayBuffer();
        const sizeMB = ifcBuffer.byteLength / (1024 * 1024);
        console.log(`[bim-to-gltf] IFC size: ${sizeMB.toFixed(1)} MB`);

        // Ensure WASM is available before importing web-ifc
        await ensureWasm();

        // 2. Parse IFC with web-ifc
        const WebIFC = await import("npm:web-ifc@0.0.57");
        const ifcApi = new WebIFC.IfcAPI();
        await ifcApi.Init();

        const modelID = ifcApi.OpenModel(new Uint8Array(ifcBuffer));
        console.log(`[bim-to-gltf] IFC model opened, ID: ${modelID}`);

        // 3. Extract all mesh geometry
        const allVertices: number[] = [];
        const allIndices: number[] = [];
        let vertexOffset = 0;

        ifcApi.StreamAllMeshes(modelID, (mesh: any) => {
          const numGeometries = mesh.geometries.size();
          for (let i = 0; i < numGeometries; i++) {
            const placedGeom = mesh.geometries.get(i);
            const geomData = ifcApi.GetGeometry(modelID, placedGeom.geometryExpressID);

            const vertsData = ifcApi.GetVertexArray(
              geomData.GetVertexData(),
              geomData.GetVertexDataSize()
            );
            const idxData = ifcApi.GetIndexArray(
              geomData.GetIndexData(),
              geomData.GetIndexDataSize()
            );

            // web-ifc returns 6 floats per vertex: x,y,z, nx,ny,nz
            const numVerts = vertsData.length / 6;

            // Apply transformation matrix
            const matrix = placedGeom.flatTransformation;

            for (let v = 0; v < numVerts; v++) {
              const x = vertsData[v * 6];
              const y = vertsData[v * 6 + 1];
              const z = vertsData[v * 6 + 2];

              // Apply 4x4 transform (column-major)
              const tx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
              const ty = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
              const tz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];

              allVertices.push(tx, ty, tz);
            }

            for (let idx = 0; idx < idxData.length; idx++) {
              allIndices.push(idxData[idx] + vertexOffset);
            }

            vertexOffset += numVerts;

            // Free geometry data
            geomData.delete?.();
          }
        });

        ifcApi.CloseModel(modelID);
        console.log(`[bim-to-gltf] Extracted ${vertexOffset} vertices, ${allIndices.length} indices`);

        if (vertexOffset === 0) {
          return new Response(
            JSON.stringify({ error: "No geometry found in IFC file" }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // 4. Build minimal GLB
        const glbBuffer = buildGlb(new Float32Array(allVertices), new Uint32Array(allIndices));
        const glbSizeMB = glbBuffer.byteLength / (1024 * 1024);
        console.log(`[bim-to-gltf] GLB size: ${glbSizeMB.toFixed(2)} MB`);

        // 5. Upload to storage
        const { error: uploadError } = await supabase.storage
          .from("glb-models")
          .upload(glbPath, glbBuffer, {
            contentType: "model/gltf-binary",
            upsert: true,
          });

        if (uploadError) {
          throw new Error(`GLB upload failed: ${uploadError.message}`);
        }

        // 6. Get signed URL
        const { data: urlData } = await supabase.storage
          .from("glb-models")
          .createSignedUrl(glbPath, 3600);

        console.log(`[bim-to-gltf] ✅ IFC conversion complete`);

        return new Response(
          JSON.stringify({
            success: true,
            source: "ifc",
            glbUrl: urlData?.signedUrl || null,
            glbSizeMB: parseFloat(glbSizeMB.toFixed(2)),
            vertexCount: vertexOffset,
            indexCount: allIndices.length,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. IFC missing -> try XKT direct download and GLB build
      const { data: xktFiles } = await supabase.storage
        .from("xkt-models")
        .list(buildingFmGuid, { limit: 50 });

      const xktFile = xktFiles?.find(f => f.name.toLowerCase().endsWith(".xkt"));
      if (!xktFile) {
        return new Response(
          JSON.stringify({ error: "No IFC or XKT source model found for this building" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Download the XKT file and parse geometry to build GLB directly
      const xktPath = `${buildingFmGuid}/${xktFile.name}`;
      console.log(`[bim-to-gltf] Downloading XKT: ${xktPath}`);

      const { data: xktBlob, error: xktDlError } = await supabase.storage
        .from("xkt-models")
        .download(xktPath);

      if (xktDlError || !xktBlob) {
        throw new Error(`Failed to download XKT: ${xktDlError?.message || "no data"}`);
      }

      const xktBuffer = await xktBlob.arrayBuffer();
      const xktSizeMB = xktBuffer.byteLength / (1024 * 1024);
      console.log(`[bim-to-gltf] XKT size: ${xktSizeMB.toFixed(1)} MB, parsing geometry...`);

      // Parse XKT v10 binary format to extract positions and indices
      const xktResult = parseXktGeometry(new Uint8Array(xktBuffer));

      if (xktResult.vertexCount === 0) {
        return new Response(
          JSON.stringify({ error: "No geometry found in XKT file" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[bim-to-gltf] XKT extracted ${xktResult.vertexCount} vertices, ${xktResult.indices.length} indices`);

      // Build GLB from extracted geometry
      const glbBuffer = buildGlb(xktResult.positions, xktResult.indices);
      const glbSizeMB = glbBuffer.byteLength / (1024 * 1024);
      console.log(`[bim-to-gltf] GLB size: ${glbSizeMB.toFixed(2)} MB`);

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("glb-models")
        .upload(glbPath, glbBuffer, {
          contentType: "model/gltf-binary",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`GLB upload failed: ${uploadError.message}`);
      }

      const { data: urlData } = await supabase.storage
        .from("glb-models")
        .createSignedUrl(glbPath, 3600);

      console.log(`[bim-to-gltf] ✅ XKT→GLB conversion complete`);

      return new Response(
        JSON.stringify({
          success: true,
          source: "xkt-direct",
          glbUrl: urlData?.signedUrl || null,
          glbSizeMB: parseFloat(glbSizeMB.toFixed(2)),
          vertexCount: xktResult.vertexCount,
          indexCount: xktResult.indices.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[bim-to-gltf] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Build a minimal binary glTF (GLB) file from vertices and indices.
 * Vertices: Float32Array of [x,y,z, x,y,z, ...]
 * Indices: Uint32Array
 */
function buildGlb(vertices: Float32Array, indices: Uint32Array): ArrayBuffer {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const numVerts = vertices.length / 3;
  for (let i = 0; i < numVerts; i++) {
    const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const vertexBytes = vertices.buffer.slice(
    vertices.byteOffset,
    vertices.byteOffset + vertices.byteLength
  );
  const indexBytes = indices.buffer.slice(
    indices.byteOffset,
    indices.byteOffset + indices.byteLength
  );

  const vertexByteLength = vertices.byteLength;
  const indexByteLength = indices.byteLength;

  const indexPadding = (4 - (indexByteLength % 4)) % 4;
  const totalBinLength = vertexByteLength + indexByteLength + indexPadding;

  const gltfJson: any = {
    asset: { version: "2.0", generator: "geminus-bim-to-gltf" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        mode: 4,
      }],
    }],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: numVerts, type: "VEC3",
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      },
      {
        bufferView: 1, componentType: 5125, count: indices.length, type: "SCALAR",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertexByteLength, target: 34962 },
      { buffer: 0, byteOffset: vertexByteLength, byteLength: indexByteLength, target: 34963 },
    ],
    buffers: [{ byteLength: totalBinLength }],
  };

  const jsonString = JSON.stringify(gltfJson);
  const jsonEncoder = new TextEncoder();
  const jsonBytes = jsonEncoder.encode(jsonString);

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

  u8.set(jsonBytes, offset);
  offset += jsonBytes.length;
  for (let i = 0; i < jsonPadding; i++) { u8[offset++] = 0x20; }

  view.setUint32(offset, totalBinLength, true); offset += 4;
  view.setUint32(offset, 0x004E4942, true); offset += 4;

  u8.set(new Uint8Array(vertexBytes), offset);
  offset += vertexByteLength;
  u8.set(new Uint8Array(indexBytes), offset);
  offset += indexByteLength;
  for (let i = 0; i < indexPadding; i++) { u8[offset++] = 0; }

  return glb;
}

/**
 * Parse XKT v10 binary format to extract raw geometry (positions + indices).
 * XKT stores quantized positions per-entity; we dequantize and merge them.
 * 
 * XKT v10 binary layout (simplified):
 *   - Header: magic(4) + version(4) + numElements(4)
 *   - Element directory: [byteLength(4)] × numElements
 *   - Element data blocks
 *
 * Key elements we need:
 *   [0]  types
 *   [6]  eachEntityPositionsAndNormalsPortion (Uint32)
 *   [7]  eachEntityIndicesPortion (Uint32)
 *   [14] positions (Uint16 quantized)
 *   [16] indices (Uint32)
 *   [20] eachEntityMeshInstancesPortion — deprecated, skip
 *   [24] positionsDecodeMatrix (Float32, 16 values per entity)
 */
function parseXktGeometry(xktData: Uint8Array): { positions: Float32Array; indices: Uint32Array; vertexCount: number } {
  const dataView = new DataView(xktData.buffer, xktData.byteOffset, xktData.byteLength);

  const magic = dataView.getUint32(0, true);
  const version = dataView.getUint32(4, true);
  const numElements = dataView.getUint32(8, true);

  console.log(`[parseXkt] version=${version}, numElements=${numElements}`);

  const elementSizes: number[] = [];
  let offset = 12;
  for (let i = 0; i < numElements; i++) {
    elementSizes.push(dataView.getUint32(offset, true));
    offset += 4;
  }

  const elementOffsets: number[] = [];
  let currentOffset = offset;
  for (let i = 0; i < numElements; i++) {
    elementOffsets.push(currentOffset);
    currentOffset += elementSizes[i];
  }

  const getElement = (idx: number) => {
    if (idx >= numElements) return new Uint8Array(0);
    return xktData.slice(elementOffsets[idx], elementOffsets[idx] + elementSizes[idx]);
  };

  let quantizedPositions: Uint16Array;
  let rawIndices: Uint32Array;

  if (version >= 9 && numElements > 16) {
    const posBytes = getElement(14);
    quantizedPositions = new Uint16Array(posBytes.buffer, posBytes.byteOffset, posBytes.byteLength / 2);
    const idxBytes = getElement(16);
    rawIndices = new Uint32Array(idxBytes.buffer, idxBytes.byteOffset, idxBytes.byteLength / 4);
  } else {
    const posBytes = getElement(6);
    quantizedPositions = new Uint16Array(posBytes.buffer, posBytes.byteOffset, posBytes.byteLength / 2);
    const idxBytes = getElement(8);
    rawIndices = new Uint32Array(idxBytes.buffer, idxBytes.byteOffset, idxBytes.byteLength / 4);
  }

  if (quantizedPositions.length === 0 || rawIndices.length === 0) {
    console.log(`[parseXkt] No geometry found: positions=${quantizedPositions.length}, indices=${rawIndices.length}`);
    return { positions: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0 };
  }

  const vertexCount = quantizedPositions.length / 3;

  let decodeMatrixElement: Uint8Array | null = null;
  if (version >= 10 && numElements > 24 && elementSizes[24] >= 64) {
    decodeMatrixElement = getElement(24);
  } else if (version >= 9 && numElements > 22 && elementSizes[22] >= 64) {
    decodeMatrixElement = getElement(22);
  }

  const positions = new Float32Array(vertexCount * 3);

  if (decodeMatrixElement && decodeMatrixElement.byteLength >= 64) {
    const matrix = new Float32Array(decodeMatrixElement.buffer, decodeMatrixElement.byteOffset, 16);
    for (let i = 0; i < vertexCount; i++) {
      const qx = quantizedPositions[i * 3];
      const qy = quantizedPositions[i * 3 + 1];
      const qz = quantizedPositions[i * 3 + 2];
      const nx = qx / 65535;
      const ny = qy / 65535;
      const nz = qz / 65535;
      positions[i * 3]     = matrix[0] * nx + matrix[4] * ny + matrix[8]  * nz + matrix[12];
      positions[i * 3 + 1] = matrix[1] * nx + matrix[5] * ny + matrix[9]  * nz + matrix[13];
      positions[i * 3 + 2] = matrix[2] * nx + matrix[6] * ny + matrix[10] * nz + matrix[14];
    }
  } else {
    console.log(`[parseXkt] No decode matrix, using raw dequantization`);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3]     = quantizedPositions[i * 3] / 65535 * 100 - 50;
      positions[i * 3 + 1] = quantizedPositions[i * 3 + 1] / 65535 * 100 - 50;
      positions[i * 3 + 2] = quantizedPositions[i * 3 + 2] / 65535 * 100 - 50;
    }
  }

  console.log(`[parseXkt] Dequantized ${vertexCount} vertices, ${rawIndices.length} indices`);
  return { positions, indices: rawIndices, vertexCount };
}
