import React, { useState, useEffect, useRef } from 'react';
import { Camera, Save, Loader2, Plus, FileText, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { INVENTORY_CATEGORIES } from '@/components/inventory/InventoryForm';
import type { WizardFormData } from './MobileInventoryWizard';

interface AnnotationSymbol {
  id: string;
  name: string;
  category: string;
  color: string;
  icon_url: string | null;
}

interface EditingItem {
  id: string;
  fm_guid: string;
}

interface QuickRegistrationStepProps {
  formData: WizardFormData;
  updateFormData: (updates: Partial<WizardFormData>) => void;
  onComplete: (registerAnother: boolean) => void;
  quickLoopEnabled: boolean;
  editingItem?: EditingItem | null;
}

const QuickRegistrationStep: React.FC<QuickRegistrationStepProps> = ({
  formData,
  updateFormData,
  onComplete,
  quickLoopEnabled,
  editingItem,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [showDescription, setShowDescription] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch symbols on mount
  useEffect(() => {
    const fetchSymbols = async () => {
      const { data, error } = await supabase
        .from('annotation_symbols')
        .select('id, name, category, color, icon_url')
        .order('category, name');

      if (!error && data) {
        setSymbols(data);

        // Auto-select first symbol if none selected
        if (!formData.symbolId && data.length > 0) {
          updateFormData({ symbolId: data[0].id });
        }
      }
    };
    fetchSymbols();
  }, []);

  // Handle file selection for camera
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // Generate unique filename
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${crypto.randomUUID()}.${ext}`;
      const filePath = `mobile/${fileName}`;

      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
        .from('inventory-images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: publicUrlData } = supabase.storage
        .from('inventory-images')
        .getPublicUrl(filePath);

      updateFormData({ imageUrl: publicUrlData.publicUrl });
      toast.success('Bild uppladdad!');
    } catch (err: any) {
      console.error('Upload error:', err);
      toast.error('Kunde inte ladda upp bild', { description: err.message });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (registerAnother: boolean) => {
    // Validation
    if (!formData.name.trim()) {
      toast.error('Namn är obligatoriskt');
      return;
    }
    if (!formData.symbolId) {
      toast.error('Välj en symbol');
      return;
    }

    setIsLoading(true);

    try {
      const inventoryDate = new Date().toISOString();
      const isEditing = !!editingItem;

      const assetData = {
        name: formData.name.trim(),
        common_name: formData.name.trim(),
        category: 'Instance',
        asset_type: formData.category,
        symbol_id: formData.symbolId,
        building_fm_guid: formData.buildingFmGuid,
        level_fm_guid: formData.levelFmGuid || null,
        in_room_fm_guid: formData.roomFmGuid || null,
        annotation_placed: !!formData.coordinates,
        coordinate_x: formData.coordinates?.x ?? null,
        coordinate_y: formData.coordinates?.y ?? null,
        coordinate_z: formData.coordinates?.z ?? null,
        attributes: {
          objectType: 4,
          designation: formData.name.trim(),
          commonName: formData.name.trim(),
          inRoomFmGuid: formData.roomFmGuid || null,
          levelFmGuid: formData.levelFmGuid || null,
          buildingFmGuid: formData.buildingFmGuid,
          assetCategory: formData.category,
          description: formData.description.trim() || null,
          inventoryDate: inventoryDate,
          imageUrl: formData.imageUrl || null,
          syncProperties: [
            { name: 'Description', value: formData.description.trim() || '', dataType: 0 },
            { name: 'InventoryDate', value: inventoryDate, dataType: 4 },
            { name: 'AssetCategory', value: formData.category, dataType: 0 },
          ],
        },
        updated_at: new Date().toISOString(),
      };

      let error;

      if (isEditing) {
        // UPDATE existing asset
        const result = await supabase
          .from('assets')
          .update(assetData)
          .eq('id', editingItem.id);
        error = result.error;
      } else {
        // INSERT new asset
        const newFmGuid = crypto.randomUUID();
        const result = await supabase.from('assets').insert([{
          ...assetData,
          fm_guid: newFmGuid,
          created_in_model: false,
          is_local: true,
        }]);
        error = result.error;
      }

      if (error) throw error;

      toast.success(isEditing ? 'Tillgång uppdaterad!' : 'Tillgång sparad!', {
        description: `${formData.name} ${isEditing ? 'uppdaterad' : 'registrerad'}${formData.levelName ? ` på ${formData.levelName}` : ''}`,
      });

      onComplete(registerAnother);
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error('Kunde inte spara', { description: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  // Group symbols by category
  const groupedSymbols = symbols.reduce((acc, sym) => {
    if (!acc[sym.category]) acc[sym.category] = [];
    acc[sym.category].push(sym);
    return acc;
  }, {} as Record<string, AnnotationSymbol[]>);

  const selectedSymbol = symbols.find((s) => s.id === formData.symbolId);
  const categoryInfo = INVENTORY_CATEGORIES.find((c) => c.value === formData.category);
  const CategoryIcon = categoryInfo?.Icon;

  return (
    <ScrollArea className="h-full">
      <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] space-y-4">
        {/* Location & position summary */}
        <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-2.5 space-y-1">
          <div className="flex items-center gap-1.5">
            {CategoryIcon && <CategoryIcon className={`h-4 w-4 ${categoryInfo?.color}`} />}
            <span className="font-medium">{formData.categoryLabel}</span>
            <span className="mx-1">•</span>
            <span className="truncate">{formData.buildingName}</span>
            {formData.levelName && <span className="truncate"> → {formData.levelName}</span>}
          </div>
          {formData.coordinates && (
            <div className="flex items-center gap-1.5 text-xs text-primary">
              <MapPin className="h-3 w-3" />
              <span>
                ({formData.coordinates.x.toFixed(1)}, {formData.coordinates.y.toFixed(1)}, {formData.coordinates.z.toFixed(1)})
              </span>
            </div>
          )}
        </div>

        {/* Camera / Image capture - Large touch target */}
        <div className="space-y-2">
          <Label className="text-base font-medium">Foto</Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
          
          {formData.imageUrl ? (
            <div className="relative">
              <img
                src={formData.imageUrl}
                alt="Uppladdad bild"
                className="w-full h-40 object-cover rounded-lg border"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="absolute bottom-2 right-2"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Byt bild'}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full h-20 border-2 border-dashed flex flex-col gap-1"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <Camera className="h-6 w-6" />
                  <span className="text-sm">Ta foto</span>
                </>
              )}
            </Button>
          )}
        </div>

        {/* Name input */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Namn / Beteckning *</Label>
          <Input
            value={formData.name}
            onChange={(e) => updateFormData({ name: e.target.value })}
            placeholder={`t.ex. ${categoryInfo?.label || 'Tillgång'}-001`}
            className="h-12 text-base"
            maxLength={100}
          />
        </div>

        {/* Symbol selector */}
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Symbol *</Label>
          <Select value={formData.symbolId} onValueChange={(val) => updateFormData({ symbolId: val })}>
            <SelectTrigger className="h-12 text-base">
              {selectedSymbol ? (
                <div className="flex items-center gap-3">
                  {selectedSymbol.icon_url ? (
                    <img src={selectedSymbol.icon_url} alt="" className="w-6 h-6" />
                  ) : (
                    <div
                      className="w-6 h-6 rounded-full"
                      style={{ backgroundColor: selectedSymbol.color }}
                    />
                  )}
                  <span>{selectedSymbol.name}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">Välj symbol...</span>
              )}
            </SelectTrigger>
            <SelectContent className="bg-popover z-50 max-h-64">
              {Object.entries(groupedSymbols).map(([category, syms]) => (
                <div key={category}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted">
                    {category}
                  </div>
                  {syms.map((sym) => (
                    <SelectItem key={sym.id} value={sym.id} className="py-3">
                      <div className="flex items-center gap-3">
                        {sym.icon_url ? (
                          <img src={sym.icon_url} alt="" className="w-6 h-6" />
                        ) : (
                          <div
                            className="w-6 h-6 rounded-full"
                            style={{ backgroundColor: sym.color }}
                          />
                        )}
                        <span>{sym.name}</span>
                      </div>
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Optional description */}
        <Collapsible open={showDescription} onOpenChange={setShowDescription}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="w-full justify-start gap-2 h-12">
              <FileText className="h-4 w-4" />
              {showDescription ? 'Dölj beskrivning' : 'Lägg till beskrivning'}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Textarea
              value={formData.description}
              onChange={(e) => updateFormData({ description: e.target.value })}
              placeholder="Valfri beskrivning..."
              className="min-h-24"
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Action buttons - kompaktare med safe-area */}
        <div className="space-y-2 pt-3">
          <Button
            onClick={() => handleSubmit(true)}
            disabled={isLoading || !formData.name.trim() || !formData.symbolId}
            className="w-full h-12 text-base"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            {quickLoopEnabled ? 'Spara & registrera nästa' : 'Spara & ny kategori'}
          </Button>

          <Button
            onClick={() => handleSubmit(false)}
            disabled={isLoading || !formData.name.trim() || !formData.symbolId}
            variant="outline"
            className="w-full h-10"
          >
            <Save className="h-4 w-4 mr-2" />
            Spara & avsluta
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
};

export default QuickRegistrationStep;
