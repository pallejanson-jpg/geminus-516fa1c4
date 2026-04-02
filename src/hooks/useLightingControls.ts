/**
 * Lighting and Sun Study Controls for 3D Viewer
 * 
 * Provides controls for:
 * - Toggle lighting on/off
 * - Adjust ambient light intensity
 * - Sun study with accurate sun position based on location and time
 */

import { useCallback, useRef, useState } from 'react';
import SunCalc from 'suncalc';

import { emit } from '@/lib/event-bus';
// Custom events for lighting changes
export const LIGHTING_CHANGED_EVENT = 'LIGHTING_CHANGED';
export const SUN_STUDY_CHANGED_EVENT = 'SUN_STUDY_CHANGED';

export interface LightingState {
  enabled: boolean;
  ambientIntensity: number;
  directionalIntensity: number;
  shadowsEnabled: boolean;
}

export interface SunStudyState {
  enabled: boolean;
  latitude: number;
  longitude: number;
  date: Date;
  time: string; // HH:mm format
}

export interface SunPosition {
  azimuth: number; // radians, 0 = south, positive = west
  altitude: number; // radians above horizon
  direction: [number, number, number]; // normalized direction vector
}

// Default location: Stockholm, Sweden
const DEFAULT_LATITUDE = 59.3293;
const DEFAULT_LONGITUDE = 18.0686;

// Store original light configurations for restoration
interface OriginalLightConfig {
  dir?: number[];
  color?: number[];
  intensity?: number;
}

/**
 * Calculate sun direction vector from azimuth and altitude
 */
function sunPositionToDirection(azimuth: number, altitude: number): [number, number, number] {
  // Convert from sun position (azimuth from south, clockwise) to 3D direction
  // In xeokit Y is up, so we need to convert appropriately
  
  // Altitude: 0 = horizon, PI/2 = zenith
  // Azimuth: 0 = south, positive = west (clockwise from south)
  
  const y = Math.sin(altitude); // vertical component
  const horizontalDist = Math.cos(altitude);
  
  // Convert azimuth to xeokit coordinate system
  // xeokit: -Z is typically "north" in default setup
  const x = horizontalDist * Math.sin(azimuth);
  const z = horizontalDist * Math.cos(azimuth);
  
  // Normalize and invert (light direction points TO the scene, not FROM the sun)
  return [-x, -y, -z];
}

/**
 * Convert time string (HH:mm) and date to a Date object
 */
