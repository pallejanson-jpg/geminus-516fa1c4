/**
 * Hook for storey-based (floor-priority) model loading.
 *
 * When chunk records exist in xkt_models (is_chunk=true, storey_fm_guid set),
 * this hook provides:
 * 1. Which chunks are available per floor
 * 2. Priority ordering: visible floor → adjacent floors → rest
 * 3. Floor visibility filtering after monolithic model loads
 *
 * Phase 1 (virtual chunks): Same underlying XKT file with storey metadata
 * for visibility filtering. The viewer still loads the full monolithic model
 * but immediately shows only the selected floor.
 *
 * Phase 2 (real tiles): Per-storey XKT binaries loaded on demand. Detected
 * when chunks have unique storage_path values (different files).
 */

import { useCallback, useRef } from 'react';

interface StoreyChunk {
  modelId: string;
  modelName: string;
  storeyFmGuid: string;
  chunkOrder: number;
  parentModelId: string;
  /** The storage path — if unique per chunk, we have real tiles */
  storagePath?: string;
}

interface FloorVisibilityOptions {
  /** The xeokit viewer instance */
  viewer: any;
  /** The floor FM GUID to show */
  floorFmGuid: string;
  /** Whether to show adjacent floors too */
  includeAdjacent?: boolean;
  /** All known storey chunks (ordered) */
  chunks: StoreyChunk[];
}

/**
 * Detect if chunks represent real per-storey XKT tiles (Phase 2)
 * vs virtual chunks pointing to the same monolithic file (Phase 1).
 */
export function isRealTiling(chunks: StoreyChunk[]): boolean {
  if (chunks.length < 2) return false;
  const paths = new Set(chunks.map(c => c.storagePath).filter(Boolean));
  return paths.size > 1;
}

/**
 * Get the chunks to load for a given active floor (active + adjacent).
 */
export function getTilesToLoad(
  chunks: StoreyChunk[],
  activeFloorGuid: string,
): StoreyChunk[] {
  const idx = chunks.findIndex(c => c.storeyFmGuid === activeFloorGuid);
  if (idx === -1) return chunks; // load all if not found

  const result: StoreyChunk[] = [chunks[idx]];
  if (idx > 0) result.push(chunks[idx - 1]);
  if (idx < chunks.length - 1) result.push(chunks[idx + 1]);
  return result;
}

/**
 * Apply floor-priority visibility: show objects belonging to the target floor,
 * hide or x-ray objects on other floors.
 */
export function applyFloorPriorityVisibility(options: FloorVisibilityOptions): void {
  const { viewer, floorFmGuid, includeAdjacent = true, chunks } = options;

  const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (!xeokitViewer?.scene || !xeokitViewer?.metaScene?.metaObjects) return;

  const scene = xeokitViewer.scene;
  const metaObjects = xeokitViewer.metaScene.metaObjects;

  // Find the target chunk index
  const targetIdx = chunks.findIndex(c => c.storeyFmGuid === floorFmGuid);
  if (targetIdx === -1) return;

  // Determine which floors are "visible" (target + adjacent)
  const visibleFloorGuids = new Set<string>();
  visibleFloorGuids.add(floorFmGuid);
  if (includeAdjacent) {
    if (targetIdx > 0) visibleFloorGuids.add(chunks[targetIdx - 1].storeyFmGuid);
    if (targetIdx < chunks.length - 1) visibleFloorGuids.add(chunks[targetIdx + 1].storeyFmGuid);
  }

  // Build a map: entityId → storeyFmGuid
  const entityToStorey = new Map<string, string>();

  Object.values(metaObjects).forEach((mo: any) => {
    if (mo.type?.toLowerCase() === 'ifcbuildingstorey') {
      const storeyGuid = (mo.originalSystemId || '').toLowerCase();
      // Collect all descendants of this storey
      const collectChildren = (parent: any) => {
        if (!parent.children) return;
        parent.children.forEach((child: any) => {
          entityToStorey.set(child.id, storeyGuid);
          collectChildren(child);
        });
      };
      entityToStorey.set(mo.id, storeyGuid);
      collectChildren(mo);
    }
  });

  // Apply visibility
  const allIds = scene.objectIds || [];
  let shownCount = 0;
  let hiddenCount = 0;

  allIds.forEach((id: string) => {
    const entity = scene.objects?.[id];
    if (!entity) return;

    const storeyGuid = entityToStorey.get(id);
    if (!storeyGuid) {
      // No storey info — keep visible (could be site-level object)
      return;
    }

    if (visibleFloorGuids.has(storeyGuid)) {
      entity.visible = true;
      entity.xrayed = false;
      shownCount++;
    } else {
      // X-ray non-target floors for context
      entity.xrayed = true;
      entity.visible = true;
      hiddenCount++;
    }
  });

  console.log(`[FloorPriority] Floor ${floorFmGuid}: ${shownCount} shown, ${hiddenCount} xrayed`);
}

/**
 * Hook providing floor-priority loading utilities.
 */
export function useFloorPriorityLoading() {
  const chunksRef = useRef<StoreyChunk[]>([]);
  const activeFloorRef = useRef<string | null>(null);
  const loadedTileIdsRef = useRef<Set<string>>(new Set());

  const setChunks = useCallback((chunks: StoreyChunk[]) => {
    chunksRef.current = chunks;
  }, []);

  const showFloor = useCallback((viewer: any, floorFmGuid: string) => {
    activeFloorRef.current = floorFmGuid;
    if (chunksRef.current.length === 0) return;

    // For real tiles, dynamic loading is handled by the viewer
    if (isRealTiling(chunksRef.current)) {
      console.log(`[FloorPriority] Real tiling active — floor switch to ${floorFmGuid} handled by viewer`);
      window.dispatchEvent(new CustomEvent('FLOOR_TILE_SWITCH', { 
        detail: { floorFmGuid, tiles: getTilesToLoad(chunksRef.current, floorFmGuid) }
      }));
      return;
    }

    // Virtual chunks: use visibility filtering
    applyFloorPriorityVisibility({
      viewer,
      floorFmGuid,
      includeAdjacent: true,
      chunks: chunksRef.current,
    });
  }, []);

  const showAllFloors = useCallback((viewer: any) => {
    activeFloorRef.current = null;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) return;
    
    const allIds = xeokitViewer.scene.objectIds || [];
    xeokitViewer.scene.setObjectsXRayed(allIds, false);
    xeokitViewer.scene.setObjectsVisible(allIds, true);
  }, []);

  return {
    setChunks,
    showFloor,
    showAllFloors,
    chunksRef,
    activeFloorRef,
    loadedTileIdsRef,
    /** Check if real per-storey tiles are available */
    hasRealTiles: () => isRealTiling(chunksRef.current),
  };
}
