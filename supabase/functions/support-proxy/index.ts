import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function getJwt(): string {
  const jwt = Deno.env.get("SWG_SUPPORT_JWT");
  if (!jwt) {
    throw new Error("SWG_SUPPORT_JWT secret is not configured");
  }
  return jwt;
}

async function proxyRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const rawUrl = Deno.env.get("SWG_SUPPORT_URL") || "";
  const baseUrl = rawUrl.replace(/\/+$/, "");
  const jwt = getJwt();

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

  // If 401, the JWT has likely expired
  if (res.status === 401) {
    const text = await res.text();
    console.error(`JWT expired or invalid. Response: ${text.substring(0, 300)}`);
    return new Response(JSON.stringify({
      error: "jwt_expired",
      message: "SWG JWT har gått ut. Logga in manuellt på supportportalen och uppdatera SWG_SUPPORT_JWT i backend secrets.",
    }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
        const jwt = getJwt();
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
