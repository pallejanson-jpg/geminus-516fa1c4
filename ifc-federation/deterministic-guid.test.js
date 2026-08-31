/**
 * deterministic-guid.test.js
 *
 * Regression anchor for deterministic-guid.js's NAMESPACE constant.
 *
 * The whole point of deterministic FMGUID generation (see the business rule
 * added to docs/plans/ifc-federation-plan.md and the warning at the top of
 * deterministic-guid.js) is that the SAME IfcGuid always produces the SAME
 * FMGUID, forever — including across code changes. That guarantee is only
 * as good as NAMESPACE never changing, and a change to it would NOT throw
 * any error: the function would keep working, just silently start
 * producing different output for every IfcGuid it's ever seen. This test
 * exists to make that mistake loud instead of silent — it hardcodes known
 * input -> output pairs computed against the current NAMESPACE, so if
 * NAMESPACE (or the hashing algorithm) ever changes, this test fails.
 *
 * Deliberately a plain Node script with node:assert, not a vitest test —
 * this whole module family (ifc-federation/*.js) has zero npm dependencies
 * on purpose (see deterministic-guid.js's own doc comment), and the
 * project's vitest config only scans `src/**`, not this directory.
 *
 * Run with: node ifc-federation/deterministic-guid.test.js
 */

import assert from 'node:assert/strict';
import { deriveFmGuidFromIfcGuid } from './deterministic-guid.js';

// Computed once against the current NAMESPACE in deterministic-guid.js.
// DO NOT "fix" these values to match a changed NAMESPACE — if this test
// starts failing, the correct response is almost always "revert the
// NAMESPACE change", not "update the expected values here".
const KNOWN_PAIRS = [
  ['1XyzGlobalId0000000001', '82e71016-7fdd-518e-b795-7652f7b81287'],
  ['2ElecGlobalId000000002', 'db69f799-eded-5d49-b245-c3ff28a5e530'],
  ['3Qt0TOJpHFYRbJM5wJhc9w', '0cfbf811-f078-54b8-8625-c721a6ec566a'],
];

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

console.log('Regression anchor: known IfcGuid -> FMGUID pairs');
for (const [ifcGuid, expectedFmGuid] of KNOWN_PAIRS) {
  check(ifcGuid, deriveFmGuidFromIfcGuid(ifcGuid), expectedFmGuid);
}

console.log('\nSanity checks');
check(
  'same IfcGuid twice -> identical FMGUID (determinism)',
  deriveFmGuidFromIfcGuid('re-export-test-guid'),
  deriveFmGuidFromIfcGuid('re-export-test-guid'),
);
{
  const a = deriveFmGuidFromIfcGuid('object-a');
  const b = deriveFmGuidFromIfcGuid('object-b');
  if (a === b) {
    failed = true;
    console.error(`FAIL  different IfcGuids must not collide (both gave ${a})`);
  } else {
    console.log('  OK  different IfcGuids -> different FMGUIDs');
  }
}

if (failed) {
  console.error('\n💥  deterministic-guid.test.js FAILED — see above.');
  console.error('If this is because NAMESPACE changed: revert that change.');
  console.error('If this is a deliberate, approved NAMESPACE change: understand that');
  console.error('every FMGUID ever generated for real data is now orphaned, then');
  console.error('update KNOWN_PAIRS deliberately, not by habit.');
  process.exit(1);
} else {
  console.log('\n✅  All checks passed.');
}
