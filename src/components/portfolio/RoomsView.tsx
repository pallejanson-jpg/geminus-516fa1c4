import React, { useState, useMemo, useCallback } from 'react';
import {
  X,
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
  ChevronRight,
  Check,
  FolderOpen,
  Folder,
  Menu,
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  dataType?: number; // 0=string, 3=number
}

// Helper to extract readable name from attribute key
const extractPropertyName = (key: string): string => {
  // Remove hash suffix (e.g., "hyresobjektF6155460E35181F569CF0C37DD10056448C5EBD3" -> "hyresobjekt")
  const match = key.match(/^([a-zA-ZåäöÅÄÖ]+)/);
  if (match) {
    const baseName = match[1].toLowerCase();
    // Capitalize first letter
    return baseName.charAt(0).toUpperCase() + baseName.slice(1);
  }
  return key;
};

// System property definitions (always available)
const SYSTEM_COLUMNS: ColumnDef[] = [
  { key: 'commonName', label: 'Rumsnamn', category: 'system' },
  { key: 'roomNumber', label: 'Rumsnummer', category: 'system' },
  { key: 'designation', label: 'Beteckning', category: 'system' },
  { key: 'levelCommonName', label: 'Våning', category: 'system' },
  { key: 'buildingCommonName', label: 'Byggnad', category: 'system' },
  { key: 'complexCommonName', label: 'Komplex', category: 'system' },
  { key: 'category', label: 'Kategori', category: 'system' },
  { key: 'objectTypeValue', label: 'Objekttyp', category: 'system' },
  { key: 'fmGuid', label: 'FMGUID', category: 'system' },
];

