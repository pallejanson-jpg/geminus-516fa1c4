import React, { useState, useMemo, useCallback, useEffect, useContext } from 'react';
import {
  X,
  Search,
  LayoutGrid,
  List,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Box,
  Cuboid,
  Settings2,
  GripVertical,
  ChevronRight,
  Check,
  FolderOpen,
  Folder,
  MapPin,
  Filter,
  AlertCircle,
  Loader2,
  RefreshCw,
  CloudUpload,
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
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Facility } from '@/lib/types';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { AppContext } from '@/context/AppContext';
import { syncBuildingAssetsIfNeeded, syncAssetToAssetPlus, batchSyncAssetsToAssetPlus } from '@/services/asset-plus-service';
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
}

interface ColumnDef {
  key: string;
  label: string;
  category: 'system' | 'userDefined' | 'status';
}

// System property definitions
const SYSTEM_COLUMNS: ColumnDef[] = [
  { key: 'designation', label: 'Beteckning', category: 'system' },
  { key: 'commonName', label: 'Namn', category: 'system' },
  { key: 'assetType', label: 'Typ', category: 'system' },
  { key: 'category', label: 'Kategori', category: 'system' },
  { key: 'levelCommonName', label: 'Våning', category: 'system' },
  { key: 'roomName', label: 'Rum', category: 'system' },
  { key: 'fmGuid', label: 'FMGUID', category: 'system' },
];

