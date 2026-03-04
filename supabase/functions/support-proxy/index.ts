import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

let cachedJwt: string | null = null;

function getStoredJwt(): string | null {
  return cachedJwt || Deno.env.get("SWG_SUPPORT_JWT") || null;
}

async function loginAndGetJwt(): Promise<string> {
  const baseUrl = (Deno.env.get("SWG_SUPPORT_URL") || "").replace(/\/+$/, "");
  const username = Deno.env.get("SWG_SUPPORT_USERNAME");
  const password = Deno.env.get("SWG_SUPPORT_PASSWORD");

  if (!baseUrl || !username || !password) {
    throw new Error("SWG_SUPPORT_URL, SWG_SUPPORT_USERNAME, and SWG_SUPPORT_PASSWORD must be configured");
  }

  console.log(`Attempting auto-login to SWG as ${username}`);

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!loginRes.ok) {
    const text = await loginRes.text();
    console.error(`SWG login failed: ${loginRes.status} - ${text.substring(0, 300)}`);
    throw new Error(`SWG login failed: ${loginRes.status}`);
  }

  const loginData = await loginRes.json();
  const jwt = loginData.jwt || loginData.token || loginData.accessToken;

  if (!jwt) {
    console.error("SWG login response did not contain a JWT:", JSON.stringify(loginData).substring(0, 300));
    throw new Error("SWG login response did not contain a JWT");
  }

  cachedJwt = jwt;
  console.log("SWG auto-login successful, JWT cached");
  return jwt;
}

async function getJwt(): Promise<string> {
  const stored = getStoredJwt();
  if (stored) return stored;
  return await loginAndGetJwt();
}

async function proxyRequest(method: string, path: string, body?: unknown, retried = false): Promise<Response> {
  const rawUrl = Deno.env.get("SWG_SUPPORT_URL") || "";
  const baseUrl = rawUrl.replace(/\/+$/, "");
  const jwt = await getJwt();

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

  // If 401, try auto-login once
  if (res.status === 401 && !retried) {
    console.log("JWT expired, attempting auto-login...");
    try {
      cachedJwt = null; // Clear cached JWT
      await loginAndGetJwt();
      // Retry the request with new JWT
      return proxyRequest(method, path, body, true);
    } catch (loginErr) {
      console.error("Auto-login failed:", loginErr);
      return new Response(JSON.stringify({
        error: "jwt_expired",
        message: "SWG JWT har gått ut och automatisk inloggning misslyckades. Kontrollera SWG_SUPPORT_USERNAME och SWG_SUPPORT_PASSWORD.",
      }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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
    const { action, filter, requestId, payload } = await req.json();

    switch (action) {
      case "test-login": {
        const jwt = await getJwt();
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
