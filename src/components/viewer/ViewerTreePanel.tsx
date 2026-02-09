import React, { useState, useEffect, useCallback, useMemo, useRef, forwardRef } from 'react';
import { ChevronRight, ChevronDown, ChevronUp, X, Search, TreeDeciduous, Layers, Building2, DoorOpen, Box, Package, GripVertical, Loader2, Check, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';

interface TreeNode {
  id: string;
  name: string;
  type: string;
  children?: TreeNode[];
  parent?: TreeNode;
  fmGuid?: string;
  objectCount?: number;
  visible: boolean;
  indeterminate: boolean;
}

interface ViewerTreePanelProps {
  viewerRef: React.RefObject<any>;
  isVisible: boolean;
  onClose: () => void;
  onNodeSelect?: (nodeId: string, fmGuid?: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  embedded?: boolean;
  showVisibilityCheckboxes?: boolean;
  startFromStoreys?: boolean;
  // Controlled state for persistence
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  expandedIds?: Set<string>;
  onExpandedIdsChange?: (ids: Set<string>) => void;
}

// IFC type labels in Swedish
const IFC_TYPE_LABELS: Record<string, string> = {
  'IfcWall': 'Vägg',
  'IfcWallStandardCase': 'Vägg',
  'IfcSlab': 'Bjälklag',
  'IfcDoor': 'Dörr',
  'IfcWindow': 'Fönster',
  'IfcColumn': 'Pelare',
  'IfcBeam': 'Balk',
  'IfcStair': 'Trappa',
  'IfcStairFlight': 'Trapparm',
  'IfcRoof': 'Tak',
  'IfcSpace': 'Rum',
  'IfcBuildingStorey': 'Våning',
  'IfcFurniture': 'Möbel',
  'IfcFurnishingElement': 'Inredning',
  'IfcRailing': 'Räcke',
  'IfcCovering': 'Beklädnad',
  'IfcPlate': 'Platta',
  'IfcMember': 'Element',
  'IfcOpeningElement': 'Öppning',
  'IfcCurtainWall': 'Glasvägg',
  'IfcFlowTerminal': 'Installation',
  'IfcFlowSegment': 'Rörsegment',
  'IfcDistributionElement': 'Installation',
  'IfcBuildingElementProxy': 'Objekt',
};

// Check if string looks like a GUID
const isGuid = (str: string): boolean => {
  if (!str || str.length < 20) return false;
  if (/^[0-9a-f]{8}[-]?[0-9a-f]{4}[-]?[0-9a-f]{4}[-]?[0-9a-f]{4}[-]?[0-9a-f]{12}$/i.test(str)) {
    return true;
  }
  if (/^[0-9a-zA-Z$_]{22,}$/.test(str)) {
    return true;
  }
  return false;
};

// Get display name for meta object
const getDisplayName = (metaObject: any, siblingIndex?: number): string => {
  if (metaObject.name && !isGuid(metaObject.name)) {
    return metaObject.name;
  }
  
  const longName = metaObject.propertySetsByName?.Pset_SpaceCommon?.LongName ||
                   metaObject.propertySetsByName?.Pset_WallCommon?.Reference ||
                   metaObject.attributes?.LongName;
  if (longName && !isGuid(longName)) {
    return longName;
  }
  
  const typeLabel = IFC_TYPE_LABELS[metaObject.type] || metaObject.type?.replace('Ifc', '') || 'Objekt';
  
  if (siblingIndex !== undefined && siblingIndex > 0) {
    return `${typeLabel} ${siblingIndex}`;
  }
  
  return typeLabel;
};

// Get icon for IFC type
const getTypeIcon = (type: string) => {
  const typeLower = type?.toLowerCase() || '';
  if (typeLower.includes('site') || typeLower.includes('project')) {
    return <Building2 className="h-3.5 w-3.5 text-emerald-500" />;
  }
  if (typeLower.includes('building') && !typeLower.includes('storey')) {
    return <Building2 className="h-3.5 w-3.5 text-blue-500" />;
  }
  if (typeLower.includes('storey') || typeLower.includes('floor')) {
    return <Layers className="h-3.5 w-3.5 text-amber-500" />;
  }
  if (typeLower.includes('space') || typeLower.includes('room')) {
    return <DoorOpen className="h-3.5 w-3.5 text-green-500" />;
  }
  if (typeLower.includes('wall') || typeLower.includes('slab') || typeLower.includes('roof')) {
    return <Box className="h-3.5 w-3.5 text-gray-500" />;
  }
  return <Package className="h-3.5 w-3.5 text-purple-500" />;
};

// Get short type label
const getTypeLabel = (type: string) => {
  if (!type) return '';
  return IFC_TYPE_LABELS[type] || type.replace(/^Ifc/, '');
};

// Count all descendants recursively
const countDescendants = (node: TreeNode): number => {
  if (!node.children || node.children.length === 0) return 0;
  return node.children.reduce((sum, child) => {
    return sum + 1 + countDescendants(child);
  }, 0);
};

// Memoized recursive child search for performance
const hasMatchingDescendant = (node: TreeNode, query: string): boolean => {
  if (!node.children) return false;
  return node.children.some(child => {
    const childMatches = child.name.toLowerCase().includes(query) ||
      child.type.toLowerCase().includes(query);
    return childMatches || hasMatchingDescendant(child, query);
  });
};

// Memoized TreeNode component to prevent unnecessary re-renders
const TreeNodeComponent = React.memo<{
  node: TreeNode;
  level: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (node: TreeNode) => void;
  onHover: (nodeId: string | null) => void;
  onVisibilityChange?: (node: TreeNode, visible: boolean) => void;
  searchQuery: string;
  showVisibilityCheckboxes: boolean;
}>(({ node, level, selectedId, expandedIds, onToggle, onSelect, onHover, onVisibilityChange, searchQuery, showVisibilityCheckboxes }) => {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const descendantCount = node.objectCount ?? countDescendants(node);
  
  // Memoize search matching
  const { matchesSearch, childrenMatchSearch } = useMemo(() => {
    if (!searchQuery) return { matchesSearch: true, childrenMatchSearch: false };
    const queryLower = searchQuery.toLowerCase();
    const matches = node.name.toLowerCase().includes(queryLower) ||
      node.type.toLowerCase().includes(queryLower);
    const childMatch = hasMatchingDescendant(node, queryLower);
    return { matchesSearch: matches, childrenMatchSearch: childMatch };
  }, [node.name, node.type, node.children, searchQuery]);

  // Early return for filtered nodes
  if (searchQuery && !matchesSearch && !childrenMatchSearch) {
    return null;
  }

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-0.5 sm:gap-1 py-0.5 sm:py-1 px-0.5 sm:px-1 rounded cursor-pointer text-xs sm:text-sm transition-colors",
          "hover:bg-accent/50 active:bg-accent/60",
          isSelected && "bg-accent text-accent-foreground",
          searchQuery && matchesSearch && "bg-yellow-500/20"
        )}
        style={{ paddingLeft: `${level * 10 + 2}px` }}
        onClick={() => onSelect(node)}
        onMouseEnter={() => onHover(node.id)}
        onMouseLeave={() => onHover(null)}
      >
        {/* Visibility checkbox */}
        {showVisibilityCheckboxes && (
          <Checkbox
            checked={node.visible && !node.indeterminate}
            className={cn(
              "h-3.5 w-3.5 sm:h-4 sm:w-4 mr-0.5",
              node.indeterminate && "data-[state=checked]:bg-muted data-[state=checked]:text-muted-foreground"
            )}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(checked) => {
              onVisibilityChange?.(node, !!checked);
            }}
          />
        )}
        
        {/* Expand/collapse button */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onToggle(node.id);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-0.5 hover:bg-muted rounded shrink-0"
          >
            {isExpanded ? (
              <ChevronDown className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            ) : (
              <ChevronRight className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            )}
          </button>
        ) : (
          <span className="w-3 sm:w-4" />
        )}
        
        {/* Type icon */}
        <span className="shrink-0">{getTypeIcon(node.type)}</span>
        
        {/* Name */}
        <span className={cn(
          "truncate flex-1 min-w-0 text-[11px] sm:text-sm",
          !node.visible && "text-muted-foreground line-through"
        )}>
          {node.name}
        </span>
        
        {/* Type badge - hidden on mobile */}
        <Badge variant="outline" className="hidden sm:inline-flex text-[9px] sm:text-[10px] px-1 py-0 h-3.5 sm:h-4 shrink-0">
          {getTypeLabel(node.type)}
        </Badge>

        {/* Descendant count for expandable nodes */}
        {hasChildren && descendantCount > 0 && (
          <Badge variant="secondary" className="text-[9px] sm:text-[10px] px-0.5 sm:px-1 py-0 h-3.5 sm:h-4 shrink-0">
            {descendantCount}
          </Badge>
        )}
      </div>
      
      {/* Children - only render when expanded (lazy rendering) */}
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map(child => (
            <TreeNodeComponent
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              onHover={onHover}
              onVisibilityChange={onVisibilityChange}
              searchQuery={searchQuery}
              showVisibilityCheckboxes={showVisibilityCheckboxes}
            />
          ))}
        </div>
      )}
    </div>
  );
});

