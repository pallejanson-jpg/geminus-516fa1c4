const fetch = globalThis.fetch;
const url = 'https://diqfthpfncdojlnqnicq.supabase.co/rest/v1';
const headers = {
  apikey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpcWZ0aHBmbmNkb2psbnFuaWNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNjQ2NzMsImV4cCI6MjA4NDY0MDY3M30.LGZO6F6JOwkvn0omwSPXq85aYoJwixTD9_17-tWt038',
  Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpcWZ0aHBmbmNkb2psbnFuaWNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwNjQ2NzMsImV4cCI6MjA4NDY0MDY3M30.LGZO6F6JOwkvn0omwSPXq85aYoJwixTD9_17-tWt038',
};

async function query(path) {
  const res = await fetch(`${url}/${path}`, { headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = text; }
  return { status: res.status, body };
}

(async () => {
  const keys = [
    'assets?select=count',
    'assets?select=fm_guid,category,building_fm_guid,level_fm_guid,in_room_fm_guid&limit=5',
    'asset_sync_state?select=*',
    'asset_sync_progress?select=*',
  ];
  for (const key of keys) {
    const result = await query(key);
    console.log('===', key, '===');
    console.log('status:', result.status);
    console.log('body:', JSON.stringify(result.body, null, 2));
  }
})();
