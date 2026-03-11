/**
 * Per-building credential resolver.
 * Checks building_settings for overrides, falls back to global env vars.
 */

export interface AssetPlusCredentials {
  apiUrl: string;
  apiKey: string;
  keycloakUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface SenslincCredentials {
  apiUrl: string;
  email: string;
  password: string;
}

export async function getAssetPlusCredentials(
  supabase: any,
  buildingFmGuid?: string | null
): Promise<AssetPlusCredentials> {
  if (buildingFmGuid) {
    const { data } = await supabase
      .from('building_settings')
      .select('assetplus_api_url, assetplus_api_key, assetplus_keycloak_url, assetplus_client_id, assetplus_client_secret, assetplus_username, assetplus_password')
      .eq('fm_guid', buildingFmGuid)
      .maybeSingle();

    if (data?.assetplus_api_url) {
      return {
        apiUrl: data.assetplus_api_url,
        apiKey: data.assetplus_api_key || '',
        keycloakUrl: data.assetplus_keycloak_url || '',
        clientId: data.assetplus_client_id || '',
        clientSecret: data.assetplus_client_secret || '',
        username: data.assetplus_username || '',
        password: data.assetplus_password || '',
      };
    }
  }

  return {
    apiUrl: Deno.env.get('ASSET_PLUS_API_URL') || '',
    apiKey: Deno.env.get('ASSET_PLUS_API_KEY') || '',
    keycloakUrl: Deno.env.get('ASSET_PLUS_KEYCLOAK_URL') || '',
    clientId: Deno.env.get('ASSET_PLUS_CLIENT_ID') || '',
    clientSecret: Deno.env.get('ASSET_PLUS_CLIENT_SECRET') || '',
    username: Deno.env.get('ASSET_PLUS_USERNAME') || '',
    password: Deno.env.get('ASSET_PLUS_PASSWORD') || '',
  };
}

export async function getSenslincCredentials(
  supabase: any,
  buildingFmGuid?: string | null
): Promise<SenslincCredentials> {
  if (buildingFmGuid) {
    const { data } = await supabase
      .from('building_settings')
      .select('senslinc_api_url, senslinc_email, senslinc_password')
      .eq('fm_guid', buildingFmGuid)
      .maybeSingle();

    if (data?.senslinc_api_url) {
      return {
        apiUrl: data.senslinc_api_url,
        email: data.senslinc_email || '',
        password: data.senslinc_password || '',
      };
    }
  }

  return {
    apiUrl: Deno.env.get('SENSLINC_API_URL') || '',
    email: Deno.env.get('SENSLINC_EMAIL') || '',
    password: Deno.env.get('SENSLINC_PASSWORD') || '',
  };
}
