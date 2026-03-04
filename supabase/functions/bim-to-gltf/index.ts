import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

      return new Response(
        JSON.stringify({
          cached: false,
          hasIfc: !!ifcFile,
          ifcFileName: ifcFile?.name || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── CONVERT: IFC → GLB ──
    if (action === "convert") {
      console.log(`[bim-to-gltf] Starting conversion for ${buildingFmGuid}`);

      // 1. Find IFC file
      const { data: ifcFiles } = await supabase.storage
        .from("ifc-uploads")
        .list(buildingFmGuid, { limit: 10 });

      const ifcFile = ifcFiles?.find(f => f.name.toLowerCase().endsWith(".ifc"));
      if (!ifcFile) {
        // Try to find IFC in root of bucket with building guid prefix
        return new Response(
          JSON.stringify({ error: "No IFC file found for this building" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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

      console.log(`[bim-to-gltf] ✅ Conversion complete`);

      return new Response(
        JSON.stringify({
          success: true,
          glbUrl: urlData?.signedUrl || null,
          glbSizeMB: parseFloat(glbSizeMB.toFixed(2)),
          vertexCount: vertexOffset,
          indexCount: allIndices.length,
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
  // Compute bounding box for accessor min/max
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

  // Pad index buffer to 4-byte alignment
  const indexPadding = (4 - (indexByteLength % 4)) % 4;
  const totalBinLength = vertexByteLength + indexByteLength + indexPadding;

  const gltfJson: any = {
    asset: { version: "2.0", generator: "geminus-bim-to-gltf" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        mesh: 0,
        // IFC uses Y-up typically, Cesium uses Z-up. Apply rotation if needed.
        // Most IFC files are already in a usable orientation for Cesium.
      },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            mode: 4, // TRIANGLES
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: numVerts,
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
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: vertexByteLength,
        target: 34962, // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: vertexByteLength,
        byteLength: indexByteLength,
        target: 34963, // ELEMENT_ARRAY_BUFFER
      },
    ],
    buffers: [
      {
        byteLength: totalBinLength,
      },
    ],
  };

  const jsonString = JSON.stringify(gltfJson);
  const jsonEncoder = new TextEncoder();
  const jsonBytes = jsonEncoder.encode(jsonString);

  // Pad JSON to 4-byte alignment
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunkLength = jsonBytes.length + jsonPadding;

  // GLB structure: header(12) + jsonChunkHeader(8) + jsonData + binChunkHeader(8) + binData
  const totalLength = 12 + 8 + jsonChunkLength + 8 + totalBinLength;

  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  const u8 = new Uint8Array(glb);

  let offset = 0;

  // GLB Header
  view.setUint32(offset, 0x46546C67, true); offset += 4; // magic: "glTF"
  view.setUint32(offset, 2, true); offset += 4;           // version: 2
  view.setUint32(offset, totalLength, true); offset += 4;  // total length

  // JSON chunk header
  view.setUint32(offset, jsonChunkLength, true); offset += 4;
  view.setUint32(offset, 0x4E4F534A, true); offset += 4; // "JSON"

  // JSON data
  u8.set(jsonBytes, offset);
  offset += jsonBytes.length;
  // Pad with spaces (0x20)
  for (let i = 0; i < jsonPadding; i++) {
    u8[offset++] = 0x20;
  }

  // BIN chunk header
  view.setUint32(offset, totalBinLength, true); offset += 4;
  view.setUint32(offset, 0x004E4942, true); offset += 4; // "BIN\0"

  // BIN data: vertices then indices
  u8.set(new Uint8Array(vertexBytes), offset);
  offset += vertexByteLength;
  u8.set(new Uint8Array(indexBytes), offset);
  offset += indexByteLength;
  // Pad with zeros
  for (let i = 0; i < indexPadding; i++) {
    u8[offset++] = 0;
  }

  return glb;
}
