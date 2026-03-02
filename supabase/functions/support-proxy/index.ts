import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// In-memory JWT cache (per cold-start)
let cachedJwt: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 9 * 60 * 60 * 1000; // 9 hours (JWT has ~10h TTL)

async function login(): Promise<string> {
  if (cachedJwt && Date.now() - cacheTime < CACHE_TTL) {
    return cachedJwt;
  }

  const baseUrl = Deno.env.get("SWG_SUPPORT_URL")!;
  const email = Deno.env.get("SWG_SUPPORT_USERNAME")!;
  const password = Deno.env.get("SWG_SUPPORT_PASSWORD")!;

  const res = await fetch(`${baseUrl}/api/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed (${res.status}): ${text}`);
  }

  // The JWT may come as a response header or in the body
  const jwt = res.headers.get("jwt") || res.headers.get("token");
  
  let bodyJwt: string | null = null;
  try {
    const body = await res.json();
    bodyJwt = body?.jwt || body?.token || body?.Token || body?.access_token || body?.accessToken || null;
    // If the entire body is a string that looks like a JWT
    if (!bodyJwt && typeof body === "string" && body.includes(".")) {
      bodyJwt = body;
    }
  } catch {
    const text = await res.text();
    // If the response is a plain JWT string
    if (text && text.includes(".") && !text.includes("<")) {
      bodyJwt = text.trim();
    }
  }

  const token = jwt || bodyJwt;
  if (!token) {
    throw new Error("Login succeeded but no JWT token found in response");
  }

  cachedJwt = token;
  cacheTime = Date.now();
  return token;
}

async function proxyRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const baseUrl = Deno.env.get("SWG_SUPPORT_URL")!;
  const jwt = await login();

  const url = `${baseUrl}${path}`;
  console.log(`Proxying ${method} ${url}`);

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      jwt: jwt,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") || "";
  let data: unknown;
  if (contentType.includes("json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return new Response(JSON.stringify({ status: res.status, data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, filter, requestId, payload } = await req.json();

    switch (action) {
      case "test-login": {
        const jwt = await login();
        return new Response(JSON.stringify({
          ok: true,
          hasJwt: !!jwt,
          jwtLength: jwt.length,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "list-requests": {
        const defaultFilter = {
          excludeDetails: false,
          includeDescription: false,
          searchShow: {
            showNew: true, showUnderReview: true, showAwaitingResponse: true,
            showAwaitingOrder: true, showPlanned: true, showInProgress: true,
            showDone: true, showCompleted: true, showClosed: true,
          },
        };
        const filterStr = encodeURIComponent(JSON.stringify(filter || defaultFilter));
        return await proxyRequest("GET", `/api/requests?filter=${filterStr}`);
      }

      case "get-request": {
        if (!requestId) throw new Error("requestId required");
        return await proxyRequest("GET", `/api/requests/${requestId}`);
      }

      case "create-request": {
        if (!payload) throw new Error("payload required");
        return await proxyRequest("POST", "/api/requests", payload);
      }

      case "add-comment": {
        if (!requestId || !payload) throw new Error("requestId and payload required");
        return await proxyRequest("POST", `/api/requests/${requestId}/comments`, payload);
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    console.error("support-proxy error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
