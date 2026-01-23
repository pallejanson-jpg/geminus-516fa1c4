import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action } = await req.json();

    if (action === "test-connection") {
      // Test the current Keycloak configuration
      const keycloakUrl = Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
      const clientId = Deno.env.get("ASSET_PLUS_CLIENT_ID");
      const clientSecret = Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
      const username = Deno.env.get("ASSET_PLUS_USERNAME");
      const password = Deno.env.get("ASSET_PLUS_PASSWORD");

      if (!keycloakUrl || !clientId || !username || !password) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Saknar konfiguration. Alla fält måste fyllas i.",
            configured: {
              keycloakUrl: !!keycloakUrl,
              clientId: !!clientId,
              clientSecret: !!clientSecret,
              username: !!username,
              password: !!password,
            },
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Try to get a token from Keycloak
      const tokenParams = new URLSearchParams({
        grant_type: "password",
        client_id: clientId,
        username: username,
        password: password,
      });
      
      if (clientSecret) {
        tokenParams.set("client_secret", clientSecret);
      }

      console.log(`Testing connection to: ${keycloakUrl}`);
      console.log(`Client ID: ${clientId}`);
      console.log(`Username: ${username}`);

      const tokenResponse = await fetch(keycloakUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenParams.toString(),
      });

      const responseText = await tokenResponse.text();
      console.log(`Keycloak response status: ${tokenResponse.status}`);
      console.log(`Keycloak response: ${responseText}`);

      if (!tokenResponse.ok) {
        let errorDetail = responseText;
        try {
          const parsed = JSON.parse(responseText);
          errorDetail = parsed.error_description || parsed.error || responseText;
        } catch {}

        return new Response(
          JSON.stringify({
            success: false,
            error: `Keycloak-autentisering misslyckades: ${errorDetail}`,
            status: tokenResponse.status,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenData = JSON.parse(responseText);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: "Anslutning lyckades! Token mottagen.",
          tokenType: tokenData.token_type,
          expiresIn: tokenData.expires_in,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get-config") {
      // Return current configuration (without sensitive values)
      return new Response(
        JSON.stringify({
          success: true,
          config: {
            keycloakUrl: Deno.env.get("ASSET_PLUS_KEYCLOAK_URL") || "",
            apiUrl: Deno.env.get("ASSET_PLUS_API_URL") || "",
            clientId: Deno.env.get("ASSET_PLUS_CLIENT_ID") || "",
            username: Deno.env.get("ASSET_PLUS_USERNAME") || "",
            // Don't expose secrets
            hasClientSecret: !!Deno.env.get("ASSET_PLUS_CLIENT_SECRET"),
            hasPassword: !!Deno.env.get("ASSET_PLUS_PASSWORD"),
            hasApiKey: !!Deno.env.get("ASSET_PLUS_API_KEY"),
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
