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
        // 1. Try database first
        const { data: dbData, error: dbError } = await supabase
          .from('xkt_models')
          .select('model_id, model_name, file_name')
          .eq('building_fm_guid', buildingFmGuid);

        if (!dbError && dbData && dbData.length > 0) {
          if (!cancelled) {
            setNameEntries(buildEntries(dbData));
            setIsLoading(false);
          }
          return;
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

          // Persist to DB for next time
          for (const m of apiModels) {
            if (!m.name) continue;
            const fileName = m.xktFileUrl
              ? extractModelIdFromUrl(m.xktFileUrl) + '.xkt'
              : (m.id || '');
            if (!fileName) continue;

            supabase.from('xkt_models').upsert({
              building_fm_guid: buildingFmGuid,
              model_id: m.id || fileName,
              model_name: m.name,
              file_name: fileName,
              storage_path: m.xktFileUrl || '',
              source_url: m.xktFileUrl || null,
            }, { onConflict: 'model_id' }).then(({ error }) => {
              if (error) console.debug('Failed to cache model name:', m.name, error.message);
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
