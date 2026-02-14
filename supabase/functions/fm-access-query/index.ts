import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FmAccessConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  apiUrl: string;
  username?: string;
  password?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

// Cache for token and version
let tokenCache: { token: string; expiresAt: number } | null = null;
let versionIdCache: { versionId: string; fetchedAt: number } | null = null;

/**
 * Get FM Access token using client_credentials grant
 */
async function getToken(config: FmAccessConfig): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  console.log('FM Access: Fetching new token from', config.tokenUrl);

  const params = new URLSearchParams();
  params.set('client_id', config.clientId);
  
  if (config.clientSecret) {
    params.set('client_secret', config.clientSecret);
  }

  if (config.username && config.password) {
    params.set('grant_type', 'password');
    params.set('username', config.username);
    params.set('password', config.password);
  } else {
    params.set('grant_type', 'client_credentials');
  }

  const body = params.toString();

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('FM Access token error:', response.status, errorText);
    throw new Error(`Token request failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as TokenResponse;
  
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  console.log('FM Access: Token obtained, expires in', data.expires_in, 'seconds');
  return data.access_token;
}

/**
 * Get FM Access system version ID (required header for most API calls)
 */
async function getVersionId(config: FmAccessConfig, token: string): Promise<string> {
  if (versionIdCache && Date.now() - versionIdCache.fetchedAt < 5 * 60 * 1000) {
    return versionIdCache.versionId;
  }

  console.log('FM Access: Fetching version ID from', config.apiUrl);

  try {
    const response = await fetch(`${config.apiUrl}/api/systeminfo/json`, {
      headers: { 'X-Authorization': `Bearer ${token}` },
    });
    if (response.ok) {
      const data = await response.json();
      console.log('FM Access: systeminfo response:', JSON.stringify(data).substring(0, 500));
      const versionId = data.defaultVersion?.versionId || data.defaultVersion?.defaultVersionId || data.versionId;
      if (versionId) {
        versionIdCache = { versionId: String(versionId), fetchedAt: Date.now() };
        console.log('FM Access: Version ID obtained:', versionId);
        return String(versionId);
      }
    } else {
      const text = await response.text();
      console.log('FM Access: systeminfo returned', response.status, text.substring(0, 100));
    }
  } catch (e) {
    console.log('FM Access: systeminfo error:', e.message);
  }

  console.log('FM Access: Could not get versionId, proceeding without it');
  versionIdCache = { versionId: '', fetchedAt: Date.now() };
  return '';
}

/**
 * Make an authenticated FM Access API call.
 * FIX: Only set Content-Type: application/json for non-GET requests.
 */
async function fmAccessFetch(
  config: FmAccessConfig,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await getToken(config);
  const versionId = await getVersionId(config, token);

  const url = `${config.apiUrl}${path}`;
  const method = (options.method || 'GET').toUpperCase();
  console.log('FM Access: Calling', method, url);

  const headers: Record<string, string> = {
    ...options.headers as Record<string, string>,
    'X-Authorization': `Bearer ${token}`,
  };
  // Only set Content-Type for requests that have a body
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = 'application/json';
  }
  if (versionId) {
    headers['X-Hdc-Version-Id'] = versionId;
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

// ── Shared helpers for building/floor resolution ────────────────────

function findNodesByClassId(nodes: any[], classId: number): any[] {
  const results: any[] = [];
  for (const node of nodes) {
    if ((node.classId || node.ClassId) === classId) results.push(node);
    const children = node.children || node.Children || [];
    if (children.length > 0) results.push(...findNodesByClassId(children, classId));
  }
  return results;
}

function findDrawingUnder(node: any): any | null {
  const children = node.children || node.Children || [];
  for (const child of children) {
    if ((child.classId || child.ClassId) === 106) return child;
  }
  for (const child of children) {
    const found = findDrawingUnder(child);
    if (found) return found;
  }
  return null;
}

function findFirstDrawing(nodes: any[]): any | null {
  for (const node of nodes) {
    if ((node.classId || node.ClassId) === 106) return node;
    const children = node.children || node.Children || [];
    if (children.length > 0) {
      const found = findFirstDrawing(children);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolve FM Access building GUID from perspective root if not provided.
 * Returns the resolved GUID or null.
 */
async function resolveBuildingGuid(
  config: FmAccessConfig,
  buildingName: string,
  buildingId?: string,
  providedGuid?: string
): Promise<string | null> {
  if (providedGuid) return providedGuid;
  if (!buildingName) return null;

  console.log('FM Access: Looking up building by name:', buildingName);
  try {
    const rootResp = await fmAccessFetch(config, '/api/perspective/root/json/8');
    if (!rootResp.ok) {
      console.log('FM Access: Perspective root returned', rootResp.status);
      return null;
    }
    const rootData = await rootResp.json();
    const rootNodes = Array.isArray(rootData) ? rootData : (rootData.children || rootData.Children || [rootData]);

    const normalizedName = buildingName.toLowerCase().trim();
    let match = rootNodes.find((n: any) => {
      const name = (n.objectName || n.ObjectName || n.name || '').toLowerCase().trim();
      return name === normalizedName;
    });
    if (!match) {
      match = rootNodes.find((n: any) => {
        const name = (n.objectName || n.ObjectName || n.name || '').toLowerCase().trim();
        return name.includes(normalizedName) || normalizedName.includes(name);
      });
    }
    if (!match) {
      const names = rootNodes.map((n: any) => n.objectName || n.ObjectName || n.name || '(unnamed)');
      console.log('FM Access: No match for "' + buildingName + '", available:', JSON.stringify(names));
      return null;
    }

    const guid = match.systemGuid || match.objectGuid || match.ObjectGuid || match.guid || match.Guid;
    console.log('FM Access: Matched building:', match.objectName || match.ObjectName, '-> GUID:', guid);

    // Cache resolved GUID in building_settings
    if (buildingId && guid) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        if (supabaseUrl && serviceRoleKey) {
          await fetch(`${supabaseUrl}/rest/v1/building_settings?fm_guid=eq.${encodeURIComponent(buildingId)}`, {
            method: 'PATCH',
            headers: {
              'apikey': serviceRoleKey,
              'Authorization': `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ fm_access_building_guid: guid }),
          });
        }
      } catch (e) {
        console.log('FM Access: Failed to cache GUID:', e.message);
      }
    }

    return guid;
  } catch (e) {
    console.log('FM Access: Building lookup failed:', e.message);
    return null;
  }
}

