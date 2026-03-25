import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  ArrowLeft, Pencil, Save, ChevronDown, ChevronUp, Loader2, 
  Building2, Layers, DoorOpen, Box, Database, Search, AlertCircle, Cloud,
  Trash2, Upload, CloudOff, Tag, Check, Sparkles, X, Pin, PinOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { updateAssetProperties, UpdatePropertyItem, deleteAssets, syncAssetToAssetPlus } from '@/services/asset-plus-service';
import { pushAssetToFmAccess, pushPropertyChangesToFmAccess, deleteFmAccessObject } from '@/services/fm-access-service';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface UniversalPropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fmGuids: string | string[];  // Support both single GUID and array
  category?: string;
  onUpdate?: () => void;
  /** BIM entity ID from the viewer (for fallback metadata display) */
  entityId?: string;
  /** Whether the dialog is pinned (stays open and updates on selection change) */
  isPinned?: boolean;
  onPinToggle?: () => void;
  /** When true, renders as inline flex sibling instead of fixed overlay (for viewer integration) */
  inline?: boolean;
}

interface PropertyItem {
  key: string;
  label: string;
  value: any;
  editable: boolean;
  source: 'lovable' | 'asset-plus';
  type: 'text' | 'number' | 'boolean' | 'coordinates';
  section: 'system' | 'geminus' | 'local' | 'area' | 'user-defined' | 'coordinates' | 'classification';
  isDifferent?: boolean;
  differentCount?: number;
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

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  'Building': <Building2 className="h-4 w-4" />,
  'Building Storey': <Layers className="h-4 w-4" />,
  'Space': <DoorOpen className="h-4 w-4" />,
  'Instance': <Box className="h-4 w-4" />,
};

// Section labels in English
const SECTION_LABELS: Record<string, string> = {
  'geminus': 'Geminus Properties',
  'system': 'System',
  'local': 'Local Settings',
  'coordinates': 'Position',
  'area': 'Area & Dimensions',
  'classification': 'Classification (BIP)',
  'user-defined': 'User-Defined',
};

// GUID regex for detecting 128-bit GUIDs in values
const GUID_VALUE_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Fields that belong to Area section
const AREA_FIELDS = ['nta', 'bra', 'bta', 'area', 'atemp', 'volym', 'omkrets', 'rumshöjd'];

// Editable fields
const EDITABLE_KEYS = ['common_name', 'asset_type', 'coordinate_x', 'coordinate_y', 'coordinate_z', 'ivion_site_id', 'is_favorite'];

