import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FmAccessConfig {
  tokenUrl: string;
  clientId: string;
  apiUrl: string;
  username?: string;
  password?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// Cache for token and version
let tokenCache: { token: string; expiresAt: number } | null = null;
let versionIdCache: { versionId: string; fetchedAt: number } | null = null;

/**
 * Get FM Access token using client_credentials grant
 */
async function getToken(config: FmAccessConfig): Promise<string> {
  // Check cache
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  console.log('FM Access: Fetching new token from', config.tokenUrl);

  // Build token request body
  let body = `grant_type=client_credentials&client_id=${encodeURIComponent(config.clientId)}`;
  
  // If username/password provided, use password grant instead
  if (config.username && config.password) {
    body = `grant_type=password&client_id=${encodeURIComponent(config.clientId)}&username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`;
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('FM Access token error:', response.status, errorText);
    throw new Error(`Token request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as TokenResponse;
  
  // Cache token (with 60 second buffer before expiry)
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  console.log('FM Access: Token obtained, expires in', data.expires_in, 'seconds');
  return data.access_token;
}

/**
 * Get FM Access system version ID (required header for most API calls)
 */
async function getVersionId(config: FmAccessConfig, token: string): Promise<string> {
  // Check cache (refresh every 5 minutes)
  if (versionIdCache && Date.now() - versionIdCache.fetchedAt < 5 * 60 * 1000) {
    return versionIdCache.versionId;
  }

  console.log('FM Access: Fetching version ID from', config.apiUrl);

  const response = await fetch(`${config.apiUrl}/api/version`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('FM Access version error:', response.status, errorText);
    throw new Error(`Version request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const versionId = data.versionId || data.id || data.version;

  if (!versionId) {
    console.error('FM Access: No version ID in response', data);
    throw new Error('No version ID returned from API');
  }

  versionIdCache = {
    versionId,
    fetchedAt: Date.now(),
  };

  console.log('FM Access: Version ID obtained:', versionId);
  return versionId;
}

/**
 * Make an authenticated FM Access API call
 */
async function fmAccessFetch(
  config: FmAccessConfig,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getToken(config);
  const versionId = await getVersionId(config, token);

  const url = `${config.apiUrl}${path}`;
  console.log('FM Access: Calling', url);

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'X-Hdc-Version-Id': versionId,
      'Content-Type': 'application/json',
    },
  });
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    // Get config from secrets
    const config: FmAccessConfig = {
      tokenUrl: Deno.env.get('FM_ACCESS_TOKEN_URL') || 'https://auth.bim.cloud/auth/realms/swg_demo/protocol/openid-connect/token',
      clientId: Deno.env.get('FM_ACCESS_CLIENT_ID') || 'HDCAgent Basic',
      apiUrl: Deno.env.get('FM_ACCESS_API_URL') || '',
      username: Deno.env.get('FM_ACCESS_USERNAME'),
      password: Deno.env.get('FM_ACCESS_PASSWORD'),
    };

    if (!config.apiUrl) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'FM_ACCESS_API_URL is not configured',
          message: 'Please configure FM Access API URL in Lovable Cloud secrets'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'test-connection': {
        try {
          const token = await getToken(config);
          const versionId = await getVersionId(config, token);
          
          return new Response(
            JSON.stringify({ 
              success: true, 
              message: `Connected successfully. Version ID: ${versionId}`,
              versionId,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: error.message,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'get-token': {
        try {
          const token = await getToken(config);
          const versionId = await getVersionId(config, token);
          
          return new Response(
            JSON.stringify({ 
              success: true,
              token,
              versionId,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'get-drawings': {
        const { buildingId } = params;
        if (!buildingId) {
          return new Response(
            JSON.stringify({ success: false, error: 'buildingId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fmAccessFetch(config, `/api/drawings?buildingId=${encodeURIComponent(buildingId)}`);
        const data = await response.json();
        
        return new Response(
          JSON.stringify({ success: response.ok, data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-documents': {
        const { buildingId } = params;
        if (!buildingId) {
          return new Response(
            JSON.stringify({ success: false, error: 'buildingId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fmAccessFetch(config, `/api/documents?buildingId=${encodeURIComponent(buildingId)}`);
        const data = await response.json();
        
        return new Response(
          JSON.stringify({ success: response.ok, data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-document': {
        const { documentId } = params;
        if (!documentId) {
          return new Response(
            JSON.stringify({ success: false, error: 'documentId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fmAccessFetch(config, `/api/documents/${encodeURIComponent(documentId)}`);
        const data = await response.json();
        
        return new Response(
          JSON.stringify({ success: response.ok, data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-drawing-pdf': {
        const { drawingId } = params;
        if (!drawingId) {
          return new Response(
            JSON.stringify({ success: false, error: 'drawingId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Return the URL to fetch the PDF directly
        const token = await getToken(config);
        const versionId = await getVersionId(config, token);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            url: `${config.apiUrl}/api/drawings/${encodeURIComponent(drawingId)}/pdf`,
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Hdc-Version-Id': versionId,
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-viewer-url': {
        const { buildingId, floorId } = params;
        try {
          const token = await getToken(config);
          const versionId = await getVersionId(config, token);
          
          // Build viewer URL with authentication parameters
          // NOTE: Exact URL structure may need adjustment after testing against FM Access API
          const viewerUrl = `${config.apiUrl}/viewer/2d?floorId=${encodeURIComponent(floorId || '')}&token=${encodeURIComponent(token)}&versionId=${encodeURIComponent(versionId)}`;
          
          return new Response(
            JSON.stringify({ success: true, url: viewerUrl, token, versionId }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'get-floors': {
        const { buildingFmGuid } = params;
        if (!buildingFmGuid) {
          return new Response(
            JSON.stringify({ success: false, error: 'buildingFmGuid is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fmAccessFetch(config, `/api/floors?buildingId=${encodeURIComponent(buildingFmGuid)}`);
        const data = await response.json();
        
        return new Response(
          JSON.stringify({ success: response.ok, data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: any) {
    console.error('FM Access query error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
