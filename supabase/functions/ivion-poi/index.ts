import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // Match Supabase web client preflight headers (keep permissive)
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function normalizeBaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

// Ivion API credentials from secrets
// NOTE: Some Ivion instances are configured with SSO/OAuth where username/password login endpoints are not available.
// In that case, provide a JWT via IVION_ACCESS_TOKEN.
const IVION_API_URL = normalizeBaseUrl(Deno.env.get('IVION_API_URL') || '');
const IVION_USERNAME = (Deno.env.get('IVION_USERNAME') || '').trim();
const IVION_PASSWORD = (Deno.env.get('IVION_PASSWORD') || '').trim();
const IVION_ACCESS_TOKEN = (Deno.env.get('IVION_ACCESS_TOKEN') || '').trim();

// Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface IvionTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

type AuthAttempt = {
  method: string;
  url: string;
  status?: number;
  redirectedTo?: string | null;
  bodyPreview?: string;
  error?: string;
};

interface IvionPoi {
  id: number;
  titles: Record<string, string>;
  descriptions: Record<string, string>;
  location: { x: number; y: number; z: number };
  orientation: { x: number; y: number; z: number; w: number };
  poiType: { id: number };
  pointOfView?: {
    imageId: number;
    location: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
    fov: number;
  };
  customData?: string;
  importance: number;
  icon?: string;
}

// Get auth token from Ivion - try multiple auth methods
async function getIvionToken(): Promise<string> {
  // If a token is provided explicitly, always prefer it.
  if (IVION_ACCESS_TOKEN) return IVION_ACCESS_TOKEN;

  if (!IVION_API_URL || !IVION_USERNAME || !IVION_PASSWORD) {
    throw new Error(
      'Ivion credentials not configured. Set IVION_API_URL and either (IVION_USERNAME + IVION_PASSWORD) OR IVION_ACCESS_TOKEN.'
    );
  }

  console.log('Attempting Ivion auth to:', IVION_API_URL);

  const attempts: AuthAttempt[] = [];
  const recordAttempt = (a: AuthAttempt) => {
    attempts.push(a);
    // keep logs short but useful
    console.log(`Auth attempt: ${a.method} -> ${a.status ?? 'ERR'}${a.redirectedTo ? ` (redirect ${a.redirectedTo})` : ''}`);
  };

  const commonJsonHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    // Some Spring Security setups expect this header for API login
    'X-Requested-With': 'XMLHttpRequest',
  };

  // Method 1: Try /api/auth/login with JSON body (standard NavVis approach)
  try {
    console.log('Trying auth method 1: /api/auth/login with JSON body');
    const url = `${IVION_API_URL}/api/auth/login`;
    const response = await fetch(url, {
      method: 'POST',
      headers: commonJsonHeaders,
      redirect: 'manual',
      body: JSON.stringify({
        username: IVION_USERNAME,
        password: IVION_PASSWORD,
      }),
    });

    const redirectedTo = response.headers.get('location');
    if (response.ok) {
      const data: IvionTokenResponse = await response.json();
      console.log('Auth method 1 succeeded');
      return data.access_token;
    }

    const text = await response.text();
    recordAttempt({
      method: 'method_1_api_auth_login',
      url,
      status: response.status,
      redirectedTo,
      bodyPreview: text?.slice(0, 300),
    });
  } catch (e) {
    recordAttempt({
      method: 'method_1_api_auth_login',
      url: `${IVION_API_URL}/api/auth/login`,
      error: String(e),
    });
  }

  // Method 2: Try /api/v1/auth/login (alternative API version)
  try {
    console.log('Trying auth method 2: /api/v1/auth/login');
    const url = `${IVION_API_URL}/api/v1/auth/login`;
    const response = await fetch(url, {
      method: 'POST',
      headers: commonJsonHeaders,
      redirect: 'manual',
      body: JSON.stringify({
        username: IVION_USERNAME,
        password: IVION_PASSWORD,
      }),
    });

    const redirectedTo = response.headers.get('location');
    if (response.ok) {
      const data: IvionTokenResponse = await response.json();
      console.log('Auth method 2 succeeded');
      return data.access_token;
    }

    const text = await response.text();
    recordAttempt({
      method: 'method_2_api_v1_auth_login',
      url,
      status: response.status,
      redirectedTo,
      bodyPreview: text?.slice(0, 300),
    });
  } catch (e) {
    recordAttempt({
      method: 'method_2_api_v1_auth_login',
      url: `${IVION_API_URL}/api/v1/auth/login`,
      error: String(e),
    });
  }

  // Method 3: Try Basic Auth header approach
  try {
    console.log('Trying auth method 3: Basic Auth header');
    const basicAuth = btoa(`${IVION_USERNAME}:${IVION_PASSWORD}`);
    const url = `${IVION_API_URL}/api/auth/token`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      redirect: 'manual',
      body: 'grant_type=client_credentials',
    });

    const redirectedTo = response.headers.get('location');
    if (response.ok) {
      const data: IvionTokenResponse = await response.json();
      console.log('Auth method 3 succeeded');
      return data.access_token;
    }

    const text = await response.text();
    recordAttempt({
      method: 'method_3_basic_auth_token',
      url,
      status: response.status,
      redirectedTo,
      bodyPreview: text?.slice(0, 300),
    });
  } catch (e) {
    recordAttempt({
      method: 'method_3_basic_auth_token',
      url: `${IVION_API_URL}/api/auth/token`,
      error: String(e),
    });
  }

  // Method 4: Try OAuth2 token endpoint with form data
  try {
    console.log('Trying auth method 4: OAuth2 token endpoint');
    const url = `${IVION_API_URL}/oauth/token`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
      body: new URLSearchParams({
        grant_type: 'password',
        username: IVION_USERNAME,
        password: IVION_PASSWORD,
      }),
    });

    const redirectedTo = response.headers.get('location');
    if (response.ok) {
      const data: IvionTokenResponse = await response.json();
      console.log('Auth method 4 succeeded');
      return data.access_token;
    }

    const text = await response.text();
    recordAttempt({
      method: 'method_4_oauth_token',
      url,
      status: response.status,
      redirectedTo,
      bodyPreview: text?.slice(0, 300),
    });
  } catch (e) {
    recordAttempt({
      method: 'method_4_oauth_token',
      url: `${IVION_API_URL}/oauth/token`,
      error: String(e),
    });
  }

  // If all methods fail, this is commonly caused by SSO/OAuth being enabled on the Ivion instance.
  // In that case, username/password login is not available and a JWT must be provided.
  throw new Error(
    `Ivion auth failed. This Ivion instance likely requires SSO/OAuth (or the credentials are not local Ivion accounts). ` +
      `Provide IVION_ACCESS_TOKEN (JWT) in backend secrets, or ensure the instance supports local login via /api/auth/login. ` +
      `Attempts: ${JSON.stringify(attempts)}`
  );
}

