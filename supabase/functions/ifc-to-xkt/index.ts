import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
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

    const { ifcStoragePath, buildingFmGuid, modelName } = await req.json();

    if (!ifcStoragePath || !buildingFmGuid) {
      return new Response(
        JSON.stringify({ error: "ifcStoragePath and buildingFmGuid are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Starting IFC-to-XKT conversion: ${ifcStoragePath}`);

    // 1. Download IFC from storage
    const { data: ifcBlob, error: dlError } = await supabase.storage
      .from("ifc-uploads")
      .download(ifcStoragePath);

    if (dlError || !ifcBlob) {
      throw new Error(`Failed to download IFC: ${dlError?.message || "no data"}`);
    }

    const ifcArrayBuffer = await ifcBlob.arrayBuffer();
    const fileSizeMB = ifcArrayBuffer.byteLength / 1024 / 1024;
    console.log(`IFC downloaded: ${fileSizeMB.toFixed(1)} MB`);

    // 2. Convert IFC to XKT using web-ifc + xeokit-convert
    const WebIFC = await import("npm:web-ifc@0.0.57");
    const xeokitConvert = await import("npm:@xeokit/xeokit-convert@1.3.1");

    const xktModel = new (xeokitConvert as any).XKTModel();
    console.log("Parsing IFC...");

    await (xeokitConvert as any).parseIFCIntoXKTModel({
      WebIFC,
      data: new Uint8Array(ifcArrayBuffer),
      xktModel,
      autoNormals: true,
      wasmPath: "", // Deno resolves WASM from the npm package
      log: (msg: string) => console.log(`  ${msg}`),
    });

    console.log("Finalizing XKT model...");
    xktModel.finalize();

    // 3. Extract hierarchy
    const levels: Array<{ id: string; name: string; type: string }> = [];
    const spaces: Array<{ id: string; name: string; type: string; parentId: string }> = [];

    if (xktModel.metaObjects) {
      const vals = Array.isArray(xktModel.metaObjects)
        ? xktModel.metaObjects
        : Object.values(xktModel.metaObjects);
      for (const m of vals as any[]) {
        const t = m.metaType || m.type || "";
        if (t === "IfcBuildingStorey") {
          levels.push({
            id: m.metaObjectId || m.id || "",
            name: m.metaObjectName || m.name || t,
            type: t,
          });
        } else if (t === "IfcSpace") {
          spaces.push({
            id: m.metaObjectId || m.id || "",
            name: m.metaObjectName || m.name || t,
            type: t,
            parentId: m.parentMetaObjectId || m.parentId || "",
          });
        }
      }
    }

    // 4. Write XKT to ArrayBuffer
    const stats: Record<string, any> = { texturesSize: 0 };
    const xktArrayBuffer = (xeokitConvert as any).writeXKTModelToArrayBuffer(
      xktModel,
      null,
      stats,
      { zip: false }
    );
    const xktSizeMB = xktArrayBuffer.byteLength / 1024 / 1024;
    console.log(`XKT generated: ${xktSizeMB.toFixed(2)} MB`);

    // 5. Upload XKT to storage
    const modelId = `ifc-${Date.now()}`;
    const storageFileName = `${modelId}.xkt`;
    const storagePath = `${buildingFmGuid}/${storageFileName}`;

    const { error: uploadError } = await supabase.storage
      .from("xkt-models")
      .upload(storagePath, xktArrayBuffer, {
        contentType: "application/octet-stream",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`XKT upload failed: ${uploadError.message}`);
    }

    // 6. Save metadata to xkt_models table
    const safeName = (modelName || ifcStoragePath).replace(/\.ifc$/i, "");
    const { error: dbError } = await supabase.from("xkt_models").upsert(
      {
        building_fm_guid: buildingFmGuid,
        model_id: modelId,
        model_name: safeName,
        file_name: storageFileName,
        file_size: xktArrayBuffer.byteLength,
        storage_path: storagePath,
        format: "xkt",
        synced_at: new Date().toISOString(),
        source_updated_at: new Date().toISOString(),
      },
      { onConflict: "building_fm_guid,model_id" }
    );

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    console.log(`✅ Conversion complete: ${storagePath}`);

    return new Response(
      JSON.stringify({
        success: true,
        modelId,
        storagePath,
        xktSizeMB: parseFloat(xktSizeMB.toFixed(2)),
        levels,
        spaces,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("IFC-to-XKT error:", err.message);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
