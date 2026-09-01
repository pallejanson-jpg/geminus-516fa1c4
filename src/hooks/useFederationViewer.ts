/**
 * useFederationViewer
 *
 * Manages a xeokit Viewer for IFC Federation Fas 6:
 *   - Loads raw IFC files via WebIFCLoaderPlugin (web-ifc WASM already in /lib/xeokit/)
 *   - Applies per-discipline colorization after each model loads
 *   - Provides storey highlight (highlight all entities under a named storey)
 *   - Provides entity-pick → storey-name callback
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export interface FedModel {
  modelId: string;
  modelName: string;
  discipline: string;
  file: File;
}

// RGB colors per discipline (0..1 range)
const DISCIPLINE_RGB: Record<string, [number, number, number]> = {
  'Arkitektur':   [0.72, 0.72, 0.80],
  'El':           [0.95, 0.85, 0.10],
  'VS (Rör)':     [0.10, 0.42, 0.90],
  'Luft/HVAC':    [0.10, 0.75, 0.65],
  'Kyla':         [0.20, 0.85, 0.95],
  'Brand':        [0.90, 0.18, 0.18],
  'Automation':   [0.65, 0.22, 0.85],
  'Konstruktion': [0.62, 0.52, 0.38],
  'Okänd':        [0.55, 0.55, 0.55],
};

export type FedViewerStatus = 'idle' | 'init' | 'loading' | 'ready' | 'error';

interface FedViewerState {
  status: FedViewerStatus;
  loadedCount: number;
  totalCount: number;
  error?: string;
}

export function useFederationViewer(canvasRef: React.RefObject<HTMLCanvasElement>) {
  const viewerRef = useRef<any>(null);
  const loaderRef = useRef<any>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const [state, setState] = useState<FedViewerState>({ status: 'idle', loadedCount: 0, totalCount: 0 });

  // selected canonical storey name for left-panel highlight
  const [selectedStoreyName, setSelectedStoreyName] = useState<string | null>(null);

  // Collect all metaObject ids under a given root metaObject (inclusive)
  const collectChildIds = useCallback((mo: any): string[] => {
    const ids: string[] = [mo.id];
    if (mo.children) {
      for (const child of mo.children) {
        ids.push(...collectChildIds(child));
      }
    }
    return ids;
  }, []);

  // Apply discipline color to all entities of a loaded model
  const applyDisciplineColor = useCallback((viewer: any, modelId: string, discipline: string) => {
    const model = viewer.scene.models[modelId];
    if (!model) return;
    const color = DISCIPLINE_RGB[discipline] ?? DISCIPLINE_RGB['Okänd'];
    const entityIds = Object.keys(model.objects ?? {});
    if (entityIds.length > 0) {
      viewer.scene.setObjectsColorized(entityIds, color);
    }
  }, []);

  // Highlight all entities belonging to canonical storey `name` across all models
  const highlightStorey = useCallback((canonicalName: string | null) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    setSelectedStoreyName(canonicalName);

    // Clear previous highlight
    viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
    viewer.scene.setObjectsXRayed(viewer.scene.objectIds, false);

    if (!canonicalName) return;

    const norm = (s: string) => s.trim().toLowerCase();
    const normTarget = norm(canonicalName);

    // Find all IFCBuildingStorey metaObjects matching the name
    const all: any[] = Object.values(viewer.metaScene.metaObjects ?? {});
    const matchedStoreys = all.filter(
      mo =>
        (mo.type === 'IfcBuildingStorey' || mo.type === 'IFCBUILDINGSTOREY') &&
        norm(mo.name ?? '') === normTarget
    );

    if (matchedStoreys.length === 0) return;

    // Collect all descendant entity IDs
    const highlightIds: string[] = [];
    for (const storey of matchedStoreys) {
      highlightIds.push(...collectChildIds(storey));
    }

    const existing = new Set(viewer.scene.objectIds as string[]);
    const valid = highlightIds.filter(id => existing.has(id));
    if (valid.length === 0) return;

    // X-ray everything else, highlight the selected storey
    viewer.scene.setObjectsXRayed(viewer.scene.objectIds, true);
    viewer.scene.setObjectsXRayed(valid, false);
    viewer.scene.setObjectsHighlighted(valid, true);

    try {
      viewer.cameraFlight.flyTo({ aabb: viewer.scene.getAABB(valid), duration: 0.8 });
    } catch {
      // ignore if scene too small
    }
  }, [collectChildIds]);

  const clearHighlight = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
    viewer.scene.setObjectsXRayed(viewer.scene.xrayedObjectIds, false);
    setSelectedStoreyName(null);
  }, []);

  // Toggle model visibility
  const setModelVisible = useCallback((modelId: string, visible: boolean) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const model = viewer.scene.models[modelId];
    if (!model) return;
    const ids = Object.keys(model.objects ?? {});
    if (ids.length > 0) viewer.scene.setObjectsVisible(ids, visible);
  }, []);

  // Load all models sequentially
  const loadModels = useCallback(async (fedModels: FedModel[]) => {
    setState({ status: 'init', loadedCount: 0, totalCount: fedModels.length });

    // Lazy-load SDK
    let sdk: any;
    try {
      sdk = await import(/* @vite-ignore */ '/lib/xeokit/xeokit-sdk.es.js');
    } catch (e) {
      setState(s => ({ ...s, status: 'error', error: 'Kunde inte ladda xeokit SDK' }));
      return;
    }

    if (!canvasRef.current) return;

    // Create Viewer
    const viewer = new sdk.Viewer({
      canvasElement: canvasRef.current,
      transparent: false,
      saoEnabled: false,
      antialias: true,
      logarithmicDepthBufferEnabled: true,
    });
    viewer.camera.eye = [0, 50, 100];
    viewer.camera.look = [0, 0, 0];
    viewer.camera.up = [0, 1, 0];
    viewerRef.current = viewer;

    // NavCube
    try {
      new sdk.NavCubePlugin(viewer, {
        canvasId: '__fed_navcube__',
        visible: true,
        size: 90,
        alignment: 'topRight',
        topColor: '#aaa',
        frontColor: '#ccc',
      });
    } catch { /* optional */ }

    // Pick → storey resolution
    viewer.scene.input.on('mouseclicked', (_coords: number[]) => {
      const hit = viewer.scene.pick({ canvasPos: _coords });
      if (!hit?.entity) return;
      const entityId = hit.entity.id;
      const mo = viewer.metaScene.metaObjects[entityId];
      if (!mo) return;
      // Walk up to find storey
      let cursor = mo;
      while (cursor) {
        if (cursor.type === 'IfcBuildingStorey' || cursor.type === 'IFCBUILDINGSTOREY') {
          highlightStorey(cursor.name ?? null);
          return;
        }
        cursor = cursor.parent;
      }
    });

    // WebIFCLoaderPlugin
    const ifcLoader = new sdk.WebIFCLoaderPlugin(viewer, {
      wasmPath: '/lib/xeokit/',
    });
    loaderRef.current = ifcLoader;

    setState(s => ({ ...s, status: 'loading' }));

    // Load models one by one
    for (let i = 0; i < fedModels.length; i++) {
      const { modelId, discipline, file } = fedModels[i];
      const blobUrl = URL.createObjectURL(file);
      blobUrlsRef.current.push(blobUrl);

      await new Promise<void>((resolve) => {
        const entity = ifcLoader.load({
          id: modelId,
          src: blobUrl,
          edges: true,
        });
        entity.on('loaded', () => {
          applyDisciplineColor(viewer, modelId, discipline);
          setState(s => ({ ...s, loadedCount: s.loadedCount + 1 }));
          resolve();
        });
        entity.on('error', (errMsg: string) => {
          console.error(`[FederationViewer] Failed to load ${modelId}:`, errMsg);
          setState(s => ({ ...s, loadedCount: s.loadedCount + 1 }));
          resolve(); // continue with next model
        });
      });
    }

    // Fit all loaded models into view
    try {
      viewer.cameraFlight.flyTo({ aabb: viewer.scene.getAABB(viewer.scene.objectIds), duration: 0.8 });
    } catch { /* empty scene is fine */ }

    setState(s => ({ ...s, status: 'ready' }));
  }, [canvasRef, applyDisciplineColor, highlightStorey]);

  // Cleanup
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
      if (viewerRef.current) {
        try { viewerRef.current.destroy(); } catch { /* ignore */ }
        viewerRef.current = null;
      }
    };
  }, []);

  return { state, loadModels, highlightStorey, clearHighlight, setModelVisible, selectedStoreyName };
}
