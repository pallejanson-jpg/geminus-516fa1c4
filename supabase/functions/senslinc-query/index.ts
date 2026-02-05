import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Match Supabase web client preflight headers
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface SenslincRequest {
  action: 'test-connection' | 'get-equipment' | 'get-site-equipment' | 'get-sites' | 'get-lines' | 'get-machines' | 'get-dashboard-url' | 'get-indices' | 'get-properties' | 'search-data';
  fmGuid?: string;
  siteCode?: string;
  indiceId?: number;
  workspaceKey?: string;
  query?: Record<string, unknown>;
}

async function getJwtToken(apiUrl: string, email: string, password: string): Promise<string> {
  const tokenUrl = `${apiUrl}/api-token-auth/`;
  console.log('[Senslinc] Authenticating to:', tokenUrl);

  // Senslinc deployments can differ in accepted login payload.
  // Try `{ email, password }` first, then fallback to `{ username, password }`.
  const attempts: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: 'email', body: { email, password } },
    { label: 'username', body: { username: email, password } },
  ];

  let lastStatus = 0;
  let lastText = '';

  for (const attempt of attempts) {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attempt.body),
    });

    if (!response.ok) {
      const text = await response.text();
      lastStatus = response.status;
      lastText = text;
      console.error('[Senslinc] Auth failed:', response.status, text);
      // Try next payload if available
      continue;
    }

    const data = await response.json();
    if (!data.token) {
      throw new Error('No token received from Senslinc');
    }

    console.log('[Senslinc] Authentication successful (payload:', attempt.label, ')');
    return data.token;
  }

  throw new Error(`Authentication failed: ${lastStatus}${lastText ? ` (${lastText})` : ''}`);
}

