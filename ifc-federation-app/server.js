/**
 * server.js — IFC Federation App backend.
 *
 * A standalone app, deliberately separate from the main Geminus web app —
 * lives in this repo for now (so it can share the already-tested pipeline
 * code in ../ifc-federation/*.js) but is its own deployable unit, meant to
 * move to Render later. Runs locally today: `npm install && npm run server`.
 *
 * Wraps the existing, already-verified pipeline modules unchanged:
 *  - Phase 1: geminus-plus-lookup.js
 *  - Phase 2: architect-model-template.js
 *  - Phase 3: (this file's /api/ingest route plays that orchestration role)
 *  - Phase 4: storey-reconciliation.js
 *  - Phase 5: federation-guid-validator.js
 *  - Phase 7: ifc-writer.js
 * Phase 6 (xeokit viewer) is intentionally not part of this app yet — no
 * real XKT data was available to build/verify it against here, and it would
 * have meaningfully expanded this first cut. Fast-follow candidate.
 *
 * Current limitation, worth knowing before moving to Render: every
 * uploaded file's full text is kept in an in-memory session for the
 * lifetime of that analysis (same approach already proven locally against
 * real 276 MB files). Fine for one person running this on their own
 * machine; a shared, always-on Render deployment will eventually want
 * disk-backed or streamed sessions instead so memory doesn't grow
 * unbounded across concurrent users.
 */

import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBuildingByIdentifier, getStoreysForBuilding, getAllBuildings } from '../ifc-federation/geminus-plus-lookup.js';
import { buildCanonicalStoreys } from '../ifc-federation/architect-model-template.js';
import { buildMatrix, applyReconciliation } from '../ifc-federation/storey-reconciliation.js';
import { validateFederation, repairFederation } from '../ifc-federation/federation-guid-validator.js';
import { applyFederationWrites } from '../ifc-federation/ifc-writer.js';
import { getAvailableRules, validateFile, runIfctesterBcf } from '../ifc-federation/ids-validator.js';
import { listRules, getRule, createRule, updateRule, deleteRule } from '../ifc-federation/ids-rules-editor.js';
import { generateIdsReportPdf } from './pdf-report.js';

/**
 * Progress reporting for /api/ingest.
 *
 * The upload itself (potentially hundreds of MB) is tracked client-side via
 * XHR upload-progress events — the server doesn't need to do anything for
 * that part. What the server DOES need to report is everything after the
 * upload finishes: resolving canonical storeys, building the matrix, and
 * validating FMGUIDs across the federation — confirmed by direct
 * measurement to take anywhere from a few seconds to over a minute on real
 * files (the Science Tower test: ~19-90s per phase on a 276 MB file).
 *
 * Jobs run in the background after the upload completes; the client polls
 * GET /api/ingest/:jobId for { status, progress, stage }.
 */
const jobs = new Map(); // jobId -> { status: 'processing'|'done'|'error', progress, stage, result?, error? }

function makeJob() {
  const jobId = randomUUID();
  jobs.set(jobId, { status: 'processing', progress: 0, stage: 'Starting…' });
  return jobId;
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (job) Object.assign(job, patch);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, 'tmp-uploads');
const PORT = process.env.PORT || 4500;

await mkdir(UPLOAD_DIR, { recursive: true });

