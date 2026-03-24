import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Shared hook for resolving BIM model IDs to friendly names.
 * 
 * Resolution order:
 * 1. `geometry_entity_map` table (canonical mapping layer — authoritative)
 * 2. `xkt_models` database table (fallback)
 * 3. Asset+ `GetModels` API (last resort, persists to DB)
 */
export function useModelNames(buildingFmGuid: string | undefined | null) {
  const [nameEntries, setNameEntries] = useState<[string, string][]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!buildingFmGuid) return;

    let cancelled = false;

    const fetchNames = async () => {
      setIsLoading(true);
      try {
        // Strategy 1 (PRIMARY): geometry_entity_map — canonical source of model names
        const entries = await fetchFromGeometryMap(buildingFmGuid);
        if (entries.length > 0 && !cancelled) {
          setNameEntries(entries);
          setIsLoading(false);
          return;
        }

        // Strategy 2: xkt_models + Asset+ storey attributes (legacy fallback)
        const legacyEntries = await fetchFromLegacySources(buildingFmGuid);
        if (!cancelled) {
          setNameEntries(legacyEntries);
        }
      } catch (e) {
        console.debug('Failed to fetch model names:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchNames();
    return () => { cancelled = true; };
  }, [buildingFmGuid]);

  const modelNamesMap = useMemo(() => new Map(nameEntries), [nameEntries]);

  return { modelNamesMap, isLoading };
}

/**
 * Fetch model names from the canonical geometry_entity_map table.
 * Groups by source_model_guid to find distinct model names.
 */
async function fetchFromGeometryMap(buildingFmGuid: string): Promise<[string, string][]> {
  // Get distinct model names from storey-level mappings (most reliable)
  const { data: storeyMappings, error } = await supabase
    .from('geometry_entity_map' as any)
    .select('model_id, source_model_guid, source_model_name, source_storey_name, asset_fm_guid')
    .eq('building_fm_guid', buildingFmGuid)
    .in('entity_type', ['storey', 'building'] as any);

  if (error || !storeyMappings || storeyMappings.length === 0) return [];

  // Collect unique model names from mappings
  const modelNames = new Map<string, string>();
  for (const m of storeyMappings as any[]) {
    const modelId = m.source_model_guid || m.model_id;
    const modelName = m.source_model_name;
    if (modelId && modelName && !/^[0-9a-f]{8}-/i.test(modelName)) {
      modelNames.set(modelId, modelName);
    }
  }

  if (modelNames.size === 0) return [];

  // Now cross-reference with xkt_models to build file-based entries
  const { data: xktModels } = await supabase
    .from('xkt_models')
    .select('model_id, file_name')
    .eq('building_fm_guid', buildingFmGuid);

  const entries: [string, string][] = [];

  // Add direct model_guid → name entries
  for (const [modelGuid, name] of modelNames) {
    entries.push([modelGuid, name]);
    entries.push([modelGuid.toLowerCase(), name]);
  }

  // Match xkt_models to geometry map model names
  if (xktModels) {
    for (const xkt of xktModels) {
      // Try to find a matching model name
      let bestName: string | null = null;

      // Direct match by model_id in geometry map
      if (modelNames.has(xkt.model_id)) {
        bestName = modelNames.get(xkt.model_id)!;
      }

      // Try discipline letter matching from file name
      if (!bestName) {
        const fileUpper = (xkt.file_name || xkt.model_id || '').toUpperCase();
        for (const [, name] of modelNames) {
          const firstLetter = name.charAt(0).toUpperCase();
          if (fileUpper.includes(`-${firstLetter}-`) ||
              fileUpper.startsWith(`${firstLetter}-`) ||
              fileUpper.includes(`${firstLetter}_`) ||
              fileUpper.startsWith(`${firstLetter}_`)) {
            bestName = name;
            break;
          }
        }
      }

      if (bestName) {
        const fileId = xkt.file_name.replace(/\.xkt$/i, '');
        entries.push([xkt.model_id, bestName]);
        entries.push([xkt.model_id.toLowerCase(), bestName]);
        entries.push([xkt.file_name, bestName]);
        entries.push([xkt.file_name.toLowerCase(), bestName]);
        entries.push([fileId, bestName]);
        entries.push([fileId.toLowerCase(), bestName]);
      }
    }
  }

  return entries;
}

/**
 * Legacy fallback: uses xkt_models + Asset+ storey attributes + API.
 * This is the original resolution logic, kept for buildings that haven't
 * been re-synced with geometry_entity_map yet.
 */
