#!/usr/bin/env node
/**
 * Faciliate ↔ Geminus connector.
 *
 * Runs on a machine INSIDE the SWG VPN (where the Faciliate RestAPI server is
 * reachable) and bridges it to the Geminus Supabase project:
 *
 *   test            – verify connectivity + list available objects (metainfo/swagger)
 *   sync [types...] – pull records and upsert into public.faciliate_records
 *   create-workorder <json|@file.json> – POST a work order into Faciliate
 *
 * Config comes from .env (see .env.example). The REST API spec is documented in
 * the project memory file faciliate-rest-api.md.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── minimal .env loader (no deps) ──
function loadEnv() {
  try {
    const txt = readFileSync(join(__dirname, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch { /* no .env, rely on real env */ }
}
loadEnv();

// Internal Faciliate hosts often use a self-signed TLS cert. Opt-in bypass.
if (process.env.FACILIATE_INSECURE_TLS === '1') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CFG = {
  baseUrl: (process.env.FACILIATE_BASE_URL || '').replace(/\/+$/, ''),
  username: process.env.FACILIATE_USERNAME || '',
  password: process.env.FACILIATE_PASSWORD || '',
  accessToken: process.env.FACILIATE_ACCESS_TOKEN || '',
  syncObjects: (process.env.FACILIATE_SYNC_OBJECTS || 'building,workorder,RentContract,PreventiveRoutine').split(',').map(s => s.trim()).filter(Boolean),
  pageSize: Number(process.env.FACILIATE_PAGE_SIZE || 200),
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
};

function requireCfg(keys) {
  const missing = keys.filter(k => !CFG[k]);
  if (missing.length) {
    console.error(`Missing config: ${missing.map(k => k.replace(/([A-Z])/g, '_$1').toUpperCase()).join(', ')}. See .env.example`);
    process.exit(1);
  }
}

// ── Faciliate auth ──
let cachedToken = CFG.accessToken || null;

async function login() {
  if (cachedToken) return cachedToken;
  requireCfg(['username', 'password']);
  const res = await fetch(`${CFG.baseUrl}/api/v2/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: CFG.username, password: CFG.password }),
  });
  if (!res.ok) throw new Error(`Faciliate login failed: ${res.status} ${await res.text().catch(() => '')}`);
  const data = await res.json().catch(() => ({}));
  const token = data.token || data.jwt || data.accessToken;
  if (!token) throw new Error(`Login response had no token: ${JSON.stringify(data).slice(0, 200)}`);
  cachedToken = token;
  return token;
}

/** Auth headers. Verified against JernhusenDemo: the v2 login JWT goes in
 * `Authorization: Bearer <token>`. A pre-configured Landlord token (if used
 * instead) goes in the `access_token` header. */
async function authHeaders() {
  if (CFG.accessToken) return { access_token: CFG.accessToken };
  const token = await login();
  return { Authorization: `Bearer ${token}` };
}

async function apiFetch(method, path, { body, query } = {}) {
  requireCfg(['baseUrl']);
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const headers = { Accept: 'application/json', ...(await authHeaders()) };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${CFG.baseUrl}${path}${qs}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${String(text).slice(0, 300)}`);
  return data;
}

// Object types that need fullprimary loadlevel to get nested building/room/floor data.
const FULLPRIMARY_TYPES = new Set(['workorder', 'Workorder', 'RentContract', 'PreventiveOccasionHead']);

/** Fetch all records of an object type, paging through with take/skip. Optional filter (e.g. `BuildingID eq "S1"`). */
async function fetchAll(objectType, filter) {
  const all = [];
  let skip = 0;
  const loadlevel = FULLPRIMARY_TYPES.has(objectType) ? 'fullprimary' : 'simple';
  for (;;) {
    const query = { take: String(CFG.pageSize), skip: String(skip), loadlevel };
    if (filter) query.filter = filter;
    const data = await apiFetch('GET', `/api/v2/${objectType}`, { query });
    const items = Array.isArray(data) ? data : (data?.data || data?.items || []);
    if (!items.length) break;
    all.push(...items);
    if (items.length < CFG.pageSize) break;
    skip += CFG.pageSize;
    if (skip > 50000) { console.warn(`  (stopping at ${skip}, safety cap)`); break; }
  }
  return all;
}

