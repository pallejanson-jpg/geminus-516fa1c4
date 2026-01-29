import React, { useState, useEffect, useContext } from 'react';
import { Plus, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
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
  const isMobile = useIsMobile();
  const { inventoryPrefill, clearInventoryPrefill } = useContext(AppContext);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  
  // Ivion 360 side panel state (desktop only)
  const [ivion360Url, setIvion360Url] = useState<string | null>(null);
  
  // 3D position picker side panel state (desktop only)
  const [viewer3dOpen, setViewer3dOpen] = useState(false);
  const [viewer3dBuildingFmGuid, setViewer3dBuildingFmGuid] = useState<string | null>(null);
  const [viewer3dRoomFmGuid, setViewer3dRoomFmGuid] = useState<string | null>(null);
  const [pendingPositionForEdit, setPendingPositionForEdit] = useState<{ x: number; y: number; z: number } | null>(null);

  // Auto-open form if we have prefill data
  useEffect(() => {
    if (inventoryPrefill) {
      setIsFormOpen(true);
    }
  }, [inventoryPrefill]);

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

  const handleSaved = (item: InventoryItem) => {
    // If editing, update the item in the list
    if (editItem) {
      setSavedItems(prev => prev.map(i => i.fm_guid === item.fm_guid ? item : i));
    } else {
      setSavedItems(prev => [item, ...prev]);
    }
    setIsFormOpen(false);
    setEditItem(null);
    clearInventoryPrefill();
    
    // Close 3D viewer when form is saved
    setViewer3dOpen(false);
    setViewer3dBuildingFmGuid(null);
    setViewer3dRoomFmGuid(null);
    
    // Reload to get fresh data
    loadRecentItems();
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditItem(null);
    clearInventoryPrefill();
  };

  const handleEdit = (item: InventoryItem) => {
    setEditItem(item);
    if (isMobile) {
      setIsFormOpen(true);
    }
  };

  const handleClearEdit = () => {
    setEditItem(null);
  };

  // Handler for opening 360 inline (desktop)
  const handleOpen360 = (url: string) => {
    // Close 3D if open
    setViewer3dOpen(false);
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
    setViewer3dOpen(false);
  };

  // Check if viewer panel should be visible
  const showViewerPanel = viewer3dOpen || ivion360Url;

  // Desktop layout: side-by-side with resizable panels
  if (!isMobile) {
    return (
      <div className="h-full bg-background">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left column: Recently saved items - narrower */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
            <div className="h-full flex flex-col p-4">
              <div className="flex items-center gap-3 mb-4">
                <ClipboardList className="h-6 w-6 text-primary" />
                <h1 className="text-xl font-semibold text-foreground">Inventering</h1>
                <Badge variant="secondary" className="ml-auto">
                  {savedItems.length} sparade
                </Badge>
              </div>
              <InventoryList 
                items={savedItems} 
                isLoading={isLoading} 
                onEdit={handleEdit}
                selectedFmGuid={editItem?.fm_guid}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Middle column: Registration form - fixed width */}
          <ResizablePanel defaultSize={showViewerPanel ? 30 : 40} minSize={25} maxSize={showViewerPanel ? 50 : 55}>
            <div className="h-full p-4">
              <Card className="p-6 h-full overflow-y-auto">
                <h2 className="text-lg font-semibold mb-4">
                  {editItem ? 'Redigera tillgång' : 'Registrera ny tillgång'}
                </h2>
                <InventoryForm
                  onSaved={handleSaved}
                  onCancel={handleClearEdit}
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

          {/* Right column: 3D Viewer or Ivion 360 (conditional) */}
          {showViewerPanel && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={30}>
                <div className="h-full">
                  {viewer3dOpen && viewer3dBuildingFmGuid ? (
                    <Inline3dPositionPicker
                      buildingFmGuid={viewer3dBuildingFmGuid}
                      roomFmGuid={viewer3dRoomFmGuid || undefined}
                      onPositionConfirmed={handlePositionConfirmed}
                      onClose={handleClose3d}
                    />
                  ) : ivion360Url ? (
                    <Ivion360View url={ivion360Url} onClose={handleClose360} />
                  ) : null}
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    );
  }

  // Mobile layout: Full-screen wizard
  return <MobileInventoryWizard onItemSaved={loadRecentItems} />;
};

export default Inventory;
