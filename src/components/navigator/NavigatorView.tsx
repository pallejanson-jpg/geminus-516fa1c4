import React, { useContext, useMemo, useState, useCallback, useEffect } from "react";
import { AppContext } from "@/context/AppContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TreeNode, type NavigatorNode } from "@/components/navigator/TreeNode";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { X, List, Network } from "lucide-react";
import { useSearchResults, SearchResult } from "@/hooks/useSearchResults";
import { SearchResultsList } from "@/components/common/SearchResultsList";

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
      // This node is an ancestor of a target
      ancestors.add(node.fmGuid);
    }
    
    if (hasTargetDescendant) {
      // Add all ancestors in the path
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
    allData,
  } = useContext(AppContext);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [viewMode, setViewModeLocal] = useState<'tree' | 'list'>('tree');

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

  const onToggle = (fmGuid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fmGuid)) next.delete(fmGuid);
      else next.add(fmGuid);
      return next;
    });
  };

  const handleAddChild = useCallback((parentNode: NavigatorNode) => {
    // Find building fmGuid for the parent node
    let buildingFmGuid = '';
    let storeyFmGuid = '';
    
    if (parentNode.category === 'Space') {
      // Find building from the parent's buildingFmGuid attribute
      const assetData = allData.find((a: any) => a.fmGuid === parentNode.fmGuid);
      buildingFmGuid = assetData?.buildingFmGuid || '';
      storeyFmGuid = assetData?.levelFmGuid || '';
    }
    
    if (!buildingFmGuid) {
      // Fallback: use the space's fmGuid as building
      buildingFmGuid = parentNode.fmGuid;
    }

    // Start the 3D-assisted registration flow
    startAssetRegistration({
      parentNode,
      buildingFmGuid,
      storeyFmGuid,
      spaceFmGuid: parentNode.fmGuid,
    });
  }, [allData, startAssetRegistration]);


  const handleView = useCallback((node: NavigatorNode) => {
    // Navigate to Portfolio view for buildings
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
    // Set the FMGUID and navigate to 3D viewer
    setViewer3dFmGuid(node.fmGuid);
    setActiveApp('assetplus_viewer');
  }, [setViewer3dFmGuid, setActiveApp]);

  const handleOpen2D = useCallback((node: NavigatorNode) => {
    // Set the FMGUID and navigate to 3D viewer (will start in 2D mode for floors)
    // Store a flag to indicate 2D mode should be activated
    setViewer3dFmGuid(node.fmGuid);
    setActiveApp('assetplus_viewer');
    toast.info(`Öppnar 2D-vy för "${node.commonName || node.name}"`, {
      description: 'Växla till 2D-läge i verktygsfältet',
    });
  }, [setViewer3dFmGuid, setActiveApp]);

  const handleSearchResultSelect = useCallback((result: SearchResult) => {
    // Navigate based on category
    if (result.category === 'Building') {
      setSelectedFacility({
        fmGuid: result.fmGuid,
        name: result.name,
        commonName: result.name,
        category: result.category,
      });
      setActiveApp('portfolio');
    } else {
      // For non-buildings, open 3D viewer
      setViewer3dFmGuid(result.fmGuid);
    }
  }, [setSelectedFacility, setActiveApp, setViewer3dFmGuid]);

  const selectedFmGuidSet = useMemo(() => new Set(aiSelectedFmGuids), [aiSelectedFmGuids]);

  return (
    <TooltipProvider>
      <section className="h-full w-full p-2 sm:p-4">
        <header className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-foreground">Navigator</h1>
          {aiSelectedFmGuids.length > 0 && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={clearAiSelection}
              className="gap-1.5 text-xs"
            >
              <X className="h-3 w-3" />
              Clear {aiSelectedFmGuids.length} selected
            </Button>
          )}
        </header>

        <div className="mb-3 flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök i navigator..."
            className="flex-1"
          />
          <div className="flex gap-1">
            <Button
              variant={viewMode === 'tree' ? 'default' : 'ghost'}
              size="icon"
              className="h-9 w-9"
              onClick={() => setViewModeLocal('tree')}
              title="Trädvy"
            >
              <Network className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              className="h-9 w-9"
              onClick={() => setViewModeLocal('list')}
              title="Listvy"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-2">
          {isLoadingData ? (
            <div className="p-3 text-sm text-muted-foreground">Laddar data...</div>
          ) : viewMode === 'list' && query.trim().length >= 2 ? (
            // List view with search results
            <SearchResultsList
              results={searchResults}
              onSelect={handleSearchResultSelect}
              emptyMessage="Inga resultat för din sökning"
            />
          ) : visibleTree.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              Inga objekt att visa (kontrollera Asset+ anslutning eller filter).
            </div>
          ) : (
            <div className="space-y-0.5">
              {visibleTree.map((node) => (
                <TreeNode
                  key={node.fmGuid}
                  node={node}
                  expanded={expanded}
                  onToggle={onToggle}
                  onAddChild={handleAddChild}
                  onView={handleView}
                  onOpen3D={handleOpen3D}
                  onOpen2D={handleOpen2D}
                  selectedFmGuids={selectedFmGuidSet}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}
