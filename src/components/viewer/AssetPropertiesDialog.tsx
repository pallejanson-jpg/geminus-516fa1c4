import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Pencil, Save, GripVertical, ChevronDown, ChevronUp, Loader2, Plus, MapPin, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Asset type options for dropdown
const ASSET_TYPES = [
  { value: 'fire_extinguisher', label: 'Fire Extinguisher' },
  { value: 'chair', label: 'Chair' },
  { value: 'table', label: 'Table' },
  { value: 'hvac', label: 'HVAC Unit' },
  { value: 'sprinkler', label: 'Sprinkler' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'lamp', label: 'Lamp' },
  { value: 'cabinet', label: 'Cabinet' },
  { value: 'other', label: 'Other' },
];

// IFC Object categories (mandatory for Asset+)
const OBJECT_CATEGORIES = [
  { value: 'Instance', label: 'Instance (Inventory)' },
  { value: 'IfcFurniture', label: 'Furniture' },
  { value: 'IfcBuildingElementProxy', label: 'Building Element' },
  { value: 'IfcFlowTerminal', label: 'Flow Terminal' },
  { value: 'IfcFireSuppressionTerminal', label: 'Fire Suppression' },
  { value: 'IfcSensor', label: 'Sensor' },
];

interface AssetProperties {
  id: string;
  fm_guid: string;
  name: string | null;
  common_name: string | null;
  category: string;
  building_fm_guid: string | null;
  level_fm_guid: string | null;
  in_room_fm_guid: string | null;
  asset_type: string | null;
  gross_area: number | null;
  symbol_id: string | null;
  coordinate_x: number | null;
  coordinate_y: number | null;
  coordinate_z: number | null;
  is_local: boolean;
  created_in_model: boolean | null;
  annotation_placed: boolean | null;
  attributes: Record<string, any>;
}

interface AnnotationSymbol {
  id: string;
  name: string;
  category: string;
  color: string;
  icon_url: string | null;
}

interface AssetPropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFmGuids: string[];
  onUpdate?: () => void;
  // Create mode props
  createMode?: boolean;
  parentSpaceFmGuid?: string | null;
  buildingFmGuid?: string | null;
  levelFmGuid?: string | null;
  initialCoordinates?: { x: number; y: number; z: number } | null;
  onPickCoordinates?: () => void;
  isPickingCoordinates?: boolean;
  /** Viewer ref for BIM metadata fallback when asset not in database */
  viewerRef?: React.MutableRefObject<any>;
}

