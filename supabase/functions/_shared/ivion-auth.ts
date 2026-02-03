import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Shared Ivion authentication helper that:
 * 1. Checks building_settings for cached tokens
 * 2. Refreshes with refresh_token if access_token expired
 * 3. Falls back to username/password login
 * 4. Saves new tokens back to database for reuse
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Environment secrets
function getIvionConfig() {
  return {
    apiUrl: (Deno.env.get('IVION_API_URL') || '').trim().replace(/\/+$/, ''),
    username: (Deno.env.get('IVION_USERNAME') || '').trim(),
    password: (Deno.env.get('IVION_PASSWORD') || '').trim(),
    // Legacy fallback tokens from secrets
    accessToken: (Deno.env.get('IVION_ACCESS_TOKEN') || '').trim(),
    refreshToken: (Deno.env.get('IVION_REFRESH_TOKEN') || '').trim(),
  };
}

// Parse JWT expiry
function parseTokenExpiry(token: string): { expiresAt: Date | null; isExpired: boolean } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { expiresAt: null, isExpired: true };
    
    const payload = JSON.parse(atob(parts[1]));
    const exp = payload.exp;
    if (!exp) return { expiresAt: null, isExpired: true };
    
    const expiresAt = new Date(exp * 1000);
    const now = new Date();
    // Add 60 second buffer
    const isExpired = now.getTime() >= (expiresAt.getTime() - 60000);
    
    return { expiresAt, isExpired };
  } catch {
    return { expiresAt: null, isExpired: true };
  }
}

// Check if token is expired
export function isTokenExpired(token: string): boolean {
  return parseTokenExpiry(token).isExpired;
}

interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  source: 'database' | 'refresh' | 'login' | 'secret';
}

interface BuildingTokens {
  ivion_access_token: string | null;
  ivion_refresh_token: string | null;
  ivion_token_expires_at: string | null;
}

// Save tokens to building_settings
async function saveTokensToDatabase(
  buildingFmGuid: string | null, 
  accessToken: string, 
  refreshToken?: string
): Promise<void> {
  if (!buildingFmGuid) {
    console.log('No buildingFmGuid provided, skipping token save to database');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { expiresAt } = parseTokenExpiry(accessToken);

  const { error } = await supabase
    .from('building_settings')
    .upsert({
      fm_guid: buildingFmGuid,
      ivion_access_token: accessToken,
      ivion_refresh_token: refreshToken || null,
      ivion_token_expires_at: expiresAt?.toISOString() || null,
    }, { onConflict: 'fm_guid' });

  if (error) {
    console.error('Failed to save tokens to database:', error.message);
  } else {
    console.log(`Saved Ivion tokens to building_settings for ${buildingFmGuid}`);
  }
}

// Get tokens from building_settings
async function getTokensFromDatabase(buildingFmGuid: string | null): Promise<BuildingTokens | null> {
  if (!buildingFmGuid) return null;

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .from('building_settings')
    .select('ivion_access_token, ivion_refresh_token, ivion_token_expires_at')
    .eq('fm_guid', buildingFmGuid)
    .maybeSingle();

  if (error || !data) return null;
  return data as BuildingTokens;
}

// Refresh access token using refresh token
async function refreshAccessToken(refreshToken: string, apiUrl: string): Promise<{ accessToken: string; refreshToken?: string } | null> {
  console.log('Attempting to refresh access token...');
  
  try {
    const response = await fetch(`${apiUrl}/api/auth/refresh_access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.access_token) {
        console.log('Successfully refreshed access token');
        return {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || refreshToken, // Use new refresh token if provided
        };
      }
    } else {
      const errorText = await response.text();
      console.log(`Refresh failed: ${response.status} - ${errorText.slice(0, 100)}`);
    }
  } catch (e) {
    console.log(`Refresh error: ${e}`);
  }
  
  return null;
}

// Login with username/password
async function loginWithCredentials(username: string, password: string, apiUrl: string): Promise<{ accessToken: string; refreshToken?: string } | null> {
  console.log('Attempting login with username/password...');
  
  try {
    const response = await fetch(`${apiUrl}/api/auth/generate_tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.access_token) {
        console.log('Successfully logged in with credentials');
        return {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        };
      }
    } else {
      const errorText = await response.text();
      console.log(`Login failed: ${response.status} - ${errorText.slice(0, 100)}`);
    }
  } catch (e) {
    console.log(`Login error: ${e}`);
  }
  
  return null;
}

/**
 * Get a valid Ivion access token.
 * 
 * Priority:
 * 1. Check building_settings for cached valid token
 * 2. If expired, try to refresh with stored refresh_token
 * 3. If no refresh token or refresh fails, login with username/password
 * 4. Fallback to IVION_ACCESS_TOKEN from secrets (legacy)
 * 
 * @param buildingFmGuid - Optional building GUID to check for cached tokens
 * @returns Valid access token
 * @throws Error if all auth methods fail
 */
