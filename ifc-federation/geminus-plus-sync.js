/**
 * geminus-plus-sync.js
 *
 * Phase 8 (not yet in the plan doc) — pushing corrected IFC models back to
 * Geminus Plus, matched against an existing BIM object rather than creating
 * a duplicate.
 *
 * The upload flow below is reverse-engineered from a REAL browser network
 * capture (2026-09-07) of Geminus Plus's own "upload a new file to a model"
 * action against a "New"-status BIM object -- not from the AssetDB OpenAPI
 * spec's documented shape, which turned out to describe a different (or
 * unavailable in this environment) flow: CreateRevision returned a bare 404
 * against real staging, so the actually-observed sequence below is what
 * this code follows instead:
 *
 *   1. POST /IfcFiles/CreateDirectory  { path: "<dirId>/<subDirId>" }
 *   2. POST /IfcFiles/CreateFile       multipart/form-data: path=<same path>, file=<bytes>
 *   3. PUT  /EditObject?hasFileUpload=true   { bimObjectId, objectType: 5, name }  (root path, NOT /IfcFiles; PUT, not POST -- both confirmed via a real Request Method + Request URL check after a first guess 404'd)
 *   4. POST /ValidateFile     { RevisionId, ModelId, FileId, FileName, FilePath, ImportType: 0 }  (root path, not /IfcFiles)
 *
 * Key discovery: `ModelId` in the ValidateFile payload is the SAME value as
 * the BimObject's own `bimObjectId` -- there is no separate "create a
 * model" or "create a revision" step to call first. `RevisionId` and
 * `FileId` are fresh, client-generated GUIDs (confirmed: neither matched
 * any id returned by a prior response in the capture). `objectType: 5` is
 * the BIM-model object type (not in this app's existing OBJECT_TYPE enum
 * in geminus-plus-lookup.js, which only covers Complex/Building/Storey/
 * Space/Instance).
 *
 * `path`'s two GUID segments were not fully explained by the capture alone
 * (both observed CreateDirectory calls used the identical path, which may
 * just be the real UI firing the request twice) -- generating two fresh
 * GUIDs per upload and joining them is the simplest reproduction of what
 * was observed, and is what this module does.
 *
 * Auth reuses the exact same Keycloak service-account flow already proven
 * in geminus-plus-lookup.js (same realm, same grant_type=password).
 *
 * getRelatedModels (read-only) is safe and already verified against real
 * staging data. pushIfcModel (the write flow above) has NOT been executed
 * yet -- it should be confirmed with the user before the first real call,
 * the same way any other hard-to-reverse action would be.
 */

import { randomUUID } from 'node:crypto';

const KEYCLOAK_URL = process.env.GEMINUS_PLUS_KEYCLOAK_URL;
const CLIENT_ID = process.env.GEMINUS_PLUS_CLIENT_ID;
const CLIENT_SECRET = process.env.GEMINUS_PLUS_CLIENT_SECRET;
const USERNAME = process.env.GEMINUS_PLUS_USERNAME;
const PASSWORD = process.env.GEMINUS_PLUS_PASSWORD;
const API_URL = process.env.GEMINUS_PLUS_API_URL;

const BIM_OBJECT_TYPE_MODEL = 5;

