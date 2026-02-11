import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIvionToken, testIvionConnection, getIvionConfigStatus, isTokenExpired, parseTokenExpiry } from "../_shared/ivion-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function normalizeBaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

// Ivion API URL from secrets
const IVION_API_URL = normalizeBaseUrl(Deno.env.get('IVION_API_URL') || '');

// Supabase client
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface IvionPoi {
  id?: number;
  titles: Record<string, string>;
  descriptions: Record<string, string>;
  location?: { x: number; y: number; z: number };
  orientation?: { x: number; y: number; z: number; w: number };
  poiType?: { id: number };
  scsLocation?: {
    type: 'Point';
    coordinates: [number, number, number];
  };
  scsOrientation?: { x: number; y: number; z: number; w: number };
  poiTypeId?: number;
  security?: {
    groupRead: number;
    groupWrite: number;
  };
  visibilityCheck?: boolean;
  pointOfView?: {
    imageId: number;
    location: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
    fov: number;
  };
  customData?: string;
  importance?: number;
  icon?: string;
}

// Test connection to Ivion (legacy - use test-connection-auto instead)
async function testConnection(): Promise<{ success: boolean; message: string; details?: string }> {
  try {
    const token = await getIvionToken();
    const configStatus = getIvionConfigStatus();
    return { 
      success: true, 
      message: 'Successfully connected to Ivion API',
      details: `Token obtained (${token.substring(0, 10)}...), URL: ${configStatus.apiUrlPreview}` 
    };
  } catch (error: any) {
    const configStatus = getIvionConfigStatus();
    return { 
      success: false, 
      message: error.message,
      details: `URL: ${configStatus.apiUrlPreview}, Username: ${configStatus.usernamePreview || 'NOT SET'}`
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

// Get a default POI type ID for creating new POIs
async function getDefaultPoiTypeId(siteId: string): Promise<number> {
  try {
    const types = await getPoiTypes(siteId);
    if (types.length > 0) {
      // Try to find a "generic", "default", or "other" type, otherwise use first
      const genericType = types.find((t: any) => 
        t.name?.toLowerCase().includes('generic') ||
        t.name?.toLowerCase().includes('default') ||
        t.name?.toLowerCase().includes('other') ||
        t.name?.toLowerCase().includes('standard')
      );
      return genericType?.id || types[0].id;
    }
  } catch (e) {
    console.log('Could not fetch POI types, using default 1:', e);
  }
  return 1; // Fallback to ID 1
}

// Format IFC asset type to readable name
function formatAssetTypeName(type: string | null): string {
  if (!type) return 'Unnamed';
  return type
    .replace(/^Ifc/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
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
  
  // Get default POI type for this site
  const poiTypeId = await getDefaultPoiTypeId(siteId);
  
  // Get display name with intelligent fallbacks
  const displayName = asset.name || asset.common_name || formatAssetTypeName(asset.asset_type) || 'Unnamed';
  
  // Build POI data with all required Ivion fields
  const poiData: Partial<IvionPoi> = {
    titles: { sv: displayName },
    descriptions: { sv: (asset.attributes as any)?.description || '' },
    // Required: scsLocation as GeoJSON Point
    scsLocation: {
      type: 'Point',
      coordinates: [
        asset.coordinate_x || 0,
        asset.coordinate_y || 0,
        asset.coordinate_z || 0,
      ],
    },
    // Required: scsOrientation quaternion
    scsOrientation: { x: 0, y: 0, z: 0, w: 1 },
    // Required: poiTypeId
    poiTypeId,
    // Required: security permissions (0 = public/all users)
    security: {
      groupRead: 0,
      groupWrite: 0,
    },
    // Required: visibilityCheck
    visibilityCheck: false,
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
          const token = await getIvionToken(params.buildingFmGuid);
          const configStatus = getIvionConfigStatus();
          result = {
            success: true,
            message: 'Token obtained',
            tokenPreview: token ? token.substring(0, 12) + '...' : null,
            ...configStatus,
          };
        } catch (e: any) {
          const configStatus = getIvionConfigStatus();
          result = {
            success: false,
            message: e?.message || String(e),
            ...configStatus,
          };
        }
        break;

      case 'test-connection-auto':
        // Test connection with automatic authentication (includes buildingFmGuid for token caching)
        result = await testIvionConnection(params.buildingFmGuid);
        break;

      case 'get-config-status':
        // Get configuration status for UI display
        result = getIvionConfigStatus();
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

      // ================== MANDATE AUTH FLOW ==================
      case 'mandate-request':
        // Start the OAuth-like mandate flow
        // Returns authorization_token, exchange_token, and authorization_url
        try {
          const mandateResponse = await fetch(`${IVION_API_URL}/api/auth/mandate/request`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
          });
          
          if (!mandateResponse.ok) {
            const errorText = await mandateResponse.text();
            throw new Error(`Mandate request failed: ${mandateResponse.status} - ${errorText.slice(0, 200)}`);
          }
          
          const mandateData = await mandateResponse.json();
          result = {
            success: true,
            authorization_token: mandateData.authorization_token,
            exchange_token: mandateData.exchange_token,
            authorization_url: mandateData.authorization_url || `${IVION_API_URL}/oauth/authorize?token=${mandateData.authorization_token}`,
          };
        } catch (e: any) {
          result = {
            success: false,
            error: e?.message || String(e),
          };
        }
        break;

      case 'mandate-validate':
        // Poll for mandate authorization status
        // Returns: { authorized: boolean, expired: boolean, exchanged: boolean }
        if (!params.authorization_token) throw new Error('authorization_token required');
        try {
          const validateResponse = await fetch(
            `${IVION_API_URL}/api/auth/mandate/validate?authorization_token=${encodeURIComponent(params.authorization_token)}`,
            {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
              },
            }
          );
          
          if (!validateResponse.ok) {
            const errorText = await validateResponse.text();
            throw new Error(`Mandate validation failed: ${validateResponse.status} - ${errorText.slice(0, 200)}`);
          }
          
          const validateData = await validateResponse.json();
          result = {
            success: true,
            authorized: validateData.authorized ?? false,
            expired: validateData.expired ?? false,
            exchanged: validateData.exchanged ?? false,
          };
        } catch (e: any) {
          result = {
            success: false,
            error: e?.message || String(e),
          };
        }
        break;

      case 'mandate-exchange':
        // Exchange mandate for access and refresh tokens
        // Returns: { access_token, refresh_token, principal }
        if (!params.exchange_token) throw new Error('exchange_token required');
        try {
          const exchangeResponse = await fetch(`${IVION_API_URL}/api/auth/mandate/exchange`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ exchange_token: params.exchange_token }),
          });
          
          if (!exchangeResponse.ok) {
            const errorText = await exchangeResponse.text();
            throw new Error(`Mandate exchange failed: ${exchangeResponse.status} - ${errorText.slice(0, 200)}`);
          }
          
          const exchangeData = await exchangeResponse.json();
          
          // Note: Token caching is now handled by ivion-auth.ts
          
          result = {
            success: true,
            access_token: exchangeData.access_token,
            refresh_token: exchangeData.refresh_token,
            principal: exchangeData.principal,
            tokenPreview: exchangeData.access_token ? exchangeData.access_token.substring(0, 12) + '...' : null,
            message: 'Tokens obtained successfully. Update IVION_ACCESS_TOKEN and IVION_REFRESH_TOKEN secrets to persist.',
          };
        } catch (e: any) {
          result = {
            success: false,
            error: e?.message || String(e),
          };
        }
        break;

      // ================== VALIDATE TOKEN ==================
      case 'validate-token':
        // Validate a user-provided token by making a test API call
        if (!params.access_token) throw new Error('access_token required');
        try {
          // Try to list sites to verify the token works
          const testResponse = await fetch(`${IVION_API_URL}/api/sites`, {
            headers: {
              'x-authorization': `Bearer ${params.access_token}`,
              'Accept': 'application/json',
            },
          });
          
          if (testResponse.ok) {
            const sites = await testResponse.json();
            result = {
              success: true,
              message: `Token valid! Found ${Array.isArray(sites) ? sites.length : 0} sites.`,
              siteCount: Array.isArray(sites) ? sites.length : 0,
            };
          } else {
            const errorText = await testResponse.text();
            result = {
              success: false,
              error: `Token invalid: ${testResponse.status} - ${errorText.slice(0, 100)}`,
            };
          }
        } catch (e: any) {
          result = {
            success: false,
            error: e?.message || String(e),
          };
        }
        break;

      // ================== IMAGE POSITION FOR SYNC ==================
      case 'get-image-position':
        // Get position of a specific Ivion panorama image
        if (!params.imageId) throw new Error('imageId required');
        try {
          const token = await getIvionToken(params.buildingFmGuid);
          
          const imageResp = await fetch(`${IVION_API_URL}/api/images/${params.imageId}`, {
            headers: {
              'x-authorization': `Bearer ${token}`,
              'Accept': 'application/json',
            },
          });
          
          if (!imageResp.ok) {
            const errorText = await imageResp.text();
            throw new Error(`Image not found: ${imageResp.status} - ${errorText.slice(0, 100)}`);
          }
          
          const image = await imageResp.json();
          result = {
            success: true,
            id: image.id,
            location: image.location, // {x, y, z} in meters (local Ivion coordinates)
            orientation: image.orientation,
            datasetId: image.datasetId,
          };
        } catch (e: any) {
          result = {
            success: false,
            error: e?.message || String(e),
          };
        }
        break;

      case 'get-images-for-site':
        // Get all images for a site (for finding nearest image in sync)
        if (!params.siteId) throw new Error('siteId required');
        try {
          const token = await getIvionToken(params.buildingFmGuid);
          
          // First get datasets for the site
          const datasetsResp = await fetch(`${IVION_API_URL}/api/site/${params.siteId}/datasets`, {
            headers: {
              'x-authorization': `Bearer ${token}`,
              'Accept': 'application/json',
            },
          });
          
          if (!datasetsResp.ok) {
            throw new Error(`Failed to get datasets: ${datasetsResp.status}`);
          }
          
          const datasets = await datasetsResp.json();
          
          // Get images for each dataset (limit to first 2 datasets to avoid timeout)
          const allImages: Array<{ id: number; location: { x: number; y: number; z: number }; datasetId: number }> = [];
          const datasetsToProcess = datasets.slice(0, 2);
          
          for (const ds of datasetsToProcess) {
            try {
              const imagesResp = await fetch(`${IVION_API_URL}/api/dataset/${ds.id}/images?limit=500`, {
                headers: {
                  'x-authorization': `Bearer ${token}`,
                  'Accept': 'application/json',
                },
              });
              
              if (imagesResp.ok) {
                const images = await imagesResp.json();
                const imageList = Array.isArray(images) ? images : (images.items || []);
                allImages.push(...imageList.map((img: any) => ({
                  id: img.id,
                  location: img.location,
                  datasetId: ds.id,
                })));
              }
            } catch (e) {
              console.log(`Failed to load images for dataset ${ds.id}:`, e);
            }
          }
          
          result = {
            success: true,
            images: allImages,
            totalDatasets: datasets.length,
            processedDatasets: datasetsToProcess.length,
          };
        } catch (e: any) {
          result = {
            success: false,
            error: e?.message || String(e),
            images: [],
          };
        }
        break;

      case 'get-login-token':
        // Return a valid Ivion JWT for frontend SDK loginToken authentication
        // This reuses the existing token management (cached, refreshed, or new login)
        try {
          let token = await getIvionToken(params.buildingFmGuid || null);
          
          // Parse token expiry -- if less than 5 min remaining, force a fresh login
          let expiresInMs = 10 * 60 * 1000; // Default 10 min
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1]));
              if (payload.exp) {
                const expiresAt = payload.exp * 1000;
                expiresInMs = Math.max(0, expiresAt - Date.now() - 60000);
                
                // If token has less than 5 min left, force refresh/re-login
                const remainingMs = expiresAt - Date.now();
                if (remainingMs < 300000) {
                  console.log(`[get-login-token] Token has only ${Math.round(remainingMs / 1000)}s left, forcing refresh`);
                  // Force a fresh token by clearing the cached one and re-authenticating
                  token = await getIvionToken(null); // bypass cache
                  // Save fresh token to building_settings
                  if (params.buildingFmGuid) {
                    const { expiresAt: newExp } = parseTokenExpiry(token);
                    const supabaseAdmin = createClient(
                      Deno.env.get('SUPABASE_URL')!,
                      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
                    );
                    await supabaseAdmin.from('building_settings').update({
                      ivion_access_token: token,
                      ivion_token_expires_at: newExp?.toISOString() || null,
                    }).eq('fm_guid', params.buildingFmGuid);
                  }
                  // Recalculate expiry
                  const p2 = token.split('.');
                  if (p2.length === 3) {
                    const pl2 = JSON.parse(atob(p2[1]));
                    if (pl2.exp) {
                      expiresInMs = Math.max(0, pl2.exp * 1000 - Date.now() - 60000);
                    }
                  }
                }
              }
            }
          } catch {
            // Use default expiry
          }
          
          result = {
            success: true,
            loginToken: token,
            expiresInMs,
          };
        } catch (e: any) {
          result = {
            success: false,
            error: e?.message || String(e),
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
