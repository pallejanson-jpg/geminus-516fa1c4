import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSenslincCredentials } from "../_shared/credentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface SenslincRequest {
  action: 'test-connection' | 'get-equipment' | 'get-site-equipment' | 'get-sites' | 'get-lines' | 'get-machines' | 'get-dashboard-url' | 'get-indices' | 'get-properties' | 'search-data' | 'get-machine-data' | 'get-building-sensor-data' | 'get-machine-air-quality' | 'get-ilean-context' | 'ilean-ask' | 'ilean-probe';
  fmGuid?: string;
  siteCode?: string;
  sitePk?: number;
  indiceId?: number;
  workspaceKey?: string;
  query?: Record<string, unknown>;
  days?: number;
  contextLevel?: 'building' | 'floor' | 'room';
  question?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
}

// ── Token cache (55-minute TTL) ──
let cachedToken: { token: string; expiresAt: number; type: 'JWT' | 'Bearer' } | null = null;
const TOKEN_TTL_MS = 55 * 60 * 1000; // 55 minutes

// ── Keycloak token fetch (Variant A: client_credentials, Variant B: password grant) ──
async function getKeycloakToken(
  keycloakUrl: string,
  clientId: string,
  clientSecret: string | undefined,
  username: string | undefined,
  password: string | undefined,
): Promise<{ token: string; type: 'Bearer' }> {
  const tokenUrl = keycloakUrl.includes('/protocol/openid-connect/token')
    ? keycloakUrl
    : `${keycloakUrl.replace(/\/+$/, '')}/protocol/openid-connect/token`;

  // Variant A: client_credentials (service account — preferred)
  if (clientSecret) {
    console.log('[Senslinc] Trying Keycloak client_credentials (service account)');
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (res.ok) {
      const data = await res.json();
      console.log('[Senslinc] Keycloak client_credentials OK');
      return { token: data.access_token, type: 'Bearer' };
    }
    const errText = await res.text();
    console.warn('[Senslinc] client_credentials failed:', res.status, errText, '— falling back to password grant');
  }

  // Variant B: password grant with AD account
  if (username && password) {
    console.log('[Senslinc] Trying Keycloak password grant (AD account)');
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      username,
      password,
    });
    if (clientSecret) params.set('client_secret', clientSecret);

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Keycloak auth failed: ${res.status} - ${text}`);
    }
    const data = await res.json();
    console.log('[Senslinc] Keycloak password grant OK');
    return { token: data.access_token, type: 'Bearer' };
  }

  throw new Error('Keycloak: neither client_secret nor username/password configured');
}

// ── Legacy Django /api-token-auth/ with exponential backoff ──
async function getDjangoToken(apiUrl: string, email: string, password: string): Promise<string> {
  const tokenUrl = `${apiUrl}/api-token-auth/`;
  console.log('[Senslinc] Authenticating via Django token auth:', tokenUrl);

  const attempts: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: 'email', body: { email, password } },
    { label: 'username', body: { username: email, password } },
  ];

  const maxRetries = 3;
  let delay = 1000;
  let lastStatus = 0;
  let lastText = '';

  for (let retry = 0; retry <= maxRetries; retry++) {
    if (retry > 0) {
      console.log(`[Senslinc] Auth retry ${retry}/${maxRetries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }

    let got429 = false;

    for (const attempt of attempts) {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.body),
      });

      if (response.status === 429) {
        const text = await response.text();
        console.warn('[Senslinc] Rate limited (429) on auth attempt:', attempt.label, text);
        got429 = true;
        break;
      }

      if (!response.ok) {
        const text = await response.text();
        lastStatus = response.status;
        lastText = text;
        console.error('[Senslinc] Auth failed:', response.status, text);
        continue;
      }

      const data = await response.json();
      if (!data.token) {
        throw new Error('No token received from Senslinc');
      }

      console.log('[Senslinc] Django token auth OK (payload:', attempt.label, ')');
      return data.token;
    }

    if (!got429) break;
  }

  throw new Error(`Authentication failed after retries: ${lastStatus}${lastText ? ` (${lastText})` : ''}`);
}

// ── Unified token resolver with cache ──
async function getTokenWithType(
  apiUrl: string,
  email: string,
  password: string,
): Promise<{ token: string; type: 'JWT' | 'Bearer' }> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    console.log('[Senslinc] Using cached token (type:', cachedToken.type, ')');
    return { token: cachedToken.token, type: cachedToken.type };
  }

  const keycloakUrl = Deno.env.get('SENSLINC_KEYCLOAK_URL');
  const clientId = Deno.env.get('SENSLINC_CLIENT_ID');
  const clientSecret = Deno.env.get('SENSLINC_CLIENT_SECRET');

  if (keycloakUrl && clientId) {
    // Keycloak flow — Variant A (client_credentials) or Variant B (password grant)
    const result = await getKeycloakToken(keycloakUrl, clientId, clientSecret, email, password);
    cachedToken = { ...result, expiresAt: Date.now() + TOKEN_TTL_MS };
    return result;
  }

  // Legacy Django /api-token-auth/
  const token = await getDjangoToken(apiUrl, email, password);
  cachedToken = { token, type: 'JWT', expiresAt: Date.now() + TOKEN_TTL_MS };
  return { token, type: 'JWT' };
}

