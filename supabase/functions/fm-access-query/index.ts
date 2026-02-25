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

          // Build dedicated 2D viewer URL (stripped UI, only drawing + filter)
          const viewer2dUrl = drawingObjectId
            ? `${config.apiUrl}/viewer/2d?objectId=${encodeURIComponent(drawingObjectId)}&token=${encodeURIComponent(token)}&versionId=${encodeURIComponent(versionId)}`
            : `${config.apiUrl}/viewer/2d?token=${encodeURIComponent(token)}&versionId=${encodeURIComponent(versionId)}`;

          return new Response(
            JSON.stringify({
              success: true,
              embedUrl,
              viewer2dUrl,
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

      // ── CRUD operations for FM Access objects ──────────────────────

      case 'create-object': {
        const { parentGuid, name, classId, properties } = params;
        if (!parentGuid || !name) {
          return new Response(
            JSON.stringify({ success: false, error: 'parentGuid and name are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Build object payload for HDC API
        const objectPayload: any = {
          objectName: name,
          parentGuid: parentGuid,
        };
        if (classId) objectPayload.classId = classId;
        if (properties && typeof properties === 'object') {
          objectPayload.properties = properties;
        }

        try {
          const response = await fmAccessFetch(config, '/api/object', {
            method: 'POST',
            body: JSON.stringify(objectPayload),
          });
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } catch { data = text; }

          if (!response.ok) {
            return new Response(
              JSON.stringify({ success: false, error: `FM Access returned ${response.status}`, data }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          return new Response(
            JSON.stringify({ success: true, data }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'update-object': {
        const { guid, objectId, name: objName, properties: objProps } = params;
        const targetId = objectId || guid;
        if (!targetId) {
          return new Response(
            JSON.stringify({ success: false, error: 'guid or objectId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const updatePayload: any = {};
        if (objName) updatePayload.objectName = objName;
        if (objProps && typeof objProps === 'object') {
          updatePayload.properties = objProps;
        }

        try {
          // Try by GUID first, fall back to objectId
          const path = guid
            ? `/api/object/byguid/${encodeURIComponent(guid)}`
            : `/api/object/${encodeURIComponent(targetId)}`;

          const response = await fmAccessFetch(config, path, {
            method: 'PUT',
            body: JSON.stringify(updatePayload),
          });
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } catch { data = text; }

          return new Response(
            JSON.stringify({ success: response.ok, data, error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'delete-object': {
        const { guid: delGuid, objectId: delObjectId } = params;
        const delTarget = delObjectId || delGuid;
        if (!delTarget) {
          return new Response(
            JSON.stringify({ success: false, error: 'guid or objectId is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          const path = delGuid
            ? `/api/object/byguid/${encodeURIComponent(delGuid)}`
            : `/api/object/${encodeURIComponent(delTarget)}`;

          const response = await fmAccessFetch(config, path, {
            method: 'DELETE',
          });
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } catch { data = text; }

          return new Response(
            JSON.stringify({ success: response.ok, data, error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'get-hierarchy': {
        const { buildingFmGuid, perspectiveId = '8' } = params;
        if (!buildingFmGuid) {
          return new Response(
            JSON.stringify({ success: false, error: 'buildingFmGuid is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          // Get full subtree: Fastighet → Byggnad → Plan → Rum → Objekt
          const response = await fmAccessFetch(
            config,
            `/api/perspective/byguid/subtree/json/${encodeURIComponent(perspectiveId)}/${encodeURIComponent(buildingFmGuid)}`
          );
          const text = await response.text();
          let data;
          try { data = JSON.parse(text); } catch { data = text; }

          return new Response(
            JSON.stringify({ success: response.ok, data, error: !response.ok ? `FM Access returned ${response.status}` : undefined }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'sync-object': {
        // Smart sync: check if object exists by GUID, create or update accordingly
        const { fmGuid, name: syncName, parentGuid: syncParentGuid, properties: syncProps, localUpdatedAt } = params;
        if (!fmGuid) {
          return new Response(
            JSON.stringify({ success: false, error: 'fmGuid is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          // 1. Check if object exists in FM Access
          const checkResp = await fmAccessFetch(config, `/api/object/byguid/json/${encodeURIComponent(fmGuid)}`);
          const checkText = await checkResp.text();
          let existingObj: any = null;
          try { existingObj = JSON.parse(checkText); } catch { existingObj = null; }

          // Log the raw response to diagnose field names
          console.log(`FM Access: byguid response status=${checkResp.status}, keys=${existingObj ? Object.keys(existingObj).join(',') : 'null'}, snippet=${checkText.substring(0, 300)}`);

          // Broaden existence check: any 200 OK with a valid object (not an error message)
          const objectExists = checkResp.ok && existingObj && typeof existingObj === 'object' && !existingObj.error && !existingObj.Error &&
            (existingObj.objectId || existingObj.ObjectId || existingObj.id || existingObj.Id ||
             existingObj.objectName || existingObj.ObjectName || existingObj.name || existingObj.Name ||
             existingObj.guid || existingObj.Guid || existingObj.systemGuid || existingObj.SystemGuid);

          if (objectExists) {
            // Object exists — compare and decide direction
            const remoteUpdated = existingObj.modifiedDate || existingObj.ModifiedDate || existingObj.updatedDate || existingObj.UpdatedDate || null;
            const remoteProps: Record<string, any> = {};
            
            // Extract properties from FM Access object
            const propArray = existingObj.properties || existingObj.Properties || [];
            if (Array.isArray(propArray)) {
              for (const p of propArray) {
                const pName = p.name || p.Name || p.propertyName || p.PropertyName || '';
                const pValue = p.value ?? p.Value ?? p.propertyValue ?? p.PropertyValue ?? null;
                if (pName) remoteProps[pName] = pValue;
              }
            }

            // Determine sync direction based on timestamps
            let direction: 'push' | 'pull' | 'none' = 'none';
            if (localUpdatedAt && remoteUpdated) {
              const localTime = new Date(localUpdatedAt).getTime();
              const remoteTime = new Date(remoteUpdated).getTime();
              direction = localTime > remoteTime ? 'push' : (remoteTime > localTime ? 'pull' : 'none');
            } else if (syncProps && Object.keys(syncProps).length > 0) {
              direction = 'push'; // default to push if no timestamps available
            }

            if (direction === 'push' && syncProps && Object.keys(syncProps).length > 0) {
              // Push local changes to FM Access
              const updatePayload: any = {};
              if (syncName) updatePayload.objectName = syncName;
              updatePayload.properties = syncProps;

              const updateResp = await fmAccessFetch(config, `/api/object/byguid/${encodeURIComponent(fmGuid)}`, {
                method: 'PUT',
                body: JSON.stringify(updatePayload),
              });
              const updateText = await updateResp.text();
              let updateData: any;
              try { updateData = JSON.parse(updateText); } catch { updateData = updateText; }

              return new Response(
                JSON.stringify({ 
                  success: updateResp.ok, 
                  action: 'updated', 
                  direction: 'push',
                  data: updateData,
                  error: !updateResp.ok ? `FM Access returned ${updateResp.status}` : undefined 
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            } else if (direction === 'pull') {
              // Return remote data so client can update local DB
              return new Response(
                JSON.stringify({ 
                  success: true, 
                  action: 'pull', 
                  direction: 'pull',
                  remoteObject: existingObj,
                  remoteProperties: remoteProps,
                  remoteName: existingObj.objectName || existingObj.ObjectName || null,
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            } else {
              return new Response(
                JSON.stringify({ success: true, action: 'none', direction: 'none', message: 'Object in sync' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          } else {
            // Object does NOT exist — create it
            if (!syncParentGuid || !syncName) {
              return new Response(
                JSON.stringify({ success: false, error: 'Object not found in FM Access and parentGuid+name required for creation', action: 'skip' }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }

            const createPayload: any = {
              objectName: syncName,
              parentGuid: syncParentGuid,
              systemGuid: fmGuid,
            };
            if (syncProps && Object.keys(syncProps).length > 0) {
              createPayload.properties = syncProps;
            }

            const createResp = await fmAccessFetch(config, '/api/object', {
              method: 'POST',
              body: JSON.stringify(createPayload),
            });
            const createText = await createResp.text();
            let createData: any;
            try { createData = JSON.parse(createText); } catch { createData = createText; }

            return new Response(
              JSON.stringify({ 
                success: createResp.ok, 
                action: 'created', 
                direction: 'push',
                data: createData,
                error: !createResp.ok ? `FM Access returned ${createResp.status}` : undefined 
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // ── Ensure full building hierarchy exists in FM Access ──────────
      case 'ensure-hierarchy': {
        const { buildingFmGuid, buildingName, complexName, levels, rooms } = params;
        if (!buildingFmGuid || !buildingName) {
          return new Response(
            JSON.stringify({ success: false, error: 'buildingFmGuid and buildingName are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        try {
          const created: string[] = [];
          const skipped: string[] = [];

          // 1. Check if building already exists in FM Access
          const checkResp = await fmAccessFetch(config, `/api/object/byguid/json/${encodeURIComponent(buildingFmGuid)}`);
          const checkText = await checkResp.text();
          let existingObj: any = null;
          try { existingObj = JSON.parse(checkText); } catch { existingObj = null; }

          const buildingExists = checkResp.ok && existingObj && typeof existingObj === 'object' && !existingObj.error && !existingObj.Error &&
            (existingObj.objectId || existingObj.ObjectId || existingObj.id || existingObj.Id ||
             existingObj.objectName || existingObj.ObjectName || existingObj.name || existingObj.Name ||
             existingObj.guid || existingObj.Guid || existingObj.systemGuid || existingObj.SystemGuid);

          if (buildingExists) {
            console.log('FM Access ensure-hierarchy: Building already exists:', buildingName);
            return new Response(
              JSON.stringify({ success: true, action: 'skipped', message: 'Building already exists in FM Access', created, skipped: ['building'] }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          console.log('FM Access ensure-hierarchy: Building not found, creating hierarchy for:', buildingName);

          // 2. Get perspective root to find parent for Fastighet
          const rootResp = await fmAccessFetch(config, '/api/perspective/root/json/8');
          if (!rootResp.ok) {
            const rootErr = await rootResp.text();
            throw new Error(`Could not get perspective root: ${rootResp.status} ${rootErr.substring(0, 200)}`);
          }
          const rootData = await rootResp.json();
          const rootNodes = Array.isArray(rootData) ? rootData : (rootData.children || rootData.Children || [rootData]);

          // Find root perspective node GUID (first node, usually the system root)
          let rootGuid: string | null = null;
          if (rootNodes.length > 0) {
            const first = rootNodes[0];
            rootGuid = first.systemGuid || first.objectGuid || first.ObjectGuid || first.guid || first.Guid || null;
          }
          if (!rootGuid) {
            throw new Error('Could not determine root perspective GUID');
          }

          console.log('FM Access ensure-hierarchy: Root perspective GUID:', rootGuid);

          // 3. Create Fastighet (classId 102) under root
          const fastighetName = complexName || buildingName;
          // Check if a Fastighet with this name already exists
          let fastighetGuid: string | null = null;
          for (const node of rootNodes) {
            const nodeName = (node.objectName || node.ObjectName || node.name || '').toLowerCase().trim();
            const nodeClassId = node.classId || node.ClassId;
            if (nodeName === fastighetName.toLowerCase().trim() && (nodeClassId === 102 || !nodeClassId)) {
              fastighetGuid = node.systemGuid || node.objectGuid || node.guid || null;
              console.log('FM Access ensure-hierarchy: Found existing Fastighet:', fastighetName, '->', fastighetGuid);
              skipped.push('fastighet');
              break;
            }
          }

          if (!fastighetGuid) {
            const fastighetResp = await fmAccessFetch(config, '/api/object', {
              method: 'POST',
              body: JSON.stringify({ objectName: fastighetName, parentGuid: rootGuid, classId: 102 }),
            });
            const fastighetData = await fastighetResp.json();
            console.log('FM Access ensure-hierarchy: Created Fastighet:', fastighetResp.status, JSON.stringify(fastighetData).substring(0, 300));
            if (!fastighetResp.ok) throw new Error(`Failed to create Fastighet: ${fastighetResp.status}`);
            fastighetGuid = fastighetData.systemGuid || fastighetData.guid || fastighetData.objectGuid || fastighetData.Guid || null;
            if (!fastighetGuid) {
              // Try to look it up after creation
              const lookupResp = await fmAccessFetch(config, '/api/perspective/root/json/8');
              if (lookupResp.ok) {
                const lookupData = await lookupResp.json();
                const lookupNodes = Array.isArray(lookupData) ? lookupData : (lookupData.children || lookupData.Children || []);
                const match = lookupNodes.find((n: any) => (n.objectName || n.ObjectName || '').toLowerCase().trim() === fastighetName.toLowerCase().trim());
                if (match) fastighetGuid = match.systemGuid || match.objectGuid || match.guid || null;
              }
            }
            created.push('fastighet');
          }

          if (!fastighetGuid) throw new Error('Could not determine Fastighet GUID after creation');

          // 4. Create Byggnad (classId 103) under Fastighet
          const byggnadResp = await fmAccessFetch(config, '/api/object', {
            method: 'POST',
            body: JSON.stringify({ objectName: buildingName, parentGuid: fastighetGuid, classId: 103, systemGuid: buildingFmGuid }),
          });
          const byggnadData = await byggnadResp.json();
          console.log('FM Access ensure-hierarchy: Created Byggnad:', byggnadResp.status, JSON.stringify(byggnadData).substring(0, 300));
          if (!byggnadResp.ok) throw new Error(`Failed to create Byggnad: ${byggnadResp.status}`);
          const byggnadGuid = byggnadData.systemGuid || byggnadData.guid || byggnadData.objectGuid || buildingFmGuid;
          created.push('byggnad');

          // 5. Create Plans (classId 105) under Byggnad
          const levelGuids: Record<string, string> = {};
          const levelArray = Array.isArray(levels) ? levels : [];
          for (const level of levelArray) {
            try {
              const planResp = await fmAccessFetch(config, '/api/object', {
                method: 'POST',
                body: JSON.stringify({ objectName: level.name || 'Plan', parentGuid: byggnadGuid, classId: 105, systemGuid: level.fmGuid }),
              });
              const planData = await planResp.json();
              console.log('FM Access ensure-hierarchy: Created Plan:', level.name, planResp.status);
              if (planResp.ok) {
                levelGuids[level.fmGuid] = planData.systemGuid || planData.guid || level.fmGuid;
                created.push(`plan:${level.name}`);
              }
            } catch (e: any) {
              console.error('FM Access ensure-hierarchy: Plan creation failed:', level.name, e.message);
            }
          }

          // 6. Create Rooms (classId 107) under their Plan
          const roomArray = Array.isArray(rooms) ? rooms : [];
          let roomsCreated = 0;
          for (const room of roomArray) {
            const parentGuid = room.levelFmGuid ? (levelGuids[room.levelFmGuid] || room.levelFmGuid) : byggnadGuid;
            try {
              const roomResp = await fmAccessFetch(config, '/api/object', {
                method: 'POST',
                body: JSON.stringify({ objectName: room.name || 'Rum', parentGuid, classId: 107, systemGuid: room.fmGuid }),
              });
              console.log('FM Access ensure-hierarchy: Created Room:', room.name, roomResp.status);
              if (roomResp.ok) roomsCreated++;
            } catch (e: any) {
              console.error('FM Access ensure-hierarchy: Room creation failed:', room.name, e.message);
            }
          }
          if (roomsCreated > 0) created.push(`${roomsCreated} rum`);

          // 7. Update building_settings with FM Access GUID
          try {
            const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
            const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
            if (supabaseUrl && serviceRoleKey) {
              await fetch(`${supabaseUrl}/rest/v1/building_settings?fm_guid=eq.${encodeURIComponent(buildingFmGuid)}`, {
                method: 'PATCH',
                headers: {
                  'apikey': serviceRoleKey,
                  'Authorization': `Bearer ${serviceRoleKey}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({ fm_access_building_guid: byggnadGuid }),
              });
              console.log('FM Access ensure-hierarchy: Updated building_settings with FM Access GUID');
            }
          } catch (e: any) {
            console.log('FM Access ensure-hierarchy: Failed to update building_settings:', e.message);
          }

          return new Response(
            JSON.stringify({ success: true, action: 'created', created, skipped, byggnadGuid }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          console.error('FM Access ensure-hierarchy error:', error.message);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      // ── Discover drawing upload API capabilities ──────────────────
      case 'discover-drawing-api': {
        try {
          const results: Record<string, any> = {};

          // Probe various drawing-related endpoints
          const endpoints = [
            { path: '/api/drawings', method: 'GET', label: 'list-drawings' },
            { path: '/api/drawings', method: 'OPTIONS', label: 'drawings-options' },
            { path: '/api/files', method: 'OPTIONS', label: 'files-options' },
            { path: '/api/files/upload', method: 'OPTIONS', label: 'files-upload-options' },
            { path: '/api/config/classes/json', method: 'GET', label: 'classes' },
          ];

          for (const ep of endpoints) {
            try {
              const resp = await fmAccessFetch(config, ep.path, { method: ep.method });
              const text = await resp.text();
              let data: any;
              try { data = JSON.parse(text); } catch { data = text.substring(0, 500); }
              results[ep.label] = {
                status: resp.status,
                headers: Object.fromEntries(resp.headers.entries()),
                data: typeof data === 'string' ? data : JSON.stringify(data).substring(0, 1000),
              };
            } catch (e: any) {
              results[ep.label] = { error: e.message };
            }
          }

          return new Response(
            JSON.stringify({ success: true, results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
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
