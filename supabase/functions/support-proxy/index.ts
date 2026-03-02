import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// In-memory JWT cache (per cold-start)
let cachedJwt: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 9 * 60 * 60 * 1000; // 9 hours

async function login(): Promise<string> {
  if (cachedJwt && Date.now() - cacheTime < CACHE_TTL) {
    return cachedJwt;
  }

  const rawUrl = Deno.env.get("SWG_SUPPORT_URL") || "";
  const baseUrl = rawUrl.replace(/\/+$/, "");
  const email = Deno.env.get("SWG_SUPPORT_USERNAME") || "";
  const password = Deno.env.get("SWG_SUPPORT_PASSWORD") || "";

  console.log(`SWG login: baseUrl="${baseUrl}", email="${email}", password length=${password.length}`);

  // Try different body formats on /api/users/login
  const loginUrl = `${baseUrl}/api/users/login`;
  const bodyFormats = [
    { email, password },
    { Email: email, Password: password },
    { username: email, password },
    { UserName: email, Password: password },
  ];

  let lastError = "";
  for (const body of bodyFormats) {
    console.log(`Trying login at: ${loginUrl} with body keys: ${Object.keys(body).join(", ")}`);
    try {
      const res = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });

      console.log(`Login response: status=${res.status}, keys=${Object.keys(body).join(",")}`);

      if (res.status === 401) {
        lastError = `keys ${Object.keys(body).join(",")} returned 401`;
        continue;
      }

      const text = await res.text();
      console.log(`Login response body (first 500 chars): ${text.substring(0, 500)}`);

      if (!res.ok) {
        lastError = `keys ${Object.keys(body).join(",")} returned ${res.status}: ${text.substring(0, 200)}`;
        continue;
      }

      // Try to extract JWT from response
      const headerJwt = res.headers.get("jwt") || res.headers.get("token");
      
      let bodyJwt: string | null = null;
      try {
        const parsed = JSON.parse(text);
        bodyJwt = parsed?.jwt || parsed?.token || parsed?.Token || parsed?.access_token || parsed?.accessToken || null;
        if (!bodyJwt && typeof parsed === "string" && parsed.includes(".")) {
          bodyJwt = parsed;
        }
      } catch {
        if (text && text.includes(".") && !text.includes("<")) {
          bodyJwt = text.trim();
        }
      }

      const token = headerJwt || bodyJwt;
      if (!token) {
        lastError = `keys ${Object.keys(body).join(",")} succeeded but no JWT found. Response headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()))}. Body: ${text.substring(0, 300)}`;
        continue;
      }

      console.log(`Login successful, JWT length=${token.length}`);
      cachedJwt = token;
      cacheTime = Date.now();
      return token;
    } catch (err) {
      lastError = `fetch error: ${err}`;
      console.error(lastError);
    }
  }

  throw new Error(`All login attempts failed. Last error: ${lastError}`);
}

async function proxyRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const rawUrl = Deno.env.get("SWG_SUPPORT_URL") || "";
  const baseUrl = rawUrl.replace(/\/+$/, "");
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
