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
        // Strategy 0: Try to derive names from assets table (Building Storey names)
        const { data: storeys } = await supabase
          .from('assets')
          .select('fm_guid, name, common_name')
          .eq('building_fm_guid', buildingFmGuid)
          .eq('category', 'Building Storey');

        // 1. Try xkt_models database table
        const { data: dbData, error: dbError } = await supabase
          .from('xkt_models')
          .select('model_id, model_name, file_name')
          .eq('building_fm_guid', buildingFmGuid);

        if (!dbError && dbData && dbData.length > 0) {
          // Check if model_names are just GUIDs (not human-readable)
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
          const allGuids = dbData.every(m => !m.model_name || UUID_RE.test(m.model_name));
          
          if (!allGuids) {
            // We have real names - use them
            if (!cancelled) {
              setNameEntries(buildEntries(dbData));
              setIsLoading(false);
            }
            return;
          }
          
          // Strategy 0: Try to match models to storey names via namespace patterns
          if (storeys && storeys.length > 0) {
            const storeyNameMap = new Map<string, string>();
            storeys.forEach((s: any) => {
              const name = s.common_name || s.name;
              if (name) storeyNameMap.set(s.fm_guid.toLowerCase(), name);
            });
            
            // Extract unique namespace prefixes from storey names (e.g. "A", "K", "V")
            // to try to match model files to discipline names
            const namespacePattern = /^([A-Z])-/i;
            const disciplines = new Set<string>();
            storeys.forEach((s: any) => {
              const name = s.common_name || s.name || '';
              // Look for patterns like "01 - A-modell" or model names embedded in storey names
              const match = name.match(namespacePattern);
              if (match) disciplines.add(match[1].toUpperCase());
            });
            
            // If we can derive names from discipline codes in model IDs
            if (disciplines.size > 0 || dbData.length > 0) {
              const derivedEntries: [string, string][] = [];
              const DISCIPLINE_NAMES: Record<string, string> = {
                'A': 'A-modell (Arkitektur)',
                'K': 'K-modell (Konstruktion)',
                'V': 'V-modell (VVS)',
                'E': 'E-modell (El)',
                'S': 'S-modell (Styr)',
                'B': 'B-modell (Brand)',
              };
              
              dbData.forEach((m, idx) => {
                const fileId = m.file_name.replace(/\.xkt$/i, '');
                // Try to find a discipline letter in the model_id or file_name
                let friendlyName: string | null = null;
                
                for (const [letter, fullName] of Object.entries(DISCIPLINE_NAMES)) {
                  if (m.model_id.toUpperCase().includes(`-${letter}-`) ||
                      m.model_id.toUpperCase().startsWith(`${letter}-`) ||
                      m.file_name.toUpperCase().includes(`-${letter}-`) ||
                      m.file_name.toUpperCase().startsWith(`${letter}-`)) {
                    friendlyName = fullName;
                    break;
                  }
                }
                
                if (!friendlyName) {
                  friendlyName = `Modell ${idx + 1}`;
                }
                
                derivedEntries.push([m.model_id, friendlyName]);
                derivedEntries.push([m.model_id.toLowerCase(), friendlyName]);
                derivedEntries.push([m.file_name, friendlyName]);
                derivedEntries.push([m.file_name.toLowerCase(), friendlyName]);
                derivedEntries.push([fileId, friendlyName]);
                derivedEntries.push([fileId.toLowerCase(), friendlyName]);
              });
              
              if (derivedEntries.length > 0 && !cancelled) {
                setNameEntries(derivedEntries);
                setIsLoading(false);
                
                // Persist derived names back to DB
                for (const m of dbData) {
                  const matchEntry = derivedEntries.find(([key]) => key === m.model_id);
                  if (matchEntry) {
                    supabase.from('xkt_models')
                      .update({ model_name: matchEntry[1] })
                      .eq('building_fm_guid', buildingFmGuid)
                      .eq('model_id', m.model_id)
                      .then(({ error: e }) => {
                        if (e) console.debug('Failed to persist derived name:', e.message);
                      });
                  }
                }
                return;
              }
            }
          }
          
          // Names are GUIDs - fall through to API to get real names
          console.debug('Model names in DB are GUIDs, fetching from Asset+ API...');
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
