import React, { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { Loader2, AlertCircle, X, Filter, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ViewerToolbar from './ViewerToolbar';
import MinimapPanel from './MinimapPanel';
import { xktCacheService } from '@/services/xkt-cache-service';

interface AssetPlusViewerProps {
  fmGuid: string;
  onClose?: () => void;
}

interface ViewerState {
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  modelInfo: {
    name?: string;
    type?: string;
    objectCount?: number;
    lastUpdated?: string;
  } | null;
}

type ModelFilter = 'all' | 'a-prefix' | 'buildings-only';

type InitStep =
  | 'idle'
  | 'wait_dom'
  | 'fetch_token'
  | 'fetch_config'
  | 'check_script'
  | 'mount_viewer'
  | 'request_models'
  | 'ready'
  | 'error';

type ModelLoadState = 'idle' | 'requested' | 'loaded';

const MODEL_FILTERS: { value: ModelFilter; label: string; description: string }[] = [
  { value: 'all', label: 'All models', description: 'Show all available models' },
  { value: 'a-prefix', label: 'Models (a-prefix)', description: 'Models starting with "a"' },
  { value: 'buildings-only', label: 'Buildings only', description: 'Show only building models' },
];

// Default camera settings from external_viewer.html
const defaultHeightAboveAABB = 1;
const defaultMinimumHeightAboveBase = 2.6;
const lookAtSpaceAndInstanceFlyToDuration = 1;

/**
 * Asset+ 3D Viewer Component
 * 
 * Integrates with the Asset+ 3D Viewer package to display BIM models.
 * Based on Asset+ external_viewer.html implementation pattern.
 */
const AssetPlusViewer: React.FC<AssetPlusViewerProps> = ({ fmGuid, onClose }) => {
  const { allData } = useContext(AppContext);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewportWrapperRef = useRef<HTMLDivElement>(null);
  const viewerInstanceRef = useRef<any>(null);
  const accessTokenRef = useRef<string>('');
  const baseUrlRef = useRef<string>('');
  const originalFetchRef = useRef<typeof fetch | null>(null);
  
  // Deferred loading state (matching Asset+ pattern exactly)
  const deferCallsRef = useRef(true);
  const deferredFmGuidRef = useRef<string | undefined>(undefined);
  const deferredDisplayActionRef = useRef<any>(undefined);
  const deferredFmGuidForDisplayRef = useRef<string | undefined>(undefined);
  const deferredDisplayActionForDisplayRef = useRef<any>(undefined);
  
  const [state, setState] = useState<ViewerState>({
    isLoading: true,
    isInitialized: false,
    error: null,
    modelInfo: null,
  });

  const [initStep, setInitStep] = useState<InitStep>('idle');
  const [modelLoadState, setModelLoadState] = useState<ModelLoadState>('idle');
  const [cacheStatus, setCacheStatus] = useState<'checking' | 'hit' | 'miss' | 'stored' | null>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  
  const [modelFilter, setModelFilter] = useState<ModelFilter>('a-prefix');

  // Find the asset data for the given fmGuid
  const assetData = allData.find((a: any) => a.fmGuid === fmGuid);
  
  // Get the building fmGuid for cache organization
  const buildingFmGuid = assetData?.buildingFmGuid || assetData?.fmGuid;


  // Get model filter predicate based on selection (matches external_viewer.html pattern)
  const getModelPredicate = useCallback((filter: ModelFilter) => {
    switch (filter) {
      case 'a-prefix':
        return (model: any) => (model?.name || "").toLowerCase().startsWith("a");
      case 'buildings-only':
        return (model: any) => {
          const name = (model?.name || "").toLowerCase();
          return name.includes("building") || name.includes("byggnad") || model?.type === 0;
        };
      case 'all':
      default:
        return () => true;
    }
  }, []);

  // Helper: Get item IDs by FmGuid
  const getItemIdsByFmGuid = useCallback((fmGuidToFind: string) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView) {
      const itemIds = assetView.getItemsByPropertyValue("fmguid", fmGuidToFind.toUpperCase());
      const annotation = assetView.findAnnotation?.("fmguid", fmGuidToFind.toUpperCase());
      if (annotation) {
        itemIds.push(annotation.getField("bimObjectId"));
      }
      return itemIds;
    }
    return [];
  }, []);

  // Helper: Find closest ancestor by category
  const findClosestAncestorByItemIdAndIfcCategory = useCallback((itemId: string, category: string) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
    let metaObject = assetView?.viewer?.metaScene?.metaObjects?.[itemId];

    while (metaObject?.id) {
      if (metaObject.type?.toLowerCase() === category.toLowerCase()) {
        return metaObject.id;
      } else if (metaObject.parent) {
        metaObject = metaObject.parent;
      } else {
        break;
      }
    }
    return undefined;
  }, []);

  const findClosestAncestorByFmGuidAndIfcCategory = useCallback((fmGuidToFind: string, category: string) => {
    const itemIds = getItemIdsByFmGuid(fmGuidToFind);
    for (const id of itemIds) {
      const parentId = findClosestAncestorByItemIdAndIfcCategory(id, category);
      if (parentId) return parentId;
    }
    return undefined;
  }, [getItemIdsByFmGuid, findClosestAncestorByItemIdAndIfcCategory]);

  // Helper: Fly to coordinates
  const flyToCoordinates = useCallback((eye: number[], look: number[], duration: number) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView && Array.isArray(eye) && eye.length > 2 && Array.isArray(look) && look.length > 2 && typeof duration === "number") {
      assetView.viewer.cameraFlight.flyTo({
        eye: eye,
        look: look,
        up: [0, 1, 0],
        duration: duration
      });
    }
  }, []);

  // Helper: Look at instance from angle (from external_viewer.html)
  const lookAtInstanceFromAngle = useCallback((fmGuidToView: string, minimumHeightAboveBase: number, heightAboveAABB: number) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView && fmGuidToView) {
      const itemsIds = getItemIdsByFmGuid(fmGuidToView);
      const aabb = assetView.getAABB(itemsIds);

      if (aabb) {
        const horizontalAngle = assetView.horizontalAngle * (Math.PI / 180);
        const verticalAngle = assetView.verticalAngle * (Math.PI / 180);
        const look = [
          (aabb[0] + aabb[3]) / 2,
          (aabb[1] + aabb[4]) / 2,
          (aabb[2] + aabb[5]) / 2
        ];

        const diagonal = Math.sqrt(
          Math.pow(aabb[3] - aabb[0], 2) +
          Math.pow(aabb[4] - aabb[1], 2) +
          Math.pow(aabb[5] - aabb[2], 2)
        );
        
        const fov = assetView.viewer.cameraFlight.fitFOV * (Math.PI / 180);
        const distance = Math.abs(diagonal / (2 * Math.tan(fov / 2)));

        const eye = [
          look[0] + distance * Math.sin(horizontalAngle) * Math.cos(verticalAngle),
          look[1] + distance * Math.sin(verticalAngle),
          look[2] + distance * Math.cos(horizontalAngle) * Math.cos(verticalAngle)
        ];

        let largestHeight = Math.abs(aabb[4] - aabb[1]);
        let foundSpace = false;
        const containingSpaceId = findClosestAncestorByFmGuidAndIfcCategory(fmGuidToView, "IfcSpace");

        if (containingSpaceId) {
          const containingSpaceAABB = assetView.getAABB(containingSpaceId);
          if (containingSpaceAABB) {
            const baseToTopOfSpaceHeight = containingSpaceAABB[4] - aabb[1];
            largestHeight = Math.max(largestHeight, baseToTopOfSpaceHeight);
            foundSpace = true;
          }
        }

        if (!foundSpace && typeof minimumHeightAboveBase === "number") {
          largestHeight = Math.max(largestHeight, minimumHeightAboveBase);
        }

        if (typeof heightAboveAABB === "number") {
          largestHeight += heightAboveAABB;
        }

        const eyeHeight = eye[1] - aabb[1];
        if (eyeHeight < largestHeight) {
          const virtualDiagonal = Math.sqrt(
            Math.pow(aabb[3] - aabb[0], 2) +
            Math.pow(largestHeight, 2) +
            Math.pow(aabb[5] - aabb[2], 2)
          );
          const scale = virtualDiagonal / diagonal;
          eye[0] += (eye[0] - look[0]) * scale;
          eye[1] += (eye[1] - look[1]) * scale;
          eye[2] += (eye[2] - look[2]) * scale;
        }

        flyToCoordinates(eye, look, lookAtSpaceAndInstanceFlyToDuration);
      }
    }
  }, [getItemIdsByFmGuid, findClosestAncestorByFmGuidAndIfcCategory, flyToCoordinates]);

  // Helper: Look at space from angle (from external_viewer.html)
  const lookAtSpaceFromAngle = useCallback((fmGuidToView: string, heightAboveAABB: number) => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;

    if (assetView && fmGuidToView) {
      const itemsIds = getItemIdsByFmGuid(fmGuidToView);
      const aabb = assetView.getAABB(itemsIds);

      if (aabb) {
        const horizontalAngle = assetView.horizontalAngle * (Math.PI / 180);
        const verticalAngle = assetView.verticalAngle * (Math.PI / 180);
        const look = [
          (aabb[0] + aabb[3]) / 2,
          (aabb[1] + aabb[4]) / 2,
          (aabb[2] + aabb[5]) / 2
        ];

        const diagonal = Math.sqrt(
          Math.pow(aabb[3] - aabb[0], 2) +
          Math.pow(aabb[4] - aabb[1], 2) +
          Math.pow(aabb[5] - aabb[2], 2)
        );
        
        const fov = assetView.viewer.cameraFlight.fitFOV * (Math.PI / 180);
        const distance = Math.abs(diagonal / (2 * Math.tan(fov / 2)));

        const eye = [
          look[0] + distance * Math.sin(horizontalAngle) * Math.cos(verticalAngle),
          look[1] + distance * Math.sin(verticalAngle),
          look[2] + distance * Math.cos(horizontalAngle) * Math.cos(verticalAngle)
        ];

        if (typeof heightAboveAABB === "number") {
          const minimumHeightAboveBase = aabb[4] - aabb[1] + heightAboveAABB;
          const eyeHeight = eye[1] - aabb[1];

          if (eyeHeight < minimumHeightAboveBase) {
            const virtualDiagonal = Math.sqrt(
              Math.pow(aabb[3] - aabb[0], 2) +
              Math.pow(minimumHeightAboveBase, 2) +
              Math.pow(aabb[5] - aabb[2], 2)
            );
            const scale = virtualDiagonal / diagonal;
            eye[0] += (eye[0] - look[0]) * scale;
            eye[1] += (eye[1] - look[1]) * scale;
            eye[2] += (eye[2] - look[2]) * scale;
          }
        }

        flyToCoordinates(eye, look, lookAtSpaceAndInstanceFlyToDuration);
      }
    }
  }, [getItemIdsByFmGuid, flyToCoordinates]);

  // Execute display action (updated from external_viewer-2.html)
  const executeDisplayAction = useCallback((displayAction: any) => {
    const viewer = viewerInstanceRef.current;
    if (!viewer) return;

    switch (displayAction?.action?.toLowerCase()) {
      case "cutoutfloor":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          console.log("Cutting out floor with FMGUID", displayAction.parameter.fmGuid, "includeRelatedFloors:", displayAction.parameter.includeRelatedFloors);
          viewer.cutOutFloorsByFmGuid(displayAction.parameter.fmGuid, displayAction.parameter.includeRelatedFloors);
        }
        break;
      case "cutoutfloor_and_lookatspace":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          // Use floorFmGuid if provided (for parent floor cutout), otherwise fall back to fmGuid
          const floorGuid = displayAction.parameter.floorFmGuid || displayAction.parameter.fmGuid;
          console.log("Cutting out floor (fmGuid:", floorGuid, ") & looking at Space with FMGUID", displayAction.parameter.fmGuid);
          viewer.cutOutFloorsByFmGuid(floorGuid, displayAction.parameter.includeRelatedFloors, { doViewFit: false });
          lookAtSpaceFromAngle(displayAction.parameter.fmGuid, displayAction.parameter.heightAboveAABB ?? defaultHeightAboveAABB);
        }
        break;
      case "cutoutfloor_and_lookatinstance":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          console.log("Cutting out floor & looking at Instance with FMGUID", displayAction.parameter.fmGuid);
          viewer.cutOutFloorsByFmGuid(displayAction.parameter.fmGuid, displayAction.parameter.includeRelatedFloors, { doViewFit: false });
          lookAtInstanceFromAngle(
            displayAction.parameter.fmGuid, 
            displayAction.parameter.minimumHeightAboveBase ?? defaultMinimumHeightAboveBase,
            displayAction.parameter.heightAboveAABB ?? defaultHeightAboveAABB
          );
        }
        break;
      case "viewall":
        console.log("Viewing all and adjusting camera.");
        viewer.assetViewer?.$refs?.assetView?.viewFit(undefined, true);
        break;
      case "viewfitfirstperson":
        if (displayAction.parameter && typeof displayAction.parameter.fmGuid === "string") {
          const matches = viewer.assetViewer?.$refs?.assetView?.getItemsByPropertyValue("fmguid", displayAction.parameter.fmGuid.toUpperCase());
          if (matches?.length > 0) {
            console.log("ViewFit (First Person Mode) FMGUID", displayAction.parameter.fmGuid);
            viewer.assetViewer.$refs.assetView.viewFit(matches, false);
            viewer.assetViewer.$refs.assetView.setNavMode("firstPerson");
          }
        }
        break;
    }
  }, [lookAtSpaceFromAngle, lookAtInstanceFromAngle]);

  // Change X-ray material (from external_viewer-2.html)
  const changeXrayMaterial = useCallback(() => {
    const viewer = viewerInstanceRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
    const xeokitViewer = assetView?.viewer;
    const scene = xeokitViewer?.scene;
    const xrayMaterial = scene?.xrayMaterial;

    if (xrayMaterial) {
      xrayMaterial.fill = true;
      xrayMaterial.fillAlpha = 0.7;
      xrayMaterial.fillColor = [200 / 255, 200 / 255, 200 / 255];
      xrayMaterial.edges = true;
      xrayMaterial.edgeAlpha = 0.6;
      xrayMaterial.edgeColor = [15 / 255, 15 / 255, 15 / 255];
    }
  }, []);

  // Do display FMGUID (from Asset+ pattern - INTERNALS section)
  const doDisplayFmGuid = useCallback((fmGuidToShow: string, displayAction?: any) => {
    const viewer = viewerInstanceRef.current;
    if (!viewer) return;

    console.log("doDisplayFmGuid:", fmGuidToShow);

    setModelLoadState('requested');
    setInitStep('request_models');

    deferredFmGuidForDisplayRef.current = fmGuidToShow;
    deferredDisplayActionForDisplayRef.current = displayAction;

    viewer.setObjectDetailsVisibility(false);
    viewer.setAvailableModelsByFmGuid(fmGuidToShow);
  }, []);

  // Display FMGUID with deferred handling (PUBLIC API section from external_viewer.html)
  const displayFmGuid = useCallback((fmGuidToShow: string, displayAction?: any) => {
    deferredFmGuidRef.current = undefined;
    deferredDisplayActionRef.current = undefined;

    if (!deferCallsRef.current) {
      console.log("displayFmGuid: Not deferring calls, showing immediately");
      doDisplayFmGuid(fmGuidToShow, displayAction);
    } else {
      console.log("displayFmGuid: Deferring calls, will show later");
      if (fmGuidToShow) {
        deferredFmGuidRef.current = fmGuidToShow;
      }
      if (displayAction) {
        deferredDisplayActionRef.current = displayAction;
      }
    }
  }, [doDisplayFmGuid]);

  // Process deferred calls (from Asset+ pattern)
  const processDeferred = useCallback(() => {
    if (deferredFmGuidRef.current) {
      const fmGuidToShow = deferredFmGuidRef.current;
      const displayAction = deferredDisplayActionRef.current;

      deferredFmGuidRef.current = undefined;
      deferredDisplayActionRef.current = undefined;

      doDisplayFmGuid(fmGuidToShow, displayAction);
    }
  }, [doDisplayFmGuid]);

  // allModelsLoadedCallback - executed when all models are loaded
  const handleAllModelsLoaded = useCallback(() => {
    console.log("allModelsLoadedCallback");

    setModelLoadState('loaded');
    setInitStep('ready');
    
    // Update cache status if we had a cache interaction
    if (cacheStatus === 'checking') {
      setCacheStatus('stored');
    }

    // Note: NavCube is not available in this Asset+ package version
    // The xeokit NavCubePlugin would need to be loaded separately
    // For now, navigation is handled through the custom toolbar

    if (deferredFmGuidForDisplayRef.current) {
      console.log("allModelsLoadedCallback - got an FMGUID to look at");
      const fmGuidToShow = deferredFmGuidForDisplayRef.current;
      const displayAction = deferredDisplayActionForDisplayRef.current;

      deferredFmGuidForDisplayRef.current = undefined;
      deferredDisplayActionForDisplayRef.current = undefined;

      // If we're not cutting the floor, then select + viewfit (zoom)
      if (!displayAction) {
        console.log("allModelsLoadedCallback - just select + zoom");
        viewerInstanceRef.current?.selectFmGuidAndViewFit(fmGuidToShow);
      } else {
        console.log("allModelsLoadedCallback - display action + select");
        executeDisplayAction(displayAction);
        viewerInstanceRef.current?.selectFmGuid(fmGuidToShow);
      }
    }

    // Silent success - no toast needed
  }, [executeDisplayAction, cacheStatus]);

  // Initialize viewer - following EXACT pattern from external_viewer.html
  // Setup XKT fetch interceptor for caching
  const setupCacheInterceptor = useCallback(() => {
    // Store original fetch if not already stored
    if (!originalFetchRef.current) {
      originalFetchRef.current = window.fetch.bind(window);
    }
    
    const originalFetch = originalFetchRef.current;
    const currentBuildingFmGuid = buildingFmGuid;
    
    // Override global fetch to intercept XKT requests
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      
      // Only intercept XKT file requests
      if (url.includes('.xkt')) {
        console.log('XKT request intercepted:', url);
        setCacheStatus('checking');
        
        try {
          // Try to get cached version
          const cachedData = await xktCacheService.fetchWithCache(url, currentBuildingFmGuid, init);
          setCacheStatus('hit');
          
          // Return as a Response object
          return new Response(cachedData, {
            status: 200,
            headers: { 'Content-Type': 'application/octet-stream' }
          });
        } catch (e) {
          console.warn('Cache fetch failed, using original:', e);
          setCacheStatus('miss');
        }
      }
      
      // Fall back to original fetch
      return originalFetch(input, init);
    };
  }, [buildingFmGuid]);

  // Restore original fetch
  const restoreFetch = useCallback(() => {
    if (originalFetchRef.current) {
      window.fetch = originalFetchRef.current;
      originalFetchRef.current = null;
    }
  }, []);

  const initializeViewer = useCallback(async () => {
    // Wait one frame so refs are attached (critical: otherwise init silently never runs)
    setInitStep('wait_dom');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    if (!viewerContainerRef.current) {
      setInitStep('error');
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: '3D container missing in DOM. Try again or reload the page.',
      }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));
    setModelLoadState('idle');
    setCacheStatus(null);
    
    // Setup cache interceptor before viewer initialization
    setupCacheInterceptor();

    try {
      setInitStep('fetch_token');
      // Fetch Asset+ access token via edge function
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke('asset-plus-query', {
        body: { action: 'getToken' }
      });

      if (tokenError) {
        throw new Error('Could not fetch access token');
      }

      const accessToken = tokenData?.accessToken;
      
      if (!accessToken) {
        throw new Error('Asset+ access token is missing. Check your API settings.');
      }

      accessTokenRef.current = accessToken;
      console.log("AssetPlusViewer: Access token received");

      setInitStep('check_script');
      // Check if assetplusviewer is available globally
      const assetplusviewer = (window as any).assetplusviewer;
      
      if (!assetplusviewer) {
        throw new Error('Asset+ 3D Viewer package is not loaded. Verify that /lib/assetplus/assetplusviewer.umd.min.js is included.');
      }

      setInitStep('fetch_config');
      // Get API configuration
      const { data: configData } = await supabase.functions.invoke('asset-plus-query', {
        body: { action: 'getConfig' }
      });

      const baseUrl = configData?.apiUrl || '';
      const apiKey = configData?.apiKey || '';

      baseUrlRef.current = baseUrl;

      console.log("AssetPlusViewer: Init - Calling assetplusviewer with baseUrl:", baseUrl);

      setInitStep('mount_viewer');
      // Initialize the viewer following EXACT Asset+ external_viewer.html pattern
      const viewer = await assetplusviewer(
        baseUrl,  // URL to the API Backend
        apiKey,   // API Key in UUID format
        // getAccessTokenCallback
        async () => {
          console.log("getAccessTokenCallback");
          return accessTokenRef.current;
        },
        // selectionChangedCallback
        (items: any[], added: any[], removed: any[]) => {
          console.log("selectionChangedCallback -", items?.length, "items.", added?.length, "added.", removed?.length, "removed.");
        },
        // selectedFmGuidsChangedCallback
        (items: string[], added: string[], removed: string[]) => {
          console.log("selectedFmGuidsChangedCallback -", items?.length, "items.", added?.length, "added.", removed?.length, "removed.");
        },
        // allModelsLoadedCallback
        handleAllModelsLoaded,
        // isItemIdEditableCallback (for BimObjectId instead of FmGuid)
        undefined,
        // isFmGuidEditableCallback
        async (fmGuidParam: string) => {
          console.log("isFmGuidEditableCallback - fmGuid:", fmGuidParam);
          return false; // Read-only for now
        },
        // additionalDefaultPredicate - model filter (matches external_viewer.html default)
        getModelPredicate(modelFilter),
        // Custom object context menu items
        [],
        // Horizontal and vertical default angles (undefined for defaults)
        undefined, undefined,
        // Annotation offsets (top, left) (undefined for defaults)
        undefined, undefined
      );

      viewerInstanceRef.current = viewer;
      console.log("AssetPlusViewer: Mounted");

      // Apply X-ray material settings
      changeXrayMaterial();

      // CRITICAL: Stop deferring calls AFTER viewer is mounted
      deferCallsRef.current = false;

      // Process any deferred calls
      processDeferred();

      // Now display the initial FMGUID with category-specific actions
      // For Building Storey: cut out the floor using the storey's fmGuid
      // For Space: cut out the parent floor (levelFmGuid) and look at the space
      let displayAction: any = undefined;
      
      if (assetData?.category === 'Building') {
        displayAction = { action: 'viewall' };
      } else if (assetData?.category === 'Building Storey') {
        // Storey: use the storey's own fmGuid for floor cutout
        displayAction = { 
          action: 'cutoutfloor', 
          parameter: { fmGuid: fmGuid, includeRelatedFloors: true } 
        };
      } else if (assetData?.category === 'Space') {
        // Space: use the parent floor's fmGuid (levelFmGuid) for cutout, then look at the space
        const floorFmGuid = assetData?.levelFmGuid || fmGuid;
        displayAction = { 
          action: 'cutoutfloor_and_lookatspace', 
          parameter: { 
            fmGuid: fmGuid,  // Space fmGuid for lookAt
            floorFmGuid: floorFmGuid, // Parent floor for cutout
            includeRelatedFloors: true, 
            heightAboveAABB: defaultHeightAboveAABB 
          } 
        };
      }
      
      displayFmGuid(fmGuid, displayAction);

      setState(prev => ({
        ...prev,
        isLoading: false,
        isInitialized: true,
        modelInfo: {
          name: assetData?.commonName || assetData?.name || 'Unknown model',
          type: 'IFC/XKT',
          lastUpdated: assetData?.sourceUpdatedAt || new Date().toISOString().split('T')[0],
        },
      }));

    } catch (error) {
      console.error('Failed to initialize 3D viewer:', error);
      setInitStep('error');
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Could not load 3D viewer',
      }));
    }
  }, [fmGuid, assetData, modelFilter, getModelPredicate, handleAllModelsLoaded, changeXrayMaterial, processDeferred, displayFmGuid, setupCacheInterceptor]);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = React.useRef(true);
  
  // Initialize on mount
  useEffect(() => {
    isMountedRef.current = true;
    initializeViewer();

    return () => {
      isMountedRef.current = false;
      
      // Restore original fetch on unmount
      restoreFetch();
      
      // Cleanup viewer on unmount - guard against null/incomplete viewer
      // The 'e.nextSibling' error occurs when Asset+ tries to manipulate DOM
      // elements that were removed before cleanup completed
      try {
        const viewer = viewerInstanceRef.current;
        if (viewer) {
          // Only call clearData if the viewer is fully initialized
          // Check for the presence of key internal objects
          const assetView = viewer.$refs?.AssetViewer?.$refs?.assetView;
          const scene = assetView?.viewer?.scene;
          
          if (scene && typeof viewer.clearData === 'function') {
            viewer.clearData();
          }
        }
      } catch (e) {
        // Silently ignore cleanup errors - the DOM is being torn down anyway
        console.debug('Viewer cleanup (expected during teardown):', e);
      }
      
      viewerInstanceRef.current = null;
      deferCallsRef.current = true;
    };
  }, [initializeViewer, restoreFetch]);

  // Viewer uses built-in Asset+ controls - no custom handlers needed

  const handleFilterChange = useCallback((filter: ModelFilter) => {
    setModelFilter(filter);
    
    // Cleanup current viewer safely before reinitializing
    try {
      const viewer = viewerInstanceRef.current;
      if (viewer) {
        const assetView = viewer.$refs?.AssetViewer?.$refs?.assetView;
        const scene = assetView?.viewer?.scene;
        
        if (scene && typeof viewer.clearData === 'function') {
          viewer.clearData();
        }
      }
    } catch (e) {
      console.debug('Filter change cleanup:', e);
    }
    
    // Restore fetch before reinitializing
    restoreFetch();
    
    // Reset all state for fresh initialization
    viewerInstanceRef.current = null;
    deferCallsRef.current = true;
    setState(prev => ({ ...prev, isInitialized: false, isLoading: true, error: null }));
    setInitStep('idle');
    setModelLoadState('idle');
    setCacheStatus(null);
    
    // Trigger reinitialization after state reset
    setTimeout(() => {
      initializeViewer();
    }, 100);
  }, [restoreFetch, initializeViewer]);

  // Model filter dropdown
  const FilterDropdown = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">
            {MODEL_FILTERS.find(f => f.value === modelFilter)?.label || 'Filter'}
          </span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {MODEL_FILTERS.map((filter) => (
          <DropdownMenuItem
            key={filter.value}
            onClick={() => handleFilterChange(filter.value)}
            className={modelFilter === filter.value ? 'bg-accent' : ''}
          >
            <div>
              <div className="font-medium">{filter.label}</div>
              <div className="text-xs text-muted-foreground">{filter.description}</div>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Show error state
  if (state.error) {
    return (
      <div className="h-full flex flex-col p-2 sm:p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg sm:text-xl font-semibold truncate">3D Viewer</h2>
            <p className="text-sm text-muted-foreground truncate">
              {assetData?.commonName || assetData?.name || fmGuid.substring(0, 16) + '...'}
            </p>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0 ml-2">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Error display */}
        <Card className="flex-1">
          <CardContent className="h-full flex items-center justify-center p-6">
            <div className="text-center space-y-4 max-w-md">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 mx-auto">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <div>
                <p className="text-lg font-medium">Could not load 3D viewer</p>
                <p className="text-sm text-muted-foreground mt-2">{state.error}</p>
              </div>
              <Button onClick={initializeViewer} variant="outline">
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main viewer - fullscreen layout without sidebar
  return (
    <div className="h-full flex flex-col">
      {/* Viewer area with dx-viewport wrapper (CRITICAL for Asset+ popups) */}
      <div className="flex-1 min-h-0">
        {/* dx-viewport wrapper - required by Asset+ for ObjectDetails popup constraint */}
        <div 
          ref={viewportWrapperRef}
          className="dx-viewport relative w-full h-full"
          style={{ margin: 0 }}
        >
          {/* AssetPlusViewer container - MUST have id="AssetPlusViewer" */}
          <div 
            ref={viewerContainerRef}
            id="AssetPlusViewer"
            className="w-full h-full dx-device-desktop dx-device-generic dx-theme-material dx-theme-material-typography asset-plus-hide-builtin-toolbar"
            style={{
              display: 'flex',
              flex: '1 0 auto',
              background: 'radial-gradient(90% 100% at center top, rgb(236, 236, 236), rgb(42, 42, 50))',
            }}
          />

          {/* Status overlay (shows while init is running and while models are loading) */}
          {(!state.isInitialized || state.isLoading || initStep !== 'ready') && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <div className="max-w-md w-[92%] sm:w-[420px] rounded-lg border bg-card p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-medium">Loading 3D model...</p>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {/* Top toolbar - contains close and filter */}
          <div className="absolute top-2 left-2 right-2 z-30 flex items-center justify-between pointer-events-none">
            {/* Close button - left side - ALWAYS VISIBLE */}
            {onClose && (
              <Button 
                variant="secondary" 
                size="icon"
                onClick={onClose} 
                className="h-10 w-10 pointer-events-auto shadow-lg bg-card/95 backdrop-blur-sm border"
                aria-label="Stäng 3D-vy"
              >
                <X className="h-5 w-5" />
              </Button>
            )}
            {!onClose && <div />}
            
            {/* Filter - right side */}
            <div className="flex gap-1.5 pointer-events-auto">
              <FilterDropdown />
            </div>
          </div>

          {/* Custom toolbar - centered at bottom */}
          {state.isInitialized && initStep === 'ready' && (
            <>
              <ViewerToolbar 
                viewerRef={viewerInstanceRef} 
                onToggleMinimap={(visible) => setShowMinimap(visible)}
              />
              <MinimapPanel
                viewerRef={viewerInstanceRef}
                isVisible={showMinimap}
                onClose={() => setShowMinimap(false)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssetPlusViewer;