// Test connection to Ivion
async function testConnection(): Promise<{ success: boolean; message: string; details?: string }> {
  try {
    const token = await getIvionToken();
    return { 
      success: true, 
      message: 'Successfully connected to Ivion API',
      details: `Token obtained (${token.substring(0, 10)}...)` 
    };
  } catch (error: any) {
    return { 
      success: false, 
      message: error.message,
      details: `URL: ${IVION_API_URL}, Username: ${IVION_USERNAME ? IVION_USERNAME.substring(0, 3) + '***' : 'NOT SET'}`
    };
  }
}

// Get all POIs for a site
async function getPois(siteId: string): Promise<IvionPoi[]> {
  const token = await getIvionToken();
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/pois`, {
    headers: {
      'x-authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get POIs: ${response.status} - ${text}`);
  }

  return response.json();
}

// Get a single POI by ID
async function getPoi(siteId: string, poiId: number): Promise<IvionPoi> {
  const token = await getIvionToken();
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/pois/${poiId}`, {
    headers: {
      'x-authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get POI: ${response.status} - ${text}`);
  }

  return response.json();
}

// Update an existing POI
async function updatePoi(siteId: string, poiId: number, updates: Partial<IvionPoi>): Promise<IvionPoi> {
  const token = await getIvionToken();
  
  // First, get the existing POI to merge data
  const existing = await getPoi(siteId, poiId);
  
  // Merge custom data to preserve existing attributes
  let mergedCustomData: Record<string, any> = {};
  try {
    mergedCustomData = JSON.parse(existing.customData || '{}');
  } catch {
    // Ignore parse errors
  }
  
  if (updates.customData) {
    try {
      const newCustomData = JSON.parse(updates.customData);
      mergedCustomData = { ...mergedCustomData, ...newCustomData };
    } catch {
      // Ignore parse errors
    }
  }
  
  const updatedPoi = {
    ...existing,
    ...updates,
    customData: JSON.stringify(mergedCustomData),
  };
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/pois/${poiId}`, {
    method: 'PUT',
    headers: {
      'x-authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updatedPoi),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update POI: ${response.status} - ${text}`);
  }

  return response.json();
}

