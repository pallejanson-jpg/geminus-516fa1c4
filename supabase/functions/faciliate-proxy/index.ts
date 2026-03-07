import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

let cachedJwt: string | null = null;

function getBaseUrl(): string {
  const raw = Deno.env.get("SWG_SUPPORT_URL") || "";
  return raw.replace(/\/+$/, "");
}

async function loginAndGetJwt(): Promise<string> {
  const baseUrl = getBaseUrl();
  const username = Deno.env.get("SWG_SUPPORT_USERNAME");
  const password = Deno.env.get("SWG_SUPPORT_PASSWORD");

  if (!baseUrl || !username || !password) {
    throw new Error("SWG_SUPPORT_URL, SWG_SUPPORT_USERNAME, and SWG_SUPPORT_PASSWORD must be configured");
  }

  console.log(`[faciliate-proxy] Logging in as ${username}`);

  const res = await fetch(`${baseUrl}/api/v2/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[faciliate-proxy] Login failed: ${res.status} - ${text.substring(0, 300)}`);
    throw new Error(`Faciliate login failed: ${res.status}`);
  }

  const data = await res.json();
  const jwt = data.jwt || data.token || data.accessToken;

  if (!jwt) {
    // Some SWG versions return the token in a different field
    const possibleToken = typeof data === "string" ? data : null;
    if (possibleToken) {
      cachedJwt = possibleToken;
      return possibleToken;
    }
    console.error("[faciliate-proxy] Login response:", JSON.stringify(data).substring(0, 300));
    throw new Error("Login response did not contain a JWT");
  }

  cachedJwt = jwt;
  console.log("[faciliate-proxy] Login successful, JWT cached");
  return jwt;
}

async function getJwt(): Promise<string> {
  if (cachedJwt) return cachedJwt;
  return await loginAndGetJwt();
}

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
  retried = false
): Promise<Response> {
  const baseUrl = getBaseUrl();
  const jwt = await getJwt();
  const url = `${baseUrl}${path}`;

  console.log(`[faciliate-proxy] ${method} ${url}`);

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    jwt: jwt,
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Auto-retry on 401
  if (res.status === 401 && !retried) {
    console.log("[faciliate-proxy] JWT expired, re-authenticating...");
    cachedJwt = null;
    await loginAndGetJwt();
    return apiRequest(method, path, body, true);
  }

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
    const { action, objectType, guid, filter, sort, take, skip, loadlevel, payload } = await req.json();

    switch (action) {
      case "login": {
        const jwt = await loginAndGetJwt();
        return new Response(JSON.stringify({ ok: true, hasJwt: !!jwt }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "swagger": {
        return await apiRequest("GET", "/api/v2/system/swagger");
      }

      case "list": {
        if (!objectType) throw new Error("objectType required for list action");
        const params = new URLSearchParams();
        if (take) params.set("take", String(take));
        if (skip) params.set("skip", String(skip));
        if (filter) params.set("filter", typeof filter === "string" ? filter : JSON.stringify(filter));
        if (sort) params.set("sort", typeof sort === "string" ? sort : JSON.stringify(sort));
        if (loadlevel) params.set("loadlevel", loadlevel);
        const qs = params.toString();
        return await apiRequest("GET", `/api/v2/${objectType}${qs ? `?${qs}` : ""}`);
      }

      case "get": {
        if (!objectType || !guid) throw new Error("objectType and guid required for get action");
        const params = new URLSearchParams();
        if (loadlevel) params.set("loadlevel", loadlevel);
        const qs = params.toString();
        return await apiRequest("GET", `/api/v2/${objectType}/${guid}${qs ? `?${qs}` : ""}`);
      }

      case "create": {
        if (!objectType || !payload) throw new Error("objectType and payload required for create action");
        return await apiRequest("POST", `/api/v2/${objectType}`, payload);
      }

      case "update": {
        if (!objectType || !guid || !payload) throw new Error("objectType, guid and payload required for update action");
        return await apiRequest("PUT", `/api/v2/${objectType}/${guid}`, payload);
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (err) {
    console.error("[faciliate-proxy] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