const AssetPropertiesDialog: React.FC<AssetPropertiesDialogProps> = ({
  isOpen,
  onClose,
  selectedFmGuids,
  onUpdate,
  createMode = false,
  parentSpaceFmGuid,
  buildingFmGuid,
  levelFmGuid,
  initialCoordinates,
  onPickCoordinates,
  isPickingCoordinates,
  viewerRef,
}) => {
  const [assets, setAssets] = useState<AssetProperties[]>([]);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(createMode);
  const [isSaving, setIsSaving] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // Form data for editing/creating
  const [formData, setFormData] = useState({
    fm_guid: '',
    name: '',
    common_name: '',
    category: 'Instance',
    asset_type: '',
    symbol_id: '',
    coordinate_x: 0,
    coordinate_y: 0,
    coordinate_z: 0,
  });

  const isMultiSelect = selectedFmGuids.length > 1;

  // Initialize form for create mode
  useEffect(() => {
    if (createMode && isOpen) {
      setFormData({
        fm_guid: crypto.randomUUID(),
        name: '',
        common_name: '',
        category: 'Instance',
        asset_type: '',
        symbol_id: '',
        coordinate_x: initialCoordinates?.x ?? 0,
        coordinate_y: initialCoordinates?.y ?? 0,
        coordinate_z: initialCoordinates?.z ?? 0,
      });
      setIsEditing(true);
      setIsLoading(false);
    }
  }, [createMode, isOpen, initialCoordinates]);

  // Update coordinates when picked
  useEffect(() => {
    if (initialCoordinates) {
      setFormData(prev => ({
        ...prev,
        coordinate_x: initialCoordinates.x,
        coordinate_y: initialCoordinates.y,
        coordinate_z: initialCoordinates.z,
      }));
    }
  }, [initialCoordinates]);

  // Fetch assets and symbols
  useEffect(() => {
    if (!isOpen) return;
    if (createMode) {
      // Just fetch symbols in create mode
      supabase.from('annotation_symbols').select('id, name, category, color, icon_url').order('name')
        .then(({ data }) => setSymbols(data || []));
      return;
    }
    if (selectedFmGuids.length === 0) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Try both uppercase and original case to handle different fmGuid formats
        const guidsToSearch = [
          ...selectedFmGuids,
          ...selectedFmGuids.map(g => g.toUpperCase()),
          ...selectedFmGuids.map(g => g.toLowerCase()),
        ];
        const uniqueGuids = [...new Set(guidsToSearch)];
        
        const [assetsRes, symbolsRes] = await Promise.all([
          supabase
            .from('assets')
            .select('*')
            .in('fm_guid', uniqueGuids),
          supabase.from('annotation_symbols').select('id, name, category, color, icon_url').order('name'),
        ]);

        if (assetsRes.error) throw assetsRes.error;
        if (symbolsRes.error) throw symbolsRes.error;

        const fetchedAssets = assetsRes.data as AssetProperties[] || [];
        setAssets(fetchedAssets);
        setSymbols(symbolsRes.data as AnnotationSymbol[] || []);
        
        // Populate form for single asset edit
        if (fetchedAssets.length === 1) {
          const a = fetchedAssets[0];
          setFormData({
            fm_guid: a.fm_guid,
            name: a.name || '',
            common_name: a.common_name || '',
            category: a.category,
            asset_type: a.asset_type || '',
            symbol_id: a.symbol_id || '',
            coordinate_x: a.coordinate_x ?? 0,
            coordinate_y: a.coordinate_y ?? 0,
            coordinate_z: a.coordinate_z ?? 0,
          });
        }
      } catch (error: any) {
        toast.error('Failed to fetch data: ' + error.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen, selectedFmGuids, createMode]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 340, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleStartEdit = () => {
    if (isMultiSelect) {
      setFormData(prev => ({ ...prev, symbol_id: assets[0]?.symbol_id || '' }));
    }
    setIsEditing(true);
  };

  const handleCreate = async () => {
    // Validation
    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!formData.category) {
      toast.error('Category is required');
      return;
    }
    if (!initialCoordinates && formData.coordinate_x === 0 && formData.coordinate_y === 0) {
      toast.error('Select a position in the 3D view first');
      return;
    }

    setIsSaving(true);
    try {
      const assetTypeLabel = ASSET_TYPES.find(t => t.value === formData.asset_type)?.label || formData.asset_type;

      // Insert locally first
      const { error: localError } = await supabase.from('assets').insert({
        fm_guid: formData.fm_guid,
        name: formData.name.trim(),
        common_name: assetTypeLabel || formData.common_name || null,
        category: formData.category,
        asset_type: formData.asset_type || null,
        symbol_id: formData.symbol_id || null,
        building_fm_guid: buildingFmGuid || null,
        level_fm_guid: levelFmGuid || null,
        in_room_fm_guid: parentSpaceFmGuid || null,
        coordinate_x: formData.coordinate_x,
        coordinate_y: formData.coordinate_y,
        coordinate_z: formData.coordinate_z,
        is_local: true,
        created_in_model: true,
        annotation_placed: true,
      });

      if (localError) throw localError;

      // Also try to create in Asset+ via edge function
      try {
        await supabase.functions.invoke('asset-plus-create', {
          body: {
            fmGuid: formData.fm_guid,
            parentSpaceFmGuid: parentSpaceFmGuid,
            designation: formData.name.trim(),
            commonName: assetTypeLabel || undefined,
            properties: [
              ...(formData.asset_type ? [{ name: 'AssetType', value: formData.asset_type, dataType: 0 }] : []),
              ...(formData.category ? [{ name: 'ObjectCategory', value: formData.category, dataType: 0 }] : []),
            ],
            coordinates: {
              x: formData.coordinate_x,
              y: formData.coordinate_y,
              z: formData.coordinate_z,
            },
          },
        });
      } catch (apiError) {
        console.warn('Failed to sync to Asset+:', apiError);
        // Continue anyway - local save succeeded
      }

      toast.success('Asset created!', {
        description: formData.name,
      });

      onUpdate?.();
      onClose();
    } catch (error: any) {
      toast.error('Error creating asset: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (createMode) {
      return handleCreate();
    }

    if (assets.length === 0) return;
    setIsSaving(true);

    try {
      const updatePayload: Record<string, any> = {};
      
      if (formData.symbol_id !== undefined) {
        updatePayload.symbol_id = formData.symbol_id || null;
      }
      if (!isMultiSelect) {
        if (formData.name !== undefined) updatePayload.name = formData.name || null;
        if (formData.common_name !== undefined) updatePayload.common_name = formData.common_name || null;
        if (formData.asset_type !== undefined) updatePayload.asset_type = formData.asset_type || null;
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error } = await supabase
          .from('assets')
          .update(updatePayload)
          .in('fm_guid', assets.map(a => a.fm_guid));

        if (error) throw error;

        toast.success(isMultiSelect 
          ? `Updated ${assets.length} assets` 
          : 'Properties saved');
        onUpdate?.();
      }

      setIsEditing(false);
    } catch (error: any) {
      toast.error('Error saving: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedSymbol = useMemo(() => 
    symbols.find(s => s.id === formData.symbol_id),
    [symbols, formData.symbol_id]
  );

  const hasCoordinates = (initialCoordinates || (formData.coordinate_x !== 0 || formData.coordinate_y !== 0));

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed z-50 border border-border/30 rounded-lg shadow-xl transition-all",
        // Semi-transparent backdrop for better 3D visibility
        "bg-card/80 backdrop-blur-md",
        "w-80 sm:w-96 max-h-[80vh] flex flex-col",
        isDragging && "cursor-grabbing opacity-90"
      )}
      style={{ left: position.x, top: position.y }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between p-3 border-b cursor-grab select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {createMode ? 'Create new asset' : 'Properties'}
            {isMultiSelect && !createMode && <Badge variant="secondary" className="ml-1">{assets.length}</Badge>}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsCollapsed(!isCollapsed)}>
            {isCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Content */}
          <ScrollArea className="flex-1 p-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : createMode ? (
              /* Create mode form */
              <div className="space-y-4">
                {/* Position picker */}
                <div className="space-y-2">
                  <Label className="text-xs font-medium">Position in 3D *</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={isPickingCoordinates ? "default" : hasCoordinates ? "secondary" : "outline"}
                      className="flex-1 gap-2 h-9"
                      onClick={onPickCoordinates}
                      disabled={isSaving}
                    >
                      <MapPin className="h-4 w-4" />
                      {isPickingCoordinates ? 'Click in 3D...' : hasCoordinates ? 'Change' : 'Pick position'}
                    </Button>
                    {hasCoordinates && (
                      <div className="flex items-center gap-1 px-2 bg-muted rounded text-xs">
                        <Check className="h-3 w-3 text-green-500" />
                        <span className="font-mono">
                          {formData.coordinate_x.toFixed(1)}, {formData.coordinate_y.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <Separator />

                {/* FM GUID (auto-generated, read-only) */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">FM GUID (auto)</Label>
                  <p className="text-xs font-mono text-muted-foreground truncate">{formData.fm_guid}</p>
                </div>

                {/* Name/Designation - Required */}
                <div className="space-y-1">
                  <Label className="text-xs">Name / Number *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. BS-001, Chair-A1"
                    className="h-9"
                    required
                  />
                </div>

                {/* Category - Required */}
                <div className="space-y-1">
                  <Label className="text-xs">Category *</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(v) => setFormData({ ...formData, category: v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-card border shadow-lg z-[100]">
                      {OBJECT_CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Asset Type */}
                <div className="space-y-1">
                  <Label className="text-xs">Asset type</Label>
                  <Select
                    value={formData.asset_type}
                    onValueChange={(v) => setFormData({ ...formData, asset_type: v })}
                  >
                    <SelectTrigger className="h-9">
                       <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border shadow-lg z-[100]">
                      {ASSET_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Symbol selection */}
                <div className="space-y-1">
                  <Label className="text-xs">Annotation symbol</Label>
                  <Select
                    value={formData.symbol_id}
                    onValueChange={(v) => setFormData({ ...formData, symbol_id: v })}
                  >
                    <SelectTrigger className="h-9">
                       <SelectValue placeholder="Select symbol..." />
                    </SelectTrigger>
                    <SelectContent className="bg-card border shadow-lg z-[100]">
                       <SelectItem value="">No symbol</SelectItem>
                      {symbols.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          <div className="flex items-center gap-2">
                            {s.icon_url ? (
                              <img src={s.icon_url} alt="" className="w-4 h-4 rounded" />
                            ) : (
                              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
                            )}
                            <span>{s.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Info about mandatory fields */}
                 <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                   <p className="font-medium">Required fields for Asset+:</p>
                   <ul className="list-disc list-inside mt-1">
                     <li>FM GUID (auto-generated)</li>
                     <li>Name</li>
                     <li>Category</li>
                     <li>Position (coordinates)</li>
                   </ul>
                 </div>
              </div>
            ) : assets.length === 0 ? (
              /* Fallback: show BIM metadata from xeokit metaScene */
              (() => {
                const xeokitViewer = viewerRef?.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
                const guid = selectedFmGuids[0];
                // Try to find by originalSystemId or by entity ID
                let metaObj: any = null;
                if (xeokitViewer?.metaScene?.metaObjects) {
                  const metaObjects = xeokitViewer.metaScene.metaObjects;
                  // Direct lookup by ID
                  metaObj = metaObjects[guid];
                  // Search by originalSystemId if not found
                  if (!metaObj) {
                    const guidLower = guid?.toLowerCase();
                    const guidUpper = guid?.toUpperCase();
                    metaObj = Object.values(metaObjects).find((mo: any) => {
                      const osid = mo.originalSystemId;
                      return osid && (osid === guid || osid === guidLower || osid === guidUpper);
                    });
                  }
                }
                if (metaObj) {
                  // Gather property sets from metaObject
                  const propertySets = metaObj.propertySets || [];
                  return (
                    <div className="space-y-3">
                      <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                        BIM metadata (not synced to database)
                      </div>
                      <div className="space-y-1">
                         <Label className="text-xs text-muted-foreground">Name</Label>
                        <p className="text-sm">{metaObj.name || '-'}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Type (IFC)</Label>
                        <p className="text-sm">{metaObj.type || '-'}</p>
                      </div>
                      {metaObj.originalSystemId && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">FM GUID</Label>
                          <p className="text-xs font-mono break-all">{metaObj.originalSystemId}</p>
                        </div>
                      )}
                      {metaObj.parent && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Parent</Label>
                          <p className="text-sm">{metaObj.parent.name || metaObj.parent.type || '-'}</p>
                        </div>
                      )}
                      {propertySets.length > 0 && propertySets.map((ps: any, idx: number) => (
                        <div key={idx} className="space-y-1">
                          <Label className="text-xs text-muted-foreground font-medium">{ps.name || `Properties ${idx + 1}`}</Label>
                          {(ps.properties || []).map((prop: any, pidx: number) => (
                            <div key={pidx} className="flex justify-between text-xs">
                              <span className="text-muted-foreground">{prop.name}</span>
                              <span className="text-foreground font-mono truncate ml-2 max-w-[180px]">{String(prop.value ?? '-')}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                   <div className="text-center py-8 text-muted-foreground text-sm">
                     <p>No asset found in database</p>
                     <p className="text-xs mt-1">The object may not be synced yet</p>
                   </div>
                );
              })()
            ) : isMultiSelect ? (
              /* Multi-select view */
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  {assets.length} objects selected
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs">Shared symbol</Label>
                  {isEditing ? (
                    <Select
                      value={formData.symbol_id}
                      onValueChange={(v) => setFormData({ ...formData, symbol_id: v })}
                    >
                      <SelectTrigger className="h-9">
                         <SelectValue placeholder="Select symbol..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border shadow-lg z-[100]">
                         <SelectItem value="">No symbol</SelectItem>
                        {symbols.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <div className="flex items-center gap-2">
                              {s.icon_url ? (
                                <img src={s.icon_url} alt="" className="w-4 h-4 rounded" />
                              ) : (
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
                              )}
                              <span>{s.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                      {selectedSymbol ? (
                        <>
                          {selectedSymbol.icon_url ? (
                            <img src={selectedSymbol.icon_url} alt="" className="w-5 h-5 rounded" />
                          ) : (
                            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: selectedSymbol.color }} />
                          )}
                          <span>{selectedSymbol.name}</span>
                        </>
                      ) : (
                         <span className="text-muted-foreground">No symbol</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Single asset view */
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">FM GUID</Label>
                  <p className="text-xs font-mono break-all">{assets[0].fm_guid}</p>
                </div>

                <Separator />

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Name</Label>
                  {isEditing ? (
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="h-8 text-sm"
                    />
                  ) : (
                    <p className="text-sm">{assets[0].name || '-'}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Common Name</Label>
                  {isEditing ? (
                    <Input
                      value={formData.common_name}
                      onChange={(e) => setFormData({ ...formData, common_name: e.target.value })}
                      className="h-8 text-sm"
                    />
                  ) : (
                    <p className="text-sm">{assets[0].common_name || '-'}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Category</Label>
                  <Badge variant="outline">{assets[0].category}</Badge>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Asset Type</Label>
                  {isEditing ? (
                    <Select
                      value={formData.asset_type}
                      onValueChange={(v) => setFormData({ ...formData, asset_type: v })}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border shadow-lg z-[100]">
                        {ASSET_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm">{assets[0].asset_type || '-'}</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Annotation symbol</Label>
                  {isEditing ? (
                    <Select
                      value={formData.symbol_id}
                      onValueChange={(v) => setFormData({ ...formData, symbol_id: v })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select symbol..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border shadow-lg z-[100]">
                        <SelectItem value="">No symbol</SelectItem>
                        {symbols.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <div className="flex items-center gap-2">
                              {s.icon_url ? (
                                <img src={s.icon_url} alt="" className="w-4 h-4 rounded" />
                              ) : (
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
                              )}
                              <span>{s.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                      {selectedSymbol ? (
                        <>
                          {selectedSymbol.icon_url ? (
                            <img src={selectedSymbol.icon_url} alt="" className="w-5 h-5 rounded" />
                          ) : (
                            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: selectedSymbol.color }} />
                          )}
                          <span>{selectedSymbol.name}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No symbol</span>
                      )}
                    </div>
                  )}
                </div>

                {assets[0].coordinate_x !== null && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Coordinates</Label>
                      <p className="text-xs font-mono">
                        X: {assets[0].coordinate_x?.toFixed(2)}, 
                        Y: {assets[0].coordinate_y?.toFixed(2)}, 
                        Z: {assets[0].coordinate_z?.toFixed(2)}
                      </p>
                    </div>
                  </>
                )}

                <Separator />
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                   {assets[0].is_local && <Badge variant="secondary">Local</Badge>}
                   {assets[0].annotation_placed && <Badge variant="secondary">Placed</Badge>}
                </div>
              </div>
            )}
          </ScrollArea>

          {/* Footer actions */}
          <div className="p-3 border-t flex justify-end gap-2">
            {createMode ? (
              <>
                 <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
                   Cancel
                 </Button>
                 <Button size="sm" onClick={handleSave} disabled={isSaving || !hasCoordinates}>
                   {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                   Create
                </Button>
              </>
            ) : assets.length > 0 && (
              isEditing ? (
                <>
                   <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
                     Cancel
                   </Button>
                   <Button size="sm" onClick={handleSave} disabled={isSaving}>
                     {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                     Save
                   </Button>
                </>
              ) : (
                 <Button variant="outline" size="sm" onClick={handleStartEdit}>
                   <Pencil className="h-4 w-4 mr-1" />
                   Edit
                </Button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AssetPropertiesDialog;
