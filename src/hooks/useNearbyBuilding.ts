import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface BuildingWithCoords {
  fmGuid: string;
  commonName: string;
  latitude: number;
  longitude: number;
  distance: number; // meters
}

interface UseNearbyBuildingResult {
  nearbyBuilding: BuildingWithCoords | null;
  isLoading: boolean;
  error: string | null;
  userPosition: { lat: number; lng: number } | null;
  requestLocation: () => void;
  allBuildings: BuildingWithCoords[];
}

/**
 * Haversine formula to calculate distance between two lat/lng points
 * Returns distance in meters
 */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export function useNearbyBuilding(thresholdMeters = 200): UseNearbyBuildingResult {
  const [nearbyBuilding, setNearbyBuilding] = useState<BuildingWithCoords | null>(null);
  const [allBuildings, setAllBuildings] = useState<BuildingWithCoords[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userPosition, setUserPosition] = useState<{ lat: number; lng: number } | null>(null);

  const fetchBuildingsWithCoords = async () => {
    // Get buildings with coordinates from building_settings, joined with asset names
    const { data: buildingSettings, error: bsError } = await supabase
      .from('building_settings')
      .select('fm_guid, latitude, longitude')
      .not('latitude', 'is', null)
      .not('longitude', 'is', null);

    if (bsError) {
      console.error('Error fetching building_settings:', bsError);
      return [];
    }

    if (!buildingSettings || buildingSettings.length === 0) {
      return [];
    }

    // Get building names from assets table
    const fmGuids = buildingSettings.map((b) => b.fm_guid);
    const { data: buildingAssets, error: aError } = await supabase
      .from('assets')
      .select('fm_guid, common_name, name')
      .in('fm_guid', fmGuids)
      .eq('category', 'Building');

    if (aError) {
      console.error('Error fetching building assets:', aError);
    }

    // Create a map of fmGuid -> name
    const nameMap = new Map<string, string>();
    buildingAssets?.forEach((a) => {
      nameMap.set(a.fm_guid, a.common_name || a.name || 'Unknown building');
    });

    // Combine data
    return buildingSettings.map((bs) => ({
      fmGuid: bs.fm_guid,
      commonName: nameMap.get(bs.fm_guid) || 'Okänd byggnad',
      latitude: Number(bs.latitude),
      longitude: Number(bs.longitude),
      distance: 0, // Will be calculated when we have user position
    }));
  };

  const requestLocation = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNearbyBuilding(null);

    try {
      // First fetch buildings with coordinates
      const buildings = await fetchBuildingsWithCoords();

      if (buildings.length === 0) {
        setError('no_buildings');
        setIsLoading(false);
        return;
      }

      // Check if geolocation is available
      if (!navigator.geolocation) {
        setError('geolocation_not_supported');
        setIsLoading(false);
        return;
      }

      // Request user position
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserPosition({ lat: latitude, lng: longitude });

          // Calculate distances to all buildings
          const buildingsWithDistance = buildings.map((b) => ({
            ...b,
            distance: haversineDistance(latitude, longitude, b.latitude, b.longitude),
          }));

          // Sort by distance
          buildingsWithDistance.sort((a, b) => a.distance - b.distance);
          setAllBuildings(buildingsWithDistance);

          // Check if nearest is within threshold
          const nearest = buildingsWithDistance[0];
          if (nearest && nearest.distance <= thresholdMeters) {
            setNearbyBuilding(nearest);
          } else {
            setNearbyBuilding(null);
          }

          setIsLoading(false);
        },
        (err) => {
          console.error('Geolocation error:', err);
          switch (err.code) {
            case err.PERMISSION_DENIED:
              setError('permission_denied');
              break;
            case err.POSITION_UNAVAILABLE:
              setError('position_unavailable');
              break;
            case err.TIMEOUT:
              setError('timeout');
              break;
            default:
              setError('unknown_error');
          }
          setIsLoading(false);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        }
      );
    } catch (err) {
      console.error('Error in useNearbyBuilding:', err);
      setError('fetch_error');
      setIsLoading(false);
    }
  }, [thresholdMeters]);

  // Auto-request on mount
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  return {
    nearbyBuilding,
    isLoading,
    error,
    userPosition,
    requestLocation,
    allBuildings,
  };
}