// ── field extraction (defensive — verified against JernhusenDemo workorder schema) ──
const pick = (o, ...keys) => { for (const k of keys) { if (o?.[k] != null && o[k] !== '') return o[k]; } return null; };
const nestedVal = (o, k, ...props) => {
  const v = o?.[k];
  if (v && typeof v === 'object') { for (const p of props) if (v[p] != null && v[p] !== '') return v[p]; return null; }
  return v ?? null;
};

/** Normalise a CadKey value to a lowercase UUID string or null. */
function parseCadKey(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null;
}

function toRow(objectType, r) {
  // For building objects, ID and Title are at the top level.
  // For workorders, building info is in the nested Building object (fullprimary loadlevel).
  const buildingObj = r.Building && typeof r.Building === 'object' ? r.Building : null;
  const floorObj    = r.Floor    && typeof r.Floor    === 'object' ? r.Floor    : null;
  const roomObj     = r.Room     && typeof r.Room     === 'object' ? r.Room     : null;

  return {
    object_type: objectType,
    source_guid: String(pick(r, 'guid', 'Guid', 'GUID', 'id', 'ID') ?? cryptoRandom()),
    title: pick(r, 'title', 'Title', 'WorkorderDescriptionPlain', 'Description', 'name', 'Name'),
    // Prefer the human-readable status title over numeric codes.
    status: pick(r, 'WorkorderStatusTitle', 'StatusTitle', 'status', 'Status', 'WorkorderStatus') != null
      ? String(pick(r, 'WorkorderStatusTitle', 'StatusTitle', 'status', 'Status', 'WorkorderStatus')) : null,
    // Building info: from nested Building object (workorders) or top-level ID (building records).
    building_id:   buildingObj ? String(pick(buildingObj, 'ID', 'Id', 'id') ?? '') || null
                               : String(pick(r, 'ID', 'BuildingID') ?? '') || null,
    building_name: buildingObj ? pick(buildingObj, 'Title', 'Name') : pick(r, 'Title', 'Name'),
    // BIM cross-reference CadKeys — from nested objects (workorders) or top-level (building records).
    building_cad_key: parseCadKey(buildingObj?.CadKey ?? pick(r, 'BuildingCadKey', 'CadKey')),
    floor_cad_key:    parseCadKey(floorObj?.CadKey    ?? pick(r, 'FloorCadKey')),
    room_cad_key:     parseCadKey(roomObj?.CadKey     ?? pick(r, 'RoomCadKey')),
    raw: r,
  };
}
function cryptoRandom() { return 'gen-' + Math.random().toString(36).slice(2); }

