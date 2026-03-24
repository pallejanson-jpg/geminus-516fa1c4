import React, { useState, useMemo, useCallback } from 'react';
import {
  ArrowLeft,
  Search,
  LayoutGrid,
  List,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  DoorOpen,
  Cuboid,
  Settings2,
  GripVertical,
  Info,
  Thermometer,
  Wind,
  Droplets,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VisualizationType, extractSensorValue, getVisualizationColor } from '@/lib/visualization-utils';
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
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Facility } from '@/lib/types';
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
import { useToast } from '@/hooks/use-toast';

// Deterministic color palette for room name grouping
const ROOM_NAME_COLORS = [
  'hsl(210, 70%, 55%)', 'hsl(142, 60%, 45%)', 'hsl(48, 85%, 50%)',
  'hsl(262, 65%, 55%)', 'hsl(330, 65%, 55%)', 'hsl(190, 70%, 45%)',
  'hsl(25, 75%, 50%)', 'hsl(100, 55%, 45%)', 'hsl(280, 55%, 60%)',
  'hsl(0, 65%, 55%)', 'hsl(170, 60%, 42%)', 'hsl(60, 70%, 48%)',
  'hsl(220, 55%, 60%)', 'hsl(305, 50%, 55%)', 'hsl(15, 80%, 52%)',
  'hsl(130, 50%, 50%)',
];

const ROOM_SENSOR_METRICS = [
  { key: 'temperature' as VisualizationType, label: 'Temp', unit: '°C', icon: Thermometer },
  { key: 'co2' as VisualizationType, label: 'CO₂', unit: 'ppm', icon: Wind },
  { key: 'humidity' as VisualizationType, label: 'Humidity', unit: '%', icon: Droplets },
  { key: 'occupancy' as VisualizationType, label: 'Occupancy', unit: '%', icon: Users },
] as const;

const rgbToHex = (rgb: [number, number, number]) =>
  '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');

interface RoomData {
  fmGuid: string;
  [key: string]: any;
}

interface RoomsViewProps {
  facility: Facility;
  rooms: any[];
  onClose: () => void;
  onOpen3D?: (fmGuid: string, levelFmGuid?: string) => void;
  onSelectRoom?: (fmGuid: string) => void;
}

interface ColumnDef {
  key: string;
  label: string;
  category: 'system' | 'userDefined' | 'calculated';
  dataType?: number;
}

// Helper to extract readable name from attribute key
const extractPropertyName = (key: string): string => {
  const match = key.match(/^([a-zA-ZåäöÅÄÖ]+)/);
  if (match) {
    const baseName = match[1].toLowerCase();
    return baseName.charAt(0).toUpperCase() + baseName.slice(1);
  }
  return key;
};

// System property definitions (always available)
const SYSTEM_COLUMNS: ColumnDef[] = [
  { key: 'commonName', label: 'Room Name', category: 'system' },
  { key: 'roomNumber', label: 'Room Number', category: 'system' },
  { key: 'designation', label: 'Designation', category: 'system' },
  { key: 'levelCommonName', label: 'Floor', category: 'system' },
  { key: 'buildingCommonName', label: 'Building', category: 'system' },
  { key: 'complexCommonName', label: 'Complex', category: 'system' },
  { key: 'category', label: 'Category', category: 'system' },
  { key: 'objectTypeValue', label: 'Object Type', category: 'system' },
  { key: 'fmGuid', label: 'FMGUID', category: 'system' },
];

// Calculated columns
const CALCULATED_COLUMNS: ColumnDef[] = [
  { key: 'nta', label: 'NTA (m²)', category: 'calculated', dataType: 3 },
  { key: 'omkrets', label: 'Perimeter (m)', category: 'calculated', dataType: 3 },
];

// Default visible columns
const DEFAULT_VISIBLE_COLUMNS = ['roomNumber', 'commonName', 'levelCommonName', 'nta'];

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

