#!/usr/bin/env node
/**
 * External IFC → per-storey XKT conversion worker.
 *
 * Polls the conversion-worker-api edge function for pending jobs,
 * downloads IFC files, splits them by IfcBuildingStorey, converts
 * each storey to a separate .xkt tile, and uploads results.
 *
 * Requirements:
 *   - Node.js 18+
 *   - npm install @xeokit/xeokit-convert web-ifc
 *
 * Environment:
 *   SUPABASE_URL          — project URL
 *   WORKER_API_SECRET     — shared secret matching edge function
 *   POLL_INTERVAL_MS      — poll interval (default: 10000)
 *
 * Usage:
 *   node worker.mjs
 */

import fs from "fs";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

// Dynamic imports for xeokit-convert (ESM)
let convert2xkt, WebIFC;

const SUPABASE_URL = process.env.SUPABASE_URL;
const WORKER_SECRET = process.env.WORKER_API_SECRET;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "10000", 10);
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/conversion-worker-api`;

if (!SUPABASE_URL || !WORKER_SECRET) {
  console.error("Missing SUPABASE_URL or WORKER_API_SECRET");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "x-worker-secret": WORKER_SECRET,
};

async function api(action, method = "GET", body = null) {
  const opts = { method, headers: { ...headers } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${FUNCTION_URL}/${action}`, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${action} failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

async function reportProgress(jobId, progress, message) {
  try {
    await api("progress", "POST", { job_id: jobId, progress, log_message: message });
  } catch (e) {
    console.warn("Progress report failed:", e.message);
  }
}

async function downloadFile(url, destPath) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const fileStream = fs.createWriteStream(destPath);
  await pipeline(Readable.fromWeb(resp.body), fileStream);
  return fs.statSync(destPath).size;
}

async function getUploadUrl(storagePath) {
  const result = await api("upload-url", "POST", { path: storagePath });
  return result.signedUrl;
}