function createDateTime(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function useLightingControls() {
  const viewerRef = useRef<any>(null);
  const originalLightsRef = useRef<Map<string, OriginalLightConfig>>(new Map());
  
  const [lightingState, setLightingState] = useState<LightingState>({
    enabled: true,
    ambientIntensity: 1.0,
    directionalIntensity: 1.0,
    shadowsEnabled: false,
  });

  const [sunStudyState, setSunStudyState] = useState<SunStudyState>({
    enabled: false,
    latitude: DEFAULT_LATITUDE,
    longitude: DEFAULT_LONGITUDE,
    date: new Date(),
    time: '12:00',
  });

  const [sunPosition, setSunPosition] = useState<SunPosition | null>(null);

  /**
   * Set the viewer reference
   */
  const setViewer = useCallback((viewer: any) => {
    viewerRef.current = viewer;
  }, []);

  /**
   * Get xeokit scene lights
   */
  const getSceneLights = useCallback((): any[] => {
    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const lights = xeokitViewer?.scene?.lights;
    // Ensure we return an array - lights could be an object or undefined
    if (!lights) return [];
    if (Array.isArray(lights)) return lights;
    // If lights is an object (dictionary), convert to array
    if (typeof lights === 'object') return Object.values(lights);
    return [];
  }, []);

  /**
   * Store original light configurations
   */
  const storeOriginalLights = useCallback(() => {
    const lights = getSceneLights();
    originalLightsRef.current.clear();
    
    lights.forEach((light: any, index: number) => {
      const config: OriginalLightConfig = {};
      if (light.dir) config.dir = [...light.dir];
      if (light.color) config.color = [...light.color];
      if (typeof light.intensity === 'number') config.intensity = light.intensity;
      originalLightsRef.current.set(`light_${index}`, config);
    });
  }, [getSceneLights]);

  /**
   * Restore original light configurations
   */
  const restoreOriginalLights = useCallback(() => {
    const lights = getSceneLights();
    
    lights.forEach((light: any, index: number) => {
      const original = originalLightsRef.current.get(`light_${index}`);
      if (original) {
        if (original.dir && light.dir) light.dir = original.dir;
        if (original.color && light.color) light.color = original.color;
        if (typeof original.intensity === 'number') light.intensity = original.intensity;
      }
    });
  }, [getSceneLights]);

  /**
   * Toggle all lighting on/off
   */
  const toggleLighting = useCallback((enabled: boolean) => {
    const lights = getSceneLights();
    
    lights.forEach((light: any) => {
      if (typeof light.intensity === 'number') {
        if (enabled) {
          // Restore to previous intensity
          light.intensity = light._savedIntensity ?? 1.0;
        } else {
          // Save current and set to 0
          light._savedIntensity = light.intensity;
          light.intensity = 0;
        }
      }
    });

    setLightingState(prev => ({ ...prev, enabled }));
    
    emit('LIGHTING_CHANGED', { enabled });
  }, [getSceneLights]);

  /**
   * Adjust ambient light intensity
   */
  const setAmbientIntensity = useCallback((intensity: number) => {
    const lights = getSceneLights();
    
    lights.forEach((light: any) => {
      // AmbientLight in xeokit has type property or can be detected by lack of direction
      if (light.type === 'ambient' || (!light.dir && light.color)) {
        light.intensity = intensity;
      }
    });

    setLightingState(prev => ({ ...prev, ambientIntensity: intensity }));
  }, [getSceneLights]);

  /**
   * Adjust directional light intensity
   */
  const setDirectionalIntensity = useCallback((intensity: number) => {
    const lights = getSceneLights();
    
    lights.forEach((light: any) => {
      // DirLight has a dir property
      if (light.dir) {
        light.intensity = intensity;
      }
    });

    setLightingState(prev => ({ ...prev, directionalIntensity: intensity }));
  }, [getSceneLights]);

  /**
   * Calculate sun position for given location and time
   */
  const calculateSunPosition = useCallback((lat: number, lng: number, dateTime: Date): SunPosition => {
    const pos = SunCalc.getPosition(dateTime, lat, lng);
    
    // SunCalc returns:
    // - azimuth: sun azimuth in radians (direction along the horizon, measured from south to west)
    // - altitude: sun altitude above the horizon in radians
    
    const direction = sunPositionToDirection(pos.azimuth, pos.altitude);
    
    return {
      azimuth: pos.azimuth,
      altitude: pos.altitude,
      direction,
    };
  }, []);

  /**
   * Apply sun position to directional lights
   */
  const applySunPosition = useCallback((position: SunPosition) => {
    const lights = getSceneLights();
    
    lights.forEach((light: any) => {
      // Apply to directional lights
      if (light.dir) {
        light.dir = position.direction;
        
        // Adjust color based on altitude (lower sun = warmer color)
        const altitudeFactor = Math.max(0, position.altitude) / (Math.PI / 2);
        if (altitudeFactor > 0.1) {
          // Day time - white to warm
          const warmth = 1 - altitudeFactor * 0.3;
          light.color = [1, warmth + 0.1, warmth];
        } else if (altitudeFactor > 0) {
          // Golden hour - warm orange
          light.color = [1, 0.7, 0.4];
        } else {
          // Below horizon - very dim
          light.intensity = Math.max(0.1, light.intensity * 0.3);
          light.color = [0.4, 0.4, 0.6];
        }
      }
    });

    setSunPosition(position);
  }, [getSceneLights]);

  /**
   * Enable/disable sun study mode
   */
  const toggleSunStudy = useCallback((enabled: boolean) => {
    if (enabled) {
      // Store original lights before modifying
      storeOriginalLights();
      
      // Calculate and apply sun position
      const dateTime = createDateTime(sunStudyState.date, sunStudyState.time);
      const position = calculateSunPosition(
        sunStudyState.latitude,
        sunStudyState.longitude,
        dateTime
      );
      applySunPosition(position);
    } else {
      // Restore original light configuration
      restoreOriginalLights();
      setSunPosition(null);
    }

    setSunStudyState(prev => ({ ...prev, enabled }));
    
    emit('SUN_STUDY_CHANGED', { enabled });
  }, [sunStudyState, storeOriginalLights, restoreOriginalLights, calculateSunPosition, applySunPosition]);

  /**
   * Update sun study parameters
   */
  const updateSunStudy = useCallback((updates: Partial<SunStudyState>) => {
    setSunStudyState(prev => {
      const newState = { ...prev, ...updates };
      
      // If sun study is enabled, recalculate and apply
      if (newState.enabled) {
        const dateTime = createDateTime(newState.date, newState.time);
        const position = calculateSunPosition(
          newState.latitude,
          newState.longitude,
          dateTime
        );
        applySunPosition(position);
      }
      
      return newState;
    });
  }, [calculateSunPosition, applySunPosition]);

  /**
   * Get sun times for current location and date
   */
  const getSunTimes = useCallback(() => {
    const times = SunCalc.getTimes(
      sunStudyState.date,
      sunStudyState.latitude,
      sunStudyState.longitude
    );
    
    return {
      sunrise: times.sunrise,
      sunset: times.sunset,
      solarNoon: times.solarNoon,
      dawn: times.dawn,
      dusk: times.dusk,
      goldenHour: times.goldenHour,
      goldenHourEnd: times.goldenHourEnd,
    };
  }, [sunStudyState.date, sunStudyState.latitude, sunStudyState.longitude]);

  /**
   * Format altitude as degrees above/below horizon
   */
  const formatAltitude = useCallback((altitude: number) => {
    const degrees = (altitude * 180) / Math.PI;
    if (degrees < 0) {
      return `${Math.abs(degrees).toFixed(1)}° under horisonten`;
    }
    return `${degrees.toFixed(1)}° över horisonten`;
  }, []);

  /**
   * Format azimuth as compass direction
   */
  const formatAzimuth = useCallback((azimuth: number) => {
    // Convert from radians (south = 0, west = positive) to compass degrees (north = 0)
    let degrees = ((azimuth * 180) / Math.PI + 180) % 360;
    
    const directions = [
      'N', 'NNO', 'NO', 'ONO', 
      'O', 'OSO', 'SO', 'SSO',
      'S', 'SSV', 'SV', 'VSV',
      'V', 'VNV', 'NV', 'NNV'
    ];
    const index = Math.round(degrees / 22.5) % 16;
    
    return `${directions[index]} (${degrees.toFixed(0)}°)`;
  }, []);

  return {
    // State
    lightingState,
    sunStudyState,
    sunPosition,
    
    // Actions
    setViewer,
    toggleLighting,
    setAmbientIntensity,
    setDirectionalIntensity,
    toggleSunStudy,
    updateSunStudy,
    
    // Utilities
    getSunTimes,
    formatAltitude,
    formatAzimuth,
  };
}