const UniversalPropertiesDialog: React.FC<UniversalPropertiesDialogProps> = ({
  isOpen,
  onClose,
  fmGuids: fmGuidsProp,
  category,
  onUpdate,
  entityId,
  isPinned = false,
  onPinToggle,
  inline = false,
}) => {
  const isMobile = useIsMobile();
  
  // Normalize fmGuids to always be an array
  const fmGuids = useMemo(() => 
    Array.isArray(fmGuidsProp) ? fmGuidsProp : [fmGuidsProp],
    [fmGuidsProp]
  );
  
  const isMultiMode = fmGuids.length > 1;
  
  const [assets, setAssets] = useState<any[]>([]);
  const [buildingSettings, setBuildingSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // On mobile, only open 'local' by default to save space
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(isMobile ? ['geminus'] : ['system', 'geminus', 'area', 'user-defined'])
  );
  
  // Resize state (desktop only)
  const [size, setSize] = useState({ width: 400, height: 500 });
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  
  // Delete/Push state
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPushingFma, setIsPushingFma] = useState(false);
  
  // Form data for editing
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  // BIP classification state
  const [isClassifying, setIsClassifying] = useState(false);
  const [bipSuggestions, setBipSuggestions] = useState<BipSuggestion[]>([]);
  const [bipApplied, setBipApplied] = useState<string | null>(null);

  // BIM fallback metadata state
  const [bimFallbackData, setBimFallbackData] = useState<Record<string, string> | null>(null);

  // Helper to build BIM fallback from metaObject
  const setBimFallbackFromMeta = useCallback((metaObj: any, eid: string) => {
    const fallback: Record<string, string> = {};
    fallback['Entity ID'] = eid;
    if (metaObj.type) fallback['IFC Type'] = metaObj.type;
    if (metaObj.name) fallback['Name'] = metaObj.name;
    if (metaObj.originalSystemId) fallback['FM GUID'] = metaObj.originalSystemId;
    if (metaObj.attributes?.LongName) fallback['Long Name'] = metaObj.attributes.LongName;
    if (metaObj.attributes?.ObjectType) fallback['Object Type'] = metaObj.attributes.ObjectType;
    if (metaObj.attributes?.Description) fallback['Description'] = metaObj.attributes.Description;
    let parent = metaObj.parent;
    while (parent) {
      if (parent.type?.toLowerCase() === 'ifcbuildingstorey') {
        fallback['Floor'] = parent.name || parent.id;
        break;
      }
      parent = parent.parent;
    }
    if (metaObj.metaModel?.id) fallback['Model'] = metaObj.metaModel.id;
    if (metaObj.propertySets) {
      metaObj.propertySets.forEach((ps: any) => {
        const psName = ps.name || 'Properties';
        ps.properties?.forEach((p: any) => {
          if (p.value !== undefined && p.value !== null && p.value !== '') {
            fallback[`${psName} / ${p.name}`] = String(p.value);
          }
        });
      });
    }
    setBimFallbackData(fallback);
  }, []);

  // FM Access DOU & Documents
  const [douData, setDouData] = useState<any[]>([]);
  const [fmaDocuments, setFmaDocuments] = useState<any[]>([]);

  // Fetch data for all selected items
  useEffect(() => {
    if (!isOpen || fmGuids.length === 0) return;

    const fetchData = async () => {
      setIsLoading(true);
      setBimFallbackData(null);
      try {
        // Case-insensitive GUID matching: try both original and lowercase
        const normalizedGuids = [...new Set([
          ...fmGuids,
          ...fmGuids.map(g => g.toLowerCase()),
          ...fmGuids.map(g => g.toUpperCase()),
        ])];

        let { data: assetData, error: assetError } = await supabase
          .from('assets')
          .select('*')
          .in('fm_guid', normalizedGuids);

        if (assetError) throw assetError;

        // If no direct match, try looking up via asset_external_ids table or originalSystemId
        if ((!assetData || assetData.length === 0) && entityId) {
          // First: try resolving via originalSystemId from xeokit metaScene
          const viewer = (window as any).__nativeXeokitViewer;
          const metaObj = viewer?.metaScene?.metaObjects?.[entityId];
          const originalSystemId = metaObj?.originalSystemId;

          if (originalSystemId) {
            const osidVariants = [originalSystemId, originalSystemId.toLowerCase(), originalSystemId.toUpperCase()];
            const { data: resolvedByOsid } = await supabase
              .from('assets')
              .select('*')
              .in('fm_guid', osidVariants);
            if (resolvedByOsid && resolvedByOsid.length > 0) {
              assetData = resolvedByOsid;
            }
          }

          // Second: try asset_external_ids table
          if (!assetData || assetData.length === 0) {
            const { data: extIds } = await supabase
              .from('asset_external_ids')
              .select('fm_guid')
              .eq('external_id', entityId)
              .limit(5);

            if (extIds && extIds.length > 0) {
              const resolvedGuids = extIds.map(e => e.fm_guid);
              const { data: resolvedAssets } = await supabase
                .from('assets')
                .select('*')
                .in('fm_guid', resolvedGuids);
              if (resolvedAssets && resolvedAssets.length > 0) {
                assetData = resolvedAssets;
              }
            }
          }
        }

        setAssets(assetData || []);

        // Populate BIM fallback data from viewer metaScene (even if assets exist — for extra BIM properties)
        {
          const viewer = (window as any).__nativeXeokitViewer;
          if (viewer?.metaScene?.metaObjects) {
            let metaObj = entityId ? viewer.metaScene.metaObjects[entityId] : null;
            // If no entityId or no match, scan metaObjects for matching originalSystemId (fmGuid)
            if (!metaObj && fmGuids.length === 1) {
              const guidLower = fmGuids[0].toLowerCase();
              for (const key of Object.keys(viewer.metaScene.metaObjects)) {
                const mo = viewer.metaScene.metaObjects[key];
                if (mo?.originalSystemId?.toLowerCase() === guidLower) {
                  metaObj = mo;
                  break;
                }
              }
            }
            if (metaObj) {
              setBimFallbackFromMeta(metaObj, entityId || metaObj.id || fmGuids[0]);
            }
          }
        }

        // If no assets found, auto-create a Geminus asset from BIM metadata
        if ((!assetData || assetData.length === 0) && entityId) {
          const viewer = (window as any).__nativeXeokitViewer;
          if (viewer?.metaScene?.metaObjects) {
            const metaObj = viewer.metaScene.metaObjects[entityId];
            if (metaObj) {
              // Determine fm_guid, category, name, building, level from BIM metadata
              const fmGuid = metaObj.originalSystemId || entityId;
              const ifcType = metaObj.type || 'Instance';
              // Map IFC type to Geminus category
              const IFC_CATEGORY_MAP: Record<string, string> = {
                'IfcWall': 'Instance', 'IfcWallStandardCase': 'Instance',
                'IfcDoor': 'Instance', 'IfcWindow': 'Instance',
                'IfcSlab': 'Instance', 'IfcColumn': 'Instance',
                'IfcBeam': 'Instance', 'IfcSpace': 'Space',
                'IfcBuildingStorey': 'Building Storey', 'IfcBuilding': 'Building',
                'IfcFurnishingElement': 'Instance', 'IfcFlowTerminal': 'Instance',
                'IfcFlowSegment': 'Instance', 'IfcFlowFitting': 'Instance',
              };
              const assetCategory = IFC_CATEGORY_MAP[ifcType] || 'Instance';
              const assetName = metaObj.name || null;

              // Find parent storey
              let levelFmGuid: string | null = null;
              let parent = metaObj.parent;
              while (parent) {
                if (parent.type?.toLowerCase() === 'ifcbuildingstorey') {
                  levelFmGuid = parent.originalSystemId || parent.id;
                  break;
                }
                parent = parent.parent;
              }

              // Find building fm guid from URL or context
              const urlParams = new URLSearchParams(window.location.search);
              const buildingFmGuid = urlParams.get('building') || null;

              try {
                // Build BIM attributes from propertySets to store in JSONB
                const bimAttrs: Record<string, any> = {};
                if (metaObj.propertySets) {
                  metaObj.propertySets.forEach((ps: any) => {
                    const psName = ps.name || 'Properties';
                    ps.properties?.forEach((p: any) => {
                      if (p.value !== undefined && p.value !== null && p.value !== '') {
                        bimAttrs[`${psName} / ${p.name}`] = String(p.value);
                      }
                    });
                  });
                }

                // Auto-insert into assets table
                const { data: insertedData, error: insertError } = await supabase
                  .from('assets')
                  .insert({
                    fm_guid: fmGuid,
                    category: assetCategory,
                    name: assetName,
                    asset_type: ifcType,
                    building_fm_guid: buildingFmGuid,
                    level_fm_guid: levelFmGuid,
                    is_local: true,
                    created_in_model: true,
                    attributes: Object.keys(bimAttrs).length > 0 ? bimAttrs : null,
                  })
                  .select()
                  .single();

                if (!insertError && insertedData) {
                  console.log('[UniversalPropertiesDialog] Auto-created asset from BIM:', fmGuid);
                  assetData = [insertedData];
                  setAssets([insertedData]);
                  setFormData({
                    common_name: insertedData.common_name || '',
                    asset_type: insertedData.asset_type || '',
                    coordinate_x: insertedData.coordinate_x ?? '',
                    coordinate_y: insertedData.coordinate_y ?? '',
                    coordinate_z: insertedData.coordinate_z ?? '',
                  });
                } else {
                  // If insert fails (e.g. duplicate), still show BIM fallback
                  console.warn('[UniversalPropertiesDialog] Auto-create failed, showing BIM fallback:', insertError?.message);
                  setBimFallbackFromMeta(metaObj, entityId);
                }
              } catch (e) {
                console.warn('[UniversalPropertiesDialog] Auto-create error:', e);
                setBimFallbackFromMeta(metaObj, entityId);
              }
            }
          }
        }

        // If single building, also fetch building_settings
        if (assetData?.length === 1 && (assetData[0]?.category === 'Building' || category === 'Building')) {
          const { data: settingsData } = await supabase
            .from('building_settings')
            .select('*')
            .eq('fm_guid', fmGuids[0])
            .maybeSingle();
          
          setBuildingSettings(settingsData);
        }

        // Initialize form data for single item
        if (assetData?.length === 1) {
          const asset = assetData[0];
          setFormData({
            common_name: asset.common_name || '',
            asset_type: asset.asset_type || '',
            coordinate_x: asset.coordinate_x ?? '',
            coordinate_y: asset.coordinate_y ?? '',
            coordinate_z: asset.coordinate_z ?? '',
          });
        } else {
          // For multi-select, start with empty form data
          setFormData({});
        }

        // Fetch FM Access DOU and documents for the object(s)
        if (assetData && assetData.length > 0) {
          const guidsForDou = assetData.map((a: any) => a.fm_guid);
          const buildingGuids = [...new Set(assetData.map((a: any) => a.building_fm_guid).filter(Boolean))];

          const [douResult, docsResult] = await Promise.all([
            supabase.from('fm_access_dou').select('*').in('object_fm_guid', guidsForDou),
            buildingGuids.length > 0
              ? supabase.from('fm_access_documents').select('*').in('building_fm_guid', buildingGuids).limit(50)
              : Promise.resolve({ data: [] }),
          ]);
          setDouData(douResult.data || []);
          setFmaDocuments((docsResult as any).data || []);
        } else {
          setDouData([]);
          setFmaDocuments([]);
        }
      } catch (error: any) {
        console.error('Failed to fetch data:', error);
        toast.error('Could not fetch data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen, fmGuids, category, entityId]);

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

  // Helper to get property value from asset
  const getPropertyValue = useCallback((asset: any, key: string): any => {
    if (key.startsWith('attr_')) {
      const attrKey = key.replace('attr_', '');
      const attrs = asset.attributes || {};
      const val = attrs[attrKey];
      if (val && typeof val === 'object' && 'value' in val) {
        return val.value;
      }
      return val;
    }
    return asset[key];
  }, []);

  // Parse all properties into a unified list with merge support
  const allProperties = useMemo((): PropertyItem[] => {
    if (assets.length === 0) return [];

    const props: PropertyItem[] = [];
    const firstAsset = assets[0];
    
    // Helper to check if values differ across assets
    const checkDifference = (key: string): { isDifferent: boolean; differentCount: number; value: any } => {
      if (assets.length === 1) {
        return { isDifferent: false, differentCount: 1, value: getPropertyValue(firstAsset, key) };
      }
      
      const values = assets.map(a => JSON.stringify(getPropertyValue(a, key)));
      const uniqueValues = [...new Set(values)];
      
      return {
        isDifferent: uniqueValues.length > 1,
        differentCount: uniqueValues.length,
        value: uniqueValues.length === 1 ? getPropertyValue(firstAsset, key) : null,
      };
    };
    
    // Helper to determine if a value is a GUID
    const isGuidValue = (val: any): boolean => {
      if (typeof val !== 'string') return false;
      return GUID_VALUE_REGEX.test(val.trim());
    };
    
    // System properties — only those with GUID values go to 'system', rest to 'geminus'
    const fmGuidDiff = checkDifference('fm_guid');
    props.push({ 
      key: 'fm_guid', 
      label: 'FM GUID', 
      value: fmGuidDiff.value, 
      editable: false, 
      source: 'lovable', 
      type: 'text', 
      section: 'system',
      isDifferent: fmGuidDiff.isDifferent,
      differentCount: fmGuidDiff.differentCount,
    });
    
    const categoryDiff = checkDifference('category');
    props.push({ 
      key: 'category', 
      label: 'Category', 
      value: categoryDiff.value, 
      editable: false, 
      source: 'lovable', 
      type: 'text', 
      section: 'geminus',
      isDifferent: categoryDiff.isDifferent,
      differentCount: categoryDiff.differentCount,
    });
    
    if (firstAsset.name || assets.some(a => a.name)) {
      const nameDiff = checkDifference('name');
      props.push({ 
        key: 'name', 
        label: 'Name (IFC)', 
        value: nameDiff.value, 
        editable: false, 
        source: 'lovable', 
        type: 'text', 
        section: 'geminus',
        isDifferent: nameDiff.isDifferent,
        differentCount: nameDiff.differentCount,
      });
    }
    
    // Local editable properties → geminus
    const commonNameDiff = checkDifference('common_name');
    props.push({ 
      key: 'common_name', 
      label: 'Display Name', 
      value: commonNameDiff.value, 
      editable: true, 
      source: 'lovable', 
      type: 'text', 
      section: 'geminus',
      isDifferent: commonNameDiff.isDifferent,
      differentCount: commonNameDiff.differentCount,
    });
    
    const assetTypeDiff = checkDifference('asset_type');
    props.push({ 
      key: 'asset_type', 
      label: 'Asset Type', 
      value: assetTypeDiff.value, 
      editable: true, 
      source: 'lovable', 
      type: 'text', 
      section: 'geminus',
      isDifferent: assetTypeDiff.isDifferent,
      differentCount: assetTypeDiff.differentCount,
    });
    
    // Building settings (only for single building)
    if (!isMultiMode && (buildingSettings || firstAsset.category === 'Building')) {
      props.push({ key: 'ivion_site_id', label: 'Ivion Site ID', value: buildingSettings?.ivion_site_id, editable: true, source: 'lovable', type: 'text', section: 'geminus' });
      props.push({ key: 'is_favorite', label: 'Favorite', value: buildingSettings?.is_favorite, editable: true, source: 'lovable', type: 'boolean', section: 'geminus' });
    }
    
    // Coordinates
    const hasCoordinates = assets.some(a => a.coordinate_x !== null || a.coordinate_y !== null || a.coordinate_z !== null);
    if (hasCoordinates) {
      const xDiff = checkDifference('coordinate_x');
      const yDiff = checkDifference('coordinate_y');
      const zDiff = checkDifference('coordinate_z');
      
      props.push({ key: 'coordinate_x', label: 'X', value: xDiff.value, editable: true, source: 'lovable', type: 'number', section: 'coordinates', isDifferent: xDiff.isDifferent, differentCount: xDiff.differentCount });
      props.push({ key: 'coordinate_y', label: 'Y', value: yDiff.value, editable: true, source: 'lovable', type: 'number', section: 'coordinates', isDifferent: yDiff.isDifferent, differentCount: yDiff.differentCount });
      props.push({ key: 'coordinate_z', label: 'Z', value: zDiff.value, editable: true, source: 'lovable', type: 'number', section: 'coordinates', isDifferent: zDiff.isDifferent, differentCount: zDiff.differentCount });
    }

    // Status flags — these are booleans, not GUIDs, go to geminus
    const isLocalDiff = checkDifference('is_local');
    props.push({ 
      key: 'is_local', 
      label: 'Locally Created', 
      value: isLocalDiff.value, 
      editable: false, 
      source: 'lovable', 
      type: 'boolean', 
      section: 'geminus',
      isDifferent: isLocalDiff.isDifferent,
      differentCount: isLocalDiff.differentCount,
    });
    
    const annotationDiff = checkDifference('annotation_placed');
    props.push({ 
      key: 'annotation_placed', 
      label: 'Annotation Placed', 
      value: annotationDiff.value, 
      editable: false, 
      source: 'lovable', 
      type: 'boolean', 
      section: 'geminus',
      isDifferent: annotationDiff.isDifferent,
      differentCount: annotationDiff.differentCount,
    });

    // Hierarchy references — GUIDs go to 'system'
    if (assets.some(a => a.building_fm_guid)) {
      const buildingDiff = checkDifference('building_fm_guid');
      props.push({ 
        key: 'building_fm_guid', 
        label: 'Building (GUID)', 
        value: buildingDiff.value, 
        editable: false, 
        source: 'lovable', 
        type: 'text', 
        section: 'system',
        isDifferent: buildingDiff.isDifferent,
        differentCount: buildingDiff.differentCount,
      });
    }
    if (assets.some(a => a.level_fm_guid)) {
      const levelDiff = checkDifference('level_fm_guid');
      props.push({ 
        key: 'level_fm_guid', 
        label: 'Floor (GUID)', 
        value: levelDiff.value, 
        editable: false, 
        source: 'lovable', 
        type: 'text', 
        section: 'system',
        isDifferent: levelDiff.isDifferent,
        differentCount: levelDiff.differentCount,
      });
    }

    // Asset+ properties from attributes JSONB (only for single item to avoid complexity)
    if (!isMultiMode && firstAsset.attributes) {
      const attrs = firstAsset.attributes as Record<string, any>;
      
      // Keys that are already mapped to system/geminus props or are internal
      const SKIP_ATTR_KEYS = [
        'fmGuid', 'category', 'objectType', 'tenantId', '_id', 'objectTypeValue',
        'checkedOut', 'createdInModel', 'parentGuid', 'buildingGuid', 'levelGuid', 'roomGuid',
        'buildingFmGuid', 'levelFmGuid', 'inRoomFmGuid', 'complexFmGuid', 'parentFmGuid',
        'fromRoomFmGuid', 'toRoomFmGuid', 'commonName', 'designation',
        'dateCreated', 'dateModified', 'dateExpired', 'grossArea',
        'buildingCommonName', 'complexCommonName', 'buildingDesignation', 'complexDesignation',
        'levelCommonName', 'levelDesignation', 'levelName', 'levelNumber',
        'inRoomCommonName', 'inRoomDesignation', 'parentCommonName', 'parentDesignation',
        'fromRoomCommonName', 'fromRoomDesignation', 'toRoomCommonName', 'toRoomDesignation',
        'securitySchemaId', 'securitySchemaName', 'parentBimObjectId',
        'syncProperties', 'ivionSource', 'ivionImageId',
        'bipTypeId', 'bipBsabE', 'bipAff', 'bipCode',
      ];
      
      Object.entries(attrs).forEach(([key, value]) => {
        if (SKIP_ATTR_KEYS.includes(key)) return;
        
        let displayValue = value;
        let displayLabel = key;
        let isUserDefined = false;
        
        // Handle structured Asset+ values with {name, value, dataType}
        if (value && typeof value === 'object' && 'value' in value && 'name' in value) {
          displayValue = value.value;
          displayLabel = value.name || key;
          isUserDefined = true;
        }
        
        // Skip null/undefined display values and internal-looking keys
        if (displayValue === null || displayValue === undefined) return;
        
        // Determine section: user-defined properties (with {name,value}) → 'user-defined', 
        // GUID values → system, area fields → area, rest → geminus
        const keyLower = key.toLowerCase();
        const isArea = AREA_FIELDS.some(f => keyLower.includes(f));
        const valIsGuid = isGuidValue(displayValue);
        
        let section: PropertyItem['section'] = 'geminus';
        if (isUserDefined) section = 'user-defined';
        else if (valIsGuid) section = 'system';
        else if (isArea) section = 'area';
        
        props.push({
          key: `attr_${key}`,
          label: displayLabel,
          value: displayValue,
          editable: isUserDefined, // User-defined properties are editable
          source: 'asset-plus',
          type: typeof displayValue === 'number' ? 'number' : 'text',
          section,
        });
      });
    }

    // Classification section - show saved BIP codes from attributes
    if (!isMultiMode && firstAsset.attributes) {
      const attrs = firstAsset.attributes as Record<string, any>;
      if (attrs.bipTypeId || attrs.bipBsabE || attrs.bipAff) {
        if (attrs.bipTypeId) {
          props.push({ key: 'attr_bipTypeId', label: 'BIP Type Code', value: attrs.bipTypeId, editable: false, source: 'lovable', type: 'text', section: 'classification' });
        }
        if (attrs.bipBsabE) {
          props.push({ key: 'attr_bipBsabE', label: 'BSAB-E', value: attrs.bipBsabE, editable: false, source: 'lovable', type: 'text', section: 'classification' });
        }
        if (attrs.bipAff) {
          props.push({ key: 'attr_bipAff', label: 'AFF', value: attrs.bipAff, editable: false, source: 'lovable', type: 'text', section: 'classification' });
        }
        if (attrs.bipCode) {
          props.push({ key: 'attr_bipCode', label: 'BIP Code', value: attrs.bipCode, editable: false, source: 'lovable', type: 'text', section: 'classification' });
        }
      }
    }

    return props;
  }, [assets, buildingSettings, isMultiMode, getPropertyValue]);

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
    if (assets.length === 0) return;
    setIsSaving(true);

    try {
      // Build update payload (only changed fields)
      const updatePayload: Record<string, any> = {};
      const assetPlusProperties: UpdatePropertyItem[] = [];
      
      if (formData.common_name !== undefined && formData.common_name !== '') {
        updatePayload.common_name = formData.common_name || null;
        assetPlusProperties.push({
          name: 'commonName',
          value: formData.common_name || '',
          dataType: 0, // String
        });
      }
      if (formData.asset_type !== undefined && formData.asset_type !== '') {
        updatePayload.asset_type = formData.asset_type || null;
        // asset_type is a Lovable-only field, not synced to Asset+
      }
      if (formData.coordinate_x !== undefined && formData.coordinate_x !== '') {
        updatePayload.coordinate_x = parseFloat(formData.coordinate_x) || 0;
      }
      if (formData.coordinate_y !== undefined && formData.coordinate_y !== '') {
        updatePayload.coordinate_y = parseFloat(formData.coordinate_y) || 0;
      }
      if (formData.coordinate_z !== undefined && formData.coordinate_z !== '') {
        updatePayload.coordinate_z = parseFloat(formData.coordinate_z) || 0;
      }

      // Collect user-defined attribute edits (keys starting with attr_)
      const attrUpdates: Record<string, any> = {};
      Object.entries(formData).forEach(([key, value]) => {
        if (!key.startsWith('attr_')) return;
        const attrKey = key.replace('attr_', '');
        const originalAttrs = assets[0]?.attributes || {};
        const originalVal = originalAttrs[attrKey];
        
        // Handle structured {name, value, dataType} properties
        if (originalVal && typeof originalVal === 'object' && 'name' in originalVal) {
          attrUpdates[attrKey] = { ...originalVal, value };
          assetPlusProperties.push({
            name: originalVal.name || attrKey,
            value: value ?? '',
            dataType: originalVal.dataType ?? 0,
          });
        } else {
          attrUpdates[attrKey] = value;
        }
      });

      // If user-defined attributes changed, merge into the existing JSONB
      if (Object.keys(attrUpdates).length > 0) {
        const existingAttrs = assets[0]?.attributes || {};
        updatePayload.attributes = { ...existingAttrs, ...attrUpdates };
      }

      // Check if any assets need Asset+ sync (is_local = false)
      const syncedAssets = assets.filter(a => a.is_local === false);
      const hasSyncedAssets = syncedAssets.length > 0 && assetPlusProperties.length > 0;

      if (hasSyncedAssets) {
        // Use Edge Function for synced assets (updates both Asset+ and local DB)
        const response = await updateAssetProperties(fmGuids, assetPlusProperties);
        
        if (!response.success) {
          const failedCount = response.summary.failed;
          if (failedCount > 0) {
            toast.warning(`${response.summary.success} updated, ${failedCount} failed to sync to Asset+`);
          }
        } else {
          toast.success(`${response.summary.success} items updated (${response.summary.syncedToAssetPlus} synced to Asset+)`);
        }

        // Also push to FM Access (best-effort, don't block)
        try {
          const fmaProps: Record<string, any> = {};
          assetPlusProperties.forEach(p => { fmaProps[p.name] = p.value; });
          if (Object.keys(fmaProps).length > 0) {
            for (const guid of fmGuids) {
              pushPropertyChangesToFmAccess(guid, fmaProps).catch(e => 
                console.warn('FM Access property sync failed for', guid, e)
              );
            }
          }
        } catch (e) {
          console.warn('FM Access property push skipped:', e);
        }

        // Update remaining local-only fields (coordinates, asset_type) directly
        const localOnlyPayload: Record<string, any> = {};
        if (updatePayload.coordinate_x !== undefined) localOnlyPayload.coordinate_x = updatePayload.coordinate_x;
        if (updatePayload.coordinate_y !== undefined) localOnlyPayload.coordinate_y = updatePayload.coordinate_y;
        if (updatePayload.coordinate_z !== undefined) localOnlyPayload.coordinate_z = updatePayload.coordinate_z;
        if (updatePayload.asset_type !== undefined) localOnlyPayload.asset_type = updatePayload.asset_type;

        if (Object.keys(localOnlyPayload).length > 0) {
          await supabase.from('assets').update(localOnlyPayload).in('fm_guid', fmGuids);
        }
      } else if (Object.keys(updatePayload).length > 0) {
        // All assets are local - just update database directly
        const { error } = await supabase
          .from('assets')
          .update(updatePayload)
          .in('fm_guid', fmGuids);

        if (error) throw error;
        
        const message = isMultiMode ? `Updated ${fmGuids.length} items` : 'Properties saved';
        toast.success(message);
      }

      // Update building_settings if applicable (single building only)
      if (!isMultiMode && assets[0]?.category === 'Building' && formData.ivion_site_id !== undefined) {
        const settingsPayload = {
          fm_guid: assets[0].fm_guid,
          ivion_site_id: formData.ivion_site_id || null,
          is_favorite: formData.is_favorite ?? false,
        };

        const { error: settingsError } = await supabase
          .from('building_settings')
          .upsert(settingsPayload, { onConflict: 'fm_guid' });

        if (settingsError) throw settingsError;
      }

      setIsEditing(false);
      onUpdate?.();
    } catch (error: any) {
      toast.error('Error saving: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const displayCategory = assets[0]?.category || category || 'Object';
  
  // Sync status derived from assets
  const syncStatus = useMemo(() => {
    if (assets.length === 0) return null;
    const allLocal = assets.every(a => a.is_local);
    const allSynced = assets.every(a => !a.is_local);
    const hasBimCreated = assets.some(a => a.created_in_model);
    const isInstance = assets.every(a => a.category === 'Instance');
    return { allLocal, allSynced, hasBimCreated, isInstance };
  }, [assets]);
  
  
  // Delete handler
  
  const handleDelete = async () => {
    if (assets.length === 0) return;
    setIsDeleting(true);
    try {
      const result = await deleteAssets(fmGuids);
      if (result.summary.deleted > 0) {
        // Best-effort: also delete from FM Access
        for (const guid of fmGuids) {
          try {
            await deleteFmAccessObject(guid);
          } catch (fmaErr) {
            console.warn(`FM Access delete failed for ${guid}:`, fmaErr);
          }
        }
        toast.success(`${result.summary.deleted} object(s) deleted`);
        onUpdate?.();
        onClose();
      }
      if (result.summary.failed > 0) {
        const errors = result.results.filter(r => !r.success).map(r => r.error).join(', ');
        toast.error(`${result.summary.failed} failed: ${errors}`);
      }
    } catch (error: any) {
      toast.error('Delete failed: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };
  
  const handlePushToAssetPlus = async () => {
    if (assets.length === 0) return;
    setIsPushing(true);
    try {
      // Push each local asset
      let succeeded = 0;
      let failed = 0;
      for (const fmGuid of fmGuids) {
        const result = await syncAssetToAssetPlus(fmGuid);
        if (result.success) succeeded++;
        else failed++;
      }
      if (succeeded > 0) {
        toast.success(`${succeeded} object(s) pushed to Asset+`);
        onUpdate?.();
        // Refresh data
        const { data: refreshed } = await supabase
          .from('assets')
          .select('*')
          .in('fm_guid', fmGuids);
        if (refreshed) setAssets(refreshed);
      }
      if (failed > 0) {
        toast.error(`${failed} object(s) failed to push`);
      }
    } catch (error: any) {
      toast.error('Push failed: ' + error.message);
    } finally {
      setIsPushing(false);
    }
  };

  const handlePushToFmAccess = async () => {
    if (assets.length === 0) return;
    setIsPushingFma(true);
    try {
      let succeeded = 0;
      let failed = 0;
      for (const fmGuid of fmGuids) {
        const result = await pushAssetToFmAccess(fmGuid);
        if (result.success) succeeded++;
        else {
          failed++;
          console.warn(`FM Access push failed for ${fmGuid}:`, result.error);
        }
      }
      if (succeeded > 0) {
        toast.success(`${succeeded} object(s) pushed to FM Access`);
        onUpdate?.();
      }
      if (failed > 0) {
        toast.error(`${failed} object(s) failed to push to FM Access`);
      }
    } catch (error: any) {
      toast.error('FM Access push failed: ' + error.message);
    } finally {
      setIsPushingFma(false);
    }
  };

  // BIP classification handler
  const handleClassify = async () => {
    if (assets.length === 0) return;
    setIsClassifying(true);
    setBipSuggestions([]);
    setBipApplied(null);

    try {
      const asset = assets[0];
      const { data, error } = await supabase.functions.invoke('bip-classify', {
        body: {
          assetName: asset.common_name || asset.name,
          assetType: asset.asset_type,
          category: asset.category,
          ifcType: asset.asset_type,
          attributes: asset.attributes,
          fmGuids: fmGuids,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setBipSuggestions(data.suggestions || []);
      
      // Auto-open the classification section
      setOpenSections(prev => new Set([...prev, 'classification']));
      
      if ((data.suggestions || []).length === 0) {
        toast.info('No BIP matches found');
      }
    } catch (error: any) {
      console.error('BIP classify error:', error);
      toast.error('Classification failed: ' + (error.message || 'Unknown error'));
    } finally {
      setIsClassifying(false);
    }
  };

  // Apply a BIP suggestion to the asset
  const handleApplyBipSuggestion = async (suggestion: BipSuggestion) => {
    if (assets.length === 0) return;

    try {
      const updatedAttrs = {
        ...(assets[0].attributes || {}),
        bipCode: suggestion.code,
        bipTypeId: suggestion.usercode_syntax || suggestion.code,
        bipTitle: suggestion.title,
        bipBsabE: suggestion.bsab_e || '',
        bipAff: suggestion.aff || '',
      };

      const { error } = await supabase
        .from('assets')
        .update({ attributes: updatedAttrs })
        .in('fm_guid', fmGuids);

      if (error) throw error;

      // Update local state
      setAssets(prev => prev.map(a => ({ ...a, attributes: updatedAttrs })));
      setBipApplied(suggestion.code);
      toast.success(`BIP-kod ${suggestion.code} tillämpad`);
      onUpdate?.();
    } catch (error: any) {
      toast.error('Could not save BIP code: ' + error.message);
    }
  };

  const headerTitle = useMemo(() => {
    if (isMultiMode) {
      return `${fmGuids.length} items selected`;
    }
    return assets[0]?.common_name || assets[0]?.name || fmGuids[0]?.slice(0, 8);
  }, [isMultiMode, fmGuids, assets]);

  const renderPropertyValue = (prop: PropertyItem) => {
    const isEditingThis = isEditing && prop.editable;
    
    // Show "Different values" for multi-select with differing values
    if (prop.isDifferent && !isEditing) {
      return (
        <span className="text-muted-foreground italic flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Different values ({prop.differentCount})
        </span>
      );
    }
    
    if (isEditingThis && prop.type === 'text') {
      return (
        <div className="flex flex-col gap-1">
          {prop.isDifferent && (
            <span className="text-xs text-amber-500">Will overwrite all</span>
          )}
          <Input
            value={formData[prop.key] ?? prop.value ?? ''}
            placeholder={prop.isDifferent ? 'Enter new value for all...' : undefined}
            onChange={(e) => setFormData({ ...formData, [prop.key]: e.target.value })}
            className="h-8 text-sm"
          />
        </div>
      );
    }
    
    if (isEditingThis && prop.type === 'number') {
      return (
        <div className="flex flex-col gap-1">
          {prop.isDifferent && (
            <span className="text-xs text-amber-500">Will overwrite all</span>
          )}
          <Input
            type="number"
            value={formData[prop.key] ?? prop.value ?? ''}
            placeholder={prop.isDifferent ? 'Enter new value for all...' : undefined}
            onChange={(e) => setFormData({ ...formData, [prop.key]: parseFloat(e.target.value) || 0 })}
            className="h-8 text-sm"
          />
        </div>
      );
    }
    
    if (prop.type === 'boolean') {
      if (prop.isDifferent) {
        return (
          <span className="text-muted-foreground italic flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Different values
          </span>
        );
      }
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
      return <span className="text-sm">{displayValue.toLocaleString('en-US')}</span>;
    }

    // URL detection — render as clickable link
    if (typeof displayValue === 'string' && /^https?:\/\//i.test(displayValue.trim())) {
      return (
        <a
          href={displayValue.trim()}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline hover:text-primary/80 truncate max-w-[240px] block sm:text-right"
          title={displayValue}
        >
          {displayValue.length > 40 ? displayValue.slice(0, 37) + '…' : displayValue}
        </a>
      );
    }
    
    // GUIDs should wrap instead of truncating
    const isGuid = typeof displayValue === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(displayValue);
    return <span className={cn("text-sm block sm:text-right", isGuid ? "break-all font-mono text-xs" : "truncate max-w-[240px]")} title={String(displayValue)}>{String(displayValue)}</span>;
  };

  // Content shared between mobile and desktop
  const renderContent = () => (
    <>
      {/* Multi-select indicator */}
      {isMultiMode && (
        <div className="p-3 border-b bg-amber-500/10 shrink-0">
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Editing {fmGuids.length} items. Changes will apply to all selected.
          </p>
        </div>
      )}
      
      {/* Search field */}
      <div className="p-3 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search properties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-sm"
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
          ) : assets.length === 0 && bimFallbackData ? (
            // BIM metadata fallback display (read-only)
            <div className="space-y-2">
              <div className="px-2 py-1.5 bg-muted/50 rounded-md">
                <span className="text-xs font-medium text-muted-foreground">BIM Metadata (read-only)</span>
              </div>
              {Object.entries(bimFallbackData).map(([key, value]) => (
                <div key={key} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1.5 px-2 rounded">
                  <span className="text-xs text-muted-foreground shrink-0">{key}</span>
                  <span className={cn("text-sm block sm:text-right", /^[0-9a-f]{8}-/i.test(value || '') ? "break-all font-mono text-xs" : "truncate max-w-[240px]")} title={value}>{value}</span>
                </div>
              ))}
            </div>
          ) : assets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>No data found</p>
              <p className="text-xs mt-1 font-mono">{fmGuids[0]}</p>
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <p>No properties match the search</p>
            </div>
          ) : (
            // Render sections
            ['system', 'local', 'coordinates', 'area', 'classification', 'user-defined'].map(section => {
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

          {/* BIM Properties section — shown when both assets and bimFallbackData exist */}
          {assets.length > 0 && bimFallbackData && Object.keys(bimFallbackData).length > 0 && (
            <Collapsible
              open={openSections.has('bim')}
              onOpenChange={() => toggleSection('bim')}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full p-2 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <div className="flex items-center gap-2">
                  {openSections.has('bim') ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5 rotate-180" />}
                  <span className="text-sm font-medium">BIM Properties</span>
                  <Badge variant="secondary" className="text-[10px]">{Object.keys(bimFallbackData).length}</Badge>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-1">
                {Object.entries(bimFallbackData).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded">
                    <span className="text-xs text-muted-foreground shrink-0">{key}</span>
                    <span className={cn("text-sm text-right", /^[0-9a-f]{8}-/i.test(value || '') ? "break-all font-mono text-xs" : "truncate max-w-[220px]")} title={value}>{value}</span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
          
          {/* BIP Classification Suggestions */}
          {bipSuggestions.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 px-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">BIP-förslag</span>
              </div>
              {bipSuggestions.map((s, i) => (
                <div key={i} className="border rounded-md p-2.5 space-y-1 bg-muted/30">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="text-xs font-mono shrink-0">{s.code}</Badge>
                      <span className="text-sm font-medium truncate">{s.title}</span>
                    </div>
                    <Button 
                      variant={bipApplied === s.code ? "default" : "outline"} 
                      size="sm" 
                      className="shrink-0 h-7 text-xs"
                      onClick={() => handleApplyBipSuggestion(s)}
                      disabled={bipApplied === s.code}
                    >
                      {bipApplied === s.code ? <Check className="h-3 w-3 mr-1" /> : <Tag className="h-3 w-3 mr-1" />}
                      {bipApplied === s.code ? 'Selected' : 'Select'}
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {s.usercode_syntax && (
                      <Badge variant="secondary" className="text-[10px]">Typ: {s.usercode_syntax}</Badge>
                    )}
                    {s.bsab_e && (
                      <Badge variant="secondary" className="text-[10px]">BSAB-E: {s.bsab_e}</Badge>
                    )}
                    {s.aff && (
                      <Badge variant="secondary" className="text-[10px]">AFF: {s.aff}</Badge>
                    )}
                    <Badge variant={s.confidence >= 0.7 ? "default" : "secondary"} className="text-[10px]">
                      {Math.round(s.confidence * 100)}%
                    </Badge>
                  </div>
                  {s.reasoning && (
                    <p className="text-xs text-muted-foreground">{s.reasoning}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* FM Access DOU (Drift & Underhåll) */}
          {douData.length > 0 && (
            <Collapsible
              open={openSections.has('dou')}
              onOpenChange={() => toggleSection('dou')}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full p-2 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <div className="flex items-center gap-2">
                  {openSections.has('dou') ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5 rotate-180" />}
                  <span className="text-sm font-medium">Drift & Underhåll</span>
                  <Badge variant="secondary" className="text-[10px]">{douData.length}</Badge>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-2">
                {douData.map((dou) => (
                  <div key={dou.id} className="border rounded-md p-2.5 space-y-1 bg-muted/20">
                    {dou.title && <p className="text-sm font-medium">{dou.title}</p>}
                    {dou.doc_type && (
                      <Badge variant="outline" className="text-[10px]">{dou.doc_type}</Badge>
                    )}
                    {dou.content && (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">{dou.content}</p>
                    )}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* FM Access Documents */}
          {fmaDocuments.length > 0 && (
            <Collapsible
              open={openSections.has('fma-docs')}
              onOpenChange={() => toggleSection('fma-docs')}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full p-2 bg-muted/50 rounded-md hover:bg-muted transition-colors">
                <div className="flex items-center gap-2">
                  {openSections.has('fma-docs') ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5 rotate-180" />}
                  <span className="text-sm font-medium">Dokument (FM Access)</span>
                  <Badge variant="secondary" className="text-[10px]">{fmaDocuments.length}</Badge>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-1">
                {fmaDocuments.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/30">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{doc.name || doc.file_name || 'Unnamed'}</p>
                      {doc.class_name && (
                        <span className="text-xs text-muted-foreground">{doc.class_name}</span>
                      )}
                    </div>
                    {doc.document_id && (
                      <Badge variant="outline" className="text-[10px] shrink-0">#{doc.document_id}</Badge>
                    )}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </ScrollArea>

      {/* Footer actions */}
      {assets.length > 0 && (
        <div className="p-3 border-t space-y-2 shrink-0"
             style={{ paddingBottom: isMobile ? 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' : undefined }}>
          {/* Sync status badge */}
          {syncStatus && (
            <div className="flex items-center gap-2 flex-wrap">
              {syncStatus.allLocal && (
                <Badge variant="outline" className="text-xs gap-1 border-amber-500/50 text-amber-600">
                  <CloudOff className="h-3 w-3" />
                  Local only
                </Badge>
              )}
              {syncStatus.allSynced && (
                <Badge variant="outline" className="text-xs gap-1 border-emerald-500/50 text-emerald-600">
                  <Cloud className="h-3 w-3" />
                  Synced
                </Badge>
              )}
              {!syncStatus.allLocal && !syncStatus.allSynced && (
                <Badge variant="outline" className="text-xs gap-1">
                  Mixed sync status
                </Badge>
              )}
              {syncStatus.hasBimCreated && (
                <Badge variant="secondary" className="text-[10px]">BIM</Badge>
              )}
            </div>
          )}
          
          {/* Action buttons */}
          <div className="flex items-center gap-2 justify-between">
            <div className="flex gap-1">
              {/* Delete button - only for Instance objects, disabled for BIM-created */}
              {syncStatus?.isInstance && !syncStatus.hasBimCreated && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={isDeleting}>
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {isMultiMode ? `${fmGuids.length} objects` : 'object'}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {syncStatus.allLocal 
                          ? 'Detta raderar objektet/objekten permanent från den lokala databasen.'
                          : 'Objektet/objekten kommer att expieras i Asset+ och tas bort lokalt.'}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Avbryt</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                        Radera
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              {/* Show explanation when delete is blocked due to BIM */}
              {syncStatus?.isInstance && syncStatus.hasBimCreated && (
                <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
                  <AlertCircle className="h-3 w-3" />
                  Finns i BIM-modell — kan inte raderas
                </Badge>
              )}
              
              {/* Push to Asset+ button - only for local objects */}
              {syncStatus?.allLocal && syncStatus?.isInstance && (
                <Button variant="outline" size="sm" onClick={handlePushToAssetPlus} disabled={isPushing || isPushingFma}>
                  {isPushing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                  Push to Asset+
                </Button>
              )}
              
              {/* Push to FM Access button */}
              {syncStatus?.isInstance && (
                <Button variant="outline" size="sm" onClick={handlePushToFmAccess} disabled={isPushingFma || isPushing}>
                  {isPushingFma ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                  Push to FM Access
                </Button>
              )}
              
              {/* BIP Classify button */}
              <Button variant="outline" size="sm" onClick={handleClassify} disabled={isClassifying}>
                {isClassifying ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
                Klassificera (BIP)
              </Button>
            </div>
            
            <div className="flex gap-1">
              {isEditing ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    {isMultiMode ? `Save All (${fmGuids.length})` : 'Save'}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (!isOpen) return null;

  // Mobile: Use Sheet (bottom drawer)
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent 
          side="bottom" 
          className="h-[90vh] flex flex-col p-0"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <SheetHeader className="p-3 border-b shrink-0">
            <SheetTitle className="flex items-center gap-2 text-left">
              {CATEGORY_ICONS[displayCategory] || <Database className="h-4 w-4 shrink-0" />}
              <span className="font-medium text-sm truncate flex-1">
                {headerTitle}
              </span>
              <Badge variant="outline" className="text-xs shrink-0">{displayCategory}</Badge>
              <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 border-border bg-background hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); onClose(); }}>
                <X className="h-4 w-4" />
              </Button>
            </SheetTitle>
          </SheetHeader>
          {renderContent()}
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Fixed right-side panel or inline flex sibling
  return (
    <div
      className={inline
        ? "w-96 shrink-0 bg-card border-l shadow-xl flex flex-col h-full"
        : "fixed inset-y-0 right-0 z-[70] w-96 bg-card border-l shadow-xl flex flex-col animate-in slide-in-from-right duration-300"
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {CATEGORY_ICONS[displayCategory] || <Database className="h-4 w-4 shrink-0" />}
          <span className="font-medium text-sm truncate">
            {headerTitle}
          </span>
          <Badge variant="outline" className="text-xs shrink-0">{displayCategory}</Badge>
        </div>
        <div className="flex items-center gap-1">
          {onPinToggle && (
            <Button
              variant={isPinned ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={(e) => { e.stopPropagation(); onPinToggle(); }}
              title={isPinned ? 'Unpin (auto-updates on selection)' : 'Pin (auto-update on selection)'}
            >
              {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </Button>
          )}
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0 border-border bg-background hover:bg-destructive/10 text-foreground" onClick={(e) => { e.stopPropagation(); onClose(); }}>
            <X className="h-4 w-4 text-foreground" />
          </Button>
        </div>
      </div>

      {renderContent()}
    </div>
  );
};

export default UniversalPropertiesDialog;
