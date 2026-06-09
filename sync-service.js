/**
 * sync-service.js
 *
 * Lokal Node.js synk-service: Asset+ → Supabase
 * Kör direkt utan Edge Functions — ingen 60-sekunders tidsgräns.
 *
 * Kör med: node --env-file=.env sync-service.js [--structure] [--assets] [--all]
 *
 * Exempel:
 *   node --env-file=.env sync-service.js --all        (allt)
 *   node --env-file=.env sync-service.js --structure  (byggnader, plan, rum)
 *   node --env-file=.env sync-service.js --assets     (instanser/tillgångar)
 */

import { createClient } from '@supabase/supabase-js';

// ── Konfiguration ─────────────────────────────────────────────────────────────
const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY     = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const API_URL          = process.env.ASSET_PLUS_API_URL;
const KEYCLOAK_URL     = process.env.ASSET_PLUS_KEYCLOAK_URL;
const API_KEY          = process.env.ASSET_PLUS_API_KEY;
const CLIENT_ID        = process.env.ASSET_PLUS_CLIENT_ID;
const USERNAME         = process.env.ASSET_PLUS_USERNAME;
const PASSWORD         = process.env.ASSET_PLUS_PASSWORD;

const PAGE_SIZE    = 200; // Antal objekt per API-anrop
const UPSERT_CHUNK = 50;  // Antal rader per Supabase-upsert (lägre = färre timeouts)
const UPSERT_DELAY = 80;  // ms paus mellan upsert-batchar

// ObjectType → kategorinamn (samma som Edge Function)
const CATEGORY = { 0: 'Complex', 1: 'Building', 2: 'Building Storey', 3: 'Space', 4: 'Instance' };

// ── Keycloak auth (med auto-refresh) ─────────────────────────────────────────
let _token = null;
let _tokenExpiresAt = 0;

