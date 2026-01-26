import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronRight, ChevronDown, X, Search, TreeDeciduous, Layers, Building2, DoorOpen, Box, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TreeNode {
  id: string;
  name: string;
  type: string;
  children?: TreeNode[];
  parent?: TreeNode;
  fmGuid?: string;
  objectCount?: number;
}

interface ViewerTreePanelProps {
  viewerRef: React.RefObject<any>;
  isVisible: boolean;
  onClose: () => void;
  onNodeSelect?: (nodeId: string, fmGuid?: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
}

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
  // Remove 'Ifc' prefix
  return type.replace(/^Ifc/, '');
};

// Count all descendants recursively
const countDescendants = (node: TreeNode): number => {
  if (!node.children || node.children.length === 0) return 0;
  return node.children.reduce((sum, child) => {
    return sum + 1 + countDescendants(child);
  }, 0);
};

const TreeNodeComponent: React.FC<{
  node: TreeNode;
  level: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (node: TreeNode) => void;
  onHover: (nodeId: string | null) => void;
  searchQuery: string;
}> = ({ node, level, selectedId, expandedIds, onToggle, onSelect, onHover, searchQuery }) => {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const descendantCount = node.objectCount ?? countDescendants(node);
  
  // Check if this node or its children match the search
  const matchesSearch = searchQuery 
    ? node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.type.toLowerCase().includes(searchQuery.toLowerCase())
    : true;
  
  // Recursive check for matching children
  const hasMatchingChildren = useCallback((n: TreeNode): boolean => {
    if (!n.children) return false;
    return n.children.some(child => {
      const childMatches = child.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        child.type.toLowerCase().includes(searchQuery.toLowerCase());
      return childMatches || hasMatchingChildren(child);
    });
  }, [searchQuery]);

  const childrenMatchSearch = searchQuery ? hasMatchingChildren(node) : false;

  if (searchQuery && !matchesSearch && !childrenMatchSearch) {
    return null;
  }

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-1 rounded cursor-pointer text-sm transition-colors",
          "hover:bg-accent/50",
          isSelected && "bg-accent text-accent-foreground",
          searchQuery && matchesSearch && "bg-yellow-500/20"
        )}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={() => onSelect(node)}
        onMouseEnter={() => onHover(node.id)}
        onMouseLeave={() => onHover(null)}
      >
        {/* Expand/collapse button */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="p-0.5 hover:bg-muted rounded"
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-4" />
        )}
        
        {/* Type icon */}
        {getTypeIcon(node.type)}
        
        {/* Name */}
        <span className="truncate flex-1 min-w-0">{node.name}</span>
        
        {/* Type badge */}
        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 shrink-0">
          {getTypeLabel(node.type)}
        </Badge>

        {/* Descendant count for expandable nodes */}
        {hasChildren && descendantCount > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 shrink-0">
            {descendantCount}
          </Badge>
        )}
      </div>
      
      {/* Children */}
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
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ViewerTreePanel: React.FC<ViewerTreePanelProps> = ({
  viewerRef,
  isVisible,
  onClose,
  onNodeSelect,
  onNodeHover,
}) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const buildAttempts = useRef(0);

  // Build tree from xeokit metaScene using storeys hierarchy (like xeokit TreeViewPlugin)
  const buildTree = useCallback(() => {
    const viewer = viewerRef.current;
    const xeokitViewer = viewer?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    const metaScene = xeokitViewer?.metaScene;
    
    if (!metaScene) {
      console.debug('ViewerTreePanel: No metaScene available yet, attempt:', buildAttempts.current);
      
      // Retry a few times as scene might still be loading
      if (buildAttempts.current < 5) {
        buildAttempts.current++;
        setTimeout(buildTree, 1000);
        return;
      }
      
      setIsLoading(false);
      return;
    }

    try {
      const rootMetaObjects = metaScene.rootMetaObjects || {};
      const tree: TreeNode[] = [];

      // Sort function for IFC storeys (floor names)
      const sortByStoreyLevel = (a: TreeNode, b: TreeNode): number => {
        // Extract floor number from name like "Floor 1", "Våning 2", "Level -1", etc.
        const extractLevel = (name: string): number => {
          const match = name.match(/(-?\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        };
        
        const levelA = extractLevel(a.name);
        const levelB = extractLevel(b.name);
        
        // Sort descending (higher floors first)
        return levelB - levelA;
      };

      // Recursive function to build tree with proper structure
      const buildNode = (metaObject: any, depth: number = 0): TreeNode => {
        const node: TreeNode = {
          id: metaObject.id,
          name: metaObject.name || metaObject.id,
          type: metaObject.type || 'Unknown',
          fmGuid: metaObject.propertySetsByName?.Ivion?.fmguid || 
                  metaObject.propertySetsByName?.pset_ivion?.fmguid ||
                  undefined,
          children: [],
        };

        if (metaObject.children && metaObject.children.length > 0) {
          // Build children
          const childNodes = metaObject.children.map((child: any) => buildNode(child, depth + 1));
          
          // Sort storeys by level, other children alphabetically
          if (node.type === 'IfcBuilding') {
            // Sort storeys by floor level (descending)
            node.children = childNodes.sort(sortByStoreyLevel);
          } else {
            // Sort other nodes alphabetically
            node.children = childNodes.sort((a: TreeNode, b: TreeNode) => 
              a.name.localeCompare(b.name, 'sv', { numeric: true })
            );
          }
        }

        // Cache object count for display
        node.objectCount = countDescendants(node);

        return node;
      };

      // Process all root objects
      Object.values(rootMetaObjects).forEach((rootObj: any) => {
        const node = buildNode(rootObj);
        tree.push(node);
      });

      // Sort root level by name
      tree.sort((a, b) => a.name.localeCompare(b.name, 'sv', { numeric: true }));

      setTreeData(tree);
      
      // Auto-expand first few levels for better UX (like xeokit autoExpandDepth: 2)
      const autoExpandIds = new Set<string>();
      const expandToDepth = (nodes: TreeNode[], depth: number, maxDepth: number) => {
        if (depth >= maxDepth) return;
        nodes.forEach(node => {
          autoExpandIds.add(node.id);
          if (node.children) {
            expandToDepth(node.children, depth + 1, maxDepth);
          }
        });
      };
      expandToDepth(tree, 0, 2); // Expand 2 levels deep
      setExpandedIds(autoExpandIds);
      
      // Count total objects for display
      const totalCount = tree.reduce((sum, node) => sum + 1 + (node.objectCount || 0), 0);
      console.log('ViewerTreePanel: Built tree with', tree.length, 'root nodes,', totalCount, 'total objects');
    } catch (e) {
      console.error('ViewerTreePanel: Error building tree:', e);
    } finally {
      setIsLoading(false);
    }
  }, [viewerRef]);

  // Build tree when panel becomes visible
  useEffect(() => {
    if (isVisible) {
      setIsLoading(true);
      buildAttempts.current = 0;
      // Wait a bit for the scene to be fully loaded
      const timer = setTimeout(buildTree, 500);
      return () => clearTimeout(timer);
    }
  }, [isVisible, buildTree]);

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
      // Clear previous selection
      scene.setObjectsSelected(scene.selectedObjectIds, false);
      
      // Select new object
      const entity = scene.objects[node.id];
      if (entity) {
        entity.selected = true;
        
        // Fly to the selected object
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
      // Clear previous highlight
      scene.setObjectsHighlighted(scene.highlightedObjectIds, false);
      
      // Highlight new object
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

  return (
    <div 
      className={cn(
        "absolute top-14 left-3 z-40 w-80 max-h-[calc(100%-120px)]",
        "bg-card/95 backdrop-blur-md border rounded-lg shadow-xl",
        "flex flex-col animate-slide-in-right"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <TreeDeciduous className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">Modellträd</span>
          <Badge variant="secondary" className="text-xs">{nodeCount.toLocaleString('sv-SE')}</Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Search */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Sök objekt..."
            className="h-8 pl-7 text-sm"
          />
        </div>
      </div>

      {/* Tree content */}
      <ScrollArea className="flex-1 p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            Laddar modellträd...
          </div>
        ) : treeData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
            <TreeDeciduous className="h-8 w-8 opacity-50" />
            <span>Inget modellträd tillgängligt</span>
            <span className="text-xs">Modellen kanske fortfarande laddas</span>
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
              searchQuery={searchQuery}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );
};

export default ViewerTreePanel;
