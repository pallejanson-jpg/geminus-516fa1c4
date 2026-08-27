/**
 * ingest.js
 *
 * Phase 3 of the IFC federation pipeline (docs/plans/ifc-federation-plan.md).
 *
 * Orchestrates the full pre-UI pipeline for one building:
 *   1. Load N discipline IFC files from disk.
 *   2. Determine canonical storey authority (Geminus Plus → architect fallback).
 *   3. Build the storey reconciliation matrix (Phase 4 data layer).
 *   4. Validate + report cross-model FMGUID state (Phase 5).
 *
 * Returns a single `FederationSession` object consumed by:
 *   - The reconciliation matrix UI (Phase 4) — `session.matrix`
 *   - The xeokit viewer (Phase 6) — `session.models[].ifcText`
 *   - The write-back step (Phase 7) — `session.matrix`, `session.validation`
 *
 * This module has no 60-second limit (plain Node, same pattern as sync-service.js).
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getBuildingByIdentifier, getStoreysForBuilding } from './geminus-plus-lookup.js';
import { buildCanonicalStoreys }                           from './architect-model-template.js';
import { buildMatrix }                                     from './storey-reconciliation.js';
import { validateFederation }                              from './federation-guid-validator.js';

// ── Discipline detection ─────────────────────────────────────────────────────
// Inferred from filename when not supplied explicitly.
// Patterns match common Nordic/international MEP naming conventions.

const DISCIPLINE_PATTERNS = [
  { re: /\b(ARK|ARCH|ARCHITECT)\b/i,  discipline: 'architecture' },
  { re: /\b(EL|ELEC|ELECTRICAL)\b/i,  discipline: 'electrical' },
  { re: /\bVS\b/i,                     discipline: 'plumbing' },
  { re: /\b(LUF|HVAC|VENT)\b/i,        discipline: 'hvac' },
  { re: /\bKYL\b/i,                    discipline: 'cooling' },
  { re: /\b(BRAND|FIRE|SPRINKLER|SP)\b/i, discipline: 'fire' },
  { re: /\bAUTO\b/i,                   discipline: 'automation' },
  { re: /\b(STRUCT|KONSTRUK|KONSTRUKSJON)\b/i, discipline: 'structure' },
];

function detectDiscipline(filePath) {
  // Normalize separators so \b works: "ARK_Building.ifc" → "ARK BUILDING IFC"
  const name = basename(filePath).replace(/[_\-.]/g, ' ').toUpperCase();
  for (const { re, discipline } of DISCIPLINE_PATTERNS) {
    if (re.test(name)) return discipline;
  }
  return 'unknown';
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline for one building federation.
 *
 * @param {object} opts
 * @param {Array<{ filePath: string, modelName?: string, discipline?: string }>} opts.files
 *   The discipline IFC files to ingest. At least one file required.
 *   `modelName` defaults to the file's basename. `discipline` defaults to
 *   pattern-detected value from the filename.
 *
 * @param {number} [opts.architectIndex=0]
 *   Index into `opts.files` of the architect / reference model.
 *   Used only when Geminus Plus has no entry for this building (Phase 2 fallback).
 *   Defaults to the first file.
 *
 * @param {string} [opts.buildingIdentifier]
 *   Optional FMGUID or designation to look up in Geminus Plus (Phase 1).
 *   When omitted, the architect-model fallback is always used.
 *
 * @returns {Promise<FederationSession>}
 */
