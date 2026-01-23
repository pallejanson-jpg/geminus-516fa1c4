import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, config } = await req.json();

    if (action === "update-config") {
      // Update secrets via Supabase Management API
      // For now, we'll store non-secret config in a settings table
      // and inform the user about which secrets need updating via Lovable
      
      const updates: string[] = [];
      const secretsToUpdate: string[] = [];

      if (config.keycloakUrl !== undefined && config.keycloakUrl !== "") {
        secretsToUpdate.push("ASSET_PLUS_KEYCLOAK_URL");
      }
      if (config.apiUrl !== undefined && config.apiUrl !== "") {
        secretsToUpdate.push("ASSET_PLUS_API_URL");
      }
      if (config.clientId !== undefined && config.clientId !== "") {
        secretsToUpdate.push("ASSET_PLUS_CLIENT_ID");
      }
      if (config.clientSecret !== undefined && config.clientSecret !== "" && !config.clientSecret.includes("•")) {
        secretsToUpdate.push("ASSET_PLUS_CLIENT_SECRET");
      }
      if (config.username !== undefined && config.username !== "") {
        secretsToUpdate.push("ASSET_PLUS_USERNAME");
      }
      if (config.password !== undefined && config.password !== "" && !config.password.includes("•")) {
        secretsToUpdate.push("ASSET_PLUS_PASSWORD");
      }
      if (config.apiKey !== undefined && config.apiKey !== "" && !config.apiKey.includes("•")) {
        secretsToUpdate.push("ASSET_PLUS_API_KEY");
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Konfigurationen behöver uppdateras via Lovable secrets.",
          secretsToUpdate,
          instructions: "Använd Lovable för att uppdatera följande secrets: " + secretsToUpdate.join(", "),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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