function assertConfigured() {
  const missing = Object.entries({
    GEMINUS_PLUS_KEYCLOAK_URL: KEYCLOAK_URL,
    GEMINUS_PLUS_CLIENT_ID: CLIENT_ID,
    GEMINUS_PLUS_USERNAME: USERNAME,
    GEMINUS_PLUS_PASSWORD: PASSWORD,
    GEMINUS_PLUS_API_URL: API_URL,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);
}

// Same token cache pattern as geminus-plus-lookup.js -- kept as a separate
// module-local cache rather than importing that module's, so this file has
// no dependency on lookup internals and can be tested standalone.
let _token = null;
let _tokenExpiresAt = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiresAt - 30_000) return _token;

  const body = new URLSearchParams({
    grant_type: 'password',
    username: USERNAME,
    password: PASSWORD,
    client_id: CLIENT_ID,
  });
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET);

  const res = await fetch(KEYCLOAK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Keycloak: ${res.status} ${await res.text()}`);
  const json = await res.json();
  _token = json.access_token;
  _tokenExpiresAt = Date.now() + (json.expires_in ?? 300) * 1000;
  return _token;
}

async function apiGet(path, params = {}) {
  assertConfigured();
  const token = await getToken();
  const url = new URL(`${API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Geminus Plus API ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPostJson(path, body, method = 'POST') {
  assertConfigured();
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Geminus Plus API ${path}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * List existing BIM models related to a building, so a corrected IFC model
 * can be matched against one instead of silently creating a duplicate.
 * @param {string} buildingFmguid
 * @returns {Promise<Array<{ modelId: string, name: string, disciplineId: string, revisionId: string, bimObjectId: string, status: number }>>}
 */
async function getRelatedModels(buildingFmguid) {
  const models = await apiGet('/GetAllRelatedModels', { fmguid: buildingFmguid });
  return (models ?? []).map(m => ({
    modelId: m.modelId,
    name: m.name,
    disciplineId: m.disciplineId,
    revisionId: m.revisionId,
    bimObjectId: m.bimObjectId,
    status: m.status,
  }));
}

/**
 * Upload IFC text as a new file for an existing BIM object, following the
 * exact call sequence captured from Geminus Plus's own UI (see file
 * comment). Works whether the BIM object already has revisions or is
 * still in "New" status (its bimObjectId doubles as ModelId either way).
 *
 * @param {{ bimObjectId: string, name: string, fileName: string, ifcText: string }} params
 * @returns {Promise<{ revisionId: string, fileId: string, filePath: string }>}
 */
async function pushIfcModel({ bimObjectId, name, fileName, ifcText }) {
  const dirId = randomUUID();
  const subDirId = randomUUID();
  const filePath = `${dirId}/${subDirId}`;

  // CreateDirectory/CreateFile/ValidateFile live under an /IfcFiles sub-route
  // -- confirmed via a real browser network capture's Request URL
  // (.../api/v1/AssetDB/IfcFiles/CreateDirectory), NOT at the AssetDB root
  // like GetAllRelatedModels/EditObject. A bare /CreateDirectory 404'd even
  // on GET, which is what gave this away. EditObject's own Request URL was
  // not separately confirmed -- kept at root since it's a generic BimObject
  // mutation, not IFC-file-specific; revisit if it also 404s.
  await apiPostJson('/IfcFiles/CreateDirectory', { path: filePath });

  assertConfigured();
  const token = await getToken();
  const form = new FormData();
  form.append('path', filePath);
  form.append('file', new Blob([ifcText], { type: 'application/octet-stream' }), fileName);
  const createFileRes = await fetch(`${API_URL}/IfcFiles/CreateFile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // no Content-Type -- fetch sets the multipart boundary itself
    body: form,
  });
  if (!createFileRes.ok) throw new Error(`Geminus Plus API /IfcFiles/CreateFile: ${createFileRes.status} ${await createFileRes.text()}`);

  // Confirmed via real browser capture: root path (not /IfcFiles), and PUT
  // -- not POST, which is what caused this to 404 on the first attempt.
  await apiPostJson('/EditObject?hasFileUpload=true', { bimObjectId, objectType: BIM_OBJECT_TYPE_MODEL, name }, 'PUT');

  const fileId = randomUUID();
  const revisionId = randomUUID();
  // Confirmed via real browser capture: root path (not /IfcFiles), POST.
  await apiPostJson('/ValidateFile', {
    RevisionId: revisionId,
    ModelId: bimObjectId,
    FileId: fileId,
    FileName: fileName,
    FilePath: filePath,
    ImportType: 0,
  });

  return { revisionId, fileId, filePath };
}

export { getRelatedModels, pushIfcModel };
