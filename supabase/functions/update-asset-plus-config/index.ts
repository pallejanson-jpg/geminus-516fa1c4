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
    const { action, config } = await req.json();

    if (action === "update-config") {
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
      if (config.audience !== undefined && config.audience !== "") {
        secretsToUpdate.push("ASSET_PLUS_AUDIENCE");
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "Configuration needs to be updated via Lovable secrets.",
          secretsToUpdate,
          instructions: "Use Lovable to update the following secrets: " + secretsToUpdate.join(", "),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "test-connection") {
      const keycloakUrl = Deno.env.get("ASSET_PLUS_KEYCLOAK_URL");
      const clientId = Deno.env.get("ASSET_PLUS_CLIENT_ID");
      const clientSecret = Deno.env.get("ASSET_PLUS_CLIENT_SECRET");
      const username = Deno.env.get("ASSET_PLUS_USERNAME");
      const password = Deno.env.get("ASSET_PLUS_PASSWORD");
      const audience = Deno.env.get("ASSET_PLUS_AUDIENCE") || "asset-api";

      if (!keycloakUrl || !clientId) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Missing configuration. At minimum ASSET_PLUS_KEYCLOAK_URL and ASSET_PLUS_CLIENT_ID are required.",
            configured: {
              keycloakUrl: !!keycloakUrl,
              clientId: !!clientId,
              clientSecret: !!clientSecret,
              username: !!username,
              password: !!password,
              audience: !!audience,
            },
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Build token URL
      const tokenUrl = keycloakUrl.endsWith("/protocol/openid-connect/token")
        ? keycloakUrl
        : `${keycloakUrl.replace(/\/+$/, "")}/protocol/openid-connect/token`;

      console.log(`Testing connection to: ${tokenUrl}`);
      console.log(`Client ID: ${clientId}`);
      console.log(`Audience: ${audience}`);

      // Try client_credentials flow first (as shown in screenshot)
      const credParams = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        audience: audience,
      });
      
      if (clientSecret) {
        credParams.set("client_secret", clientSecret);
      }

      console.log("Trying client_credentials flow with audience...");
      let tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: credParams.toString(),
      });

      let responseText = await tokenResponse.text();
      console.log(`Response status: ${tokenResponse.status}`);

      // If client_credentials fails and we have username/password, try password grant
      if (!tokenResponse.ok && username && password) {
        console.log("client_credentials failed, trying password grant...");
        
        const passwordParams = new URLSearchParams({
          grant_type: "password",
          client_id: clientId,
          username: username,
          password: password,
        });
        
        if (clientSecret) {
          passwordParams.set("client_secret", clientSecret);
        }
        if (audience) {
          passwordParams.set("audience", audience);
        }

        tokenResponse = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: passwordParams.toString(),
        });

        responseText = await tokenResponse.text();
        console.log(`Password grant response: ${tokenResponse.status}`);
      }

      console.log(`Final response: ${responseText}`);

      if (!tokenResponse.ok) {
        let errorDetail = responseText;
        try {
          const parsed = JSON.parse(responseText);
          errorDetail = parsed.error_description || parsed.error || responseText;
        } catch {}

        return new Response(
          JSON.stringify({
            success: false,
            error: `Keycloak authentication failed: ${errorDetail}`,
            status: tokenResponse.status,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenData = JSON.parse(responseText);
      
      return new Response(
        JSON.stringify({
          success: true,
          message: "Connection successful! Token received.",
          tokenType: tokenData.token_type,
          expiresIn: tokenData.expires_in,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get-config") {
      return new Response(
        JSON.stringify({
          success: true,
          config: {
            keycloakUrl: Deno.env.get("ASSET_PLUS_KEYCLOAK_URL") || "",
            apiUrl: Deno.env.get("ASSET_PLUS_API_URL") || "",
            clientId: Deno.env.get("ASSET_PLUS_CLIENT_ID") || "",
            username: Deno.env.get("ASSET_PLUS_USERNAME") || "",
            audience: Deno.env.get("ASSET_PLUS_AUDIENCE") || "asset-api",
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
