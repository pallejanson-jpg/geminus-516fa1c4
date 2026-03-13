#!/usr/bin/env node
/**
 * External IFC → per-storey XKT conversion worker.
 *
 * Polls the conversion-worker-api edge function for pending jobs,
 * downloads IFC files, splits them by IfcBuildingStorey, converts
 * each storey to a separate .xkt tile, and uploads results.
 *
 * Also supports XKT-only jobs (source_type: 'xkt') from Asset+
 * where no IFC is available — these skip conversion and just
 * populate the building hierarchy.
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
 * Collects descendant element expressIDs per storey via IfcRelContainedInSpatialStructure
 * and IfcRelAggregates so convert2xkt can filter per storey.
 */
function groupByStorey(ifcApi, modelId) {
  const storeys = [];

  // IFC type constants (web-ifc)
  const IFCBUILDINGSTOREY = 3124254112;
  const IFCRELCONTAINEDINSPATIALSTRUCTURE = 3242617779;
  const IFCRELAGGREGATES = 160246688;

  // Find all IfcBuildingStorey elements
  let storeyLines;
  try {
    storeyLines = ifcApi.GetLineIDsWithType(modelId, IFCBUILDINGSTOREY);
  } catch {
    const allLines = ifcApi.GetAllLines(modelId);
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

  const storeyCount = storeyLines.size ? storeyLines.size() : storeyLines.length;
  if (storeyCount === 0) {
    console.log("No IfcBuildingStorey found — returning single tile");
    return [{ name: "full_model", guid: null, elementIds: null }];
  }

  // Build spatial containment map: storeyExpressId → Set of descendant expressIDs
  const storeyElementMap = new Map(); // storeyExpressId → Set<expressId>
  const storeyExpressIds = new Set();

  for (let i = 0; i < storeyCount; i++) {
    const id = storeyLines.size ? storeyLines.get(i) : storeyLines[i];
    storeyExpressIds.add(id);
    storeyElementMap.set(id, new Set([id]));
  }

  // Helper: get lines of a type
  function getLinesOfType(typeId) {
    try {
      const ids = ifcApi.GetLineIDsWithType(modelId, typeId);
      const count = ids.size ? ids.size() : ids.length || 0;
      const result = [];
      for (let j = 0; j < count; j++) {
        const lid = ids.size ? ids.get(j) : ids[j];
        try { result.push(ifcApi.GetLine(modelId, lid, true)); } catch {}
      }
      return result;
    } catch { return []; }
  }

  // Walk IfcRelContainedInSpatialStructure — maps elements to their containing storey
  for (const rel of getLinesOfType(IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
    const relatingStructure = rel?.RelatingStructure;
    const relatingId = relatingStructure?.expressID ?? relatingStructure?.value;
    if (!relatingId || !storeyElementMap.has(relatingId)) continue;

    const elements = rel?.RelatedElements || [];
    const elArr = Array.isArray(elements) ? elements : [];
    for (const el of elArr) {
      const elId = el?.expressID ?? el?.value;
      if (elId) storeyElementMap.get(relatingId).add(elId);
    }
  }

  // Walk IfcRelAggregates — handles nested decomposition (storey → space → elements)
  const aggregateMap = new Map(); // parentId → [childId]
  for (const rel of getLinesOfType(IFCRELAGGREGATES)) {
    const relatingObj = rel?.RelatingObject;
    const parentId = relatingObj?.expressID ?? relatingObj?.value;
    if (!parentId) continue;

    const children = rel?.RelatedObjects || [];
    const childArr = Array.isArray(children) ? children : [];
    for (const child of childArr) {
      const childId = child?.expressID ?? child?.value;
      if (childId) {
        if (!aggregateMap.has(parentId)) aggregateMap.set(parentId, []);
        aggregateMap.get(parentId).push(childId);
      }
    }
  }

  // Recursively expand aggregate children into storey sets
  function expandAggregates(parentId, targetSet) {
    const children = aggregateMap.get(parentId);
    if (!children) return;
    for (const childId of children) {
      targetSet.add(childId);
      expandAggregates(childId, targetSet);
    }
  }

  for (const [storeyId, elementSet] of storeyElementMap) {
    const snapshot = [...elementSet];
    for (const elId of snapshot) {
      expandAggregates(elId, elementSet);
    }
  }

  // Build result
  for (let i = 0; i < storeyCount; i++) {
    const id = storeyLines.size ? storeyLines.get(i) : storeyLines[i];
    try {
      const storey = ifcApi.GetLine(modelId, id);
      const name = storey?.Name?.value || storey?.LongName?.value || `storey_${i}`;
      const guid = storey?.GlobalId?.value || null;
      const elementIds = storeyElementMap.get(id);
      storeys.push({
        name,
        guid,
        expressId: id,
        elementIds: elementIds ? [...elementIds] : null,
      });
      console.log(`  Storey "${name}": ${elementIds?.size || 0} elements`);
    } catch (e) {
      console.warn(`Failed to read storey ${id}:`, e.message);
    }
  }

  console.log(`Found ${storeys.length} storeys with element IDs`);
  return storeys;
}

async function extractHierarchy(ifcPath, buildingGuid) {
  const ifcApi = new WebIFC.IfcAPI();
  await ifcApi.Init();
  const ifcData = fs.readFileSync(ifcPath);
  const modelId = ifcApi.OpenModel(ifcData);

  const IFCBUILDINGSTOREY = 3124254112;
  const IFCSPACE = 3856911033;

  const storeys = [];
  const spaces = [];
  const instances = [];

  // Helper to get all elements of a type
  function getByType(typeId) {
    try {
      const ids = ifcApi.GetLineIDsWithType(modelId, typeId);
      const count = ids.size ? ids.size() : ids.length || 0;
      const result = [];
      for (let i = 0; i < count; i++) {
        const id = ids.size ? ids.get(i) : ids[i];
        try {
          result.push(ifcApi.GetLine(modelId, id));
        } catch {}
      }
      return result;
    } catch {
      return [];
    }
  }

  // Storeys
  for (const s of getByType(IFCBUILDINGSTOREY)) {
    const name = s?.Name?.value || s?.LongName?.value || `storey_${storeys.length}`;
    const globalId = s?.GlobalId?.value || null;
    storeys.push({ id: String(s?.expressID || ""), name, globalId });
  }

  // Spaces
  for (const s of getByType(IFCSPACE)) {
    const name = s?.Name?.value || s?.LongName?.value || `space_${spaces.length}`;
    const globalId = s?.GlobalId?.value || null;
    // Find parent storey via IfcRelContainedInSpatialStructure or IfcRelAggregates
    spaces.push({ id: String(s?.expressID || ""), name, globalId, parentId: "" });
  }

  ifcApi.CloseModel(modelId);
  console.log(`Hierarchy: ${storeys.length} storeys, ${spaces.length} spaces`);
  return { storeys, spaces, instances };
}

// ─── XKT-only job: skip conversion, just mark tiles as processed ───
async function processXktJob(job) {
  const jobId = job.id;
  const buildingGuid = job.building_fm_guid;

  console.log(`\n=== Processing XKT-only job ${jobId} ===`);
  console.log(`Building: ${buildingGuid}, source: ${job.ifc_storage_path}`);

  try {
    await reportProgress(jobId, 20, "XKT-only job — verifying existing models...");

    // The XKT files already exist in xkt-models bucket.
    // We just need to ensure they're registered in xkt_models table
    // and populate hierarchy if possible.
    // The edge function /complete handles xkt_models upsert,
    // so we report the existing tiles.

    // Download the XKT file to verify it exists
    if (job.ifc_download_url) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xkt-verify-"));
      try {
        const xktPath = path.join(tmpDir, "model.xkt");
        const fileSize = await downloadFile(job.ifc_download_url, xktPath);
        console.log(`  XKT file verified: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);
        await reportProgress(jobId, 50, `XKT file verified (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
      } catch (dlErr) {
        console.warn(`  Could not download XKT for verification: ${dlErr.message}`);
        await reportProgress(jobId, 50, `XKT file not downloadable — skipping verification`);
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }

    // Report the existing model as a tile so /complete registers it
    const tiles = [{
      model_id: `${buildingGuid}_xkt`,
      model_name: job.model_name || "XKT Model",
      file_name: path.basename(job.ifc_storage_path),
      storage_path: job.ifc_storage_path,
      file_size: 0,
      storey_fm_guid: null,
    }];

    await reportProgress(jobId, 90, "Marking XKT job complete...");
    await api("complete", "POST", { job_id: jobId, tiles });
    console.log(`✅ XKT-only job ${jobId} complete`);
  } catch (e) {
    console.error(`❌ XKT-only job ${jobId} failed:`, e);
    await api("fail", "POST", { job_id: jobId, error_message: e.message }).catch(() => {});
  }
}

// ─── IFC job: full conversion pipeline ───
async function processIfcJob(job) {
  const jobId = job.id;
  const buildingGuid = job.building_fm_guid;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xkt-worker-"));

  console.log(`\n=== Processing IFC job ${jobId} ===`);
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

    // Validate: first bytes should be "ISO-10303" for IFC files
    const header = ifcData.slice(0, 20).toString("utf8");
    if (!header.includes("ISO") && !header.includes("IFC")) {
      throw new Error(`File does not look like IFC (header: "${header.slice(0, 16)}"). Possibly a binary XKT file was queued as IFC.`);
    }

    let modelId;
    try {
      modelId = ifcApi.OpenModel(ifcData);
    } catch (openErr) {
      console.error(`  web-ifc OpenModel failed. File size: ${(fileSize / 1024 / 1024).toFixed(1)} MB, header: "${header.slice(0, 16)}"`);
      throw openErr;
    }

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
        const convertOpts = {
          source: ifcPath,
          outputXKTModel: null,
          output: xktPath,
          log: (msg) => console.log(`  [xkt] ${msg}`),
        };
        // If we have per-storey element IDs, use includeEntityIds to filter
        if (storey.elementIds && storey.elementIds.length > 0) {
          convertOpts.includeEntityIds = storey.elementIds.map(String);
          console.log(`  Filtering storey "${storey.name}": ${storey.elementIds.length} element IDs`);
        }
        await convert2xkt(convertOpts);

        const xktSize = fs.existsSync(xktPath) ? fs.statSync(xktPath).size : 0;

        if (xktSize > 0) {
          const storagePath = `${buildingGuid}/${safeName}.xkt`;
          const uploadData = await api("upload-url", "POST", { path: storagePath });
          await uploadFile(uploadData.signedUrl, xktPath, uploadData.token);

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

    // 4. Fallback: full model if no tiles
    if (tiles.length === 0) {
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

    // 5. Report completion
    await api("complete", "POST", { job_id: jobId, tiles });
    console.log(`✅ Job ${jobId} complete: ${tiles.length} tiles`);

    // 6. Extract and populate building hierarchy
    try {
      await reportProgress(jobId, 95, "Populating building hierarchy...");
      const hierarchy = await extractHierarchy(ifcPath, buildingGuid);
      if (hierarchy.storeys.length > 0 || hierarchy.spaces.length > 0) {
        const result = await api("populate-hierarchy", "POST", {
          building_fm_guid: buildingGuid,
          storeys: hierarchy.storeys,
          spaces: hierarchy.spaces,
          instances: hierarchy.instances,
        });
        console.log(`  Hierarchy populated: ${JSON.stringify(result)}`);
      }
    } catch (hierErr) {
      console.warn("Hierarchy population failed (non-fatal):", hierErr.message);
    }
  } catch (e) {
    console.error(`❌ Job ${jobId} failed:`, e);
    await api("fail", "POST", { job_id: jobId, error_message: e.message }).catch(() => {});
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// ─── Job dispatcher ───
async function processJob(job) {
  const sourceType = job.source_type || "ifc";
  const storagePath = job.ifc_storage_path || "";

  // Extension guard: if the file ends in .xkt, ALWAYS treat as XKT job
  // regardless of source_type — prevents IFC parser from crashing on binary XKT data
  const isXktFile = storagePath.toLowerCase().endsWith(".xkt");

  if (sourceType === "xkt" || isXktFile) {
    if (isXktFile && sourceType !== "xkt") {
      console.warn(`⚠️ File extension is .xkt but source_type='${sourceType}' — forcing XKT path`);
    }
    await processXktJob(job);
  } else {
    await processIfcJob(job);
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