// Status columns
const STATUS_COLUMNS: ColumnDef[] = [
  { key: 'createdInModel', label: 'I modell', category: 'status' },
  { key: 'annotationPlaced', label: 'Annotation', category: 'status' },
  { key: 'isLocal', label: 'Synkad', category: 'status' },
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

// Column Selector Tree Component
const ColumnSelectorTree: React.FC<{
  columns: ColumnDef[];
  visibleColumns: string[];
  onToggle: (key: string) => void;
}> = ({ columns, visibleColumns, onToggle }) => {
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    system: true,
    status: true,
    userDefined: true,
  });

  const groupedColumns = useMemo(() => {
    const groups: Record<string, ColumnDef[]> = {
      system: [],
      status: [],
      userDefined: [],
    };
    columns.forEach((col) => {
      if (groups[col.category]) {
        groups[col.category].push(col);
      }
    });
    return groups;
  }, [columns]);

  const categoryLabels: Record<string, string> = {
    system: 'Systemegenskaper',
    status: 'Status',
    userDefined: 'Användardefinierade',
  };

  return (
    <div className="space-y-2">
      {Object.entries(groupedColumns).map(
        ([category, cols]) =>
          cols.length > 0 && (
            <Collapsible
              key={category}
              open={openCategories[category]}
              onOpenChange={(open) =>
                setOpenCategories((prev) => ({ ...prev, [category]: open }))
              }
            >
              <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-muted rounded-md transition-colors">
                <ChevronRight
                  size={14}
                  className={`transition-transform ${openCategories[category] ? 'rotate-90' : ''}`}
                />
                <Folder size={14} className="text-blue-500" />
                <span className="font-medium text-sm">{categoryLabels[category]}</span>
                <Badge variant="secondary" className="ml-auto text-xs">
                  {cols.filter((c) => visibleColumns.includes(c.key)).length}/{cols.length}
                </Badge>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-6 mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                  {cols.map((col) => (
                    <div
                      key={col.key}
                      className="flex items-center gap-2 p-1.5 hover:bg-muted/50 rounded cursor-pointer"
                      onClick={() => onToggle(col.key)}
                    >
                      <Checkbox
                        checked={visibleColumns.includes(col.key)}
                        onCheckedChange={() => onToggle(col.key)}
                      />
                      <span className="text-sm truncate">{col.label}</span>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
      )}
    </div>
  );
};

type FilterMode = 'all' | 'orphans' | 'no-annotation' | 'unsynced';

const AssetsView: React.FC<AssetsViewProps> = ({
  facility,
  assets,
  onClose,
  onOpen3D,
  onPlaceAnnotation,
}) => {
  const { toast } = useToast();
  const { startAnnotationPlacement } = useContext(AppContext);
  const [viewMode, setViewMode] = useState<'grid' | 'gallery'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string>('designation');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [isSyncingAssets, setIsSyncingAssets] = useState(false);
  const [syncingAssetIds, setSyncingAssetIds] = useState<Set<string>>(new Set());
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);

  // Check if we need to sync assets on mount (if zero assets for this building)
  useEffect(() => {
    const checkAndSyncAssets = async () => {
      if (assets.length > 0 || !facility.fmGuid) return;
      
      // Only for buildings - check if we need to sync
      if (facility.category !== 'Building') return;
      
      setIsSyncingAssets(true);
      try {
        const result = await syncBuildingAssetsIfNeeded(facility.fmGuid);
        if (result.synced && result.count > 0) {
          toast({
            title: 'Assets synkade',
            description: `Hämtade ${result.count} assets för denna byggnad`,
          });
        }
      } catch (error: any) {
        console.error('Failed to sync assets:', error);
        toast({
          title: 'Kunde inte synka assets',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setIsSyncingAssets(false);
      }
    };
    
    checkAndSyncAssets();
  }, [facility.fmGuid, facility.category, assets.length, toast]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // All available columns
  const allColumns: ColumnDef[] = useMemo(() => {
    return [...SYSTEM_COLUMNS, ...STATUS_COLUMNS];
  }, []);

  // Transform raw asset data
  const assetData: AssetData[] = useMemo(() => {
    return assets.map((asset) => {
      const attrs = asset.attributes || {};
      return {
        fmGuid: asset.fm_guid || asset.fmGuid,
        designation: asset.name || attrs.designation || '-',
        commonName: asset.common_name || attrs.commonName || '-',
        assetType: asset.asset_type || attrs.ObjectTypeValue || '-',
        category: asset.category || '-',
        levelFmGuid: asset.level_fm_guid || attrs.levelFmGuid,
        levelCommonName: attrs.levelCommonName || '-',
        roomFmGuid: asset.in_room_fm_guid || attrs.inRoomFmGuid,
        roomName: attrs.inRoomCommonName || '-',
        createdInModel: asset.created_in_model ?? attrs.createdInModel ?? true,
        annotationPlaced: asset.annotation_placed ?? false,
        buildingFmGuid: asset.building_fm_guid || attrs.buildingFmGuid,
        isLocal: asset.is_local ?? false,
        raw: asset,
      };
    });
  }, [assets]);

  // Filter and sort assets
  const filteredAssets = useMemo(() => {
    let result = assetData.filter((asset) => {
      const searchLower = searchQuery.toLowerCase();
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
  }, [assetData, searchQuery, sortColumn, sortDirection, visibleColumns, filterMode]);

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
        title: 'Placera annotation',
        description: `Öppnar 3D-viewern för att placera annotation för ${asset.designation}`,
      });
    }
  };

  // Handle syncing a single asset to Asset+
  const handleSyncToAssetPlus = useCallback(async (asset: AssetData) => {
    if (!asset.roomFmGuid) {
      toast({
        title: 'Kan inte synka',
        description: 'Asset måste vara kopplad till ett rum för att synkas till Asset+',
        variant: 'destructive',
      });
      return;
    }

    setSyncingAssetIds((prev) => new Set(prev).add(asset.fmGuid));
    try {
      const result = await syncAssetToAssetPlus(asset.fmGuid);
      if (result.success) {
        toast({
          title: 'Synkad!',
          description: `${asset.designation} har synkats till Asset+`,
        });
      } else {
        toast({
          title: 'Kunde inte synka',
          description: result.error || 'Okänt fel',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Synkfel',
        description: error.message || 'Kunde inte synka asset',
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
        title: 'Inga att synka',
        description: 'Alla assets är redan synkade eller saknar rum-koppling',
      });
      return;
    }

    setIsBatchSyncing(true);
    try {
      const fmGuids = unsyncedAssets.map((a) => a.fmGuid);
      const result = await batchSyncAssetsToAssetPlus(fmGuids);
      
      toast({
        title: 'Batch-synk klar',
        description: `Synkade ${result.synced} av ${result.total}. ${result.failed} misslyckades.`,
        variant: result.failed > 0 ? 'destructive' : 'default',
      });
    } catch (error: any) {
      toast({
        title: 'Batch-synk misslyckades',
        description: error.message || 'Kunde inte synka assets',
        variant: 'destructive',
      });
    } finally {
      setIsBatchSyncing(false);
    }
  }, [assetData, toast]);

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
        <Badge variant="default" className="bg-green-600">Ja</Badge>
      ) : (
        <Badge variant="secondary">Nej</Badge>
      );
    }

    // isLocal: false means synced (good), true means not synced (needs action)
    if (colKey === 'isLocal') {
      return value ? (
        <Badge variant="secondary" className="bg-amber-500/20 text-amber-600">Ej synkad</Badge>
      ) : (
        <Badge variant="default" className="bg-green-600">Synkad</Badge>
      );
    }

    return String(value);
  };

  const orphanCount = assetData.filter((a) => !a.createdInModel).length;
  const noAnnotationCount = assetData.filter((a) => !a.annotationPlaced).length;
  const unsyncedCount = assetData.filter((a) => a.isLocal === true).length;

  const title =
    facility.category === 'Building'
      ? `Assets i ${facility.commonName || facility.name}`
      : `Assets på ${facility.commonName || facility.name}`;

  // Show loading spinner if syncing assets
  if (isSyncingAssets) {
    return (
      <div className="absolute inset-0 z-40 bg-background flex flex-col items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
        <p className="text-lg font-medium">Synkar assets...</p>
        <p className="text-sm text-muted-foreground mt-1">
          Hämtar assets för denna byggnad från Asset+
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Box className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold text-lg">{title}</h2>
            <p className="text-sm text-muted-foreground">
              {filteredAssets.length} av {assetData.length} assets
              {orphanCount > 0 && (
                <span className="ml-2 text-amber-500">
                  • {orphanCount} ej i modell
                </span>
              )}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="border-b px-4 py-2 flex flex-wrap items-center gap-2 shrink-0">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Sök assets..."
            className="pl-9 h-9"
          />
        </div>

        {/* Filter dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="h-4 w-4" />
              {filterMode === 'all'
                ? 'Alla'
                : filterMode === 'orphans'
                  ? 'Ej i modell'
                  : filterMode === 'unsynced'
                    ? 'Ej synkade'
                    : 'Utan annotation'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Filtrera</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setFilterMode('all')}>
              <Check className={`h-4 w-4 mr-2 ${filterMode === 'all' ? 'opacity-100' : 'opacity-0'}`} />
              Alla assets
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterMode('orphans')}>
              <Check className={`h-4 w-4 mr-2 ${filterMode === 'orphans' ? 'opacity-100' : 'opacity-0'}`} />
              Ej i modell ({orphanCount})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterMode('no-annotation')}>
              <Check className={`h-4 w-4 mr-2 ${filterMode === 'no-annotation' ? 'opacity-100' : 'opacity-0'}`} />
              Utan annotation ({noAnnotationCount})
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilterMode('unsynced')}>
              <Check className={`h-4 w-4 mr-2 ${filterMode === 'unsynced' ? 'opacity-100' : 'opacity-0'}`} />
              Ej synkade ({unsyncedCount})
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Batch sync button */}
        {unsyncedCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleBatchSync}
            disabled={isBatchSyncing}
          >
            {isBatchSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CloudUpload className="h-4 w-4" />
            )}
            Synka alla ({unsyncedCount})
          </Button>
        )}

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

        {/* Column selector */}
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Settings2 size={14} />
              Kolumner
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80">
            <SheetHeader>
              <SheetTitle>Välj kolumner</SheetTitle>
            </SheetHeader>
            <div className="mt-4">
              <ColumnSelectorTree
                columns={allColumns}
                visibleColumns={visibleColumns}
                onToggle={toggleColumn}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {viewMode === 'grid' ? (
          <div className="p-4">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <Table>
                <TableHeader>
                  <TableRow>
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
                    <TableHead className="bg-muted/50 w-24">Åtgärder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.map((asset) => (
                    <TableRow key={asset.fmGuid} className="hover:bg-muted/30">
                      {orderedVisibleColumns.map((colKey) => (
                        <TableCell key={colKey} className="py-2">
                          {formatCellValue(colKey, asset[colKey])}
                        </TableCell>
                      ))}
                      <TableCell className="py-2">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleOpen3D(asset)}
                            title="Öppna i 3D"
                          >
                            <Cuboid size={14} />
                          </Button>
                          {!asset.annotationPlaced && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-amber-500 hover:text-amber-600"
                              onClick={() => handlePlaceAnnotation(asset)}
                              title="Placera annotation"
                            >
                              <MapPin size={14} />
                            </Button>
                          )}
                          {asset.isLocal && asset.roomFmGuid && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-blue-500 hover:text-blue-600"
                              onClick={() => handleSyncToAssetPlus(asset)}
                              disabled={syncingAssetIds.has(asset.fmGuid)}
                              title="Synka till Asset+"
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
                        colSpan={orderedVisibleColumns.length + 1}
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
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filteredAssets.map((asset) => (
                <Card
                  key={asset.fmGuid}
                  className="group hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleOpen3D(asset)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between mb-2">
                      <Box className="h-4 w-4 text-primary" />
                      {!asset.createdInModel && (
                        <span title="Ej i modell">
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                        </span>
                      )}
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
                      {!asset.annotationPlaced && (
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
      </ScrollArea>
    </div>
  );
};

export default AssetsView;