// Get POI types for a site
async function getPoiTypes(siteId: string): Promise<any[]> {
  const token = await getIvionToken();
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/poi_types`, {
    headers: {
      'x-authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get POI types: ${response.status} - ${text}`);
  }

  return response.json();
}

// Create POI in Ivion
async function createPoi(siteId: string, poiData: Partial<IvionPoi>): Promise<IvionPoi> {
  const token = await getIvionToken();
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/pois`, {
    method: 'POST',
    headers: {
      'x-authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([poiData]), // API expects an array
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create POI: ${response.status} - ${text}`);
  }

  const result = await response.json();
  return Array.isArray(result) ? result[0] : result;
}

// Import POIs from Ivion to assets table
async function importPoisFromSite(siteId: string, buildingFmGuid: string): Promise<{ imported: number; skipped: number }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Get all POIs from Ivion
  const pois = await getPois(siteId);
  
  // Get existing POI IDs in our database
  const { data: existingAssets } = await supabase
    .from('assets')
    .select('ivion_poi_id')
    .eq('ivion_site_id', siteId)
    .not('ivion_poi_id', 'is', null);
  
  const existingPoiIds = new Set(existingAssets?.map(a => a.ivion_poi_id) || []);
  
  let imported = 0;
  let skipped = 0;
  
  for (const poi of pois) {
    if (existingPoiIds.has(poi.id)) {
      skipped++;
      continue;
    }
    
    // Parse custom data if present
    let customData: any = {};
    if (poi.customData) {
      try {
        customData = JSON.parse(poi.customData);
      } catch {
        // Ignore parse errors
      }
    }
    
    // Create asset from POI
    const asset = {
      fm_guid: customData.fm_guid || crypto.randomUUID(),
      name: poi.titles['sv'] || poi.titles['en'] || poi.titles[Object.keys(poi.titles)[0]] || 'Unnamed POI',
      common_name: poi.titles['sv'] || poi.titles['en'] || poi.titles[Object.keys(poi.titles)[0]] || 'Unnamed POI',
      category: 'Instance',
      asset_type: customData.asset_type || 'other',
      building_fm_guid: buildingFmGuid,
      coordinate_x: poi.location?.x,
      coordinate_y: poi.location?.y,
      coordinate_z: poi.location?.z,
      ivion_poi_id: poi.id,
      ivion_site_id: siteId,
      ivion_image_id: poi.pointOfView?.imageId,
      ivion_synced_at: new Date().toISOString(),
      is_local: true,
      created_in_model: false,
      annotation_placed: true,
      attributes: {
        ivionDescription: poi.descriptions['sv'] || poi.descriptions['en'] || '',
        ivionOrientation: poi.orientation,
        ivionPoiType: poi.poiType?.id,
        ivionImportance: poi.importance,
        ivionIcon: poi.icon,
      },
    };
    
    const { error } = await supabase.from('assets').insert([asset]);
    
    if (error) {
      console.error('Failed to import POI:', poi.id, error);
    } else {
      imported++;
    }
  }
  
  return { imported, skipped };
}

