import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SenslincRequest {
  action: 'test-connection' | 'get-equipment' | 'get-site-equipment' | 'get-sites' | 'get-lines' | 'get-machines' | 'get-dashboard-url';
  fmGuid?: string;
  siteCode?: string;
}

async function getJwtToken(apiUrl: string, email: string, password: string): Promise<string> {
  const tokenUrl = `${apiUrl}/api-token-auth/`;
  console.log('[Senslinc] Authenticating to:', tokenUrl);
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[Senslinc] Auth failed:', response.status, text);
    throw new Error(`Authentication failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.token) {
    throw new Error('No token received from Senslinc');
  }
  
  console.log('[Senslinc] Authentication successful');
  return data.token;
}

async function senslincFetch(apiUrl: string, endpoint: string, token: string) {
  const url = `${apiUrl}${endpoint}`;
  console.log('[Senslinc] Fetching:', url);
  
  const response = await fetch(url, {
    headers: { 
      'Authorization': `JWT ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[Senslinc] Request failed:', response.status, text);
    throw new Error(`Senslinc API error: ${response.status}`);
  }

  return response.json();
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

  try {
    const { action, fmGuid, siteCode } = await req.json() as SenslincRequest;
    
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

    switch (action) {
      case 'test-connection': {
        try {
          const token = await getJwtToken(cleanApiUrl, email, password);
          // Try to fetch sites to verify connection works
          const sites = await senslincFetch(cleanApiUrl, '/api/sites', token);
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: `Anslutning lyckades! Hittade ${Array.isArray(sites) ? sites.length : 0} sites.`
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: error.message,
              message: 'Kunde inte ansluta till Senslinc. Kontrollera credentials.'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'get-equipment': {
        if (!fmGuid) {
          return new Response(
            JSON.stringify({ success: false, error: 'fmGuid required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          );
        }
        
        const token = await getJwtToken(cleanApiUrl, email, password);
        // Search machines by code (FM GUID)
        const machines = await senslincFetch(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, token);
        
        return new Response(
          JSON.stringify({ success: true, data: machines }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-site-equipment': {
        if (!siteCode) {
          return new Response(
            JSON.stringify({ success: false, error: 'siteCode required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          );
        }
        
        const token = await getJwtToken(cleanApiUrl, email, password);
        // Get all machines for a site
        const machines = await senslincFetch(cleanApiUrl, `/api/machines?site=${encodeURIComponent(siteCode)}`, token);
        
        return new Response(
          JSON.stringify({ success: true, data: machines }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-sites': {
        const token = await getJwtToken(cleanApiUrl, email, password);
        const sites = await senslincFetch(cleanApiUrl, '/api/sites', token);
        
        return new Response(
          JSON.stringify({ success: true, data: sites }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-lines': {
        const token = await getJwtToken(cleanApiUrl, email, password);
        const lines = await senslincFetch(cleanApiUrl, '/api/lines', token);
        
        return new Response(
          JSON.stringify({ success: true, data: lines }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-machines': {
        const token = await getJwtToken(cleanApiUrl, email, password);
        const machines = await senslincFetch(cleanApiUrl, '/api/machines', token);
        
        return new Response(
          JSON.stringify({ success: true, data: machines }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // New action: Get dashboard URL for a given FM GUID
      // Searches machines, sites, and lines to find matching entity
      case 'get-dashboard-url': {
        if (!fmGuid) {
          return new Response(
            JSON.stringify({ success: false, error: 'fmGuid required' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          );
        }
        
        const token = await getJwtToken(cleanApiUrl, email, password);
        
        // Try to find as machine first (rooms/assets)
        try {
          const machines = await senslincFetch(cleanApiUrl, `/api/machines?code=${encodeURIComponent(fmGuid)}`, token);
          if (Array.isArray(machines) && machines.length > 0) {
            const machine = machines[0];
            const dashboardUrl = machine.dashboard_url || buildDashboardUrl(cleanApiUrl, 'machine', machine.pk);
            return new Response(
              JSON.stringify({ 
                success: true, 
                data: { 
                  dashboardUrl, 
                  type: 'machine',
                  name: machine.name,
                  pk: machine.pk,
                  ...machine 
                } 
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (err) {
          console.log('[Senslinc] No machine found for fmGuid:', fmGuid);
        }
        
        // Try to find as site (buildings)
        try {
          const sites = await senslincFetch(cleanApiUrl, `/api/sites?code=${encodeURIComponent(fmGuid)}`, token);
          if (Array.isArray(sites) && sites.length > 0) {
            const site = sites[0];
            const dashboardUrl = site.dashboard_url || buildDashboardUrl(cleanApiUrl, 'site', site.pk);
            return new Response(
              JSON.stringify({ 
                success: true, 
                data: { 
                  dashboardUrl, 
                  type: 'site',
                  name: site.name,
                  pk: site.pk,
                  ...site 
                } 
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (err) {
          console.log('[Senslinc] No site found for fmGuid:', fmGuid);
        }
        
        // Try to find as line (floors/storeys)
        try {
          const lines = await senslincFetch(cleanApiUrl, `/api/lines?code=${encodeURIComponent(fmGuid)}`, token);
          if (Array.isArray(lines) && lines.length > 0) {
            const line = lines[0];
            const dashboardUrl = line.dashboard_url || buildDashboardUrl(cleanApiUrl, 'line', line.pk);
            return new Response(
              JSON.stringify({ 
                success: true, 
                data: { 
                  dashboardUrl, 
                  type: 'line',
                  name: line.name,
                  pk: line.pk,
                  ...line 
                } 
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (err) {
          console.log('[Senslinc] No line found for fmGuid:', fmGuid);
        }
        
        // Nothing found
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'No equipment found for this FM GUID',
            message: 'Ingen utrustning hittades i Senslinc för detta FM GUID.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
    }
  } catch (error: any) {
    console.error('[Senslinc] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
