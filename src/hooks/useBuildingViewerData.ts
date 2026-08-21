/**
 * Shared hook for loading building data needed by all viewer modes.
 * 
 * Consolidates the duplicated building lookup + settings fetch logic
 * that previously existed in VirtualTwin.tsx and SplitViewer.tsx.
 */

import { useContext, useEffect, useState } from 'react';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { buildTransformFromSettings, IDENTITY_TRANSFORM, isIdentityTransform, type IvionBimTransform } from '@/lib/ivion-bim-transform';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';
import type { BuildingOrigin } from '@/lib/coordinate-transform';
import { decomposeToLegacyTransform } from '@/viewer/calibration';
import { logger } from '@/lib/logger';

export interface StartViewData {
  cameraEye: number[] | null;
  cameraLook: number[] | null;
  cameraUp: number[] | null;
  cameraProjection: string | null;
  viewMode: string | null;
  clipHeight: number | null;
  showSpaces: boolean | null;
  showAnnotations: boolean | null;
  visibleFloorIds: string[] | null;
  visibleModelIds: string[] | null;
}

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
  /** Whether `transform` came from an actual calibration (spatial_transforms row, or
   *  non-zero legacy building_settings columns) rather than the identity default. */
  isCalibrated: boolean;
  /** spatial_transforms.version this transform was loaded from, if any (Phase 3). */
  transformVersion: number | null;
  /** Building geographic origin for coordinate transformation */
  origin: BuildingOrigin | null;
  /** Start view coordinates */
  startVlon?: number;
  startVlat?: number;
  /** Geminus Base building GUID (for 2D drawing resolution) */
  geminusBaseBuildingGuid?: string;
  /** Start view data (from saved_views via start_view_id) */
  startView?: StartViewData | null;
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
  const { allData, appConfigs, isLoadingData, navigatorTreeData } = useContext(AppContext);
  const [buildingData, setBuildingData] = useState<BuildingViewerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset state when buildingFmGuid changes
  useEffect(() => {
    if (buildingFmGuid) {
      setError(null);
      setIsLoading(true);
    }
  }, [buildingFmGuid]);

  useEffect(() => {
    const loadBuilding = async () => {
      if (!buildingFmGuid) {
        setError('No building specified');
        setIsLoading(false);
        return;
      }

      logger.log('[BuildingViewerData] Looking for building:', buildingFmGuid, 'in allData count:', allData.length);

      // Find building in allData (direct Building entries from FM system)
      let building: any = allData.find(
        (item: any) =>
          item.fmGuid === buildingFmGuid &&
          (item.category === 'Building' || item.category === 'IfcBuilding')
      );

      // Fallback: synthesized buildings exist only in navigatorTreeData (built from storeys
      // when the FM system has no explicit Building-category entries for a GUID)
      if (!building) {
        building = navigatorTreeData.find(
          (node: any) =>
            node.fmGuid === buildingFmGuid &&
            (node.category === 'Building' || node.category === 'IfcBuilding')
        );
        if (building) {
          logger.log('[BuildingViewerData] Found building in navigatorTreeData (synthesized):', building.commonName || building.name);
        }
      }

      // Fallback: query Supabase directly — covers timing edge cases where in-memory
      // data hasn't hydrated yet, or where the building GUID comes from a data source
      // not reflected in allData (e.g. building_settings table, external links).
      if (!building) {
        try {
          const { data: dbBuilding } = await supabase
            .from('assets')
            .select('fm_guid, name, common_name, category')
            .eq('fm_guid', buildingFmGuid)
            .in('category', ['Building', 'IfcBuilding'])
            .maybeSingle();
          if (dbBuilding) {
            building = {
              fmGuid: dbBuilding.fm_guid,
              name: dbBuilding.name,
              commonName: dbBuilding.common_name,
              category: dbBuilding.category,
            };
            logger.log('[BuildingViewerData] Found building via direct DB query:', building.commonName || building.name);
          }
        } catch (dbErr) {
          logger.warn('[BuildingViewerData] DB fallback query failed:', dbErr);
        }
      }

      // Last resort: infer building name from its children (storeys) in allData
      if (!building) {
        const childStorey = allData.find(
          (item: any) => item.buildingFmGuid === buildingFmGuid &&
            (item.category === 'Building Storey' || item.category === 'IfcBuildingStorey')
        );
        if (childStorey) {
          const attrs = childStorey.attributes || {};
          building = {
            fmGuid: buildingFmGuid,
            name: attrs.buildingDesignation || attrs.buildingCommonName || `Building ${buildingFmGuid.substring(0, 8)}`,
            commonName: attrs.buildingCommonName || null,
            category: 'Building',
          };
          logger.log('[BuildingViewerData] Inferred building from storey child:', building.name);
        }
      }

      if (!building) {
        if (isLoadingData) return; // data still loading — effect re-runs when complete
        logger.warn('[BuildingViewerData] Building not found for GUID:', buildingFmGuid,
          'Available in allData:', allData.filter((i: any) => i.category === 'Building' || i.category === 'IfcBuilding')
            .map((i: any) => ({ fmGuid: i.fmGuid, name: i.commonName || i.name }))
        );
        setError('Building not found');
        setIsLoading(false);
        return;
      }

      logger.log('[BuildingViewerData] Found building:', building.commonName || building.name);

      setError(null);

      try {
        const { data: settings, error: settingsError } = await supabase
          .from('building_settings')
          .select('ivion_site_id, latitude, longitude, rotation, ivion_start_vlon, ivion_start_vlat, ivion_bim_offset_x, ivion_bim_offset_y, ivion_bim_offset_z, ivion_bim_rotation, geminus_base_building_guid, start_view_id')
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

        // Phase 3: spatial_transforms (versioned, created by the calibration screen) is
        // now the authoritative source when present. Fall back to the legacy
        // building_settings offset/rotation columns for buildings that haven't been
        // (re-)calibrated since Phase 2's one-time migration, or if this row somehow
        // doesn't exist. Scale is dropped when bridging into the legacy shape — see
        // decomposeToLegacyTransform()'s doc comment.
        let transform: IvionBimTransform = settings ? buildTransformFromSettings(settings) : IDENTITY_TRANSFORM;
        let transformVersion: number | null = null;
        try {
          const { data: latestTransform } = await supabase
            .from('spatial_transforms')
            .select('version, matrix4x4')
            .eq('building_fm_guid', buildingFmGuid)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestTransform?.matrix4x4) {
            const legacy = decomposeToLegacyTransform(latestTransform.matrix4x4 as number[]);
            if (Math.abs(legacy.scale - 1) > 0.01) {
              logger.warn(
                `[BuildingViewerData] spatial_transforms v${latestTransform.version} has scale ${legacy.scale.toFixed(4)} — ` +
                  'dropped when bridging into the legacy offset/rotation sync hooks (Phase 4+ would need to consume the matrix directly to preserve it).',
              );
            }
            transform = { offsetX: legacy.offsetX, offsetY: legacy.offsetY, offsetZ: legacy.offsetZ, rotation: legacy.rotation };
            transformVersion = latestTransform.version;
          }
        } catch (e) {
          logger.warn('[BuildingViewerData] Failed to load spatial_transforms, using legacy building_settings columns:', e);
        }
        // NOT `transformVersion !== null` — Phase 2's migration backfilled a version-1
        // spatial_transforms row for EVERY building, including ones that had no custom
        // building_settings offset/rotation (i.e. an identity matrix). That backfilled
        // row's mere existence isn't evidence of a real calibration, so checking it would
        // make isCalibrated true for virtually every building and the "not calibrated"
        // banner would never show, calibrated or not. Whether `transform` is non-identity
        // is the only thing that actually means "someone has calibrated this."
        const isCalibrated = !isIdentityTransform(transform);

        // Fetch start view data if start_view_id is set
        let startView: StartViewData | null = null;
        const startViewId = (settings as any)?.start_view_id;
        if (startViewId) {
          const { data: viewData } = await supabase
            .from('saved_views')
            .select('camera_eye, camera_look, camera_up, camera_projection, view_mode, clip_height, show_spaces, show_annotations, visible_floor_ids, visible_model_ids')
            .eq('id', startViewId)
            .maybeSingle();
          if (viewData) {
            startView = {
              cameraEye: viewData.camera_eye,
              cameraLook: viewData.camera_look,
              cameraUp: viewData.camera_up,
              cameraProjection: viewData.camera_projection,
              viewMode: viewData.view_mode,
              clipHeight: viewData.clip_height,
              showSpaces: viewData.show_spaces,
              showAnnotations: viewData.show_annotations,
              visibleFloorIds: viewData.visible_floor_ids,
              visibleModelIds: viewData.visible_model_ids,
            };
          }
        }

        setBuildingData({
          fmGuid: buildingFmGuid,
          name: building.commonName || building.name || 'Byggnad',
          ivionSiteId,
          ivionUrl,
          ivionBaseUrl: baseUrl,
          transform,
          isCalibrated,
          transformVersion,
          origin,
          startVlon: settings?.ivion_start_vlon ?? undefined,
          startVlat: settings?.ivion_start_vlat ?? undefined,
          geminusBaseBuildingGuid: (settings as any)?.geminus_base_building_guid ?? undefined,
          startView,
        });
      } catch (err) {
        console.error('[BuildingViewerData] Error:', err);
        setError('Could not load building data');
      }

      setIsLoading(false);
    };

    if (allData.length > 0 || navigatorTreeData.length > 0) {
      loadBuilding();
    }
  }, [buildingFmGuid, allData, navigatorTreeData, appConfigs, isLoadingData]);

  return { buildingData, isLoading, error };
}
