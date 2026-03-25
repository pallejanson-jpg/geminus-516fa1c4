import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Crosshair, Eye, X, Pencil, RefreshCw, Info, Flame, ShieldAlert, Droplets, DoorOpen, Radio, Fan, Lightbulb, Armchair, Monitor, Package, Camera, Sparkles, BookOpen, CheckCircle2, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import BuildingSelector from './selectors/BuildingSelector';
import FloorSelector from './selectors/FloorSelector';
import RoomSelector from './selectors/RoomSelector';
import ImageUpload from './ImageUpload';
import PositionPickerDialog from './PositionPickerDialog';
import type { InventoryItem } from '@/pages/Inventory';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';

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
  onOpen360?: (url: string) => void; // Callback for inline 360 view on desktop
  onOpen3d?: (buildingFmGuid: string, roomFmGuid?: string) => void; // Callback for inline 3D picker on desktop
  pendingPosition?: { x: number; y: number; z: number } | null; // Position received from inline 3D picker
  onPendingPositionConsumed?: () => void; // Called when pendingPosition has been applied
}

export interface InventoryCategory {
  value: string;
  label: string;
  Icon: LucideIcon;
  color: string;
}

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  { value: 'fire_extinguisher', label: 'Fire Extinguisher', Icon: Flame, color: 'text-red-500' },
  { value: 'fire_blanket', label: 'Fire Blanket', Icon: ShieldAlert, color: 'text-orange-500' },
  { value: 'fire_hose', label: 'Fire Hose', Icon: Droplets, color: 'text-red-600' },
  { value: 'emergency_exit', label: 'Emergency Exit', Icon: DoorOpen, color: 'text-green-500' },
  { value: 'sensor', label: 'Sensor', Icon: Radio, color: 'text-blue-500' },
  { value: 'sprinkler', label: 'Sprinkler', Icon: Droplets, color: 'text-cyan-500' },
  { value: 'hvac_unit', label: 'HVAC Unit', Icon: Fan, color: 'text-slate-500' },
  { value: 'lamp', label: 'Lamp', Icon: Lightbulb, color: 'text-yellow-500' },
  { value: 'furniture', label: 'Furniture', Icon: Armchair, color: 'text-amber-600' },
  { value: 'it_equipment', label: 'IT Equipment', Icon: Monitor, color: 'text-purple-500' },
  { value: 'other', label: 'Other', Icon: Package, color: 'text-muted-foreground' },
];

interface AiScanResult {
  objectType: string;
  suggestedName: string;
  description?: string;
  confidence: number;
  category: string;
  suggestedSymbolId?: string | null;
  properties?: Record<string, string | null>;
}

interface BipSuggestion {
  code: string;
  title: string;
  usercode_syntax?: string;
  bsab_e?: string;
  aff?: string;
  confidence: number;
  reasoning?: string;
}

// Selected BIP classification
interface SelectedBip {
  code: string;
  title: string;
}

