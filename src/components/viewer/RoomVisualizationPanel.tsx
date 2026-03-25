import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { Palette, X, RefreshCw, AlertCircle, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AppContext } from '@/context/AppContext';
import {
  VisualizationType,
  VISUALIZATION_CONFIGS,
  getVisualizationColor,
  rgbToFloat,
  rgbToHex,
  extractSensorValue,
  generateMockSensorData,
} from '@/lib/visualization-utils';
import { cn } from '@/lib/utils';
import IoTHoverLabel from './IoTHoverLabel';
import VisualizationLegendBar, { VISUALIZATION_LEGEND_SELECT_EVENT, type LegendSelectDetail } from './VisualizationLegendBar';

interface RoomVisualizationPanelProps {
  viewerRef: React.MutableRefObject<any>;
  buildingFmGuid: string;
  onClose?: () => void;
  onShowSpaces?: (show: boolean) => void;
  /** Array of visible floor GUIDs from floor selector - filters which rooms to visualize */
  visibleFloorFmGuids?: string[];
  className?: string;
  /** When true, renders inline without floating panel/drag/header */
  embedded?: boolean;
}

interface RoomData {
  fmGuid: string;
  name: string | null;
  levelFmGuid: string | null;
  attributes: Record<string, any> | null;
}

// Custom event for forcing spaces visibility
export const FORCE_SHOW_SPACES_EVENT = 'FORCE_SHOW_SPACES';

