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

    const { ifcStoragePath, buildingFmGuid, modelName, jobId } = await req.json();

    if (!ifcStoragePath || !buildingFmGuid) {
      return new Response(
        JSON.stringify({ error: "ifcStoragePath and buildingFmGuid are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Helper to update conversion_jobs progress
    const updateJob = async (updates: Record<string, unknown>) => {
      if (!jobId) return;
      try {
        await supabase
          .from("conversion_jobs")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", jobId);
      } catch (e) {
        console.warn("Failed to update job progress:", e);
      }
    };

    const appendLog = async (msg: string, progress?: number) => {
      console.log(msg);
      if (!jobId) return;
      try {
        // Fetch current logs, append, update
        const { data } = await supabase
          .from("conversion_jobs")
          .select("log_messages")
          .eq("id", jobId)
          .single();
        const logs = (data?.log_messages as string[]) || [];
        logs.push(msg);
        const upd: Record<string, unknown> = {
          log_messages: logs,
          updated_at: new Date().toISOString(),
        };
        if (progress !== undefined) upd.progress = progress;
        await supabase.from("conversion_jobs").update(upd).eq("id", jobId);
      } catch (_) {
        // best-effort
      }
    };

    await updateJob({ status: "processing", progress: 5 });
    await appendLog(`Starting IFC-to-XKT conversion: ${ifcStoragePath}`, 5);

    // 1. Download IFC from storage
    await appendLog("Downloading IFC from storage...", 10);
    const { data: ifcBlob, error: dlError } = await supabase.storage
      .from("ifc-uploads")
      .download(ifcStoragePath);

    if (dlError || !ifcBlob) {
      const errMsg = `Failed to download IFC: ${dlError?.message || "no data"}`;
      await updateJob({ status: "error", error_message: errMsg });
      throw new Error(errMsg);
    }

    const ifcArrayBuffer = await ifcBlob.arrayBuffer();
    const fileSizeMB = ifcArrayBuffer.byteLength / 1024 / 1024;
    await appendLog(`IFC downloaded: ${fileSizeMB.toFixed(1)} MB`, 20);

    // 2. Convert IFC to XKT using web-ifc + xeokit-convert
    await appendLog("Loading web-ifc WASM...", 25);

    const WebIFC = await import("npm:web-ifc@0.0.57");
    const xeokitConvert = await import("npm:@xeokit/xeokit-convert@1.3.1");

    const xktModel = new (xeokitConvert as any).XKTModel();
    await appendLog("Parsing IFC...", 30);

    // Use parseIFCIntoXKTModel with explicit WebIFC module and WASM path
    // The WASM is resolved from the npm package by Deno
    await (xeokitConvert as any).parseIFCIntoXKTModel({
      WebIFC,
      data: new Uint8Array(ifcArrayBuffer),
      xktModel,
      autoNormals: true,
      wasmPath: "https://unpkg.com/web-ifc@0.0.57/",
      log: (msg: string) => console.log(`  ${msg}`),
    });

    await appendLog("Finalizing XKT model...", 60);
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

    await appendLog(`Hierarchy: ${levels.length} levels, ${spaces.length} spaces`, 65);

    // 4. Write XKT to ArrayBuffer
    const stats: Record<string, any> = { texturesSize: 0 };
    const xktArrayBuffer = (xeokitConvert as any).writeXKTModelToArrayBuffer(
      xktModel,
      null,
      stats,
      { zip: false }
    );
    const xktSizeMB = xktArrayBuffer.byteLength / 1024 / 1024;
    await appendLog(`XKT generated: ${xktSizeMB.toFixed(2)} MB`, 70);

    // 5. Upload XKT to storage
    await appendLog("Uploading XKT to storage...", 75);
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
      const errMsg = `XKT upload failed: ${uploadError.message}`;
      await updateJob({ status: "error", error_message: errMsg });
      throw new Error(errMsg);
    }

    await appendLog("Saving model metadata...", 85);

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
      const errMsg = `Database error: ${dbError.message}`;
      await updateJob({ status: "error", error_message: errMsg });
      throw new Error(errMsg);
    }

    await updateJob({
      status: "done",
      progress: 100,
      result_model_id: modelId,
    });
    await appendLog(`✅ Conversion complete: ${storagePath}`, 100);

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
    const errMsg = err?.message || String(err);
    console.error("IFC-to-XKT error:", errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
