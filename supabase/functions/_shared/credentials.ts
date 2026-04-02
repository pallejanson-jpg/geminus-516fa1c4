/**
 * Per-building credential resolver.
 * Checks building_settings.api_profile_id → api_profiles first,
 * then falls back to per-building overrides, then global env vars.
 */

export interface AssetPlusCredentials {
  apiUrl: string;
  apiKey: string;
  keycloakUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  audience: string;
}

export interface SenslincCredentials {
  apiUrl: string;
  email: string;
  password: string;
}

export interface FmAccessCredentials {
  apiUrl: string;
  username: string;
  password: string;
}

export interface IvionCredentials {
  apiUrl: string;
  username: string;
  password: string;
}

/** Fetch the api_profiles row linked to a building, if any */
async function getLinkedProfile(
  supabase: any,
  buildingFmGuid: string
): Promise<any | null> {
  const { data: settings } = await supabase
    .from('building_settings')
    .select('api_profile_id')
    .eq('fm_guid', buildingFmGuid)
    .maybeSingle();

  if (!settings?.api_profile_id) return null;

  const { data: profile } = await supabase
    .from('api_profiles')
    .select('*')
    .eq('id', settings.api_profile_id)
    .maybeSingle();

  // If it's the default profile, return null so we fall through to env vars
  if (profile?.is_default) return null;

  return profile || null;
}

export async function getAssetPlusCredentials(
  supabase: any,
  buildingFmGuid?: string | null
): Promise<AssetPlusCredentials> {
  if (buildingFmGuid) {
    // 1. Check linked API profile
    const profile = await getLinkedProfile(supabase, buildingFmGuid);
    if (profile?.assetplus_api_url) {
      return {
        apiUrl: profile.assetplus_api_url,
        apiKey: profile.assetplus_api_key || '',
        keycloakUrl: profile.assetplus_keycloak_url || '',
        clientId: profile.assetplus_client_id || '',
        clientSecret: profile.assetplus_client_secret || '',
        username: profile.assetplus_username || '',
        password: profile.assetplus_password || '',
        audience: profile.assetplus_audience || 'asset-api',
      };
    }

    // 2. Check per-building overrides (legacy, backward compat)
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

  // 3. Fall back to global env vars
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
    // 1. Check linked API profile
    const profile = await getLinkedProfile(supabase, buildingFmGuid);
    if (profile?.senslinc_api_url) {
      return {
        apiUrl: profile.senslinc_api_url,
        email: profile.senslinc_email || '',
        password: profile.senslinc_password || '',
      };
    }

    // 2. Check per-building overrides (legacy)
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

export async function getFmAccessCredentials(
  supabase: any,
  buildingFmGuid?: string | null
): Promise<FmAccessCredentials> {
  if (buildingFmGuid) {
    const profile = await getLinkedProfile(supabase, buildingFmGuid);
    if (profile?.fm_access_api_url) {
      return {
        apiUrl: profile.fm_access_api_url,
        username: profile.fm_access_username || '',
        password: profile.fm_access_password || '',
      };
    }
  }

  return {
    apiUrl: Deno.env.get('FM_ACCESS_API_URL') || '',
    username: Deno.env.get('FM_ACCESS_USERNAME') || '',
    password: Deno.env.get('FM_ACCESS_PASSWORD') || '',
  };
}

export async function getIvionCredentials(
  supabase: any,
  buildingFmGuid?: string | null
): Promise<IvionCredentials> {
  if (buildingFmGuid) {
    const profile = await getLinkedProfile(supabase, buildingFmGuid);
    if (profile?.ivion_api_url) {
      return {
        apiUrl: profile.ivion_api_url,
        username: profile.ivion_username || '',
        password: profile.ivion_password || '',
      };
    }
  }

  return {
    apiUrl: Deno.env.get('IVION_API_URL') || '',
    username: Deno.env.get('IVION_USERNAME') || '',
    password: Deno.env.get('IVION_PASSWORD') || '',
  };
}
