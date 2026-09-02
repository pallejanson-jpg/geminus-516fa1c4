/**
 * geminus-plus-sync.js
 *
 * Phase 8 (not yet in the plan doc) — pushing corrected IFC models back to
 * Geminus Plus, matched against existing BIM models rather than creating
 * duplicates. Endpoints and payload shapes come from the real AssetDB
 * OpenAPI spec + sync docs the user provided (2026-09-02) — not guessed,
 * not decompiled (the user offered decompiling the Revit add-in as a
 * fallback, but the docs covered everything needed).
 *
 * Auth reuses the exact same Keycloak service-account flow already proven
 * in geminus-plus-lookup.js (same realm, same grant_type=password) — no
 * separate login is needed for push vs. the read-only building lookup
 * already used elsewhere in this app. Whether the service account actually
 * has write permission in Geminus Plus has NOT been verified yet.
 *
 * Read-side functions (getRelatedModels) are safe and used by the Sync tab
 * to show which BIM model(s) already exist for a building, so the user can
 * pick a match instead of this pipeline silently creating a duplicate.
 *
 * Write-side functions (createRevision, processIfc) are implemented per
 * the documented API shape but have NOT been exercised against the real
 * staging environment yet -- creating a revision is a real, visible change
 * in Geminus Plus, so this should be confirmed with the user before the
 * first real call, the same way any other hard-to-reverse action would be.
 */

import { setTimeout as delay } from 'node:timers/promises';

const KEYCLOAK_URL = process.env.GEMINUS_PLUS_KEYCLOAK_URL;
const CLIENT_ID = process.env.GEMINUS_PLUS_CLIENT_ID;
const CLIENT_SECRET = process.env.GEMINUS_PLUS_CLIENT_SECRET;
const USERNAME = process.env.GEMINUS_PLUS_USERNAME;
const PASSWORD = process.env.GEMINUS_PLUS_PASSWORD;
const API_URL = process.env.GEMINUS_PLUS_API_URL;

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

async function apiPost(path, body) {
  assertConfigured();
  const token = await getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Geminus Plus API ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * List existing BIM models related to a building, so a corrected IFC model
 * can be matched against one instead of silently creating a duplicate.
 * @param {string} buildingFmguid
 * @returns {Promise<Array<{ modelId: string, name: string, disciplineId: string, revisionId: string, bimObjectId: string }>>}
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

/** Create a new revision on top of an existing one, ready to receive an uploaded IFC. */
async function createRevision(parentRevisionId, status = 0) {
  return apiPost('/CreateRevision', { parentRevisionId, status });
}

/** Get a SAS-token URL for uploading the IFC file directly to blob storage. */
async function getSasToken() {
  const json = await apiGet('/SasToken');
  return json.sasToken;
}

/** Upload IFC text to blob storage using the SAS URL, under the given file name. */
async function uploadIfcToBlob(sasToken, fileName, ifcText) {
  // sasToken is "<container-url>?<sas-query>" -- the file goes at <container-url>/<fileName>?<sas-query>.
  const [base, query] = sasToken.split('?');
  const blobUrl = `${base.replace(/\/$/, '')}/${encodeURIComponent(fileName)}?${query}`;
  const res = await fetch(blobUrl, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/octet-stream' },
    body: ifcText,
  });
  if (!res.ok) throw new Error(`Blob upload failed: ${res.status} ${await res.text()}`);
  return blobUrl;
}

/** Trigger server-side processing of an uploaded IFC file against a model+revision. */
async function processIfc({ fileName, fileId, filePath, modelId, tenantName, revisionId }) {
  return apiPost('/ProcessIfc', { fileName, fileId, filePath, modelId, tenantName, revisionId });
}

/** Poll file processing status (completePercentage, numberOfObjectsProcessed) until done or timeout. */
async function pollFileStatus(fileId, { intervalMs = 2000, timeoutMs = 300_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = await apiGet('/Files', { active: true });
    const file = (files ?? []).find(f => f.fileId === fileId);
    if (file && file.completePercentage >= 100) return file;
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for file ${fileId} to finish processing.`);
}

export { getRelatedModels, createRevision, getSasToken, uploadIfcToBlob, processIfc, pollFileStatus };
