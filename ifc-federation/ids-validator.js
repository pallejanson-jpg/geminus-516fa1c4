/**
 * ids-validator.js
 *
 * IDS (Information Delivery Specification) validation + BCF reporting, per
 * docs/plans/ids-validation-plan.md. Wraps `ifctester` (part of
 * IfcOpenShell, https://docs.ifcopenshell.org/ifctester.html) as a
 * subprocess rather than reimplementing IDS validation in JS — ifctester
 * already correctly implements all six IDS facet types against IFC's full
 * data model, which would be a large, risky undertaking to redo.
 *
 * This is a genuinely different kind of check than the rest of
 * ifc-federation/*.js: FMGUID handling is Geminus's own identity scheme;
 * IDS is buildingSMART's open standard for validating arbitrary
 * information requirements (naming, required properties, classifications,
 * materials, etc.) — the two complement each other, an IFC file can be
 * FMGUID-clean and still fail IDS rules, or vice versa.
 *
 * Requires Python 3 with `ifcopenshell` + `ifctester` installed
 * (`pip install ifcopenshell ifctester`). This is the one place in the
 * whole ifc-federation pipeline with a non-Node dependency — a deliberate,
 * documented trade-off (see the plan) in exchange for not building an IDS
 * engine from scratch.
 *
 * Rules come from a shared library checked into this repo
 * (ifc-federation/ids-rules/*.ids) rather than per-project uploads, by
 * decision — see the plan for why. Every .ids file in that folder is run
 * against every uploaded model.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(__dirname, 'ids-rules');
const PYTHON = process.env.IDS_PYTHON_BIN || 'python';

/**
 * List every .ids rule file in the shared library, with its human title
 * (parsed out of the file's own <title> — cheap regex, avoids pulling in
 * an XML parser dependency just for this).
 * @returns {Promise<Array<{ id: string, title: string, path: string }>>}
 */
async function getAvailableRules() {
  const files = (await readdir(RULES_DIR)).filter(f => f.endsWith('.ids'));
  const rules = [];
  for (const file of files) {
    const text = await readFile(path.join(RULES_DIR, file), 'utf8');
    const titleMatch = text.match(/<title>([^<]*)<\/title>/);
    rules.push({ id: file, title: titleMatch?.[1] ?? file, path: path.join(RULES_DIR, file) });
  }
  return rules;
}

/**
 * Run one .ids rule file against one IFC file, returning ifctester's own
 * JSON report shape (see ifctester.reporter's Json reporter): a `title`
 * (from the .ids's own <title>), `specifications[]` each with
 * `total_applicable`, `total_applicable_pass`, `total_applicable_fail`,
 * and `applicable_entities[]` (failing/passing element details incl.
 * `global_id`).
 */
async function runIfctesterJson(ifcPath, idsPath) {
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'ids-json-'));
  const outPath = path.join(tmpDir, 'report.json');
  try {
    await execFileAsync(PYTHON, ['-m', 'ifctester', idsPath, ifcPath, '-r', 'Json', '-o', outPath], {
      maxBuffer: 32 * 1024 * 1024,
    });
    const text = await readFile(outPath, 'utf8');
    return JSON.parse(text);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Run one .ids rule file against one IFC file and produce a BCF report
 * (a .bcf/.bcfzip file — itself a zip of per-issue folders, one per failing
 * check). Returns the path to the generated file; caller is responsible
 * for reading/merging/cleaning it up.
 */
async function runIfctesterBcf(ifcPath, idsPath, outPath) {
  await execFileAsync(PYTHON, ['-m', 'ifctester', idsPath, ifcPath, '-r', 'Bcf', '-o', outPath], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return outPath;
}

/**
 * Validate one IFC file against every rule in the shared library.
 * @param {string} ifcPath
 * @returns {Promise<{ ruleId: string, ruleTitle: string, report: object, error?: string }[]>}
 */
async function validateFile(ifcPath) {
  const rules = await getAvailableRules();
  const results = [];
  for (const rule of rules) {
    try {
      const report = await runIfctesterJson(ifcPath, rule.path);
      results.push({ ruleId: rule.id, ruleTitle: rule.title, report });
    } catch (err) {
      results.push({ ruleId: rule.id, ruleTitle: rule.title, report: null, error: err.message });
    }
  }
  return results;
}

export { getAvailableRules, runIfctesterJson, runIfctesterBcf, validateFile, RULES_DIR };

// ── Manual CLI check: node ifc-federation/ids-validator.js <path-to.ifc> ──
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ifcPath = process.argv[2];
  if (!ifcPath) {
    console.error('Usage: node ifc-federation/ids-validator.js <path-to.ifc>');
    process.exit(1);
  }

  (async () => {
    const rules = await getAvailableRules();
    console.log(`Found ${rules.length} rule(s) in ${RULES_DIR}:`);
    for (const r of rules) console.log(`  ${r.id} — ${r.title}`);

    console.log(`\nValidating ${ifcPath}...`);
    const results = await validateFile(ifcPath);
    for (const { ruleTitle, report, error } of results) {
      if (error) { console.log(`\n${ruleTitle}: ERROR — ${error}`); continue; }
      console.log(`\n${ruleTitle}:`);
      for (const spec of report.specifications) {
        console.log(`  ${spec.status ? 'PASS' : 'FAIL'}  ${spec.name} (${spec.total_applicable_pass}/${spec.total_applicable})`);
      }
    }
  })().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
