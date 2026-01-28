import React, { useState, useEffect, useContext } from 'react';
import { Plus, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import InventoryForm from '@/components/inventory/InventoryForm';
import InventoryList from '@/components/inventory/InventoryList';
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
  };
}

const Inventory: React.FC = () => {
  const isMobile = useIsMobile();
  const { inventoryPrefill, clearInventoryPrefill } = useContext(AppContext);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [savedItems, setSavedItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Auto-open form if we have prefill data
  useEffect(() => {
    if (inventoryPrefill) {
      setIsFormOpen(true);
    }
  }, [inventoryPrefill]);

  // Load recently created local assets on mount
  useEffect(() => {
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

    loadRecentItems();
  }, []);

  const handleSaved = (item: InventoryItem) => {
    setSavedItems(prev => [item, ...prev]);
    setIsFormOpen(false);
    clearInventoryPrefill();
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    clearInventoryPrefill();
  };

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
        onClick={() => setIsFormOpen(true)}
      >
        <Plus className="h-6 w-6" />
        Ny tillgång
      </Button>

      {/* Recently registered list */}
      <InventoryList items={savedItems} isLoading={isLoading} />

      {/* Form as sheet/drawer on mobile */}
      <Sheet open={isFormOpen} onOpenChange={(open) => { if (!open) handleCloseForm(); else setIsFormOpen(true); }}>
        <SheetContent 
          side={isMobile ? "bottom" : "right"} 
          className={`${isMobile ? 'h-[90vh] rounded-t-2xl' : 'w-[450px]'} overflow-y-auto`}
        >
          <SheetHeader className="mb-4">
            <SheetTitle className="text-xl">Registrera tillgång</SheetTitle>
          </SheetHeader>
          <InventoryForm
            onSaved={handleSaved}
            onCancel={handleCloseForm}
            prefill={inventoryPrefill || undefined}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Inventory;