// Preserve the original file extension (multer's default `dest` option
// saves uploads under a bare random hash with no extension at all) --
// ifctester's CLI refuses to run against a file that isn't named `*.ifc`,
// confirmed in practice.
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname) || '.ifc'}`),
});
const upload = multer({ storage });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // JSON bodies only carry overrides/ids, never file content

// ── In-memory session store ──────────────────────────────────────────────
// sessionId -> { models: [{modelName, filePath, ifcText}], canonicalStoreys,
//                canonicalSource, building, matrix, validation, storeyWrites }
const sessions = new Map();

// ── Phase 1: Geminus Plus lookup, exposed standalone for the "does this
//    building already exist" check before a user commits to an upload ──────
app.post('/api/lookup-building', async (req, res) => {
  try {
    const { identifier } = req.body ?? {};
    if (!identifier) return res.status(400).json({ error: 'identifier required' });

    const building = await getBuildingByIdentifier(identifier);
    if (!building) return res.json({ found: false });

    const storeys = await getStoreysForBuilding(building.fmguid);
    res.json({ found: true, building, storeys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List every Geminus Plus building, for a dropdown instead of requiring
//    the user to already know/type a building's FMGUID. ────────────────────
app.get('/api/buildings', async (req, res) => {
  try {
    const buildings = await getAllBuildings();
    res.json({ buildings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Phase 2+3+4+5: ingest N discipline files (+ optional architect file
//    and/or Geminus Plus building identifier), build the matrix and run
//    cross-model FMGUID validation. Returns everything needed to render the
//    reconciliation UI; nothing is written to any file yet.
//
//    Runs as a background job so real progress can be reported: the upload
//    itself blocks this handler (multer), but everything after it — parsing
//    potentially hundreds of MB of IFC text — happens after responding with
//    a jobId, so the client can poll GET /api/ingest/:jobId immediately. ───
app.post('/api/ingest', upload.fields([
  { name: 'architectFile', maxCount: 1 },
  { name: 'disciplineFiles' },
]), async (req, res) => {
  try {
    const buildingIdentifier = req.body?.buildingIdentifier || undefined;
    // Discipline model names, one per uploaded discipline file, same order —
    // sent as a JSON array string because multipart fields are all strings.
    const disciplineNames = JSON.parse(req.body?.disciplineNames || '[]');

    const architectUpload = req.files?.architectFile?.[0];
    const disciplineUploads = req.files?.disciplineFiles ?? [];

    if (disciplineUploads.length === 0 && !architectUpload) {
      return res.status(400).json({ error: 'At least one file is required.' });
    }
    if (disciplineUploads.length !== disciplineNames.length) {
      return res.status(400).json({ error: 'disciplineNames must have one entry per disciplineFiles upload.' });
    }

    // Objects (rooms, assets, etc.) that already carry an FMGUID are
    // respected by default (only missing/duplicate ones are touched) — set
    // this to regenerate every non-storey FMGUID unconditionally instead,
    // for when the source files' existing FMGUIDs aren't trusted.
    const regenerateAllGuids = req.body?.regenerateAllGuids === 'true';

    const jobId = makeJob();
    res.json({ jobId });

    // Fire-and-forget: errors are captured onto the job, not thrown here —
    // the response has already been sent.
    runIngestJob(jobId, { buildingIdentifier, architectUpload, disciplineUploads, disciplineNames, regenerateAllGuids }).catch(err => {
      console.error(err);
      updateJob(jobId, { status: 'error', error: err.message });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ingest/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Unknown job.' });
  res.json(job);
});

async function runIngestJob(jobId, { buildingIdentifier, architectUpload, disciplineUploads, disciplineNames, regenerateAllGuids }) {
  // Stage boundaries (0-100). Canonical-storey resolution and matrix building
  // both re-scan every uploaded file (parseStoreys), and validation scans
  // every file again for every entity type (parseElements) — confirmed by
  // direct measurement to be comparable, non-trivial costs on real files, not
  // "cheap steps" a UI could skip reporting on.
  const STAGE = { canonical: [0, 20], matrix: [20, 55], validate: [55, 95], finalize: [95, 100] };
  const mapRange = ([lo, hi], fraction) => lo + fraction * (hi - lo);

  updateJob(jobId, { stage: 'Reading files…', progress: 0 });

  // ── Resolve canonical storeys: Geminus Plus first, architect fallback ──
  let canonicalSource;
  let building = null;
  let canonicalStoreys;
  let buildingLookupWarning = null;

  if (buildingIdentifier) {
    building = await getBuildingByIdentifier(buildingIdentifier);
    if (!building) {
      // Don't silently fall back to the architect model as master when the
      // user explicitly picked a building -- that's a surprising, easy-to-miss
      // switch of the source of truth. Surface it instead.
      buildingLookupWarning = `Building "${buildingIdentifier}" was selected but could not be found in Geminus Plus — falling back to the architect model as master.`;
    }
  }

  if (building) {
    canonicalSource = 'geminus-plus';
    canonicalStoreys = await getStoreysForBuilding(building.fmguid);
    updateJob(jobId, { stage: 'Fetched storeys from Geminus Plus', progress: STAGE.canonical[1] });
  } else {
    if (!architectUpload) {
      throw new Error(
        `Building "${buildingIdentifier ?? '(none given)'}" not found in Geminus Plus, and no architect file was provided as the fallback template.`
      );
    }
    canonicalSource = 'architect-model';
    const architectIfcText = await readFile(architectUpload.path, 'utf8');
    updateJob(jobId, { stage: 'Parsing architect model storeys…' });
    canonicalStoreys = await buildCanonicalStoreys(architectIfcText, (fraction) =>
      updateJob(jobId, { progress: mapRange(STAGE.canonical, fraction) })
    );
  }
  updateJob(jobId, { progress: STAGE.canonical[1] });

  // ── Load every uploaded model's text once (architect included, if any,
  //    so its own storeys go through the same matrix as everyone else's) ──
  const models = [];
  if (architectUpload) {
    models.push({
      modelName: 'architect',
      filePath: architectUpload.path,
      ifcText: await readFile(architectUpload.path, 'utf8'),
    });
  }
  for (let i = 0; i < disciplineUploads.length; i++) {
    models.push({
      modelName: disciplineNames[i],
      filePath: disciplineUploads[i].path,
      ifcText: await readFile(disciplineUploads[i].path, 'utf8'),
    });
  }

  updateJob(jobId, { stage: 'Building match matrix…' });
  const matrix = await buildMatrix(canonicalStoreys, models, {
    onProgress: (modelName, fraction) =>
      updateJob(jobId, {
        progress: mapRange(STAGE.matrix, fraction),
        stage: modelName ? `Building match matrix… (${modelName})` : 'Building match matrix…',
      }),
  });

  updateJob(jobId, { stage: 'Validating FMGUIDs…', progress: STAGE.validate[0] });
  const validation = await validateFederation(models, {
    onProgress: (modelName, fraction) =>
      updateJob(jobId, {
        progress: mapRange(STAGE.validate, fraction),
        stage: modelName ? `Validating FMGUIDs… (${modelName})` : 'Validating FMGUIDs…',
      }),
  });
  repairFederation(validation, { regenerateAll: regenerateAllGuids }); // mutates validation.elements' fmguid in place

  updateJob(jobId, { stage: 'Done', progress: STAGE.finalize[1] });

  const sessionId = randomUUID();
  sessions.set(sessionId, { models, canonicalStoreys, canonicalSource, building, matrix, validation, storeyWrites: [] });

  updateJob(jobId, {
    status: 'done',
    result: {
      sessionId,
      canonicalSource,
      building,
      buildingLookupWarning,
      canonicalStoreys,
      matrix,
      guidValidation: { stats: validation.stats, duplicates: validation.duplicates },
    },
  });
}

// ── Phase 4 confirm: apply the user's overrides on top of the matrix's
//    suggestions, storing the resulting write-back list on the session. ────
app.post('/api/reconcile', (req, res) => {
  try {
    const { sessionId, overrides } = req.body ?? {};
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Unknown session — re-run /api/ingest.' });

    session.storeyWrites = applyReconciliation(session.matrix, overrides ?? {});
    res.json({ storeyWrites: session.storeyWrites });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Corrected IFC text for one model in a session: same write-back logic used
// by /api/export, factored out so /api/validate-ids can validate against
// what actually gets exported instead of the untouched original upload.
// Object-level FMGUID assignments always apply (repairFederation already ran
// during /api/ingest); storey FMGUIDs only apply once reconciliation has been
// confirmed via /api/reconcile (session.storeyWrites is empty until then).
function buildCorrectedIfcText(session, modelName, ifcText) {
  const storeyWritesForModel = session.storeyWrites.filter(w => w.modelName === modelName);
  const guidAssignments = session.validation.elements
    .filter(el => el.modelName === modelName && !el.isStorey)
    .map(el => ({ globalId: el.globalId, fmguid: el.fmguid }));
  return applyFederationWrites(ifcText, { storeyWrites: storeyWritesForModel, guidAssignments }).ifcText;
}

// ── Phase 7: write confirmed storey + object FMGUIDs back into every file,
//    zip the results, stream the zip back. ─────────────────────────────────
app.post('/api/export', async (req, res) => {
  try {
    const { sessionId } = req.body ?? {};
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Unknown session — re-run /api/ingest.' });
    if (session.storeyWrites.length === 0 && session.matrix.rows.length > 0) {
      return res.status(400).json({ error: 'No confirmed storey mapping yet — call /api/reconcile first.' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="ifc-federation-export.zip"');

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    for (const { modelName, ifcText } of session.models) {
      const newText = buildCorrectedIfcText(session, modelName, ifcText);
      archive.append(newText, { name: `${modelName}.ifc` });
    }

    await archive.finalize();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── IDS validation (docs/plans/ids-validation-plan.md) ──────────────────────
// A different kind of check than FMGUID handling: validates arbitrary
// information requirements (buildingSMART's open IDS standard) using
// ifctester as a subprocess. Rules come from the shared library in
// ../ifc-federation/ids-rules/ (a deliberate choice — see the plan).
//
// Runs against the CORRECTED IFC text (same write-back logic as
// /api/export, via buildCorrectedIfcText), not the raw upload — validating
// the original file makes every "FmGuid required" rule fail even after the
// user has confirmed a mapping, which is confusing: the corrected content
// only exists once you export it, so checking the untouched upload doesn't
// reflect what the user is about to ship. Each model's corrected text is
// written to a throwaway temp .ifc file (ifctester's CLI requires a real
// file path) and cleaned up after validation.
app.get('/api/ids-rules', async (req, res) => {
  try {
    const rules = await getAvailableRules();
    res.json({ rules: rules.map(({ id, title }) => ({ id, title })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── IDS rule editor: read/create/update/delete rules in the shared library.
//    Scoped to the single-specification / single-property-requirement shape
//    the library actually uses today -- see ids-rules-editor.js. ───────────
app.get('/api/ids-rules/list', async (req, res) => {
  try {
    res.json({ rules: await listRules() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ids-rules/:id', async (req, res) => {
  try {
    res.json(await getRule(req.params.id));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/ids-rules', async (req, res) => {
  try {
    const { id, ...fields } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Missing rule id.' });
    const ruleId = id.endsWith('.ids') ? id : `${id}.ids`;
    res.json(await createRule(ruleId, fields));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/ids-rules/:id', async (req, res) => {
  try {
    res.json(await updateRule(req.params.id, req.body ?? {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/ids-rules/:id', async (req, res) => {
  try {
    await deleteRule(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/validate-ids', async (req, res) => {
  const tmpDirs = [];
  try {
    const { sessionId } = req.body ?? {};
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Unknown session — re-run /api/ingest.' });

    const results = {};
    for (const { modelName, ifcText } of session.models) {
      const correctedText = buildCorrectedIfcText(session, modelName, ifcText);
      const tmpDir = await mkdtemp(path.join(tmpdir(), 'ids-validate-'));
      tmpDirs.push(tmpDir);
      const tmpPath = path.join(tmpDir, `${modelName}.ifc`);
      await writeFile(tmpPath, correctedText, 'utf8');
      results[modelName] = await validateFile(tmpPath);
    }
    session.idsResults = results;
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    await Promise.all(tmpDirs.map(d => rm(d, { recursive: true, force: true })));
  }
});

// Merge every failing (model, rule) pair's individual BCF output into one
// combined report — ifctester only produces one .bcf per (ifc, ids) pair,
// but a designer receiving this wants one file covering every discipline
// and every rule, not a folder of separate downloads.
app.post('/api/validate-ids/export', async (req, res) => {
  const { sessionId } = req.body ?? {};
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Unknown session — re-run /api/ingest.' });
  if (!session.idsResults) return res.status(400).json({ error: 'Run /api/validate-ids first.' });

  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ids-bcf-'));
  try {
    const rules = await getAvailableRules();
    const rulesById = new Map(rules.map(r => [r.id, r]));
    const combined = new AdmZip();
    let projectAdded = false;
    let issueCount = 0;

    for (const { modelName, filePath } of session.models) {
      const modelResults = session.idsResults[modelName] ?? [];
      for (const { ruleId, report } of modelResults) {
        if (!report) continue;
        const anyFailing = report.specifications.some(s => !s.status);
        if (!anyFailing) continue; // nothing to report for this (model, rule) pair

        const rule = rulesById.get(ruleId);
        if (!rule) continue;
        const bcfPath = path.join(tmpDir, `${modelName}__${ruleId}.bcf`);
        await runIfctesterBcf(filePath, rule.path, bcfPath);

        const zip = new AdmZip(bcfPath);
        for (const entry of zip.getEntries()) {
          if (entry.entryName === 'project.bcfp' || entry.entryName === 'bcf.version') {
            if (projectAdded) continue; // keep only the first copy
            projectAdded = true;
          }
          // Namespace each issue folder by model+rule so identical GlobalIds
          // across disciplines never collide when merged into one archive.
          const isTopLevelFile = !entry.entryName.includes('/');
          const outName = isTopLevelFile ? entry.entryName : `${modelName}__${ruleId}__${entry.entryName}`;
          combined.addFile(outName, entry.getData());
          if (entry.entryName.endsWith('/markup.bcf')) issueCount++;
        }
      }
    }

    if (issueCount === 0) {
      return res.json({ empty: true, message: 'No failed checks to report — everything passed.' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="ids-validation-report.bcfzip"');
    res.send(combined.toBuffer());
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// Human-readable A4 companion to the BCF export above — same
// session.idsResults data, rendered as a document instead of a
// machine-openable bundle. See pdf-report.js.
app.post('/api/validate-ids/pdf', async (req, res) => {
  try {
    const { sessionId } = req.body ?? {};
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Unknown session — re-run /api/ingest.' });
    if (!session.idsResults) return res.status(400).json({ error: 'Run /api/validate-ids first.' });

    const pdfBuffer = await generateIdsReportPdf(session.idsResults);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="geminus-ids-validation-report.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Cleanup: drop a session and its uploaded temp files ─────────────────────
app.delete('/api/session/:sessionId', async (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).end();
  sessions.delete(req.params.sessionId);
  await Promise.all(session.models.map(m => rm(m.filePath, { force: true }))).catch(() => {});
  res.status(204).end();
});

// ── Serve the built client in production (Render) as one deployable ────────
// Locally, the two-process setup in README.md (this server + `vite dev` with
// its own proxy) is still how development works — this static-serving path
// only activates once `client/dist` actually exists, i.e. after `npm run
// build` has run, which the local dev workflow never does. Registered after
// every /api route so those always take priority; the catch-all below only
// matches what nothing else did, and must come last of all non-error routes
// for the same reason.
const clientDist = path.join(__dirname, 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ── Global error handler ─────────────────────────────────────────────────
// Without this, an error thrown outside a route's own try/catch (e.g. by
// multer's upload middleware, which runs BEFORE the route handler) falls
// through to Express's default error page — an HTML stack trace, not JSON.
// The client's `await res.json()` then fails with "Unexpected token '<'",
// which is genuinely confusing since it looks like a JSON parsing bug when
// the real error (shown only in this server's own log) is something else
// entirely. Confirmed in practice: this exact class of error was hit when
// the upload directory was deleted out from under a still-running server
// (ENOENT from multer's disk storage) — the fix for that specific case is
// "don't delete tmp-uploads/ while the server is running", but ANY future
// upload-time error deserves a JSON response here, not a guessing game.
// Must be registered last, and must have all 4 parameters (err, req, res, next)
// for Express to recognize it as error-handling middleware.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`IFC Federation App backend listening on http://localhost:${PORT}`);
});
