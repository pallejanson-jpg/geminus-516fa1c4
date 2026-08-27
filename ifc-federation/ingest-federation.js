/**
 * ingest-federation.js
 *
 * Phase 3 of the IFC federation pipeline (docs/plans/ifc-federation-plan.md).
 *
 * The orchestration entry point: accepts N discipline IFC files for one
 * building, resolves the canonical storey list (Geminus Plus if the building
 * exists — Phase 1 — else the architect model — Phase 2), then produces
 * everything Phase 4 (reconciliation matrix) and Phase 5 (cross-model FMGUID
 * validation) need. This module does no new parsing itself — Phase 2 and
 * Phase 5 already implement the actual IFC-text parsing; this just wires
 * them together into one call so a caller (an upload endpoint, or a CLI)
 * doesn't have to know the phase order.
 */

import { readFile } from 'node:fs/promises';
import { getBuildingByIdentifier, getStoreysForBuilding } from './geminus-plus-lookup.js';
import { buildCanonicalStoreys } from './architect-model-template.js';
import { buildMatrix } from './storey-reconciliation.js';
import { validateFederation } from './federation-guid-validator.js';

/**
 * @typedef {{ modelName: string, filePath: string }} DisciplineFileInput
 *
 * @param {object} input
 * @param {string} [input.buildingIdentifier] - FMGUID or name to look up in Geminus Plus (Phase 1).
 * @param {DisciplineFileInput} [input.architectFile] - required only if the
 *   building is NOT found in Geminus Plus; becomes the canonical template (Phase 2).
 * @param {DisciplineFileInput[]} input.disciplineFiles - every uploaded model,
 *   INCLUDING the architect file if you want it to also appear as a matrix
 *   column (recommended: even the canonical source model's own storeys go
 *   through the same reconciliation matrix as everyone else's).
 *
 * @returns {Promise<{
 *   canonicalSource: 'geminus-plus' | 'architect-model',
 *   building: { fmguid, name } | null,
 *   canonicalStoreys: Array<{ fmguid, name, sequence }>,
 *   matrix: ReturnType<typeof buildMatrix>,
 *   guidValidation: ReturnType<typeof validateFederation>,
 * }>}
 */
async function ingestFederation({ buildingIdentifier, architectFile, disciplineFiles }) {
  if (!disciplineFiles || disciplineFiles.length === 0) {
    throw new Error('ingestFederation requires at least one discipline file.');
  }

  // ── Resolve canonical storeys: Geminus Plus first, architect model fallback ──
  let canonicalSource;
  let building = null;
  let canonicalStoreys;

  if (buildingIdentifier) {
    building = await getBuildingByIdentifier(buildingIdentifier);
  }

  if (building) {
    canonicalSource = 'geminus-plus';
    canonicalStoreys = await getStoreysForBuilding(building.fmguid);
  } else {
    if (!architectFile) {
      throw new Error(
        `Building "${buildingIdentifier ?? '(none given)'}" not found in Geminus Plus, and no architectFile ` +
        `was provided to use as the fallback template (see plan's authority-hierarchy rule).`
      );
    }
    canonicalSource = 'architect-model';
    const architectIfcText = await readFile(architectFile.filePath, 'utf8');
    canonicalStoreys = buildCanonicalStoreys(architectIfcText);
  }

  // ── Load every discipline model's raw text once, reused for both Phase 4 and Phase 5 ──
  const models = await Promise.all(
    disciplineFiles.map(async ({ modelName, filePath }) => ({
      modelName,
      ifcText: await readFile(filePath, 'utf8'),
    }))
  );

  // ── Phase 4: storey reconciliation matrix (suggestions only, nothing applied yet) ──
  const matrix = buildMatrix(canonicalStoreys, models);

  // ── Phase 5: cross-model FMGUID validation (object-level, storeys excluded) ──
  const guidValidation = validateFederation(models);

  return { canonicalSource, building, canonicalStoreys, matrix, guidValidation };
}

export { ingestFederation };

// ── Manual CLI check ──────────────────────────────────────────────────────────
// node ifc-federation/ingest-federation.js --architect <path> <modelName1>=<path1> [<modelName2>=<path2> ...]
// node ifc-federation/ingest-federation.js --building <fmguidOrName> <modelName1>=<path1> ...
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let buildingIdentifier;
  let architectFile;
  const disciplineFiles = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--building') {
      buildingIdentifier = args[++i];
    } else if (args[i] === '--architect') {
      const filePath = args[++i];
      architectFile = { modelName: 'architect', filePath };
      disciplineFiles.push(architectFile);
    } else if (args[i].includes('=')) {
      const [modelName, filePath] = args[i].split(/=(.+)/);
      disciplineFiles.push({ modelName, filePath });
    }
  }

  if (disciplineFiles.length === 0) {
    console.error(
      'Usage:\n' +
      '  node ifc-federation/ingest-federation.js --architect <path> <name>=<path> [<name>=<path> ...]\n' +
      '  node ifc-federation/ingest-federation.js --building <fmguidOrName> <name>=<path> [<name>=<path> ...]'
    );
    process.exit(1);
  }

  ingestFederation({ buildingIdentifier, architectFile, disciplineFiles })
    .then(result => {
      console.log(`Canonical source: ${result.canonicalSource}${result.building ? ` (${result.building.name})` : ''}`);
      console.log(`Canonical storeys (${result.canonicalStoreys.length}):`);
      for (const s of result.canonicalStoreys) console.log(`  ${s.fmguid}  ${s.name ?? '(unnamed)'}`);

      console.log(`\nMatrix: ${result.matrix.rows.length} rows x ${result.matrix.models.length} models, ${result.matrix.unmatched.length} unmatched`);
      for (const row of result.matrix.rows) {
        const cells = result.matrix.models
          .map(m => `${m}: ${row.cells[m] ? `${row.cells[m].modelStorey.name} [${row.cells[m].confidence}]` : '—'}`)
          .join('  ');
        console.log(`  ${row.canonical.name ?? '(unnamed)'}  ::  ${cells}`);
      }
      if (result.matrix.unmatched.length) {
        console.log('  Unmatched:', result.matrix.unmatched.map(u => `${u.modelName}/${u.modelStorey.name}`).join(', '));
      }

      console.log(`\nGUID validation: ${result.guidValidation.stats.totalElements} elements, ` +
        `${result.guidValidation.stats.missing} missing, ${result.guidValidation.stats.duplicateGroups} duplicate groups`);
      for (const dup of result.guidValidation.duplicates) {
        console.log(`  DUPLICATE ${dup.fmguid}:`, dup.locations.map(l => `${l.modelName}/${l.name}`).join(', '));
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}
