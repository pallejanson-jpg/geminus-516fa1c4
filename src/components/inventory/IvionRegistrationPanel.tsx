import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GripVertical, X, Loader2, RefreshCw, Check, MapPin, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { INVENTORY_CATEGORIES } from './InventoryForm';

interface AnnotationSymbol {
  id: string;
  name: string;
  category: string;
  color: string;
  icon_url: string | null;
}

interface Coords {
  x: number;
  y: number;
  z: number;
}

interface FloorOption {
  fm_guid: string;
  name: string;
}

interface RoomOption {
  fm_guid: string;
  name: string;
}

interface IvionPoiData {
  id: number;
  titles: Record<string, string>;
  location: { x: number; y: number; z: number };
  pointOfView?: { imageId: number };
}

type ConnectionStatus = 'unknown' | 'connected' | 'error' | 'expired';

interface IvionRegistrationPanelProps {
  buildingFmGuid: string;
  ivionSiteId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onSavedAndClose?: () => void;
  initialPoi?: IvionPoiData | null;
  connectionStatus?: ConnectionStatus;
  onLoadPendingPoi?: () => void;
  hasPendingPoi?: boolean;
}

const IvionRegistrationPanel: React.FC<IvionRegistrationPanelProps> = ({
  buildingFmGuid,
  ivionSiteId,
  onClose,
  onSaved,
  onSavedAndClose,
  initialPoi,
  connectionStatus = 'unknown',
  onLoadPendingPoi,
  hasPendingPoi = false,
}) => {
  // Dragging state - position to the left, near Ivion's panel
  const [position, setPosition] = useState({ x: 360, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  
  // Track if we should close after saving
  const [closeAfterSave, setCloseAfterSave] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [symbolId, setSymbolId] = useState('');
  const [levelFmGuid, setLevelFmGuid] = useState('');
  const [roomFmGuid, setRoomFmGuid] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Data
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [floors, setFloors] = useState<FloorOption[]>([]);
  const [rooms, setRooms] = useState<RoomOption[]>([]);

  // POI fetch state
  const [poiInput, setPoiInput] = useState('');
  const [fetchedCoords, setFetchedCoords] = useState<Coords | null>(null);
  const [isFetchingPoi, setIsFetchingPoi] = useState(false);
  const [fetchedPoiId, setFetchedPoiId] = useState<number | null>(null);
  const [fetchedImageId, setFetchedImageId] = useState<number | null>(null);
  const [autoFetchAttempted, setAutoFetchAttempted] = useState(false);

  // Load symbols
  useEffect(() => {
    const fetchSymbols = async () => {
      const { data } = await supabase
        .from('annotation_symbols')
        .select('id, name, category, color, icon_url')
        .order('category, name');

      if (data) setSymbols(data);
    };
    fetchSymbols();
  }, []);

  // Handle initialPoi from parent (auto-detected via polling)
  useEffect(() => {
    if (initialPoi) {
      // Fill in data from the auto-detected POI
      setFetchedCoords({
        x: initialPoi.location.x,
        y: initialPoi.location.y,
        z: initialPoi.location.z,
      });
      setFetchedPoiId(initialPoi.id);
      setFetchedImageId(initialPoi.pointOfView?.imageId || null);

      // Auto-fill name if empty
      if (!name && initialPoi.titles) {
        const title = initialPoi.titles['sv'] || initialPoi.titles['en'] || initialPoi.titles[Object.keys(initialPoi.titles)[0]];
        if (title) setName(title);
      }

      // Don't auto-fetch since we already have POI data
      setAutoFetchAttempted(true);

       toast.success('New POI detected!', {
         description: `Position: (${initialPoi.location.x.toFixed(2)}, ${initialPoi.location.y.toFixed(2)}, ${initialPoi.location.z.toFixed(2)})`,
       });
    }
  }, [initialPoi]);

  // Auto-fetch latest POI when panel opens (only if no initialPoi)
  useEffect(() => {
    if (ivionSiteId && !autoFetchAttempted && !initialPoi) {
      setAutoFetchAttempted(true);
      fetchLatestPoi();
    }
  }, [ivionSiteId, autoFetchAttempted, initialPoi]);

  const fetchLatestPoi = async () => {
    if (!ivionSiteId) return;
    
    setIsFetchingPoi(true);
    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'get-latest-poi',
          siteId: ivionSiteId,
        },
      });

      if (!error && data?.location) {
        setFetchedCoords({
          x: data.location.x,
          y: data.location.y,
          z: data.location.z,
        });
        setFetchedPoiId(data.id);
        setFetchedImageId(data.pointOfView?.imageId || null);

        // Auto-fill name if empty
        if (!name && data.titles) {
          const title = data.titles['sv'] || data.titles['en'] || data.titles[Object.keys(data.titles)[0]];
          if (title) setName(title);
        }

         toast.success('Latest POI fetched!', {
           description: `Position: (${data.location.x.toFixed(2)}, ${data.location.y.toFixed(2)}, ${data.location.z.toFixed(2)})`,
         });
      } else if (data?.error) {
        // Show error but don't block the form
        console.warn('POI fetch warning:', data.error);
      }
    } catch (err) {
      // Silent fail - auto-fetch is a bonus feature
      console.log('Auto-fetch POI failed:', err);
    } finally {
      setIsFetchingPoi(false);
    }
  };

  // Load floors for building
  useEffect(() => {
    if (!buildingFmGuid) {
      setFloors([]);
      return;
    }

    const fetchFloors = async () => {
      const { data } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('category', 'Storey')
        .order('name');

      if (data) {
        setFloors(data.map(d => ({
          fm_guid: d.fm_guid,
          name: d.name || d.common_name || d.fm_guid,
        })));
      }
    };
    fetchFloors();
  }, [buildingFmGuid]);

  // Load rooms for selected floor
  useEffect(() => {
    if (!levelFmGuid) {
      setRooms([]);
      return;
    }

    const fetchRooms = async () => {
      const { data } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name')
        .eq('level_fm_guid', levelFmGuid)
        .eq('category', 'Space')
        .order('name');

      if (data) {
        setRooms(data.map(d => ({
          fm_guid: d.fm_guid,
          name: d.name || d.common_name || d.fm_guid,
        })));
      }
    };
    fetchRooms();
  }, [levelFmGuid]);

  // Dragging handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(0, Math.min(window.innerWidth - 380, e.clientX - dragOffset.current.x));
      const newY = Math.max(60, Math.min(window.innerHeight - 200, e.clientY - dragOffset.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Parse POI ID from input (can be URL or just ID)
  const parsePoiId = (input: string): number | null => {
    // If it's just a number
    if (/^\d+$/.test(input.trim())) {
      return parseInt(input.trim(), 10);
    }

    // If it's a URL, try to extract poi= parameter
    try {
      const url = new URL(input);
      const poiParam = url.searchParams.get('poi');
      if (poiParam && /^\d+$/.test(poiParam)) {
        return parseInt(poiParam, 10);
      }
    } catch {
      // Not a valid URL
    }

    return null;
  };

  // Fetch POI data from Ivion
  const handleFetchPoi = async () => {
    if (!ivionSiteId) {
       toast.error('No Ivion site configured');
       return;
     }

     const poiId = parsePoiId(poiInput);
     if (!poiId) {
       toast.error('Invalid POI ID', {
         description: 'Enter a valid POI ID (number) or Ivion URL with poi parameter',
       });
       return;
    }

    setIsFetchingPoi(true);
    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: {
          action: 'get-poi',
          siteId: ivionSiteId,
          poiId: poiId,
        },
      });

      if (error) throw error;

      if (data?.location) {
        setFetchedCoords({
          x: data.location.x,
          y: data.location.y,
          z: data.location.z,
        });
        setFetchedPoiId(data.id);
        setFetchedImageId(data.pointOfView?.imageId || null);

        // Auto-fill name if empty
        if (!name && data.titles) {
          const title = data.titles['sv'] || data.titles['en'] || data.titles[Object.keys(data.titles)[0]];
          if (title) setName(title);
        }

         toast.success('POI data fetched!', {
           description: `Position: (${data.location.x.toFixed(2)}, ${data.location.y.toFixed(2)}, ${data.location.z.toFixed(2)})`,
         });
       } else {
         toast.error('POI not found');
       }
     } catch (err: any) {
       console.error('POI fetch error:', err);
       toast.error('Could not fetch POI', {
         description: err.message || 'Check that the POI ID is correct',
       });
    } finally {
      setIsFetchingPoi(false);
    }
  };

  // Handle form submission
  const handleSave = async () => {
    if (!name.trim()) {
       toast.error('Name is required');
       return;
     }
     if (!category) {
       toast.error('Select a category');
       return;
     }
     if (!symbolId) {
       toast.error('Select a symbol');
       return;
     }

    setIsLoading(true);
    try {
      const newFmGuid = crypto.randomUUID();
      const inventoryDate = new Date().toISOString();

      const newAsset = {
        fm_guid: newFmGuid,
        name: name.trim(),
        common_name: name.trim(),
        category: 'Instance',
        asset_type: category,
        symbol_id: symbolId,
        building_fm_guid: buildingFmGuid,
        level_fm_guid: levelFmGuid || null,
        in_room_fm_guid: roomFmGuid || null,
        created_in_model: false,
        is_local: true,
        annotation_placed: !!fetchedCoords,
        coordinate_x: fetchedCoords?.x ?? null,
        coordinate_y: fetchedCoords?.y ?? null,
        coordinate_z: fetchedCoords?.z ?? null,
        ivion_poi_id: fetchedPoiId ?? null,
        ivion_site_id: ivionSiteId ?? null,
        ivion_image_id: fetchedImageId ?? null,
        ivion_synced_at: fetchedPoiId ? new Date().toISOString() : null,
        attributes: {
          objectType: 4,
          designation: name.trim(),
          commonName: name.trim(),
          inRoomFmGuid: roomFmGuid || null,
          levelFmGuid: levelFmGuid || null,
          buildingFmGuid: buildingFmGuid,
          assetCategory: category,
          description: description.trim() || null,
          inventoryDate: inventoryDate,
          syncProperties: [
            { name: 'Description', value: description.trim() || '', dataType: 0 },
            { name: 'InventoryDate', value: inventoryDate, dataType: 4 },
            { name: 'AssetCategory', value: category, dataType: 0 },
          ],
        },
      };

      const { error } = await supabase.from('assets').insert([newAsset]);
      if (error) throw error;

      // Write FMGUID back to Ivion POI if we have a POI ID
      if (fetchedPoiId && ivionSiteId) {
        try {
          await supabase.functions.invoke('ivion-poi', {
            body: {
              action: 'update-poi',
              siteId: ivionSiteId,
              poiId: fetchedPoiId,
              poiData: {
                customData: JSON.stringify({
                  FMGUID: newFmGuid,
                  asset_type: category,
                  source: 'geminus',
                }),
              },
            },
          });
          console.log('FMGUID written back to Ivion POI:', fetchedPoiId);
        } catch (ivionErr) {
          console.warn('Failed to write FMGUID back to Ivion (non-critical):', ivionErr);
          // Don't throw - asset is saved, Ivion update is optional
        }
      }

      toast.success('Asset saved!');
      
      // Check if we should close after saving
      if (closeAfterSave && onSavedAndClose) {
        onSavedAndClose();
        return;
      }
      
      onSaved();

      // Reset form for next registration
      setName('');
      setDescription('');
      setCategory('');
      setSymbolId('');
      setPoiInput('');
      setFetchedCoords(null);
      setFetchedPoiId(null);
      setFetchedImageId(null);
      setAutoFetchAttempted(false); // Allow auto-fetch again for next item
      // Keep level and room for convenience
    } catch (err: any) {
      console.error('Save error:', err);
      toast.error('Could not save', { description: err.message });
    } finally {
      setIsLoading(false);
      setCloseAfterSave(false);
    }
  };

  // Group symbols by category
  const groupedSymbols = symbols.reduce((acc, sym) => {
    if (!acc[sym.category]) acc[sym.category] = [];
    acc[sym.category].push(sym);
    return acc;
  }, {} as Record<string, AnnotationSymbol[]>);

  // Connection status helper
  const getConnectionStatusDisplay = () => {
    switch (connectionStatus) {
      case 'connected':
         return { icon: Wifi, text: 'Connected', className: 'text-green-600 bg-green-100/80 dark:bg-green-900/30' };
       case 'error':
         return { icon: WifiOff, text: 'Connection error', className: 'text-red-600 bg-red-100/80 dark:bg-red-900/30' };
       case 'expired':
         return { icon: AlertCircle, text: 'Token expired', className: 'text-amber-600 bg-amber-100/80 dark:bg-amber-900/30' };
       default:
         return { icon: Loader2, text: 'Connecting...', className: 'text-muted-foreground bg-muted' };
    }
  };

  const statusDisplay = getConnectionStatusDisplay();
  const StatusIcon = statusDisplay.icon;

  return (
    <div
      className={cn(
        "fixed z-[60] w-[360px] max-h-[85vh]",
        "bg-card/90 backdrop-blur-md border rounded-xl shadow-2xl overflow-hidden",
        isDragging && "cursor-grabbing"
      )}
      style={{ left: position.x, top: position.y }}
    >
      {/* Draggable header */}
      <div
        className="px-4 py-3 bg-muted/50 cursor-grab flex items-center justify-between border-b select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Register asset</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Mini connection status */}
          <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-xs", statusDisplay.className)}>
            <StatusIcon className={cn("h-3 w-3", connectionStatus === 'unknown' && 'animate-spin')} />
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Pending POI notification */}
      {hasPendingPoi && onLoadPendingPoi && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-100 dark:border-amber-900">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onLoadPendingPoi}
            className="w-full gap-2 border-amber-500 text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-900"
          >
            <RefreshCw className="h-4 w-4" />
            Load new POI
            <Badge variant="secondary" className="ml-1 bg-amber-100 text-amber-700">New!</Badge>
          </Button>
        </div>
      )}

      {/* POI Fetch section */}
      <div className="p-4 border-b bg-muted/30">
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-xs text-muted-foreground">
            Fetch position from POI
          </Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchLatestPoi}
            disabled={isFetchingPoi}
            className="h-6 px-2 text-xs gap-1"
          >
            {isFetchingPoi ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Fetch latest
          </Button>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="POI-ID eller Ivion-URL..."
            value={poiInput}
            onChange={(e) => setPoiInput(e.target.value)}
            className="h-9 text-sm"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleFetchPoi}
            disabled={isFetchingPoi || !poiInput.trim()}
          >
            {isFetchingPoi ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
        </div>
        {fetchedCoords && (
          <div className="flex items-center gap-2 text-xs text-green-600 mt-2">
            <MapPin className="h-3.5 w-3.5" />
            <span>
              Position: ({fetchedCoords.x.toFixed(2)}, {fetchedCoords.y.toFixed(2)}, {fetchedCoords.z.toFixed(2)})
            </span>
            {fetchedPoiId && (
              <Badge variant="outline" className="text-[10px] h-4 px-1">
                POI #{fetchedPoiId}
              </Badge>
            )}
          </div>
        )}
        {!fetchedCoords && connectionStatus === 'expired' && (
          <div className="flex items-center gap-2 text-xs text-amber-600 mt-2">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>Token expired - manual fetch may fail</span>
          </div>
        )}
      </div>

      {/* Form fields */}
      <ScrollArea className="max-h-[45vh]">
        <div className="p-4 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label className="text-sm">Name / Designation *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Fire Extinguisher BS-001"
              className="h-10"
              maxLength={100}
            />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label className="text-sm">Category *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                {INVENTORY_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    <span className="flex items-center gap-2">
                      <cat.Icon className={`h-4 w-4 ${cat.color}`} />
                      <span>{cat.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Symbol */}
          <div className="space-y-1.5">
            <Label className="text-sm">Symbol *</Label>
            <Select value={symbolId} onValueChange={setSymbolId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select symbol..." />
              </SelectTrigger>
              <SelectContent className="z-[70] max-h-[200px]">
                {Object.entries(groupedSymbols).map(([cat, syms]) => (
                  <React.Fragment key={cat}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {cat}
                    </div>
                    {syms.map((sym) => (
                      <SelectItem key={sym.id} value={sym.id}>
                        <span className="flex items-center gap-2">
                          {sym.icon_url ? (
                            <img src={sym.icon_url} alt="" className="h-4 w-4" />
                          ) : (
                            <div
                              className="h-4 w-4 rounded-full"
                              style={{ backgroundColor: sym.color }}
                            />
                          )}
                          <span>{sym.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </React.Fragment>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Floor */}
          <div className="space-y-1.5">
            <Label className="text-sm">Floor</Label>
            <Select value={levelFmGuid} onValueChange={(v) => { setLevelFmGuid(v); setRoomFmGuid(''); }}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Välj våningsplan..." />
              </SelectTrigger>
              <SelectContent className="z-[70]">
                {floors.map((f) => (
                  <SelectItem key={f.fm_guid} value={f.fm_guid}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Room */}
          {levelFmGuid && rooms.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-sm">Rum</Label>
              <Select value={roomFmGuid} onValueChange={setRoomFmGuid}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Välj rum..." />
                </SelectTrigger>
                <SelectContent className="z-[70] max-h-[200px]">
                  {rooms.map((r) => (
                    <SelectItem key={r.fm_guid} value={r.fm_guid}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <Label className="text-sm">Beskrivning</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Valfri beskrivning..."
              rows={2}
              className="resize-none"
            />
          </div>
        </div>
      </ScrollArea>

      {/* Save buttons */}
      <div className="p-4 border-t bg-card/50 flex gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setCloseAfterSave(false);
            handleSave();
          }}
          className="flex-1 h-11"
          disabled={isLoading || !name.trim() || !category || !symbolId}
        >
          {isLoading && !closeAfterSave ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Spara & fortsätt'
          )}
        </Button>
        <Button
          onClick={() => {
            setCloseAfterSave(true);
            handleSave();
          }}
          className="flex-1 h-11"
          disabled={isLoading || !name.trim() || !category || !symbolId}
        >
          {isLoading && closeAfterSave ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Spara & avsluta'
          )}
        </Button>
      </div>
    </div>
  );
};

export default IvionRegistrationPanel;
