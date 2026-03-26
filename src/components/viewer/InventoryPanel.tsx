/**
 * InventoryPanel — Full-width bottom drawer with advanced table.
 * Draggable columns, sortable, column selector (incl. all asset properties),
 * fly-to + blue highlight on click, custom right-click context menu.
 * Default filter: object_type = 4 (Object).
 */

import React, { useContext, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { cn, normalizeGuid } from '@/lib/utils';
import {
  Package, X, Search, ArrowUpDown, ChevronDown, ChevronUp,
  GripVertical, GripHorizontal, Settings2, Pencil,
} from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { FLOOR_SELECTION_CHANGED_EVENT, FloorSelectionEventDetail } from '@/hooks/useSectionPlaneClipping';
import { supabase } from '@/integrations/supabase/client';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  horizontalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import UniversalPropertiesDialog from '@/components/common/UniversalPropertiesDialog';

interface InventoryPanelProps {
  buildingFmGuid: string;
  buildingName?: string;
  open: boolean;
  onClose: () => void;
}

interface AssetRow {
  fmGuid: string;
  name: string;
  category: string;
  assetType: string;
  levelFmGuid: string;
  levelName: string;
  roomFmGuid: string;
  roomName: string;
  systemNames: string[];
  attributes: Record<string, any>;
  rawData: any;
}

interface ColumnDef {
  key: string;
  label: string;
  group: 'core' | 'property';
}

// Object type categories mapping (object_type = 4 means real "Objects" in Asset Plus)
const OBJECT_TYPE_4_CATEGORIES = new Set([
  'IfcDistributionControlElement', 'IfcFlowTerminal', 'IfcFlowSegment',
  'IfcFlowFitting', 'IfcFlowController', 'IfcFlowMovingDevice',
  'IfcFlowStorageDevice', 'IfcFlowTreatmentDevice', 'IfcEnergyConversionDevice',
  'IfcDistributionFlowElement', 'IfcDistributionElement', 'IfcBuildingElementProxy',
  'IfcFurnishingElement', 'IfcTransportElement', 'IfcAlarm', 'IfcSensor',
  'IfcActuator', 'IfcController', 'IfcFireSuppressionTerminal',
  'IfcSanitaryTerminal', 'IfcLightFixture', 'IfcOutlet',
  'IfcElectricAppliance', 'IfcCommunicationsAppliance', 'IfcAudioVisualAppliance',
]);

const CORE_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', group: 'core' },
  { key: 'assetType', label: 'Type', group: 'core' },
  { key: 'category', label: 'Category', group: 'core' },
  { key: 'levelName', label: 'Floor', group: 'core' },
  { key: 'roomName', label: 'Room', group: 'core' },
  { key: 'systemNames', label: 'System', group: 'core' },
  { key: 'fmGuid', label: 'FMGUID', group: 'core' },
];

const DEFAULT_VISIBLE = ['name', 'assetType', 'category', 'levelName', 'roomName'];

// ─── Sortable column header ─────────────────────────────────────────
const SortableColumnHeader: React.FC<{
  id: string;
  label: string;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  onSort: (col: string) => void;
}> = ({ id, label, sortColumn, sortDirection, onSort }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableHead ref={setNodeRef} style={style} className="select-none whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider h-7 px-1.5">
      <div className="flex items-center gap-0.5">
        <span {...attributes} {...listeners} className="cursor-grab hover:text-primary">
          <GripVertical size={10} className="text-muted-foreground" />
        </span>
        <span className="cursor-pointer hover:text-primary flex items-center gap-0.5" onClick={() => onSort(id)}>
          {label}
          {sortColumn === id ? (
            sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
          ) : (
            <ArrowUpDown size={10} className="text-muted-foreground" />
          )}
        </span>
      </div>
    </TableHead>
  );
};