const RoomsView: React.FC<RoomsViewProps> = ({
  facility,
  rooms,
  onClose,
  onOpen3D,
  onSelectRoom,
}) => {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'grid' | 'gallery'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string>('roomNumber');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  
  // Sensor metric state
  const [activeSensorMetric, setActiveSensorMetric] = useState<VisualizationType>('none');
  
  // Auto-sort when sensor metric is activated
  const handleSensorMetricToggle = useCallback((metricKey: VisualizationType) => {
    setActiveSensorMetric(prev => {
      const next = prev === metricKey ? 'none' : metricKey;
      if (next !== 'none') {
        setSortColumn('__sensor__');
        setSortDirection('desc');
      } else if (sortColumn === '__sensor__') {
        setSortColumn('roomNumber');
        setSortDirection('asc');
      }
      return next;
    });
  }, [sortColumn]);

  // Multi-selection state
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  
  // Properties dialog state - supports multiple selection
  const [showPropertiesFor, setShowPropertiesFor] = useState<string[] | null>(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Dynamically extract ALL available columns from room data
  const allColumns: ColumnDef[] = useMemo(() => {
    const discoveredColumns = new Map<string, ColumnDef>();

    SYSTEM_COLUMNS.forEach(col => {
      discoveredColumns.set(col.key, col);
    });

    CALCULATED_COLUMNS.forEach(col => {
      discoveredColumns.set(col.key, col);
    });

    // Limit scan to first 100 rooms for performance
    const sampleRooms = rooms.slice(0, 100);
    sampleRooms.forEach(room => {
      const attrs = room.attributes || {};
      
      Object.entries(attrs).forEach(([key, value]: [string, any]) => {
        if (discoveredColumns.has(key)) return;
        if (key.startsWith('_') || key === 'tenantId' || key === 'checkedOut' || key === 'createdInModel') return;
        if (typeof value !== 'object' || !value) return;
        
        if ('name' in value && 'value' in value) {
          const propertyName = value.name || extractPropertyName(key);
          discoveredColumns.set(key, {
            key,
            label: propertyName,
            category: 'userDefined',
            dataType: value.dataType,
          });
        }
      });
    });

    return Array.from(discoveredColumns.values());
  }, [rooms]);

  // Helper to extract property values from attributes
  const extractPropertyValue = useCallback((
    attributes: Record<string, any> | undefined,
    key: string
  ): any => {
    if (!attributes) return null;

    if (key in attributes) {
      const val = attributes[key];
      if (val && typeof val === 'object' && 'value' in val) {
        return val.value;
      }
      return val;
    }

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

  // Transform raw room data to flat RoomData format
  const roomData: RoomData[] = useMemo(() => {
    return rooms.map((room) => {
      const attrs = room.attributes || {};
      const result: RoomData = {
        fmGuid: room.fmGuid,
        levelFmGuid: room.levelFmGuid,
      };

      allColumns.forEach(col => {
        if (col.category === 'system') {
          result[col.key] = attrs[col.key] || room[col.key] || '-';
        } else if (col.category === 'calculated') {
          result[col.key] = extractPropertyValue(attrs, col.key) || 0;
        } else {
          result[col.key] = extractPropertyValue(attrs, col.key) || '-';
        }
      });

      const roomNum = extractPropertyValue(attrs, 'rumsnummer');
      if (roomNum) result.roomNumber = roomNum;

      result.commonName = room.commonName || room.name || attrs.commonName || 'Unknown';
      result.levelCommonName = attrs.levelCommonName || attrs.levelDesignation || '-';

      return result;
    });
  }, [rooms, allColumns, extractPropertyValue]);

  // Filter and sort rooms
  const filteredRooms = useMemo(() => {
    let result = roomData.filter((room) => {
      const searchLower = searchQuery.toLowerCase();
      return visibleColumns.some(colKey => {
        const val = room[colKey];
        if (val === null || val === undefined || val === '-') return false;
        return String(val).toLowerCase().includes(searchLower);
      }) || room.fmGuid.toLowerCase().includes(searchLower);
    });

    result.sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal || '').toLowerCase();
      const bStr = String(bVal || '').toLowerCase();
      const comparison = aStr.localeCompare(bStr, 'sv', { numeric: true });
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [roomData, searchQuery, sortColumn, sortDirection, visibleColumns]);

  // Build a deterministic color map
  const roomNameColorMap = useMemo(() => {
    const names = [...new Set(filteredRooms.map(r => String(r.commonName || '')))].sort();
    const map: Record<string, string> = {};
    names.forEach((name, i) => { map[name] = ROOM_NAME_COLORS[i % ROOM_NAME_COLORS.length]; });
    return map;
  }, [filteredRooms]);

  // Extract sensor values
  const roomSensorValues = useMemo(() => {
    if (activeSensorMetric === 'none') return new Map<string, number | null>();
    const map = new Map<string, number | null>();
    rooms.forEach(room => {
      const val = extractSensorValue(room.attributes, activeSensorMetric);
      map.set(room.fmGuid, val);
    });
    return map;
  }, [rooms, activeSensorMetric]);

  const activeSensorDef = ROOM_SENSOR_METRICS.find(m => m.key === activeSensorMetric);

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
        setColumnOrder(order => order.filter(k => k !== columnKey));
        return prev.filter((c) => c !== columnKey);
      } else {
        setColumnOrder(order => [...order, columnKey]);
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

  const handleOpen3D = (room: RoomData) => {
    if (onOpen3D) {
      onOpen3D(room.fmGuid, room.levelFmGuid);
    }
  };

  // Multi-selection handlers
  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(filteredRooms.map(r => r.fmGuid)));
    } else {
      setSelectedRows(new Set());
    }
  }, [filteredRooms]);

  const handleToggleRow = useCallback((fmGuid: string) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fmGuid)) {
        newSet.delete(fmGuid);
      } else {
        newSet.add(fmGuid);
      }
      return newSet;
    });
  }, []);

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

  const handleShowSelectedProperties = useCallback(() => {
    if (selectedRows.size > 0) {
      setShowPropertiesFor(Array.from(selectedRows));
    }
  }, [selectedRows]);

  const handleOpen3DSelected = useCallback(() => {
    if (selectedRows.size === 0 || !onOpen3D) return;
    const guids = Array.from(selectedRows);
    // Navigate to viewer with first selected room's floor, then dispatch multi-select event
    const firstRoom = filteredRooms.find(r => r.fmGuid === guids[0]);
    if (firstRoom) {
      onOpen3D(firstRoom.fmGuid, firstRoom.levelFmGuid);
      // After navigation, dispatch event to highlight all selected rooms
      if (guids.length > 1) {
        setTimeout(() => {
          guids.slice(1).forEach(guid => {
            window.dispatchEvent(new CustomEvent('VIEWER_ZOOM_TO_OBJECT', { detail: { fmGuid: guid, selectOnly: true } }));
          });
        }, 3000);
      }
    }
  }, [selectedRows, filteredRooms, onOpen3D]);

  // Sync column order with visible columns
  const orderedVisibleColumns = useMemo(() => {
    const ordered = columnOrder.filter(key => visibleColumns.includes(key));
    const newCols = visibleColumns.filter(key => !columnOrder.includes(key));
    return [...ordered, ...newCols];
  }, [columnOrder, visibleColumns]);

  // Format cell value
  const formatCellValue = (colKey: string, value: any): React.ReactNode => {
    if (value === null || value === undefined || value === '-') return '-';
    
    const col = allColumns.find(c => c.key === colKey);
    
    if (col?.dataType === 3 || typeof value === 'number') {
      if (colKey === 'nta' || colKey.toLowerCase().includes('nta')) {
        return value > 0 ? Math.round(value).toLocaleString('sv-SE') : '-';
      }
      if (colKey === 'omkrets' || colKey.toLowerCase().includes('omkrets')) {
        return value > 0 ? (value / 1000).toFixed(1) : '-';
      }
      if (typeof value === 'number') {
        return value.toFixed(2);
      }
    }
    
    return String(value);
  };

  const totalArea = filteredRooms.reduce((sum, room) => {
    const nta = room.nta;
    return sum + (typeof nta === 'number' ? nta : 0);
  }, 0);

  const title =
    facility.category === 'Building'
      ? `Rooms in ${facility.commonName || facility.name}`
      : `Rooms at ${facility.commonName || facility.name}`;

  // Group columns by category for dropdown
  const systemCols = allColumns.filter(c => c.category === 'system');
  const calculatedCols = allColumns.filter(c => c.category === 'calculated');
  const userDefinedCols = allColumns.filter(c => c.category === 'userDefined');

  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="border-b px-2 sm:px-3 md:px-4 py-2 sm:py-3 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <DoorOpen className="h-4 w-4 sm:h-5 sm:w-5 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base md:text-lg font-bold truncate">{title}</h1>
            <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
              {filteredRooms.length} rooms · {Math.round(totalArea).toLocaleString('en-US')} m²
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 sm:h-9 sm:w-9 shrink-0">
          <ArrowLeft size={16} className="sm:hidden" />
          <ArrowLeft size={20} className="hidden sm:block" />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="border-b px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 flex gap-1.5 sm:gap-2 shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          <Input
            placeholder="Search rooms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-7 sm:pl-9 h-8 sm:h-9 text-xs sm:text-sm"
          />
        </div>
        
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
            <DropdownMenuLabel>System Properties</DropdownMenuLabel>
            {systemCols.map(col => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={visibleColumns.includes(col.key)}
                onCheckedChange={() => toggleColumn(col.key)}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
            {calculatedCols.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Calculated</DropdownMenuLabel>
                {calculatedCols.map(col => (
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
            {userDefinedCols.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>User defined</DropdownMenuLabel>
                {userDefinedCols.map(col => (
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

        {/* View mode toggle */}
        <div className="flex border rounded-md">
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setViewMode('grid')}
            className="h-8 w-8 sm:h-9 sm:w-9"
            title="Tabell"
          >
            <List size={16} />
          </Button>
          <Button
            variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setViewMode('gallery')}
            className="h-8 w-8 sm:h-9 sm:w-9"
            title="Galleri"
          >
            <LayoutGrid size={16} />
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

          {onOpen3D && (
            <Button size="sm" variant="outline" onClick={handleOpen3DSelected} className="gap-1">
              <Cuboid size={14} />
              Viewer
            </Button>
          )}
          
          <Button size="sm" variant="ghost" onClick={() => setSelectedRows(new Set())} className="gap-1 ml-auto">
            <ArrowLeft size={14} />
            Deselect
          </Button>
        </div>
      )}

      {/* Sensor metric buttons */}
      <div className="border-b px-2 sm:px-3 md:px-4 py-1.5 flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] text-muted-foreground mr-1">Visualize:</span>
        {ROOM_SENSOR_METRICS.map(m => (
          <Button
            key={m.key}
            size="sm"
            variant={activeSensorMetric === m.key ? 'default' : 'outline'}
            className="h-7 px-2 text-[10px] gap-1"
            onClick={() => setActiveSensorMetric(prev => prev === m.key ? 'none' : m.key)}
          >
            <m.icon className="h-3 w-3" />
            {m.label}
          </Button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'grid' ? (
          /* Grid/Table View with draggable columns */
          <div className="p-4">
            <div className="border rounded-lg overflow-x-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      {/* Checkbox column header */}
                      <TableHead className="bg-muted/50 w-10">
                        <Checkbox
                          checked={selectedRows.size === filteredRooms.length && filteredRooms.length > 0}
                          onCheckedChange={(checked) => handleSelectAll(!!checked)}
                        />
                      </TableHead>
                      <SortableContext
                        items={orderedVisibleColumns}
                        strategy={horizontalListSortingStrategy}
                      >
                        {orderedVisibleColumns.map((colKey) => {
                          const col = allColumns.find((c) => c.key === colKey);
                          if (!col) return null;
                          return (
                            <SortableColumnHeader
                              key={colKey}
                              id={colKey}
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
                    {filteredRooms.map((room) => {
                      const rowNameColor = roomNameColorMap[String(room.commonName || '')];
                      const rowSensorVal = roomSensorValues.get(room.fmGuid) ?? null;
                      const rowSensorRgb = activeSensorMetric !== 'none' && rowSensorVal !== null
                        ? getVisualizationColor(rowSensorVal, activeSensorMetric)
                        : null;
                      const rowSensorHex = rowSensorRgb ? rgbToHex(rowSensorRgb) : null;
                      return (
                      <TableRow 
                        key={room.fmGuid} 
                        className={`hover:bg-muted/50 cursor-pointer ${selectedRows.has(room.fmGuid) ? 'bg-primary/10' : ''}`}
                        style={{
                          borderLeft: rowSensorHex ? `3px solid ${rowSensorHex}` : rowNameColor ? `3px solid ${rowNameColor}` : undefined,
                        }}
                        onClick={() => handleToggleRow(room.fmGuid)}
                        onDoubleClick={() => handleOpen3D(room)}
                      >
                        {/* Checkbox cell */}
                        <TableCell className="py-2 w-10" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedRows.has(room.fmGuid)}
                            onCheckedChange={(checked) => handleSelectRow(room.fmGuid, !!checked)}
                          />
                        </TableCell>
                        {orderedVisibleColumns.map((colKey) => (
                          <TableCell key={colKey} className="py-1.5 sm:py-2 whitespace-nowrap text-[11px] sm:text-sm">
                            {formatCellValue(colKey, room[colKey])}
                          </TableCell>
                        ))}
                      </TableRow>
                      );
                    })}

                    {filteredRooms.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={orderedVisibleColumns.length + 1}
                          className="text-center py-8 text-muted-foreground"
                        >
                         No rooms found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </DndContext>
            </div>
          </div>
        ) : (
          /* Gallery View */
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredRooms.map((room) => {
                const nameColor = roomNameColorMap[String(room.commonName || '')];
                const sensorVal = roomSensorValues.get(room.fmGuid) ?? null;
                const sensorRgb = activeSensorMetric !== 'none' && sensorVal !== null
                  ? getVisualizationColor(sensorVal, activeSensorMetric)
                  : null;
                const sensorHex = sensorRgb ? rgbToHex(sensorRgb) : null;

                const cardBorderColor = sensorHex ? sensorHex + '88' : nameColor;
                const cardBgColor = sensorHex ? sensorHex + '18' : nameColor ? nameColor.replace(')', ', 0.08)').replace('hsl(', 'hsla(') : undefined;
                const headerBg = sensorHex
                  ? `linear-gradient(135deg, ${sensorHex}33, ${sensorHex}11)`
                  : nameColor
                    ? `linear-gradient(135deg, ${nameColor.replace(')', ', 0.25)').replace('hsl(', 'hsla(')}, ${nameColor.replace(')', ', 0.08)').replace('hsl(', 'hsla(')})`
                    : undefined;

                return (
                  <Card
                    key={room.fmGuid}
                    className={`overflow-hidden group cursor-pointer hover:shadow-md transition-all ${
                      selectedRows.has(room.fmGuid) ? 'ring-2 ring-primary' : ''
                    }`}
                    style={{
                      borderColor: cardBorderColor,
                      backgroundColor: cardBgColor,
                    }}
                    onClick={() => handleToggleRow(room.fmGuid)}
                    onDoubleClick={() => handleOpen3D(room)}
                  >
                    <div
                      className="h-20 relative flex items-center justify-center"
                      style={{ background: headerBg || 'linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--accent) / 0.15))' }}
                    >
                      {activeSensorMetric !== 'none' && sensorVal !== null ? (
                        <div className="text-center">
                          <div className="text-2xl font-bold" style={{ color: sensorHex || 'hsl(var(--foreground))' }}>
                            {sensorVal.toFixed(1)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{activeSensorDef?.unit}</div>
                        </div>
                      ) : activeSensorMetric !== 'none' ? (
                        <span className="text-xs text-muted-foreground">No data</span>
                      ) : (
                        <DoorOpen className="h-10 w-10" style={{ color: nameColor ? nameColor.replace(')', ', 0.5)').replace('hsl(', 'hsla(') : 'hsl(var(--primary) / 0.4)' }} />
                      )}
                      <div className="absolute top-2 right-2 flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {room.levelCommonName}
                        </Badge>
                        <Checkbox
                          checked={selectedRows.has(room.fmGuid)}
                          onClick={(e) => e.stopPropagation()}
                          onCheckedChange={(checked) => handleSelectRow(room.fmGuid, !!checked)}
                        />
                      </div>
                      {nameColor && activeSensorMetric === 'none' && (
                        <div
                          className="absolute top-2 left-2 h-3 w-3 rounded-full border border-background/50"
                          style={{ backgroundColor: nameColor }}
                        />
                      )}
                    </div>
                    <CardContent className="p-3">
                      <h3 className="font-semibold text-sm truncate">
                        {room.commonName}
                      </h3>
                      <p className="text-xs text-muted-foreground truncate">
                        {room.roomNumber}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-medium">
                          {typeof room.nta === 'number' && room.nta > 0 
                            ? `${Math.round(room.nta)} m²` 
                            : '-'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {filteredRooms.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  <DoorOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No rooms found</p>
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
            setShowPropertiesFor(null);
            setSelectedRows(new Set());
          }}
        />
      )}
    </div>
  );
};

export default RoomsView;