async function senslincFetchWithRetry(
  apiUrl: string, 
  endpoint: string, 
  token: string,
  options?: { method?: string; body?: unknown }
): Promise<unknown> {
  const maxRetries = 3;
  let delay = 1000;
  const url = `${apiUrl}${endpoint}`;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    console.log(`[Senslinc] Fetching: ${url} (attempt ${attempt + 1})`);
    
    const response = await fetch(url, {
      method: options?.method || 'GET',
      headers: { 
        'Authorization': `JWT ${token}`,
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

// Legacy wrapper for backwards compatibility
async function senslincFetch(apiUrl: string, endpoint: string, token: string) {
  return senslincFetchWithRetry(apiUrl, endpoint, token);
}

// Build dashboard URL from base URL and entity type
function buildDashboardUrl(apiUrl: string, type: 'machine' | 'site' | 'line', pk: number): string {
  // Transform API URL to portal URL
  // e.g., https://api.swg-group.productinuse.com -> https://swg-group.productinuse.com
  const portalUrl = apiUrl.replace('api.', '').replace('/api', '');
  return `${portalUrl}/dashboard/${type}/${pk}`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const { action, fmGuid, siteCode, indiceId, workspaceKey, query } = await req.json() as SenslincRequest;
    
    // Get credentials from environment
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

    // Clean up API URL (remove trailing slash)
    const cleanApiUrl = apiUrl.replace(/\/$/, '');

    // For all authenticated actions we return 200 + { success:false } on auth failure
    // to avoid hard crashes in the client (which tends to treat non-2xx as throw).
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
    ]);

    let token: string | null = null;
    if (authedActions.has(action)) {
      try {
        token = await getJwtToken(cleanApiUrl, email, password);
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
          const token = await getJwtToken(cleanApiUrl, email, password);
          // Try to fetch sites to verify connection works
          const sites = await senslincFetch(cleanApiUrl, '/api/sites', token);
          return jsonResponse({
            success: true,
            message: `Anslutning lyckades! Hittade ${Array.isArray(sites) ? sites.length : 0} sites.`,
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
        if (!fmGuid) {
          return jsonResponse({ success: false, error: 'fmGuid required' }, 400);
        }
        
        // token is guaranteed by authedActions
        const authToken = token as string;
        // Search machines by code (FM GUID)
        const machines = await senslincFetch(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, authToken);
        
        return jsonResponse({ success: true, data: machines });
      }

      case 'get-site-equipment': {
        if (!siteCode) {
          return jsonResponse({ success: false, error: 'siteCode required' }, 400);
        }
        
        const authToken = token as string;
        // Get all machines for a site
        const machines = await senslincFetch(cleanApiUrl, `/api/machines?site=${encodeURIComponent(siteCode)}`, authToken);
        
        return jsonResponse({ success: true, data: machines });
      }

      case 'get-sites': {
        const authToken = token as string;
        const sites = await senslincFetch(cleanApiUrl, '/api/sites', authToken);
        
        return jsonResponse({ success: true, data: sites });
      }

      case 'get-lines': {
        const authToken = token as string;
        const lines = await senslincFetch(cleanApiUrl, '/api/lines', authToken);
        
        return jsonResponse({ success: true, data: lines });
      }

      case 'get-machines': {
        const authToken = token as string;
        const machines = await senslincFetch(cleanApiUrl, '/api/machines', authToken);
        
        return jsonResponse({ success: true, data: machines });
      }

      // New action: Get dashboard URL for a given FM GUID
      // Searches machines, sites, and lines to find matching entity
      case 'get-dashboard-url': {
        if (!fmGuid) {
          return jsonResponse({ success: false, error: 'fmGuid required' }, 400);
        }

        const authToken = token as string;
        
        // Try to find as machine first (rooms/assets)
        try {
          const machines = await senslincFetch(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, authToken);
          if (Array.isArray(machines) && machines.length > 0) {
            const machine = machines[0];
            const dashboardUrl = machine.dashboard_url || buildDashboardUrl(cleanApiUrl, 'machine', machine.pk);
            return jsonResponse({
              success: true,
              data: {
                dashboardUrl,
                type: 'machine',
                name: machine.name,
                pk: machine.pk,
                ...machine,
              },
            });
          }
        } catch (err) {
          console.log('[Senslinc] No machine found for fmGuid:', fmGuid);
        }
        
        // Try to find as site (buildings)
        try {
          const sites = await senslincFetch(cleanApiUrl, `/api/sites?code=${encodeURIComponent(fmGuid)}`, authToken);
          if (Array.isArray(sites) && sites.length > 0) {
            const site = sites[0];
            const dashboardUrl = site.dashboard_url || buildDashboardUrl(cleanApiUrl, 'site', site.pk);
            return jsonResponse({
              success: true,
              data: {
                dashboardUrl,
                type: 'site',
                name: site.name,
                pk: site.pk,
                ...site,
              },
            });
          }
        } catch (err) {
          console.log('[Senslinc] No site found for fmGuid:', fmGuid);
        }
        
        // Try to find as line (floors/storeys)
        try {
          const lines = await senslincFetch(cleanApiUrl, `/api/lines?code=${encodeURIComponent(fmGuid)}`, authToken);
          if (Array.isArray(lines) && lines.length > 0) {
            const line = lines[0];
            const dashboardUrl = line.dashboard_url || buildDashboardUrl(cleanApiUrl, 'line', line.pk);
            return jsonResponse({
              success: true,
              data: {
                dashboardUrl,
                type: 'line',
                name: line.name,
                pk: line.pk,
                ...line,
              },
            });
          }
        } catch (err) {
          console.log('[Senslinc] No line found for fmGuid:', fmGuid);
        }
        
      // Nothing found
      return jsonResponse({
        success: false,
        error: 'No equipment found for this FM GUID',
        message: 'Ingen utrustning hittades i Senslinc för detta FM GUID.',
      });
    }

    // === Elasticsearch DSL Actions ===
    
    case 'get-indices': {
      const authToken = token as string;
      const indices = await senslincFetchWithRetry(cleanApiUrl, '/api/indices', authToken);
      return jsonResponse({ success: true, data: indices });
    }

    case 'get-properties': {
      if (!indiceId) {
        return jsonResponse({ success: false, error: 'indiceId required' }, 400);
      }
      const authToken = token as string;
      const properties = await senslincFetchWithRetry(
        cleanApiUrl, 
        `/api/properties?indice=${indiceId}`, 
        authToken
      );
      return jsonResponse({ success: true, data: properties });
    }

    case 'search-data': {
      if (!workspaceKey || !query) {
        return jsonResponse({ success: false, error: 'workspaceKey and query required' }, 400);
      }
      const authToken = token as string;
      const results = await senslincFetchWithRetry(
        cleanApiUrl,
        `/api/data-workspaces/${encodeURIComponent(workspaceKey)}/_search`,
        authToken,
        { method: 'POST', body: query }
      );
      return jsonResponse({ success: true, data: results });
    }

      default:
        return jsonResponse({ success: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: any) {
    console.error('[Senslinc] Error:', error);
    // Never return 500 to the client for expected failures; keep errors structured.
    return jsonResponse({ success: false, error: error.message }, 200);
  }
});
