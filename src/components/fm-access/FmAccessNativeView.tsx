import React, { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { AppContext } from '@/context/AppContext';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { TreePine, Search, FileText, Loader2, Building2 } from 'lucide-react';
import { useFmAccessApi, FmAccessNode } from '@/hooks/useFmAccessApi';
import { useIsMobile } from '@/hooks/use-mobile';
import FmAccessTree from './FmAccessTree';
import FmAccessObjectPanel from './FmAccessObjectPanel';
import FmAccessSearch from './FmAccessSearch';
import FmAccessDocuments from './FmAccessDocuments';
import GeminusPluginMenu from '@/components/viewer/GeminusPluginMenu';

const FmAccessNativeView: React.FC = () => {
  const { selectedFacility, navigatorTreeData } = useContext(AppContext);
  const isMobile = useIsMobile();
  const { getHierarchy, loading } = useFmAccessApi();

  const [rootNode, setRootNode] = useState<FmAccessNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<FmAccessNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [leftTab, setLeftTab] = useState<string>('tree');
  const [manualFmGuid, setManualFmGuid] = useState<string | null>(null);
  const [buildingSearch, setBuildingSearch] = useState('');

  const buildingFmGuid = manualFmGuid || selectedFacility?.fmGuid || (selectedFacility as any)?.fm_access_building_guid;
  const buildingName = buildingFmGuid ? (selectedFacility?.name || 'Building') : 'FM Access 2.0';

  // Building list for empty state selector
  const buildings = useMemo(() => {
    if (!navigatorTreeData) return [];
    return navigatorTreeData.filter(n => n.category === 'Building');
  }, [navigatorTreeData]);

  const filteredBuildings = useMemo(() => {
    if (!buildingSearch.trim()) return buildings;
    const q = buildingSearch.toLowerCase();
    return buildings.filter(b =>
      (b.commonName || '').toLowerCase().includes(q) ||
      (b.name || '').toLowerCase().includes(q)
    );
  }, [buildings, buildingSearch]);

  const loadHierarchy = useCallback(async () => {
    if (!buildingFmGuid) {
      setRootNode(null);
      return;
    }
    setTreeLoading(true);
    const data = await getHierarchy(buildingFmGuid);
    if (data) {
      if (Array.isArray(data)) {
        setRootNode({
          objectName: 'FM Access',
          classId: 0,
          children: data,
        });
      } else {
        setRootNode(data);
      }
    }
    setTreeLoading(false);
  }, [buildingFmGuid, getHierarchy]);

  useEffect(() => {
    loadHierarchy();
  }, [buildingFmGuid]);

  const handleNodeSelect = (node: FmAccessNode) => {
    setSelectedNode(node);
  };

  const handleSearchSelect = (result: any) => {
    setSelectedNode(result);
    setLeftTab('tree');
  };

  const handleRefresh = () => {
    loadHierarchy();
    if (selectedNode?.guid || selectedNode?.systemGuid) {
      setSelectedNode({ ...selectedNode });
    }
  };

  const handleCreateChild = (parentGuid: string) => {};

  const buildingObjectId = rootNode?.objectId ? String(rootNode.objectId) : buildingFmGuid || '';

  // Building selector empty state
  if (!buildingFmGuid) {
    return (
      <div className="flex flex-col h-full bg-background items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Building2 size={20} className="text-primary" />
              <h2 className="text-base font-semibold">Select Building</h2>
              <Badge variant="outline" className="text-[10px] ml-auto">FMA 2.0</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Select a building to load the FM Access hierarchy.
            </p>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search building..."
                value={buildingSearch}
                onChange={(e) => setBuildingSearch(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filteredBuildings.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No buildings found</p>
              ) : (
                filteredBuildings.map(b => (
                  <button
                    key={b.fmGuid}
                    onClick={() => setManualFmGuid(b.fmGuid)}
                    className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    <p className="font-medium truncate">{b.commonName || b.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{b.fmGuid}</p>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <Building2 size={16} className="text-primary" />
          <h2 className="text-sm font-semibold truncate flex-1">{buildingName}</h2>
          <Badge variant="outline" className="text-[10px]">FMA 2.0</Badge>
        </div>

        <Tabs value={leftTab} onValueChange={setLeftTab} className="flex-1 flex flex-col">
          <TabsList className="mx-3 mt-2">
            <TabsTrigger value="tree" className="text-xs flex-1"><TreePine size={12} className="mr-1" />Tree</TabsTrigger>
            <TabsTrigger value="search" className="text-xs flex-1"><Search size={12} className="mr-1" />Search</TabsTrigger>
            <TabsTrigger value="docs" className="text-xs flex-1"><FileText size={12} className="mr-1" />Docs</TabsTrigger>
          </TabsList>

          <TabsContent value="tree" className="flex-1 mt-0">
            {selectedNode ? (
              <div className="flex flex-col h-full">
                <Button variant="ghost" size="sm" className="m-2 self-start text-xs" onClick={() => setSelectedNode(null)}>
                  ← Back to tree
                </Button>
                <FmAccessObjectPanel selectedNode={selectedNode} onRefresh={handleRefresh} onCreateChild={handleCreateChild} />
              </div>
            ) : (
              <FmAccessTree rootNode={rootNode} loading={treeLoading} selectedGuid={null} onSelect={handleNodeSelect} />
            )}
          </TabsContent>
          <TabsContent value="search" className="flex-1 mt-0">
            <FmAccessSearch onSelect={handleSearchSelect} />
          </TabsContent>
          <TabsContent value="docs" className="flex-1 mt-0">
            <FmAccessDocuments buildingId={buildingObjectId} buildingName={buildingName} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card">
        <Building2 size={18} className="text-primary" />
        <h2 className="text-base font-semibold truncate">{buildingName}</h2>
        <Badge variant="outline" className="text-[10px]">FMA 2.0</Badge>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setManualFmGuid(null); setRootNode(null); setSelectedNode(null); }}>
          Change building
        </Button>
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
          <Tabs value={leftTab} onValueChange={setLeftTab} className="h-full flex flex-col">
            <TabsList className="mx-2 mt-2 mb-0">
              <TabsTrigger value="tree" className="text-xs flex-1"><TreePine size={12} className="mr-1" />Hierarchy</TabsTrigger>
              <TabsTrigger value="search" className="text-xs flex-1"><Search size={12} className="mr-1" />Search</TabsTrigger>
              <TabsTrigger value="docs" className="text-xs flex-1"><FileText size={12} className="mr-1" />Drawings</TabsTrigger>
            </TabsList>

            <TabsContent value="tree" className="flex-1 mt-0 overflow-hidden">
              <FmAccessTree
                rootNode={rootNode}
                loading={treeLoading}
                selectedGuid={selectedNode?.guid || selectedNode?.systemGuid || null}
                onSelect={handleNodeSelect}
              />
            </TabsContent>
            <TabsContent value="search" className="flex-1 mt-0 overflow-hidden">
              <FmAccessSearch onSelect={handleSearchSelect} />
            </TabsContent>
            <TabsContent value="docs" className="flex-1 mt-0 overflow-hidden">
              <FmAccessDocuments buildingId={buildingObjectId} buildingName={buildingName} />
            </TabsContent>
          </Tabs>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={70}>
          <FmAccessObjectPanel
            selectedNode={selectedNode}
            onRefresh={handleRefresh}
            onCreateChild={handleCreateChild}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Geminus Plugin Menu FAB */}
      <GeminusPluginMenu
        buildingFmGuid={buildingFmGuid}
        buildingName={buildingName}
        source="fma_native"
        contextMetadata={{
          selectedNodeGuid: selectedNode?.guid || selectedNode?.systemGuid,
          selectedNodeName: selectedNode?.objectName,
        }}
      />
    </div>
  );
};

export default FmAccessNativeView;