export async function getIvionToken(buildingFmGuid?: string | null): Promise<string> {
  const config = getIvionConfig();
  
  if (!config.apiUrl) {
    throw new Error('IVION_API_URL not configured');
  }

  // 1. Check database for cached tokens
  if (buildingFmGuid) {
    const dbTokens = await getTokensFromDatabase(buildingFmGuid);
    
    if (dbTokens?.ivion_access_token && !isTokenExpired(dbTokens.ivion_access_token)) {
      console.log('Using cached access token from database (still valid)');
      return dbTokens.ivion_access_token;
    }
    
    // 2. Try to refresh if we have a refresh token
    if (dbTokens?.ivion_refresh_token) {
      const refreshed = await refreshAccessToken(dbTokens.ivion_refresh_token, config.apiUrl);
      if (refreshed) {
        // Save new tokens back to database
        await saveTokensToDatabase(buildingFmGuid, refreshed.accessToken, refreshed.refreshToken);
        return refreshed.accessToken;
      }
    }
  }

  // 3. Try secrets-based refresh token
  if (config.refreshToken) {
    const refreshed = await refreshAccessToken(config.refreshToken, config.apiUrl);
    if (refreshed) {
      // Save to database if we have a building
      if (buildingFmGuid) {
        await saveTokensToDatabase(buildingFmGuid, refreshed.accessToken, refreshed.refreshToken);
      }
      return refreshed.accessToken;
    }
  }

  // 4. Login with username/password
  if (config.username && config.password) {
    const loggedIn = await loginWithCredentials(config.username, config.password, config.apiUrl);
    if (loggedIn) {
      // Save to database if we have a building
      if (buildingFmGuid) {
        await saveTokensToDatabase(buildingFmGuid, loggedIn.accessToken, loggedIn.refreshToken);
      }
      return loggedIn.accessToken;
    }
  }

  // 5. Last resort: use access token from secrets (legacy)
  if (config.accessToken && !isTokenExpired(config.accessToken)) {
    console.log('Using IVION_ACCESS_TOKEN from secrets (legacy fallback)');
    return config.accessToken;
  }

  // All methods failed
  const hasCredentials = config.username && config.password;
  const hasTokens = config.accessToken || config.refreshToken;

  throw new Error(
    `Ivion authentication failed. ` +
    (hasCredentials
      ? 'Username/password login was attempted but failed. Ensure credentials are for a LOCAL account (not SSO/OAuth). '
      : 'No IVION_USERNAME/IVION_PASSWORD configured. ') +
    (hasTokens
      ? 'Provided tokens are expired or invalid. '
      : 'No IVION_ACCESS_TOKEN or IVION_REFRESH_TOKEN configured. ') +
    'Ensure the Ivion instance supports local authentication.'
  );
}

/**
 * Test Ivion connection with automatic authentication.
 * Returns status info including whether credentials are configured.
 */
export async function testIvionConnection(buildingFmGuid?: string | null): Promise<{
  success: boolean;
  message: string;
  siteCount?: number;
  authMethod?: string;
}> {
  const config = getIvionConfig();
  
  try {
    const token = await getIvionToken(buildingFmGuid);
    
    // Try to list sites to verify connection
    const response = await fetch(`${config.apiUrl}/api/sites`, {
      headers: {
        'x-authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (response.ok) {
      const sites = await response.json();
      const siteCount = Array.isArray(sites) ? sites.length : 0;
      return {
        success: true,
        message: `Connected! Found ${siteCount} sites.`,
        siteCount,
        authMethod: config.username ? 'credentials' : 'token',
      };
    } else {
      const errorText = await response.text();
      return {
        success: false,
        message: `API call failed: ${response.status} - ${errorText.slice(0, 100)}`,
      };
    }
  } catch (e: any) {
    return {
      success: false,
      message: e.message || String(e),
    };
  }
}

/**
 * Get Ivion configuration status (for UI display).
 */
export function getIvionConfigStatus(): {
  hasApiUrl: boolean;
  hasCredentials: boolean;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  apiUrlPreview: string;
  usernamePreview: string;
} {
  const config = getIvionConfig();
  
  return {
    hasApiUrl: !!config.apiUrl,
    hasCredentials: !!(config.username && config.password),
    hasAccessToken: !!config.accessToken,
    hasRefreshToken: !!config.refreshToken,
    apiUrlPreview: config.apiUrl ? config.apiUrl.replace(/^https?:\/\//, '').slice(0, 30) + '...' : '',
    usernamePreview: config.username ? config.username.slice(0, 3) + '***' : '',
  };
}
