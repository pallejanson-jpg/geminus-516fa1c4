# Faciliate connector

Bridges the **Faciliate RestAPI** (SWG, inside VPN) to the Geminus Supabase
project so Geminus AI can answer questions about work orders, contracts and
planned maintenance — and create work orders.

This is the **VPN-route** component: it must run on a machine that can reach the
Faciliate/Landlord RestAPI server. It needs no build step (plain Node ≥ 18).

## Important

`Faciliate.exe -custom-dbconnection ...xml` is the **desktop client**, which talks
straight to the SQL database. This connector instead uses the **RestAPI server**
(`https://<server>/api/v2/...`), which is the supported, safe integration (it runs
Faciliate's business rules). Ask SWG ops for that server's base URL — it is a
separate web component from the desktop app.

## Setup

```sh
cd faciliate-connector
cp .env.example .env        # then fill in FACILIATE_BASE_URL + auth + service role key
```

## Use

```sh
# 1. Verify connectivity + see which object types exist on this install
node connector.mjs test

# 2. Pull data into Supabase (public.faciliate_records). Run on a schedule.
node connector.mjs sync                       # default: workorder,rentlandlord,maintenance
node connector.mjs sync workorder             # one type

# 3. Create a work order (json inline or @file)
node connector.mjs create-workorder @workorder.json
```

Geminus AI reads the synced cache via its `query_faciliate` tool, so end users
never need VPN — only this connector does. Schedule `sync` (Task Scheduler / cron)
to keep the cache fresh.

## Notes
- Field extraction in `toRow()` is defensive; once `test` shows the real schema
  (`metainfo`/`swagger`), tighten the extracted columns if needed.
- Never commit `.env` — it holds the Faciliate password and the Supabase service
  role key.
