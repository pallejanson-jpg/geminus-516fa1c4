/**
 * Per-building credential resolver.
 * Checks building_settings.api_profile_id → api_profiles first,
 * then falls back to per-building overrides, then global env vars.
 */

export interface GeminusPlusCredentials {
  apiUrl: string;
  apiKey: string;
  keycloakUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  audience: string;
}

export interface GeminusPremiumCredentials {
  apiUrl: string;
  email: string;
  password: string;
}

export interface GeminusBaseCredentials {
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

/**
 * Fetch the api_profiles row for the building's tenant, if any.
 * One credential set per tenant covers all of that tenant's buildings,
 * so buildings don't each need their own api_profile_id override.
 */
async function getTenantProfile(
  supabase: any,
  buildingFmGuid: string
): Promise<any | null> {
  const { data: settings } = await supabase
    .from('building_settings')
    .select('tenant_id')
    .eq('fm_guid', buildingFmGuid)
    .maybeSingle();

  if (!settings?.tenant_id) return null;

  const { data: profile } = await supabase
    .from('api_profiles')
    .select('*')
    .eq('tenant_id', settings.tenant_id)
    .maybeSingle();

  return profile || null;
}

export async function getGeminusPlusCredentials(
  supabase: any,
  buildingFmGuid?: string | null
): Promise<GeminusPlusCredentials> {
  if (buildingFmGuid) {
    // 1. Check linked API profile
    const profile = await getLinkedProfile(supabase, buildingFmGuid);
    if (profile?.geminus_plus_api_url) {
      return {
        apiUrl: profile.geminus_plus_api_url,
        apiKey: profile.geminus_plus_api_key || '',
        keycloakUrl: profile.geminus_plus_keycloak_url || '',
        clientId: profile.geminus_plus_client_id || '',
        clientSecret: profile.geminus_plus_client_secret || '',
        username: profile.geminus_plus_username || '',
        password: profile.geminus_plus_password || '',
        audience: profile.geminus_plus_audience || 'asset-api',
      };
    }

    // 2. Check the building's tenant profile
    const tenantProfile = await getTenantProfile(supabase, buildingFmGuid);
    if (tenantProfile?.geminus_plus_api_url) {
      return {
        apiUrl: tenantProfile.geminus_plus_api_url,
        apiKey: tenantProfile.geminus_plus_api_key || '',
        keycloakUrl: tenantProfile.geminus_plus_keycloak_url || '',
        clientId: tenantProfile.geminus_plus_client_id || '',
        clientSecret: tenantProfile.geminus_plus_client_secret || '',
        username: tenantProfile.geminus_plus_username || '',
        password: tenantProfile.geminus_plus_password || '',
        audience: tenantProfile.geminus_plus_audience || 'asset-api',
      };
    }

    // 3. Check per-building overrides (legacy, backward compat)
    const { data } = await supabase
      .from('building_settings')
      .select('geminus_plus_api_url, geminus_plus_api_key, geminus_plus_keycloak_url, geminus_plus_client_id, geminus_plus_client_secret, geminus_plus_username, geminus_plus_password')
      .eq('fm_guid', buildingFmGuid)
      .maybeSingle();

    if (data?.geminus_plus_api_url) {
      return {
        apiUrl: data.geminus_plus_api_url,
        apiKey: data.geminus_plus_api_key || '',
        keycloakUrl: data.geminus_plus_keycloak_url || '',
        clientId: data.geminus_plus_client_id || '',
        clientSecret: data.geminus_plus_client_secret || '',
        username: data.geminus_plus_username || '',
        password: data.geminus_plus_password || '',
        audience: 'asset-api',
      };
    }
  }

  // 4. Fall back to global env vars
  return {
    apiUrl: Deno.env.get('GEMINUS_PLUS_API_URL') || '',
    apiKey: Deno.env.get('GEMINUS_PLUS_API_KEY') || '',
    keycloakUrl: Deno.env.get('GEMINUS_PLUS_KEYCLOAK_URL') || '',
    clientId: Deno.env.get('GEMINUS_PLUS_CLIENT_ID') || '',
    clientSecret: Deno.env.get('GEMINUS_PLUS_CLIENT_SECRET') || '',
    username: Deno.env.get('GEMINUS_PLUS_USERNAME') || '',
    password: Deno.env.get('GEMINUS_PLUS_PASSWORD') || '',
    audience: Deno.env.get('GEMINUS_PLUS_AUDIENCE') || 'asset-api',
  };
}

export async function getGeminusPremiumCredentials(
  supabase: any,
  buildingFmGuid?: string | null
): Promise<GeminusPremiumCredentials> {
  if (buildingFmGuid) {
    // 1. Check linked API profile
    const profile = await getLinkedProfile(supabase, buildingFmGuid);
    if (profile?.geminus_premium_api_url) {
      return {
        apiUrl: profile.geminus_premium_api_url,
        email: profile.geminus_premium_email || '',
        password: profile.geminus_premium_password || '',
      };
    }

    // 2. Check the building's tenant profile
    const tenantProfile = await getTenantProfile(supabase, buildingFmGuid);
    if (tenantProfile?.geminus_premium_api_url) {
      return {
        apiUrl: tenantProfile.geminus_premium_api_url,
        email: tenantProfile.geminus_premium_email || '',
        password: tenantProfile.geminus_premium_password || '',
      };
    }

    // 3. Check per-building overrides (legacy)
    const { data } = await supabase
      .from('building_settings')
      .select('geminus_premium_api_url, geminus_premium_email, geminus_premium_password')
      .eq('fm_guid', buildingFmGuid)
      .maybeSingle();

    if (data?.geminus_premium_api_url) {
      return {
        apiUrl: data.geminus_premium_api_url,
        email: data.geminus_premium_email || '',
        password: data.geminus_premium_password || '',
      };
    }
  }

  return {
    apiUrl: Deno.env.get('GEMINUS_PREMIUM_API_URL') || '',
    email: Deno.env.get('GEMINUS_PREMIUM_EMAIL') || '',
    password: Deno.env.get('GEMINUS_PREMIUM_PASSWORD') || '',
  };
}

export async function getGeminusBaseCredentials(
  supabase: any,
  buildingFmGuid?: string | null
): Promise<GeminusBaseCredentials> {
  if (buildingFmGuid) {
    const profile = await getLinkedProfile(supabase, buildingFmGuid);
    if (profile?.geminus_base_api_url) {
      return {
        apiUrl: profile.geminus_base_api_url,
        username: profile.geminus_base_username || '',
        password: profile.geminus_base_password || '',
      };
    }

    const tenantProfile = await getTenantProfile(supabase, buildingFmGuid);
    if (tenantProfile?.geminus_base_api_url) {
      return {
        apiUrl: tenantProfile.geminus_base_api_url,
        username: tenantProfile.geminus_base_username || '',
        password: tenantProfile.geminus_base_password || '',
      };
    }
  }

  return {
    apiUrl: Deno.env.get('GEMINUS_BASE_API_URL') || '',
    username: Deno.env.get('GEMINUS_BASE_USERNAME') || '',
    password: Deno.env.get('GEMINUS_BASE_PASSWORD') || '',
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
