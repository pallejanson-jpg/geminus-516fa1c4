import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

/**
 * Hook to fetch ALL building_settings from the database.
 * Provides a map for quick lookup of hero images and other settings by fmGuid.
 * Call refetch() after mutations to invalidate the cache.
 */
export function useAllBuildingSettings() {
  const [settingsMap, setSettingsMap] = useState<BuildingSettingsMap>({});
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('building_settings')
        .select('*');

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
    } catch (error) {
      console.error('Failed to fetch all building settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    
    // Listen for custom event to refetch (triggered when settings change)
    const handleRefetch = () => fetchAll();
    window.addEventListener('building-settings-changed', handleRefetch);
    return () => window.removeEventListener('building-settings-changed', handleRefetch);
  }, [fetchAll]);

  // Get hero image for a building, with fallback
  const getHeroImage = useCallback((fmGuid: string, fallback?: string): string => {
    const settings = settingsMap[fmGuid];
    if (settings?.heroImageUrl) {
      return settings.heroImageUrl;
    }
    return fallback || 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=600&auto=format&fit=crop';
  }, [settingsMap]);

  // Get favorites list
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
