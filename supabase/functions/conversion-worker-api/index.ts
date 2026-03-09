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