/**
 * Resolve the drawing objectId for a given building GUID and optional floor name.
 */
async function resolveDrawingObjectId(
  config: FmAccessConfig,
  buildingGuid: string,
  floorName?: string,
  floorId?: string,
  buildingId?: string
): Promise<string | null> {
  const lookupGuid = buildingGuid || floorId || buildingId;
  if (!lookupGuid) return null;

  console.log('FM Access: Looking up drawing for guid', lookupGuid, 'floorName:', floorName || '(none)');

  const treeResp = await fmAccessFetch(config, `/api/perspective/byguid/subtree/json/8/${encodeURIComponent(lookupGuid)}`);
  if (!treeResp.ok) {
    const errText = await treeResp.text();
    console.log('FM Access: perspective tree error', treeResp.status, errText.substring(0, 200));
    return null;
  }

  const treeData = await treeResp.json();
  const treeNodes = Array.isArray(treeData) ? treeData : (treeData.children || treeData.Children || [treeData]);

  // Try floor name match first
  if (floorName && buildingGuid) {
    const floorNodes = findNodesByClassId(treeNodes, 105);
    console.log('FM Access: Found', floorNodes.length, 'floor nodes (classId 105)');
    const normalizedFloorName = floorName.toLowerCase().trim();

    let matchedFloor = floorNodes.find(n => {
      const name = (n.objectName || n.ObjectName || n.name || '').toLowerCase().trim();
      return name === normalizedFloorName;
    });
    if (!matchedFloor) {
      matchedFloor = floorNodes.find(n => {
        const name = (n.objectName || n.ObjectName || n.name || '').toLowerCase().trim();
        return name.includes(normalizedFloorName) || normalizedFloorName.includes(name);
      });
    }
    if (matchedFloor) {
      console.log('FM Access: Matched floor:', matchedFloor.objectName || matchedFloor.ObjectName);
      const drawing = findDrawingUnder(matchedFloor);
      if (drawing) {
        const id = drawing.objectId || drawing.ObjectId || drawing.id || drawing.Id || null;
        console.log('FM Access: Found drawing under floor, objectId:', id);
        return id ? String(id) : null;
      }
    }
  }

  // Fallback: first drawing in tree
  const drawingNode = findFirstDrawing(treeNodes);
  if (drawingNode) {
    const id = drawingNode.objectId || drawingNode.ObjectId || drawingNode.id || drawingNode.Id || null;
    console.log('FM Access: Using fallback drawing, objectId:', id);
    return id ? String(id) : null;
  }

  console.log('FM Access: No drawing found in perspective tree');
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    const config: FmAccessConfig = {
      tokenUrl: Deno.env.get('FM_ACCESS_TOKEN_URL') || 'https://auth.bim.cloud/auth/realms/swg_demo/protocol/openid-connect/token',
      clientId: Deno.env.get('FM_ACCESS_CLIENT_ID') || 'HDCAgent Basic',
      clientSecret: Deno.env.get('FM_ACCESS_CLIENT_SECRET'),
      apiUrl: (Deno.env.get('FM_ACCESS_API_URL') || '').replace(/\/+$/, ''),
      username: Deno.env.get('FM_ACCESS_USERNAME'),
      password: Deno.env.get('FM_ACCESS_PASSWORD'),
    };

    if (!config.apiUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'FM_ACCESS_API_URL is not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    switch (action) {
      case 'test-connection': {
        try {
          const token = await getToken(config);
          const versionId = await getVersionId(config, token);
          return new Response(
            JSON.stringify({ success: true, message: `Connected. Version ID: ${versionId}`, versionId }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'get-token': {
        try {
          const token = await getToken(config);
          const versionId = await getVersionId(config, token);
          return new Response(
            JSON.stringify({ success: true, token, versionId }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // ── NEW: get-embed-config — returns everything needed for iframe embedding ──
      case 'get-embed-config': {
        const { buildingId, floorName, fmAccessBuildingGuid, buildingName } = params;
        try {
          const token = await getToken(config);
          const versionId = await getVersionId(config, token);

          // Resolve building GUID
          const resolvedGuid = await resolveBuildingGuid(config, buildingName, buildingId, fmAccessBuildingGuid);

          // Resolve drawing objectId
          let drawingObjectId: string | null = null;
          if (resolvedGuid || buildingId) {
            drawingObjectId = await resolveDrawingObjectId(
              config,
              resolvedGuid || '',
              floorName,
              undefined,
              buildingId
            );
          }

          const embedUrl = `${config.apiUrl}/client/?awaitConfig=true`;

          return new Response(
            JSON.stringify({
              success: true,
              embedUrl,
              apiUrl: config.apiUrl,
              token,
              versionId,
              drawingObjectId,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'get-viewer-url': {
        const { buildingId, floorId, floorName, buildingName } = params;
        let { fmAccessBuildingGuid } = params;
        try {
          const token = await getToken(config);
          const versionId = await getVersionId(config, token);

          // Resolve building GUID
          const resolvedGuid = await resolveBuildingGuid(config, buildingName, buildingId, fmAccessBuildingGuid);
          fmAccessBuildingGuid = resolvedGuid || fmAccessBuildingGuid;

          // Resolve drawing objectId
          const drawingObjectId = await resolveDrawingObjectId(
            config,
            fmAccessBuildingGuid || '',
            floorName,
            floorId,
            buildingId
          );

          // Build viewer URL (kept for backward compat, but frontend should use get-embed-config)
          let viewerUrl: string;
          if (drawingObjectId) {
            viewerUrl = `${config.apiUrl}/viewer/2d?objectId=${encodeURIComponent(drawingObjectId)}&token=${encodeURIComponent(token)}&versionId=${encodeURIComponent(versionId)}`;
          } else {
            viewerUrl = `${config.apiUrl}/viewer/2d?floorId=${encodeURIComponent(floorId || '')}&token=${encodeURIComponent(token)}&versionId=${encodeURIComponent(versionId)}`;
          }

          return new Response(
            JSON.stringify({ success: true, url: viewerUrl, token, versionId, drawingObjectId }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'get-drawings': {
        const { buildingId } = params;
        if (!buildingId) {
          return new Response(
            JSON.stringify({ success: false, error: 'buildingId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const response = await fmAccessFetch(config, `/api/drawings?buildingId=${encodeURIComponent(buildingId)}`);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = null; }
        return new Response(
          JSON.stringify({ success: response.ok, data: data || [], error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-documents': {
        const { buildingId } = params;
        if (!buildingId) {
          return new Response(
            JSON.stringify({ success: false, error: 'buildingId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const response = await fmAccessFetch(config, `/api/documents?buildingId=${encodeURIComponent(buildingId)}`);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = null; }
        return new Response(
          JSON.stringify({ success: response.ok, data: data || [], error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-document': {
        const { documentId } = params;
        if (!documentId) {
          return new Response(
            JSON.stringify({ success: false, error: 'documentId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const response = await fmAccessFetch(config, `/api/documents/${encodeURIComponent(documentId)}`);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = null; }
        return new Response(
          JSON.stringify({ success: response.ok, data, error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-drawing-pdf': {
        const { drawingId } = params;
        if (!drawingId) {
          return new Response(
            JSON.stringify({ success: false, error: 'drawingId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const token = await getToken(config);
        const versionId = await getVersionId(config, token);
        return new Response(
          JSON.stringify({
            success: true,
            url: `${config.apiUrl}/api/drawings/${encodeURIComponent(drawingId)}/pdf`,
            headers: { 'Authorization': `Bearer ${token}`, 'X-Hdc-Version-Id': versionId },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-floors': {
        const { buildingFmGuid } = params;
        if (!buildingFmGuid) {
          return new Response(
            JSON.stringify({ success: false, error: 'buildingFmGuid is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const response = await fmAccessFetch(config, `/api/floors?buildingId=${encodeURIComponent(buildingFmGuid)}`);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = null; }
        return new Response(
          JSON.stringify({ success: response.ok, data: data || [], error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-object-by-guid': {
        const { guid } = params;
        if (!guid) {
          return new Response(
            JSON.stringify({ success: false, error: 'guid is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const response = await fmAccessFetch(config, `/api/object/byguid/json/${encodeURIComponent(guid)}`);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        return new Response(
          JSON.stringify({ success: response.ok, data, error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-classes': {
        const response = await fmAccessFetch(config, '/api/config/classes/json');
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        return new Response(
          JSON.stringify({ success: response.ok, data, error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'search-objects': {
        const { query } = params;
        if (!query) {
          return new Response(
            JSON.stringify({ success: false, error: 'query is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const response = await fmAccessFetch(config, `/api/search/quick?query=${encodeURIComponent(query)}`);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        return new Response(
          JSON.stringify({ success: response.ok, data, error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-perspective-tree': {
        const { guid, perspectiveId = '8' } = params;
        if (!guid) {
          return new Response(
            JSON.stringify({ success: false, error: 'guid is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const response = await fmAccessFetch(config, `/api/perspective/byguid/subtree/json/${encodeURIComponent(perspectiveId)}/${encodeURIComponent(guid)}`);
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        return new Response(
          JSON.stringify({ success: response.ok, data, error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-buildings': {
        const response = await fmAccessFetch(config, '/api/systeminfo/json');
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = null; }
        return new Response(
          JSON.stringify({ success: response.ok, data, note: 'Use get-perspective-tree to find buildings.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'proxy': {
        const { path: apiPath, method: apiMethod, body: apiBody } = params;
        if (!apiPath) {
          return new Response(
            JSON.stringify({ success: false, error: 'path is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const response = await fmAccessFetch(config, apiPath, {
          method: apiMethod || 'GET',
          ...(apiBody ? { body: JSON.stringify(apiBody) } : {}),
        });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        return new Response(
          JSON.stringify({ success: response.ok, status: response.status, data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: any) {
    console.error('FM Access query error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
