import React, { useEffect, useRef, useState, useCallback, useContext } from 'react';
import { Loader2, AlertCircle, X, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import ViewerToolbar from './ViewerToolbar';
import MinimapPanel from './MinimapPanel';
import FloorCarousel, { FloorInfo } from './FloorCarousel';
import AnnotationToggleMenu from './AnnotationToggleMenu';
import AssetPropertiesDialog from './AssetPropertiesDialog';
import ToolbarSettings from './ToolbarSettings';
import ViewerTreePanel from './ViewerTreePanel';
import RoomVisualizationPanel from './RoomVisualizationPanel';
import VisualizationToolbar from './VisualizationToolbar';
import { xktCacheService } from '@/services/xkt-cache-service';
import { isModelInMemory, getModelFromMemory, storeModelInMemory } from '@/hooks/useXktPreload';
import { useFlashHighlight } from '@/hooks/useFlashHighlight';
import { NavigatorNode } from '@/components/navigator/TreeNode';

interface AssetPlusViewerProps {
  fmGuid: string;
  onClose?: () => void;
  // External pick mode control for asset registration flow
  pickModeEnabled?: boolean;
  onCoordinatePicked?: (
    coords: { x: number; y: number; z: number },
    parentNode: NavigatorNode | null
  ) => void;
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
const AssetPlusViewer: React.FC<AssetPlusViewerProps> = ({ fmGuid, onClose, pickModeEnabled, onCoordinatePicked }) => {
  const { allData } = useContext(AppContext);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewportWrapperRef = useRef<HTMLDivElement>(null);
  const viewerInstanceRef = useRef<any>(null);
  const navCubeRef = useRef<any>(null);
  const accessTokenRef = useRef<string>('');
  const baseUrlRef = useRef<string>('');
  const originalFetchRef = useRef<typeof fetch | null>(null);
  
  // Deferred loading state (matching Asset+ pattern exactly)
  const deferCallsRef = useRef(true);
  const deferredFmGuidRef = useRef<string | undefined>(undefined);
  const deferredDisplayActionRef = useRef<any>(undefined);
  const deferredFmGuidForDisplayRef = useRef<string | undefined>(undefined);
  const deferredDisplayActionForDisplayRef = useRef<any>(undefined);
  const flashOnSelectEnabledRef = useRef(true);
  
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
  const [showNavCube, setShowNavCube] = useState(true);

  // Coordinate picker state
  const [isPickMode, setIsPickMode] = useState(false);
  const [pickedCoordinates, setPickedCoordinates] = useState<{ x: number; y: number; z: number } | null>(null);
  const [addAssetDialogOpen, setAddAssetDialogOpen] = useState(false);
  const [addAssetParentNode, setAddAssetParentNode] = useState<NavigatorNode | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [showFloorCarousel, setShowFloorCarousel] = useState(false);
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [selectedFmGuids, setSelectedFmGuids] = useState<string[]>([]);
  const [toolbarSettingsOpen, setToolbarSettingsOpen] = useState(false);
  const [showTreePanel, setShowTreePanel] = useState(false);
  const [showVisualizationPanel, setShowVisualizationPanel] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [flashOnSelectEnabled, setFlashOnSelectEnabledState] = useState(true);
  const [hoverHighlightEnabled, setHoverHighlightEnabled] = useState(false);
  const pickModeListenerRef = useRef<(() => void) | null>(null);
  const hoverListenerRef = useRef<(() => void) | null>(null);
  
  // Keep ref in sync with state for callback access
  const setFlashOnSelectEnabled = useCallback((enabled: boolean) => {
    flashOnSelectEnabledRef.current = enabled;
    setFlashOnSelectEnabledState(enabled);
  }, []);
  
  // Flash highlighting hook
  const { flashEntityById, stopFlashing } = useFlashHighlight();

  // Find the asset data for the given fmGuid
  const assetData = allData.find((a: any) => a.fmGuid === fmGuid);
  
  // Get the building fmGuid for cache organization
  const buildingFmGuid = assetData?.buildingFmGuid || assetData?.fmGuid;

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

    // Enable annotations after models are loaded
    try {
      const viewer = viewerInstanceRef.current;
      const assetViewer = viewer?.assetViewer;
      if (assetViewer?.onToggleAnnotation) {
        // Enable annotation visibility
        assetViewer.onToggleAnnotation(true);
        console.log("Annotations enabled");
        
        // Fetch existing annotations
        if (assetViewer.getAnnotations) {
          assetViewer.getAnnotations();
        }
      }
    } catch (e) {
      console.debug("Could not enable annotations:", e);
    }

    // Initialize NavCube using custom plugin
    try {
      const viewer = viewerInstanceRef.current;
      const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
      const NavCubePlugin = (window as any).NavCubePlugin;
      
      if (xeokitViewer && NavCubePlugin && !navCubeRef.current) {
        const navCubeCanvas = document.getElementById('navCubeCanvas') as HTMLCanvasElement;
        if (navCubeCanvas) {
          navCubeRef.current = new NavCubePlugin(xeokitViewer, {
            canvasId: 'navCubeCanvas',
            visible: showNavCube,
            cameraFly: true,
            cameraFlyDuration: 0.5,
            color: '#CFCFCF',
            frontColor: '#55FF55',
            backColor: '#FF5555',
            leftColor: '#FFAA00',
            rightColor: '#00AAFF',
            topColor: '#7777FF',
            bottomColor: '#FFFF55',
            hoverColor: '#00FFFF',
          });
          console.log("NavCube initialized successfully");
        }
      } else if (!NavCubePlugin) {
        console.debug("NavCubePlugin not loaded yet");
      }
    } catch (e) {
      console.debug("Could not initialize NavCube:", e);
    }

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
  }, [executeDisplayAction, cacheStatus, showNavCube]);

  // NavCube visibility is now controlled via React style prop on the canvas
  // The navCubeRef.setVisible() method is NOT used to avoid DOM manipulation crashes
  // Visibility is handled in the canvas element's style: display: showNavCube ? 'block' : 'none'

  // Setup the pick mode click listener - defined before handleTogglePickMode
  const setupPickModeListenerInternal = useCallback(() => {
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) {
      console.warn('Pick mode: viewer or scene not ready');
      toast.error('Viewer ej redo. Försök igen.');
      return false;
    }

    const handlePick = (pickResult: any) => {
      if (pickResult?.worldPos) {
        const [x, y, z] = pickResult.worldPos;
        console.log('Picked coordinates:', { x, y, z });
        
        // Store coordinates
        const coords = { x, y, z };
        setPickedCoordinates(coords);
        
        // Get current room from picked entity or use current space context
        let parentNode: NavigatorNode | null = null;
        
        // Fallback: use current asset's room if it's a Space, or building storey
        if (assetData) {
          if (assetData.category === 'Space') {
            parentNode = {
              fmGuid: assetData.fmGuid,
              name: assetData.name || '',
              commonName: assetData.commonName || assetData.name || '',
              category: 'Space',
              children: [],
            };
          } else if (assetData.inRoomFmGuid) {
            const roomData = allData.find((a: any) => a.fmGuid === assetData.inRoomFmGuid);
            if (roomData) {
              parentNode = {
                fmGuid: roomData.fmGuid,
                name: roomData.name || '',
                commonName: roomData.commonName || roomData.name || '',
                category: 'Space',
                children: [],
              };
            }
          } else if (assetData.levelFmGuid) {
            const levelData = allData.find((a: any) => a.fmGuid === assetData.levelFmGuid);
            if (levelData) {
              parentNode = {
                fmGuid: levelData.fmGuid,
                name: levelData.name || '',
                commonName: levelData.commonName || levelData.name || '',
                category: 'Building Storey',
                children: [],
              };
            }
          }
        }

        // If still no parent, use the current fmGuid asset
        if (!parentNode) {
          parentNode = {
            fmGuid: fmGuid,
            name: assetData?.name || 'Current View',
            commonName: assetData?.commonName || assetData?.name || 'Current View',
            category: assetData?.category || 'Space',
            children: [],
          };
        }

        // If external callback is provided, use it (asset registration flow)
        if (onCoordinatePicked) {
          onCoordinatePicked(coords, parentNode);
          setIsPickMode(false);
        } else {
          // Internal dialog flow - open asset creation dialog
          setAddAssetParentNode(parentNode);
          setAddAssetDialogOpen(true);
          setIsPickMode(false);
        }
        
        // Cleanup listener
        if (pickModeListenerRef.current) {
          pickModeListenerRef.current();
          pickModeListenerRef.current = null;
        }
        
        toast.success(`Position vald: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
      }
    };

    // Use xeokit's pick on click
    const canvas = xeokitViewer.scene.canvas.canvas;
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const canvasPos = [
        e.clientX - rect.left,
        e.clientY - rect.top
      ];
      
      // Use xeokit's pickSurface for accurate 3D coordinates
      const pickResult = xeokitViewer.scene.pick({
        canvasPos,
        pickSurface: true,
      });
      
      if (pickResult) {
        handlePick(pickResult);
      } else {
        toast.error('Ingen yta hittades. Klicka på ett synligt objekt.');
      }
    };

    canvas.addEventListener('click', handleClick, { once: true });
    
    // Store cleanup function
    pickModeListenerRef.current = () => {
      canvas.removeEventListener('click', handleClick);
    };

    return true;
  }, [allData, assetData, fmGuid, onCoordinatePicked]);

  // Handle coordinate picking mode - supports both internal and external control
  const handleTogglePickMode = useCallback(() => {
    if (isPickMode) {
      // Disable pick mode
      setIsPickMode(false);
      toast.info('Registreringsläge avbrutet');
      
      // Remove listener if exists
      if (pickModeListenerRef.current) {
        pickModeListenerRef.current();
        pickModeListenerRef.current = null;
      }
    } else {
      // Enable pick mode
      const success = setupPickModeListenerInternal();
      if (success) {
        setIsPickMode(true);
        toast.info('Klicka på en yta i 3D-vyn för att välja position', {
          duration: 5000,
        });
      }
    }
  }, [isPickMode, setupPickModeListenerInternal]);

  // Respond to external pickModeEnabled prop changes
  useEffect(() => {
    if (pickModeEnabled && !isPickMode && state.isInitialized) {
      const success = setupPickModeListenerInternal();
      if (success) {
        setIsPickMode(true);
        toast.info('Klicka på en yta i 3D-vyn för att välja position', {
          duration: 5000,
        });
      }
    } else if (!pickModeEnabled && isPickMode) {
      // External cancelled pick mode
      setIsPickMode(false);
      if (pickModeListenerRef.current) {
        pickModeListenerRef.current();
        pickModeListenerRef.current = null;
      }
    }
  }, [pickModeEnabled, isPickMode, state.isInitialized, setupPickModeListenerInternal]);

  // Cleanup pick mode listener on unmount
  useEffect(() => {
    return () => {
      if (pickModeListenerRef.current) {
        pickModeListenerRef.current();
        pickModeListenerRef.current = null;
      }
    };
  }, []);

  // Handle asset created - close dialog and show toast
  const handleAssetCreated = useCallback(() => {
    setAddAssetDialogOpen(false);
    setPickedCoordinates(null);
    setAddAssetParentNode(null);
    toast.success('Tillgång registrerad med 3D-koordinater!');
  }, []);

  // Handle floor selection from carousel
  const handleFloorSelect = useCallback((floor: FloorInfo) => {
    setSelectedFloorId(floor.id);
    
    // Navigate to floor with cutout
    const viewer = viewerInstanceRef.current;
    if (viewer) {
      try {
        // Use the floor's fmGuid for cutout
        viewer.cutOutFloorsByFmGuid(floor.fmGuid, true, { doViewFit: true });
        toast.success(`Navigerar till ${floor.name}`);
      } catch (e) {
        console.debug('Could not cut out floor:', e);
      }
    }
  }, []);

  // Toggle annotations visibility
  const handleToggleAnnotations = useCallback(() => {
    try {
      const viewer = viewerInstanceRef.current?.assetViewer;
      if (viewer && typeof viewer.onToggleAnnotation === 'function') {
        const newValue = !showAnnotations;
        viewer.onToggleAnnotation(newValue);
        setShowAnnotations(newValue);
      }
    } catch (error) {
      console.warn('Toggle annotations failed:', error);
    }
  }, [showAnnotations]);

  // Setup hover highlight listener
  const setupHoverHighlight = useCallback(() => {
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) return;

    let lastHighlightedEntity: any = null;

    const handleMouseMove = (coords: number[]) => {
      // Reset previous highlight
      if (lastHighlightedEntity) {
        try {
          lastHighlightedEntity.highlighted = false;
        } catch (e) {
          // Entity may have been disposed
        }
        lastHighlightedEntity = null;
      }

      // Pick entity under mouse
      const hit = xeokitViewer.scene.pick({
        canvasPos: coords,
        pickSurface: false,
      });

      if (hit?.entity) {
        hit.entity.highlighted = true;
        lastHighlightedEntity = hit.entity;
      }
    };

    // Subscribe to mouse move events
    const cameraControl = xeokitViewer.cameraControl;
    if (cameraControl) {
      cameraControl.on('hover', handleMouseMove);
      
      // Store cleanup function
      hoverListenerRef.current = () => {
        cameraControl.off('hover', handleMouseMove);
        if (lastHighlightedEntity) {
          try {
            lastHighlightedEntity.highlighted = false;
          } catch (e) {
            // Ignore
          }
        }
      };
    }
  }, []);

  // Cleanup hover highlight listener
  const cleanupHoverHighlight = useCallback(() => {
    if (hoverListenerRef.current) {
      hoverListenerRef.current();
      hoverListenerRef.current = null;
    }
  }, []);

  // Toggle hover highlight
  useEffect(() => {
    if (hoverHighlightEnabled && state.isInitialized) {
      setupHoverHighlight();
    } else {
      cleanupHoverHighlight();
    }
    return cleanupHoverHighlight;
  }, [hoverHighlightEnabled, state.isInitialized, setupHoverHighlight, cleanupHoverHighlight]);

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
        // selectionChangedCallback - flash highlight on selection (if enabled)
        (items: any[], added: any[], removed: any[]) => {
          console.log("selectionChangedCallback -", items?.length, "items.", added?.length, "added.", removed?.length, "removed.");
          
          // Flash highlight newly selected items only if enabled
          if (added?.length > 0 && flashOnSelectEnabledRef.current) {
            const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
            if (xeokitViewer?.scene) {
              // Flash the first newly added item
              added.forEach((item: any) => {
                if (item?.id) {
                  flashEntityById(xeokitViewer.scene, item.id, {
                    color1: [1, 0.3, 0.3],
                    color2: [1, 1, 1],
                    interval: 200,
                    duration: 2000,
                  });
                }
              });
            }
          }
        },
        // selectedFmGuidsChangedCallback - Track selection for properties dialog
        (items: string[], added: string[], removed: string[]) => {
          console.log("selectedFmGuidsChangedCallback -", items?.length, "items.", added?.length, "added.", removed?.length, "removed.");
          setSelectedFmGuids(items || []);
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
        // additionalDefaultPredicate - show models with 'a' prefix by default
        (model: any) => (model?.name || "").toLowerCase().startsWith("a"),
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
  }, [fmGuid, assetData, handleAllModelsLoaded, changeXrayMaterial, processDeferred, displayFmGuid, setupCacheInterceptor]);

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
          // Defer cleanup to next frame to allow Asset+ to complete pending operations
          requestAnimationFrame(() => {
            try {
              // Only call clearData if the viewer is fully initialized
              const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
              const scene = assetView?.viewer?.scene;
              
              if (scene && typeof viewer.clearData === 'function') {
                viewer.clearData();
              }
            } catch (e) {
              // Silently ignore cleanup errors - the DOM is being torn down anyway
              console.debug('Viewer cleanup (expected during teardown):', e);
            }
          });
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
    <div className={isFullscreen ? "fixed inset-0 z-50 bg-background" : "h-full flex flex-col"}>
      {/* Viewer area with dx-viewport wrapper (CRITICAL for Asset+ popups) */}
      <div className={isFullscreen ? "h-full" : "flex-1 min-h-0"}>
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

          {/* Loading spinner overlay (shows while init is running - single spinner) */}
          {(state.isLoading && !state.isInitialized) && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
            </div>
          )}
          
          {/* Top toolbar - contains close, fullscreen, visualization menu and annotations */}
          <div className="absolute top-2 left-2 right-2 z-30 flex items-center justify-between pointer-events-none">
            {/* Close and fullscreen buttons - left side */}
            <div className="flex gap-1.5 pointer-events-auto">
              {onClose && (
                <Button 
                  variant="secondary" 
                  size="icon"
                  onClick={onClose} 
                  className="h-8 w-8 sm:h-10 sm:w-10 shadow-lg bg-card/95 backdrop-blur-sm border"
                  aria-label="Stäng 3D-vy"
                >
                  <X className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              )}
              <Button 
                variant="secondary" 
                size="icon"
                onClick={() => setIsFullscreen(!isFullscreen)} 
                className="h-8 w-8 sm:h-10 sm:w-10 shadow-lg bg-card/95 backdrop-blur-sm border"
                aria-label={isFullscreen ? "Avsluta helskärm" : "Helskärm"}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4 sm:h-5 sm:w-5" /> : <Maximize2 className="h-4 w-4 sm:h-5 sm:w-5" />}
              </Button>
            </div>
            
            {/* Right side: Visualization menu + Annotations */}
            <div className="flex gap-1.5 pointer-events-auto">
              {state.isInitialized && (
                <>
                  <VisualizationToolbar
                    viewerRef={viewerInstanceRef}
                    onToggleNavCube={(visible) => setShowNavCube(visible)}
                    onToggleMinimap={(visible) => setShowMinimap(visible)}
                    onToggleTreeView={(visible) => setShowTreePanel(visible)}
                    onToggleVisualization={(visible) => setShowVisualizationPanel(visible)}
                    onPickCoordinate={handleTogglePickMode}
                    onShowProperties={() => setPropertiesDialogOpen(true)}
                    onOpenSettings={() => setToolbarSettingsOpen(true)}
                    isPickMode={isPickMode}
                    showTreeView={showTreePanel}
                    showVisualization={showVisualizationPanel}
                    showNavCube={showNavCube}
                    showMinimap={showMinimap}
                    inline={true}
                  />
                  <AnnotationToggleMenu 
                    viewerRef={viewerInstanceRef} 
                    buildingFmGuid={fmGuid}
                  />
                </>
              )}
            </div>
          </div>

          {/* NavCube canvas - positioned in bottom-right corner, responsive size */}
          <canvas 
            id="navCubeCanvas" 
            width={typeof window !== 'undefined' && window.innerWidth < 640 ? 60 : 80}
            height={typeof window !== 'undefined' && window.innerWidth < 640 ? 60 : 80}
            className="absolute bottom-[70px] right-3 z-[25]"
            style={{
              width: typeof window !== 'undefined' && window.innerWidth < 640 ? '60px' : '80px',
              height: typeof window !== 'undefined' && window.innerWidth < 640 ? '60px' : '80px',
              display: showNavCube ? 'block' : 'none',
              background: 'rgba(20, 20, 20, 0.5)',
              borderRadius: '6px',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          />

          {/* Pick mode indicator overlay */}
          {isPickMode && (
            <div className="absolute inset-0 pointer-events-none z-10 border-4 border-dashed border-accent/50 animate-pulse">
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card/90 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg">
                <p className="text-sm font-medium text-center">
                  🎯 Klicka på en yta för att välja position
                </p>
              </div>
            </div>
          )}

          {/* Custom toolbar - centered at bottom */}
          {state.isInitialized && initStep === 'ready' && (
            <>
              <ViewerToolbar 
                viewerRef={viewerInstanceRef} 
                onOpenSettings={() => setToolbarSettingsOpen(true)}
                onToggleAnnotations={handleToggleAnnotations}
                showAnnotations={showAnnotations}
                flashOnSelectEnabled={flashOnSelectEnabled}
                onToggleFlashOnSelect={setFlashOnSelectEnabled}
                hoverHighlightEnabled={hoverHighlightEnabled}
                onToggleHoverHighlight={setHoverHighlightEnabled}
              />
              
              {/* Tree View Panel - standalone mode (not in sheet) */}
              {showTreePanel && (
                <ViewerTreePanel
                  viewerRef={viewerInstanceRef}
                  isVisible={showTreePanel}
                  onClose={() => setShowTreePanel(false)}
                  onNodeSelect={(nodeId, nodeFmGuid) => {
                    console.log('TreePanel node selected:', nodeId, nodeFmGuid);
                    // Flash the selected node
                    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
                    if (xeokitViewer?.scene) {
                      flashEntityById(xeokitViewer.scene, nodeId, {
                        color1: [0.3, 1, 0.3],
                        color2: [1, 1, 1],
                        interval: 200,
                        duration: 2000,
                      });
                    }
                  }}
                />
              )}
              <MinimapPanel
                viewerRef={viewerInstanceRef}
                isVisible={showMinimap}
                onClose={() => setShowMinimap(false)}
                onRoomClick={(roomFmGuid) => {
                  // Navigate to clicked room with floor cutout and look-at
                  const roomData = allData.find((a: any) => a.fmGuid === roomFmGuid);
                  const floorFmGuid = roomData?.levelFmGuid || roomFmGuid;
                  const displayAction = { 
                    action: 'cutoutfloor_and_lookatspace', 
                    parameter: { 
                      fmGuid: roomFmGuid,
                      floorFmGuid,
                      includeRelatedFloors: true, 
                      heightAboveAABB: defaultHeightAboveAABB 
                    } 
                  };
                  executeDisplayAction(displayAction);
                  viewerInstanceRef.current?.selectFmGuid(roomFmGuid);
                }}
              />
              <FloorCarousel
                viewerRef={viewerInstanceRef}
                onFloorSelect={handleFloorSelect}
                selectedFloorId={selectedFloorId || undefined}
              />
              
              {/* Room Visualization Panel */}
              {showVisualizationPanel && buildingFmGuid && (
                <RoomVisualizationPanel
                  viewerRef={viewerInstanceRef}
                  buildingFmGuid={buildingFmGuid}
                  onClose={() => setShowVisualizationPanel(false)}
                />
              )}
            </>
          )}

          {/* Properties Dialog - floating, dockable, supports both view/edit and create modes */}
          <AssetPropertiesDialog
            isOpen={propertiesDialogOpen || addAssetDialogOpen}
            onClose={() => {
              setPropertiesDialogOpen(false);
              setAddAssetDialogOpen(false);
              setPickedCoordinates(null);
            }}
            selectedFmGuids={addAssetDialogOpen ? [] : selectedFmGuids}
            onUpdate={handleAssetCreated}
            // Create mode props
            createMode={addAssetDialogOpen}
            parentSpaceFmGuid={addAssetParentNode?.fmGuid || null}
            buildingFmGuid={buildingFmGuid || null}
            levelFmGuid={assetData?.levelFmGuid || null}
            initialCoordinates={pickedCoordinates}
            onPickCoordinates={handleTogglePickMode}
            isPickingCoordinates={isPickMode}
          />
          
          {/* Toolbar Settings Modal */}
          <ToolbarSettings
            isOpen={toolbarSettingsOpen}
            onClose={() => setToolbarSettingsOpen(false)}
          />
        </div>
      </div>
    </div>
  );
};

export default AssetPlusViewer;
