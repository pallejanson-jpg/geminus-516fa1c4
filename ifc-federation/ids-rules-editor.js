/**
 * ids-rules-editor.js
 *
 * Read/write access to the shared IDS rule library (ids-rules/*.ids) for the
 * app's rule editor UI. Deliberately scoped to the one rule shape the
 * library actually uses today: a single <specification> with an Entity
 * applicability facet (one IFC type) and a single Property requirement
 * facet (propertySet + baseName + dataType + cardinality) — the same shape
 * as geminus-fmguid-storeys.ids. Building a general editor for all six IDS
 * facet types (Attribute, Classification, Material, PartOf, multiple
 * specifications per file, multiple requirements per specification) would
 * be a much bigger UI/schema-mapping effort than this rule set currently
 * needs; extend this file's shape (and the client form) if/when a rule
 * actually needs one of those.
 *
 * Uses plain regex parsing (like the rest of ifc-federation/*.js) rather
 * than pulling in an XML library — consistent with the codebase's existing
 * approach to small, well-known XML/STEP shapes.
 */

import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES_DIR } from './ids-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Guards against path traversal via a crafted rule id -- must be a bare filename ending in .ids. */
function resolveRulePath(id) {
  if (!/^[A-Za-z0-9_-]+\.ids$/.test(id)) {
    throw new Error(`Invalid rule id: "${id}" (expected a bare filename like "my-rule.ids")`);
  }
  return path.join(RULES_DIR, id);
}

function xmlEscape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1] : '';
}

/**
 * Parse one rule file down to the editable fields the client form uses.
 * @returns {Promise<{id, title, description, author, version, specName, ifcVersion, entityType, propertySet, baseName, dataType, cardinality}>}
 */
async function getRule(id) {
  const filePath = resolveRulePath(id);
  const xml = await readFile(filePath, 'utf8');

  const specMatch = xml.match(/<specification\s+name="([^"]*)"\s+ifcVersion="([^"]*)"/);
  const entityMatch = xml.match(/<entity>\s*<name>\s*<simpleValue>([^<]*)<\/simpleValue>/);
  const propMatch = xml.match(/<property\s+dataType="([^"]*)"\s+cardinality="([^"]*)"[^>]*>[\s\S]*?<propertySet>\s*<simpleValue>([^<]*)<\/simpleValue>[\s\S]*?<baseName>\s*<simpleValue>([^<]*)<\/simpleValue>/);

  return {
    id,
    title: extractTag(xml, 'title'),
    description: extractTag(xml, 'description'),
    author: extractTag(xml, 'author'),
    version: extractTag(xml, 'version') || '1.0',
    specName: specMatch?.[1] ?? '',
    ifcVersion: specMatch?.[2] ?? 'IFC4',
    entityType: entityMatch?.[1] ?? '',
    dataType: propMatch?.[1] ?? 'IFCTEXT',
    cardinality: propMatch?.[2] ?? 'required',
    propertySet: propMatch?.[3] ?? '',
    baseName: propMatch?.[4] ?? '',
  };
}

/** List every rule in the library with its id + title (for the rule list view). */
async function listRules() {
  const files = (await readdir(RULES_DIR)).filter(f => f.endsWith('.ids'));
  return Promise.all(files.map(async (id) => {
    try {
      const rule = await getRule(id);
      return { id, title: rule.title || id };
    } catch (err) {
      return { id, title: id, error: err.message };
    }
  }));
}

/**
 * Build the .ids XML for one rule from editable fields. Field order inside
 * <info> matters to the IDS schema (title, version, description, author —
 * confirmed by ifctester rejecting a reordered file during earlier manual
 * authoring); comments must never contain "--" (invalid XML).
 */
function buildRuleXml(fields) {
  const {
    title, description, author, version,
    specName, ifcVersion, entityType,
    propertySet, baseName, dataType, cardinality,
  } = fields;

  return `<?xml version="1.0" encoding="UTF-8"?>
<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <info>
    <title>${xmlEscape(title)}</title>
    <version>${xmlEscape(version || '1.0')}</version>
    <description>${xmlEscape(description)}</description>
    <author>${xmlEscape(author)}</author>
  </info>
  <specifications>
    <specification name="${xmlEscape(specName)}" ifcVersion="${xmlEscape(ifcVersion || 'IFC4')}">
      <applicability>
        <entity>
          <name>
            <simpleValue>${xmlEscape(entityType)}</simpleValue>
          </name>
        </entity>
      </applicability>
      <requirements>
        <property dataType="${xmlEscape(dataType || 'IFCTEXT')}" cardinality="${xmlEscape(cardinality || 'required')}">
          <propertySet>
            <simpleValue>${xmlEscape(propertySet)}</simpleValue>
          </propertySet>
          <baseName>
            <simpleValue>${xmlEscape(baseName)}</simpleValue>
          </baseName>
        </property>
      </requirements>
    </specification>
  </specifications>
</ids>
`;
}

function validateFields(fields) {
  const required = ['title', 'specName', 'entityType', 'propertySet', 'baseName'];
  const missing = required.filter(k => !fields[k]?.trim());
  if (missing.length > 0) throw new Error(`Missing required field(s): ${missing.join(', ')}`);
}

/** Create a new rule file. `id` must not already exist. */
async function createRule(id, fields) {
  const filePath = resolveRulePath(id);
  validateFields(fields);
  const xml = buildRuleXml(fields);
  await writeFile(filePath, xml, { encoding: 'utf8', flag: 'wx' }); // wx: fail if it already exists
  return getRule(id);
}

/** Overwrite an existing rule file's content from edited fields. */
async function updateRule(id, fields) {
  const filePath = resolveRulePath(id);
  await readFile(filePath, 'utf8'); // throws if it doesn't exist yet
  validateFields(fields);
  const xml = buildRuleXml(fields);
  await writeFile(filePath, xml, 'utf8');
  return getRule(id);
}

async function deleteRule(id) {
  const filePath = resolveRulePath(id);
  await rm(filePath);
}

export { listRules, getRule, createRule, updateRule, deleteRule };
