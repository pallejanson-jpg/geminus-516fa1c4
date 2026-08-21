/**
 * viewer-annotations — server-side API for Phase 2 of the viewer coordinator work
 * (docs/plans/viewer-coordinator-spec-and-prompts.md, "Del C.4").
 *
 * Del C.4 describes this as a set of REST endpoints on a Node.js API server. This
 * codebase doesn't have one — every other server-side operation here is a Supabase
 * Edge Function called via `supabase.functions.invoke(name, { body: { action, ...params } })`
 * (see ivion-poi, geminus-plus-sync, ai-asset-detection). This function follows that
 * same convention instead of introducing a new server type, with one action per
 * REST endpoint from Del C.4:
 *
 *   get-viewer-config        ~ GET  /buildings/:id/viewer-config
 *   list-annotations         ~ GET  /buildings/:id/annotations
 *   upsert-annotation        ~ POST /buildings/:id/annotations
 *   update-spatial-location  ~ PATCH /assets/:fmGuid/spatial-location
 *   remove-annotation        ~ DELETE /assets/:fmGuid/annotation (soft — clears symbol_id only)
 *   get-spatial-transform    ~ GET  /buildings/:id/spatial-transform
 *   save-spatial-transform   ~ POST /buildings/:id/spatial-transform
 *   validate-spatial-transform ~ POST /buildings/:id/spatial-transform/validate
 *
 * Auth: matches the sibling functions above — Supabase's platform-level JWT check
 * (verify_jwt, default true, not overridden for this function in config.toml) is the
 * gate, same as ivion-poi/geminus-plus-sync/ai-asset-detection. This codebase does not
 * currently enforce per-tenant authorization on the `assets` table anywhere (its RLS
 * policies are "public read" / "any authenticated user can write" — see
 * docs/viewer-current-state-verified.md) — this function matches that existing
 * posture rather than inventing a stricter one-off model. Every write still verifies
 * the target building exists, and all state changes go through the service-role
 * client server-side only (never exposed to the browser).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const SPATIAL_REPRESENTATIONS = ['bim-object', 'spatial-point', 'space-centroid', 'navvis-location', 'unlocated'] as const;
const LOCATION_ACCURACIES = ['surveyed', 'model-derived', 'navvis-derived', 'space-derived', 'manually-placed'] as const;

const positionSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });

const getViewerConfigSchema = z.object({ buildingFmGuid: z.string().min(1) });
const listAnnotationsSchema = z.object({ buildingFmGuid: z.string().min(1) });

const upsertAnnotationSchema = z.object({
  buildingFmGuid: z.string().min(1),
  assetFmGuid: z.string().min(1).optional(),
  // Nullable (not just optional-with-a-string): some callers (e.g. ai-asset-detection,
  // when a detection template has no default symbol configured) legitimately create an
  // asset before a symbol is chosen. symbol_id IS NOT NULL still governs whether it
  // renders as an annotation anywhere else — this endpoint just doesn't force that
  // choice to happen at creation time.
  symbolId: z.string().min(1).nullable(),
  name: z.string().optional(),
  commonName: z.string().optional(),
  assetType: z.string().optional(),
  category: z.string().optional(),
  levelFmGuid: z.string().optional(),
  roomFmGuid: z.string().optional(),
  position: positionSchema.optional(),
  spatialRepresentation: z.enum(SPATIAL_REPRESENTATIONS).optional(),
  locationAccuracy: z.enum(LOCATION_ACCURACIES).optional(),
  transformVersion: z.number().int().optional(),
  attributes: z.record(z.unknown()).optional(),
  ivionImageId: z.number().int().optional(),
  ivionSiteId: z.string().optional(),
  syncToIvion: z.boolean().optional(),
});

const updateSpatialLocationSchema = z.object({
  assetFmGuid: z.string().min(1),
  position: positionSchema,
  spatialRepresentation: z.enum(SPATIAL_REPRESENTATIONS).optional(),
  locationAccuracy: z.enum(LOCATION_ACCURACIES).optional(),
  transformVersion: z.number().int().optional(),
});

const removeAnnotationSchema = z.object({ assetFmGuid: z.string().min(1) });

const getSpatialTransformSchema = z.object({ buildingFmGuid: z.string().min(1) });

const saveSpatialTransformSchema = z.object({
  buildingFmGuid: z.string().min(1),
  matrix4x4: z.array(z.number()).length(16),
  navvisSiteId: z.string().optional(),
  residualErrorMm: z.number().optional(),
  calibrationPoints: z
    .array(z.object({ xeokit: positionSchema, navvis: positionSchema }))
    .optional(),
});

const calibrationPointSchema = z.object({ xeokit: positionSchema, navvis: positionSchema });
const validateSpatialTransformSchema = z.object({
  matrix4x4: z.array(z.number()).length(16),
  calibrationPoints: z.array(calibrationPointSchema).min(1),
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ success: false, error: message }, status);
}

async function buildingExists(buildingFmGuid: string): Promise<boolean> {
  const { data } = await supabase
    .from('building_settings')
    .select('fm_guid')
    .eq('fm_guid', buildingFmGuid)
    .maybeSingle();
  return !!data;
}

/** Apply a row-major 4x4 affine matrix to a point — mirrors src/viewer/SpatialReferenceService.transformPoint. */
function applyMatrix(point: { x: number; y: number; z: number }, m: number[]) {
  return {
    x: m[0] * point.x + m[1] * point.y + m[2] * point.z + m[3],
    y: m[4] * point.x + m[5] * point.y + m[6] * point.z + m[7],
    z: m[8] * point.x + m[9] * point.y + m[10] * point.z + m[11],
  };
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// ─── Action handlers ────────────────────────────────────────────────────────

async function getViewerConfig(params: z.infer<typeof getViewerConfigSchema>) {
  const { buildingFmGuid } = params;

  const { data: transform } = await supabase
    .from('spatial_transforms')
    .select('*')
    .eq('building_fm_guid', buildingFmGuid)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  return { success: true, buildingFmGuid, spatialTransform: transform ?? null };
}

async function listAnnotations(params: z.infer<typeof listAnnotationsSchema>) {
  const { buildingFmGuid } = params;

  const { data, error } = await supabase
    .from('assets')
    .select(
      'fm_guid, name, common_name, asset_type, symbol_id, coordinate_x, coordinate_y, coordinate_z, ' +
        'spatial_representation, location_accuracy, transform_version, in_room_fm_guid, level_fm_guid, ' +
        'ivion_poi_id, ivion_image_id',
    )
    .eq('building_fm_guid', buildingFmGuid)
    .not('symbol_id', 'is', null);

  if (error) throw new Error(error.message);
  return { success: true, annotations: data ?? [] };
}

async function upsertAnnotation(params: z.infer<typeof upsertAnnotationSchema>) {
  if (!(await buildingExists(params.buildingFmGuid))) {
    return { success: false, error: 'Building not found', status: 404 };
  }

  const spatialRepresentation =
    params.spatialRepresentation ?? (params.position ? 'spatial-point' : undefined);

  let assetFmGuid = params.assetFmGuid;

  if (assetFmGuid) {
    const updatePayload: Record<string, unknown> = { symbol_id: params.symbolId };
    if (params.position) {
      updatePayload.coordinate_x = params.position.x;
      updatePayload.coordinate_y = params.position.y;
      updatePayload.coordinate_z = params.position.z;
    }
    if (spatialRepresentation) updatePayload.spatial_representation = spatialRepresentation;
    if (params.locationAccuracy) updatePayload.location_accuracy = params.locationAccuracy;
    if (params.transformVersion !== undefined) updatePayload.transform_version = params.transformVersion;
    if (params.ivionImageId !== undefined) updatePayload.ivion_image_id = params.ivionImageId;
    if (params.ivionSiteId !== undefined) updatePayload.ivion_site_id = params.ivionSiteId;
    if (params.attributes) updatePayload.attributes = params.attributes;

    const { error } = await supabase.from('assets').update(updatePayload).eq('fm_guid', assetFmGuid);
    if (error) throw new Error(error.message);
  } else {
    assetFmGuid = crypto.randomUUID();
    const insertPayload: Record<string, unknown> = {
      fm_guid: assetFmGuid,
      building_fm_guid: params.buildingFmGuid,
      symbol_id: params.symbolId,
      name: params.name ?? null,
      common_name: params.commonName ?? null,
      asset_type: params.assetType ?? null,
      category: params.category ?? 'Instance',
      level_fm_guid: params.levelFmGuid ?? null,
      in_room_fm_guid: params.roomFmGuid ?? null,
      is_local: true,
      created_in_model: false,
      spatial_representation: spatialRepresentation ?? 'unlocated',
      location_accuracy: params.locationAccuracy ?? null,
      transform_version: params.transformVersion ?? null,
      ivion_image_id: params.ivionImageId ?? null,
      ivion_site_id: params.ivionSiteId ?? null,
      attributes: params.attributes ?? {},
    };
    if (params.position) {
      insertPayload.coordinate_x = params.position.x;
      insertPayload.coordinate_y = params.position.y;
      insertPayload.coordinate_z = params.position.z;
    }

    const { error } = await supabase.from('assets').insert(insertPayload);
    if (error) throw new Error(error.message);
  }

  let poiId: number | undefined;
  if (params.syncToIvion !== false) {
    try {
      const { data: syncResult } = await supabase.functions.invoke('ivion-poi', {
        body: { action: 'sync-asset', assetFmGuid },
      });
      poiId = syncResult?.poiId;
    } catch (e) {
      // Non-blocking: the asset/annotation write already succeeded. Ivion sync can be
      // retried later (sync-asset is idempotent as of Phase 2 item 4).
      console.warn('[viewer-annotations] Ivion POI sync failed (non-blocking):', e);
    }
  }

  return { success: true, assetFmGuid, poiId };
}

async function updateSpatialLocation(params: z.infer<typeof updateSpatialLocationSchema>) {
  const updatePayload: Record<string, unknown> = {
    coordinate_x: params.position.x,
    coordinate_y: params.position.y,
    coordinate_z: params.position.z,
  };
  if (params.spatialRepresentation) updatePayload.spatial_representation = params.spatialRepresentation;
  if (params.locationAccuracy) updatePayload.location_accuracy = params.locationAccuracy;
  if (params.transformVersion !== undefined) updatePayload.transform_version = params.transformVersion;

  const { error } = await supabase.from('assets').update(updatePayload).eq('fm_guid', params.assetFmGuid);
  if (error) throw new Error(error.message);
  return { success: true, assetFmGuid: params.assetFmGuid };
}

async function removeAnnotation(params: z.infer<typeof removeAnnotationSchema>) {
  // Soft: clears symbol_id only (the new single "is this an annotation" flag). The
  // asset row — and its position/history — is left intact, matching Del C.4's
  // "soft, tar inte bort assetten" instruction.
  const { error } = await supabase
    .from('assets')
    .update({ symbol_id: null })
    .eq('fm_guid', params.assetFmGuid);
  if (error) throw new Error(error.message);
  return { success: true, assetFmGuid: params.assetFmGuid };
}

async function getSpatialTransform(params: z.infer<typeof getSpatialTransformSchema>) {
  const { data, error } = await supabase
    .from('spatial_transforms')
    .select('*')
    .eq('building_fm_guid', params.buildingFmGuid)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { success: true, transform: data ?? null };
}

async function saveSpatialTransform(params: z.infer<typeof saveSpatialTransformSchema>) {
  if (!(await buildingExists(params.buildingFmGuid))) {
    return { success: false, error: 'Building not found', status: 404 };
  }

  const { data: latest } = await supabase
    .from('spatial_transforms')
    .select('version')
    .eq('building_fm_guid', params.buildingFmGuid)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (latest?.version ?? 0) + 1;

  const { data, error } = await supabase
    .from('spatial_transforms')
    .insert({
      building_fm_guid: params.buildingFmGuid,
      matrix4x4: params.matrix4x4,
      navvis_site_id: params.navvisSiteId ?? null,
      residual_error_mm: params.residualErrorMm ?? null,
      calibration_points: params.calibrationPoints ?? null,
      version: nextVersion,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  return { success: true, transform: data };
}

async function validateSpatialTransform(params: z.infer<typeof validateSpatialTransformSchema>) {
  const perPointErrorMm = params.calibrationPoints.map((pt) => {
    const predicted = applyMatrix(pt.xeokit, params.matrix4x4);
    return distance(predicted, pt.navvis) * 1000;
  });
  const residualErrorMm = Math.sqrt(
    perPointErrorMm.reduce((sum, e) => sum + e * e, 0) / perPointErrorMm.length,
  );
  return { success: true, residualErrorMm, perPointErrorMm };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, ...params } = await req.json();

    switch (action) {
      case 'get-viewer-config':
        return jsonResponse(await getViewerConfig(getViewerConfigSchema.parse(params)));

      case 'list-annotations':
        return jsonResponse(await listAnnotations(listAnnotationsSchema.parse(params)));

      case 'upsert-annotation': {
        const result = await upsertAnnotation(upsertAnnotationSchema.parse(params));
        return jsonResponse(result, result.success ? 200 : (result as { status?: number }).status ?? 400);
      }

      case 'update-spatial-location':
        return jsonResponse(await updateSpatialLocation(updateSpatialLocationSchema.parse(params)));

      case 'remove-annotation':
        return jsonResponse(await removeAnnotation(removeAnnotationSchema.parse(params)));

      case 'get-spatial-transform':
        return jsonResponse(await getSpatialTransform(getSpatialTransformSchema.parse(params)));

      case 'save-spatial-transform': {
        const result = await saveSpatialTransform(saveSpatialTransformSchema.parse(params));
        return jsonResponse(result, result.success ? 200 : (result as { status?: number }).status ?? 400);
      }

      case 'validate-spatial-transform':
        return jsonResponse(await validateSpatialTransform(validateSpatialTransformSchema.parse(params)));

      default:
        return errorResponse(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return errorResponse(`Invalid payload: ${e.errors.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 400);
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error('[viewer-annotations] Error:', message);
    return errorResponse(message, 500);
  }
});
