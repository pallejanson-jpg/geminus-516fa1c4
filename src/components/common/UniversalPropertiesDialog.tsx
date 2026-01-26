import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  X, Pencil, Save, GripVertical, ChevronDown, ChevronUp, Loader2, 
  MapPin, Building2, Layers, DoorOpen, Box, Database, Settings
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface UniversalPropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fmGuid: string;
  category?: string;
  onUpdate?: () => void;
}

interface PropertyItem {
  key: string;
  label: string;
  value: any;
  editable: boolean;
  source: 'lovable' | 'asset-plus';
  type: 'text' | 'number' | 'boolean' | 'coordinates';
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Building': <Building2 className="h-4 w-4" />,
  'Building Storey': <Layers className="h-4 w-4" />,
  'Space': <DoorOpen className="h-4 w-4" />,
  'Instance': <Box className="h-4 w-4" />,
};

// Properties that are editable in Lovable
const LOVABLE_EDITABLE_FIELDS = [
  'common_name',
  'asset_type', 
  'symbol_id',
  'coordinate_x',
  'coordinate_y', 
  'coordinate_z',
  'annotation_placed',
];

// Fields to add for buildings (map position)
const BUILDING_EXTRA_FIELDS = [
  'ivion_site_id',
  'is_favorite',
  'map_latitude',
  'map_longitude',
];

