/**
 * architect-model-template.test.js
 *
 * Regression anchor for Phase 2's storey-generation path
 * (buildCanonicalStoreys), companion to deterministic-guid.test.js.
 *
 * deterministic-guid.test.js checks the raw hash function in isolation;
 * this checks the actual wiring used in production: parse a real IFC
 * storey entity, detect whether it already has an `FmGuid` property, and
 * — when it doesn't — generate one via deriveFmGuidFromIfcGuid(globalId).
 * A bug in that wiring (e.g. deriving from the wrong field, or falling
 * back to a random UUID again by accident) would pass deterministic-guid's
 * own test while still breaking the actual feature this whole change was
 * for. Verified against the same two-storey fixture used throughout this
 * pipeline's other tests (test-fixtures/sample-architect.ifc):
 *   - "Plan 01" already has an FmGuid property in the file -> must be kept
 *     unchanged, not regenerated.
 *   - "Plan 02" has none -> must be generated, deterministically, from its
 *     own IfcGuid ("1XyzGlobalId0000000002").
 *
 * Run with: node ifc-federation/architect-model-template.test.js
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCanonicalStoreys } from './architect-model-template.js';
import { deriveFmGuidFromIfcGuid } from './deterministic-guid.js';

const FIXTURE_PATH = new URL('./test-fixtures/sample-architect.ifc', import.meta.url);

let failed = false;
function check(label, actual, expected) {
  try {
    assert.equal(actual, expected);
    console.log(`  OK  ${label}`);
  } catch {
    failed = true;
    console.error(`FAIL  ${label}\n      expected: ${expected}\n      actual:   ${actual}`);
  }
}

const ifcText = await readFile(FIXTURE_PATH, 'utf8');

// Run 1
const canonical1 = await buildCanonicalStoreys(ifcText);
// Run 2 — simulates the exact same architect file being uploaded again
// later (e.g. a re-export) — this is the scenario the whole feature exists for.
const canonical2 = await buildCanonicalStoreys(ifcText);

const plan01_run1 = canonical1.find(s => s.name === 'Plan 01');
const plan02_run1 = canonical1.find(s => s.name === 'Plan 02');
const plan02_run2 = canonical2.find(s => s.name === 'Plan 02');

console.log('Existing FmGuid property is kept, not regenerated');
check('Plan 01 (had FmGuid in file)', plan01_run1.fmguid, '11111111-1111-1111-1111-111111111111');

console.log('\nMissing FmGuid is generated deterministically from IfcGuid');
check('Plan 02 (no FmGuid in file), run 1', plan02_run1.fmguid, deriveFmGuidFromIfcGuid('1XyzGlobalId0000000002'));

console.log('\nRe-uploading the identical file produces the identical generated FMGUID');
check('Plan 02, run 1 vs run 2 (simulated re-export)', plan02_run2.fmguid, plan02_run1.fmguid);

if (failed) {
  console.error('\n💥  architect-model-template.test.js FAILED — see above.');
  process.exit(1);
} else {
  console.log('\n✅  All checks passed.');
}
