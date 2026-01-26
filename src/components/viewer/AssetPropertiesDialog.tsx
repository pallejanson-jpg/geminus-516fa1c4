import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Pencil, Save, GripVertical, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AssetProperties {
  id: string;
  fm_guid: string;
  name: string | null;
  common_name: string | null;
  category: string;
  building_fm_guid: string | null;
  level_fm_guid: string | null;
  in_room_fm_guid: string | null;
  asset_type: string | null;
  gross_area: number | null;
  symbol_id: string | null;
  coordinate_x: number | null;
  coordinate_y: number | null;
  coordinate_z: number | null;
  is_local: boolean;
  created_in_model: boolean | null;
  annotation_placed: boolean | null;
  attributes: Record<string, any>;
}

interface AnnotationSymbol {
  id: string;
  name: string;
  category: string;
  color: string;
  icon_url: string | null;
}

interface AssetPropertiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFmGuids: string[];
  onUpdate?: () => void;
}

const AssetPropertiesDialog: React.FC<AssetPropertiesDialogProps> = ({
  isOpen,
  onClose,
  selectedFmGuids,
  onUpdate,
}) => {
  const [assets, setAssets] = useState<AssetProperties[]>([]);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState<Partial<AssetProperties>>({});
  const [position, setPosition] = useState({ x: 20, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(false);

  const isMultiSelect = selectedFmGuids.length > 1;

  // Fetch assets and symbols
  useEffect(() => {
    if (!isOpen || selectedFmGuids.length === 0) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [assetsRes, symbolsRes] = await Promise.all([
          supabase
            .from('assets')
            .select('*')
            .in('fm_guid', selectedFmGuids.map(g => g.toUpperCase())),
          supabase.from('annotation_symbols').select('id, name, category, color, icon_url').order('name'),
        ]);

        if (assetsRes.error) throw assetsRes.error;
        if (symbolsRes.error) throw symbolsRes.error;

        setAssets(assetsRes.data as AssetProperties[] || []);
        setSymbols(symbolsRes.data as AnnotationSymbol[] || []);
      } catch (error: any) {
        toast.error('Kunde inte hämta data: ' + error.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [isOpen, selectedFmGuids]);

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
        x: Math.max(0, Math.min(window.innerWidth - 320, e.clientX - dragOffset.x)),
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

  const handleStartEdit = () => {
    if (isMultiSelect) {
      setEditData({ symbol_id: assets[0]?.symbol_id || null });
    } else if (assets[0]) {
      setEditData({
        name: assets[0].name,
        common_name: assets[0].common_name,
        symbol_id: assets[0].symbol_id,
      });
    }
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (assets.length === 0) return;
    setIsSaving(true);

    try {
      const updatePayload: Record<string, any> = {};
      
      if (editData.symbol_id !== undefined) {
        updatePayload.symbol_id = editData.symbol_id || null;
      }
      if (!isMultiSelect) {
        if (editData.name !== undefined) updatePayload.name = editData.name;
        if (editData.common_name !== undefined) updatePayload.common_name = editData.common_name;
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error } = await supabase
          .from('assets')
          .update(updatePayload)
          .in('fm_guid', assets.map(a => a.fm_guid));

        if (error) throw error;

        toast.success(isMultiSelect 
          ? `Uppdaterade ${assets.length} assets` 
          : 'Egenskaper sparade');
        onUpdate?.();
      }

      setIsEditing(false);
    } catch (error: any) {
      toast.error('Fel vid sparning: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedSymbol = useMemo(() => 
    symbols.find(s => s.id === (editData.symbol_id ?? assets[0]?.symbol_id)),
    [symbols, editData.symbol_id, assets]
  );

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "fixed z-50 bg-card border rounded-lg shadow-xl transition-all",
        "w-80 max-h-[70vh] flex flex-col",
        isDragging && "cursor-grabbing opacity-90"
      )}
      style={{ left: position.x, top: position.y }}
    >
      {/* Header - Draggable */}
      <div
        className="flex items-center justify-between p-3 border-b cursor-grab select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            Egenskaper {isMultiSelect && <Badge variant="secondary" className="ml-1">{assets.length}</Badge>}
          </span>
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
          {/* Content */}
          <ScrollArea className="flex-1 p-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : assets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <p>Ingen asset hittad i databasen</p>
                <p className="text-xs mt-1">Objektet kanske inte är synkat ännu</p>
              </div>
            ) : isMultiSelect ? (
              /* Multi-select view */
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  {assets.length} objekt markerade
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-xs">Gemensam symbol</Label>
                  {isEditing ? (
                    <Select
                      value={editData.symbol_id || ''}
                      onValueChange={(v) => setEditData({ ...editData, symbol_id: v || null })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Välj symbol..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border shadow-lg z-[100]">
                        <SelectItem value="">Ingen symbol</SelectItem>
                        {symbols.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <div className="flex items-center gap-2">
                              {s.icon_url ? (
                                <img src={s.icon_url} alt="" className="w-4 h-4 rounded" />
                              ) : (
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
                              )}
                              <span>{s.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                      {selectedSymbol ? (
                        <>
                          {selectedSymbol.icon_url ? (
                            <img src={selectedSymbol.icon_url} alt="" className="w-5 h-5 rounded" />
                          ) : (
                            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: selectedSymbol.color }} />
                          )}
                          <span>{selectedSymbol.name}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Ingen symbol</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Single asset view */
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">FM GUID</Label>
                  <p className="text-xs font-mono break-all">{assets[0].fm_guid}</p>
                </div>

                <Separator />

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Namn</Label>
                  {isEditing ? (
                    <Input
                      value={editData.name || ''}
                      onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                      className="h-8 text-sm"
                    />
                  ) : (
                    <p className="text-sm">{assets[0].name || '-'}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Common Name</Label>
                  {isEditing ? (
                    <Input
                      value={editData.common_name || ''}
                      onChange={(e) => setEditData({ ...editData, common_name: e.target.value })}
                      className="h-8 text-sm"
                    />
                  ) : (
                    <p className="text-sm">{assets[0].common_name || '-'}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Kategori</Label>
                  <Badge variant="outline">{assets[0].category}</Badge>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Asset Type</Label>
                  <p className="text-sm">{assets[0].asset_type || '-'}</p>
                </div>

                <Separator />

                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Annotationssymbol</Label>
                  {isEditing ? (
                    <Select
                      value={editData.symbol_id || ''}
                      onValueChange={(v) => setEditData({ ...editData, symbol_id: v || null })}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Välj symbol..." />
                      </SelectTrigger>
                      <SelectContent className="bg-card border shadow-lg z-[100]">
                        <SelectItem value="">Ingen symbol</SelectItem>
                        {symbols.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            <div className="flex items-center gap-2">
                              {s.icon_url ? (
                                <img src={s.icon_url} alt="" className="w-4 h-4 rounded" />
                              ) : (
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
                              )}
                              <span>{s.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
                      {selectedSymbol ? (
                        <>
                          {selectedSymbol.icon_url ? (
                            <img src={selectedSymbol.icon_url} alt="" className="w-5 h-5 rounded" />
                          ) : (
                            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: selectedSymbol.color }} />
                          )}
                          <span>{selectedSymbol.name}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Ingen symbol</span>
                      )}
                    </div>
                  )}
                </div>

                {assets[0].coordinate_x !== null && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Koordinater</Label>
                      <p className="text-xs font-mono">
                        X: {assets[0].coordinate_x?.toFixed(2)}, 
                        Y: {assets[0].coordinate_y?.toFixed(2)}, 
                        Z: {assets[0].coordinate_z?.toFixed(2)}
                      </p>
                    </div>
                  </>
                )}

                <Separator />
                
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {assets[0].is_local && <Badge variant="secondary">Lokal</Badge>}
                  {assets[0].annotation_placed && <Badge variant="secondary">Placerad</Badge>}
                </div>
              </div>
            )}
          </ScrollArea>

          {/* Footer actions */}
          {assets.length > 0 && (
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
                <Button variant="outline" size="sm" onClick={handleStartEdit}>
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

export default AssetPropertiesDialog;
