import React, { useState, useMemo } from 'react';
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
  Filter,
  Settings2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Facility } from '@/lib/types';

interface RoomData {
  fmGuid: string;
  commonName: string;
  roomNumber: string;
  nta: number;
  levelCommonName?: string;
  hyresobjekt?: string;
  golvmaterial?: string;
  wallCovering?: string;
  ceilingCovering?: string;
  omkrets?: number;
  [key: string]: any;
}

interface RoomsViewProps {
  facility: Facility;
  rooms: any[];
  onClose: () => void;
  onOpen3D?: (fmGuid: string, levelFmGuid?: string) => void;
}

// Available columns for customization
const AVAILABLE_COLUMNS = [
  { key: 'commonName', label: 'Rumsnamn', default: true },
  { key: 'roomNumber', label: 'Rumsnummer', default: true },
  { key: 'nta', label: 'NTA (m²)', default: true },
  { key: 'levelCommonName', label: 'Våning', default: false },
  { key: 'hyresobjekt', label: 'Hyresobjekt', default: false },
  { key: 'golvmaterial', label: 'Golvmaterial', default: false },
  { key: 'wallCovering', label: 'Väggbeklädnad', default: false },
  { key: 'ceilingCovering', label: 'Takbeklädnad', default: false },
  { key: 'omkrets', label: 'Omkrets (m)', default: false },
];

const RoomsView: React.FC<RoomsViewProps> = ({
  facility,
  rooms,
  onClose,
  onOpen3D,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'gallery'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string>('commonName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [visibleColumns, setVisibleColumns] = useState<string[]>(
    AVAILABLE_COLUMNS.filter((c) => c.default).map((c) => c.key)
  );

  // Helper to extract property values from attributes (dynamic key names like "nta51780ACD...")
  const extractPropertyValue = (
    attributes: Record<string, any> | undefined,
    prefix: string
  ): any => {
    if (!attributes) return null;
    for (const key of Object.keys(attributes)) {
      if (key.toLowerCase().startsWith(prefix.toLowerCase())) {
        const propObj = attributes[key];
        if (propObj && typeof propObj === 'object' && 'value' in propObj) {
          return propObj.value;
        }
      }
    }
    return null;
  };

  // Transform raw room data to RoomData format
  const roomData: RoomData[] = useMemo(() => {
    return rooms.map((room) => {
      const attrs = room.attributes || {};

      return {
        fmGuid: room.fmGuid,
        commonName: room.commonName || room.name || 'Unnamed',
        roomNumber:
          extractPropertyValue(attrs, 'rumsnummer') ||
          attrs.roomNumber ||
          room.designation ||
          '-',
        nta: extractPropertyValue(attrs, 'nta') || 0,
        levelCommonName:
          attrs.levelCommonName || attrs.levelDesignation || '-',
        levelFmGuid: room.levelFmGuid,
        hyresobjekt: extractPropertyValue(attrs, 'hyresobjekt') || '-',
        golvmaterial: extractPropertyValue(attrs, 'golvmaterial') || '-',
        wallCovering: extractPropertyValue(attrs, 'wallcovering') || '-',
        ceilingCovering: extractPropertyValue(attrs, 'ceilingcovering') || '-',
        omkrets: extractPropertyValue(attrs, 'omkrets') || 0,
      };
    });
  }, [rooms]);

  // Filter and sort rooms
  const filteredRooms = useMemo(() => {
    let result = roomData.filter((room) => {
      const searchLower = searchQuery.toLowerCase();
      return (
        room.commonName.toLowerCase().includes(searchLower) ||
        room.roomNumber.toLowerCase().includes(searchLower) ||
        (room.levelCommonName &&
          room.levelCommonName.toLowerCase().includes(searchLower)) ||
        (room.hyresobjekt &&
          room.hyresobjekt.toLowerCase().includes(searchLower))
      );
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
  }, [roomData, searchQuery, sortColumn, sortDirection]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const toggleColumn = (columnKey: string) => {
    setVisibleColumns((prev) =>
      prev.includes(columnKey)
        ? prev.filter((c) => c !== columnKey)
        : [...prev, columnKey]
    );
  };

  const handleOpen3D = (room: RoomData) => {
    if (onOpen3D) {
      onOpen3D(room.fmGuid, room.levelFmGuid);
    }
  };

  const totalArea = filteredRooms.reduce((sum, room) => sum + (room.nta || 0), 0);

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
              {filteredRooms.length} rum · {Math.round(totalArea).toLocaleString()} m² totalt
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X size={20} />
        </Button>
      </div>

      {/* Toolbar */}
      <div className="border-b px-4 py-2 flex flex-col sm:flex-row gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök rum..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-2">
          {/* Column selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2">
                <Settings2 size={14} />
                <span className="hidden sm:inline">Kolumner</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-popover">
              <DropdownMenuLabel>Visa kolumner</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {AVAILABLE_COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleColumns.includes(col.key)}
                  onCheckedChange={() => toggleColumn(col.key)}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

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
          /* Grid/Table View */
          <div className="p-4">
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {visibleColumns.map((colKey) => {
                      const col = AVAILABLE_COLUMNS.find((c) => c.key === colKey);
                      if (!col) return null;
                      return (
                        <TableHead
                          key={colKey}
                          className="cursor-pointer hover:bg-muted/80 transition-colors"
                          onClick={() => handleSort(colKey)}
                        >
                          <div className="flex items-center gap-1">
                            {col.label}
                            {sortColumn === colKey ? (
                              sortDirection === 'asc' ? (
                                <ChevronUp size={14} />
                              ) : (
                                <ChevronDown size={14} />
                              )
                            ) : (
                              <ArrowUpDown size={12} className="text-muted-foreground" />
                            )}
                          </div>
                        </TableHead>
                      );
                    })}
                    <TableHead className="w-[80px]">Åtgärder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRooms.map((room) => (
                    <TableRow key={room.fmGuid} className="hover:bg-muted/50">
                      {visibleColumns.map((colKey) => {
                        const value = room[colKey];
                        let displayValue: React.ReactNode = value;

                        // Format numbers
                        if (colKey === 'nta' && typeof value === 'number') {
                          displayValue = value > 0 ? `${value.toFixed(1)}` : '-';
                        } else if (colKey === 'omkrets' && typeof value === 'number') {
                          displayValue =
                            value > 0 ? `${(value / 1000).toFixed(1)}` : '-';
                        }

                        return (
                          <TableCell key={colKey} className="py-2">
                            {displayValue || '-'}
                          </TableCell>
                        );
                      })}
                      <TableCell className="py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleOpen3D(room)}
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
                        colSpan={visibleColumns.length + 1}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Inga rum hittades
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
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
                  onClick={() => handleOpen3D(room)}
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
                        {room.nta > 0 ? `${room.nta.toFixed(1)} m²` : '-'}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpen3D(room);
                        }}
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
