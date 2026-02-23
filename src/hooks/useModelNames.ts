import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Shared hook for resolving BIM model IDs to friendly names.
 * 
 * Resolution order:
 * 1. `xkt_models` database table (fast, cached)
 * 2. Asset+ `GetModels` API (fallback, persists to DB for next time)
 * 
 * Returns a stable `Map<string, string>` mapping model IDs / file names
 * (with and without extension, case-insensitive) to friendly names.
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
        // Strategy 0 (PRIMARY): Get BIM model names from Asset+ Building Storey objects
        // Each storey has parentBimObjectId → parentCommonName which gives the real model name
        const { data: storeys } = await supabase
          .from('assets')
          .select('fm_guid, name, common_name, attributes')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('category', 'Building Storey');

        // Build a map from parentBimObjectId → parentCommonName (the Asset+ model name)
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

        // 1. Try xkt_models database table
        const { data: dbData, error: dbError } = await supabase
          .from('xkt_models')
          .select('model_id, model_name, file_name')
          .eq('building_fm_guid', buildingFmGuid);

        if (!dbError && dbData && dbData.length > 0) {
          // Try to match XKT models to Asset+ model names
          // Asset+ model names are authoritative — use them to override XKT names
          if (assetPlusModelNames.size > 0) {
            const entries: [string, string][] = [];
            
            dbData.forEach((m, idx) => {
              // Try to find an Asset+ name that matches this XKT model
              let bestName: string | null = null;
              
              // Check if the existing model_name matches an Asset+ name
              if (m.model_name) {
                for (const [, apName] of assetPlusModelNames) {
                  if (m.model_name.toLowerCase().includes(apName.toLowerCase()) || 
                      apName.toLowerCase().includes(m.model_name.toLowerCase())) {
                    bestName = apName;
                    break;
                  }
                }
              }
              
              // If no match found, try to match by index (Asset+ models in order)
              if (!bestName) {
                const apNames = Array.from(assetPlusModelNames.values());
                // Try discipline letter matching from file name
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
              
              // Update DB with Asset+ name if we found one
              if (bestName && bestName !== m.model_name) {
                supabase.from('xkt_models')
                  .update({ model_name: bestName })
                  .eq('building_fm_guid', buildingFmGuid)
                  .eq('model_id', m.model_id)
                  .then(() => {});
              }
            });
            
            if (!cancelled) {
              setNameEntries(entries);
              setIsLoading(false);
            }
            return;
          }
          
          // No Asset+ names available — check if DB names are real
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
          const allGuids = dbData.every(m => !m.model_name || UUID_RE.test(m.model_name));
          
          if (!allGuids) {
            if (!cancelled) {
              setNameEntries(buildEntries(dbData));
              setIsLoading(false);
            }
            return;
          }
        }

        // 2. Fallback: Asset+ API
        const [tokenResult, configResult] = await Promise.all([
          supabase.functions.invoke('asset-plus-query', { body: { action: 'getToken' } }),
          supabase.functions.invoke('asset-plus-query', { body: { action: 'getConfig' } })
        ]);

        const accessToken = tokenResult.data?.accessToken;
        const apiUrl = configResult.data?.apiUrl;
        const apiKey = configResult.data?.apiKey;
        if (!accessToken || !apiUrl) { setIsLoading(false); return; }

        const baseUrl = apiUrl.replace(/\/api\/v\d+\/AssetDB\/?$/i, '').replace(/\/+$/, '');
        const response = await fetch(
          `${baseUrl}/api/threed/GetModels?fmGuid=${buildingFmGuid}&apiKey=${apiKey}`,
          { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );

        if (response.ok) {
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

          if (!cancelled) setNameEntries(entries);

          // Persist names to DB - update existing rows or upsert new ones
          for (const m of apiModels) {
            if (!m.name) continue;
            const fileName = m.xktFileUrl
              ? extractModelIdFromUrl(m.xktFileUrl) + '.xkt'
              : (m.id || '');
            if (!fileName) continue;

            // First try to update existing row by model_id
            supabase.from('xkt_models')
              .update({ model_name: m.name })
              .eq('building_fm_guid', buildingFmGuid)
              .eq('model_id', m.id || fileName)
              .then(({ error }) => {
                if (error) {
                  // Fallback: upsert
                  supabase.from('xkt_models').upsert({
                    building_fm_guid: buildingFmGuid,
                    model_id: m.id || fileName,
                    model_name: m.name,
                    file_name: fileName,
                    storage_path: m.xktFileUrl || '',
                    source_url: m.xktFileUrl || null,
                  }, { onConflict: 'model_id' }).then(({ error: e2 }) => {
                    if (e2) console.debug('Failed to cache model name:', m.name, e2.message);
                  });
                }
              });
          }
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
