import React, { useState, useMemo, useCallback, useEffect, useContext } from 'react';
import {
  ArrowLeft,
  Search,
  LayoutGrid,
  List,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Box,
  Cuboid,
  GripVertical,
  MapPin,
  Filter,
  AlertCircle,
  Loader2,
  RefreshCw,
  CloudUpload,
  Check,
  Settings2,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Facility } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AppContext } from '@/context/AppContext';
import { syncBuildingAssetsIfNeeded, syncAssetToAssetPlus, batchSyncAssetsToAssetPlus, fetchAssetsForBuilding, isAccSourcedBuilding } from '@/services/asset-plus-service';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import UniversalPropertiesDialog from '@/components/common/UniversalPropertiesDialog';

interface AssetData {
  fmGuid: string;
  [key: string]: any;
}

interface AssetsViewProps {
  facility: Facility;
  assets: any[];
  onClose: () => void;
  onOpen3D?: (fmGuid: string, levelFmGuid?: string) => void;
  onPlaceAnnotation?: (asset: any) => void;
  onSelectAsset?: (fmGuid: string) => void;
}

interface ColumnDef {
  key: string;
  label: string;
  category: 'system' | 'userDefined' | 'status';
}

// System property definitions
const SYSTEM_COLUMNS: ColumnDef[] = [
  { key: 'designation', label: 'Designation', category: 'system' },
  { key: 'commonName', label: 'Name', category: 'system' },
  { key: 'assetType', label: 'Type', category: 'system' },
  { key: 'category', label: 'Category', category: 'system' },
  { key: 'levelCommonName', label: 'Floor', category: 'system' },
  { key: 'roomName', label: 'Room', category: 'system' },
  { key: 'fmGuid', label: 'FMGUID', category: 'system' },
];

// Status columns
const STATUS_COLUMNS: ColumnDef[] = [
  { key: 'createdInModel', label: 'In Model', category: 'status' },
  { key: 'annotationPlaced', label: 'Annotation', category: 'status' },
  { key: 'isLocal', label: 'Synced', category: 'status' },
];

// Default visible columns
const DEFAULT_VISIBLE_COLUMNS = ['designation', 'commonName', 'assetType', 'levelCommonName', 'createdInModel'];

// Sortable Column Header Component
const SortableColumnHeader: React.FC<{
  id: string;
  label: string;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  onSort: (column: string) => void;
}> = ({ id, label, sortColumn, sortDirection, onSort }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  };

  return (
    <TableHead
      ref={setNodeRef}
      style={style}
      className="bg-muted/50 select-none whitespace-nowrap"
    >
      <div className="flex items-center gap-1">
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab hover:text-primary"
        >
          <GripVertical size={12} className="text-muted-foreground" />
        </span>
        <span
          className="cursor-pointer hover:text-primary flex items-center gap-1"
          onClick={() => onSort(id)}
        >
          {label}
          {sortColumn === id ? (
            sortDirection === 'asc' ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )
          ) : (
            <ArrowUpDown size={12} className="text-muted-foreground" />
          )}
        </span>
      </div>
    </TableHead>
  );
};

type FilterMode = 'all' | 'orphans' | 'no-annotation' | 'unsynced';

