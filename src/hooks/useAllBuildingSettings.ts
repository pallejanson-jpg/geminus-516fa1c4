import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/context/TenantContext';

interface BuildingSettingsMap {
  [fmGuid: string]: {
    fmGuid: string;
    isFavorite: boolean;
    ivionSiteId: string | null;
    latitude: number | null;
    longitude: number | null;
    heroImageUrl: string | null;
    startViewId: string | null;
  };
}

const CACHE_KEY_PREFIX = 'all-building-settings-cache';

function cacheKey(tenantId: string | null): string {
  return tenantId ? `${CACHE_KEY_PREFIX}:${tenantId}` : CACHE_KEY_PREFIX;
}

function readCache(tenantId: string | null): BuildingSettingsMap | null {
  try {
    const raw = localStorage.getItem(cacheKey(tenantId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeCache(tenantId: string | null, map: BuildingSettingsMap) {
  try {
    localStorage.setItem(cacheKey(tenantId), JSON.stringify(map));
  } catch { /* quota exceeded */ }
}

/**
 * Hook to fetch building_settings for the currently selected tenant.
 * Uses stale-while-revalidate: returns cached data instantly, then refreshes in background.
 */
export function useAllBuildingSettings() {
  const { selectedTenantId } = useTenant();
  const [settingsMap, setSettingsMap] = useState<BuildingSettingsMap>(() => readCache(selectedTenantId) || {});
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    // Only show loading spinner if we have no cached data
    const hasCached = Object.keys(settingsMap).length > 0 || readCache(selectedTenantId) !== null;
    setIsLoading(!hasCached);

    try {
      let query = supabase.from('building_settings').select('*');
      if (selectedTenantId) {
        query = query.eq('tenant_id', selectedTenantId);
      }
      const { data, error } = await query;

      if (error) throw error;

      const map: BuildingSettingsMap = {};
      (data || []).forEach((row) => {
        map[row.fm_guid] = {
          fmGuid: row.fm_guid,
          isFavorite: row.is_favorite,
          ivionSiteId: row.ivion_site_id,
          latitude: row.latitude ?? null,
          longitude: row.longitude ?? null,
          heroImageUrl: row.hero_image_url ?? null,
          startViewId: row.start_view_id ?? null,
        };
      });
      setSettingsMap(map);
      writeCache(selectedTenantId, map);
    } catch (error) {
      console.error('Failed to fetch all building settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    fetchAll();
    
    const handleRefetch = () => fetchAll();
    window.addEventListener('building-settings-changed', handleRefetch);
    return () => window.removeEventListener('building-settings-changed', handleRefetch);
  }, [fetchAll]);

  const getHeroImage = useCallback((fmGuid: string, fallback?: string): string => {
    const settings = settingsMap[fmGuid];
    if (settings?.heroImageUrl) {
      return settings.heroImageUrl;
    }
    return fallback || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=600&auto=format&fit=crop';
  }, [settingsMap]);

  const getFavorites = useCallback((): string[] => {
    return Object.values(settingsMap)
      .filter(s => s.isFavorite)
      .map(s => s.fmGuid);
  }, [settingsMap]);

  return {
    settingsMap,
    isLoading,
    refetch: fetchAll,
    getHeroImage,
    getFavorites,
  };
}
