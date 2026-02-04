/**
 * Coordinate transformation utilities for 3D ↔ 360° viewer synchronization.
 * 
 * 3D Viewer (xeokit): Uses local BIM coordinates (meters) relative to model origin
 * 360° Viewer (Ivion): Uses geographic coordinates (lat/lng in degrees)
 * 
 * The transformation requires:
 * - Origin point (lat/lng of the building's reference point in the BIM model)
 * - Rotation (building's orientation relative to north, in degrees)
 */

import type { LocalCoords } from '@/context/ViewerSyncContext';

// Earth constants for coordinate conversion
const METERS_PER_DEGREE_LAT = 111320; // meters per degree latitude (approximate)

/** Get meters per degree longitude at a given latitude */
function metersPerDegreeLng(latDegrees: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latDegrees * Math.PI) / 180);
}

/** Convert degrees to radians */
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Convert radians to degrees */
function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Normalize heading to 0-360 range */
export function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}

export interface BuildingOrigin {
  lat: number;
  lng: number;
  rotation: number; // degrees, clockwise from north
}

export interface GeoCoords {
  lat: number;
  lng: number;
}

/**
 * Convert local BIM coordinates to geographic coordinates.
 * 
 * @param local - Local coordinates in meters (x = east, y = up, z = south in BIM)
 * @param origin - Building origin with lat/lng and rotation
 * @returns Geographic coordinates (lat/lng)
 */
export function localToGeo(local: LocalCoords, origin: BuildingOrigin): GeoCoords {
  const rotRad = toRadians(origin.rotation);
  
  // Rotate local coordinates by building rotation
  // In BIM: x = east, z = south (typically, but can vary)
  // We assume x is east, z is north after rotation
  const rotatedX = local.x * Math.cos(rotRad) - local.z * Math.sin(rotRad);
  const rotatedZ = local.x * Math.sin(rotRad) + local.z * Math.cos(rotRad);
  
  // Convert to geographic offset
  const latOffset = rotatedZ / METERS_PER_DEGREE_LAT;
  const lngOffset = rotatedX / metersPerDegreeLng(origin.lat);
  
  return {
    lat: origin.lat + latOffset,
    lng: origin.lng + lngOffset,
  };
}

/**
 * Convert geographic coordinates to local BIM coordinates.
 * 
 * @param geo - Geographic coordinates (lat/lng)
 * @param origin - Building origin with lat/lng and rotation
 * @param height - Height (y) value to use (defaults to 1.6m - eye level)
 * @returns Local coordinates in meters
 */
export function geoToLocal(geo: GeoCoords, origin: BuildingOrigin, height: number = 1.6): LocalCoords {
  // Calculate offset in meters
  const deltaLat = geo.lat - origin.lat;
  const deltaLng = geo.lng - origin.lng;
  
  const offsetZ = deltaLat * METERS_PER_DEGREE_LAT;
  const offsetX = deltaLng * metersPerDegreeLng(origin.lat);
  
  // Rotate back by negative rotation
  const rotRad = toRadians(-origin.rotation);
  const x = offsetX * Math.cos(rotRad) - offsetZ * Math.sin(rotRad);
  const z = offsetX * Math.sin(rotRad) + offsetZ * Math.cos(rotRad);
  
  return { x, y: height, z };
}

/**
 * Transform heading from BIM coordinate system to geographic heading.
 * 
 * @param bimHeading - Heading in BIM coordinate system (degrees)
 * @param buildingRotation - Building rotation relative to north (degrees)
 * @returns Geographic heading (0-360, 0 = north)
 */
export function bimToGeoHeading(bimHeading: number, buildingRotation: number): number {
  return normalizeHeading(bimHeading + buildingRotation);
}

/**
 * Transform heading from geographic to BIM coordinate system.
 * 
 * @param geoHeading - Geographic heading (0-360, 0 = north)
 * @param buildingRotation - Building rotation relative to north (degrees)
 * @returns Heading in BIM coordinate system (degrees)
 */
export function geoToBimHeading(geoHeading: number, buildingRotation: number): number {
  return normalizeHeading(geoHeading - buildingRotation);
}

/**
 * Calculate heading from camera eye and look positions.
 * 
 * @param eye - Camera eye position [x, y, z]
 * @param look - Camera look-at position [x, y, z]
 * @returns Heading in degrees (0-360)
 */
export function calculateHeadingFromCamera(eye: number[], look: number[]): number {
  const dx = look[0] - eye[0];
  const dz = look[2] - eye[2];
  
  // atan2 gives angle from positive X axis, counter-clockwise
  // We want angle from positive Z axis (north in BIM), clockwise
  const angleRad = Math.atan2(dx, dz);
  return normalizeHeading(toDegrees(angleRad));
}

/**
 * Calculate pitch from camera eye and look positions.
 * 
 * @param eye - Camera eye position [x, y, z]
 * @param look - Camera look-at position [x, y, z]
 * @returns Pitch in degrees (-90 to 90, negative = looking down)
 */
export function calculatePitchFromCamera(eye: number[], look: number[]): number {
  const dx = look[0] - eye[0];
  const dy = look[1] - eye[1];
  const dz = look[2] - eye[2];
  
  const horizontalDist = Math.sqrt(dx * dx + dz * dz);
  const pitchRad = Math.atan2(dy, horizontalDist);
  
  return toDegrees(pitchRad);
}

/**
 * Calculate look position from eye, heading, and pitch.
 * 
 * @param eye - Camera eye position [x, y, z]
 * @param heading - Heading in degrees (0-360)
 * @param pitch - Pitch in degrees (-90 to 90)
 * @param distance - Distance to look-at point (default 10m)
 * @returns Look-at position [x, y, z]
 */
export function calculateLookFromHeadingPitch(
  eye: number[],
  heading: number,
  pitch: number,
  distance: number = 10
): number[] {
  const headingRad = toRadians(heading);
  const pitchRad = toRadians(pitch);
  
  // Calculate horizontal and vertical components
  const horizontalDist = distance * Math.cos(pitchRad);
  const verticalDist = distance * Math.sin(pitchRad);
  
  // Calculate x and z offsets based on heading
  const dx = horizontalDist * Math.sin(headingRad);
  const dz = horizontalDist * Math.cos(headingRad);
  
  return [
    eye[0] + dx,
    eye[1] + verticalDist,
    eye[2] + dz,
  ];
}