TreeNodeComponent.displayName = 'TreeNodeComponent';

// Use forwardRef to fix React warning about refs on function components
const ViewerTreePanel = forwardRef<HTMLDivElement, ViewerTreePanelProps>(({
  viewerRef,
  isVisible,
  onClose,
  onNodeSelect,
  onNodeHover,
  embedded = false,
  showVisibilityCheckboxes = true,
  startFromStoreys = true,
  // Controlled state props
  selectedId: externalSelectedId,
  onSelectedIdChange,
  expandedIds: externalExpandedIds,
  onExpandedIdsChange,
}, ref) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  // Use external state if provided, otherwise use local state
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [internalExpandedIds, setInternalExpandedIds] = useState<Set<string>>(new Set());
  
  // Determine which state to use (controlled vs uncontrolled)
  const selectedId = externalSelectedId !== undefined ? externalSelectedId : internalSelectedId;
  const expandedIds = externalExpandedIds !== undefined ? externalExpandedIds : internalExpandedIds;
  
  const setSelectedId = useCallback((id: string | null) => {
    if (onSelectedIdChange) {
      onSelectedIdChange(id);
    } else {
      setInternalSelectedId(id);
    }
  }, [onSelectedIdChange]);
  
  const setExpandedIds = useCallback((idsOrFn: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    const updateFn = (prev: Set<string>) => {
      const newIds = typeof idsOrFn === 'function' ? idsOrFn(prev) : idsOrFn;
      if (onExpandedIdsChange) {
        onExpandedIdsChange(newIds);
      } else {
        setInternalExpandedIds(newIds);
      }
      return newIds;
    };
    if (typeof idsOrFn === 'function') {
      const currentIds = externalExpandedIds !== undefined ? externalExpandedIds : internalExpandedIds;
      updateFn(currentIds);
    } else {
      updateFn(new Set());
    }
  }, [onExpandedIdsChange, externalExpandedIds, internalExpandedIds]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [buildProgress, setBuildProgress] = useState<{ current: number; total: number } | null>(null);
  const buildAttempts = useRef(0);
  const buildCancelledRef = useRef(false);
  
  // Desktop floating panel state - position, size, drag, resize
  const [position, setPosition] = useState({ x: 12, y: 56 });
  const [size, setSize] = useState({ width: 320, height: 550 });
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });

  // Debounce search for performance
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  }, [position]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    });
  }, [size]);

  // Mouse move/up effects for drag
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, e.clientX - dragOffset.x),
        y: Math.max(0, e.clientY - dragOffset.y),
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

  // Mouse move/up effects for resize
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(280, Math.min(600, resizeStart.width + (e.clientX - resizeStart.x)));
      const newHeight = Math.max(200, Math.min(window.innerHeight - 100, resizeStart.height + (e.clientY - resizeStart.y)));
      setSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => setIsResizing(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeStart]);

  // Get xeokit viewer scene reference
  const getXeokitViewer = useCallback(() => {
    const viewer = viewerRef.current;
    return viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
  }, [viewerRef]);

  // Update visibility state from scene
  const refreshVisibilityState = useCallback(() => {
    const xeokitViewer = getXeokitViewer();
    const scene = xeokitViewer?.scene;
    if (!scene) return;

    setTreeData(prevTree => {
      const updateNodeVisibility = (node: TreeNode): TreeNode => {
        const entity = scene.objects?.[node.id];
        const nodeVisible = entity ? entity.visible : true;
        
        let childrenVisible = true;
        let childrenHidden = true;
        let indeterminate = false;
        
        const updatedChildren = node.children?.map(child => {
          const updated = updateNodeVisibility(child);
          if (updated.visible) childrenHidden = false;
          if (!updated.visible) childrenVisible = false;
          if (updated.indeterminate) indeterminate = true;
          return updated;
        });

        if (node.children && node.children.length > 0) {
          if (!childrenVisible && !childrenHidden) {
            indeterminate = true;
          }
        }

        return {
          ...node,
          visible: nodeVisible,
          indeterminate,
          children: updatedChildren,
        };
      };

      return prevTree.map(updateNodeVisibility);
    });
  }, [getXeokitViewer]);

  // Toggle visibility for a node and all children recursively
  const handleVisibilityChange = useCallback((node: TreeNode, visible: boolean) => {
    const xeokitViewer = getXeokitViewer();
    const scene = xeokitViewer?.scene;
    const metaScene = xeokitViewer?.metaScene;
    if (!scene) return;

    // Recursive function to set visibility on node and ALL descendants
    const setVisibilityRecursive = (n: TreeNode, vis: boolean) => {
      const entity = scene.objects?.[n.id];
      if (entity) {
        entity.visible = vis;
      }
      
      // Process all children recursively
      if (n.children && n.children.length > 0) {
        n.children.forEach(child => {
          setVisibilityRecursive(child, vis);
        });
      }
    };

    // Apply visibility to the node and all its descendants
    setVisibilityRecursive(node, visible);

    // Refresh the tree's visual state to update checkboxes
    refreshVisibilityState();

    // If this is a storey node, dispatch FLOOR_SELECTION_CHANGED_EVENT to sync other selectors
    if (node.type?.toLowerCase() === 'ifcbuildingstorey' && metaScene?.metaObjects) {
      // Collect all currently visible storey nodes
      const allStoreys: { id: string; name: string; fmGuid: string }[] = [];
      Object.values(metaScene.metaObjects).forEach((metaObj: any) => {
        if (metaObj.type?.toLowerCase() === 'ifcbuildingstorey') {
          allStoreys.push({
            id: metaObj.id,
            name: metaObj.name || metaObj.id,
            fmGuid: metaObj.originalSystemId || metaObj.id,
          });
        }
      });

      const visibleStoreys = allStoreys.filter(s => {
        const entity = scene.objects?.[s.id];
        return entity?.visible;
      });

      const isAllVisible = visibleStoreys.length === allStoreys.length;
      const isSolo = visibleStoreys.length === 1;
      const soloFloor = isSolo ? visibleStoreys[0] : null;

      const eventDetail: FloorSelectionEventDetail = {
        floorId: soloFloor?.id || null,
        floorName: soloFloor?.name || null,
        bounds: null, // Could calculate but not critical for sync
        visibleMetaFloorIds: visibleStoreys.map(s => s.id),
        visibleFloorFmGuids: visibleStoreys.map(s => s.fmGuid),
        isAllFloorsVisible: isAllVisible,
      };

      window.dispatchEvent(new CustomEvent(FLOOR_SELECTION_CHANGED_EVENT, { detail: eventDetail }));
    }
  }, [getXeokitViewer, refreshVisibilityState]);

  // Listen for external floor selection changes to refresh checkbox state
  useEffect(() => {
    const handleExternalFloorChange = () => {
      // Delay slightly to allow scene visibility to be applied first
      setTimeout(() => {
        refreshVisibilityState();
      }, 150);
    };
    
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleExternalFloorChange as EventListener);
    return () => {
      window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handleExternalFloorChange as EventListener);
    };
  }, [refreshVisibilityState]);

  // Build tree from xeokit metaScene with CHUNKED processing to prevent UI freeze
  const buildTree = useCallback(() => {
    const viewer = viewerRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const metaScene = xeokitViewer?.metaScene;
    const scene = xeokitViewer?.scene;
    
    if (!metaScene) {
      console.debug('ViewerTreePanel: No metaScene available yet, attempt:', buildAttempts.current);
      
      if (buildAttempts.current < 5) {
        buildAttempts.current++;
        setTimeout(buildTree, 1000);
        return;
      }
      
      setIsLoading(false);
      return;
    }

    // Reset cancellation flag
    buildCancelledRef.current = false;
    
    const sortByStoreyLevel = (a: TreeNode, b: TreeNode): number => {
      const extractLevel = (name: string): number => {
        const match = name.match(/(-?\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      };
      const levelA = extractLevel(a.name);
      const levelB = extractLevel(b.name);
      return levelB - levelA;
    };

    // Phase 1: Collect all meta objects that need processing
    const rootMetaObjects = metaScene.rootMetaObjects || {};
    const storeysToProcess: any[] = [];
    const rootsToProcess: any[] = [];
    
    const findStoreys = (metaObject: any): any[] => {
      const storeys: any[] = [];
      const traverse = (obj: any) => {
        if (obj.type === 'IfcBuildingStorey') {
          storeys.push(obj);
          return;
        }
        obj.children?.forEach(traverse);
      };
      traverse(metaObject);
      return storeys;
    };

    if (startFromStoreys) {
      Object.values(rootMetaObjects).forEach((rootObj: any) => {
        const storeys = findStoreys(rootObj);
        storeysToProcess.push(...storeys);
      });
    } else {
      Object.values(rootMetaObjects).forEach((rootObj: any) => {
        rootsToProcess.push(rootObj);
      });
    }

    const itemsToProcess = startFromStoreys ? storeysToProcess : rootsToProcess;
    const totalItems = itemsToProcess.length;
    
    if (totalItems === 0) {
      setIsLoading(false);
      setBuildProgress(null);
      return;
    }

    setBuildProgress({ current: 0, total: totalItems });

    // Phase 2: Process items in chunks
    const CHUNK_SIZE = 5; // Process 5 root items per chunk (each can have many children)
    let processedCount = 0;
    const tree: TreeNode[] = [];
    const siblingCounters = new Map<string, Map<string, number>>();

    const buildNode = (metaObject: any, parentId: string = 'root', depth: number = 0): TreeNode => {
      if (!siblingCounters.has(parentId)) {
        siblingCounters.set(parentId, new Map());
      }
      const parentCounters = siblingCounters.get(parentId)!;
      
      const typeCount = (parentCounters.get(metaObject.type) || 0) + 1;
      parentCounters.set(metaObject.type, typeCount);

      const entity = scene?.objects?.[metaObject.id];
      const isVisible = entity ? entity.visible : true;

      const node: TreeNode = {
        id: metaObject.id,
        name: getDisplayName(metaObject, typeCount),
        type: metaObject.type || 'Unknown',
        fmGuid: metaObject.propertySetsByName?.Ivion?.fmguid || 
                metaObject.propertySetsByName?.pset_ivion?.fmguid ||
                undefined,
        children: [],
        visible: isVisible,
        indeterminate: false,
      };

      if (metaObject.children && metaObject.children.length > 0) {
        const childNodes = metaObject.children.map((child: any) => 
          buildNode(child, metaObject.id, depth + 1)
        );
        
        if (node.type === 'IfcBuilding') {
          node.children = childNodes.sort(sortByStoreyLevel);
        } else {
          node.children = childNodes.sort((a: TreeNode, b: TreeNode) => 
            a.name.localeCompare(b.name, 'sv', { numeric: true })
          );
        }

        const allVisible = node.children.every(c => c.visible && !c.indeterminate);
        const allHidden = node.children.every(c => !c.visible);
        if (!allVisible && !allHidden) {
          node.indeterminate = true;
        }
      }

      node.objectCount = countDescendants(node);
      return node;
    };

    const processChunk = () => {
      // Check if build was cancelled
      if (buildCancelledRef.current) {
        setIsLoading(false);
        setBuildProgress(null);
        return;
      }

      const endIndex = Math.min(processedCount + CHUNK_SIZE, totalItems);
      
      // Process this chunk
      for (let i = processedCount; i < endIndex; i++) {
        const item = itemsToProcess[i];
        const node = buildNode(item);
        tree.push(node);
      }
      
      processedCount = endIndex;
      setBuildProgress({ current: processedCount, total: totalItems });

      if (processedCount < totalItems) {
        // Schedule next chunk using requestIdleCallback if available
        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(processChunk, { timeout: 100 });
        } else {
          setTimeout(processChunk, 0);
        }
      } else {
        // All done - finalize tree
        if (startFromStoreys) {
          tree.sort(sortByStoreyLevel);
        } else {
          tree.sort((a, b) => a.name.localeCompare(b.name, 'sv', { numeric: true }));
        }

        setTreeData(tree);
        
        // All nodes collapsed by default - no auto-expand
        setExpandedIds(new Set<string>());
        
        const totalCount = tree.reduce((sum, node) => sum + 1 + (node.objectCount || 0), 0);
        console.log('ViewerTreePanel: Built tree with', tree.length, 'root nodes,', totalCount, 'total objects');
        
        setIsLoading(false);
        setBuildProgress(null);
      }
    };

    // Start processing
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(processChunk, { timeout: 100 });
    } else {
      setTimeout(processChunk, 0);
    }
  }, [viewerRef, startFromStoreys]);

  // Build tree when panel becomes visible
  useEffect(() => {
    if (isVisible) {
      setIsLoading(true);
      buildAttempts.current = 0;
      buildCancelledRef.current = false;
      const timer = setTimeout(buildTree, 500);
      return () => {
        clearTimeout(timer);
        buildCancelledRef.current = true;
      };
    }
  }, [isVisible, buildTree]);

  // Listen for preload event to build tree in background
  useEffect(() => {
    const handlePreload = () => {
      if (treeData.length === 0 && !isLoading) {
        console.log('ViewerTreePanel: Preloading tree in background');
        buildAttempts.current = 0;
        buildCancelledRef.current = false;
        buildTree();
      }
    };
    window.addEventListener('PRELOAD_VIEWER_TREE', handlePreload);
    return () => window.removeEventListener('PRELOAD_VIEWER_TREE', handlePreload);
  }, [buildTree, treeData.length, isLoading]);

  // Handle node toggle
  const handleToggle = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Handle node selection - select in scene and fly to
  const handleSelect = useCallback((node: TreeNode) => {
    const viewer = viewerRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    
    if (!scene) return;

    setSelectedId(node.id);

    try {
      scene.setObjectsSelected(scene.selectedObjectIds, false);
      
      const entity = scene.objects[node.id];
      if (entity) {
        entity.selected = true;
        
        xeokitViewer.cameraFlight.flyTo({
          aabb: entity.aabb,
          duration: 0.5,
        });
      }
      
      onNodeSelect?.(node.id, node.fmGuid);
    } catch (e) {
      console.debug('ViewerTreePanel: Error selecting node:', e);
    }
  }, [viewerRef, onNodeSelect]);

  // Handle hover - highlight in scene
  const handleHover = useCallback((nodeId: string | null) => {
    const viewer = viewerRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const scene = xeokitViewer?.scene;
    
    if (!scene) return;

    try {
      scene.setObjectsHighlighted(scene.highlightedObjectIds, false);
      
      if (nodeId) {
        const entity = scene.objects[nodeId];
        if (entity) {
          entity.highlighted = true;
        }
      }
      
      onNodeHover?.(nodeId);
    } catch (e) {
      console.debug('ViewerTreePanel: Error highlighting node:', e);
    }
  }, [viewerRef, onNodeHover]);

  // Handle visibility all - show/hide all objects AND sync tree checkboxes
  const handleVisibilityAll = useCallback((visible: boolean) => {
    const xeokitViewer = getXeokitViewer();
    const scene = xeokitViewer?.scene;
    if (!scene) return;

    try {
      scene.setObjectsVisible(scene.objectIds, visible);
      
      // Sync tree state with visibility change
      setTreeData(prevTree => {
        const updateAllNodes = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map(node => ({
            ...node,
            visible: visible,
            indeterminate: false,
            children: node.children ? updateAllNodes(node.children) : undefined,
          }));
        };
        return updateAllNodes(prevTree);
      });
    } catch (e) {
      console.debug('ViewerTreePanel: Error toggling all visibility:', e);
    }
  }, [getXeokitViewer]);

  // Handle expand all - use requestIdleCallback for performance
  const handleExpandAll = useCallback(() => {
    const doExpand = () => {
      const allIds = new Set<string>();
      const collectIds = (nodes: TreeNode[]) => {
        nodes.forEach(node => {
          allIds.add(node.id);
          if (node.children) collectIds(node.children);
        });
      };
      collectIds(treeData);
      setExpandedIds(allIds);
    };
    
    // Use requestIdleCallback to prevent UI blocking on large trees
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(doExpand, { timeout: 500 });
    } else {
      setTimeout(doExpand, 0);
    }
  }, [treeData, setExpandedIds]);

  // Handle collapse all
  const handleCollapseAll = useCallback(() => {
    setExpandedIds(new Set());
  }, [setExpandedIds]);

  // Count total nodes
  const nodeCount = useMemo(() => {
    const countNodes = (nodes: TreeNode[]): number => {
      return nodes.reduce((sum, node) => {
        return sum + 1 + (node.children ? countNodes(node.children) : 0);
      }, 0);
    };
    return countNodes(treeData);
  }, [treeData]);

  if (!isVisible) return null;

  // Loading indicator with progress
  const LoadingIndicator = () => (
    <div className="flex flex-col items-center justify-center py-6 sm:py-8 text-muted-foreground text-xs sm:text-sm gap-2">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span>Laddar modellträd...</span>
      {buildProgress && (
        <span className="text-[10px] sm:text-xs">
          {buildProgress.current} / {buildProgress.total} våningar
        </span>
      )}
    </div>
  );

  // Action buttons row component
  const ActionButtons = () => (
    <div className="flex items-center gap-1 px-1.5 sm:px-2 py-1.5 border-b">
      <Button 
        variant="outline" 
        size="sm" 
        className="h-6 text-[10px] sm:text-xs flex-1 px-1.5"
        onClick={() => handleVisibilityAll(true)}
        disabled={isLoading || treeData.length === 0}
        title="Show all objects"
      >
        <Check className="h-3 w-3 mr-0.5" /> All
      </Button>
      <Button 
        variant="outline" 
        size="sm" 
        className="h-6 text-[10px] sm:text-xs flex-1 px-1.5"
        onClick={() => handleVisibilityAll(false)}
        disabled={isLoading || treeData.length === 0}
        title="Hide all objects"
      >
        <Minus className="h-3 w-3 mr-0.5" /> None
      </Button>
      <Button 
        variant="outline" 
        size="sm" 
        className="h-6 text-[10px] sm:text-xs px-1.5"
        onClick={handleExpandAll}
        disabled={isLoading || treeData.length === 0}
        title="Expand all"
      >
        <ChevronDown className="h-3 w-3" />
      </Button>
      <Button 
        variant="outline" 
        size="sm" 
        className="h-6 text-[10px] sm:text-xs px-1.5"
        onClick={handleCollapseAll}
        disabled={isLoading || treeData.length === 0}
        title="Collapse all"
      >
        <ChevronUp className="h-3 w-3" />
      </Button>
    </div>
  );

  // Embedded mode: render without positioning, header, border
  if (embedded) {
    return (
      <div ref={ref} className="flex flex-col h-full max-h-[80vh]">
        {/* Action buttons */}
        <ActionButtons />
        
        {/* Search */}
        <div className="p-1.5 sm:p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Sök..."
              className="h-6 sm:h-7 pl-6 sm:pl-7 text-[11px] sm:text-xs"
            />
          </div>
        </div>

        {/* Tree content */}
        <ScrollArea className="flex-1">
          <div className="p-0.5 sm:p-1">
            {isLoading ? (
              <LoadingIndicator />
            ) : treeData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-3 sm:py-4 text-muted-foreground text-[10px] sm:text-xs gap-1">
                <TreeDeciduous className="h-5 w-5 sm:h-6 sm:w-6 opacity-50" />
                <span>Inget modellträd</span>
              </div>
            ) : (
              treeData.map(node => (
                <TreeNodeComponent
                  key={node.id}
                  node={node}
                  level={0}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  onToggle={handleToggle}
                  onSelect={handleSelect}
                  onHover={handleHover}
                  onVisibilityChange={handleVisibilityChange}
                  searchQuery={debouncedSearch}
                  showVisibilityCheckboxes={showVisibilityCheckboxes}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }

  // Standard floating panel mode - now draggable and resizable on desktop
  return (
    <div 
      ref={ref}
      className={cn(
        "fixed z-50",
        "bg-card/90 backdrop-blur-md border rounded-lg shadow-xl",
        "flex flex-col animate-slide-in-right",
        isDragging && "cursor-grabbing select-none"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      {/* Draggable Header */}
      <div 
        className="flex items-center justify-between p-2 sm:p-3 border-b cursor-grab active:cursor-grabbing"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-1.5 sm:gap-2">
          <GripVertical className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          <TreeDeciduous className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
          <span className="font-medium text-xs sm:text-sm">Modellträd</span>
          <Badge variant="secondary" className="text-[10px] sm:text-xs">{nodeCount.toLocaleString('sv-SE')}</Badge>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-5 w-5 sm:h-6 sm:w-6" 
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
        </Button>
      </div>
      
      {/* Action buttons */}
      <ActionButtons />

      {/* Search */}
      <div className="p-1.5 sm:p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 sm:h-3.5 sm:w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Sök..."
            className="h-7 sm:h-8 pl-6 sm:pl-7 text-xs sm:text-sm"
          />
        </div>
      </div>

      {/* Tree content */}
      <ScrollArea className="flex-1 p-1 sm:p-2">
        {isLoading ? (
          <LoadingIndicator />
        ) : treeData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 sm:py-8 text-muted-foreground text-xs sm:text-sm gap-1.5 sm:gap-2">
            <TreeDeciduous className="h-6 w-6 sm:h-8 sm:w-8 opacity-50" />
            <span>Inget modellträd</span>
            <span className="text-[10px] sm:text-xs">Modellen laddas...</span>
          </div>
        ) : (
          treeData.map(node => (
            <TreeNodeComponent
              key={node.id}
              node={node}
              level={0}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={handleToggle}
              onSelect={handleSelect}
              onHover={handleHover}
              onVisibilityChange={handleVisibilityChange}
              searchQuery={debouncedSearch}
              showVisibilityCheckboxes={showVisibilityCheckboxes}
            />
          ))
        )}
      </ScrollArea>
      
      {/* Resize handle - SE corner (desktop only) */}
      <div
        className="hidden sm:block absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
        onMouseDown={handleResizeStart}
      >
        <svg className="w-3 h-3 absolute bottom-1 right-1 text-muted-foreground" viewBox="0 0 10 10">
          <path d="M0 10 L10 0 M4 10 L10 4 M7 10 L10 7" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </div>
    </div>
  );
});

ViewerTreePanel.displayName = 'ViewerTreePanel';

export default ViewerTreePanel;
