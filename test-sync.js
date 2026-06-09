console.log('Starting test-sync.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

console.log('Env loaded:', process.env.VITE_SUPABASE_URL ? 'yes' : 'no');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSync() {
  try {
    console.log('Invoking sync-structure with force...');
    const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
      body: { action: 'sync-structure', force: true }
    });

    if (error) {
      console.error('Error:', error);
    } else {
      console.log('Success:', data);
    }
  } catch (err) {
    console.error('Exception:', err);
  }
}

testSync();