import React, { useState, useEffect } from 'react';
import { Loader2, Crosshair, Eye, X, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import BuildingSelector from './selectors/BuildingSelector';
import FloorSelector from './selectors/FloorSelector';
import RoomSelector from './selectors/RoomSelector';
import ImageUpload from './ImageUpload';
import PositionPickerDialog from './PositionPickerDialog';
import type { InventoryItem } from '@/pages/Inventory';

interface AnnotationSymbol {
  id: string;
  name: string;
  category: string;
  color: string;
  icon_url: string | null;
}

interface InventoryFormProps {
  onSaved: (item: InventoryItem) => void;
  onCancel: () => void;
  prefill?: {
    buildingFmGuid?: string;
    levelFmGuid?: string;
    roomFmGuid?: string;
  };
  editItem?: InventoryItem | null;
  onClearEdit?: () => void;
}

export const INVENTORY_CATEGORIES = [
  { value: 'fire_extinguisher', label: 'Brandsläckare', icon: '🔥' },
  { value: 'fire_blanket', label: 'Brandfilt', icon: '🧯' },
  { value: 'fire_hose', label: 'Brandslang', icon: '🚒' },
  { value: 'emergency_exit', label: 'Nödutgång', icon: '🚪' },
  { value: 'sensor', label: 'Sensor', icon: '📡' },
  { value: 'sprinkler', label: 'Sprinkler', icon: '💧' },
  { value: 'hvac_unit', label: 'Luftbehandlingsaggregat', icon: '🌀' },
  { value: 'lamp', label: 'Lampa', icon: '💡' },
  { value: 'furniture', label: 'Möbel', icon: '🪑' },
  { value: 'it_equipment', label: 'IT-utrustning', icon: '💻' },
  { value: 'other', label: 'Övrigt', icon: '📦' },
];

const InventoryForm: React.FC<InventoryFormProps> = ({ onSaved, onCancel, prefill, editItem, onClearEdit }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  // Form state - initialized with prefill values
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [symbolId, setSymbolId] = useState('');
  const [buildingFmGuid, setBuildingFmGuid] = useState(prefill?.buildingFmGuid || '');
  const [levelFmGuid, setLevelFmGuid] = useState(prefill?.levelFmGuid || '');
  const [roomFmGuid, setRoomFmGuid] = useState(prefill?.roomFmGuid || '');
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // 3D position state
  const [positionDialogOpen, setPositionDialogOpen] = useState(false);
  const [coordinates, setCoordinates] = useState<{ x: number; y: number; z: number } | null>(null);

  // Building settings for Ivion
  const [buildingSettings, setBuildingSettings] = useState<{ ivion_site_id: string | null } | null>(null);

  // Track the fm_guid when editing
  const [editingFmGuid, setEditingFmGuid] = useState<string | null>(null);

  // Load edit item data
  useEffect(() => {
    if (editItem) {
      setIsEditing(true);
      setEditingFmGuid(editItem.fm_guid);
      setName(editItem.name || '');
      setCategory(editItem.asset_type || '');
      setSymbolId(editItem.symbol_id || '');
      setBuildingFmGuid(editItem.building_fm_guid || '');
      setLevelFmGuid(editItem.level_fm_guid || '');
      setRoomFmGuid(editItem.in_room_fm_guid || '');
      setDescription(editItem.attributes?.description || '');
      setImageUrl((editItem.attributes as any)?.imageUrl || null);
      
      // Load coordinates if they exist
      loadCoordinates(editItem.fm_guid);
    } else {
      // Reset form for new item
      resetForm();
    }
  }, [editItem]);

  const loadCoordinates = async (fmGuid: string) => {
    const { data } = await supabase
      .from('assets')
      .select('coordinate_x, coordinate_y, coordinate_z')
      .eq('fm_guid', fmGuid)
      .maybeSingle();
    
    if (data && data.coordinate_x !== null && data.coordinate_y !== null && data.coordinate_z !== null) {
      setCoordinates({
        x: Number(data.coordinate_x),
        y: Number(data.coordinate_y),
        z: Number(data.coordinate_z),
      });
    }
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditingFmGuid(null);
    setName('');
    setDescription('');
    setCategory('');
    setSymbolId('');
    setBuildingFmGuid(prefill?.buildingFmGuid || '');
    setLevelFmGuid(prefill?.levelFmGuid || '');
    setRoomFmGuid(prefill?.roomFmGuid || '');
    setImageUrl(null);
    setCoordinates(null);
  };

  // Fetch symbols on mount
  useEffect(() => {
    const fetchSymbols = async () => {
      const { data, error } = await supabase
        .from('annotation_symbols')
        .select('id, name, category, color, icon_url')
        .order('category, name');

      if (!error && data) {
        setSymbols(data);
      }
    };
    fetchSymbols();
  }, []);

  // Fetch building settings when building changes (for Ivion site ID)
  useEffect(() => {
    if (!buildingFmGuid) {
      setBuildingSettings(null);
      return;
    }

    const fetchBuildingSettings = async () => {
      const { data } = await supabase
        .from('building_settings')
        .select('ivion_site_id')
        .eq('fm_guid', buildingFmGuid)
        .maybeSingle();

      setBuildingSettings(data);
    };
    fetchBuildingSettings();
  }, [buildingFmGuid]);

  // Handler for 3D position picking
  const handlePositionPicked = (coords: { x: number; y: number; z: number }) => {
    setCoordinates(coords);
    toast.success('Position vald!', {
      description: `X: ${coords.x.toFixed(2)}, Y: ${coords.y.toFixed(2)}, Z: ${coords.z.toFixed(2)}`,
    });
  };

  // Handler for opening Ivion 360
  const handleOpen360 = () => {
    const ivionUrl = localStorage.getItem('ivionApiUrl');
    const siteId = buildingSettings?.ivion_site_id;

    if (!ivionUrl && !siteId) {
      toast.error('Ivion ej konfigurerad', {
        description: 'Ange Ivion Site ID för byggnaden under byggnadsinställningar, och konfigurera IVION_API_URL i Cloud-secrets.',
      });
      return;
    }

    if (!siteId) {
      toast.error('Ingen Ivion-site kopplad', {
        description: 'Koppla byggnaden till en Ivion-site i byggnadsinställningar',
      });
      return;
    }

    // Use configured URL or default to swg.iv.navvis.com
    const baseUrl = ivionUrl || 'https://swg.iv.navvis.com';
    window.open(`${baseUrl}/site/${siteId}`, '_blank');
    toast.info('Ivion öppnat i ny flik');
  };

  const handleSubmit = async () => {
    // Validation
    if (!name.trim()) {
      toast.error('Namn är obligatoriskt');
      return;
    }
    if (!category) {
      toast.error('Välj en kategori');
      return;
    }
    if (!symbolId) {
      toast.error('Välj en symbol');
      return;
    }
    if (!buildingFmGuid) {
      toast.error('Välj en byggnad');
      return;
    }

    setIsLoading(true);

    try {
      const inventoryDate = new Date().toISOString();
      
      if (isEditing && editingFmGuid) {
        // Update existing asset
        const updateData = {
          name: name.trim(),
          common_name: name.trim(),
          asset_type: category,
          symbol_id: symbolId,
          building_fm_guid: buildingFmGuid,
          level_fm_guid: levelFmGuid || null,
          in_room_fm_guid: roomFmGuid || null,
          annotation_placed: !!coordinates,
          coordinate_x: coordinates?.x ?? null,
          coordinate_y: coordinates?.y ?? null,
          coordinate_z: coordinates?.z ?? null,
          attributes: {
            objectType: 4,
            designation: name.trim(),
            commonName: name.trim(),
            inRoomFmGuid: roomFmGuid || null,
            levelFmGuid: levelFmGuid || null,
            buildingFmGuid: buildingFmGuid,
            assetCategory: category,
            description: description.trim() || null,
            inventoryDate: inventoryDate,
            imageUrl: imageUrl || null,
            syncProperties: [
              { name: 'Description', value: description.trim() || '', dataType: 0 },
              { name: 'InventoryDate', value: inventoryDate, dataType: 4 },
              { name: 'AssetCategory', value: category, dataType: 0 },
            ],
          },
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from('assets')
          .update(updateData)
          .eq('fm_guid', editingFmGuid);

        if (error) throw error;

        toast.success('Tillgång uppdaterad!');
        onSaved({
          fm_guid: editingFmGuid,
          name: name.trim(),
          asset_type: category,
          symbol_id: symbolId,
          building_fm_guid: buildingFmGuid,
          level_fm_guid: levelFmGuid || null,
          in_room_fm_guid: roomFmGuid || null,
          attributes: {
            description: description.trim() || undefined,
            inventoryDate: inventoryDate,
          },
        });
        
        // Clear edit mode
        if (onClearEdit) onClearEdit();
        resetForm();
      } else {
        // Create new asset
        const newFmGuid = crypto.randomUUID();
        
        const newAsset = {
          fm_guid: newFmGuid,
          name: name.trim(),
          common_name: name.trim(),
          category: 'Instance',
          asset_type: category,
          symbol_id: symbolId,
          building_fm_guid: buildingFmGuid,
          level_fm_guid: levelFmGuid || null,
          in_room_fm_guid: roomFmGuid || null,
          created_in_model: false,
          is_local: true,
          annotation_placed: !!coordinates,
          coordinate_x: coordinates?.x ?? null,
          coordinate_y: coordinates?.y ?? null,
          coordinate_z: coordinates?.z ?? null,
          attributes: {
            objectType: 4,
            designation: name.trim(),
            commonName: name.trim(),
            inRoomFmGuid: roomFmGuid || null,
            levelFmGuid: levelFmGuid || null,
            buildingFmGuid: buildingFmGuid,
            assetCategory: category,
            description: description.trim() || null,
            inventoryDate: inventoryDate,
            imageUrl: imageUrl || null,
            syncProperties: [
              { name: 'Description', value: description.trim() || '', dataType: 0 },
              { name: 'InventoryDate', value: inventoryDate, dataType: 4 },
              { name: 'AssetCategory', value: category, dataType: 0 },
            ],
          },
        };

        const { error } = await supabase.from('assets').insert([newAsset]);

        if (error) throw error;

        toast.success('Tillgång sparad!');
        onSaved({
          fm_guid: newAsset.fm_guid,
          name: newAsset.name,
          asset_type: newAsset.asset_type,
          symbol_id: newAsset.symbol_id,
          building_fm_guid: newAsset.building_fm_guid,
          level_fm_guid: newAsset.level_fm_guid,
          in_room_fm_guid: newAsset.in_room_fm_guid,
          attributes: {
            description: description.trim() || undefined,
            inventoryDate: inventoryDate,
          },
        });
        
        resetForm();
      }
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error('Kunde inte spara', {
        description: error.message,
      });
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

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      {/* Edit mode indicator */}
      {isEditing && (
        <div className="flex items-center justify-between bg-primary/10 border border-primary/30 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Redigerar: {name || 'Tillgång'}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (onClearEdit) onClearEdit();
              resetForm();
            }}
          >
            Avbryt redigering
          </Button>
        </div>
      )}

      {/* Name - large input */}
      <div className="space-y-2">
        <Label className="text-base">Namn / Beteckning *</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="t.ex. Brandsläckare BS-001"
          className="h-12 text-base"
          autoFocus
          maxLength={100}
        />
      </div>

      {/* Category dropdown */}
      <div className="space-y-2">
        <Label className="text-base">Kategori *</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Välj kategori..." />
          </SelectTrigger>
          <SelectContent className="bg-popover z-50">
            {INVENTORY_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                <span className="flex items-center gap-2">
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Symbol dropdown with images */}
      <div className="space-y-2">
        <Label className="text-base">Symbol *</Label>
        <Select value={symbolId} onValueChange={setSymbolId}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Välj symbol..." />
          </SelectTrigger>
          <SelectContent className="bg-popover z-50 max-h-60">
            {Object.entries(groupedSymbols).map(([cat, syms]) => (
              <div key={cat}>
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  {cat}
                </div>
                {syms.map((sym) => (
                  <SelectItem key={sym.id} value={sym.id}>
                    <span className="flex items-center gap-2">
                      {sym.icon_url ? (
                        <img
                          src={sym.icon_url}
                          alt=""
                          className="w-5 h-5 object-contain"
                        />
                      ) : (
                        <div
                          className="w-5 h-5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: sym.color }}
                        />
                      )}
                      <span>{sym.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Building dropdown */}
      <BuildingSelector
        value={buildingFmGuid}
        onChange={(v) => {
          setBuildingFmGuid(v);
          setLevelFmGuid('');
          setRoomFmGuid('');
        }}
      />

      {/* Floor - filtered by building */}
      {buildingFmGuid && (
        <FloorSelector
          buildingFmGuid={buildingFmGuid}
          value={levelFmGuid}
          onChange={(v) => {
            setLevelFmGuid(v);
            setRoomFmGuid('');
          }}
        />
      )}

      {/* Room - filtered by floor */}
      {levelFmGuid && (
        <RoomSelector
          levelFmGuid={levelFmGuid}
          value={roomFmGuid}
          onChange={setRoomFmGuid}
        />
      )}

      {/* 3D Position & 360+ Section */}
      {buildingFmGuid && (
        <div className="space-y-2">
          <Label className="text-base">Position (valfritt)</Label>
          {coordinates && (
            <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-primary shrink-0" />
                <span className="font-mono text-xs sm:text-sm">
                  X: {coordinates.x.toFixed(2)} Y: {coordinates.y.toFixed(2)} Z: {coordinates.z.toFixed(2)}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setCoordinates(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          {/* Always show both buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPositionDialogOpen(true)}
              className="h-12"
            >
              <Crosshair className="h-4 w-4 mr-2" />
              <span className="text-xs sm:text-sm">
                {coordinates ? 'Ändra 3D' : '3D-position'}
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleOpen360}
              className="h-12"
            >
              <Eye className="h-4 w-4 mr-2" />
              <span className="text-xs sm:text-sm">360+</span>
            </Button>
          </div>
          {!buildingSettings?.ivion_site_id && (
            <p className="text-xs text-muted-foreground">
              360+ kräver att Ivion Site ID är konfigurerat i byggnadsinställningarna.
            </p>
          )}
        </div>
      )}

      {/* Image upload */}
      <ImageUpload
        value={imageUrl}
        onChange={setImageUrl}
        disabled={isLoading}
      />

      {/* Description - expandable */}
      <div className="space-y-2">
        <Label className="text-base">Beskrivning (valfritt)</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Fritext beskrivning..."
          className="min-h-[80px]"
          maxLength={1000}
        />
      </div>

      {/* Buttons */}
      <div className="flex gap-3 pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (isEditing && onClearEdit) {
              onClearEdit();
              resetForm();
            } else {
              onCancel();
            }
          }}
          className="flex-1 h-12"
          disabled={isLoading}
        >
          {isEditing ? 'Avbryt' : 'Rensa'}
        </Button>
        <Button type="submit" className="flex-1 h-12" disabled={isLoading}>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (isEditing ? 'Uppdatera' : 'Spara')}
        </Button>
      </div>

      {/* 3D Position Picker Dialog */}
      <PositionPickerDialog
        open={positionDialogOpen}
        onOpenChange={setPositionDialogOpen}
        buildingFmGuid={buildingFmGuid}
        roomFmGuid={roomFmGuid}
        onPositionPicked={handlePositionPicked}
      />
    </form>
  );
};

export default InventoryForm;
