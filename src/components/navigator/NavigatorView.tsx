import React, { useContext, useMemo, useState, useCallback, useEffect } from "react";
import { AppContext } from "@/context/AppContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type NavigatorNode } from "@/components/navigator/TreeNode";
import { VirtualTree } from "@/components/navigator/VirtualTree";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { X, List, Network, Eye, Box, Square, ClipboardList, Plus, RefreshCw, Wrench } from "lucide-react";
import { useSearchResults, SearchResult } from "@/hooks/useSearchResults";
import { SearchResultsList } from "@/components/common/SearchResultsList";
import { useXktPreload } from "@/hooks/useXktPreload";
import CreateWorkOrderDialog from "@/components/viewer/CreateWorkOrderDialog";

function filterTree(nodes: NavigatorNode[], q: string): NavigatorNode[] {
  if (!q.trim()) return nodes;
  const query = q.trim().toLowerCase();

  const matches = (n: NavigatorNode) =>
    (n.commonName || n.name || "").toLowerCase().includes(query);

  const walk = (n: NavigatorNode): NavigatorNode | null => {
    const children = (n.children || []).map(walk).filter(Boolean) as NavigatorNode[];
    if (matches(n) || children.length) return { ...n, children };
    return null;
  };

  return nodes.map(walk).filter(Boolean) as NavigatorNode[];
}

// Find all ancestor fmGuids for a set of target fmGuids
function findAncestorGuids(tree: NavigatorNode[], targetGuids: Set<string>): Set<string> {
  const ancestors = new Set<string>();
  
  const walk = (node: NavigatorNode, path: string[]): boolean => {
    const isTarget = targetGuids.has(node.fmGuid);
    let hasTargetDescendant = isTarget;
    
    if (node.children) {
      for (const child of node.children) {
        if (walk(child, [...path, node.fmGuid])) {
          hasTargetDescendant = true;
        }
      }
    }
    
    if (hasTargetDescendant && !isTarget) {
      ancestors.add(node.fmGuid);
    }
    
    if (hasTargetDescendant) {
      path.forEach(guid => ancestors.add(guid));
    }
    
    return hasTargetDescendant;
  };
  
  tree.forEach(node => walk(node, []));
  return ancestors;
}

