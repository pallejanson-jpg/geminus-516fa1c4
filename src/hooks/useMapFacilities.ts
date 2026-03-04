import { useContext, useEffect, useMemo, useState } from 'react';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { BUILDING_IMAGES, NORDIC_CITIES } from '@/lib/constants';
import { Facility } from '@/lib/types';

export interface MapFacility extends Facility {
  lat: number;
  lng: number;
  displayName: string;
  has360: boolean;
  ivionSiteId?: string | null;
  rotation?: number | null;
}

interface BuildingCoordRow {
  fm_guid: string;
  latitude: number | null;
  longitude: number | null;
  ivion_site_id?: string | null;
  rotation?: number | null;
}

/**
 * Shared hook for building map data — used by MapView and CesiumGlobeView.
 * Fetches building_settings coords, merges with navigatorTreeData,
 * falls back to NORDIC_CITIES for buildings without saved positions.
 */
export function useMapFacilities() {
  const { navigatorTreeData, allData, isLoadingData } = useContext(AppContext);
  const [buildingCoords, setBuildingCoords] = useState<BuildingCoordRow[]>([]);

  useEffect(() => {
    supabase
      .from('building_settings')
      .select('fm_guid, latitude, longitude, ivion_site_id, rotation')
      .then(({ data }) => {
        if (data) setBuildingCoords(data);
      });
  }, []);

  const facilities: MapFacility[] = useMemo(() => {
    const coordsLookup: Record<string, BuildingCoordRow> = {};
    buildingCoords.forEach(bc => {
      if (bc.latitude !== null && bc.longitude !== null) {
        coordsLookup[bc.fm_guid.toLowerCase()] = bc;
      }
    });

    return navigatorTreeData.map((building, index) => {
      const storeys = building.children || [];
      const totalSpaces = storeys.reduce((sum: number, storey: any) => sum + (storey.children?.length || 0), 0);

      const totalArea = allData
        .filter((a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid)
        .reduce((sum: number, space: any) => {
          const attrs = space.attributes || {};
          const ntaKey = Object.keys(attrs).find(k => k.toLowerCase().startsWith('nta'));
          if (ntaKey && attrs[ntaKey]) return sum + (Number(attrs[ntaKey]) || 0);
          if (attrs.area) return sum + (Number(attrs.area) || 0);
          if (space.grossArea) return sum + (Number(space.grossArea) || 0);
          return sum;
        }, 0);

      const saved = coordsLookup[building.fmGuid.toLowerCase()];
      let lat: number, lng: number, address: string;

      if (saved) {
        lat = saved.latitude!;
        lng = saved.longitude!;
        address = (building as any).attributes?.address || 'Sparad position';
      } else {
        const city = NORDIC_CITIES[index % NORDIC_CITIES.length];
        lat = city.lat + (Math.random() - 0.5) * 0.1;
        lng = city.lng + (Math.random() - 0.5) * 0.1;
        address = (building as any).attributes?.address || city.name;
      }

      return {
        fmGuid: building.fmGuid,
        name: building.name,
        commonName: building.commonName,
        category: 'Building',
        image: BUILDING_IMAGES[index % BUILDING_IMAGES.length],
        numberOfLevels: storeys.length,
        numberOfSpaces: totalSpaces,
        area: Math.round(totalArea),
        address,
        lat,
        lng,
        displayName: building.commonName || building.name || building.fmGuid.substring(0, 8),
        has360: !!saved?.ivion_site_id,
        ivionSiteId: saved?.ivion_site_id ?? null,
        rotation: saved?.rotation ?? 0,
      };
    });
  }, [navigatorTreeData, allData, buildingCoords]);

  return { facilities, isLoading: isLoadingData };
}
