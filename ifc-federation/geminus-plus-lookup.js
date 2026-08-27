/**
 * geminus-plus-lookup.js
 *
 * Phase 1 of the IFC federation pipeline (docs/plans/ifc-federation-plan.md).
 *
 * Given a building identifier, determine whether the building already exists
 * in Geminus Plus, and if so, return its canonical storey list (names + FMGUIDs).
 * This is the "is Geminus Plus the source of truth, or do we fall back to the
 * architect model?" check described in the plan's authority-hierarchy rule.
 *
 * Reuses the same Keycloak auth + PublishDataServiceGetMerged call already used
 * by sync-service.js (Asset+ sync) and supabase/functions/geminus-plus-sync/index.ts
 * (GEMINUS_PLUS_* env vars, same API — Geminus Plus and Asset+ are the same backend).
 *
 * No 60-second edge-function limit here; this is a plain Node module, meant to
 * be imported by the rest of the ifc-federation pipeline (or run standalone for
 * a quick manual lookup, see `main()` below).
 */

const KEYCLOAK_URL = process.env.GEMINUS_PLUS_KEYCLOAK_URL;
const CLIENT_ID     = process.env.GEMINUS_PLUS_CLIENT_ID;
const USERNAME      = process.env.GEMINUS_PLUS_USERNAME;
const PASSWORD      = process.env.GEMINUS_PLUS_PASSWORD;
const API_URL       = process.env.GEMINUS_PLUS_API_URL;
const API_KEY       = process.env.GEMINUS_PLUS_API_KEY;

// objectType codes, same mapping as sync-service.js / geminus-plus-sync/index.ts
const OBJECT_TYPE = { COMPLEX: 0, BUILDING: 1, BUILDING_STOREY: 2, SPACE: 3, INSTANCE: 4 };

function assertConfigured() {
  const missing = Object.entries({
    GEMINUS_PLUS_KEYCLOAK_URL: KEYCLOAK_URL,
    GEMINUS_PLUS_CLIENT_ID: CLIENT_ID,
    GEMINUS_PLUS_USERNAME: USERNAME,
    GEMINUS_PLUS_PASSWORD: PASSWORD,
    GEMINUS_PLUS_API_URL: API_URL,
    GEMINUS_PLUS_API_KEY: API_KEY,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }
}

// ── Keycloak auth (auto-refresh, same pattern as sync-service.js) ───────────
let _token = null;
let _tokenExpiresAt = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiresAt - 30_000) return _token;

  const res = await fetch(KEYCLOAK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: CLIENT_ID,
      username: USERNAME,
      password: PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak: ${res.status} ${await res.text()}`);
  const json = await res.json();
  _token = json.access_token;
  _tokenExpiresAt = Date.now() + (json.expires_in ?? 300) * 1000;
  return _token;
}

async function queryGeminusPlus(filter, { skip = 0, take = 200, requireTotalCount = false } = {}) {
  const token = await getToken();
  const res = await fetch(`${API_URL}/PublishDataServiceGetMerged`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      filter,
      skip,
      take,
      requireTotalCount,
      outputType: 'raw',
      apiKey: API_KEY,
      sort: [{ selector: 'fmGuid', desc: false }],
    }),
  });
  if (!res.ok) throw new Error(`Geminus Plus API: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data ?? [];
}

/**
 * Look up a building in Geminus Plus by its FMGUID or designation.
 * Returns null if not found — the caller should treat that as "fall back to
 * the architect model as template" (Phase 2 of the plan).
 */
async function getBuildingByIdentifier(identifier) {
  assertConfigured();

  const byGuid = await queryGeminusPlus([
    ['objectType', '=', OBJECT_TYPE.BUILDING],
    'and',
    ['fmGuid', '=', identifier],
  ], { take: 1 });
  if (byGuid.length > 0) return mapBuilding(byGuid[0]);

  const byName = await queryGeminusPlus([
    ['objectType', '=', OBJECT_TYPE.BUILDING],
    'and',
    ['designation', '=', identifier],
  ], { take: 1 });
  if (byName.length > 0) return mapBuilding(byName[0]);

  return null;
}

function mapBuilding(item) {
  return {
    fmguid: item.fmGuid,
    // `designation` is frequently null on Building objects (confirmed against
    // live data); `commonName` is the reliably populated display name.
    name: item.commonName ?? item.designation ?? null,
  };
}

/**
 * Geminus Plus stores some per-object properties (e.g. "Elevation") under a
 * dynamically hashed key rather than a fixed field name — confirmed against a
 * live IfcBuildingStorey record, e.g. `elevationA514DA1094CE1BD6...` holding
 * `{ name: "Elevation", value: 0 }`. Find such a property by its `.name`.
 */
function findNamedProperty(item, propertyName) {
  for (const value of Object.values(item)) {
    if (value && typeof value === 'object' && value.name === propertyName) {
      return value.value;
    }
  }
  return undefined;
}

/**
 * Given a building's FMGUID, return its canonical storey list.
 * Shape matches what Phase 2 (architect-model fallback) must also produce,
 * so downstream matrix/reconciliation logic doesn't care which source it came from:
 *   [{ fmguid, name, sequence }]
 */
async function getStoreysForBuilding(buildingFmGuid) {
  assertConfigured();

  const storeys = [];
  let skip = 0;
  const take = 200;

  while (true) {
    const page = await queryGeminusPlus([
      ['objectType', '=', OBJECT_TYPE.BUILDING_STOREY],
      'and',
      ['buildingFmGuid', '=', buildingFmGuid],
    ], { skip, take });

    if (page.length === 0) break;
    storeys.push(...page.map(mapStorey));
    skip += page.length;
    if (page.length < take) break;
  }

  // Best-effort only: `sequence` is frequently null (see mapStorey). Push
  // unranked storeys to the end instead of letting `null - null` corrupt the
  // sort; this is purely a starting display order, never a matching signal.
  storeys.sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));
  return storeys;
}

function mapStorey(item) {
  return {
    fmguid: item.fmGuid,
    name: item.levelName ?? item.commonName ?? item.designation ?? null,
    // Confirmed against two live buildings: an "Elevation" property (hashed
    // key, see findNamedProperty) exists on some storeys but not others —
    // it is model-dependent, not a guaranteed field. `levelNumber` is NOT a
    // numeric sequence either; it duplicates the text name. There is no
    // reliable ordering field, which matches the plan's own rule (storeys
    // must never be auto-matched by elevation/geometry — human confirmation
    // only). `sequence` is therefore best-effort and may be `null`; callers
    // (the reconciliation matrix) must not depend on it for identity or
    // matching, only, optionally, for a starting display order.
    sequence: findNamedProperty(item, 'Elevation') ?? null,
  };
}

export { getBuildingByIdentifier, getStoreysForBuilding };

// ── Manual CLI check: node ifc-federation/geminus-plus-lookup.js <buildingIdentifier> ──
import { pathToFileURL } from 'node:url';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error('Usage: node ifc-federation/geminus-plus-lookup.js <buildingFmGuidOrName>');
    process.exit(1);
  }

  (async () => {
    const building = await getBuildingByIdentifier(identifier);
    if (!building) {
      console.log(`Not found in Geminus Plus: "${identifier}" — fall back to architect-model template (Phase 2).`);
      return;
    }
    console.log(`Building: ${building.name} (${building.fmguid})`);
    const storeys = await getStoreysForBuilding(building.fmguid);
    console.log(`Storeys (${storeys.length}):`);
    for (const s of storeys) console.log(`  ${s.fmguid}  ${s.name}`);
  })().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
