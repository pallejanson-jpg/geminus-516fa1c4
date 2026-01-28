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
    setIvion360Url(url);
  };

  const handleClose360 = () => {
    setIvion360Url(null);
  };

  // Desktop layout: side-by-side with resizable panels
  if (!isMobile) {
    return (
      <div className="h-full bg-background">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left column: Recently saved items */}
          <ResizablePanel defaultSize={25} minSize={15} maxSize={40}>
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

          {/* Middle column: Registration form */}
          <ResizablePanel defaultSize={ivion360Url ? 35 : 75} minSize={30}>
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
                />
              </Card>
            </div>
          </ResizablePanel>

          {/* Right column: Ivion 360 (conditional) */}
          {ivion360Url && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={40} minSize={25}>
                <div className="h-full">
                  <Ivion360View url={ivion360Url} onClose={handleClose360} />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    );
  }

  // Mobile layout: Button + sheet
  return (
    <div className="h-full flex flex-col p-4 space-y-4 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Inventering</h1>
        </div>
        <Badge variant="secondary" className="text-sm">
          {savedItems.length} sparade
        </Badge>
      </div>

      {/* Large "New Asset" button */}
      <Button
        size="lg"
        className="w-full h-16 text-lg gap-3"
        onClick={() => {
          setEditItem(null);
          setIsFormOpen(true);
        }}
      >
        <Plus className="h-6 w-6" />
        Ny tillgång
      </Button>

      {/* Recently registered list */}
      <InventoryList 
        items={savedItems} 
        isLoading={isLoading} 
        onEdit={handleEdit}
        selectedFmGuid={editItem?.fm_guid}
      />

      {/* Form as sheet/drawer on mobile */}
      <Sheet open={isFormOpen} onOpenChange={(open) => { if (!open) handleCloseForm(); else setIsFormOpen(true); }}>
        <SheetContent 
          side="bottom" 
          className="h-[90vh] rounded-t-2xl overflow-y-auto"
        >
          <SheetHeader className="mb-4">
            <SheetTitle className="text-xl">
              {editItem ? 'Redigera tillgång' : 'Registrera tillgång'}
            </SheetTitle>
          </SheetHeader>
          <InventoryForm
            onSaved={handleSaved}
            onCancel={handleCloseForm}
            prefill={inventoryPrefill || undefined}
            editItem={editItem}
            onClearEdit={handleClearEdit}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Inventory;