async function fetchFromLegacySources(buildingFmGuid: string): Promise<[string, string][]> {
  // Get BIM model names from Asset+ Building Storey objects
  const { data: storeys } = await supabase
    .from('assets')
    .select('fm_guid, name, common_name, attributes')
    .eq('building_fm_guid', buildingFmGuid)
    .eq('category', 'Building Storey');

  const assetPlusModelNames = new Map<string, string>();
  if (storeys) {
    storeys.forEach((s: any) => {
      const attrs = typeof s.attributes === 'string' ? JSON.parse(s.attributes) : (s.attributes || {});
      const guid = attrs.parentBimObjectId;
      const name = attrs.parentCommonName;
      if (guid && name && !/^[0-9a-f]{8}-/i.test(name)) {
        assetPlusModelNames.set(guid, name);
      }
    });
  }

  // Try xkt_models database table
  const { data: dbData, error: dbError } = await supabase
    .from('xkt_models')
    .select('model_id, model_name, file_name')
    .eq('building_fm_guid', buildingFmGuid);

  if (!dbError && dbData && dbData.length > 0) {
    if (assetPlusModelNames.size > 0) {
      const entries: [string, string][] = [];

      dbData.forEach((m, idx) => {
        let bestName: string | null = null;

        if (m.model_name) {
          for (const [, apName] of assetPlusModelNames) {
            if (m.model_name.toLowerCase().includes(apName.toLowerCase()) ||
                apName.toLowerCase().includes(m.model_name.toLowerCase())) {
              bestName = apName;
              break;
            }
          }
        }

        if (!bestName) {
          const apNames = Array.from(assetPlusModelNames.values());
          const fileUpper = (m.file_name || m.model_id || '').toUpperCase();
          for (const apName of apNames) {
            const firstLetter = apName.charAt(0).toUpperCase();
            if (fileUpper.includes(`-${firstLetter}-`) ||
                fileUpper.startsWith(`${firstLetter}-`) ||
                fileUpper.includes(`${firstLetter}_`) ||
                fileUpper.startsWith(`${firstLetter}_`)) {
              bestName = apName;
              break;
            }
          }
        }

        const displayName = bestName || m.model_name || `Model ${idx + 1}`;
        const fileId = m.file_name.replace(/\.xkt$/i, '');

        entries.push([m.model_id, displayName]);
        entries.push([m.model_id.toLowerCase(), displayName]);
        entries.push([m.file_name, displayName]);
        entries.push([m.file_name.toLowerCase(), displayName]);
        entries.push([fileId, displayName]);
        entries.push([fileId.toLowerCase(), displayName]);

        if (bestName && bestName !== m.model_name) {
          supabase.from('xkt_models')
            .update({ model_name: bestName })
            .eq('building_fm_guid', buildingFmGuid)
            .eq('model_id', m.model_id)
            .then(() => {});
        }
      });

      return entries;
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
    const allGuids = dbData.every(m => !m.model_name || UUID_RE.test(m.model_name));

    if (!allGuids) {
      return buildEntries(dbData);
    }
  }

  // Fallback: Asset+ API
  const [tokenResult, configResult] = await Promise.all([
    supabase.functions.invoke('asset-plus-query', { body: { action: 'getToken' } }),
    supabase.functions.invoke('asset-plus-query', { body: { action: 'getConfig' } })
  ]);

  const accessToken = tokenResult.data?.accessToken;
  const apiUrl = configResult.data?.apiUrl;
  const apiKey = configResult.data?.apiKey;
  if (!accessToken || !apiUrl) return [];

  const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
  const response = await fetch(
    `${baseUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );

  if (!response.ok) return [];

  const apiModels = await response.json();
  const entries: [string, string][] = [];

  apiModels.forEach((m: any) => {
    if (m.id && m.name) {
      entries.push([m.id, m.name]);
      entries.push([m.id.toLowerCase(), m.name]);
    }
    if (m.xktFileUrl && m.name) {
      const fileId = extractModelIdFromUrl(m.xktFileUrl);
      entries.push([fileId, m.name]);
      entries.push([fileId.toLowerCase(), m.name]);
      entries.push([fileId + '.xkt', m.name]);
      entries.push([fileId.toLowerCase() + '.xkt', m.name]);
    }
  });

  // Persist names to DB
  for (const m of apiModels) {
    if (!m.name) continue;
    const fileName = m.xktFileUrl
      ? extractModelIdFromUrl(m.xktFileUrl) + '.xkt'
      : (m.id || '');
    if (!fileName) continue;

    supabase.from('xkt_models')
      .update({ model_name: m.name })
      .eq('building_fm_guid', buildingFmGuid)
      .eq('model_id', m.id || fileName)
      .then(({ error }) => {
        if (error) {
          supabase.from('xkt_models').upsert({
            building_fm_guid: buildingFmGuid,
            model_id: m.id || fileName,
            model_name: m.name,
            file_name: fileName,
            storage_path: m.xktFileUrl || '',
            source_url: m.xktFileUrl || null,
          }, { onConflict: 'model_id' }).then(() => {});
        }
      });
  }

  return entries;
}

function extractModelIdFromUrl(xktFileUrl: string): string {
  const fileName = xktFileUrl.split('/').pop() || '';
  return fileName.replace('.xkt', '');
}

function buildEntries(dbData: { model_id: string; model_name: string | null; file_name: string }[]): [string, string][] {
  const entries: [string, string][] = [];
  dbData.forEach(m => {
    if (m.file_name && m.model_name) {
      entries.push([m.file_name, m.model_name]);
      entries.push([m.file_name.toLowerCase(), m.model_name]);
      const fileId = m.file_name.replace(/\.xkt$/i, '');
      entries.push([fileId, m.model_name]);
      entries.push([fileId.toLowerCase(), m.model_name]);
    }
    if (m.model_id && m.model_name) {
      entries.push([m.model_id, m.model_name]);
      entries.push([m.model_id.toLowerCase(), m.model_name]);
    }
  });
  return entries;
}
