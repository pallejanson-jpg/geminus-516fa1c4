import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
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

const InventoryForm: React.FC<InventoryFormProps> = ({ onSaved, onCancel, prefill }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);

  // Form state - initialized with prefill values
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [symbolId, setSymbolId] = useState('');
  const [buildingFmGuid, setBuildingFmGuid] = useState(prefill?.buildingFmGuid || '');
  const [levelFmGuid, setLevelFmGuid] = useState(prefill?.levelFmGuid || '');
  const [roomFmGuid, setRoomFmGuid] = useState(prefill?.roomFmGuid || '');

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
      const newAsset = {
        fm_guid: crypto.randomUUID(),
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
        annotation_placed: false,
        attributes: {
          description: description.trim() || null,
          inventoryDate: new Date().toISOString(),
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
        attributes: newAsset.attributes as InventoryItem['attributes'],
      });
    } catch (error: any) {
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
          onClick={onCancel}
          className="flex-1 h-12"
          disabled={isLoading}
        >
          Avbryt
        </Button>
        <Button type="submit" className="flex-1 h-12" disabled={isLoading}>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Spara'}
        </Button>
      </div>
    </form>
  );
};

export default InventoryForm;