async function ingestFederation({ files, architectIndex = 0, buildingIdentifier } = {}) {
  if (!files?.length) throw new Error('ingestFederation: at least one file is required');
  if (architectIndex < 0 || architectIndex >= files.length) {
    throw new Error(`ingestFederation: architectIndex ${architectIndex} out of range (${files.length} files)`);
  }

  // ── Step 1: Load all IFC files from disk ──────────────────────────────────
  const models = await Promise.all(
    files.map(async ({ filePath, modelName, discipline }) => {
      const ifcText = await readFile(filePath, 'utf8');
      return {
        filePath,
        modelName: modelName ?? basename(filePath),
        discipline: discipline ?? detectDiscipline(filePath),
        ifcText,
      };
    })
  );

  console.log(`[ingest] Loaded ${models.length} model(s):`);
  for (const m of models) console.log(`  ${m.modelName} (${m.discipline})`);

  // ── Step 2: Resolve canonical storey source ───────────────────────────────
  let building = null;
  let canonicalStoreys;
  let canonicalSource;

  if (buildingIdentifier) {
    try {
      building = await getBuildingByIdentifier(buildingIdentifier);
    } catch (err) {
      console.warn(`[ingest] Geminus Plus lookup failed (${err.message}); falling back to architect model`);
    }
  }

  if (building) {
    console.log(`[ingest] Canonical source: Geminus Plus — ${building.name} (${building.fmguid})`);
    canonicalStoreys = await getStoreysForBuilding(building.fmguid);
    canonicalSource = 'geminus-plus';
    console.log(`[ingest] ${canonicalStoreys.length} canonical storey(s) from Geminus Plus`);
  } else {
    const archModel = models[architectIndex];
    console.log(`[ingest] Canonical source: architect model — ${archModel.modelName}`);
    canonicalStoreys = buildCanonicalStoreys(archModel.ifcText);
    canonicalSource = 'architect-model';
    console.log(`[ingest] ${canonicalStoreys.length} canonical storey(s) from architect model`);
    if (buildingIdentifier) {
      console.log(`[ingest] Note: building "${buildingIdentifier}" not found in Geminus Plus`);
    }
  }

  // ── Step 3: Build reconciliation matrix (Phase 4 data) ───────────────────
  const matrixModels = models.map(m => ({ modelName: m.modelName, ifcText: m.ifcText }));
  const matrix = buildMatrix(canonicalStoreys, matrixModels);

  const matchedCells = matrix.rows.reduce((n, row) => n + Object.keys(row.cells).length, 0);
  console.log(`[ingest] Reconciliation matrix: ${matrix.rows.length} canonical row(s), ` +
    `${matchedCells} matched cell(s), ${matrix.unmatched.length} unmatched`);
  if (matrix.unmatched.length > 0) {
    console.warn(`[ingest] ${matrix.unmatched.length} storey(s) could not be auto-matched — require manual mapping:`);
    for (const u of matrix.unmatched) {
      console.warn(`  ${u.modelName}: "${u.modelStorey.name ?? '(unnamed)'}"`);
    }
  }

  // ── Step 4: Cross-model FMGUID validation (Phase 5) ──────────────────────
  const validation = validateFederation(matrixModels);
  const { stats } = validation;

  console.log(`[ingest] FMGUID validation: ${stats.totalElements} elements, ` +
    `${stats.missing} missing, ${stats.duplicateGroups} duplicate group(s)`);
  if (validation.duplicates.length > 0) {
    console.warn(`[ingest] Cross-model FMGUID duplicates (non-storey):`);
    for (const dup of validation.duplicates) {
      console.warn(`  ${dup.fmguid}:`);
      for (const loc of dup.locations) {
        console.warn(`    ${loc.modelName} :: ${loc.ifcType} "${loc.name}" (${loc.globalId})`);
      }
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────
  return {
    building,
    canonicalSource,
    canonicalStoreys,
    models,
    matrix,
    validation,
  };
}

export { ingestFederation, detectDiscipline };

/**
 * @typedef {object} FederationSession
 * @property {{ fmguid: string, name: string } | null} building
 *   The Geminus Plus building record, or null if the architect model was used.
 * @property {'geminus-plus' | 'architect-model'} canonicalSource
 * @property {Array<{ fmguid: string, name: string | null, sequence: number | null }>} canonicalStoreys
 * @property {Array<{ filePath: string, modelName: string, discipline: string, ifcText: string }>} models
 * @property {import('./storey-reconciliation.js').Matrix} matrix
 *   The reconciliation matrix (Phase 4 input). Each row is a canonical storey;
 *   each cell is a suggested match in one discipline model, always editable.
 * @property {import('./federation-guid-validator.js').ValidationResult} validation
 *   Cross-model FMGUID state (Phase 5). Pass to `repairFederation()` before write-back.
 */

// ── CLI: node ifc-federation/ingest.js [--building <id>] [--arch <n>] <file1.ifc> ... ──

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let buildingIdentifier;
  let architectIndex = 0;
  const filePaths = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--building' && args[i + 1]) { buildingIdentifier = args[++i]; }
    else if (args[i] === '--arch' && args[i + 1]) { architectIndex = parseInt(args[++i], 10); }
    else { filePaths.push(args[i]); }
  }

  if (filePaths.length === 0) {
    console.error('Usage: node ifc-federation/ingest.js [--building <fmguidOrName>] [--arch <index>] <file1.ifc> [file2.ifc ...]');
    console.error('  --building  Geminus Plus building FMGUID or name (optional; omit to always use architect model)');
    console.error('  --arch      Index of the architect model in the file list (default 0)');
    process.exit(1);
  }

  ingestFederation({
    files: filePaths.map(fp => ({ filePath: fp })),
    architectIndex,
    buildingIdentifier,
  }).then(session => {
    console.log('\n── Summary ─────────────────────────────');
    console.log(`Canonical source : ${session.canonicalSource}`);
    console.log(`Building         : ${session.building?.name ?? '(architect model)'}`);
    console.log(`Canonical storeys: ${session.canonicalStoreys.length}`);
    console.log(`Models loaded    : ${session.models.length}`);
    console.log(`Matrix rows      : ${session.matrix.rows.length}`);
    console.log(`Unmatched        : ${session.matrix.unmatched.length}`);
    console.log(`FMGUID missing   : ${session.validation.stats.missing}`);
    console.log(`FMGUID duplicates: ${session.validation.stats.duplicateGroups} group(s)`);
    console.log(`Ready for Phase 4 UI and Phase 7 write-back.`);
  }).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
