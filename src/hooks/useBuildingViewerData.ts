/**
 * Shared hook for loading building data needed by all viewer modes.
 * 
 * Consolidates the duplicated building lookup + settings fetch logic
 * that previously existed in VirtualTwin.tsx and SplitViewer.tsx.
 */

import { useContext, useEffect, useState } from 'react';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { buildTransformFromSettings, IDENTITY_TRANSFORM, type IvionBimTransform } from '@/lib/ivion-bim-transform';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';
import type { BuildingOrigin } from '@/lib/coordinate-transform';

export interface BuildingViewerData {
  fmGuid: string;
  name: string;
  /** Ivion site ID (null if not configured) */
  ivionSiteId: string | null;
  /** Full Ivion URL with query params (null if no site ID) */
  ivionUrl: string | null;
  /** Ivion base URL (origin only, no query params) */
  ivionBaseUrl: string;
  /** Ivion-to-BIM coordinate transform */
  transform: IvionBimTransform;
  /** Building geographic origin for coordinate transformation */
  origin: BuildingOrigin | null;
  /** Start view coordinates */
  startVlon?: number;
  startVlat?: number;
  /** FM Access building GUID (for 2D drawing resolution) */
  fmAccessBuildingGuid?: string;
}

interface UseBuildingViewerDataResult {
  buildingData: BuildingViewerData | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Load all building data needed for any viewer mode (3D, Split, VT, 360).
 */
export function useBuildingViewerData(buildingFmGuid: string | null): UseBuildingViewerDataResult {
  const { allData, appConfigs } = useContext(AppContext);
  const [buildingData, setBuildingData] = useState<BuildingViewerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadBuilding = async () => {
      if (!buildingFmGuid) {
        setError('Ingen byggnad angiven');
        setIsLoading(false);
        return;
      }

      // Find building in allData
      const building = allData.find(
        (item: any) =>
          item.fmGuid === buildingFmGuid &&
          (item.category === 'Building' || item.category === 'IfcBuilding')
      );

      if (!building) {
        setError('Byggnaden kunde inte hittas');
        setIsLoading(false);
        return;
      }

      try {
        const { data: settings, error: settingsError } = await supabase
          .from('building_settings')
          .select('ivion_site_id, latitude, longitude, rotation, ivion_start_vlon, ivion_start_vlat, ivion_bim_offset_x, ivion_bim_offset_y, ivion_bim_offset_z, ivion_bim_rotation, fm_access_building_guid')
          .eq('fm_guid', buildingFmGuid)
          .maybeSingle();

        if (settingsError) {
          console.error('[BuildingViewerData] Error fetching settings:', settingsError);
        }

        // Build Ivion URL
        const configured = appConfigs?.radar?.url?.trim();
        const baseUrl = configured ? configured.replace(/\/$/, '') : IVION_DEFAULT_BASE_URL;

        const ivionSiteId = settings?.ivion_site_id || null;
        let ivionUrl: string | null = null;

        if (ivionSiteId) {
          ivionUrl = `${baseUrl}/?site=${ivionSiteId}`;
          if (settings?.ivion_start_vlon != null) ivionUrl += `&vlon=${settings.ivion_start_vlon}`;
          if (settings?.ivion_start_vlat != null) ivionUrl += `&vlat=${settings.ivion_start_vlat}`;
        }

        // Build origin for coordinate transformation
        const origin: BuildingOrigin | null =
          settings?.latitude && settings?.longitude
            ? {
                lat: settings.latitude,
                lng: settings.longitude,
                rotation: settings.rotation ?? 0,
              }
            : null;

        const transform = settings ? buildTransformFromSettings(settings) : IDENTITY_TRANSFORM;

        setBuildingData({
          fmGuid: buildingFmGuid,
          name: building.commonName || building.name || 'Byggnad',
          ivionSiteId,
          ivionUrl,
          ivionBaseUrl: baseUrl,
          transform,
          origin,
          startVlon: settings?.ivion_start_vlon ?? undefined,
          startVlat: settings?.ivion_start_vlat ?? undefined,
          fmAccessBuildingGuid: (settings as any)?.fm_access_building_guid ?? undefined,
        });
      } catch (err) {
        console.error('[BuildingViewerData] Error:', err);
        setError('Kunde inte ladda byggnadsdata');
      }

      setIsLoading(false);
    };

    if (allData.length > 0) {
      loadBuilding();
    }
  }, [buildingFmGuid, allData, appConfigs]);

  return { buildingData, isLoading, error };
}
