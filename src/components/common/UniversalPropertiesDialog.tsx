import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  X, Pencil, Save, GripVertical, ChevronDown, ChevronUp, Loader2, 
  Building2, Layers, DoorOpen, Box, Database, Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

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
  section: 'system' | 'local' | 'area' | 'user-defined' | 'coordinates';
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Building': <Building2 className="h-4 w-4" />,
  'Building Storey': <Layers className="h-4 w-4" />,
  'Space': <DoorOpen className="h-4 w-4" />,
  'Instance': <Box className="h-4 w-4" />,
};

// Section labels in English
const SECTION_LABELS: Record<string, string> = {
  'system': 'System',
  'local': 'Local Settings',
  'coordinates': 'Position',
  'area': 'Area & Dimensions',
  'user-defined': 'User-Defined',
};

// Fields that belong to Area section
const AREA_FIELDS = ['nta', 'bra', 'bta', 'area', 'atemp', 'volym', 'omkrets', 'rumshöjd'];

const UniversalPropertiesDialog: React.FC<UniversalPropertiesDialogProps> = ({
  isOpen,
  onClose,
  fmGuid,
  category,
  onUpdate,
}) => {
  const isMobile = useIsMobile();
  const [asset, setAsset] = useState<any>(null);
  const [buildingSettings, setBuildingSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['system', 'local', 'area']));
  
  // Resize state (desktop only)
  const [size, setSize] = useState({ width: 400, height: 500 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  
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
        toast.error('Could not fetch data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen, fmGuid, category]);

  // Drag handlers (desktop only)
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile) return;
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position, isMobile]);

  useEffect(() => {
    if (!isDragging || isMobile) return;

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
  }, [isDragging, dragOffset, isMobile]);

  // Resize handlers (desktop only)
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    });
  }, [size, isMobile]);

  useEffect(() => {
    if (!isResizing || isMobile) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(320, Math.min(800, resizeStart.width + (e.clientX - resizeStart.x)));
      const newHeight = Math.max(300, Math.min(window.innerHeight - 100, resizeStart.height + (e.clientY - resizeStart.y)));
      setSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => setIsResizing(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeStart, isMobile]);

  // Parse all properties into a unified list
  const allProperties = useMemo((): PropertyItem[] => {
    if (!asset) return [];

    const props: PropertyItem[] = [];
    
    // System properties
    props.push({ key: 'fm_guid', label: 'FM GUID', value: asset.fm_guid, editable: false, source: 'lovable', type: 'text', section: 'system' });
    props.push({ key: 'category', label: 'Category', value: asset.category, editable: false, source: 'lovable', type: 'text', section: 'system' });
    if (asset.name) {
      props.push({ key: 'name', label: 'Name (IFC)', value: asset.name, editable: false, source: 'lovable', type: 'text', section: 'system' });
    }
    
    // Local editable properties
    props.push({ key: 'common_name', label: 'Display Name', value: asset.common_name, editable: true, source: 'lovable', type: 'text', section: 'local' });
    props.push({ key: 'asset_type', label: 'Asset Type', value: asset.asset_type, editable: true, source: 'lovable', type: 'text', section: 'local' });
    
    // Building settings
    if (buildingSettings || asset.category === 'Building') {
      props.push({ key: 'ivion_site_id', label: 'Ivion Site ID', value: buildingSettings?.ivion_site_id, editable: true, source: 'lovable', type: 'text', section: 'local' });
      props.push({ key: 'is_favorite', label: 'Favorite', value: buildingSettings?.is_favorite, editable: true, source: 'lovable', type: 'boolean', section: 'local' });
    }
    
    // Coordinates
    if (asset.coordinate_x !== null || asset.coordinate_y !== null || asset.coordinate_z !== null) {
      props.push({ key: 'coordinate_x', label: 'X', value: asset.coordinate_x, editable: true, source: 'lovable', type: 'number', section: 'coordinates' });
      props.push({ key: 'coordinate_y', label: 'Y', value: asset.coordinate_y, editable: true, source: 'lovable', type: 'number', section: 'coordinates' });
      props.push({ key: 'coordinate_z', label: 'Z', value: asset.coordinate_z, editable: true, source: 'lovable', type: 'number', section: 'coordinates' });
    }

    // Status flags
    props.push({ key: 'is_local', label: 'Locally Created', value: asset.is_local, editable: false, source: 'lovable', type: 'boolean', section: 'system' });
    props.push({ key: 'annotation_placed', label: 'Annotation Placed', value: asset.annotation_placed, editable: false, source: 'lovable', type: 'boolean', section: 'system' });

    // Hierarchy references
    if (asset.building_fm_guid) {
      props.push({ key: 'building_fm_guid', label: 'Building (GUID)', value: asset.building_fm_guid, editable: false, source: 'lovable', type: 'text', section: 'system' });
    }
    if (asset.level_fm_guid) {
      props.push({ key: 'level_fm_guid', label: 'Floor (GUID)', value: asset.level_fm_guid, editable: false, source: 'lovable', type: 'text', section: 'system' });
    }

    // Asset+ properties from attributes JSONB
    if (asset.attributes) {
      const attrs = asset.attributes as Record<string, any>;
      
      Object.entries(attrs).forEach(([key, value]) => {
        // Skip already-mapped system fields
        if (['fmGuid', 'category', 'objectType', 'tenantId', '_id'].includes(key)) return;
        
        let displayValue = value;
        let displayLabel = key;
        
        // Handle structured Asset+ values
        if (value && typeof value === 'object' && 'value' in value) {
          displayValue = value.value;
          displayLabel = value.name || key;
        }
        
        // Determine section
        const keyLower = key.toLowerCase();
        const isArea = AREA_FIELDS.some(f => keyLower.includes(f));
        
        props.push({
          key: `attr_${key}`,
          label: displayLabel,
          value: displayValue,
          editable: false,
          source: 'asset-plus',
          type: typeof displayValue === 'number' ? 'number' : 'text',
          section: isArea ? 'area' : 'user-defined',
        });
      });
    }

    return props;
  }, [asset, buildingSettings]);

  // Filter properties based on search
  const filteredProperties = useMemo(() => {
    if (!searchQuery.trim()) return allProperties;
    
    const q = searchQuery.toLowerCase();
    return allProperties.filter(p => 
      p.label.toLowerCase().includes(q) ||
      String(p.value ?? '').toLowerCase().includes(q)
    );
  }, [allProperties, searchQuery]);

  // Group properties by section
  const groupedProperties = useMemo(() => {
    const groups: Record<string, PropertyItem[]> = {};
    filteredProperties.forEach(prop => {
      if (!groups[prop.section]) {
        groups[prop.section] = [];
      }
      groups[prop.section].push(prop);
    });
    return groups;
  }, [filteredProperties]);

  const toggleSection = (section: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

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

      toast.success('Properties saved');
      setIsEditing(false);
      onUpdate?.();
    } catch (error: any) {
      toast.error('Error saving: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const displayCategory = asset?.category || category || 'Object';

  const renderPropertyValue = (prop: PropertyItem) => {
    const isEditingThis = isEditing && prop.editable;
    
    if (isEditingThis && prop.type === 'text') {
      return (
        <Input
          value={formData[prop.key] ?? prop.value ?? ''}
          onChange={(e) => setFormData({ ...formData, [prop.key]: e.target.value })}
          className="h-8 text-sm"
        />
      );
    }
    
    if (isEditingThis && prop.type === 'number') {
      return (
        <Input
          type="number"
          value={formData[prop.key] ?? prop.value ?? ''}
          onChange={(e) => setFormData({ ...formData, [prop.key]: parseFloat(e.target.value) || 0 })}
          className="h-8 text-sm"
        />
      );
    }
    
    if (prop.type === 'boolean') {
      return (
        <Badge variant={prop.value ? 'default' : 'secondary'} className="text-xs">
          {prop.value ? 'Yes' : 'No'}
        </Badge>
      );
    }
    
    // Default text display
    const displayValue = prop.value;
    if (displayValue === null || displayValue === undefined || displayValue === '') {
      return <span className="text-muted-foreground text-sm">—</span>;
    }
    
    if (typeof displayValue === 'number') {
      return <span className="text-sm font-mono">{displayValue.toLocaleString('en-US')}</span>;
    }
    
    return <span className="text-sm break-all">{String(displayValue)}</span>;
  };

  // Content shared between mobile and desktop
  const renderContent = () => (
    <>
      {/* Search field */}
      <div className="p-3 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search properties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !asset ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>No data found</p>
              <p className="text-xs mt-1 font-mono">{fmGuid}</p>
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>No properties match the search</p>
            </div>
          ) : (
            // Render sections
            ['system', 'local', 'coordinates', 'area', 'user-defined'].map(section => {
              const sectionProps = groupedProperties[section];
              if (!sectionProps || sectionProps.length === 0) return null;
              
              const isOpen = openSections.has(section);
              
              return (
                <Collapsible 
                  key={section}
                  open={isOpen}
                  onOpenChange={() => toggleSection(section)}
                >
                  <CollapsibleTrigger className="flex items-center justify-between w-full p-2 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5 rotate-180" />}
                      <span className="text-sm font-medium">{SECTION_LABELS[section]}</span>
                      <Badge variant="secondary" className="text-[10px]">{sectionProps.length}</Badge>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2 space-y-2">
                    {sectionProps.map(prop => (
                      <div 
                        key={prop.key} 
                        className={cn(
                          "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1.5 px-2 rounded",
                          prop.editable && "bg-accent/20"
                        )}
                      >
                        <Label className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                          {prop.label}
                          {prop.source === 'asset-plus' && (
                            <Badge variant="outline" className="text-[8px] px-1 py-0">A+</Badge>
                          )}
                        </Label>
                        <div className="flex-1 sm:text-right">
                          {renderPropertyValue(prop)}
                        </div>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer actions */}
      {asset && (
        <div className="p-3 border-t flex justify-end gap-2 shrink-0">
          {isEditing ? (
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
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
          )}
        </div>
      )}
    </>
  );

  if (!isOpen) return null;

  // Mobile: Use Sheet (bottom drawer)
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0">
          <SheetHeader className="p-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2 text-left">
              {CATEGORY_ICONS[displayCategory] || <Database className="h-4 w-4 shrink-0" />}
              <span className="font-medium text-sm truncate flex-1">
                {asset?.common_name || asset?.name || fmGuid.slice(0, 8)}
              </span>
              <Badge variant="outline" className="text-xs shrink-0">{displayCategory}</Badge>
            </SheetTitle>
          </SheetHeader>
          {renderContent()}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Floating dialog
  return (
    <div
      className={cn(
        "fixed z-50 bg-card border rounded-lg shadow-xl transition-all flex flex-col",
        "w-full max-w-[400px] max-h-[85vh]",
        "sm:max-w-none",
        isDragging && "cursor-grabbing opacity-90",
        isResizing && "select-none"
      )}
      style={{ 
        left: position.x, 
        top: position.y,
        width: size.width,
        height: !isCollapsed ? size.height : undefined,
      }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between p-3 border-b cursor-grab select-none bg-muted/30 shrink-0"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
          {CATEGORY_ICONS[displayCategory] || <Database className="h-4 w-4 shrink-0" />}
          <span className="font-medium text-sm truncate">
            {asset?.common_name || asset?.name || fmGuid.slice(0, 8)}
          </span>
          <Badge variant="outline" className="text-xs shrink-0">{displayCategory}</Badge>
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
          {renderContent()}

          {/* Resize handle - desktop only */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10"
            onMouseDown={handleResizeStart}
          >
            <svg className="w-3 h-3 absolute bottom-1 right-1 text-muted-foreground" viewBox="0 0 10 10">
              <path d="M0 10 L10 0 M4 10 L10 4 M7 10 L10 7" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
};

export default UniversalPropertiesDialog;