const UniversalPropertiesDialog: React.FC<UniversalPropertiesDialogProps> = ({
  isOpen,
  onClose,
  fmGuid,
  category,
  onUpdate,
}) => {
  const [asset, setAsset] = useState<any>(null);
  const [buildingSettings, setBuildingSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('lovable');
  
  // Form data for editing
  const [formData, setFormData] = useState<Record<string, any>>({});

  // Fetch data
  useEffect(() => {
    if (!isOpen || !fmGuid) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch asset from local DB - case-insensitive search
        const { data: assetData, error: assetError } = await supabase
          .from('assets')
          .select('*')
          .or(`fm_guid.eq.${fmGuid},fm_guid.eq.${fmGuid.toLowerCase()},fm_guid.eq.${fmGuid.toUpperCase()}`)
          .maybeSingle();

        if (assetError) throw assetError;
        setAsset(assetData);

        // If it's a building, also fetch building_settings
        if (assetData?.category === 'Building' || category === 'Building') {
          const { data: settingsData } = await supabase
            .from('building_settings')
            .select('*')
            .eq('fm_guid', fmGuid)
            .maybeSingle();
          
          setBuildingSettings(settingsData);
        }

        // Initialize form data
        if (assetData) {
          setFormData({
            common_name: assetData.common_name || '',
            asset_type: assetData.asset_type || '',
            coordinate_x: assetData.coordinate_x ?? '',
            coordinate_y: assetData.coordinate_y ?? '',
            coordinate_z: assetData.coordinate_z ?? '',
          });
        }
      } catch (error: any) {
        console.error('Failed to fetch data:', error);
        toast.error('Kunde inte hämta data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen, fmGuid, category]);

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
        x: Math.max(0, Math.min(window.innerWidth - 420, e.clientX - dragOffset.x)),
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

  // Parse Lovable properties
  const lovableProperties = useMemo((): PropertyItem[] => {
    if (!asset) return [];

    const props: PropertyItem[] = [];
    
    // System properties
    props.push({ key: 'fm_guid', label: 'FM GUID', value: asset.fm_guid, editable: false, source: 'lovable', type: 'text' });
    props.push({ key: 'name', label: 'Name', value: asset.name, editable: false, source: 'lovable', type: 'text' });
    props.push({ key: 'common_name', label: 'Common Name', value: asset.common_name, editable: true, source: 'lovable', type: 'text' });
    props.push({ key: 'category', label: 'Category', value: asset.category, editable: false, source: 'lovable', type: 'text' });
    props.push({ key: 'asset_type', label: 'Asset Type', value: asset.asset_type, editable: true, source: 'lovable', type: 'text' });
    
    // Hierarchy
    if (asset.building_fm_guid) {
      props.push({ key: 'building_fm_guid', label: 'Building FM GUID', value: asset.building_fm_guid, editable: false, source: 'lovable', type: 'text' });
    }
    if (asset.level_fm_guid) {
      props.push({ key: 'level_fm_guid', label: 'Level FM GUID', value: asset.level_fm_guid, editable: false, source: 'lovable', type: 'text' });
    }
    if (asset.in_room_fm_guid) {
      props.push({ key: 'in_room_fm_guid', label: 'In Room FM GUID', value: asset.in_room_fm_guid, editable: false, source: 'lovable', type: 'text' });
    }

    // Coordinates
    if (asset.coordinate_x !== null || asset.coordinate_y !== null) {
      props.push({ key: 'coordinates', label: 'Position (3D)', value: `${asset.coordinate_x?.toFixed(2)}, ${asset.coordinate_y?.toFixed(2)}, ${asset.coordinate_z?.toFixed(2)}`, editable: true, source: 'lovable', type: 'coordinates' });
    }

    // Status flags
    props.push({ key: 'is_local', label: 'Is Local', value: asset.is_local, editable: false, source: 'lovable', type: 'boolean' });
    props.push({ key: 'annotation_placed', label: 'Annotation Placed', value: asset.annotation_placed, editable: false, source: 'lovable', type: 'boolean' });

    // Building settings
    if (buildingSettings) {
      props.push({ key: 'ivion_site_id', label: 'Ivion Site ID', value: buildingSettings.ivion_site_id, editable: true, source: 'lovable', type: 'text' });
      props.push({ key: 'is_favorite', label: 'Favorite', value: buildingSettings.is_favorite, editable: true, source: 'lovable', type: 'boolean' });
    }

    return props;
  }, [asset, buildingSettings]);

  // Parse Asset+ properties from attributes JSONB
  const assetPlusProperties = useMemo((): PropertyItem[] => {
    if (!asset?.attributes) return [];
    
    const attrs = asset.attributes as Record<string, any>;
    const props: PropertyItem[] = [];

    Object.entries(attrs).forEach(([key, value]) => {
      // Check if it's a structured Asset+ value
      if (value && typeof value === 'object' && ('value' in value || '_type' in value)) {
        props.push({
          key,
          label: key,
          value: value.value ?? value,
          editable: false,
          source: 'asset-plus',
          type: 'text',
        });
      } else {
        props.push({
          key,
          label: key,
          value: value,
          editable: false,
          source: 'asset-plus',
          type: typeof value === 'number' ? 'number' : 'text',
        });
      }
    });

    return props.sort((a, b) => a.label.localeCompare(b.label));
  }, [asset]);

  const handleSave = async () => {
    if (!asset) return;
    setIsSaving(true);

    try {
      // Update asset table
      const updatePayload: Record<string, any> = {};
      if (formData.common_name !== asset.common_name) {
        updatePayload.common_name = formData.common_name || null;
      }
      if (formData.asset_type !== asset.asset_type) {
        updatePayload.asset_type = formData.asset_type || null;
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error } = await supabase
          .from('assets')
          .update(updatePayload)
          .eq('fm_guid', asset.fm_guid);

        if (error) throw error;
      }

      // Update building_settings if applicable
      if (asset.category === 'Building' && formData.ivion_site_id !== undefined) {
        const settingsPayload = {
          fm_guid: asset.fm_guid,
          ivion_site_id: formData.ivion_site_id || null,
          is_favorite: formData.is_favorite ?? false,
        };

        const { error: settingsError } = await supabase
          .from('building_settings')
          .upsert(settingsPayload, { onConflict: 'fm_guid' });

        if (settingsError) throw settingsError;
      }

      toast.success('Egenskaper sparade');
      setIsEditing(false);
      onUpdate?.();
    } catch (error: any) {
      toast.error('Fel vid sparning: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const displayCategory = asset?.category || category || 'Object';

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed z-50 bg-card border rounded-lg shadow-xl transition-all",
        "w-[400px] max-h-[85vh] flex flex-col",
        isDragging && "cursor-grabbing opacity-90"
      )}
      style={{ left: position.x, top: position.y }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between p-3 border-b cursor-grab select-none bg-muted/30"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          {CATEGORY_ICONS[displayCategory] || <Database className="h-4 w-4" />}
          <span className="font-medium text-sm truncate max-w-[200px]">
            {asset?.common_name || asset?.name || fmGuid.slice(0, 8)}
          </span>
          <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
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
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="grid w-full grid-cols-2 m-2 mb-0 h-8">
              <TabsTrigger value="lovable" className="text-xs gap-1">
                <Settings className="h-3 w-3" />
                Lovable
              </TabsTrigger>
              <TabsTrigger value="asset-plus" className="text-xs gap-1">
                <Database className="h-3 w-3" />
                Asset+ ({assetPlusProperties.length})
              </TabsTrigger>
            </TabsList>

            {/* Content */}
            <ScrollArea className="flex-1 p-3">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !asset ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <p>Ingen data hittad</p>
                  <p className="text-xs mt-1 font-mono">{fmGuid}</p>
                </div>
              ) : (
                <>
                  <TabsContent value="lovable" className="mt-0 space-y-2">
                    {lovableProperties.map((prop) => (
                      <div key={prop.key} className="space-y-1">
                        <Label className="text-xs text-muted-foreground flex items-center gap-1">
                          {prop.label}
                          {prop.editable && <span className="text-primary text-[10px]">(redigerbar)</span>}
                        </Label>
                        {isEditing && prop.editable && prop.type === 'text' ? (
                          <Input
                            value={formData[prop.key] ?? prop.value ?? ''}
                            onChange={(e) => setFormData({ ...formData, [prop.key]: e.target.value })}
                            className="h-8 text-sm"
                          />
                        ) : prop.type === 'boolean' ? (
                          <Badge variant={prop.value ? 'default' : 'secondary'} className="text-xs">
                            {prop.value ? 'Ja' : 'Nej'}
                          </Badge>
                        ) : (
                          <p className="text-sm font-mono break-all">{prop.value ?? '-'}</p>
                        )}
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="asset-plus" className="mt-0 space-y-2">
                    {assetPlusProperties.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <p>Inga Asset+ egenskaper</p>
                        <p className="text-xs mt-1">Synka objektet för att hämta data</p>
                      </div>
                    ) : (
                      assetPlusProperties.map((prop) => (
                        <div key={prop.key} className="space-y-1">
                          <Label className="text-xs text-muted-foreground">{prop.label}</Label>
                          <p className="text-sm break-all">
                            {typeof prop.value === 'object' ? JSON.stringify(prop.value) : String(prop.value ?? '-')}
                          </p>
                        </div>
                      ))
                    )}
                  </TabsContent>
                </>
              )}
            </ScrollArea>
          </Tabs>

          {/* Footer actions */}
          {asset && (
            <div className="p-3 border-t flex justify-end gap-2">
              {isEditing ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
                    Avbryt
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    Spara
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Pencil className="h-4 w-4 mr-1" />
                  Redigera
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default UniversalPropertiesDialog;