// Default visible columns
const DEFAULT_VISIBLE_COLUMNS = ['roomNumber', 'commonName', 'levelCommonName', 'nta', 'hyresobjekt'];

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
    userDefined: true,
    calculated: true,
  });

  const groupedColumns = useMemo(() => {
    const groups: Record<string, ColumnDef[]> = {
      system: [],
      userDefined: [],
      calculated: [],
    };
    columns.forEach(col => {
      if (groups[col.category]) {
        groups[col.category].push(col);
      }
    });
    return groups;
  }, [columns]);

  const categoryLabels: Record<string, string> = {
    system: 'Systemegenskaper',
    userDefined: 'Användardefinierade egenskaper',
    calculated: 'Beräknade egenskaper',
  };

  const categoryIcons: Record<string, React.ReactNode> = {
    system: <Folder size={14} className="text-blue-500" />,
    userDefined: <FolderOpen size={14} className="text-green-500" />,
    calculated: <Folder size={14} className="text-orange-500" />,
  };

  return (
    <div className="space-y-2">
      {Object.entries(groupedColumns).map(([category, cols]) => (
        cols.length > 0 && (
          <Collapsible
            key={category}
            open={openCategories[category]}
            onOpenChange={(open) => setOpenCategories(prev => ({ ...prev, [category]: open }))}
          >
            <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-muted rounded-md transition-colors">
              <ChevronRight 
                size={14} 
                className={`transition-transform ${openCategories[category] ? 'rotate-90' : ''}`} 
              />
              {categoryIcons[category]}
              <span className="font-medium text-sm">{categoryLabels[category]}</span>
              <Badge variant="secondary" className="ml-auto text-xs">
                {cols.filter(c => visibleColumns.includes(c.key)).length}/{cols.length}
              </Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-6 mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                {cols.map(col => (
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
      ))}
    </div>
  );
};

const RoomsView: React.FC<RoomsViewProps> = ({
  facility,
  rooms,
  onClose,
  onOpen3D,
  onSelectRoom,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'gallery'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string>('roomNumber');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Dynamically extract ALL available columns from room data
  const allColumns: ColumnDef[] = useMemo(() => {
    const discoveredColumns = new Map<string, ColumnDef>();

    // Add system columns first
    SYSTEM_COLUMNS.forEach(col => {
      discoveredColumns.set(col.key, col);
    });

    // Scan all rooms to find User Defined Properties
    rooms.forEach(room => {
      const attrs = room.attributes || {};
      
      Object.entries(attrs).forEach(([key, value]: [string, any]) => {
        // Skip already-known system properties and internal fields
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
            dataType: value.dataType,
          });
        }
      });
    });

    // Add calculated columns (like extracted values)
    const calculated: ColumnDef[] = [
      { key: 'nta', label: 'NTA (m²)', category: 'calculated', dataType: 3 },
      { key: 'omkrets', label: 'Omkrets (m)', category: 'calculated', dataType: 3 },
    ];
    calculated.forEach(col => {
      discoveredColumns.set(col.key, col);
    });

    return Array.from(discoveredColumns.values());
  }, [rooms]);

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

  // Transform raw room data to flat RoomData format
  const roomData: RoomData[] = useMemo(() => {
    return rooms.map((room) => {
      const attrs = room.attributes || {};
      const result: RoomData = {
        fmGuid: room.fmGuid,
        levelFmGuid: room.levelFmGuid,
      };

      // Extract all column values
      allColumns.forEach(col => {
        if (col.category === 'system') {
          // System properties come from attrs directly or room object
          result[col.key] = attrs[col.key] || room[col.key] || '-';
        } else if (col.category === 'calculated') {
          // Special calculated fields
          result[col.key] = extractPropertyValue(attrs, col.key) || 0;
        } else {
          // User Defined Properties
          result[col.key] = extractPropertyValue(attrs, col.key) || '-';
        }
      });

      // Override roomNumber with extracted value if available
      const roomNum = extractPropertyValue(attrs, 'rumsnummer');
      if (roomNum) result.roomNumber = roomNum;

      // Override commonName
      result.commonName = room.commonName || room.name || attrs.commonName || 'Okänt';

      // Override levelCommonName
      result.levelCommonName = attrs.levelCommonName || attrs.levelDesignation || '-';

      return result;
    });
  }, [rooms, allColumns, extractPropertyValue]);

  // Filter and sort rooms
  const filteredRooms = useMemo(() => {
    let result = roomData.filter((room) => {
      const searchLower = searchQuery.toLowerCase();
      // Search across all visible columns
      return visibleColumns.some(colKey => {
        const val = room[colKey];
        if (val === null || val === undefined || val === '-') return false;
        return String(val).toLowerCase().includes(searchLower);
      }) || room.fmGuid.toLowerCase().includes(searchLower);
    });

    // Sort
    result.sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];

      // Handle numeric sorting
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      // Handle string sorting
      const aStr = String(aVal || '').toLowerCase();
      const bStr = String(bVal || '').toLowerCase();
      const comparison = aStr.localeCompare(bStr, 'sv', { numeric: true });
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [roomData, searchQuery, sortColumn, sortDirection, visibleColumns]);

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
        // Remove from visible and column order
        setColumnOrder(order => order.filter(k => k !== columnKey));
        return prev.filter((c) => c !== columnKey);
      } else {
        // Add to visible and column order
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

  const handleSelectRoom = (room: RoomData) => {
    if (onSelectRoom) {
      onSelectRoom(room.fmGuid);
    }
  };

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
    
    // Format numbers
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
      ? `Rum i ${facility.commonName || facility.name}`
      : `Rum på ${facility.commonName || facility.name}`;

  return (
    <div className="absolute inset-0 z-40 bg-background flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <DoorOpen className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-bold">{title}</h1>
            <p className="text-xs text-muted-foreground">
              {filteredRooms.length} rum · {Math.round(totalArea).toLocaleString('sv-SE')} m² totalt · {allColumns.length} tillgängliga egenskaper
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X size={20} />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="border-b px-4 py-2 flex gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök rum..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        
        {/* Mobile: Hamburger menu for column selector + view mode */}
        <div className="sm:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9">
                <Menu size={16} />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Settings2 size={18} />
                  Inställningar
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-6">
                {/* View mode section */}
                <div>
                  <p className="text-sm font-medium mb-2">Visningsläge</p>
                  <div className="flex border rounded-md w-fit">
                    <Button
                      variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('grid')}
                      className="h-9 gap-2"
                    >
                      <List size={16} />
                      Tabell
                    </Button>
                    <Button
                      variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
                      size="sm"
                      onClick={() => setViewMode('gallery')}
                      className="h-9 gap-2"
                    >
                      <LayoutGrid size={16} />
                      Galleri
                    </Button>
                  </div>
                </div>
                
                {/* Column selector section */}
                <div>
                  <p className="text-sm font-medium mb-2">
                    Kolumner ({visibleColumns.length} valda)
                  </p>
                  <ScrollArea className="h-[calc(100vh-280px)]">
                    <ColumnSelectorTree
                      columns={allColumns}
                      visibleColumns={visibleColumns}
                      onToggle={toggleColumn}
                    />
                  </ScrollArea>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
        
        {/* Desktop: Inline controls */}
        <div className="hidden sm:flex gap-2">
          {/* Column selector (Sheet for tree menu) */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2">
                <Settings2 size={14} />
                <span>Kolumner</span>
                <Badge variant="secondary" className="text-xs ml-1">
                  {visibleColumns.length}
                </Badge>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 sm:w-96">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Settings2 size={18} />
                  Välj kolumner
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Välj vilka egenskaper som ska visas. Dra i kolumnhuvudena för att ändra ordning.
                </p>
                <ScrollArea className="h-[calc(100vh-200px)]">
                  <ColumnSelectorTree
                    columns={allColumns}
                    visibleColumns={visibleColumns}
                    onToggle={toggleColumn}
                  />
                </ScrollArea>
              </div>
            </SheetContent>
          </Sheet>

          {/* View mode toggle */}
          <div className="flex border rounded-md">
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('grid')}
              className="h-9 w-9"
              title="Tabell"
            >
              <List size={16} />
            </Button>
            <Button
              variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('gallery')}
              className="h-9 w-9"
              title="Galleri"
            >
              <LayoutGrid size={16} />
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
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
                  <TableHeader>
                    <TableRow>
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
                      <TableHead className="w-[80px] bg-muted/50">Åtgärder</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRooms.map((room) => (
                      <TableRow 
                        key={room.fmGuid} 
                        className="hover:bg-muted/50 cursor-pointer"
                        onClick={() => handleSelectRoom(room)}
                      >
                        {orderedVisibleColumns.map((colKey) => (
                          <TableCell key={colKey} className="py-2 whitespace-nowrap">
                            {formatCellValue(colKey, room[colKey])}
                          </TableCell>
                        ))}
                        <TableCell className="py-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpen3D(room);
                            }}
                            title="Visa i 3D"
                          >
                            <Cuboid size={14} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredRooms.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={orderedVisibleColumns.length + 1}
                          className="text-center py-8 text-muted-foreground"
                        >
                          Inga rum hittades
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
              {filteredRooms.map((room) => (
                <Card
                  key={room.fmGuid}
                  className="overflow-hidden group cursor-pointer hover:border-primary/50 transition-all"
                  onClick={() => handleSelectRoom(room)}
                >
                  <div className="h-24 bg-gradient-to-br from-primary/20 to-accent/20 relative flex items-center justify-center">
                    <DoorOpen className="h-10 w-10 text-primary/40" />
                    <div className="absolute top-2 right-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {room.levelCommonName}
                      </Badge>
                    </div>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpen3D(room);
                        }}
                        title="Visa i 3D"
                      >
                        <Cuboid size={12} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {filteredRooms.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  <DoorOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Inga rum hittades</p>
                </div>
              )}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default RoomsView;