async function getToken() {
  // Förnya token 30 sekunder innan det går ut
  if (_token && Date.now() < _tokenExpiresAt - 30_000) return _token;

  const res = await fetch(KEYCLOAK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id:  CLIENT_ID,
      username:   USERNAME,
      password:   PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak: ${res.status} ${await res.text()}`);
  const json = await res.json();
  _token = json.access_token;
  _tokenExpiresAt = Date.now() + (json.expires_in ?? 300) * 1000;
  return _token;
}

// ── Asset+ API ────────────────────────────────────────────────────────────────
async function fetchPage(filter, skip, take = PAGE_SIZE) {
  const token = await getToken();
  const res = await fetch(`${API_URL}/PublishDataServiceGetMerged`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      filter,
      skip,
      take,
      requireTotalCount: false,
      outputType: 'raw',
      apiKey: API_KEY,
      sort: [{ selector: 'fmGuid', desc: false }],
    }),
  });
  if (!res.ok) throw new Error(`Asset+ API: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.data ?? [];
}

// ── Supabase upsert ───────────────────────────────────────────────────────────
function mapToRow(item) {
  return {
    fm_guid:            item.fmGuid,
    category:           CATEGORY[item.objectType] ?? 'Unknown',
    name:               item.designation        ?? null,
    common_name:        item.commonName         ?? null,
    building_fm_guid:   item.buildingFmGuid     ?? null,
    level_fm_guid:      item.levelFmGuid        ?? null,
    in_room_fm_guid:    item.inRoomFmGuid       ?? null,
    complex_common_name:item.complexCommonName  ?? null,
    gross_area:         item.grossArea          ?? null,
    asset_type:         item.objectTypeValue    ?? null,
    created_in_model:   item.createdInModel     ?? true,
    source_updated_at:  item.dateModified       ?? null,
    attributes:         item,
    synced_at:          new Date().toISOString(),
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function upsertToSupabase(supabase, items) {
  const rows = items.map(mapToRow);
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    let attempt = 0;
    while (true) {
      const { error } = await supabase
        .from('assets')
        .upsert(chunk, { onConflict: 'fm_guid' });
      if (!error) break;
      if (attempt < 3 && error.message.includes('timeout')) {
        attempt++;
        await sleep(500 * attempt); // vänta längre för varje retry
        continue;
      }
      throw new Error(`Supabase upsert: ${error.message}`);
    }
    if (UPSERT_DELAY > 0) await sleep(UPSERT_DELAY);
  }
}

// ── Synk-status ───────────────────────────────────────────────────────────────
async function setSyncState(supabase, id, namn, status, count) {
  await supabase.from('asset_sync_state').upsert({
    subtree_id:   id,
    subtree_name: namn,
    sync_status:  status,
    total_assets: count,
    ...(status === 'running'    && { last_sync_started_at:   new Date().toISOString() }),
    ...(status === 'completed'  && { last_sync_completed_at: new Date().toISOString() }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'subtree_id' });
}

// ── Huvud-synk-loop ───────────────────────────────────────────────────────────
async function syncTypes(supabase, { typer, label, syncId }) {
  const filter = typer.flatMap((t, i) => i === 0
    ? [['objectType', '=', t]]
    : ['or', ['objectType', '=', t]]
  );

  await setSyncState(supabase, syncId, label, 'running', 0);

  let skip = 0;
  let total = 0;
  const start = Date.now();

  process.stdout.write(`  ${label.padEnd(28)}`);

  while (true) {
    const page = await fetchPage(filter, skip);
    if (page.length === 0) break;

    await upsertToSupabase(supabase, page);
    total += page.length;
    skip  += page.length;

    // Visa progress
    process.stdout.write(`\r  ${label.padEnd(28)} ${total.toLocaleString('sv-SE').padStart(8)} st  ...`);

    if (page.length < PAGE_SIZE) break;
  }

  const sek = ((Date.now() - start) / 1000).toFixed(1);
  process.stdout.write(`\r  ${label.padEnd(28)} ${total.toLocaleString('sv-SE').padStart(8)} st  ✅  (${sek}s)\n`);

  await setSyncState(supabase, syncId, label, 'completed', total);
  return total;
}

// ── Jämför lokal vs remote ────────────────────────────────────────────────────
async function showDelta(supabase) {
  console.log('\n📊 Jämförelse: Asset+ vs Supabase');
  console.log('─'.repeat(60));

  const typer = [
    { id: 1, namn: 'Building',       filter: [['objectType','=',1]] },
    { id: 2, namn: 'Building Storey',filter: [['objectType','=',2]] },
    { id: 3, namn: 'Space',          filter: [['objectType','=',3]] },
    { id: 4, namn: 'Instance',       filter: [['objectType','=',4]] },
  ];

  for (const t of typer) {
    const token = await getToken();
    // Remote count
    const remoteRes = await fetch(`${API_URL}/PublishDataServiceGetMerged`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ filter: t.filter, skip: 0, take: 1,
        requireTotalCount: true, outputType: 'raw', apiKey: API_KEY }),
    });
    const remote = (await remoteRes.json()).totalCount ?? 0;

    // Local count
    const { count: local } = await supabase
      .from('assets').select('*', { count: 'exact', head: true }).eq('category', t.namn);

    const diff = remote - (local ?? 0);
    const ikon = diff === 0 ? '✅' : diff > 0 ? '⬆️ ' : '⬇️ ';
    console.log(`  ${ikon} ${t.namn.padEnd(18)} Asset+: ${String(remote).padStart(7)}  Supabase: ${String(local ?? 0).padStart(7)}  diff: ${diff > 0 ? '+' : ''}${diff}`);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const runAll       = args.includes('--all')       || args.length === 0;
  const runStructure = args.includes('--structure') || runAll;
  const runAssets    = args.includes('--assets')    || runAll;
  const onlyDelta    = args.includes('--delta');

  console.log('\n🚀  Geminus Lokal Synk-Service');
  console.log('─'.repeat(60));

  // Validera config
  for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_KEY, API_URL, KEYCLOAK_URL, API_KEY, CLIENT_ID, USERNAME, PASSWORD })) {
    if (!v) { console.error(`❌  Saknar: ${k} i .env`); process.exit(1); }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Token
  process.stdout.write('🔐 Keycloak token... ');
  const token = await getToken();
  console.log('✅\n');

  if (onlyDelta) {
    await showDelta(supabase);
    return;
  }

  const startTotal = Date.now();

  if (runStructure) {
    console.log('📐 Struktur (byggnader, våningsplan, rum)');
    console.log('─'.repeat(60));
    await syncTypes(supabase, {
      typer: [1, 2, 3],
      label: 'Byggnader / Plan / Rum',
      syncId: 'structure',
    });
  }

  if (runAssets) {
    console.log('\n📦 Tillgångar (instanser)');
    console.log('─'.repeat(60));
    await syncTypes(supabase, {
      typer: [4],
      label: 'Alla tillgångar',
      syncId: 'assets',
    });
  }

  const totSek = ((Date.now() - startTotal) / 1000).toFixed(1);
  console.log('\n─'.repeat(60));
  console.log(`✅  Synk klar! Total tid: ${totSek}s`);
  console.log('─'.repeat(60) + '\n');

  await showDelta(supabase);
}

main().catch(err => {
  console.error('\n💥  Fel:', err.message);
  process.exit(1);
});
