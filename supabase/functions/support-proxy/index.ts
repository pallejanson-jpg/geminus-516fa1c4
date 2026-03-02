import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// In-memory token cache (per cold-start)
let cachedCookies: string | null = null;
let cachedRealm: string | null = null;
let cachedExpression: string | null = null;
let cacheTime = 0;
const CACHE_TTL = 25 * 60 * 1000; // 25 min

async function tryEndpoint(
  baseUrl: string,
  endpoint: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<Record<string, unknown>> {
  try {
    const url = `${baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers,
      body,
      redirect: "manual",
    });

    const setCookieHeaders = res.headers.getSetCookie?.() || [];
    let resBody: unknown = null;
    try { resBody = await res.json(); } catch { try { resBody = await res.text(); } catch { resBody = null; } }

    return {
      endpoint,
      status: res.status,
      setCookieHeaders,
      realm: res.headers.get("realm"),
      expression: res.headers.get("expression"),
      authorization: res.headers.get("authorization"),
      location: res.headers.get("location"),
      contentType: res.headers.get("content-type"),
      body: resBody,
      allHeaders: Object.fromEntries(res.headers.entries()),
    };
  } catch (err) {
    return { endpoint, error: String(err) };
  }
}

async function login(): Promise<{
  cookies: string;
  realm: string;
  expression: string;
}> {
  if (
    cachedCookies &&
    cachedRealm &&
    cachedExpression &&
    Date.now() - cacheTime < CACHE_TTL
  ) {
    return { cookies: cachedCookies, realm: cachedRealm, expression: cachedExpression };
  }

  const baseUrl = Deno.env.get("SWG_SUPPORT_URL")!;
  const username = Deno.env.get("SWG_SUPPORT_USERNAME")!;
  const password = Deno.env.get("SWG_SUPPORT_PASSWORD")!;

  const jsonBody = JSON.stringify({ username, password, email: username });
  const formBody = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const jsonHeaders = { "Content-Type": "application/json", Accept: "application/json" };
  const formHeaders = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };

  // Expanded list of endpoints to try
  const attempts = [
    { endpoint: "/api/users/login", method: "POST", headers: jsonHeaders, body: jsonBody },
    { endpoint: "/api/users/authenticate", method: "POST", headers: jsonHeaders, body: jsonBody },
    { endpoint: "/api/authenticate", method: "POST", headers: jsonHeaders, body: jsonBody },
    { endpoint: "/api/token", method: "POST", headers: formHeaders, body: formBody },
    { endpoint: "/api/auth/token", method: "POST", headers: jsonHeaders, body: jsonBody },
    { endpoint: "/api/session", method: "POST", headers: jsonHeaders, body: jsonBody },
    { endpoint: "/api/auth/login", method: "POST", headers: jsonHeaders, body: jsonBody },
    { endpoint: "/api/login", method: "POST", headers: jsonHeaders, body: jsonBody },
    { endpoint: "/api/account/login", method: "POST", headers: jsonHeaders, body: jsonBody },
    { endpoint: "/api/auth", method: "POST", headers: jsonHeaders, body: jsonBody },
    // Also try with email field name
    { endpoint: "/api/users/login", method: "POST", headers: jsonHeaders, body: JSON.stringify({ email: username, password }) },
    { endpoint: "/api/authenticate", method: "POST", headers: jsonHeaders, body: JSON.stringify({ email: username, password }) },
    // Form variants
    { endpoint: "/api/users/login", method: "POST", headers: formHeaders, body: formBody },
    { endpoint: "/api/authenticate", method: "POST", headers: formHeaders, body: formBody },
    { endpoint: "/api/users/authenticate", method: "POST", headers: formHeaders, body: formBody },
    // email form
    { endpoint: "/api/users/login", method: "POST", headers: formHeaders, body: `email=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}` },
  ];

  const results: Record<string, unknown>[] = [];

  for (const attempt of attempts) {
    const result = await tryEndpoint(baseUrl, attempt.endpoint, attempt.method, attempt.headers, attempt.body);
    results.push(result);
    console.log(`Login attempt ${attempt.endpoint}:`, JSON.stringify(result));

    const status = result.status as number;
    if (status >= 200 && status < 400 && status !== 404) {
      const setCookieHeaders = (result.setCookieHeaders as string[]) || [];
      const cookies = setCookieHeaders.map((c: string) => c.split(";")[0]).join("; ");
      const bodyObj = typeof result.body === "object" && result.body !== null ? result.body as Record<string, unknown> : {};
      
      const realm = (result.realm as string) || (bodyObj.realm as string) || (bodyObj.Realm as string) || "";
      const expression = (result.expression as string) || (bodyObj.expression as string) || (bodyObj.Expression as string) || (bodyObj.token as string) || (bodyObj.Token as string) || (bodyObj.access_token as string) || (bodyObj.accessToken as string) || "";

      if (cookies || realm || expression) {
        cachedCookies = cookies;
        cachedRealm = realm;
        cachedExpression = expression;
        cacheTime = Date.now();
        return { cookies, realm, expression };
      }
    }
  }

  throw new Error(`Could not authenticate. Results: ${JSON.stringify(results)}`);
}

async function proxyRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const baseUrl = Deno.env.get("SWG_SUPPORT_URL")!;
  const { cookies, realm, expression } = await login();

  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (cookies) headers["Cookie"] = cookies;
  if (realm) headers["realm"] = realm;
  if (expression) headers["Expression"] = expression;

  const url = `${baseUrl}${path}`;
  console.log(`Proxying ${method} ${url}`);

  const res = await fetch(url, {
    method,
    headers,
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
        const result = await login();
        return new Response(JSON.stringify({
          ok: true,
          hasCookies: !!result.cookies,
          hasRealm: !!result.realm,
          hasExpression: !!result.expression,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      case "discover-endpoints": {
        // Discovery mode: try many endpoints and return all results
        const baseUrl = Deno.env.get("SWG_SUPPORT_URL")!;
        const discoveryPaths = [
          "/api", "/api/", "/api/users", "/api/users/login", "/api/authenticate",
          "/api/token", "/api/auth", "/api/auth/login", "/api/login",
          "/api/account", "/api/account/login", "/api/session",
          "/api/requests", "/api/swagger", "/api/swagger.json",
          "/api/health", "/api/version", "/api/info",
        ];
        const results: Record<string, unknown>[] = [];
        for (const path of discoveryPaths) {
          const r = await tryEndpoint(baseUrl, path, "GET", { Accept: "application/json" });
          results.push(r);
        }
        return new Response(JSON.stringify({ results }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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