export default function NavigatorView() {
  const { 
    navigatorTreeData, 
    isLoadingData, 
    setActiveApp, 
    setViewer3dFmGuid, 
    setSelectedFacility, 
    refreshInitialData,
    aiSelectedFmGuids,
    clearAiSelection,
    startAssetRegistration,
    startInventory,
    allData,
  } = useContext(AppContext);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [viewMode, setViewModeLocal] = useState<'tree' | 'list'>('tree');

  // Selected node for context toolbar
  const [selectedNode, setSelectedNode] = useState<NavigatorNode | null>(null);

  // Search results for list view
  const searchResults = useSearchResults(navigatorTreeData, query, 50);

  // Auto-expand tree when AI selection changes
  useEffect(() => {
    if (aiSelectedFmGuids.length > 0 && navigatorTreeData.length > 0) {
      const targetSet = new Set(aiSelectedFmGuids);
      const ancestorGuids = findAncestorGuids(navigatorTreeData, targetSet);
      
      setExpanded(prev => {
        const next = new Set(prev);
        ancestorGuids.forEach(guid => next.add(guid));
        return next;
      });
    }
  }, [aiSelectedFmGuids, navigatorTreeData]);

  const visibleTree = useMemo(() => filterTree(navigatorTreeData, query), [navigatorTreeData, query]);

  // Track last expanded building for preloading
  const [lastExpandedBuilding, setLastExpandedBuilding] = useState<string | null>(null);
  
  // Work order dialog state
  const [woDialogOpen, setWoDialogOpen] = useState(false);
  const [woContext, setWoContext] = useState<{
    buildingName?: string;
    buildingFmGuid?: string;
    levelName?: string;
    levelFmGuid?: string;
    roomName?: string;
    roomFmGuid?: string;
    assetName?: string;
    assetFmGuid?: string;
  }>({});
  
  // Preload XKT models when a building is expanded
  useXktPreload(lastExpandedBuilding);

  const onToggle = useCallback((fmGuid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      const isExpanding = !next.has(fmGuid);
      
      if (isExpanding) {
        next.add(fmGuid);
        
        const node = allData.find((a: any) => a.fmGuid === fmGuid);
        if (node?.category === 'Building') {
          setLastExpandedBuilding(fmGuid);
        }
      } else {
        next.delete(fmGuid);
      }
      
      return next;
    });
  }, [allData]);

  const handleSelect = useCallback((node: NavigatorNode) => {
    setSelectedNode(prev => prev?.fmGuid === node.fmGuid ? null : node);
  }, []);

  const handleAddChild = useCallback((parentNode: NavigatorNode) => {
    let buildingFmGuid = '';
    let storeyFmGuid = '';
    
    if (parentNode.category === 'Space') {
      const assetData = allData.find((a: any) => a.fmGuid === parentNode.fmGuid);
      buildingFmGuid = assetData?.buildingFmGuid || '';
      storeyFmGuid = assetData?.levelFmGuid || '';
    }
    
    if (!buildingFmGuid) {
      buildingFmGuid = parentNode.fmGuid;
    }

    startAssetRegistration({
      parentNode,
      buildingFmGuid,
      storeyFmGuid,
      spaceFmGuid: parentNode.fmGuid,
    });
  }, [allData, startAssetRegistration]);


  const handleView = useCallback((node: NavigatorNode) => {
    if (node.category === 'Building') {
      setSelectedFacility({
        fmGuid: node.fmGuid,
        name: node.name,
        commonName: node.commonName,
        category: node.category,
      });
      setActiveApp('portfolio');
    } else {
      toast.info(`View: ${node.commonName || node.name}`, {
        description: `Category: ${node.category}`,
      });
    }
  }, [setSelectedFacility, setActiveApp]);

  const handleOpen3D = useCallback((node: NavigatorNode) => {
    setViewer3dFmGuid(node.fmGuid);
    setActiveApp('native_viewer');
  }, [setViewer3dFmGuid, setActiveApp]);

  const handleOpen2D = useCallback((node: NavigatorNode) => {
    setViewer3dFmGuid(node.fmGuid);
    setActiveApp('native_viewer');
    toast.info(`Opening 2D view for "${node.commonName || node.name}"`, {
      description: 'Switch to 2D mode in the toolbar',
    });
  }, [setViewer3dFmGuid, setActiveApp]);

  const handleInventory = useCallback((node: NavigatorNode) => {
    const assetData = allData.find((a: any) => a.fmGuid === node.fmGuid);
    
    let prefill = {
      buildingFmGuid: undefined as string | undefined,
      levelFmGuid: undefined as string | undefined,
      roomFmGuid: undefined as string | undefined,
    };

    if (node.category === 'Building') {
      prefill.buildingFmGuid = node.fmGuid;
    } else if (node.category === 'Building Storey') {
      prefill.buildingFmGuid = assetData?.buildingFmGuid || node.buildingFmGuid;
      prefill.levelFmGuid = node.fmGuid;
    } else if (node.category === 'Space') {
      prefill.buildingFmGuid = assetData?.buildingFmGuid || node.buildingFmGuid;
      prefill.levelFmGuid = assetData?.levelFmGuid || node.levelFmGuid;
      prefill.roomFmGuid = node.fmGuid;
    }

    startInventory(prefill);
  }, [allData, startInventory]);

  const handleCreateWorkOrder = useCallback((node: NavigatorNode) => {
    const assetData = allData.find((a: any) => a.fmGuid === node.fmGuid);
    
    const ctx: typeof woContext = {};

    if (node.category === 'Building') {
      ctx.buildingFmGuid = node.fmGuid;
      ctx.buildingName = node.commonName || node.name;
    } else if (node.category === 'Building Storey') {
      ctx.buildingFmGuid = assetData?.buildingFmGuid || node.buildingFmGuid;
      ctx.buildingName = assetData?.buildingName;
      ctx.levelFmGuid = node.fmGuid;
      ctx.levelName = node.commonName || node.name;
    } else if (node.category === 'Space') {
      ctx.buildingFmGuid = assetData?.buildingFmGuid || node.buildingFmGuid;
      ctx.buildingName = assetData?.buildingName;
      ctx.levelFmGuid = assetData?.levelFmGuid || node.levelFmGuid;
      ctx.roomFmGuid = node.fmGuid;
      ctx.roomName = node.commonName || node.name;
    } else if (node.category === 'Instance') {
      ctx.buildingFmGuid = assetData?.buildingFmGuid || node.buildingFmGuid;
      ctx.buildingName = assetData?.buildingName;
      ctx.levelFmGuid = assetData?.levelFmGuid || node.levelFmGuid;
      ctx.roomFmGuid = assetData?.inRoomFmGuid;
      ctx.assetFmGuid = node.fmGuid;
      ctx.assetName = node.commonName || node.name;
    }

    setWoContext(ctx);
    setWoDialogOpen(true);
  }, [allData]);

  const handleSearchResultSelect = useCallback((result: SearchResult) => {
    if (result.category === 'Building') {
      setSelectedFacility({
        fmGuid: result.fmGuid,
        name: result.name,
        commonName: result.name,
        category: result.category,
      });
      setActiveApp('portfolio');
    } else {
      setViewer3dFmGuid(result.fmGuid);
    }
  }, [setSelectedFacility, setActiveApp, setViewer3dFmGuid]);

  const selectedFmGuidSet = useMemo(() => new Set(aiSelectedFmGuids), [aiSelectedFmGuids]);

  // Context toolbar: determine which actions to show based on selected node
  const canAddChild = selectedNode?.category === 'Space';
  const canOpen2D = selectedNode?.category === 'Building Storey';
  const canInventory = selectedNode && ['Building', 'Building Storey', 'Space'].includes(selectedNode.category || '');
  const canCreateWorkOrder = selectedNode && ['Building', 'Building Storey', 'Space', 'Instance'].includes(selectedNode.category || '');
  const canSyncToAssetPlus = selectedNode?.category === 'Instance' && selectedNode.isLocal === true && selectedNode.inRoomFmGuid;

  return (
    <TooltipProvider>
      <section className="h-full w-full p-2 sm:p-3 md:p-4">
        <header className="mb-2 sm:mb-3 flex items-center justify-between gap-2">
          <h1 className="text-base sm:text-lg font-semibold text-foreground truncate">Navigator</h1>
          {aiSelectedFmGuids.length > 0 && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={clearAiSelection}
              className="gap-1 sm:gap-1.5 text-[10px] sm:text-xs shrink-0 h-7 sm:h-8 px-2 sm:px-3"
            >
              <X className="h-3 w-3" />
              <span className="hidden xs:inline">Clear</span> {aiSelectedFmGuids.length}
            </Button>
          )}
        </header>

        <div className="mb-2 sm:mb-3 flex items-center gap-1.5 sm:gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            className="flex-1 h-8 sm:h-9 text-sm"
          />
          <div className="flex gap-0.5 sm:gap-1 shrink-0">
            <Button
              variant={viewMode === 'tree' ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8 sm:h-9 sm:w-9"
              onClick={() => setViewModeLocal('tree')}
              title="Tree view"
            >
              <Network className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8 sm:h-9 sm:w-9"
              onClick={() => setViewModeLocal('list')}
              title="List view"
            >
              <List className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </Button>
          </div>
        </div>

        {/* Context toolbar - shown when a node is selected */}
        {selectedNode && (
          <div className="mb-2 flex items-center gap-1 px-1 py-1 rounded-md bg-muted/50 border border-border">
            <span className="text-[10px] sm:text-xs text-muted-foreground truncate max-w-[120px] px-1">
              {selectedNode.commonName || selectedNode.name}
            </span>
            <div className="flex items-center gap-0.5 ml-auto shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => handleOpen3D(selectedNode)}
                title="3D"
              >
                <Box className="h-3 w-3 text-primary" />
              </Button>
              {canOpen2D && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleOpen2D(selectedNode)}
                  title="2D"
                >
                  <Square className="h-3 w-3 text-accent-foreground" />
                </Button>
              )}
              {selectedNode.category === 'Building' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleView(selectedNode)}
                  title="Details"
                >
                  <Eye className="h-3 w-3 text-muted-foreground" />
                </Button>
              )}
              {canInventory && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleInventory(selectedNode)}
                  title="Inventory"
                >
                  <ClipboardList className="h-3 w-3 text-orange-500" />
                </Button>
              )}
              {canCreateWorkOrder && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleCreateWorkOrder(selectedNode)}
                  title="Work Order"
                >
                  <Wrench className="h-3 w-3 text-amber-600" />
                </Button>
              )}
              {canAddChild && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleAddChild(selectedNode)}
                  title="Add"
                >
                  <Plus className="h-3 w-3 text-muted-foreground" />
                </Button>
              )}
              {canSyncToAssetPlus && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    toast.info('Sync to Asset+ triggered');
                  }}
                  title="Sync to Asset+"
                >
                  <RefreshCw className="h-3 w-3 text-blue-500" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setSelectedNode(null)}
                title="Deselect"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </Button>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-1.5 sm:p-2 overflow-hidden">
          {isLoadingData ? (
            <div className="p-2 sm:p-3 text-xs sm:text-sm text-muted-foreground">Loading data...</div>
          ) : viewMode === 'list' && query.trim().length >= 2 ? (
            <SearchResultsList
              results={searchResults}
              onSelect={handleSearchResultSelect}
              emptyMessage="No results for your search"
            />
          ) : (
            <div className="h-[calc(100vh-200px)]">
              <VirtualTree
                nodes={visibleTree}
                expanded={expanded}
                selectedFmGuids={selectedFmGuidSet}
                selectedNodeFmGuid={selectedNode?.fmGuid || null}
                scrollToFmGuid={aiSelectedFmGuids[0] || null}
                onToggle={onToggle}
                onSelect={handleSelect}
              />
            </div>
          )}
        </div>
      </section>
      
      <CreateWorkOrderDialog
        open={woDialogOpen}
        onClose={() => setWoDialogOpen(false)}
        buildingName={woContext.buildingName}
        buildingFmGuid={woContext.buildingFmGuid}
        levelName={woContext.levelName}
        levelFmGuid={woContext.levelFmGuid}
        roomName={woContext.roomName}
        roomFmGuid={woContext.roomFmGuid}
        assetName={woContext.assetName}
        assetFmGuid={woContext.assetFmGuid}
      />
    </TooltipProvider>
  );
}