const AssetsView: React.FC<AssetsViewProps> = ({
  facility,
  assets,
  onClose,
  onOpen3D,
  onPlaceAnnotation,
  onSelectAsset,
}) => {
  const { toast } = useToast();
  const { startAnnotationPlacement } = useContext(AppContext);
  const [viewMode, setViewMode] = useState<'grid' | 'gallery'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  // Debounce search for performance with large asset lists
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [sortColumn, setSortColumn] = useState<string>('designation');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [isSyncingAssets, setIsSyncingAssets] = useState(false);
  const [syncingAssetIds, setSyncingAssetIds] = useState<Set<string>>(new Set());
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  
  // Local assets state for on-demand sync
  const [localAssets, setLocalAssets] = useState<any[]>(assets);
  const [hasTriedSync, setHasTriedSync] = useState(false);
  
  // Multi-selection state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  
  // Properties dialog state - supports multiple selection
  const [showPropertiesFor, setShowPropertiesFor] = useState<string[] | null>(null);

  // Properties are shown only via explicit "Egenskaper" button click

  // Sync localAssets when props change
  useEffect(() => {
    setLocalAssets(assets);
  }, [assets]);

  // On-demand sync: ALWAYS check database on mount, then sync if needed
  useEffect(() => {
    // Only for buildings with fmGuid
    if (!facility.fmGuid || facility.category !== 'Building') return;
    
    // Prevent multiple simultaneous syncs
    if (hasTriedSync) return;

    const initAssets = async () => {
      setHasTriedSync(true);
      setIsSyncingAssets(true);
      
      console.log('AssetsView: Initializing assets for building', facility.fmGuid);
      
      try {
        // Step 1: Always fetch from database first (ignore props)
        const existingAssets = await fetchAssetsForBuilding(facility.fmGuid!);
        console.log('AssetsView: Found', existingAssets.length, 'existing assets in database');
        
        if (existingAssets.length > 0) {
          // Map to expected format
          const mapped = existingAssets.map((asset: any) => ({
            fm_guid: asset.fmGuid,
            category: asset.category,
            name: asset.name,
            common_name: asset.commonName,
            building_fm_guid: asset.buildingFmGuid,
            level_fm_guid: asset.levelFmGuid,
            in_room_fm_guid: asset.inRoomFmGuid,
            complex_common_name: asset.complexCommonName,
            attributes: asset.attributes,
            is_local: asset.isLocal,
            created_in_model: asset.createdInModel,
            asset_type: asset.assetType,
            synced_at: asset.syncedAt,
            annotation_placed: asset.annotationPlaced,
            symbol_id: asset.symbolId,
          }));
          setLocalAssets(mapped);
          setIsSyncingAssets(false);
          return;
        }
        
        // Step 2: ACC-sourced buildings don't need Asset+ sync — their assets come from BIM import
        if (isAccSourcedBuilding(facility.fmGuid!)) {
          console.log('AssetsView: ACC-sourced building, skipping Asset+ sync');
          setIsSyncingAssets(false);
          return;
        }
        
        // Step 3: No local assets - trigger sync from Asset+
        console.log('AssetsView: No local assets, triggering sync...');
        const result = await syncBuildingAssetsIfNeeded(facility.fmGuid!);
        
        if (result.synced && result.count > 0) {
          // Fetch newly synced assets from database
          const newAssets = await fetchAssetsForBuilding(facility.fmGuid!);
          
          // Map to expected format
          const mapped = newAssets.map((asset: any) => ({
            fm_guid: asset.fmGuid,
            category: asset.category,
            name: asset.name,
            common_name: asset.commonName,
            building_fm_guid: asset.buildingFmGuid,
            level_fm_guid: asset.levelFmGuid,
            in_room_fm_guid: asset.inRoomFmGuid,
            complex_common_name: asset.complexCommonName,
            attributes: asset.attributes,
            is_local: asset.isLocal,
            created_in_model: asset.createdInModel,
            asset_type: asset.assetType,
            synced_at: asset.syncedAt,
            annotation_placed: asset.annotationPlaced,
            symbol_id: asset.symbolId,
          }));
          
          setLocalAssets(mapped);
          
          toast({
            title: 'Assets synced',
            description: `Fetched ${result.count} assets for this building`,
          });
        } else if (!result.synced) {
          console.log('AssetsView: Sync not triggered (already in sync or error)');
        }
      } catch (error: any) {
        console.error('AssetsView: Failed to sync assets:', error);
        toast({
          title: 'Could not sync assets',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setIsSyncingAssets(false);
      }
    };
    
    initAssets();
  }, [facility.fmGuid, facility.category, hasTriedSync, toast]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Helper to extract readable name from attribute key
  const extractPropertyName = (key: string): string => {
    const match = key.match(/^([a-zA-ZåäöÅÄÖ]+)/);
    if (match) {
      const baseName = match[1].toLowerCase();
      return baseName.charAt(0).toUpperCase() + baseName.slice(1);
    }
    return key;
  };

  // Dynamically extract ALL available columns from asset data (including User Defined)
  const allColumns: ColumnDef[] = useMemo(() => {
    const discoveredColumns = new Map<string, ColumnDef>();

    // Add system columns first
    SYSTEM_COLUMNS.forEach(col => {
      discoveredColumns.set(col.key, col);
    });

    // Add status columns
    STATUS_COLUMNS.forEach(col => {
      discoveredColumns.set(col.key, col);
    });

    // Scan all assets to find User Defined Properties
    localAssets.forEach(asset => {
      const attrs = asset.attributes || {};
      
      Object.entries(attrs).forEach(([key, value]: [string, any]) => {
        if (discoveredColumns.has(key)) return;
        if (key.startsWith('_') || key === 'tenantId' || key === 'checkedOut' || key === 'createdInModel') return;
        if (typeof value !== 'object' || !value) return;
        
        // This is a User Defined Property (has structure like {name, value, dataType, ...})
        if ('name' in value && 'value' in value) {
          const propertyName = value.name || extractPropertyName(key);
          discoveredColumns.set(key, {
            key,
            label: propertyName,
            category: 'userDefined',
          });
        }
      });
    });

    return Array.from(discoveredColumns.values());
  }, [localAssets]);

  // Helper to extract property values from attributes
  const extractPropertyValue = useCallback((
    attributes: Record<string, any> | undefined,
    key: string
  ): any => {
    if (!attributes) return null;

    // Direct access first
    if (key in attributes) {
      const val = attributes[key];
      if (val && typeof val === 'object' && 'value' in val) {
        return val.value;
      }
      return val;
    }

    // Try prefix matching for keys with hash suffixes
    const keyLower = key.toLowerCase();
    for (const attrKey of Object.keys(attributes)) {
      if (attrKey.toLowerCase().startsWith(keyLower)) {
        const propObj = attributes[attrKey];
        if (propObj && typeof propObj === 'object' && 'value' in propObj) {
          return propObj.value;
        }
      }
    }

    return null;
  }, []);

  // Transform raw asset data with deduplication
  const assetData: AssetData[] = useMemo(() => {
    // Deduplicate by fmGuid first to prevent duplicate entries
    const seenGuids = new Set<string>();
    const uniqueAssets = localAssets.filter((asset) => {
      const guid = asset.fm_guid || asset.fmGuid;
      if (!guid || seenGuids.has(guid)) return false;
      seenGuids.add(guid);
      return true;
    });
    
    return uniqueAssets.map((asset) => {
      const attrs = asset.attributes || {};
      const result: AssetData = {
        fmGuid: asset.fm_guid || asset.fmGuid,
        designation: asset.name || attrs.designation || '-',
        commonName: asset.common_name || attrs.commonName || '-',
        assetType: asset.asset_type || attrs.ObjectTypeValue || '-',
        category: asset.category || '-',
        levelFmGuid: asset.level_fm_guid || attrs.levelFmGuid,
        levelCommonName: attrs.levelCommonName || '-',
        roomFmGuid: asset.in_room_fm_guid || attrs.inRoomFmGuid,
        roomName: attrs.inRoomCommonName || '-',
        createdInModel: asset.created_in_model === true,
        annotationPlaced: asset.annotation_placed ?? false,
        buildingFmGuid: asset.building_fm_guid || attrs.buildingFmGuid,
        isLocal: asset.is_local ?? false,
        raw: asset,
      };

      // Extract User Defined property values
      allColumns.forEach(col => {
        if (col.category === 'userDefined') {
          result[col.key] = extractPropertyValue(attrs, col.key) || '-';
        }
      });

      return result;
    });
  }, [localAssets, allColumns, extractPropertyValue]);

  // Filter and sort assets
  const filteredAssets = useMemo(() => {
    let result = assetData.filter((asset) => {
      const searchLower = debouncedSearch.toLowerCase();
      return (
        visibleColumns.some((colKey) => {
          const val = asset[colKey];
          if (val === null || val === undefined || val === '-') return false;
          return String(val).toLowerCase().includes(searchLower);
        }) || asset.fmGuid.toLowerCase().includes(searchLower)
      );
    });

    // Apply filter mode
    if (filterMode === 'orphans') {
      result = result.filter((a) => !a.createdInModel);
    } else if (filterMode === 'no-annotation') {
      result = result.filter((a) => !a.annotationPlaced);
    } else if (filterMode === 'unsynced') {
      result = result.filter((a) => a.isLocal === true);
    }

    // Sort
    result.sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];

      // Handle boolean sorting
      if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        return sortDirection === 'asc'
          ? Number(aVal) - Number(bVal)
          : Number(bVal) - Number(aVal);
      }

      // Handle string sorting
      const aStr = String(aVal || '').toLowerCase();
      const bStr = String(bVal || '').toLowerCase();
      const comparison = aStr.localeCompare(bStr, 'sv', { numeric: true });
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [assetData, debouncedSearch, sortColumn, sortDirection, visibleColumns, filterMode]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const toggleColumn = (columnKey: string) => {
    setVisibleColumns((prev) => {
      if (prev.includes(columnKey)) {
        setColumnOrder((order) => order.filter((k) => k !== columnKey));
        return prev.filter((c) => c !== columnKey);
      } else {
        setColumnOrder((order) => [...order, columnKey]);
        return [...prev, columnKey];
      }
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumnOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleOpen3D = (asset: AssetData) => {
    if (onOpen3D) {
      // If this is a local asset (not in model), auto-enable local annotations
      if (asset.isLocal || !asset.createdInModel) {
        localStorage.setItem('viewer-show-local-annotations', 'true');
      }
      onOpen3D(asset.fmGuid, asset.levelFmGuid);
    }
  };

  const handlePlaceAnnotation = (asset: AssetData) => {
    // Use context to start annotation placement flow
    const buildingGuid = asset.buildingFmGuid || facility.fmGuid;
    if (buildingGuid) {
      startAnnotationPlacement(asset.raw, buildingGuid);
    } else if (onPlaceAnnotation) {
      onPlaceAnnotation(asset.raw);
    } else {
      toast({
        title: 'Place annotation',
        description: `Opening 3D viewer to place annotation for ${asset.designation}`,
      });
    }
  };

  // Handle syncing a single asset to Asset+
  const handleSyncToAssetPlus = useCallback(async (asset: AssetData) => {
    if (!asset.roomFmGuid) {
      toast({
        title: 'Cannot sync',
        description: 'Asset must be associated with a room to sync to Asset+',
        variant: 'destructive',
      });
      return;
    }

    setSyncingAssetIds((prev) => new Set(prev).add(asset.fmGuid));
    try {
      const result = await syncAssetToAssetPlus(asset.fmGuid);
      if (result.success) {
        toast({
          title: 'Synced!',
          description: `${asset.designation} has been synced to Asset+`,
        });
      } else {
        toast({
          title: 'Could not sync',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Sync error',
        description: error.message || 'Could not sync asset',
        variant: 'destructive',
      });
    } finally {
      setSyncingAssetIds((prev) => {
        const next = new Set(prev);
        next.delete(asset.fmGuid);
        return next;
      });
    }
  }, [toast]);

  // Handle batch sync of all unsynced assets
  const handleBatchSync = useCallback(async () => {
    const unsyncedAssets = assetData.filter((a) => a.isLocal && a.roomFmGuid);
    if (unsyncedAssets.length === 0) {
      toast({
        title: 'Nothing to sync',
        description: 'All assets are already synced or missing room association',
      });
      return;
    }

    setIsBatchSyncing(true);
    try {
      const fmGuids = unsyncedAssets.map((a) => a.fmGuid);
      const result = await batchSyncAssetsToAssetPlus(fmGuids);
      
      toast({
        title: 'Batch sync complete',
        description: `Synced ${result.synced} of ${result.total}. ${result.failed} failed.`,
        variant: result.failed > 0 ? 'destructive' : 'default',
      });
    } catch (error: any) {
      toast({
        title: 'Batch sync failed',
        description: error.message || 'Could not sync assets',
        variant: 'destructive',
      });
    } finally {
      setIsBatchSyncing(false);
    }
  }, [assetData, toast]);

  // Multi-selection handlers
  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(filteredAssets.map(a => a.fmGuid)));
    } else {
      setSelectedRows(new Set());
    }
  }, [filteredAssets]);

  const handleSelectRow = useCallback((fmGuid: string, checked: boolean) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(fmGuid);
      } else {
        newSet.delete(fmGuid);
      }
      return newSet;
    });
  }, []);

  // Batch action handlers - now supports multi-select
  const handleShowSelectedProperties = useCallback(() => {
    if (selectedRows.size > 0) {
      setShowPropertiesFor(Array.from(selectedRows));
    }
  }, [selectedRows]);

  const handleBatchPlaceAnnotation = useCallback(() => {
    const selectedAssets = filteredAssets.filter(a => 
      selectedRows.has(a.fmGuid) && !a.createdInModel && !a.annotationPlaced
    );
    
    if (selectedAssets.length === 0) {
      toast({
        title: 'Nothing to place',
        description: 'Selected assets are already in the model or have an annotation',
      });
      return;
    }
    
    // Place first one - user needs to do one at a time
    handlePlaceAnnotation(selectedAssets[0]);
  }, [selectedRows, filteredAssets, toast, handlePlaceAnnotation]);

  const handleBatchSyncSelected = useCallback(async () => {
    const selectedAssets = filteredAssets.filter(a => 
      selectedRows.has(a.fmGuid) && a.isLocal && a.roomFmGuid
    );
    
    if (selectedAssets.length === 0) {
      toast({
        title: 'Nothing to sync',
        description: 'Selected assets are already synced or missing room association',
      });
      return;
    }

    setIsBatchSyncing(true);
    try {
      const fmGuids = selectedAssets.map(a => a.fmGuid);
      const result = await batchSyncAssetsToAssetPlus(fmGuids);
      
      toast({
        title: 'Sync complete',
        description: `Synced ${result.synced} of ${result.total}`,
        variant: result.failed > 0 ? 'destructive' : 'default',
      });
    } catch (error: any) {
      toast({
        title: 'Sync failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsBatchSyncing(false);
    }
  }, [selectedRows, filteredAssets, toast]);

  // Sync column order with visible columns
  const orderedVisibleColumns = useMemo(() => {
    const ordered = columnOrder.filter((key) => visibleColumns.includes(key));
    const newCols = visibleColumns.filter((key) => !columnOrder.includes(key));
    return [...ordered, ...newCols];
  }, [columnOrder, visibleColumns]);

  // Format cell value
  const formatCellValue = (colKey: string, value: any): React.ReactNode => {
    if (value === null || value === undefined || value === '-') return '-';

    if (colKey === 'createdInModel' || colKey === 'annotationPlaced') {
      return value ? (
        <Badge variant="default" className="bg-green-600">Yes</Badge>
      ) : (
        <Badge variant="secondary">No</Badge>
      );
    }

    // isLocal: false means synced (good), true means not synced (needs action)
    if (colKey === 'isLocal') {
      return value ? (
        <Badge variant="secondary" className="bg-amber-500/20 text-amber-600">Not synced</Badge>
      ) : (
        <Badge variant="default" className="bg-green-600">Synced</Badge>
      );
    }

    return String(value);
  };

  const orphanCount = assetData.filter((a) => !a.createdInModel).length;
  const noAnnotationCount = assetData.filter((a) => !a.annotationPlaced).length;
  const unsyncedCount = assetData.filter((a) => a.isLocal === true).length;
  
  // Count how many selected can have annotation placed
  const selectedCanPlaceAnnotation = filteredAssets.filter(a => 
    selectedRows.has(a.fmGuid) && !a.createdInModel && !a.annotationPlaced
  ).length;
  
  // Count how many selected can be synced
  const selectedCanSync = filteredAssets.filter(a => 
    selectedRows.has(a.fmGuid) && a.isLocal && a.roomFmGuid
  ).length;

  const title =
    facility.category === 'Building'
      ? `Assets in ${facility.commonName || facility.name}`
      : `Assets on ${facility.commonName || facility.name}`;

  // Show loading spinner if syncing assets
  if (isSyncingAssets) {
    return (
      <div className="absolute inset-0 z-40 bg-background flex flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg font-medium">Syncing assets...</p>
        <p className="text-sm text-muted-foreground mt-1">
          Fetching assets for this building from Asset+
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="border-b px-2 sm:px-3 md:px-4 py-2 sm:py-3 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Box className="h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base md:text-lg font-bold truncate">{title}</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
              {filteredAssets.length} of {assetData.length} assets
              {orphanCount > 0 && (
                <span className="ml-2 text-amber-500">
                  • {orphanCount} not in model
                </span>
              )}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 sm:h-9 sm:w-9 shrink-0">
          <ArrowLeft size={16} className="sm:hidden" />
          <ArrowLeft size={20} className="hidden sm:block" />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="border-b px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search assets..."
            className="pl-7 sm:pl-9 h-8 sm:h-9 text-xs sm:text-sm"
          />
        </div>

        {/* Filter dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              {filterMode === 'all'
                ? 'All'
                : filterMode === 'orphans'
                  ? 'Not in model'
                  : filterMode === 'unsynced'
                    ? 'Not synced'
                    : 'No annotation'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover">
            <DropdownMenuLabel>Filter</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setFilterMode('all')}>
              <Check className={`h-4 w-4 mr-2 ${filterMode === 'all' ? 'opacity-100' : 'opacity-0'}`} />
              All assets
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterMode('orphans')}>
              <Check className={`h-4 w-4 mr-2 ${filterMode === 'orphans' ? 'opacity-100' : 'opacity-0'}`} />
              Not in model ({orphanCount})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterMode('no-annotation')}>
              <Check className={`h-4 w-4 mr-2 ${filterMode === 'no-annotation' ? 'opacity-100' : 'opacity-0'}`} />
              No annotation ({noAnnotationCount})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterMode('unsynced')}>
              <Check className={`h-4 w-4 mr-2 ${filterMode === 'unsynced' ? 'opacity-100' : 'opacity-0'}`} />
              Not synced ({unsyncedCount})
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Column selector dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 sm:h-9 gap-2">
              <Settings2 size={14} />
              <span className="hidden sm:inline">Columns</span>
              <Badge variant="secondary" className="text-xs ml-1">{visibleColumns.length}</Badge>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto bg-popover">
            <DropdownMenuLabel>System properties</DropdownMenuLabel>
            {SYSTEM_COLUMNS.map(col => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={visibleColumns.includes(col.key)}
                onCheckedChange={() => toggleColumn(col.key)}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {STATUS_COLUMNS.map(col => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={visibleColumns.includes(col.key)}
                onCheckedChange={() => toggleColumn(col.key)}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
            {allColumns.filter(c => c.category === 'userDefined').length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>User defined</DropdownMenuLabel>
                {allColumns.filter(c => c.category === 'userDefined').map(col => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={visibleColumns.includes(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* View mode toggles */}
        <div className="flex items-center gap-1 border rounded-lg p-1">
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid size={14} />
          </Button>
          <Button
            variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode('gallery')}
          >
            <List size={14} />
          </Button>
        </div>
      </div>

      {/* Selection toolbar - shown when rows are selected */}
      {selectedRows.size > 0 && (
        <div className="border-b px-4 py-2 flex items-center gap-2 bg-muted/50 shrink-0">
          <Badge variant="secondary">{selectedRows.size} selected</Badge>
          
          <Button size="sm" variant="outline" onClick={handleShowSelectedProperties} className="gap-1">
            <Info size={14} />
            Properties
          </Button>
          
          {selectedCanPlaceAnnotation > 0 && (
            <Button size="sm" variant="outline" onClick={handleBatchPlaceAnnotation} className="gap-1">
              <MapPin size={14} />
              Place ({selectedCanPlaceAnnotation})
            </Button>
          )}
          
          {selectedCanSync > 0 && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={handleBatchSyncSelected} 
              disabled={isBatchSyncing}
              className="gap-1"
            >
              {isBatchSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sync ({selectedCanSync})
            </Button>
          )}
          
          <Button size="sm" variant="ghost" onClick={() => setSelectedRows(new Set())} className="gap-1 ml-auto">
            <ArrowLeft size={14} />
            Deselect
          </Button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'grid' ? (
          <div className="p-2 sm:p-4">
            <div className="border rounded-lg overflow-x-auto">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    {/* Checkbox column header */}
                    <TableHead className="bg-muted/50 w-10">
                      <Checkbox
                        checked={selectedRows.size === filteredAssets.length && filteredAssets.length > 0}
                        onCheckedChange={(checked) => handleSelectAll(!!checked)}
                      />
                    </TableHead>
                    <SortableContext
                      items={orderedVisibleColumns}
                      strategy={horizontalListSortingStrategy}
                    >
                      {orderedVisibleColumns.map((colKey) => {
                        const col = allColumns.find((c) => c.key === colKey);
                        return col ? (
                          <SortableColumnHeader
                            key={colKey}
                            id={colKey}
                            label={col.label}
                            sortColumn={sortColumn}
                            sortDirection={sortDirection}
                            onSort={handleSort}
                          />
                        ) : null;
                      })}
                    </SortableContext>
                    <TableHead className="bg-muted/50 w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.map((asset) => (
                    <TableRow 
                      key={asset.fmGuid} 
                      className={`hover:bg-muted/30 cursor-pointer ${selectedRows.has(asset.fmGuid) ? 'bg-muted/50' : ''}`}
                      onClick={() => onSelectAsset?.(asset.fmGuid)}
                    >
                      {/* Checkbox cell */}
                      <TableCell className="py-2 w-10" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedRows.has(asset.fmGuid)}
                          onCheckedChange={(checked) => handleSelectRow(asset.fmGuid, !!checked)}
                        />
                      </TableCell>
                      {orderedVisibleColumns.map((colKey) => (
                        <TableCell key={colKey} className="py-1.5 sm:py-2 whitespace-nowrap text-[11px] sm:text-sm">
                          {formatCellValue(colKey, asset[colKey])}
                        </TableCell>
                      ))}
                      <TableCell className="py-2">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowPropertiesFor([asset.fmGuid]);
                            }}
                            title="Properties"
                          >
                            <Info size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpen3D(asset);
                            }}
                            title="Open in 3D"
                          >
                            <Cuboid size={14} />
                          </Button>
                          {/* Only show place annotation for assets NOT in model and without annotation */}
                          {!asset.createdInModel && !asset.annotationPlaced && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-amber-500 hover:text-amber-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlaceAnnotation(asset);
                              }}
                              title="Place annotation"
                            >
                              <MapPin size={14} />
                            </Button>
                          )}
                          {asset.isLocal && asset.roomFmGuid && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-blue-500 hover:text-blue-600"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSyncToAssetPlus(asset);
                              }}
                              disabled={syncingAssetIds.has(asset.fmGuid)}
                              title="Sync to Asset+"
                            >
                              {syncingAssetIds.has(asset.fmGuid) ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <RefreshCw size={14} />
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredAssets.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={orderedVisibleColumns.length + 2}
                        className="text-center py-12 text-muted-foreground"
                      >
                        <Box className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Inga assets hittades</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </DndContext>
            </div>
          </div>
        ) : (
          <div className="p-2 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {filteredAssets.map((asset) => (
                <Card
                  key={asset.fmGuid}
                  className={`group hover:shadow-md transition-shadow cursor-pointer ${
                    selectedRows.has(asset.fmGuid) ? 'ring-2 ring-primary' : ''
                  }`}
                  onClick={() => handleSelectRow(asset.fmGuid, !selectedRows.has(asset.fmGuid))}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-2">
                      <Box className="h-4 w-4 text-primary" />
                      <div className="flex items-center gap-1">
                        {!asset.createdInModel && (
                          <span title="Ej i modell">
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                          </span>
                        )}
                        <Checkbox
                          checked={selectedRows.has(asset.fmGuid)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={(checked) => handleSelectRow(asset.fmGuid, !!checked)}
                        />
                      </div>
                    </div>
                    <h3 className="font-medium text-sm truncate">
                      {asset.designation}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {asset.commonName}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-muted-foreground truncate">
                        {asset.assetType}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpen3D(asset);
                          }}
                        >
                          <Cuboid size={12} />
                        </Button>
                        {!asset.createdInModel && !asset.annotationPlaced && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-amber-500"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlaceAnnotation(asset);
                            }}
                          >
                            <MapPin size={12} />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredAssets.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  <Box className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Inga assets hittades</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Properties dialog - supports multi-select */}
      {showPropertiesFor && showPropertiesFor.length > 0 && (
        <UniversalPropertiesDialog
          isOpen={true}
          fmGuids={showPropertiesFor}
          onClose={() => {
            setShowPropertiesFor(null);
            setSelectedRows(new Set());
          }}
          onUpdate={() => {
            // Refresh assets after update
            setShowPropertiesFor(null);
            setSelectedRows(new Set());
          }}
        />
      )}
    </div>
  );
};

export default AssetsView;