// Sync a single asset to Ivion as POI
async function syncAssetToPoi(assetFmGuid: string): Promise<{ success: boolean; poiId?: number; message?: string }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Get asset
  const { data: asset, error: assetError } = await supabase
    .from('assets')
    .select('*')
    .eq('fm_guid', assetFmGuid)
    .maybeSingle();
  
  if (assetError || !asset) {
    return { success: false, message: 'Asset not found' };
  }
  
  // Get building settings to find ivion_site_id
  const { data: buildingSettings } = await supabase
    .from('building_settings')
    .select('ivion_site_id')
    .eq('fm_guid', asset.building_fm_guid)
    .maybeSingle();
  
  if (!buildingSettings?.ivion_site_id) {
    return { success: false, message: 'No Ivion site configured for this building' };
  }
  
  const siteId = buildingSettings.ivion_site_id;
  
  // If asset already has a POI ID, we'd update instead of create
  // For now, just create new POIs
  if (asset.ivion_poi_id) {
    return { success: true, poiId: asset.ivion_poi_id, message: 'Asset already synced' };
  }
  
  // Build POI data
  const poiData: Partial<IvionPoi> = {
    titles: { sv: asset.name || asset.common_name || 'Unnamed' },
    descriptions: { sv: asset.attributes?.description || '' },
    location: {
      x: asset.coordinate_x || 0,
      y: asset.coordinate_y || 0,
      z: asset.coordinate_z || 0,
    },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    importance: 1,
    customData: JSON.stringify({
      fm_guid: asset.fm_guid,
      asset_type: asset.asset_type,
      source: 'geminus',
    }),
  };
  
  try {
    const createdPoi = await createPoi(siteId, poiData);
    
    // Update asset with POI ID
    await supabase
      .from('assets')
      .update({
        ivion_poi_id: createdPoi.id,
        ivion_site_id: siteId,
        ivion_synced_at: new Date().toISOString(),
      })
      .eq('fm_guid', assetFmGuid);
    
    return { success: true, poiId: createdPoi.id };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    let result: any;

    switch (action) {
      case 'test-connection':
        result = await testConnection();
        break;

      case 'test-auth':
        // Returns detailed auth diagnostics; safe to expose (no passwords, only statuses and short previews)
        try {
          const token = await getIvionToken();
          result = {
            success: true,
            message: 'Token obtained',
            tokenPreview: token ? token.substring(0, 12) + '...' : null,
            usingExplicitToken: !!IVION_ACCESS_TOKEN,
          };
        } catch (e: any) {
          result = {
            success: false,
            message: e?.message || String(e),
            usingExplicitToken: !!IVION_ACCESS_TOKEN,
            hasApiUrl: !!IVION_API_URL,
            hasUsername: !!IVION_USERNAME,
            hasPassword: !!IVION_PASSWORD,
          };
        }
        break;
        
      case 'get-pois':
        if (!params.siteId) throw new Error('siteId required');
        result = await getPois(params.siteId);
        break;

      case 'get-poi':
        if (!params.siteId || !params.poiId) throw new Error('siteId and poiId required');
        result = await getPoi(params.siteId, params.poiId);
        break;
        
      case 'get-poi-types':
        if (!params.siteId) throw new Error('siteId required');
        result = await getPoiTypes(params.siteId);
        break;
        
      case 'create-poi':
        if (!params.siteId || !params.poiData) throw new Error('siteId and poiData required');
        result = await createPoi(params.siteId, params.poiData);
        break;
        
      case 'update-poi':
        if (!params.siteId || !params.poiId) throw new Error('siteId and poiId required');
        result = await updatePoi(params.siteId, params.poiId, params.poiData || {});
        break;
        
      case 'import-pois':
        if (!params.siteId || !params.buildingFmGuid) {
          throw new Error('siteId and buildingFmGuid required');
        }
        result = await importPoisFromSite(params.siteId, params.buildingFmGuid);
        break;
        
      case 'sync-asset':
        if (!params.assetFmGuid) throw new Error('assetFmGuid required');
        result = await syncAssetToPoi(params.assetFmGuid);
        break;

      case 'get-latest-poi':
        // Get most recent POI from a site (useful for auto-linking)
        if (!params.siteId) throw new Error('siteId required');
        try {
          const allPois = await getPois(params.siteId);
          // Sort by ID descending (higher ID = newer)
          const sortedPois = allPois.sort((a, b) => (b.id || 0) - (a.id || 0));
          result = sortedPois.length > 0 ? sortedPois[0] : null;
        } catch (e: any) {
          // Avoid returning a non-2xx status that may crash the UI; report as a soft failure.
          result = {
            success: false,
            error: e?.message || String(e),
            hint: 'If this Ivion instance uses SSO/OAuth, set IVION_ACCESS_TOKEN (JWT) in backend secrets.',
          };
        }
        break;
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Ivion POI error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