// Import floor selection event from the canonical source
import { FLOOR_SELECTION_CHANGED_EVENT, type FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { VISUALIZATION_QUICK_SELECT_EVENT } from './VisualizationQuickBar';

// LocalStorage key for persisting visualization settings
const STORAGE_KEY = 'roomVisualizationSettings';

/** Resolve the xeokit viewer instance from the ref — tries Asset+ shim path first, then native */
export const resolveXeokitViewer = (viewerRef: React.MutableRefObject<any>): any | null => {
  const v = viewerRef.current;
  // Asset+ shim path (full nesting)
  const shim = v?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  if (shim?.scene) return shim;
  // NativeViewerShell shim path (without AssetViewer nesting)
  const nativeShim = v?.$refs?.assetView?.viewer;
  if (nativeShim?.scene) return nativeShim;
  // Native xeokit viewer path
  if (v?.viewer?.scene) return v.viewer;
  // Direct ref
  if (v?.scene) return v;
  // Global fallback for NativeXeokitViewer
  const globalViewer = (window as any).__nativeXeokitViewer;
  if (globalViewer?.scene) return globalViewer;
  return null;
};
/**
 * Floating, draggable panel for visualizing rooms with color-coding based on sensor data.
 * OPTIMIZED: Uses in-memory allData instead of DB queries for performance.
 * Auto-activates "Visa Rum" on mount and supports floor filtering.
 * Settings are persisted to localStorage across sessions.
 */
const RoomVisualizationPanel: React.FC<RoomVisualizationPanelProps> = ({
  viewerRef,
  buildingFmGuid,
  onClose,
  onShowSpaces,
  visibleFloorFmGuids: visibleFloorFmGuidsProp,
  className,
  embedded = false,
}) => {
  const { allData } = useContext(AppContext);

  // Track floor selection from events — overrides prop when available
  const [eventFloorGuids, setEventFloorGuids] = useState<string[] | null>(null);
  const [eventIsAllVisible, setEventIsAllVisible] = useState(true);

  // Listen for floor selection changes to get the latest floor state
  useEffect(() => {
    const handleFloorChange = (e: CustomEvent<FloorSelectionEventDetail>) => {
      const { visibleFloorFmGuids: guids, isAllFloorsVisible } = e.detail;
      setEventIsAllVisible(!!isAllFloorsVisible);
      if (isAllFloorsVisible) {
        setEventFloorGuids(null); // null = all floors, skip filtering
      } else if (guids && guids.length > 0) {
        setEventFloorGuids(guids);
      }
      // Also invalidate cache
      setCacheKey(`${buildingFmGuid}-${Date.now()}`);
    };
    
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
    return () => {
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleFloorChange as EventListener);
    };
  }, [buildingFmGuid]);

  // Effective visible floor guids: prefer event-based, fall back to prop
  const visibleFloorFmGuids = eventFloorGuids ?? visibleFloorFmGuidsProp;
  
  // Always start with 'none' — user must explicitly choose a color filter
  const [visualizationType, setVisualizationType] = useState<VisualizationType>('none');
  
  const [useMockData, setUseMockData] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.mock ?? false;
      }
    } catch (e) { /* ignore */ }
    return false;
  });
  
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [colorizedCount, setColorizedCount] = useState(0);
  const [hasRealData, setHasRealData] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Listen for quick-select events from VisualizationQuickBar
  useEffect(() => {
    const handler = (e: CustomEvent<{ type: VisualizationType }>) => {
      setVisualizationType(e.detail.type);
      if (e.detail.type !== 'none' && !hasRealData) {
        setUseMockData(true);
      }
    };
    window.addEventListener(VISUALIZATION_QUICK_SELECT_EVENT, handler as EventListener);
    return () => window.removeEventListener(VISUALIZATION_QUICK_SELECT_EVENT, handler as EventListener);
  }, [hasRealData]);

  const [entityIdCache, setEntityIdCache] = useState<Map<string, string[]>>(new Map());
  const [cacheKey, setCacheKey] = useState<string>(''); // For cache invalidation
  
  // Ref to track ALL colorized room fmGuids to ensure proper reset across floor changes
  const colorizedRoomGuidsRef = useRef<Set<string>>(new Set());
  
  // Cancel ref for aborting in-progress chunk processing
  const cancelRef = useRef(false);
  
  // Active legend range ref for toggle behavior
  const activeLegendRangeRef = useRef<{min: number, max: number} | null>(null);

  // Draggable panel state
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  // Hover label state for IoT visualization
  const [hoverLabel, setHoverLabel] = useState<{
    visible: boolean;
    position: { x: number; y: number };
    roomName: string;
    value: number;
    color: [number, number, number];
  } | null>(null);

  const config = VISUALIZATION_CONFIGS[visualizationType];

  // Reset visualization when building changes
  useEffect(() => {
    setVisualizationType('none');
    setUseMockData(false);
  }, [buildingFmGuid]);

  // Initialize position when panel opens
  useEffect(() => {
    if (position.x === 0 && position.y === 0) {
      const initialX = typeof window !== 'undefined' ? window.innerWidth - 320 : 200;
      setPosition({ x: initialX, y: 80 });
    }
  }, [position.x, position.y]);

  // Auto-activate "Visa Rum" on mount and dispatch event
  useEffect(() => {
    // Dispatch event for VisualizationToolbar to listen to
    window.dispatchEvent(new CustomEvent(FORCE_SHOW_SPACES_EVENT, { detail: { show: true } }));
    
    if (onShowSpaces) {
      onShowSpaces(true);
    }
    // Also try to set directly on the viewer
    try {
      const assetViewer = viewerRef.current?.assetViewer;
      assetViewer?.onShowSpacesChanged?.(true);
    } catch (e) {
      console.debug('Could not auto-activate spaces:', e);
    }
  }, [onShowSpaces, viewerRef]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select, [role="switch"], [role="combobox"]')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 300, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 300, e.clientY - dragOffset.y)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  // Save settings to localStorage and dispatch state change event
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        type: visualizationType,
        mock: useMockData
      }));
    } catch (e) { /* ignore */ }

    // Dispatch event so the legend bar (rendered outside this component) can update
    window.dispatchEvent(new CustomEvent('VISUALIZATION_STATE_CHANGED', {
      detail: {
        visualizationType,
        useMockData,
        rooms: rooms.map(r => ({ fmGuid: r.fmGuid, name: r.name, attributes: r.attributes })),
      },
    }));
  }, [visualizationType, useMockData, rooms]);

  // Cache invalidation is now handled by the event listener above

  // Get rooms from in-memory allData (FAST - no DB queries)
  const filteredRooms = useMemo(() => {
    if (!buildingFmGuid || !allData.length) return [];
    
    const buildingLower = buildingFmGuid.toLowerCase();
    
    // Filter rooms for this building
    let roomData = allData
      .filter((a: any) => {
        const cat = a.category;
        return (cat === 'Space' || cat === 'IfcSpace') && 
          a.buildingFmGuid?.toLowerCase() === buildingLower;
      })
      .map((r: any) => ({
        fmGuid: r.fmGuid,
        name: r.name || r.commonName,
        levelFmGuid: r.levelFmGuid,
        attributes: r.attributes,
      }));

    // Filter by visible floors if specified (case-insensitive matching)
    if (visibleFloorFmGuids && visibleFloorFmGuids.length > 0) {
      const lowerCaseVisibleGuids = visibleFloorFmGuids.map(g => g.toLowerCase());
      roomData = roomData.filter(room => {
        if (!room.levelFmGuid) return true; // Include rooms without floor association
        return lowerCaseVisibleGuids.includes(room.levelFmGuid.toLowerCase());
      });
    }

    return roomData as RoomData[];
  }, [allData, buildingFmGuid, visibleFloorFmGuids]);

  // Update rooms state when filter changes
  useEffect(() => {
    setRooms(filteredRooms);
    
    // Check if any rooms have real sensor data
    const hasReal = filteredRooms.some((room) => {
      const attrs = room.attributes;
      if (!attrs) return false;
      const keys = Object.keys(attrs);
      return keys.some(
        (k) => {
          const lk = k.toLowerCase().replace(/[\s_-]/g, '');
          return lk.includes('sensortemperature') || lk.includes('temperature') ||
            lk.includes('sensorco2') || lk.includes('co2') ||
            lk.includes('sensorhum') || lk.includes('humidity') ||
            lk.includes('sensoroccupancy') || lk.includes('occupancy');
        }
      );
    });
    setHasRealData(hasReal);

    const floorInfo = visibleFloorFmGuids && visibleFloorFmGuids.length > 0 
      ? `${visibleFloorFmGuids.length} floors selected` 
      : 'all';
    console.log(`Room visualization: ${filteredRooms.length} rooms (floor: ${floorInfo})`);
  }, [filteredRooms, visibleFloorFmGuids]);

  // Build entity ID cache from metaScene (rebuild when cacheKey changes)
  useEffect(() => {
    const xeokitViewer = resolveXeokitViewer(viewerRef);
    if (!xeokitViewer?.metaScene?.metaObjects) {
      // Retry after a delay if viewer isn't ready yet
      const retryTimer = setTimeout(() => {
        setCacheKey(prev => prev + '-retry');
      }, 500);
      return () => clearTimeout(retryTimer);
    }

    const metaObjects = xeokitViewer.metaScene.metaObjects;
    const cache = new Map<string, string[]>();
    
    // Build parent->children map for fast traversal
    const childrenMap = new Map<string, string[]>();
    Object.values(metaObjects).forEach((metaObj: any) => {
      const parentId = metaObj.parent?.id;
      if (parentId) {
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, []);
        }
        childrenMap.get(parentId)!.push(metaObj.id);
      }
    });
    
    // Helper to get all child IDs recursively
    const getAllChildIds = (id: string): string[] => {
      const ids = [id];
      const children = childrenMap.get(id) || [];
      children.forEach(childId => {
        ids.push(...getAllChildIds(childId));
      });
      return ids;
    };
    
    // Index all IfcSpace objects by their fmGuid — use multiple matching strategies
    Object.values(metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() === 'ifcspace') {
        const childIds = getAllChildIds(metaObj.id);
        
        // Strategy 1: originalSystemId (IFC GlobalId)
        const origId = (metaObj.originalSystemId || '').toLowerCase();
        if (origId) {
          cache.set(origId, childIds);
        }
        
        // Strategy 2: externalId
        const extId = (metaObj.externalId || '').toLowerCase();
        if (extId && extId !== origId) {
          cache.set(extId, childIds);
        }
        
        // Strategy 3: metaObj.id itself
        const objId = (metaObj.id || '').toLowerCase();
        if (objId && objId !== origId && objId !== extId) {
          cache.set(objId, childIds);
        }
        
        // Strategy 4: scan propertySets for fmGuid/fmguid properties
        const propertySets = metaObj.propertySets || [];
        propertySets.forEach((ps: any) => {
          const props = ps.properties || [];
          props.forEach((p: any) => {
            const pName = (p.name || '').toLowerCase();
            if (pName === 'fmguid' || pName === 'fm_guid' || pName === 'fm guid') {
              const val = (p.value || '').toLowerCase();
              if (val && !cache.has(val)) {
                cache.set(val, childIds);
              }
            }
          });
        });
      }
    });
    
    // Strategy 5: scan scene objects for entity IDs that contain fmGuid patterns
    const scene = xeokitViewer.scene;
    if (scene?.objects) {
      const sceneObjectIds = Object.keys(scene.objects);
      const allDataRooms = filteredRooms;
      let fallbackCount = 0;
      allDataRooms.forEach(room => {
        const roomGuidLower = room.fmGuid.toLowerCase();
        if (cache.has(roomGuidLower)) return;
        
        const matchingIds = sceneObjectIds.filter(id => 
          id.toLowerCase().includes(roomGuidLower)
        );
        if (matchingIds.length > 0) {
          cache.set(roomGuidLower, matchingIds);
          fallbackCount++;
        }
      });
      if (fallbackCount > 0) {
        console.log(`Entity cache: ${fallbackCount} rooms matched via scene object ID fallback`);
      }
    }

    // Strategy 6: Name-based matching for Asset+ rooms whose FMGUID differs from BIM GUID
    // Build a name→childIds map from IfcSpace metaObjects
    const nameToChildIds = new Map<string, string[]>();
    Object.values(metaObjects).forEach((metaObj: any) => {
      if (metaObj.type?.toLowerCase() === 'ifcspace' && metaObj.name) {
        const nameLower = metaObj.name.trim().toLowerCase();
        if (!nameToChildIds.has(nameLower)) {
          nameToChildIds.set(nameLower, getAllChildIds(metaObj.id));
        }
      }
    });

    let nameMatchCount = 0;
    filteredRooms.forEach(room => {
      const roomGuidLower = room.fmGuid.toLowerCase();
      if (cache.has(roomGuidLower)) return; // Already resolved
      if (!room.name) return;

      const roomNameLower = room.name.trim().toLowerCase();
      const childIds = nameToChildIds.get(roomNameLower);
      if (childIds && childIds.length > 0) {
        cache.set(roomGuidLower, childIds);
        nameMatchCount++;
      }
    });
    if (nameMatchCount > 0) {
      console.log(`Entity cache: ${nameMatchCount} rooms matched via name-based fallback`);
    }
    
    setEntityIdCache(cache);
    console.log(`Built entity ID cache: ${cache.size} entries for spaces`);
  }, [viewerRef, cacheKey, buildingFmGuid, filteredRooms]);

  // Get item IDs by FmGuid using cache (fast O(1) lookup)
  const getItemIdsByFmGuid = useCallback((fmGuidToFind: string): string[] => {
    const cached = entityIdCache.get(fmGuidToFind.toLowerCase());
    if (cached) return cached;
    
    // Fallback to viewer method if not in cache
    const viewer = viewerRef.current;
    const assetView = viewer?.$refs?.AssetViewer?.$refs?.assetView;
    if (assetView?.getItemsByPropertyValue) {
      return assetView.getItemsByPropertyValue('fmguid', fmGuidToFind.toUpperCase()) || [];
    }
    return [];
  }, [viewerRef, entityIdCache]);

  // Colorize a single space in the viewer
  const colorizeSpace = useCallback(
    (fmGuid: string, color: [number, number, number] | null) => {
      const xeokitViewer = resolveXeokitViewer(viewerRef);
      if (!xeokitViewer?.scene) return false;

      const itemIds = getItemIdsByFmGuid(fmGuid);
      if (itemIds.length === 0) return false;

      const scene = xeokitViewer.scene;
      itemIds.forEach((id: string) => {
        const entity = scene.objects?.[id];
        if (entity) {
          if (color) {
            entity.colorize = rgbToFloat(color);
            entity.opacity = 0.15; // Tandem-style: nearly transparent, color visible on floor without blocking view
          } else {
            entity.colorize = null; // Reset to default
            entity.opacity = 1.0; // Reset opacity
          }
        }
      });

      return true;
    },
    [viewerRef, getItemIdsByFmGuid]
  );

  // Reset all room colors - uses ref to reset ALL previously colorized rooms
  const resetColors = useCallback(() => {
    // Reset from current rooms state
    rooms.forEach((room) => {
      colorizeSpace(room.fmGuid, null);
    });
    
    // ALSO reset any rooms that were colorized but may no longer be in current filter
    colorizedRoomGuidsRef.current.forEach((fmGuid) => {
      colorizeSpace(fmGuid, null);
    });
    
    // Clear the tracking set and global viz entity IDs
    colorizedRoomGuidsRef.current.clear();
    (window as any).__vizColorizedEntityIds = new Set<string>();
    setColorizedCount(0);
  }, [rooms, colorizeSpace]);

  // Apply visualization colors with chunking for smooth UI
  const isProcessingRef = useRef(false);
  const applyVisualization = useCallback(() => {
    if (visualizationType === 'none') {
      resetColors();
      return;
    }

    // Guard: prevent overlapping executions
    if (isProcessingRef.current) {
      console.debug('applyVisualization skipped – already in progress');
      return;
    }

    // Cancel any in-progress chunking
    cancelRef.current = true;

    isProcessingRef.current = true;
    setIsProcessing(true);
    cancelRef.current = false; // Reset cancel flag for new run

    // Collect previous guids to reset, then clear the set
    const previousGuids = Array.from(colorizedRoomGuidsRef.current);
    colorizedRoomGuidsRef.current.clear();

    let count = 0;
    const CHUNK_SIZE = 30;
    // Track entity IDs for XrayToggle protection
    const vizEntityIdSet = new Set<string>();

    // Phase 1: reset previous rooms in chunks
    const resetChunks: string[][] = [];
    for (let i = 0; i < previousGuids.length; i += CHUNK_SIZE) {
      resetChunks.push(previousGuids.slice(i, i + CHUNK_SIZE));
    }

    // Phase 2: apply new colors in chunks
    const applyChunks: RoomData[][] = [];
    for (let i = 0; i < rooms.length; i += CHUNK_SIZE) {
      applyChunks.push(rooms.slice(i, i + CHUNK_SIZE));
    }

    let resetIndex = 0;
    let applyIndex = 0;

    const processNext = () => {
      if (cancelRef.current) {
        setColorizedCount(count);
        setIsProcessing(false);
        isProcessingRef.current = false;
        return;
      }

      // First finish resetting previous rooms
      if (resetIndex < resetChunks.length) {
        resetChunks[resetIndex].forEach((fmGuid) => colorizeSpace(fmGuid, null));
        resetIndex++;
        requestAnimationFrame(processNext);
        return;
      }

      // Then apply new colors
      if (applyIndex < applyChunks.length) {
        applyChunks[applyIndex].forEach((room) => {
          let value: number | null = null;

          if (useMockData) {
            value = generateMockSensorData(room.fmGuid, visualizationType);
          } else {
            value = extractSensorValue(room.attributes, visualizationType);
          }

          if (value !== null) {
            const color = getVisualizationColor(value, visualizationType);
            if (color && colorizeSpace(room.fmGuid, color)) {
              colorizedRoomGuidsRef.current.add(room.fmGuid);
              // Also track entity IDs globally for XrayToggle to protect
              const ids = getItemIdsByFmGuid(room.fmGuid);
              ids.forEach(id => vizEntityIdSet.add(id));
              count++;
            }
          }
        });
        applyIndex++;
        if ('requestIdleCallback' in window) {
          requestIdleCallback(processNext, { timeout: 16 });
        } else {
          requestAnimationFrame(processNext);
        }
        return;
      }

      // Done — expose protected entity IDs globally for XrayToggle
      (window as any).__vizColorizedEntityIds = vizEntityIdSet;
      setColorizedCount(count);
      setIsProcessing(false);
      isProcessingRef.current = false;
      console.log(`Applied ${visualizationType} visualization to ${count} rooms`);
    };

    requestAnimationFrame(processNext);
  }, [visualizationType, rooms, useMockData, colorizeSpace, resetColors]);

  // Apply visualization when type or mock data changes (AUTO-APPLY with retry)
  useEffect(() => {
    if (visualizationType === 'none') {
      resetColors();
      return;
    }

    // Force show spaces when visualization is active
    window.dispatchEvent(new CustomEvent(FORCE_SHOW_SPACES_EVENT, { detail: { show: true } }));
    if (onShowSpaces) onShowSpaces(true);

    // Retry mechanism - wait for cache and rooms to be ready
    let cancelled = false;
    const applyWithRetry = (attempt: number) => {
      if (cancelled) return;
      // Early exit: if cache and rooms are both empty and we've already tried once, stop polling
      if (entityIdCache.size > 0 && rooms.length > 0) {
        setColorizedCount(0);
        applyVisualization();
      } else if (attempt < 12) {
        // Poll more aggressively: metaScene may take time to populate after model load
        const delay = attempt < 3 ? 300 : attempt < 6 ? 500 : 1000;
        setTimeout(() => applyWithRetry(attempt + 1), delay);
      } else {
        console.debug('Room visualization: gave up after 12 attempts - cache:', entityIdCache.size, 'rooms:', rooms.length);
        // Last resort: force rebuild the entity cache
        if (entityIdCache.size === 0) {
          setCacheKey(`${buildingFmGuid}-force-${Date.now()}`);
        }
      }
    };

    // Short delay to let viewer render IfcSpace objects after force-show
    const timer = setTimeout(() => applyWithRetry(0), 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visualizationType, useMockData, rooms.length, entityIdCache.size]); // eslint-disable-line react-hooks/exhaustive-deps


  // Cleanup on unmount - reset ALL tracked colorized rooms
  // Use a ref for colorizeSpace to avoid stale closure
  const colorizeSpaceRef = useRef(colorizeSpace);
  colorizeSpaceRef.current = colorizeSpace;
  
  useEffect(() => {
    return () => {
      // Reset all rooms in the tracking ref
      colorizedRoomGuidsRef.current.forEach((fmGuid) => {
        colorizeSpaceRef.current(fmGuid, null);
      });
      colorizedRoomGuidsRef.current.clear();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for FLOOR_VISIBILITY_APPLIED to re-apply colors after floor changes
  useEffect(() => {
    const handler = () => {
      if (visualizationType !== 'none' && rooms.length > 0) {
        // Re-apply colors after floor visibility has settled
        setTimeout(() => applyVisualization(), 300);
      }
    };
    window.addEventListener('FLOOR_VISIBILITY_APPLIED', handler);
    return () => window.removeEventListener('FLOOR_VISIBILITY_APPLIED', handler);
  }, [visualizationType, rooms.length, applyVisualization]);

  // Listen for legend bar selection events — select matching rooms in viewer
  useEffect(() => {
    const handleLegendSelect = (e: CustomEvent<LegendSelectDetail>) => {
      const { rangeMin, rangeMax, type } = e.detail;
      if (type !== visualizationType) return;

      const xeokitViewer = resolveXeokitViewer(viewerRef);
      if (!xeokitViewer?.scene) return;

      const scene = xeokitViewer.scene;

      // Toggle off if clicking the same range again
      if (activeLegendRangeRef.current &&
          rangeMin === activeLegendRangeRef.current.min && 
          rangeMax === activeLegendRangeRef.current.max) {
        const allIds = scene.objectIds || [];
        scene.setObjectsXRayed(allIds, false);
        scene.setObjectsSelected(allIds, false);
        activeLegendRangeRef.current = null;
        return;
      }

      // Deselect all previously selected
      if (scene.selectedObjectIds?.length) {
        scene.setObjectsSelected(scene.selectedObjectIds, false);
      }

      // Find rooms in range and select their entities
      const idsToSelect: string[] = [];
      rooms.forEach(room => {
        const value = useMockData
          ? generateMockSensorData(room.fmGuid, visualizationType)
          : extractSensorValue(room.attributes, visualizationType);
        if (value !== null && value >= rangeMin && value <= rangeMax) {
          const ids = getItemIdsByFmGuid(room.fmGuid);
          idsToSelect.push(...ids);
        }
      });

      const allIds = scene.objectIds || [];
      if (idsToSelect.length > 0) {
        // X-ray ALL objects for transparent ghosting
        const xrayMaterial = scene?.xrayMaterial;
        if (xrayMaterial) {
          xrayMaterial.fill = true;
          xrayMaterial.fillAlpha = 0.1;
          xrayMaterial.fillColor = [0.5, 0.5, 0.5];
          xrayMaterial.edges = true;
          xrayMaterial.edgeAlpha = 0.2;
          xrayMaterial.edgeColor = [0.3, 0.3, 0.3];
        }
        scene.alphaDepthMask = false;
        scene.setObjectsXRayed(allIds, true);
        // Un-xray matching rooms so their colors show through
        idsToSelect.forEach(id => {
          const e = scene.objects?.[id];
          if (e) e.xrayed = false;
        });
        scene.setObjectsSelected(idsToSelect, true);
        activeLegendRangeRef.current = { min: rangeMin, max: rangeMax };
        console.log(`Legend select: ${idsToSelect.length} entities xray-highlighted in range [${rangeMin.toFixed(1)}, ${rangeMax.toFixed(1)}]`);
      } else {
        // No matches: remove xray
        scene.setObjectsXRayed(allIds, false);
        activeLegendRangeRef.current = null;
      }
    };

    window.addEventListener(VISUALIZATION_LEGEND_SELECT_EVENT, handleLegendSelect as EventListener);
    return () => {
      window.removeEventListener(VISUALIZATION_LEGEND_SELECT_EVENT, handleLegendSelect as EventListener);
    };
  }, [viewerRef, visualizationType, rooms, useMockData, getItemIdsByFmGuid]);

  // Hover listener for IoT labels on rooms - displays sensor value on hover
  useEffect(() => {
    if (visualizationType === 'none') {
      setHoverLabel(null);
      return;
    }

    const xeokitViewer = resolveXeokitViewer(viewerRef);
    if (!xeokitViewer?.cameraControl) return;

    // Helper to find room by entity ID
    const getRoomFromEntityId = (entityId: string): RoomData | null => {
      // Try to find the fmGuid from entity's metadata
      const metaObj = xeokitViewer.metaScene?.metaObjects?.[entityId];
      if (!metaObj) return null;

      // Get fmGuid from originalSystemId or traverse up to find parent IfcSpace
      let currentMeta = metaObj;
      while (currentMeta) {
        if (currentMeta.type?.toLowerCase() === 'ifcspace') {
          const fmGuid = (currentMeta.originalSystemId || currentMeta.id || '').toLowerCase();
          return rooms.find(r => r.fmGuid.toLowerCase() === fmGuid) || null;
        }
        currentMeta = currentMeta.parent;
      }
      return null;
    };

    const handleHover = (entityId: string | null, canvasCoords: number[]) => {
      if (!entityId) {
        setHoverLabel(null);
        return;
      }

      const room = getRoomFromEntityId(entityId);
      if (!room) {
        setHoverLabel(null);
        return;
      }

      const value = useMockData
        ? generateMockSensorData(room.fmGuid, visualizationType)
        : extractSensorValue(room.attributes, visualizationType);

      if (value === null) {
        setHoverLabel(null);
        return;
      }

      const color = getVisualizationColor(value, visualizationType);
      if (!color) {
        setHoverLabel(null);
        return;
      }

      setHoverLabel({
        visible: true,
        position: { x: canvasCoords[0], y: canvasCoords[1] },
        roomName: room.name || 'Okänt rum',
        value,
        color,
      });
    };

    // xeokit hover event
    const onHover = (canvasCoords: number[], hit: any) => {
      if (hit?.entity?.id) {
        handleHover(hit.entity.id, canvasCoords);
      } else {
        setHoverLabel(null);
      }
    };

    xeokitViewer.cameraControl.on('hover', onHover);

    return () => {
      xeokitViewer.cameraControl?.off?.('hover', onHover);
      setHoverLabel(null);
    };
  }, [viewerRef, visualizationType, rooms, useMockData]);

  // Generate legend gradient
  const legendGradient = useMemo(() => {
    if (!config || config.colorStops.length === 0) return '';

    const stops = config.colorStops.map((stop) => {
      const percent = ((stop.value - config.min) / (config.max - config.min)) * 100;
      return `${rgbToHex(stop.color)} ${percent}%`;
    });

    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [config]);

  // Shared content JSX
  const contentJSX = (
    <div className={cn(embedded ? "space-y-3" : "p-3 space-y-4")}>
      {/* Header removed - parent Collapsible already shows "Rumsvisualisering" */}

      {/* Visualization type selector */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Visualization type</Label>
        <Select
          value={visualizationType}
          onValueChange={(v) => setVisualizationType(v as VisualizationType)}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Select type…" />
          </SelectTrigger>
          <SelectContent className="bg-card border shadow-lg z-[60]">
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="temperature">🌡️ Temperature</SelectItem>
            <SelectItem value="co2">💨 CO₂</SelectItem>
            <SelectItem value="humidity">💧 Humidity</SelectItem>
            <SelectItem value="occupancy">👥 Occupancy</SelectItem>
            <SelectItem value="area">📐 Area (NTA)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mock data toggle */}
      {!hasRealData && visualizationType !== 'none' && (
        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-1">
            <AlertCircle className="h-3 w-3 text-amber-500" />
            Simulated data
          </Label>
          <Switch checked={useMockData} onCheckedChange={setUseMockData} />
        </div>
      )}

      {hasRealData && visualizationType !== 'none' && (
        <p className="text-xs text-green-600">✓ Real sensor data available</p>
      )}

      {/* Legend */}
      {visualizationType !== 'none' && config && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Color scale ({config.unit})</Label>
          <div className="h-4 rounded-sm" style={{ background: legendGradient }} />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{config.min} {config.unit}</span>
            <span>{config.max} {config.unit}</span>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
        <span>{isProcessing ? 'Processing…' : `${rooms.length} rooms found`}</span>
        {colorizedCount > 0 && <span className="text-primary">{colorizedCount} färglagda</span>}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={resetColors} disabled={colorizedCount === 0 || isProcessing}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Rensa färger
        </Button>
      </div>
    </div>
  );

  // Embedded mode - render inline without floating panel
  if (embedded) {
    return (
      <div className={className}>
        {contentJSX}
        {hoverLabel && (
          <IoTHoverLabel
            visible={hoverLabel.visible}
            position={hoverLabel.position}
            roomName={hoverLabel.roomName}
            value={hoverLabel.value}
            visualizationType={visualizationType}
            color={hoverLabel.color}
          />
        )}
      </div>
    );
  }

  // Standalone floating panel mode
  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed z-[55] w-72',
        'bg-card/60 backdrop-blur-md border rounded-lg shadow-xl',
        isDragging && 'cursor-grabbing opacity-90',
        className
      )}
      style={{ left: position.x, top: position.y }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between p-3 border-b cursor-grab select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <Palette className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Rumsvisualisering</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {contentJSX}

      {/* IoT Hover Label */}
      {hoverLabel && (
        <IoTHoverLabel
          visible={hoverLabel.visible}
          position={hoverLabel.position}
          roomName={hoverLabel.roomName}
          value={hoverLabel.value}
          visualizationType={visualizationType}
          color={hoverLabel.color}
        />
      )}
    </div>
  );
};

export default RoomVisualizationPanel;
