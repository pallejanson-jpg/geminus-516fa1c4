import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const BASE_URL = "https://er-rep.com";
const API_BASE = "/api/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, qrKey, payload } = await req.json();

    if (!qrKey) {
      return new Response(
        JSON.stringify({ error: "qrKey is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const encodedKey = encodeURIComponent(qrKey);

    if (action === "get-config") {
      // Fetch error codes and config in parallel
      const [ecResponse, ecfResponse] = await Promise.all([
        fetch(`${BASE_URL}${API_BASE}/dataregisters/workorderReportedErrorCause/${encodedKey}`, {
          method: "GET",
          headers: { "Accept": "application/json" },
        }),
        fetch(`${BASE_URL}${API_BASE}/errorconfig/${encodedKey}`, {
          method: "GET",
          headers: { "Accept": "application/json" },
        }),
      ]);

      console.log(`[errorreport-proxy] errorCodes status: ${ecResponse.status}, errorconfig status: ${ecfResponse.status}`);

      if (ecResponse.status >= 400 && ecfResponse.status >= 400) {
        return new Response(
          JSON.stringify({ error: "Kunde inte hitta installationen.", statusCodes: { errorCodes: ecResponse.status, errorconfig: ecfResponse.status } }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const ecData = await ecResponse.json().catch(() => null);
      const ecfData = await ecfResponse.json().catch(() => null);

      // Parse error codes from dataregisters response
      const errorCodes: any[] = [];
      const ecItems = ecData?.data || (Array.isArray(ecData) ? ecData : []);
      for (const ec of ecItems) {
        errorCodes.push({
          guid: ec.guid ?? 0,
          id: ec.id ?? '',
          title: ec.title ?? ec.id ?? '',
          description: ec.description ?? '',
          context: ec.context ?? null,
        });
      }

      // Parse config metadata from errorconfig response
      const configItem = ecfData?.data?.[0] || ecfData?.[0] || {};
      const meta = configItem.metaData || {};
      const customerInfo = configItem.customerInfo || {};

      const result = {
        articleNumber: meta.businessItemID || null,
        articleName: meta.businessItemTitle || null,
        installationNumber: meta.businessItemID || null,
        assetName: meta.businessItemTitle || null,
        metaKey: meta.metaKey || null,
        context: meta.context || null,
        customDisplayInfo: meta.customDisplayInfo || null,
        logoData: customerInfo.logoData || null,
        configuration: customerInfo.configuration || null,
        errorCodes,
      };

      console.log(`[errorreport-proxy] Parsed: ${result.installationNumber} / ${result.assetName}, ${errorCodes.length} error codes`);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "submit") {
      if (!payload) {
        return new Response(
          JSON.stringify({ error: "payload is required for submit action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const apiUrl = `${BASE_URL}${API_BASE}/errorreport/register/${encodedKey}`;
      console.log(`[errorreport-proxy] PUT submit to: ${apiUrl}`);
      console.log(`[errorreport-proxy] PUT payload keys: ${Object.keys(payload).join(', ')}`);

      const response = await fetch(apiUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.text();
      console.log(`[errorreport-proxy] PUT response status: ${response.status}`);
      console.log(`[errorreport-proxy] PUT response body: ${data.substring(0, 500)}`);

      return new Response(data, {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Use "get-config" or "submit".` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[errorreport-proxy] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