const InventoryForm: React.FC<InventoryFormProps> = ({ onSaved, onCancel, prefill, editItem, onClearEdit, onOpen360, onOpen3d, pendingPosition, onPendingPositionConsumed }) => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [isEditing, setIsEditing] = useState(false);

  // AI scan state
  const [isScanning, setIsScanning] = useState(false);
  const [aiResult, setAiResult] = useState<AiScanResult | null>(null);

  // BIP classify state
  const [isClassifying, setIsClassifying] = useState(false);
  const [bipSuggestions, setBipSuggestions] = useState<BipSuggestion[]>([]);
  const [selectedBip, setSelectedBip] = useState<SelectedBip | null>(null);

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

  // 360+ sync state
  const [isSyncing360, setIsSyncing360] = useState(false);
  const [ivionPoiId, setIvionPoiId] = useState<number | null>(null);

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

  // Handle pending position from inline 3D picker
  useEffect(() => {
    if (pendingPosition) {
      setCoordinates(pendingPosition);
      toast.success('Position selected!', {
        description: `X: ${pendingPosition.x.toFixed(2)}, Y: ${pendingPosition.y.toFixed(2)}, Z: ${pendingPosition.z.toFixed(2)}`,
      });
      if (onPendingPositionConsumed) {
        onPendingPositionConsumed();
      }
    }
  }, [pendingPosition, onPendingPositionConsumed]);

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
    setAiResult(null);
    setBipSuggestions([]);
    setSelectedBip(null);
  };

  // AI image recognition - calls mobile-ai-scan with the uploaded image
  const handleAiScan = useCallback(async () => {
    if (!imageUrl) {
      toast.error('Upload an image first');
      return;
    }
    setIsScanning(true);
    setAiResult(null);
    try {
      // Fetch image and convert to base64
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl);
        };
        reader.readAsDataURL(blob);
      });

      const { data, error: fnError } = await supabase.functions.invoke('mobile-ai-scan', {
        body: { imageBase64: base64 },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      const result = data as AiScanResult;
      setAiResult(result);

      // Auto-fill form fields
      if (result.suggestedName) setName(result.suggestedName);
      if (result.description) setDescription(result.description);
      if (result.suggestedSymbolId) setSymbolId(result.suggestedSymbolId);

      // Map AI category to form category
      const categoryMap: Record<string, string> = {
        fire_extinguisher: 'fire_extinguisher',
        fire_alarm_button: 'sensor',
        smoke_detector: 'sensor',
        fire_hose: 'fire_hose',
        electrical_panel: 'other',
        door: 'other',
        elevator: 'other',
        staircase: 'other',
        ventilation: 'hvac_unit',
        hvac_unit: 'hvac_unit',
        sprinkler: 'sprinkler',
        emergency_light: 'lamp',
        access_control: 'other',
      };
      const mappedCategory = categoryMap[result.objectType] || 'other';
      setCategory(mappedCategory);

      toast.success('AI identification complete', {
        description: `${result.suggestedName} (${Math.round(result.confidence * 100)}% confidence)`,
      });
    } catch (err: any) {
      console.error('[InventoryForm] AI scan failed:', err);
      if (err.message?.includes('429')) {
        toast.error('AI service temporarily overloaded, try again shortly');
      } else if (err.message?.includes('402')) {
        toast.error('AI credits exhausted');
      } else {
        toast.error('AI identification failed', { description: err.message });
      }
    } finally {
      setIsScanning(false);
    }
  }, [imageUrl]);

  // BIP classification
  const handleBipClassify = useCallback(async () => {
    if (!name.trim()) {
      toast.error('Enter a name before classifying');
      return;
    }
    setIsClassifying(true);
    setBipSuggestions([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('You must be logged in');
        return;
      }

      const { data, error: fnError } = await supabase.functions.invoke('bip-classify', {
        body: {
          assetName: name,
          assetType: category,
          category: category,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setBipSuggestions(data?.suggestions || []);
      if (!data?.suggestions?.length) {
        toast.info('No BIP matches found');
      } else {
        toast.success(`${data.suggestions.length} BIP suggestions found`);
      }
    } catch (err: any) {
      console.error('[InventoryForm] BIP classify failed:', err);
      toast.error('BIP classification failed', { description: err.message });
    } finally {
      setIsClassifying(false);
    }
  }, [name, category]);

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
    toast.success('Position selected!', {
      description: `X: ${coords.x.toFixed(2)}, Y: ${coords.y.toFixed(2)}, Z: ${coords.z.toFixed(2)}`,
    });
  };

  // Handler for opening Ivion 360
  const handleOpen360Internal = () => {
    const ivionUrl = localStorage.getItem('ivionApiUrl');
    const siteId = buildingSettings?.ivion_site_id;

    if (!ivionUrl && !siteId) {
      toast.error('Ivion not configured', {
        description: 'Set the Ivion Site ID for this building in building settings, and configure IVION_API_URL in Cloud secrets.',
      });
      return;
    }

    if (!siteId) {
      toast.error('No Ivion site linked', {
        description: 'Link the building to an Ivion site in building settings',
      });
      return;
    }

    // Use configured URL or default to swg.iv.navvis.com
    // FIX: Use /?site= query parameter format instead of /site/
    const baseUrl = ivionUrl || IVION_DEFAULT_BASE_URL;
    const fullUrl = `${baseUrl}/?site=${siteId}`;

    // If callback exists (desktop inline view), use it. Otherwise open in new tab.
    if (onOpen360) {
      onOpen360(fullUrl);
    } else {
      window.open(fullUrl, '_blank');
      toast.info('Ivion opened in new tab', {
        description: 'Long-press to create a POI, then sync back',
      });
    }
  };

  // Handler for syncing POIs from Ivion 360+
  const handleSync360 = async () => {
    if (!buildingSettings?.ivion_site_id || !buildingFmGuid) {
      toast.error('Ivion not configured for this building');
      return;
    }

    setIsSyncing360(true);
    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'import-pois',
          siteId: buildingSettings.ivion_site_id,
          buildingFmGuid: buildingFmGuid,
        },
      });

      if (error) throw error;

      if (data?.imported > 0) {
        toast.success(`Synced ${data.imported} new POIs from Ivion`, {
          description: `${data.skipped} already imported`,
        });
      } else if (data?.skipped > 0) {
        toast.info('No new POIs', {
          description: `${data.skipped} POIs already imported`,
        });
      } else {
        toast.info('No POIs found', {
          description: 'Create a POI in Ivion first (long-press in the panorama)',
        });
      }
    } catch (err: any) {
      console.error('Sync 360+ error:', err);
      toast.error('Could not sync from Ivion', {
        description: err.message,
      });
    } finally {
      setIsSyncing360(false);
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!category) {
      toast.error('Select a category');
      return;
    }
    if (!symbolId) {
      toast.error('Select a symbol');
      return;
    }
    if (!buildingFmGuid) {
      toast.error('Select a building');
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
              ...(aiResult?.properties ? Object.entries(aiResult.properties)
                .filter(([, val]) => val)
                .map(([key, val]) => ({ name: `AI_${key}`, value: val || '', dataType: 0 })) : []),
              ...(selectedBip ? [
                { name: 'BIP-code', value: selectedBip.code, dataType: 0 },
                { name: 'BIP-description', value: selectedBip.title, dataType: 0 },
              ] : []),
            ],
          },
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase
          .from('assets')
          .update(updateData)
          .eq('fm_guid', editingFmGuid);

        if (error) throw error;

        toast.success('Asset updated!');
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
              ...(aiResult?.properties ? Object.entries(aiResult.properties)
                .filter(([, val]) => val)
                .map(([key, val]) => ({ name: `AI_${key}`, value: val || '', dataType: 0 })) : []),
              ...(selectedBip ? [
                { name: 'BIP-code', value: selectedBip.code, dataType: 0 },
                { name: 'BIP-description', value: selectedBip.title, dataType: 0 },
              ] : []),
            ],
          },
        };

        const { error } = await supabase.from('assets').insert([newAsset]);

        if (error) throw error;

        toast.success('Asset saved!');
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
      toast.error('Could not save', {
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
            <span className="text-sm font-medium">Editing: {name || 'Asset'}</span>
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
            Cancel editing
          </Button>
        </div>
      )}

      {/* Name - large input */}
      <div className="space-y-2">
        <Label className="text-base">Name / Designation *</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Fire Extinguisher BS-001"
          className="h-12 text-base"
          autoFocus
          maxLength={100}
        />
      </div>

      {/* Category dropdown */}
      <div className="space-y-2">
        <Label className="text-base">Category *</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-12">
            <SelectValue placeholder="Select category..." />
          </SelectTrigger>
          <SelectContent className="bg-popover z-50">
            {INVENTORY_CATEGORIES.map((cat) => (
              <SelectItem key={cat.value} value={cat.value}>
                <span className="flex items-center gap-2">
                  <cat.Icon className={`h-4 w-4 ${cat.color}`} />
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
            <SelectValue placeholder="Select symbol..." />
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
        <div className="space-y-3">
          <Label className="text-base">Position (optional)</Label>
          
          {coordinates && (
            <div className="bg-muted/50 rounded-lg p-3 flex items-center justify-between">
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

          {/* 3D Position button - uses inline picker on desktop if available */}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (onOpen3d) {
                onOpen3d(buildingFmGuid, roomFmGuid || undefined);
              } else {
                // Fallback to dialog (mobile)
                setPositionDialogOpen(true);
              }
            }}
            className="w-full h-12"
          >
            <Crosshair className="h-4 w-4 mr-2" />
            <span className="text-xs sm:text-sm">
              {coordinates ? 'Change 3D position' : 'Select 3D position'}
            </span>
          </Button>

          {/* 360+ Section - always visible, enabled state depends on ivion_site_id */}
          <div className="border border-border rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Eye className={buildingSettings?.ivion_site_id ? "h-4 w-4 text-primary" : "h-4 w-4 text-muted-foreground"} />
              <span className="text-sm font-medium">360+ Position</span>
            </div>
            
            {buildingSettings?.ivion_site_id ? (
              <>
                {/* Primary: Ivion Inventory Mode - Full screen 360° registration */}
                <Button
                  type="button"
                  variant="default"
                  onClick={() => navigate(`/ivion-inventory?building=${buildingFmGuid}`)}
                  className="w-full h-14 text-base gap-3"
                >
                  <Camera className="h-5 w-5" />
                  Start inventory in 360°
                </Button>

                <div className="text-xs text-muted-foreground text-center pt-1">
                  or use manual sync:
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleOpen360Internal}
                    className="h-10"
                  >
                    <Eye className="h-4 w-4 mr-1.5" />
                    <span className="text-xs">Open 360+</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSync360}
                    disabled={isSyncing360}
                    className="h-10"
                  >
                    {isSyncing360 ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-1.5" />
                    )}
                    <span className="text-xs">Sync</span>
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-md flex items-center gap-2">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <span>360+ requires an Ivion Site ID to be configured in building settings.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image upload + AI Scan */}
      <ImageUpload
        value={imageUrl}
        onChange={(url) => {
          setImageUrl(url);
          setAiResult(null);
        }}
        disabled={isLoading}
      />

      {/* AI Identify button */}
      {imageUrl && (
        <Button
          type="button"
          variant="outline"
          onClick={handleAiScan}
          disabled={isScanning}
          className="w-full h-11 gap-2 border-primary/30 hover:bg-primary/5"
        >
          {isScanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" />
          )}
          {isScanning ? 'Identifying...' : 'AI Identify from image'}
        </Button>
      )}

      {/* AI Result display */}
      {aiResult && !isScanning && (
        <div className={`rounded-lg border p-3 space-y-2 ${aiResult.confidence >= 0.7 ? 'border-primary/30 bg-primary/5' : 'border-border bg-muted/30'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className={`h-4 w-4 ${aiResult.confidence >= 0.7 ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="font-semibold text-sm">{aiResult.suggestedName || aiResult.objectType}</span>
            </div>
            <Badge variant="secondary" className="text-xs">
              {Math.round(aiResult.confidence * 100)}%
            </Badge>
          </div>
          {aiResult.description && (
            <p className="text-xs text-muted-foreground">{aiResult.description}</p>
          )}
          {aiResult.properties && (
            <div className="flex flex-wrap gap-1">
              {Object.entries(aiResult.properties).map(([key, val]) => {
                if (!val) return null;
                return (
                  <Badge key={key} variant="outline" className="text-xs">
                    {key}: {val}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* BIP Classify button */}
      <Button
        type="button"
        variant="outline"
        onClick={handleBipClassify}
        disabled={isClassifying || !name.trim()}
        className="w-full h-11 gap-2"
      >
        {isClassifying ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <BookOpen className="h-4 w-4" />
        )}
        {isClassifying ? 'Classifying...' : 'Classify (BIP)'}
      </Button>

      {/* BIP suggestions */}
      {bipSuggestions.length > 0 && (
        <div className="rounded-lg border p-3 space-y-2">
          <span className="text-sm font-medium">BIP Suggestions</span>
          {bipSuggestions.map((s, i) => (
            <div key={i} className="bg-muted/30 rounded-md p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono font-medium">{s.code}</span>
                <Badge variant="secondary" className="text-xs">
                  {Math.round(s.confidence * 100)}%
                </Badge>
              </div>
              <p className="text-xs text-foreground">{s.title}</p>
              {s.usercode_syntax && <p className="text-xs text-muted-foreground">Syntax: {s.usercode_syntax}</p>}
              {s.bsab_e && <p className="text-xs text-muted-foreground">BSAB-E: {s.bsab_e}</p>}
              {s.reasoning && <p className="text-xs text-muted-foreground italic">{s.reasoning}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Description - expandable */}
      <div className="space-y-2">
        <Label className="text-base">Description (optional)</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Free text description..."
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
          {isEditing ? 'Cancel' : 'Clear'}
        </Button>
        <Button type="submit" className="flex-1 h-12" disabled={isLoading}>
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (isEditing ? 'Update' : 'Save')}
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
