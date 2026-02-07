/**
 * CORS Proxy for NavVis IVION SDK
 * 
 * Proxies requests to the NavVis Ivion instance (e.g., ivion.js and related assets)
 * so the frontend can load the SDK without CORS restrictions from the NavVis server.
 * 
 * Usage:
 *   GET /ivion-proxy?url=https://swg.iv.navvis.com/ivion.js
 *   GET /ivion-proxy/ivion.js  (uses default base URL from secrets)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

// Allowed origins to proxy (security: prevent open relay)
const ALLOWED_ORIGINS = [
  'swg.iv.navvis.com',
];

function isAllowedOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_ORIGINS.some(origin => parsed.hostname === origin || parsed.hostname.endsWith(`.${origin}`));
  } catch {
    return false;
  }
}

// Content-type mapping for common file extensions
function inferContentType(path: string, upstreamContentType?: string | null): string {
  if (upstreamContentType && !upstreamContentType.includes('text/plain')) {
    return upstreamContentType;
  }
  
  const ext = path.split('?')[0].split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    'js': 'application/javascript',
    'mjs': 'application/javascript',
    'css': 'text/css',
    'html': 'text/html',
    'json': 'application/json',
    'wasm': 'application/wasm',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'svg': 'image/svg+xml',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'map': 'application/json',
  };
  
  return map[ext || ''] || upstreamContentType || 'application/octet-stream';
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Only GET requests are supported' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const requestUrl = new URL(req.url);
    
    // Determine target URL
    let targetUrl: string;
    
    // Option 1: Full URL in ?url= query param
    const urlParam = requestUrl.searchParams.get('url');
    if (urlParam) {
      targetUrl = urlParam;
    } else {
      // Option 2: Path-based — proxy path after /ivion-proxy/
      const ivionBaseUrl = Deno.env.get('IVION_API_URL') || 'https://swg.iv.navvis.com';
      
      // Extract the path after the function name
      const pathMatch = requestUrl.pathname.match(/\/ivion-proxy\/(.*)/);
      const assetPath = pathMatch?.[1] || 'ivion.js';
      
      targetUrl = `${ivionBaseUrl.replace(/\/$/, '')}/${assetPath}`;
      
      // Preserve query params (except internal ones)
      const forwardParams = new URLSearchParams();
      requestUrl.searchParams.forEach((value, key) => {
        if (key !== 'url') {
          forwardParams.set(key, value);
        }
      });
      const qs = forwardParams.toString();
      if (qs) {
        targetUrl += `?${qs}`;
      }
    }

    // Security check
    if (!isAllowedOrigin(targetUrl)) {
      return new Response(JSON.stringify({ error: 'Target URL not in allowlist' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[ivion-proxy] Fetching: ${targetUrl}`);

    // Fetch from upstream
    const upstreamResponse = await fetch(targetUrl, {
      headers: {
        'Accept': req.headers.get('Accept') || '*/*',
        'Accept-Encoding': 'identity', // Don't compress — we'll pass through raw
      },
    });

    if (!upstreamResponse.ok) {
      console.error(`[ivion-proxy] Upstream returned ${upstreamResponse.status}`);
      return new Response(
        JSON.stringify({ error: `Upstream returned ${upstreamResponse.status}` }),
        {
          status: upstreamResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const contentType = inferContentType(targetUrl, upstreamResponse.headers.get('content-type'));
    const body = await upstreamResponse.arrayBuffer();

    // For JavaScript files, we need to rewrite absolute URLs to also go through our proxy
    if (contentType === 'application/javascript') {
      const text = new TextDecoder().decode(body);
      // No URL rewriting needed for now — the SDK uses relative URLs internally
      
      return new Response(text, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        },
      });
    }

    return new Response(body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[ivion-proxy] Error:', err);
    return new Response(
      JSON.stringify({ error: 'Proxy error', details: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