// ─── Main component ─────────────────────────────────────────────────
export default function InventoryPanel({ buildingFmGuid, buildingName, open, onClose }: InventoryPanelProps) {
  const { allData } = useContext(AppContext);
  const [search, setSearch] = useState('');
  const [visibleFloorGuids, setVisibleFloorGuids] = useState<string[]>([]);
  const [isAllFloors, setIsAllFloors] = useState(true);
  const [systemMap, setSystemMap] = useState<Map<string, string[]>>(new Map());
  const [selectedFmGuid, setSelectedFmGuid] = useState<string | null>(null);

  // Column state
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE);
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_VISIBLE);
  const [sortColumn, setSortColumn] = useState('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Resizable height
  const [panelHeight, setPanelHeight] = useState(35);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(35);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; asset: AssetRow } | null>(null);

  // Properties dialog
  const [propertiesAsset, setPropertiesAsset] = useState<AssetRow | null>(null);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Floor selection listener
  useEffect(() => {
    const handler = (e: CustomEvent<FloorSelectionEventDetail>) => {
      if (e.detail.isAllFloorsVisible) {
        setIsAllFloors(true);
        setVisibleFloorGuids([]);
      } else if (e.detail.visibleFloorFmGuids?.length > 0) {
        setIsAllFloors(false);
        setVisibleFloorGuids(e.detail.visibleFloorFmGuids);
      }
    };
    window.addEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
    return () => window.removeEventListener(FLOOR_SELECTION_CHANGED_EVENT, handler as EventListener);
  }, []);

  // Close context menu on click elsewhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  // Fetch system memberships
  useEffect(() => {
    if (!open || !buildingFmGuid) return;
    const fetchSystems = async () => {
      const { data: systems } = await supabase.from('systems').select('id, name').eq('building_fm_guid', buildingFmGuid);
      const { data: assetSystems } = await supabase.from('asset_system').select('asset_fm_guid, system_id');
      if (systems && assetSystems) {
        const sysNameMap = new Map(systems.map(s => [s.id, s.name]));
        const map = new Map<string, string[]>();
        assetSystems.forEach(as => {
          const name = sysNameMap.get(as.system_id);
          if (name) {
            const existing = map.get(as.asset_fm_guid) || [];
            existing.push(name);
            map.set(as.asset_fm_guid, existing);
          }
        });
        setSystemMap(map);
      }
    };
    fetchSystems();
  }, [open, buildingFmGuid]);

  // Discover all unique property keys from assets' attributes
  const propertyColumns: ColumnDef[] = useMemo(() => {
    if (!allData || !buildingFmGuid) return [];
    const normalizedBuildingGuid = normalizeGuid(buildingFmGuid);
    const propKeys = new Set<string>();
    allData.forEach((a: any) => {
      if (normalizeGuid(a.buildingFmGuid || a.building_fm_guid || '') !== normalizedBuildingGuid) return;
      const attrs = a.attributes || {};
      if (typeof attrs === 'object') {
        Object.keys(attrs).forEach(k => propKeys.add(k));
      }
    });
    return Array.from(propKeys).sort().map(k => ({
      key: `attr:${k}`,
      label: k,
      group: 'property' as const,
    }));
  }, [allData, buildingFmGuid]);

  const allColumns = useMemo(() => [...CORE_COLUMNS, ...propertyColumns], [propertyColumns]);

  // Build asset rows — default: object_type = 4 equivalent
  const allAssets: AssetRow[] = useMemo(() => {
    if (!allData || !buildingFmGuid) return [];
    const normalizedBuildingGuid = normalizeGuid(buildingFmGuid);
    const buildingAssets = allData.filter((a: any) => {
      const bGuid = normalizeGuid(a.buildingFmGuid || a.building_fm_guid || '');
      if (bGuid !== normalizedBuildingGuid) return false;
      const cat = a.category || '';
      // Exclude structural / spatial categories — keep only "objects"
      if (['Building', 'Building Storey', 'Space', 'IfcSpace', 'IfcSite',
           'IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcRoof',
           'IfcColumn', 'IfcBeam', 'IfcStair', 'IfcRailing', 'IfcCovering',
           'IfcCurtainWall', 'IfcPlate', 'IfcMember', 'IfcFooting',
           'IfcPile', 'IfcWindow', 'IfcDoor'].includes(cat)) {
        return false;
      }
      return true;
    });

    const levelNameMap = new Map<string, string>();
    const roomNameMap = new Map<string, string>();
    allData.forEach((a: any) => {
      const fmGuid = a.fmGuid || a.fm_guid;
      if (a.category === 'Building Storey' && normalizeGuid(a.buildingFmGuid || a.building_fm_guid || '') === normalizedBuildingGuid) {
        levelNameMap.set(normalizeGuid(fmGuid), a.commonName || a.common_name || a.name || '');
      }
      if ((a.category === 'Space' || a.category === 'IfcSpace') && normalizeGuid(a.buildingFmGuid || a.building_fm_guid || '') === normalizedBuildingGuid) {
        roomNameMap.set(normalizeGuid(fmGuid), a.commonName || a.common_name || a.name || '');
      }
    });

    return buildingAssets.map((a: any) => {
      const fmGuid = a.fmGuid || a.fm_guid;
      const levelGuid = a.levelFmGuid || a.level_fm_guid || '';
      const roomGuid = a.inRoomFmGuid || a.in_room_fm_guid || '';
      return {
        fmGuid,
        name: a.commonName || a.common_name || a.name || 'Unnamed',
        category: a.category || '',
        assetType: a.assetType || a.asset_type || '',
        levelFmGuid: levelGuid,
        levelName: levelNameMap.get(normalizeGuid(levelGuid)) || '',
        roomFmGuid: roomGuid,
        roomName: roomNameMap.get(normalizeGuid(roomGuid)) || '',
        systemNames: systemMap.get(fmGuid) || [],
        attributes: (typeof a.attributes === 'object' && a.attributes) ? a.attributes : {},
        rawData: a,
      };
    });
  }, [allData, buildingFmGuid, systemMap]);

  // Filter & sort
  const filteredAssets = useMemo(() => {
    let result = allAssets;
    if (!isAllFloors && visibleFloorGuids.length > 0) {
      const normGuids = new Set(visibleFloorGuids.map(g => normalizeGuid(g)));
      result = result.filter(a => normGuids.has(normalizeGuid(a.levelFmGuid)));
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) ||
        a.assetType.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.levelName.toLowerCase().includes(q) ||
        a.roomName.toLowerCase().includes(q) ||
        a.fmGuid.toLowerCase().includes(q) ||
        a.systemNames.some(s => s.toLowerCase().includes(q))
      );
    }
    result = [...result].sort((a, b) => {
      const aVal = getCellValue(a, sortColumn);
      const bVal = getCellValue(b, sortColumn);
      const cmp = aVal.localeCompare(bVal, 'sv', { numeric: true });
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [allAssets, isAllFloors, visibleFloorGuids, search, sortColumn, sortDirection]);

  // Fly-to + select on row click
  const handleRowClick = useCallback((asset: AssetRow) => {
    setSelectedFmGuid(asset.fmGuid);
    window.dispatchEvent(new CustomEvent('VIEWER_FLY_TO', { detail: { fmGuid: asset.fmGuid } }));
    // Also select the entity in the viewer
    window.dispatchEvent(new CustomEvent('VIEWER_SELECT_ENTITY', { detail: { entityId: asset.fmGuid } }));
  }, []);

  // Right-click handler
  const handleRowContextMenu = useCallback((e: React.MouseEvent, asset: AssetRow) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, asset });
  }, []);

  // Open properties from context menu
  const handleEditFromContextMenu = useCallback(() => {
    if (contextMenu) {
      setPropertiesAsset(contextMenu.asset);
      setContextMenu(null);
    }
  }, [contextMenu]);

  // Sorting
  const handleSort = useCallback((col: string) => {
    setSortColumn(prev => {
      if (prev === col) {
        setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
        return col;
      }
      setSortDirection('asc');
      return col;
    });
  }, []);

  // Column toggling
  const toggleColumn = useCallback((key: string) => {
    setVisibleColumns(prev => {
      if (prev.includes(key)) {
        setColumnOrder(o => o.filter(k => k !== key));
        return prev.filter(c => c !== key);
      }
      setColumnOrder(o => [...o, key]);
      return [...prev, key];
    });
  }, []);

  // Column drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumnOrder(items => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }, []);

  const orderedColumns = useMemo(() => {
    return columnOrder.filter(k => visibleColumns.includes(k));
  }, [columnOrder, visibleColumns]);

  // Resize handle
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    startYRef.current = clientY;
    startHeightRef.current = panelHeight;
    const handleMove = (ev: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;
      const y = 'touches' in ev ? ev.touches[0].clientY : ev.clientY;
      const deltaVh = ((startYRef.current - y) / window.innerHeight) * 100;
      const newH = Math.max(15, Math.min(70, startHeightRef.current + deltaVh));
      setPanelHeight(newH);
    };
    const handleUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleUp);
  }, [panelHeight]);

  if (!open) return null;

  return (
    <>
      <div
        className={cn(
          'border-t border-border bg-background/95 backdrop-blur-md flex flex-col',
          isMobile ? 'fixed inset-0 z-50' : 'fixed bottom-0 left-0 right-0 z-40',
        )}
        style={isMobile ? undefined : { height: `${panelHeight}vh` }}
        onContextMenu={e => e.preventDefault()}
      >
        {/* Resize handle (desktop) */}
        {!isMobile && (
          <div
            className="h-2 cursor-row-resize flex items-center justify-center hover:bg-muted/50 transition-colors shrink-0 group"
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
          >
            <GripHorizontal className="h-3 w-3 text-muted-foreground group-hover:text-foreground" />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1 border-b border-border/50 shrink-0">
          <div className="flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              ASSET PANEL
              <Badge variant="outline" className="ml-1.5 text-[9px] px-1 py-0 h-4 font-normal">
                {filteredAssets.length}
                {filteredAssets.length !== allAssets.length && ` / ${allAssets.length}`}
              </Badge>
            </span>
            {buildingName && (
              <span className="text-muted-foreground font-normal text-xs ml-1">– {buildingName}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Column selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 gap-1 text-[10px] text-muted-foreground px-1.5">
                  <Settings2 className="h-3 w-3" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
                <DropdownMenuLabel className="text-[10px]">Standard columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {CORE_COLUMNS.map(col => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={visibleColumns.includes(col.key)}
                    onCheckedChange={() => toggleColumn(col.key)}
                    className="text-[11px]"
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
                {propertyColumns.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px]">Properties</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {propertyColumns.map(col => (
                      <DropdownMenuCheckboxItem
                        key={col.key}
                        checked={visibleColumns.includes(col.key)}
                        onCheckedChange={() => toggleColumn(col.key)}
                        className="text-[11px]"
                      >
                        {col.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assets…"
                className="h-6 pl-6 w-40 text-[11px]"
              />
            </div>

            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Table */}
        <ScrollArea className="flex-1 min-h-0">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableContext items={orderedColumns} strategy={horizontalListSortingStrategy}>
                    {orderedColumns.map(colKey => {
                      const col = allColumns.find(c => c.key === colKey);
                      if (!col) return null;
                      return (
                        <SortableColumnHeader
                          key={col.key}
                          id={col.key}
                          label={col.label}
                          sortColumn={sortColumn}
                          sortDirection={sortDirection}
                          onSort={handleSort}
                        />
                      );
                    })}
                  </SortableContext>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssets.slice(0, 500).map(asset => (
                  <TableRow
                    key={asset.fmGuid}
                    className={cn(
                      'cursor-pointer text-[11px] leading-tight',
                      selectedFmGuid === asset.fmGuid
                        ? 'bg-primary/20 hover:bg-primary/25 text-foreground ring-1 ring-inset ring-primary/30'
                        : 'hover:bg-muted/50',
                    )}
                    onClick={() => handleRowClick(asset)}
                    onContextMenu={(e) => handleRowContextMenu(e, asset)}
                  >
                    {orderedColumns.map(colKey => (
                      <TableCell key={colKey} className="py-0.5 px-1.5 truncate max-w-[180px]">
                        {renderCell(asset, colKey)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {filteredAssets.length > 500 && (
                  <TableRow>
                    <TableCell colSpan={orderedColumns.length} className="text-center text-[10px] text-muted-foreground py-1.5">
                      Showing 500 of {filteredAssets.length} assets. Use search to filter.
                    </TableCell>
                  </TableRow>
                )}
                {filteredAssets.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={orderedColumns.length} className="text-center text-[10px] text-muted-foreground py-6">
                      {search ? 'No matching assets.' : 'No assets in this building.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </ScrollArea>
      </div>

      {/* Custom right-click context menu */}
      {contextMenu && (
        <div
          className="fixed z-[9999] min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md animate-in fade-in-80"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition-colors cursor-default"
            onClick={handleEditFromContextMenu}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        </div>
      )}

      {/* Properties Dialog */}
      {propertiesAsset && (
        <UniversalPropertiesDialog
          isOpen={!!propertiesAsset}
          onClose={() => setPropertiesAsset(null)}
          fmGuids={propertiesAsset.fmGuid}
          category={propertiesAsset.category}
        />
      )}
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function getCellValue(asset: AssetRow, key: string): string {
  if (key.startsWith('attr:')) {
    const attrKey = key.slice(5);
    const val = asset.attributes?.[attrKey];
    return val != null ? String(val) : '';
  }
  switch (key) {
    case 'name': return asset.name;
    case 'assetType': return asset.assetType;
    case 'category': return asset.category;
    case 'levelName': return asset.levelName;
    case 'roomName': return asset.roomName;
    case 'systemNames': return asset.systemNames.join(', ');
    case 'fmGuid': return asset.fmGuid;
    default: return '';
  }
}

function renderCell(asset: AssetRow, key: string): React.ReactNode {
  if (key.startsWith('attr:')) {
    const attrKey = key.slice(5);
    const val = asset.attributes?.[attrKey];
    return <span className="text-muted-foreground">{val != null ? String(val) : '–'}</span>;
  }
  switch (key) {
    case 'name':
      return <span className="font-medium">{asset.name}</span>;
    case 'assetType':
      return <span className="text-muted-foreground">{asset.assetType}</span>;
    case 'category':
      return <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">{asset.category}</Badge>;
    case 'levelName':
      return <span className="text-muted-foreground">{asset.levelName}</span>;
    case 'roomName':
      return <span className="text-muted-foreground">{asset.roomName}</span>;
    case 'systemNames':
      return <span className="text-muted-foreground">{asset.systemNames.length > 0 ? asset.systemNames.join(', ') : '–'}</span>;
    case 'fmGuid':
      return <span className="text-muted-foreground font-mono text-[9px]">{asset.fmGuid}</span>;
    default:
      return null;
  }
}