// ── Legacy wrapper for backwards compatibility ──
async function getJwtToken(apiUrl: string, email: string, password: string): Promise<string> {
  const { token } = await getTokenWithType(apiUrl, email, password);
  return token;
}

async function senslincFetchWithRetry(
  apiUrl: string,
  endpoint: string,
  token: string,
  tokenType: 'JWT' | 'Bearer' = 'JWT',
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  const maxRetries = 3;
  let delay = 1000;
  const url = `${apiUrl}${endpoint}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    console.log(`[Senslinc] Fetching: ${url} (attempt ${attempt + 1}, auth: ${tokenType})`);

    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: {
        'Authorization': `${tokenType} ${token}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 429) {
      if (attempt < maxRetries) {
        console.log(`[Senslinc] Rate limited, retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }
      throw new Error('Rate limit exceeded after retries');
    }

    if (!response.ok) {
      const text = await response.text();
      console.error('[Senslinc] Request failed:', response.status, text);
      throw new Error(`Senslinc API error: ${response.status} - ${text}`);
    }

    return response.json();
  }

  throw new Error('Max retries exceeded');
}

// Legacy wrapper
async function senslincFetch(apiUrl: string, endpoint: string, token: string, tokenType: 'JWT' | 'Bearer' = 'JWT') {
  return senslincFetchWithRetry(apiUrl, endpoint, token, tokenType);
}

// Build dashboard URL from base URL and entity type
function buildDashboardUrl(apiUrl: string, type: 'machine' | 'site' | 'line', pk: number): string {
  // Strip api. subdomain prefix and /api path suffix to get portal URL
  // Many Senslinc instances use the same domain without the api. prefix,
  // or use an app. prefix instead
  let portalUrl = apiUrl
    .replace(/^(https?:\/\/)api\./, '$1')      // api.example.com → example.com (no app. prefix)
    .replace(/\/api\/?$/, '');                  // .../api/ → ...
  portalUrl = portalUrl.replace(/\/$/, '');

  const pathMap = {
    machine: `/machine/${pk}/room_analysis/`,
    site:    `/site/${pk}/home/`,
    line:    `/line/${pk}/`,
  };
  return `${portalUrl}${pathMap[type]}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const { action, fmGuid, siteCode, indiceId, workspaceKey, query, days, contextLevel, question, conversationHistory, buildingFmGuid } = await req.json() as SenslincRequest & { buildingFmGuid?: string };

    // Resolve per-building credentials
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sbClient = createClient(supabaseUrl, supabaseKey);
    const slCreds = await getSenslincCredentials(sbClient, buildingFmGuid || fmGuid);

    const apiUrl = slCreds.apiUrl;
    const email = slCreds.email;
    const password = slCreds.password;

    if (!apiUrl || !email || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Senslinc credentials not configured',
          message: 'Please configure Senslinc credentials in Lovable Cloud or in building settings.'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanApiUrl = apiUrl.replace(/\/$/, '');

    const authedActions = new Set<SenslincRequest['action']>([
      'get-equipment',
      'get-site-equipment',
      'get-sites',
      'get-lines',
      'get-machines',
      'get-dashboard-url',
      'get-indices',
      'get-properties',
      'search-data',
      'get-machine-data',
      'get-building-sensor-data',
      'get-machine-air-quality',
      'get-ilean-context',
      'ilean-ask',
      'ilean-probe',
    ]);

    let token: string | null = null;
    let tokenType: 'JWT' | 'Bearer' = 'JWT';

    if (authedActions.has(action)) {
      try {
        const result = await getTokenWithType(cleanApiUrl, email, password);
        token = result.token;
        tokenType = result.type;
      } catch (error: any) {
          return jsonResponse({
            success: false,
            error: error?.message ?? 'Authentication failed',
            message: 'Could not connect to Senslinc. Check credentials.',
          });
      }
    }

    switch (action) {
      case 'test-connection': {
        try {
          const authMode = Deno.env.get('SENSLINC_KEYCLOAK_URL') ? 'Keycloak' : 'Django token';
          const { token: t, type } = await getTokenWithType(cleanApiUrl, email, password);
          const sites = await senslincFetch(cleanApiUrl, '/api/sites', t, type);
          return jsonResponse({
            success: true,
            message: `Connection successful via ${authMode}! Found ${Array.isArray(sites) ? sites.length : 0} sites.`,
            authMode,
          });
        } catch (error: any) {
          return jsonResponse({
            success: false,
            error: error.message,
            message: 'Could not connect to Senslinc. Check credentials.',
          });
        }
      }

      case 'get-equipment': {
        if (!fmGuid) return jsonResponse({ success: false, error: 'fmGuid required' }, 400);
        const authToken = token as string;
        const machines = await senslincFetch(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType);
        return jsonResponse({ success: true, data: machines });
      }

      case 'get-site-equipment': {
        if (!siteCode) return jsonResponse({ success: false, error: 'siteCode required' }, 400);
        const authToken = token as string;
        const machines = await senslincFetch(cleanApiUrl, `/api/machines?site=${encodeURIComponent(siteCode)}`, authToken, tokenType);
        return jsonResponse({ success: true, data: machines });
      }

      case 'get-sites': {
        const authToken = token as string;
        const sites = await senslincFetch(cleanApiUrl, '/api/sites', authToken, tokenType);
        return jsonResponse({ success: true, data: sites });
      }

      case 'get-lines': {
        const authToken = token as string;
        const lines = await senslincFetch(cleanApiUrl, '/api/lines', authToken, tokenType);
        return jsonResponse({ success: true, data: lines });
      }

      case 'get-machines': {
        const authToken = token as string;
        const machines = await senslincFetch(cleanApiUrl, '/api/machines', authToken, tokenType);
        return jsonResponse({ success: true, data: machines });
      }

      case 'get-dashboard-url': {
        if (!fmGuid) return jsonResponse({ success: false, error: 'fmGuid required' }, 400);
        const authToken = token as string;

        try {
          const machines = await senslincFetch(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType);
          if (Array.isArray(machines) && machines.length > 0) {
            const machine = machines[0];
            const dashboardUrl = machine.dashboard_url || buildDashboardUrl(cleanApiUrl, 'machine', machine.pk);
            return jsonResponse({ success: true, data: { dashboardUrl, type: 'machine', name: machine.name, pk: machine.pk, ...machine } });
          }
        } catch (err) {
          console.log('[Senslinc] No machine found for fmGuid:', fmGuid);
        }

        try {
          const sites = await senslincFetch(cleanApiUrl, `/api/sites?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType);
          if (Array.isArray(sites) && sites.length > 0) {
            const site = sites[0];
            const dashboardUrl = site.dashboard_url || buildDashboardUrl(cleanApiUrl, 'site', site.pk);
            return jsonResponse({ success: true, data: { dashboardUrl, type: 'site', name: site.name, pk: site.pk, ...site } });
          }
        } catch (err) {
          console.log('[Senslinc] No site found for fmGuid:', fmGuid);
        }

        try {
          const lines = await senslincFetch(cleanApiUrl, `/api/lines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType);
          if (Array.isArray(lines) && lines.length > 0) {
            const line = lines[0];
            const dashboardUrl = line.dashboard_url || buildDashboardUrl(cleanApiUrl, 'line', line.pk);
            return jsonResponse({ success: true, data: { dashboardUrl, type: 'line', name: line.name, pk: line.pk, ...line } });
          }
        } catch (err) {
          console.log('[Senslinc] No line found for fmGuid:', fmGuid);
        }

        return jsonResponse({ success: false, error: 'No equipment found for this FM GUID' });
      }

      case 'get-indices': {
        const authToken = token as string;
        const indices = await senslincFetchWithRetry(cleanApiUrl, '/api/indices', authToken, tokenType);
        return jsonResponse({ success: true, data: indices });
      }

      case 'get-properties': {
        if (!indiceId) return jsonResponse({ success: false, error: 'indiceId required' }, 400);
        const authToken = token as string;
        const properties = await senslincFetchWithRetry(cleanApiUrl, `/api/properties?indice=${indiceId}`, authToken, tokenType);
        return jsonResponse({ success: true, data: properties });
      }

      case 'search-data': {
        if (!workspaceKey || !query) return jsonResponse({ success: false, error: 'workspaceKey and query required' }, 400);
        const authToken = token as string;
        const results = await senslincFetchWithRetry(
          cleanApiUrl,
          `/api/data-workspaces/${encodeURIComponent(workspaceKey)}/_search`,
          authToken,
          tokenType,
          { method: 'POST', body: query }
        );
        return jsonResponse({ success: true, data: results });
      }

      // ── get-machine-data: all-in-one fetch for a single machine by fmGuid ──
      case 'get-machine-data': {
        if (!fmGuid) return jsonResponse({ success: false, error: 'fmGuid required' }, 400);
        const authToken = token as string;
        const daysBack = days ?? 7;

        // 1. Find machine by code (= fmGuid)
        const machinesRaw = await senslincFetchWithRetry(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType);
        if (!Array.isArray(machinesRaw) || machinesRaw.length === 0) {
          return jsonResponse({ success: false, error: 'No machine found for this fmGuid' });
        }
        const machine = machinesRaw[0] as any;
        const dashboardUrl = machine.dashboard_url || buildDashboardUrl(cleanApiUrl, 'machine', machine.pk);

        // 2. Fetch properties for first indice (to know available fields)
        let properties: any[] = [];
        let workspaceKeyDiscovered: string | null = null;
        if (Array.isArray(machine.indices) && machine.indices.length > 0) {
          try {
            const indiceId = machine.indices[0];
            const propsRaw = await senslincFetchWithRetry(cleanApiUrl, `/api/properties?indice=${indiceId}`, authToken, tokenType) as any;
            properties = Array.isArray(propsRaw) ? propsRaw : (propsRaw?.results ?? []);
            // Try to extract workspace key -- check natural_key[0] first, then indice_workspace
            if (properties.length > 0) {
              const p0 = properties[0];
              if (Array.isArray(p0.natural_key) && p0.natural_key.length > 0) {
                workspaceKeyDiscovered = p0.natural_key[0];
                console.log('[Senslinc] Workspace key from natural_key:', workspaceKeyDiscovered);
              } else if (p0.indice_workspace) {
                workspaceKeyDiscovered = p0.indice_workspace;
                console.log('[Senslinc] Workspace key from indice_workspace:', workspaceKeyDiscovered);
              }
            }
          } catch (e) {
            console.warn('[Senslinc] Could not fetch properties:', e);
          }
        }

        // 3. Try to fetch time-series data via multiple strategies
        let timeSeries: any = null;
        let machineDataResult: any = null;
        const machinePk = machine.pk;

        // Strategy A: ES data-workspaces/_search (works on some Senslinc instances)
        const wsKey = workspaceKey || workspaceKeyDiscovered;
        if (wsKey) {
          try {
            const esQuery = {
              size: 0,
              query: {
                bool: {
                  must: [
                    { term: { machine_code: fmGuid } },
                    { range: { ts_beg: { gte: `now-${daysBack}d`, lte: 'now' } } }
                  ]
                }
              },
              aggs: {
                per_day: {
                  date_histogram: { field: 'ts_beg', calendar_interval: 'day' },
                  aggs: {
                    avg_temp: { avg: { field: 'temperature_mean' } },
                    avg_co2: { avg: { field: 'co2_mean' } },
                    avg_humidity: { avg: { field: 'humidity_mean' } },
                    avg_occupancy: { avg: { field: 'occupation_mean' } },
                    avg_light: { avg: { field: 'light_mean' } }
                  }
                }
              }
            };
            timeSeries = await senslincFetchWithRetry(
              cleanApiUrl,
              `/api/data-workspaces/${encodeURIComponent(wsKey)}/_search`,
              authToken, tokenType,
              { method: 'POST', body: esQuery }
            );
            console.log('[Senslinc] ES data-workspaces OK for key:', wsKey);
          } catch (e) {
            console.warn('[Senslinc] ES data-workspaces failed, trying /api/machines/{pk}/data/:', (e as Error).message);
          }
        }

        // Strategy B: /api/machines/{pk}/data/ (alternative data endpoint)
        if (!timeSeries && machinePk) {
          try {
            const now = new Date();
            const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
            const fromStr = from.toISOString();
            const toStr = now.toISOString();
            // Try with each known indice key
            const indiceKeys = Array.isArray(machine.indices) ? machine.indices : [];
            for (const indKey of indiceKeys) {
              try {
                const dataUrl = `/api/machines/${machinePk}/data/?indice_key=${indKey}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}`;
                const dataResult = await senslincFetchWithRetry(cleanApiUrl, dataUrl, authToken, tokenType) as any;
                if (dataResult && (Array.isArray(dataResult) ? dataResult.length > 0 : dataResult.results?.length > 0)) {
                  machineDataResult = Array.isArray(dataResult) ? dataResult : dataResult.results;
                  console.log('[Senslinc] /api/machines/{pk}/data/ OK for indice:', indKey, 'rows:', machineDataResult.length);
                  break;
                }
              } catch (innerErr) {
                console.warn('[Senslinc] machines/data failed for indice', indKey, ':', (innerErr as Error).message);
              }
            }
          } catch (e) {
            console.warn('[Senslinc] Could not fetch /api/machines/{pk}/data/:', (e as Error).message);
          }
        }

        // Strategy C: latest values only via ?last=1
        if (!timeSeries && !machineDataResult && machinePk) {
          try {
            const indiceKeys = Array.isArray(machine.indices) ? machine.indices : [];
            for (const indKey of indiceKeys) {
              try {
                const latestUrl = `/api/machines/${machinePk}/data/?indice_key=${indKey}&last=1`;
                const latestResult = await senslincFetchWithRetry(cleanApiUrl, latestUrl, authToken, tokenType) as any;
                if (latestResult && (Array.isArray(latestResult) ? latestResult.length > 0 : latestResult.results?.length > 0)) {
                  machineDataResult = Array.isArray(latestResult) ? latestResult : latestResult.results;
                  console.log('[Senslinc] /api/machines/{pk}/data/?last=1 OK for indice:', indKey);
                  break;
                }
              } catch (innerErr) {
                // continue to next indice
              }
            }
          } catch (e) {
            console.warn('[Senslinc] Could not fetch latest values:', (e as Error).message);
          }
        }

        return jsonResponse({
          success: true,
          data: { machine, dashboardUrl, properties, timeSeries, machineData: machineDataResult, workspaceKey: wsKey }
        });
      }

      // ── get-machine-air-quality: fetch Air Quality data from all indices ──
      case 'get-machine-air-quality': {
        if (!fmGuid) return jsonResponse({ success: false, error: 'fmGuid required' }, 400);
        const authToken = token as string;
        const daysBack = days ?? 7;

        // Find machine
        const machinesRaw2 = await senslincFetchWithRetry(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType);
        if (!Array.isArray(machinesRaw2) || machinesRaw2.length === 0) {
          return jsonResponse({ success: false, error: 'No machine found' });
        }
        const machine2 = machinesRaw2[0] as any;
        const dashUrl2 = machine2.dashboard_url || buildDashboardUrl(cleanApiUrl, 'machine', machine2.pk);
        const indiceKeys2 = Array.isArray(machine2.indices) ? machine2.indices : [];

        // Fetch data from all indices
        const allData: Record<number, any[]> = {};
        const now2 = new Date();
        const from2 = new Date(now2.getTime() - daysBack * 24 * 60 * 60 * 1000);
        for (const indKey of indiceKeys2) {
          try {
            const url2 = `/api/machines/${machine2.pk}/data/?indice_key=${indKey}&from=${encodeURIComponent(from2.toISOString())}&to=${encodeURIComponent(now2.toISOString())}`;
            const result2 = await senslincFetchWithRetry(cleanApiUrl, url2, authToken, tokenType) as any;
            const arr = Array.isArray(result2) ? result2 : (result2?.results ?? []);
            if (arr.length > 0) allData[indKey] = arr;
          } catch (e) {
            console.warn('[Senslinc] air-quality data for indice', indKey, 'failed:', (e as Error).message);
          }
        }

        // Also fetch properties for each indice
        const allProps: Record<number, any[]> = {};
        for (const indKey of indiceKeys2) {
          try {
            const propsRaw2 = await senslincFetchWithRetry(cleanApiUrl, `/api/properties?indice=${indKey}`, authToken, tokenType) as any;
            allProps[indKey] = Array.isArray(propsRaw2) ? propsRaw2 : (propsRaw2?.results ?? []);
          } catch (e) {
            // ignore
          }
        }

        return jsonResponse({
          success: true,
          data: {
            machine: machine2,
            dashboardUrl: dashUrl2,
            indices: indiceKeys2,
            dataByIndice: allData,
            propertiesByIndice: allProps,
          }
        });
      }

      // ── get-building-sensor-data: all machines for a site in one call ──
      case 'get-building-sensor-data': {
        if (!fmGuid) return jsonResponse({ success: false, error: 'fmGuid (site code) required' }, 400);
        const authToken = token as string;

        // Find site matching fmGuid
        const sitesRaw = await senslincFetchWithRetry(cleanApiUrl, `/api/sites?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType) as any;
        const sitesArr = Array.isArray(sitesRaw) ? sitesRaw : (sitesRaw?.results ?? []);

        if (sitesArr.length === 0) {
          return jsonResponse({ success: false, error: 'No Senslinc site found for this building fmGuid' });
        }
        const site = sitesArr[0] as any;

        // Fetch all machines for this site using site pk
        const machinesRaw = await senslincFetchWithRetry(cleanApiUrl, `/api/machines?site=${site.pk}`, authToken, tokenType) as any;
        const machines = Array.isArray(machinesRaw) ? machinesRaw : (machinesRaw?.results ?? []);

        // Return slim machine list (code, pk, name, latest_values if available)
        let machineSlim = machines.map((m: any) => ({
          pk: m.pk,
          code: m.code,
          name: m.name,
          dashboard_url: m.dashboard_url || buildDashboardUrl(cleanApiUrl, 'machine', m.pk),
          latest_values: m.latest_values ?? null,
          indices: m.indices ?? [],
        }));

        // If ALL latest_values are null, try fetching detail for a sample of machines
        const hasAnyLatest = machineSlim.some((m: any) => m.latest_values !== null);
        if (!hasAnyLatest && machineSlim.length > 0) {
          console.log(`[Senslinc] All latest_values null, fetching detail for sample of ${Math.min(15, machineSlim.length)} machines...`);
          const sampleSize = Math.min(15, machineSlim.length);
          const step = Math.max(1, Math.floor(machineSlim.length / sampleSize));
          const detailPromises: Promise<void>[] = [];

          for (let i = 0; i < machineSlim.length && detailPromises.length < sampleSize; i += step) {
            const m = machineSlim[i];
            const idx = i; // capture index
            detailPromises.push((async () => {
              try {
                const detail = await senslincFetchWithRetry(cleanApiUrl, `/api/machines/${m.pk}/`, authToken, tokenType) as any;
                if (detail?.latest_values) {
                  machineSlim[idx] = { ...machineSlim[idx], latest_values: detail.latest_values };
                  console.log(`[Senslinc] Got latest_values from detail for machine ${m.pk} (${m.name})`);
                }
              } catch (e) {
                console.warn(`[Senslinc] Detail fetch failed for machine ${m.pk}:`, (e as Error).message);
              }
            })());
          }
          await Promise.all(detailPromises);
        }

        return jsonResponse({
          success: true,
          data: {
            site: { pk: site.pk, code: site.code, name: site.name, dashboard_url: site.dashboard_url || buildDashboardUrl(cleanApiUrl, 'site', site.pk) },
            machines: machineSlim,
          }
        });
      }

      // ── get-ilean-context: resolve Ilean URL for a given fmGuid + context level ──
      case 'get-ilean-context': {
        if (!fmGuid) return jsonResponse({ success: false, error: 'fmGuid required' }, 400);
        const authToken = token as string;
        const level = contextLevel || 'room';

        // Strip api. subdomain to get portal base URL
        let portalUrl = cleanApiUrl
          .replace(/^(https?:\/\/)api\./, '$1')
          .replace(/\/api\/?$/, '')
          .replace(/\/$/, '');

        if (level === 'building') {
          // Find site by code = fmGuid
          try {
            const sites = await senslincFetchWithRetry(cleanApiUrl, `/api/sites?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType) as any;
            const sitesArr = Array.isArray(sites) ? sites : (sites?.results ?? []);
            if (sitesArr.length > 0) {
              const site = sitesArr[0];
              return jsonResponse({
                success: true,
                data: {
                  ileanUrl: `${portalUrl}/site/${site.pk}/ilean/`,
                  dashboardUrl: site.dashboard_url || `${portalUrl}/site/${site.pk}/home/`,
                  entityName: site.name,
                  entityType: 'building',
                  pk: site.pk,
                }
              });
            }
          } catch (e) {
            console.warn('[Senslinc] get-ilean-context building lookup failed:', e);
          }
        } else if (level === 'floor') {
          // Find line by code = fmGuid
          try {
            const lines = await senslincFetchWithRetry(cleanApiUrl, `/api/lines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType) as any;
            const linesArr = Array.isArray(lines) ? lines : (lines?.results ?? []);
            if (linesArr.length > 0) {
              const line = linesArr[0];
              return jsonResponse({
                success: true,
                data: {
                  ileanUrl: `${portalUrl}/line/${line.pk}/ilean/`,
                  dashboardUrl: line.dashboard_url || `${portalUrl}/line/${line.pk}/home/`,
                  entityName: line.name,
                  entityType: 'floor',
                  pk: line.pk,
                }
              });
            }
          } catch (e) {
            console.warn('[Senslinc] get-ilean-context floor lookup failed:', e);
          }
        } else {
          // Room: find machine by code = fmGuid
          try {
            const machines = await senslincFetchWithRetry(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType) as any;
            const machinesArr = Array.isArray(machines) ? machines : (machines?.results ?? []);
            if (machinesArr.length > 0) {
              const machine = machinesArr[0];
              return jsonResponse({
                success: true,
                data: {
                  ileanUrl: `${portalUrl}/machine/${machine.pk}/ilean/`,
                  dashboardUrl: machine.dashboard_url || `${portalUrl}/machine/${machine.pk}/room_analysis/`,
                  entityName: machine.name,
                  entityType: 'room',
                  pk: machine.pk,
                }
              });
            }
          } catch (e) {
            console.warn('[Senslinc] get-ilean-context room lookup failed:', e);
          }
        }

        return jsonResponse({ success: false, error: `No Senslinc entity found for fmGuid at level: ${level}` });
      }

      // ── ilean-probe: discover Ilean API endpoints ──
      case 'ilean-probe': {
        const authToken = token as string;
        let portalUrl = cleanApiUrl
          .replace(/^(https?:\/\/)api\./, '$1')
          .replace(/\/api\/?$/, '')
          .replace(/\/$/, '');

        const endpoints = [
          { url: `${cleanApiUrl}/api/ilean/ask/`, label: 'api/ilean/ask' },
          { url: `${cleanApiUrl}/api/ilean/chat/`, label: 'api/ilean/chat' },
          { url: `${cleanApiUrl}/api/ilean/`, label: 'api/ilean' },
          { url: `${portalUrl}/api/ilean/ask/`, label: 'portal/api/ilean/ask' },
          { url: `${portalUrl}/api/ilean/`, label: 'portal/api/ilean' },
        ];

        const results: Array<{ endpoint: string; status: number; ok: boolean; snippet?: string }> = [];
        for (const ep of endpoints) {
          try {
            const resp = await fetch(ep.url, {
              method: 'POST',
              headers: {
                'Authorization': `${tokenType} ${authToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ question: 'hello' }),
            });
            const text = await resp.text();
            results.push({ endpoint: ep.label, status: resp.status, ok: resp.ok, snippet: text.slice(0, 200) });
          } catch (e) {
            results.push({ endpoint: ep.label, status: 0, ok: false, snippet: (e as Error).message });
          }
        }

        return jsonResponse({ success: true, data: { probeResults: results } });
      }

      // ── ilean-ask: document Q&A via Senslinc Ilean API or Lovable AI fallback ──
      case 'ilean-ask': {
        if (!question) return jsonResponse({ success: false, error: 'question is required' }, 400);
        const authToken = token as string;

        // Resolve entity PK based on contextLevel (building→site, floor→line, room→machine)
        let entityPk: number | null = null;
        let entityName = '';
        let entityApiType = 'sites'; // API path segment
        const level = contextLevel || 'building';

        if (fmGuid) {
          try {
            if (level === 'room') {
              // Room → Machine in Senslinc
              const machines = await senslincFetchWithRetry(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType) as any;
              const arr = Array.isArray(machines) ? machines : (machines?.results ?? []);
              if (arr.length > 0) { entityPk = arr[0].pk; entityName = arr[0].name || ''; entityApiType = 'machines'; }
            } else if (level === 'floor') {
              // Floor → Line in Senslinc
              const lines = await senslincFetchWithRetry(cleanApiUrl, `/api/lines?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType) as any;
              const arr = Array.isArray(lines) ? lines : (lines?.results ?? []);
              if (arr.length > 0) { entityPk = arr[0].pk; entityName = arr[0].name || ''; entityApiType = 'lines'; }
            }
            // Always also try to resolve the site for broader context
            if (!entityPk || level === 'building') {
              const sites = await senslincFetchWithRetry(cleanApiUrl, `/api/sites?code=${encodeURIComponent(fmGuid)}`, authToken, tokenType) as any;
              const arr = Array.isArray(sites) ? sites : (sites?.results ?? []);
              if (arr.length > 0) {
                if (!entityPk) { entityPk = arr[0].pk; entityName = arr[0].name || ''; entityApiType = 'sites'; }
                else if (!entityName) entityName = arr[0].name || '';
              }
            }
          } catch (e) {
            console.warn('[Senslinc] Could not resolve entity for ilean-ask:', e);
          }
        }

        console.log(`[Senslinc] ilean-ask context: level=${level}, entityApiType=${entityApiType}, pk=${entityPk}, name=${entityName}`);

        // Try Senslinc Ilean API endpoints — use the resolved entity type and PK
        let portalUrl2 = cleanApiUrl
          .replace(/^(https?:\/\/)api\./, '$1')
          .replace(/\/api\/?$/, '')
          .replace(/\/$/, '');

        const ileanEndpoints: string[] = [];
        if (entityPk) {
          // Entity-specific Ilean endpoints (most specific first)
          ileanEndpoints.push(
            `${cleanApiUrl}/api/${entityApiType}/${entityPk}/ilean/ask/`,
            `${cleanApiUrl}/api/${entityApiType}/${entityPk}/ilean/`,
            `${portalUrl2}/api/${entityApiType}/${entityPk}/ilean/ask/`,
            `${portalUrl2}/api/${entityApiType}/${entityPk}/ilean/`,
          );
        }
        // Generic Ilean endpoints as fallback
        ileanEndpoints.push(
          `${cleanApiUrl}/api/ilean/ask/`,
          `${portalUrl2}/api/ilean/ask/`,
        );

        for (const endpoint of ileanEndpoints) {
          try {
            console.log('[Senslinc] Trying Ilean endpoint:', endpoint);
            const resp = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Authorization': `${tokenType} ${authToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                question,
                conversation_history: conversationHistory?.map(m => ({ role: m.role, content: m.content })),
              }),
            });

            if (resp.ok) {
              const data = await resp.json();
              console.log('[Senslinc] Ilean API response OK from:', endpoint);
              const answer = data.answer || data.response || data.message || data.content || JSON.stringify(data);
              return jsonResponse({ success: true, data: { answer, source: 'senslinc-ilean', endpoint } });
            }

            // 404/405 means endpoint doesn't exist — try next
            if (resp.status === 404 || resp.status === 405) {
              await resp.text(); // consume body
              continue;
            }

            // Other errors — log but try next
            const errText = await resp.text();
            console.warn('[Senslinc] Ilean endpoint returned', resp.status, ':', errText.slice(0, 200));
          } catch (e) {
            console.warn('[Senslinc] Ilean endpoint error:', endpoint, (e as Error).message);
          }
        }

        // Fallback: RAG search in indexed documents, then use AI to answer
        console.log('[Senslinc] No Ilean API found, trying RAG document search fallback');
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        if (!LOVABLE_API_KEY) {
          return jsonResponse({
            success: true,
            data: {
              answer: `Ilean-tjänsten för dokumentfrågor kunde inte nås för ${entityName || 'denna byggnad'}. Kontrollera att Senslinc Ilean är aktiverat för denna fastighet.`,
              source: 'fallback-error',
            },
          });
        }

        // Step A: Search indexed documents via document_chunks table
        const supabaseUrl2 = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey2 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const sbClient2 = createClient(supabaseUrl2, supabaseKey2);

        let ragChunks: Array<{ content: string; file_name: string; source_type: string }> = [];
        let ragSources: string[] = [];
        const resolvedBuildingGuid = buildingFmGuid || fmGuid;

        try {
          // Extract keywords from the question
          const kwResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash-lite',
              messages: [
                { role: 'system', content: 'Extract 3-6 search keywords from the user query. Return ONLY a JSON array of strings. Include Swedish and English variants.' },
                { role: 'user', content: question },
              ],
              max_tokens: 200, temperature: 0,
            }),
          });

          let keywords: string[] = [question];
          if (kwResp.ok) {
            const kwData = await kwResp.json();
            const kwContent = kwData.choices?.[0]?.message?.content || '';
            try {
              const parsed = JSON.parse(kwContent.match(/\[[\s\S]*\]/)?.[0] || '[]');
              if (Array.isArray(parsed) && parsed.length > 0) keywords = parsed;
            } catch { /* use original */ }
          }

          // Search document_chunks
          let dbQuery = sbClient2.from('document_chunks')
            .select('content, file_name, source_type, building_fm_guid');

          if (resolvedBuildingGuid) {
            dbQuery = dbQuery.or(`building_fm_guid.eq.${resolvedBuildingGuid},building_fm_guid.is.null`);
          }

          const orConditions = keywords.map(kw => `content.ilike.%${kw}%`).join(',');
          dbQuery = dbQuery.or(orConditions);

          const { data: chunks } = await dbQuery.limit(30);
          if (chunks && chunks.length > 0) {
            ragChunks = chunks.slice(0, 15);
            ragSources = [...new Set(ragChunks.map(c => c.file_name).filter(Boolean))] as string[];
            console.log(`[Ilean] RAG found ${ragChunks.length} relevant chunks from ${ragSources.length} documents`);
          }
        } catch (ragErr) {
          console.warn('[Ilean] RAG search failed:', ragErr);
        }

        // Build context-aware prompt with RAG document context if available
        const hasRagContext = ragChunks.length > 0;
        const ragContextBlock = hasRagContext
          ? `\n\nDOKUMENTKONTEXT (från indexerade dokument):\n${ragChunks.map((c, i) => `[${i + 1}] Källa: ${c.file_name || 'okänd'}\n${c.content.slice(0, 600)}`).join('\n\n')}\n\nAnvänd ovanstående dokumentkontext för att besvara frågan. Citera alltid källa (filnamn) när du refererar till information.`
          : '';

        const systemPrompt = `Du är Ilean, en AI-assistent som svarar på frågor om dokument i fastighetssystemet. Du är integrerad i Geminus digital twin-plattform.

Aktuell kontext:
- Entitet: ${entityName || 'Okänd'}
- Kontextnivå: ${level === 'building' ? 'Byggnad' : level === 'floor' ? 'Våningsplan' : 'Rum/utrymme'}
${entityPk ? `- Senslinc PK: ${entityPk}` : ''}
${hasRagContext ? `- Antal dokumentkällor: ${ragSources.length}` : '- Inga indexerade dokument hittades'}
${ragContextBlock}

${hasRagContext
  ? 'Basera ditt svar på dokumentkontexten ovan. Om informationen inte räcker, säg det tydligt. Hitta INTE PÅ innehåll utöver vad dokumenten visar.'
  : 'VIKTIGT: Inga dokument hittades. Informera användaren att inga relevanta dokument finns indexerade och föreslå att de laddar upp eller indexerar dokument via inställningarna.'}

Svara ALLTID på samma språk som användaren skriver.`;

        const aiMessages = [
          { role: 'system', content: systemPrompt },
          ...(conversationHistory || []).map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: question },
        ];

        try {
          const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-3-flash-preview',
              messages: aiMessages,
            }),
          });

          if (!aiResp.ok) {
            const errText = await aiResp.text();
            console.error('[Ilean] AI gateway error:', aiResp.status, errText);
            return jsonResponse({
              success: true,
              data: {
                answer: 'I apologize, but I\'m unable to process your question at the moment. Please try again later or check the Senslinc portal directly.',
                source: 'fallback-error',
              },
            });
          }

          const aiData = await aiResp.json();
          const answer = aiData.choices?.[0]?.message?.content || 'No response generated.';
          return jsonResponse({
            success: true,
            data: {
              answer,
              source: hasRagContext ? 'rag-documents' : 'lovable-ai-fallback',
              sources: ragSources,
              documentCount: ragChunks.length,
            },
          });
        } catch (e) {
          console.error('[Ilean] AI fallback error:', e);
          return jsonResponse({
            success: true,
            data: {
              answer: 'I encountered an error while processing your question. Please try again.',
              source: 'fallback-error',
            },
          });
        }
      }

      default:
        return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: any) {
    console.error('[Senslinc] Error:', error);
    return jsonResponse({ success: false, error: error.message }, 200);
  }
});

