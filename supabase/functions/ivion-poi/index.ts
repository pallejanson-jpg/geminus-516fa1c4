import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Ivion API credentials from secrets
const IVION_API_URL = Deno.env.get('IVION_API_URL') || '';
const IVION_USERNAME = Deno.env.get('IVION_USERNAME') || '';
const IVION_PASSWORD = Deno.env.get('IVION_PASSWORD') || '';

// Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface IvionTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

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
  if (!IVION_API_URL || !IVION_USERNAME || !IVION_PASSWORD) {
    throw new Error('Ivion API credentials not configured. Please set IVION_API_URL, IVION_USERNAME, and IVION_PASSWORD in Cloud secrets.');
  }

  console.log('Attempting Ivion auth to:', IVION_API_URL);

  // Method 1: Try /api/auth/login with JSON body (standard NavVis approach)
  try {
    console.log('Trying auth method 1: /api/auth/login with JSON body');
    const response = await fetch(`${IVION_API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: IVION_USERNAME,
        password: IVION_PASSWORD,
      }),
    });

    if (response.ok) {
      const data: IvionTokenResponse = await response.json();
      console.log('Auth method 1 succeeded');
      return data.access_token;
    }
    
    const text = await response.text();
    console.log(`Auth method 1 failed: ${response.status} - ${text}`);
  } catch (e) {
    console.log('Auth method 1 error:', e);
  }

  // Method 2: Try /api/v1/auth/login (alternative API version)
  try {
    console.log('Trying auth method 2: /api/v1/auth/login');
    const response = await fetch(`${IVION_API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: IVION_USERNAME,
        password: IVION_PASSWORD,
      }),
    });

    if (response.ok) {
      const data: IvionTokenResponse = await response.json();
      console.log('Auth method 2 succeeded');
      return data.access_token;
    }
    
    const text = await response.text();
    console.log(`Auth method 2 failed: ${response.status} - ${text}`);
  } catch (e) {
    console.log('Auth method 2 error:', e);
  }

  // Method 3: Try Basic Auth header approach
  try {
    console.log('Trying auth method 3: Basic Auth header');
    const basicAuth = btoa(`${IVION_USERNAME}:${IVION_PASSWORD}`);
    const response = await fetch(`${IVION_API_URL}/api/auth/token`, {
      method: 'POST',
      headers: { 
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (response.ok) {
      const data: IvionTokenResponse = await response.json();
      console.log('Auth method 3 succeeded');
      return data.access_token;
    }
    
    const text = await response.text();
    console.log(`Auth method 3 failed: ${response.status} - ${text}`);
  } catch (e) {
    console.log('Auth method 3 error:', e);
  }

  // Method 4: Try OAuth2 token endpoint with form data
  try {
    console.log('Trying auth method 4: OAuth2 token endpoint');
    const response = await fetch(`${IVION_API_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        username: IVION_USERNAME,
        password: IVION_PASSWORD,
      }),
    });

    if (response.ok) {
      const data: IvionTokenResponse = await response.json();
      console.log('Auth method 4 succeeded');
      return data.access_token;
    }
    
    const text = await response.text();
    console.log(`Auth method 4 failed: ${response.status} - ${text}`);
  } catch (e) {
    console.log('Auth method 4 error:', e);
  }

  throw new Error(`Ivion auth failed. Tried 4 different authentication methods. Please verify that IVION_API_URL (${IVION_API_URL}), IVION_USERNAME, and IVION_PASSWORD are correct.`);
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
      'Authorization': `Bearer ${token}`,
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
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get POI: ${response.status} - ${text}`);
  }

  return response.json();
}

// Get POI types for a site
async function getPoiTypes(siteId: string): Promise<any[]> {
  const token = await getIvionToken();
  
  const response = await fetch(`${IVION_API_URL}/api/site/${siteId}/poi_types`, {
    headers: {
      'Authorization': `Bearer ${token}`,
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
      'Authorization': `Bearer ${token}`,
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
