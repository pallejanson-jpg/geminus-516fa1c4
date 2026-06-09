/**
 * test-connection.js
 *
 * Testar kopplingen mellan lokal Node.js och Supabase.
 * Kör med: node --env-file=.env test-connection.js
 */

import { createClient } from '@supabase/supabase-js';

// ── 1. Läs in miljövariabler ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌  Kunde inte hitta VITE_SUPABASE_URL eller VITE_SUPABASE_PUBLISHABLE_KEY i .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Hjälpfunktion: snyggt loggformat ─────────────────────────────────────────
function header(text) {
  console.log('\n' + '─'.repeat(55));
  console.log('  ' + text);
  console.log('─'.repeat(55));
}

// ── 2. Testa databaskopplingen ────────────────────────────────────────────────
async function testDatabaseAccess() {
  header('📦  Databas — antal rader per kategori');

  const categories = ['Building', 'Building Storey', 'Space', 'Instance'];

  for (const category of categories) {
    const { count, error } = await supabase
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('category', category);

    if (error) {
      console.log(`  ${category.padEnd(20)} ❌  ${error.message}`);
    } else {
      console.log(`  ${category.padEnd(20)} ✅  ${(count ?? 0).toLocaleString('sv-SE')} st`);
    }
  }
}

// ── 3. Hämta de 5 första byggnaderna ─────────────────────────────────────────
async function testFetchBuildings() {
  header('🏢  De 5 första byggnaderna i databasen');

  const { data, error } = await supabase
    .from('assets')
    .select('fm_guid, name, common_name, building_fm_guid')
    .eq('category', 'Building')
    .order('name', { ascending: true })
    .limit(5);

  if (error) {
    console.log('  ❌  ' + error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('  ⚠️   Inga byggnader hittades — databasen kan vara tom.');
    return;
  }

  for (const b of data) {
    const namn = b.common_name || b.name || '(inget namn)';
    console.log(`  • ${namn.padEnd(30)} guid: ${b.fm_guid}`);
  }
}

// ── 4. Kolla synkstatus ───────────────────────────────────────────────────────
async function testSyncState() {
  header('🔄  Synkstatus (asset_sync_state)');

  const { data, error } = await supabase
    .from('asset_sync_state')
    .select('subtree_name, sync_status, total_assets, last_sync_completed_at')
    .order('subtree_name');

  if (error) {
    console.log('  ❌  ' + error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('  ⚠️   Ingen synkhistorik hittad.');
    return;
  }

  for (const row of data) {
    const status = row.sync_status === 'completed' ? '✅' :
                   row.sync_status === 'running'   ? '⏳' :
                   row.sync_status === 'interrupted' ? '⚠️ ' : '❓';
    const senast = row.last_sync_completed_at
      ? new Date(row.last_sync_completed_at).toLocaleString('sv-SE')
      : 'aldrig';
    console.log(`  ${status}  ${(row.subtree_name ?? '').padEnd(25)} ${(row.total_assets ?? 0).toLocaleString('sv-SE').padStart(8)} st   senast: ${senast}`);
  }
}

// ── 5. Anropa en Edge Function (check-delta) ─────────────────────────────────
async function testEdgeFunction() {
  header('⚡  Edge Function — check-delta');

  console.log('  Anropar asset-plus-sync med action: check-delta...');

  const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
    body: { action: 'check-delta' },
  });

  if (error) {
    console.log('  ❌  Edge Function-fel: ' + error.message);
    // Try to get more detail
    if (error.context) {
      try {
        const detail = await error.context.json?.() || error.context;
        console.log('  Detalj:', JSON.stringify(detail, null, 2));
      } catch {}
    }
    return;
  }

  if (data?.success) {
    console.log(`  ✅  Svar mottaget!`);
    console.log(`      Lokalt:   ${(data.localCount ?? 0).toLocaleString('sv-SE')} objekt`);
    console.log(`      Asset+:   ${(data.remoteCount ?? 0).toLocaleString('sv-SE')} objekt`);
    console.log(`      I synk:   ${data.inSync ? 'JA ✅' : 'NEJ ⚠️'}`);
    if (!data.inSync) {
      console.log(`      Diff:     ${(data.discrepancy ?? 0).toLocaleString('sv-SE')} objekt`);
    }
  } else {
    console.log('  ⚠️   Funktionen svarade men lyckades inte:');
    console.log('  ', JSON.stringify(data, null, 2));
  }
}

// ── 6. Kör allt ───────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀  Geminus — Node.js kopplingstest');
  console.log(`    URL:  ${SUPABASE_URL}`);
  console.log(`    Nyckel: ${SUPABASE_KEY.slice(0, 20)}...`);

  await testDatabaseAccess();
  await testFetchBuildings();
  await testSyncState();
  await testEdgeFunction();

  console.log('\n' + '─'.repeat(55));
  console.log('  ✅  Test klart!');
  console.log('─'.repeat(55) + '\n');
}

main().catch(err => {
  console.error('\n💥  Oväntat fel:', err.message);
  process.exit(1);
});
