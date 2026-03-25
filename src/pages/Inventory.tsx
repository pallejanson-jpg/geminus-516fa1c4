import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, ChevronDown, ChevronUp, Scan } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';
import InventoryForm from '@/components/inventory/InventoryForm';
import InventoryList from '@/components/inventory/InventoryList';
import Ivion360View from '@/components/viewer/Ivion360View';
import Inline3dPositionPicker from '@/components/inventory/Inline3dPositionPicker';
import MobileInventoryWizard from '@/components/inventory/mobile/MobileInventoryWizard';
import { supabase } from '@/integrations/supabase/client';
import { AppContext } from '@/context/AppContext';

export interface InventoryItem {
  fm_guid: string;
  name: string;
  asset_type: string;
  symbol_id: string | null;
  building_fm_guid: string | null;
  level_fm_guid: string | null;
  in_room_fm_guid: string | null;
  created_at?: string;
  attributes?: {
    description?: string;
    inventoryDate?: string;
    imageUrl?: string;
  };
}

const Inventory: React.FC = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { inventoryPrefill, clearInventoryPrefill, refreshInitialData } = useContext(AppContext);
  const [savedItems, setSavedItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [showRecentItems, setShowRecentItems] = useState(false);
  
  // Ivion 360 side panel state (desktop only)
  const [ivion360Url, setIvion360Url] = useState<string | null>(null);
  
  // 3D position picker side panel state (desktop only)
  const [viewer3dOpen, setViewer3dOpen] = useState(false);
  const [viewer3dBuildingFmGuid, setViewer3dBuildingFmGuid] = useState<string | null>(null);
  const [viewer3dRoomFmGuid, setViewer3dRoomFmGuid] = useState<string | null>(null);
  const [pendingPositionForEdit, setPendingPositionForEdit] = useState<{ x: number; y: number; z: number } | null>(null);

  // Load recently created local assets on mount
  const loadRecentItems = async () => {
    try {
      const { data, error } = await supabase
        .from('assets')
        .select('fm_guid, name, asset_type, symbol_id, building_fm_guid, level_fm_guid, in_room_fm_guid, created_at, attributes')
        .eq('is_local', true)
        .eq('created_in_model', false)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setSavedItems((data as InventoryItem[]) || []);
    } catch (err) {
      console.error('Failed to load inventory items:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecentItems();
  }, []);

  const handleSaved = async (item: InventoryItem) => {
    // If editing, update the item in the list
    if (editItem) {
      setSavedItems(prev => prev.map(i => i.fm_guid === item.fm_guid ? item : i));
    } else {
      setSavedItems(prev => [item, ...prev]);
    }
    setEditItem(null);
    clearInventoryPrefill();
    
    // Close 3D viewer when form is saved and cleanup markers
    cleanupViewerAndMarkers();
    
    // Reload to get fresh data
    await loadRecentItems();
    
    // Refresh navigator data so new assets appear in Portfolio/Navigator
    await refreshInitialData();
  };

  const handleCloseForm = () => {
    setEditItem(null);
    clearInventoryPrefill();
  };

  const handleEdit = (item: InventoryItem) => {
    setEditItem(item);
    // Expand recent items to show selection
    setShowRecentItems(true);
  };

  const handleClearEdit = () => {
    setEditItem(null);
  };

  // Cleanup function - removes all temp markers and closes viewer
  const cleanupViewerAndMarkers = () => {
    setViewer3dOpen(false);
    setViewer3dBuildingFmGuid(null);
    setViewer3dRoomFmGuid(null);
    // Remove all temp pick markers from DOM
    document.querySelectorAll('.temp-pick-marker').forEach(el => el.remove());
  };

  // Handler for opening 360 inline (desktop)
  const handleOpen360 = (url: string) => {
    // Close 3D if open and cleanup markers
    cleanupViewerAndMarkers();
    setIvion360Url(url);
  };

  const handleClose360 = () => {
    setIvion360Url(null);
  };

  // Handler for opening 3D inline (desktop)
  const handleOpen3d = (buildingFmGuid: string, roomFmGuid?: string) => {
    // Close 360 if open
    setIvion360Url(null);
    setViewer3dBuildingFmGuid(buildingFmGuid);
    setViewer3dRoomFmGuid(roomFmGuid || null);
    setViewer3dOpen(true);
  };

  const handlePositionConfirmed = (coords: { x: number; y: number; z: number }) => {
    setPendingPositionForEdit(coords);
    // Do NOT close 3D viewer here - keep it open until form is saved
  };

  const handleClose3d = () => {
    cleanupViewerAndMarkers();
  };

  // Check if viewer panel should be visible
  const showViewerPanel = viewer3dOpen || ivion360Url;

  // Desktop layout: Form left (25%), Viewer right (75%)
  if (!isMobile) {
    return (
      <div className="h-full bg-background">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left column: Form with collapsible recent items */}
          <ResizablePanel defaultSize={showViewerPanel ? 25 : 35} minSize={20} maxSize={40}>
            <div className="h-full flex flex-col p-4 overflow-y-auto">
              {/* Header with collapsible recent items dropdown */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <ClipboardList className="h-6 w-6 text-primary" />
                  <h1 className="text-xl font-semibold text-foreground">Inventory</h1>
                </div>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    const buildingGuid = editItem?.building_fm_guid || inventoryPrefill?.buildingFmGuid;
                    const params = buildingGuid ? `?building=${encodeURIComponent(buildingGuid)}` : '';
                    navigate(`/inventory/ai-scan${params}`);
                  }}
                  className="gap-2"
                >
                  <Scan className="h-4 w-4" />
                  AI Scan
                </Button>
              </div>
              
              {/* Collapsible dropdown for recent items */}
              <Collapsible open={showRecentItems} onOpenChange={setShowRecentItems} className="mb-4">
                <CollapsibleTrigger className="flex items-center justify-between w-full p-3 bg-muted/50 hover:bg-muted rounded-lg transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Recently registered</span>
                    <Badge variant="secondary" className="text-xs">
                      {savedItems.length}
                    </Badge>
                  </div>
                  {showRecentItems ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="max-h-[200px] overflow-y-auto border rounded-lg">
                    <InventoryList 
                      items={savedItems} 
                      isLoading={isLoading} 
                      onEdit={handleEdit}
                      selectedFmGuid={editItem?.fm_guid}
                      compact
                    />
                  </div>
                </CollapsibleContent>
              </Collapsible>

              {/* Registration form */}
              <Card className="p-4 flex-1 overflow-y-auto">
                <h2 className="text-lg font-semibold mb-4">
                  {editItem ? 'Edit asset' : 'Register new asset'}
                </h2>
                <InventoryForm
                  onSaved={handleSaved}
                  onCancel={handleCloseForm}
                  prefill={inventoryPrefill || undefined}
                  editItem={editItem}
                  onClearEdit={handleClearEdit}
                  onOpen360={handleOpen360}
                  onOpen3d={handleOpen3d}
                  pendingPosition={pendingPositionForEdit}
                  onPendingPositionConsumed={() => setPendingPositionForEdit(null)}
                />
              </Card>
            </div>
          </ResizablePanel>

          {/* Right column: Viewer area (always visible, shows placeholder when empty) */}
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={showViewerPanel ? 75 : 65} minSize={50}>
            <div className="h-full bg-muted/20">
              {viewer3dOpen && viewer3dBuildingFmGuid ? (
                <Inline3dPositionPicker
                  buildingFmGuid={viewer3dBuildingFmGuid}
                  roomFmGuid={viewer3dRoomFmGuid || undefined}
                  onPositionConfirmed={handlePositionConfirmed}
                  onClose={handleClose3d}
                />
              ) : ivion360Url ? (
                <Ivion360View url={ivion360Url} onClose={handleClose360} />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center max-w-md p-8">
                    <div className="text-6xl mb-4">🏢</div>
                    <h3 className="text-lg font-medium mb-2">3D View / 360° View</h3>
                    <p className="text-sm">
                      Select a building and click "Select 3D position" or "Open 360+" in the form to display the view here.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  // Mobile layout: Full-screen wizard
  return <MobileInventoryWizard onItemSaved={loadRecentItems} />;
};

export default Inventory;