// ── Supabase upsert ──
async function upsert(rows) {
  requireCfg(['supabaseUrl', 'serviceRoleKey']);
  const url = `${CFG.supabaseUrl}/rest/v1/faciliate_records?on_conflict=object_type,source_guid`;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map(r => ({ ...r, synced_at: new Date().toISOString() }));
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: CFG.serviceRoleKey,
        Authorization: `Bearer ${CFG.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}

// ── commands ──
async function cmdTest() {
  console.log(`Faciliate base URL: ${CFG.baseUrl || '(not set)'}`);
  requireCfg(['baseUrl']);
  try {
    const meta = await apiFetch('GET', '/api/v1/system/action/metainfo');
    console.log('✅ Reachable. Available objects (metainfo):');
    console.log(typeof meta === 'string' ? meta.slice(0, 2000) : JSON.stringify(meta, null, 2).slice(0, 2000));
  } catch (e) {
    console.error('❌ metainfo failed:', e.message);
    console.log('Trying a workorder probe instead…');
    const wo = await apiFetch('GET', '/api/v2/workorder', { query: { take: '1', loadlevel: 'guid' } });
    console.log('workorder probe ok:', JSON.stringify(wo).slice(0, 500));
  }
}

async function cmdSync(types) {
  const objects = types.length ? types : CFG.syncObjects;
  console.log(`Syncing: ${objects.join(', ')}`);
  for (const obj of objects) {
    process.stdout.write(`  ${obj}… `);
    try {
      const items = await fetchAll(obj);
      if (items.length) await upsert(items.map(r => toRow(obj, r)));
      console.log(`${items.length} records ✅`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }
  console.log('Done.');
}

/** Sync records for ONE building, stamping building id+name (the list response omits building). */
async function cmdSyncBuilding(buildingId, buildingName, types) {
  if (!buildingId || !buildingName) {
    console.error('Usage: sync-building <BuildingID> "<Building name>" [objecttypes...]');
    process.exit(1);
  }
  const objects = types.length ? types : ['workorder'];
  console.log(`Syncing building ${buildingId} (${buildingName}): ${objects.join(', ')}`);
  for (const obj of objects) {
    process.stdout.write(`  ${obj}… `);
    try {
      const items = await fetchAll(obj, `BuildingID eq "${buildingId}"`);
      const rows = items.map(r => {
        const row = toRow(obj, r);
        row.building_id = buildingId;          // stamp from filter context (list omits building)
        row.building_name = buildingName;
        return row;
      });
      if (rows.length) await upsert(rows);
      console.log(`${rows.length} records ✅`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }
  console.log('Done.');
}

async function cmdCreateWorkorder(arg) {
  if (!arg) { console.error('Usage: create-workorder <json|@file.json>'); process.exit(1); }
  const json = arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg;
  const payload = JSON.parse(json);
  const result = await apiFetch('POST', '/api/v2/workorder', { body: payload });
  console.log('Created:', JSON.stringify(result, null, 2).slice(0, 1000));
}

// ── HTTP server mode ──

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res, status, data) {
  res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

async function cmdServe() {
  const { createServer } = await import('node:http');
  const PORT = Number(process.env.CONNECTOR_PORT || 3001);

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS_HEADERS); res.end(); return; }
    const path = new URL(req.url, 'http://localhost').pathname;

    try {
      // GET /status — health check
      if (req.method === 'GET' && path === '/status') {
        sendJson(res, 200, { ok: true, baseUrl: CFG.baseUrl || null });
        return;
      }

      // GET /buildings — fetch building list from Faciliate
      if (req.method === 'GET' && path === '/buildings') {
        requireCfg(['baseUrl']);
        const items = await fetchAll('building');
        const buildings = items.map(b => ({
          id:     String(pick(b, 'ID', 'Id', 'id', 'BuildingID') ?? ''),
          name:   pick(b, 'Title', 'title', 'Name', 'name') ?? '',
          cadKey: pick(b, 'CadKey', 'cadKey', 'BuildingCadKey') ?? null,
        })).filter(b => b.id);
        sendJson(res, 200, { buildings });
        return;
      }

      // POST /sync-building — stream progress via SSE
      if (req.method === 'POST' && path === '/sync-building') {
        requireCfg(['baseUrl', 'supabaseUrl', 'serviceRoleKey']);
        const body = await readBody(req);
        const { buildingId, buildingName, types } = body;
        if (!buildingId || !buildingName) { sendJson(res, 400, { error: 'buildingId and buildingName required' }); return; }
        const objects = Array.isArray(types) && types.length ? types : ['workorder', 'rentlandlord', 'maintenance'];

        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const emit = (type, payload) => res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);

        try {
          for (const obj of objects) {
            emit('progress', { message: `Hämtar ${obj}…` });
            const items = await fetchAll(obj, `BuildingID eq "${buildingId}"`);
            const rows = items.map(r => { const row = toRow(obj, r); row.building_id = buildingId; row.building_name = buildingName; return row; });
            if (rows.length) {
              emit('progress', { message: `Sparar ${rows.length} ${obj} i Geminus…` });
              await upsert(rows);
            }
            emit('progress', { message: `${obj}: ${rows.length} poster ✅` });
          }
          emit('done', { message: `Synk klar för ${buildingName}!` });
        } catch (e) {
          emit('error', { message: e.message });
        }
        res.end();
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      try { sendJson(res, 500, { error: e.message }); } catch { /* response already started */ }
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`✅ Faciliate connector server: http://localhost:${PORT}`);
    console.log('   GET  /status          — health check');
    console.log('   GET  /buildings        — list buildings from Faciliate');
    console.log('   POST /sync-building    — { buildingId, buildingName, types[] } → SSE progress');
    console.log('\nTryck Ctrl+C för att stänga.\n');
  });

  // Keep process alive
  process.on('SIGINT', () => { console.log('\nServer stoppad.'); process.exit(0); });
  await new Promise(() => {}); // never resolves
}

const [cmd, ...args] = process.argv.slice(2);
const run = {
  test: () => cmdTest(),
  sync: () => cmdSync(args),
  'sync-building': () => cmdSyncBuilding(args[0], args[1], args.slice(2)),
  'create-workorder': () => cmdCreateWorkorder(args[0]),
  serve: () => cmdServe(),
}[cmd];

if (!run) {
  console.log('Usage: node connector.mjs <test|sync [types...]|sync-building <BuildingID> "<name>" [types...]|create-workorder <json|@file>|serve>');
  process.exit(1);
}
run().catch(e => { console.error('Error:', e.message); process.exit(1); });
