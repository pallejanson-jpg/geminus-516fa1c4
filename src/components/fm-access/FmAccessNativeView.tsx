import React, { useState, useEffect, useCallback, useContext } from 'react';
import { AppContext } from '@/context/AppContext';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TreePine, Search, FileText, Loader2, Building2 } from 'lucide-react';
import { useFmAccessApi, FmAccessNode } from '@/hooks/useFmAccessApi';
import { useIsMobile } from '@/hooks/use-mobile';
import FmAccessTree from './FmAccessTree';
import FmAccessObjectPanel from './FmAccessObjectPanel';
import FmAccessSearch from './FmAccessSearch';
import FmAccessDocuments from './FmAccessDocuments';

const FmAccessNativeView: React.FC = () => {
  const { selectedFacility } = useContext(AppContext);
  const isMobile = useIsMobile();
  const { getHierarchy, loading } = useFmAccessApi();

  const [rootNode, setRootNode] = useState<FmAccessNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<FmAccessNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [leftTab, setLeftTab] = useState<string>('tree');

  const buildingFmGuid = selectedFacility?.fm_guid || selectedFacility?.fm_access_building_guid;
  const buildingName = buildingFmGuid ? (selectedFacility?.name || 'Byggnad') : 'FM Access';

  const loadHierarchy = useCallback(async () => {
    if (!buildingFmGuid) {
      // No building selected — show empty state, don't call API
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

  const handleCreateChild = (parentGuid: string) => {
    // Could open a dialog — for now, placeholder
  };

  const buildingObjectId = rootNode?.objectId ? String(rootNode.objectId) : buildingFmGuid || '';

  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <Building2 size={16} className="text-primary" />
          <h2 className="text-sm font-semibold truncate flex-1">{buildingName}</h2>
          <Badge variant="outline" className="text-[10px]">FM Access</Badge>
        </div>

        <Tabs value={leftTab} onValueChange={setLeftTab} className="flex-1 flex flex-col">
          <TabsList className="mx-3 mt-2">
            <TabsTrigger value="tree" className="text-xs flex-1"><TreePine size={12} className="mr-1" />Träd</TabsTrigger>
            <TabsTrigger value="search" className="text-xs flex-1"><Search size={12} className="mr-1" />Sök</TabsTrigger>
            <TabsTrigger value="docs" className="text-xs flex-1"><FileText size={12} className="mr-1" />Dok</TabsTrigger>
          </TabsList>

          <TabsContent value="tree" className="flex-1 mt-0">
            {selectedNode ? (
              <div className="flex flex-col h-full">
                <Button variant="ghost" size="sm" className="m-2 self-start text-xs" onClick={() => setSelectedNode(null)}>
                  ← Tillbaka till träd
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
        <Badge variant="outline" className="text-[10px]">FM Access 2.0</Badge>
        <div className="flex-1" />
        {loading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={30} minSize={20} maxSize={45}>
          <Tabs value={leftTab} onValueChange={setLeftTab} className="h-full flex flex-col">
            <TabsList className="mx-2 mt-2 mb-0">
              <TabsTrigger value="tree" className="text-xs flex-1"><TreePine size={12} className="mr-1" />Hierarki</TabsTrigger>
              <TabsTrigger value="search" className="text-xs flex-1"><Search size={12} className="mr-1" />Sök</TabsTrigger>
              <TabsTrigger value="docs" className="text-xs flex-1"><FileText size={12} className="mr-1" />Ritningar</TabsTrigger>
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
    </div>
  );
};

export default FmAccessNativeView;
