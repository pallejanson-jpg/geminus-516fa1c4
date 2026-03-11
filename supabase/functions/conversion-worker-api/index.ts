import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: shared secret
  const workerSecret = Deno.env.get("WORKER_API_SECRET");
  const provided = req.headers.get("x-worker-secret");
  if (!workerSecret || provided !== workerSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const url = new URL(req.url);
  const action = url.pathname.split("/").pop();

  try {
    // GET /pending — oldest pending job
    if (req.method === "GET" && action === "pending") {
      const { data, error } = await supabase
        .from("conversion_jobs")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return new Response(JSON.stringify({ job: null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generate signed URL for IFC file
      const { data: urlData } = await supabase.storage
        .from("ifc-uploads")
        .createSignedUrl(data.ifc_storage_path, 3600);

      return new Response(
        JSON.stringify({
          job: {
            ...data,
            ifc_download_url: urlData?.signedUrl || null,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /claim — worker claims a job
    if (req.method === "POST" && action === "claim") {
      const { job_id } = await req.json();
      if (!job_id) throw new Error("job_id required");

      const { data, error } = await supabase
        .from("conversion_jobs")
        .update({
          status: "processing",
          progress: 5,
          log_messages: ["Worker claimed job"],
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id)
        .eq("status", "pending")
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return new Response(
          JSON.stringify({ error: "Job not found or already claimed" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ ok: true, job: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /progress — update progress
    if (req.method === "POST" && action === "progress") {
      const { job_id, progress, log_message } = await req.json();
      if (!job_id) throw new Error("job_id required");

      const updates: Record<string, unknown> = {
        progress: progress ?? 0,
        updated_at: new Date().toISOString(),
      };

      // Append log message
      if (log_message) {
        const { data: current } = await supabase
          .from("conversion_jobs")
          .select("log_messages")
          .eq("id", job_id)
          .single();

        const logs = Array.isArray(current?.log_messages) ? current.log_messages : [];
        logs.push(log_message);
        updates.log_messages = logs;
      }

      const { error } = await supabase
        .from("conversion_jobs")
        .update(updates)
        .eq("id", job_id);

      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /complete — worker finished, create xkt_models records
    if (req.method === "POST" && action === "complete") {
      const { job_id, tiles } = await req.json();
      if (!job_id || !tiles) throw new Error("job_id and tiles required");

      // Get the job info
      const { data: job, error: jobErr } = await supabase
        .from("conversion_jobs")
        .select("*")
        .eq("id", job_id)
        .single();

      if (jobErr || !job) throw new Error("Job not found");

      // Create xkt_models records for each tile
      const modelRecords = tiles.map((tile: any, idx: number) => ({
        building_fm_guid: job.building_fm_guid,
        model_id: tile.model_id,
        model_name: tile.model_name || tile.model_id,
        file_name: tile.file_name,
        storage_path: tile.storage_path,
        file_size: tile.file_size || null,
        format: "xkt",
        is_chunk: true,
        chunk_order: idx,
        storey_fm_guid: tile.storey_fm_guid || null,
        parent_model_id: tiles.length > 1 ? job.model_name || job.building_fm_guid : null,
      }));

      if (modelRecords.length > 0) {
        const { error: insertErr } = await supabase
          .from("xkt_models")
          .upsert(modelRecords, { onConflict: "model_id" });

        if (insertErr) {
          console.error("Failed to insert xkt_models:", insertErr);
          throw insertErr;
        }
      }

      // Mark job complete
      const { error: updateErr } = await supabase
        .from("conversion_jobs")
        .update({
          status: "done",
          progress: 100,
          result_model_id: tiles[0]?.model_id || null,
          log_messages: [
            ...(Array.isArray(job.log_messages) ? job.log_messages : []),
            `Completed: ${tiles.length} tiles created`,
          ],
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({ ok: true, tiles_created: modelRecords.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /fail — worker reports failure
    if (req.method === "POST" && action === "fail") {
      const { job_id, error_message } = await req.json();
      if (!job_id) throw new Error("job_id required");

      const { data: job } = await supabase
        .from("conversion_jobs")
        .select("log_messages")
        .eq("id", job_id)
        .single();

      const { error } = await supabase
        .from("conversion_jobs")
        .update({
          status: "failed",
          error_message: error_message || "Unknown worker error",
          log_messages: [
            ...(Array.isArray(job?.log_messages) ? job.log_messages : []),
            `Failed: ${error_message}`,
          ],
          updated_at: new Date().toISOString(),
        })
        .eq("id", job_id);

      if (error) throw error;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /populate-hierarchy — worker sends parsed hierarchy for assets upsert + diff
    if (req.method === "POST" && action === "populate-hierarchy") {
      const { building_fm_guid, storeys, spaces, instances } = await req.json();
      if (!building_fm_guid) throw new Error("building_fm_guid required");

      const now = new Date().toISOString();

      // Helper: deterministic GUID from building + name + type
      async function deterministicGuid(parts: string[]): Promise<string> {
        const data = new TextEncoder().encode(parts.join("|"));
        const hash = await crypto.subtle.digest("SHA-256", data);
        const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${(parseInt(hex.slice(16,18),16) & 0x3f | 0x80).toString(16).padStart(2,"0")}${hex.slice(18,20)}-${hex.slice(20,32)}`;
      }

      const importedFmGuids = new Set<string>();
      const storeyIdToFmGuid = new Map<string, string>();

      // 1. Upsert storeys
      if (storeys?.length > 0) {
        const storeyRows = [];
        for (const s of storeys) {
          const fmGuid = s.globalId || await deterministicGuid([building_fm_guid, s.name || "", "IfcBuildingStorey"]);
          storeyIdToFmGuid.set(s.id || s.name, fmGuid);
          importedFmGuids.add(fmGuid);
          storeyRows.push({
            fm_guid: fmGuid, name: s.name, common_name: s.name,
            category: "Building Storey", building_fm_guid, level_fm_guid: fmGuid,
            is_local: false, created_in_model: true, synced_at: now,
          });
        }
        for (let i = 0; i < storeyRows.length; i += 500) {
          await supabase.from("assets").upsert(storeyRows.slice(i, i + 500), { onConflict: "fm_guid" });
        }
      }

      // 2. Upsert spaces
      if (spaces?.length > 0) {
        const spaceRows = [];
        for (const s of spaces) {
          const fmGuid = s.globalId || await deterministicGuid([building_fm_guid, s.name || "", "IfcSpace"]);
          importedFmGuids.add(fmGuid);
          const parentFmGuid = storeyIdToFmGuid.get(s.parentId) || null;
          spaceRows.push({
            fm_guid: fmGuid, name: s.name, common_name: s.name,
            category: "Space", building_fm_guid, level_fm_guid: parentFmGuid,
            is_local: false, created_in_model: true, synced_at: now,
          });
        }
        for (let i = 0; i < spaceRows.length; i += 500) {
          await supabase.from("assets").upsert(spaceRows.slice(i, i + 500), { onConflict: "fm_guid" });
        }
      }

      // 3. Upsert instances
      if (instances?.length > 0) {
        const instanceRows = [];
        for (const inst of instances) {
          const fmGuid = inst.globalId || await deterministicGuid([building_fm_guid, inst.name || "", inst.ifcType || "Instance"]);
          importedFmGuids.add(fmGuid);
          const levelFmGuid = storeyIdToFmGuid.get(inst.storeyId) || null;
          // If parent is a space, resolve in_room_fm_guid
          let inRoomFmGuid: string | null = null;
          if (inst.spaceId) {
            // Space globalId was used or deterministic
            inRoomFmGuid = inst.spaceGlobalId || null;
          }
          instanceRows.push({
            fm_guid: fmGuid, name: inst.name, common_name: inst.name,
            category: "Instance", asset_type: inst.ifcType,
            building_fm_guid, level_fm_guid: levelFmGuid, in_room_fm_guid: inRoomFmGuid,
            is_local: false, created_in_model: true, synced_at: now,
          });
        }
        for (let i = 0; i < instanceRows.length; i += 500) {
          await supabase.from("assets").upsert(instanceRows.slice(i, i + 500), { onConflict: "fm_guid" });
        }
      }

      // 4. Diff: remove assets that existed in DB but not in new import
      const { data: existingAssets } = await supabase
        .from("assets")
        .select("fm_guid")
        .eq("building_fm_guid", building_fm_guid)
        .eq("created_in_model", true)
        .in("category", ["Building Storey", "Space", "Instance"]);

      if (existingAssets && existingAssets.length > 0) {
        const removedGuids = existingAssets
          .map(a => a.fm_guid)
          .filter(guid => !importedFmGuids.has(guid));

        if (removedGuids.length > 0) {
          // Soft-delete: mark as removed
          for (let i = 0; i < removedGuids.length; i += 500) {
            const chunk = removedGuids.slice(i, i + 500);
            await supabase
              .from("assets")
              .update({ modification_status: "removed", updated_at: now })
              .in("fm_guid", chunk)
              .eq("building_fm_guid", building_fm_guid);
          }
        }
      }

      const totalUpserted = (storeys?.length || 0) + (spaces?.length || 0) + (instances?.length || 0);
      return new Response(
        JSON.stringify({ ok: true, upserted: totalUpserted, storeys: storeys?.length || 0, spaces: spaces?.length || 0, instances: instances?.length || 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /upload-url — generate signed upload URL for worker to push tiles
    if (req.method === "POST" && action === "upload-url") {
      const { path } = await req.json();
      if (!path) throw new Error("path required");

      const { data, error } = await supabase.storage
        .from("xkt-models")
        .createSignedUploadUrl(path);

      if (error) throw error;

      return new Response(
        JSON.stringify({ signedUrl: data.signedUrl, token: data.token, path: data.path }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("conversion-worker-api error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