async function uploadFile(signedUrl, filePath, token) {
  const fileBuffer = fs.readFileSync(filePath);
  const resp = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      ...(token ? { "x-upsert": "true" } : {}),
    },
    body: fileBuffer,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Upload failed (${resp.status}): ${text}`);
  }
}

/**
 * Group IFC model elements by IfcBuildingStorey.
 */
function groupByStorey(ifcApi, modelId) {
  const storeys = [];
  const allLines = ifcApi.GetAllLines(modelId);

  // Find all IfcBuildingStorey elements
  const IFCBUILDINGSTOREY = 3124254112; // web-ifc type ID
  let storeyLines;
  try {
    storeyLines = ifcApi.GetLineIDsWithType(modelId, IFCBUILDINGSTOREY);
  } catch {
    // Fallback: scan all lines for storey type
    storeyLines = [];
    for (let i = 0; i < allLines.size(); i++) {
      try {
        const line = ifcApi.GetLine(modelId, allLines.get(i));
        if (line?.type === IFCBUILDINGSTOREY || line?.constructor?.name === "IfcBuildingStorey") {
          storeyLines.push(allLines.get(i));
        }
      } catch {}
    }
  }

  if (storeyLines.size ? storeyLines.size() === 0 : storeyLines.length === 0) {
    console.log("No IfcBuildingStorey found — returning single tile");
    return [{ name: "full_model", guid: null, lineIds: null }];
  }

  const count = storeyLines.size ? storeyLines.size() : storeyLines.length;
  for (let i = 0; i < count; i++) {
    const id = storeyLines.size ? storeyLines.get(i) : storeyLines[i];
    try {
      const storey = ifcApi.GetLine(modelId, id);
      const name = storey?.Name?.value || storey?.LongName?.value || `storey_${i}`;
      const guid = storey?.GlobalId?.value || null;
      storeys.push({ name, guid, expressId: id });
    } catch (e) {
      console.warn(`Failed to read storey ${id}:`, e.message);
    }
  }

  console.log(`Found ${storeys.length} storeys:`, storeys.map((s) => s.name));
  return storeys;
}

async function processJob(job) {
  const jobId = job.id;
  const buildingGuid = job.building_fm_guid;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xkt-worker-"));

  console.log(`\n=== Processing job ${jobId} ===`);
  console.log(`Building: ${buildingGuid}, IFC: ${job.ifc_storage_path}`);

  try {
    // 1. Download IFC
    await reportProgress(jobId, 10, "Downloading IFC file...");
    const ifcPath = path.join(tmpDir, "model.ifc");
    const fileSize = await downloadFile(job.ifc_download_url, ifcPath);
    console.log(`Downloaded IFC: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

    // 2. Parse IFC and find storeys
    await reportProgress(jobId, 20, "Parsing IFC structure...");

    if (!WebIFC) {
      const webIfcMod = await import("web-ifc");
      WebIFC = webIfcMod.default || webIfcMod;
    }
    if (!convert2xkt) {
      const xeokitMod = await import("@xeokit/xeokit-convert");
      convert2xkt = xeokitMod.convert2xkt || xeokitMod.default?.convert2xkt;
    }

    const ifcApi = new WebIFC.IfcAPI();
    await ifcApi.Init();
    const ifcData = fs.readFileSync(ifcPath);
    const modelId = ifcApi.OpenModel(ifcData);

    const storeys = groupByStorey(ifcApi, modelId);
    ifcApi.CloseModel(modelId);

    await reportProgress(jobId, 30, `Found ${storeys.length} storeys, converting...`);

    // 3. Convert each storey to XKT
    const tiles = [];
    const progressPerStorey = 60 / Math.max(storeys.length, 1);

    for (let i = 0; i < storeys.length; i++) {
      const storey = storeys[i];
      const safeName = storey.name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50);
      const tileId = `${buildingGuid}_${safeName}`;
      const xktPath = path.join(tmpDir, `${safeName}.xkt`);
      const metaPath = path.join(tmpDir, `${safeName}_metadata.json`);

      const progress = 30 + Math.round(progressPerStorey * (i + 1));
      await reportProgress(jobId, progress, `Converting storey ${i + 1}/${storeys.length}: ${storey.name}`);

      try {
        // convert2xkt with IFC source
        const xktArrayBuffer = [];
        const metaModel = { metaObjects: [] };

        await convert2xkt({
          source: ifcPath,
          outputXKTModel: null,
          output: xktPath,
          includeTypes: storey.guid ? undefined : undefined, // Future: filter by storey
          log: (msg) => console.log(`  [xkt] ${msg}`),
        });

        const xktSize = fs.existsSync(xktPath) ? fs.statSync(xktPath).size : 0;

        if (xktSize > 0) {
          // Upload XKT tile
          const storagePath = `${buildingGuid}/${safeName}.xkt`;
          const uploadData = await api("upload-url", "POST", { path: storagePath });
          await uploadFile(uploadData.signedUrl, xktPath, uploadData.token);

          // Upload metadata if exists
          if (fs.existsSync(metaPath)) {
            const metaStoragePath = `${buildingGuid}/${safeName}_metadata.json`;
            const metaUpload = await api("upload-url", "POST", { path: metaStoragePath });
            await uploadFile(metaUpload.signedUrl, metaPath, metaUpload.token);
          }

          tiles.push({
            model_id: tileId,
            model_name: storey.name,
            file_name: `${safeName}.xkt`,
            storage_path: storagePath,
            file_size: xktSize,
            storey_fm_guid: storey.guid,
          });

          console.log(`  ✅ ${storey.name}: ${(xktSize / 1024 / 1024).toFixed(1)} MB`);
        } else {
          console.warn(`  ⚠️ ${storey.name}: empty XKT, skipped`);
        }
      } catch (e) {
        console.error(`  ❌ ${storey.name} failed:`, e.message);
      }
    }

    // 4. Report completion
    if (tiles.length === 0) {
      // Fallback: convert full model as single tile
      await reportProgress(jobId, 90, "No storey tiles — converting full model...");
      const fullXktPath = path.join(tmpDir, "full_model.xkt");

      await convert2xkt({
        source: ifcPath,
        output: fullXktPath,
        log: (msg) => console.log(`  [xkt-full] ${msg}`),
      });

      const fullSize = fs.existsSync(fullXktPath) ? fs.statSync(fullXktPath).size : 0;
      if (fullSize > 0) {
        const storagePath = `${buildingGuid}/full_model.xkt`;
        const uploadData = await api("upload-url", "POST", { path: storagePath });
        await uploadFile(uploadData.signedUrl, fullXktPath, uploadData.token);

        tiles.push({
          model_id: `${buildingGuid}_full`,
          model_name: job.model_name || "Full Model",
          file_name: "full_model.xkt",
          storage_path: storagePath,
          file_size: fullSize,
          storey_fm_guid: null,
        });
      }
    }

    await api("complete", "POST", { job_id: jobId, tiles });
    console.log(`✅ Job ${jobId} complete: ${tiles.length} tiles`);
  } catch (e) {
    console.error(`❌ Job ${jobId} failed:`, e);
    await api("fail", "POST", { job_id: jobId, error_message: e.message }).catch(() => {});
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// Main loop
async function main() {
  console.log(`🔧 XKT Conversion Worker started`);
  console.log(`   Polling: ${FUNCTION_URL} every ${POLL_INTERVAL / 1000}s`);

  while (true) {
    try {
      const result = await api("pending", "GET");
      if (result.job) {
        await processJob(result.job);
      }
    } catch (e) {
      console.error("Poll error:", e.message);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch((e) => {
  console.error("Worker fatal:", e);
  process.exit(1);
});
