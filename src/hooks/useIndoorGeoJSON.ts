import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { localToGeo, BuildingOrigin } from '@/lib/coordinate-transform';

interface RoomAsset {
  fm_guid: string;
  name: string | null;
  level_fm_guid: string | null;
  coordinate_x: number | null;
  coordinate_y: number | null;
  coordinate_z: number | null;
  gross_area: number | null;
}

interface IndoorGeoJSONResult {
  roomPolygons: GeoJSON.FeatureCollection;
  floorIds: string[];
  isLoading: boolean;
}

/**
 * Generates GeoJSON room polygons for a building by converting BIM coordinates to geographic.
 * Approximates rooms as rectangles based on gross_area and center coordinate.
 */
export function useIndoorGeoJSON(
  buildingFmGuid: string | null,
  origin: BuildingOrigin | null,
  selectedFloor: string | null
): IndoorGeoJSONResult {
  const [rooms, setRooms] = useState<RoomAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!buildingFmGuid) return;
    setIsLoading(true);

    supabase
      .from('assets')
      .select('fm_guid, name, level_fm_guid, coordinate_x, coordinate_y, coordinate_z, gross_area')
      .eq('building_fm_guid', buildingFmGuid)
      .eq('category', 'Space')
      .then(({ data, error }) => {
        if (!error && data) setRooms(data);
        setIsLoading(false);
      });
  }, [buildingFmGuid]);

  const floorIds = useMemo(() => {
    const ids = new Set<string>();
    rooms.forEach(r => { if (r.level_fm_guid) ids.add(r.level_fm_guid); });
    return Array.from(ids);
  }, [rooms]);

  const roomPolygons = useMemo((): GeoJSON.FeatureCollection => {
    if (!origin || rooms.length === 0) {
      return { type: 'FeatureCollection', features: [] };
    }

    const filtered = selectedFloor
      ? rooms.filter(r => r.level_fm_guid === selectedFloor)
      : rooms;

    const features: GeoJSON.Feature[] = filtered
      .filter(r => r.coordinate_x != null && r.coordinate_z != null)
      .map(room => {
        const cx = room.coordinate_x!;
        const cz = room.coordinate_z!;
        const area = room.gross_area || 20;
        const halfSide = Math.sqrt(area) / 2;

        // Create 4 corners in BIM local coords, then convert to geo
        const corners = [
          { x: cx - halfSide, y: room.coordinate_y || 0, z: cz - halfSide },
          { x: cx + halfSide, y: room.coordinate_y || 0, z: cz - halfSide },
          { x: cx + halfSide, y: room.coordinate_y || 0, z: cz + halfSide },
          { x: cx - halfSide, y: room.coordinate_y || 0, z: cz + halfSide },
        ];

        const geoCorners = corners.map(c => {
          const geo = localToGeo(c, origin);
          return [geo.lng, geo.lat];
        });
        geoCorners.push(geoCorners[0]); // close polygon

        return {
          type: 'Feature' as const,
          geometry: { type: 'Polygon' as const, coordinates: [geoCorners] },
          properties: {
            fm_guid: room.fm_guid,
            name: room.name || 'Room',
            level_fm_guid: room.level_fm_guid,
          },
        };
      });

    return { type: 'FeatureCollection', features };
  }, [rooms, origin, selectedFloor]);

  return { roomPolygons, floorIds, isLoading };
}
