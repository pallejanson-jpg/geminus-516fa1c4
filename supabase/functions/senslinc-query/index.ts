import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface SenslincRequest {
  action: 'test-connection' | 'get-equipment' | 'get-site-equipment' | 'get-sites' | 'get-lines' | 'get-machines' | 'get-dashboard-url' | 'get-indices' | 'get-properties' | 'search-data' | 'get-machine-data' | 'get-building-sensor-data';
  fmGuid?: string;
  siteCode?: string;
  sitePk?: number;
  indiceId?: number;
  workspaceKey?: string;
  query?: Record<string, unknown>;
  days?: number;
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
  let portalUrl = apiUrl
    .replace(/^(https?:\/\/)api\./, '$1')  // api.example.com → example.com
    .replace(/\/api\/?$/, '');              // .../api/ → ...
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
    const { action, fmGuid, siteCode, indiceId, workspaceKey, query, days } = await req.json() as SenslincRequest;

    const apiUrl = Deno.env.get('SENSLINC_API_URL');
    const email = Deno.env.get('SENSLINC_EMAIL');
    const password = Deno.env.get('SENSLINC_PASSWORD');

    if (!apiUrl || !email || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Senslinc credentials not configured',
          message: 'Please configure SENSLINC_API_URL, SENSLINC_EMAIL, and SENSLINC_PASSWORD in Lovable Cloud secrets.'
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
          message: 'Kunde inte ansluta till Senslinc. Kontrollera credentials.',
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
            message: `Anslutning lyckades via ${authMode}! Hittade ${Array.isArray(sites) ? sites.length : 0} sites.`,
            authMode,
          });
        } catch (error: any) {
          return jsonResponse({
            success: false,
            error: error.message,
            message: 'Kunde inte ansluta till Senslinc. Kontrollera credentials.',
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

        return jsonResponse({ success: false, error: 'No equipment found for this FM GUID', message: 'Ingen utrustning hittades i Senslinc för detta FM GUID.' });
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
            // Try to extract workspace key from properties
            if (properties.length > 0 && properties[0].indice_workspace) {
              workspaceKeyDiscovered = properties[0].indice_workspace;
            }
          } catch (e) {
            console.warn('[Senslinc] Could not fetch properties:', e);
          }
        }

        // 3. Fetch time-series data if workspace key is available
        let timeSeries: any = null;
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
                    avg_temp: { avg: { field: 'temperature' } },
                    avg_co2: { avg: { field: 'co2' } },
                    avg_humidity: { avg: { field: 'humidity' } },
                    avg_occupancy: { avg: { field: 'occupancy' } }
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
          } catch (e) {
            console.warn('[Senslinc] Could not fetch time-series data:', e);
          }
        }

        return jsonResponse({
          success: true,
          data: { machine, dashboardUrl, properties, timeSeries, workspaceKey: wsKey }
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
        const machineSlim = machines.map((m: any) => ({
          pk: m.pk,
          code: m.code,
          name: m.name,
          dashboard_url: m.dashboard_url || buildDashboardUrl(cleanApiUrl, 'machine', m.pk),
          latest_values: m.latest_values ?? null,
          indices: m.indices ?? [],
        }));

        return jsonResponse({
          success: true,
          data: {
            site: { pk: site.pk, code: site.code, name: site.name, dashboard_url: site.dashboard_url || buildDashboardUrl(cleanApiUrl, 'site', site.pk) },
            machines: machineSlim,
          }
        });
      }

      default:
        return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: any) {
    console.error('[Senslinc] Error:', error);
    return jsonResponse({ success: false, error: error.message }, 200);
  }
});

