import React, { useState, useEffect, useCallback, useContext } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash2, Search, Loader2, AlertTriangle, ChevronLeft, ChevronRight, Mail, Box, MapPin, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';


interface AlarmAsset {
  id: string;
  fm_guid: string;
  name: string | null;
  common_name: string | null;
  level_fm_guid: string | null;
  in_room_fm_guid: string | null;
  updated_at: string;
  created_at: string;
  attributes: Record<string, any> | null;
  asset_type: string | null;
  annotation_placed: boolean | null;
  coordinate_x: number | null;
  coordinate_y: number | null;
  coordinate_z: number | null;
}

interface AlarmManagementTabProps {
  buildingFmGuid: string;
  buildingName?: string;
  onAlarmsDeleted?: () => void;
}

const PAGE_SIZE = 100;

export default function AlarmManagementTab({ buildingFmGuid, buildingName, onAlarmsDeleted }: AlarmManagementTabProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [alarms, setAlarms] = useState<AlarmAsset[]>([]);
  const [levelNames, setLevelNames] = useState<Map<string, string>>(new Map());
  const [roomNames, setRoomNames] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteSelected, setShowDeleteSelected] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [showDeleteRandom, setShowDeleteRandom] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedAlarm, setSelectedAlarm] = useState<AlarmAsset | null>(null);

  const fetchLevelNames = useCallback(async () => {
    const { data } = await supabase
      .from('assets')
      .select('fm_guid, name, common_name')
      .eq('building_fm_guid', buildingFmGuid)
      .in('category', ['Building Storey', 'IfcBuildingStorey'])
      .limit(50);
    if (data) {
      const map = new Map<string, string>();
      data.forEach((d: any) => {
        map.set(d.fm_guid, d.common_name || d.name || d.fm_guid.slice(0, 8));
      });
      setLevelNames(map);
    }
  }, [buildingFmGuid]);

  const fetchRoomNames = useCallback(async () => {
    const { data } = await supabase
      .from('assets')
      .select('fm_guid, name, common_name')
      .eq('building_fm_guid', buildingFmGuid)
      .in('category', ['Space', 'IfcSpace'])
      .limit(500);
    if (data) {
      const map = new Map<string, string>();
      data.forEach((d: any) => {
        map.set(d.fm_guid, d.common_name || d.name || d.fm_guid.slice(0, 8));
      });
      setRoomNames(map);
    }
  }, [buildingFmGuid]);

  const fetchAlarms = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('assets')
        .select('id, fm_guid, name, common_name, level_fm_guid, in_room_fm_guid, updated_at, created_at, attributes, asset_type, annotation_placed, coordinate_x, coordinate_y, coordinate_z', { count: 'exact' })
        .eq('building_fm_guid', buildingFmGuid)
        .eq('asset_type', 'IfcAlarm')
        .order('updated_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (levelFilter) {
        query = query.eq('level_fm_guid', levelFilter);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setAlarms((data as AlarmAsset[]) || []);
      setTotalCount(count || 0);
      setSelectedIds(new Set());
    } catch (e) {
      console.error('Error fetching alarms:', e);
    } finally {
      setIsLoading(false);
    }
  }, [buildingFmGuid, page, levelFilter]);

  useEffect(() => {
    fetchLevelNames();
    fetchRoomNames();
  }, [fetchLevelNames, fetchRoomNames]);

  useEffect(() => {
    fetchAlarms();
  }, [fetchAlarms]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === alarms.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(alarms.map(a => a.fm_guid)));
    }
  };

  const handleDeleteSelected = async () => {
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('assets')
        .delete()
        .in('fm_guid', Array.from(selectedIds))
        .eq('building_fm_guid', buildingFmGuid);
      if (error) throw error;
      toast({ title: `${selectedIds.size} alarms deleted` });
      setSelectedIds(new Set());
      setShowDeleteSelected(false);
      fetchAlarms();
      onAlarmsDeleted?.();
    } catch (e: any) {
      toast({ title: 'Deletion error', description: e.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    setIsDeleting(true);
    try {
      let query = supabase
        .from('assets')
        .delete()
        .eq('building_fm_guid', buildingFmGuid)
        .eq('asset_type', 'IfcAlarm');
      if (levelFilter) {
        query = query.eq('level_fm_guid', levelFilter);
      }
      const { error } = await query;
      if (error) throw error;
      toast({ title: 'All alarms deleted' });
      setShowDeleteAll(false);
      setPage(0);
      fetchAlarms();
      onAlarmsDeleted?.();
    } catch (e: any) {
      toast({ title: 'Error deleting', description: e.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteRandom90 = async () => {
    setIsDeleting(true);
    try {
      const { data: allAlarms, error: fetchError } = await supabase
        .from('assets')
        .select('fm_guid')
        .eq('building_fm_guid', buildingFmGuid)
        .eq('asset_type', 'IfcAlarm')
        .limit(10000);
      if (fetchError) throw fetchError;
      if (!allAlarms || allAlarms.length === 0) {
        toast({ title: 'No alarms to delete' });
        setShowDeleteRandom(false);
        setIsDeleting(false);
        return;
      }

      const shuffled = [...allAlarms].sort(() => Math.random() - 0.5);
      const toDelete = shuffled.slice(0, Math.floor(shuffled.length * 0.9));
      const guids = toDelete.map(a => a.fm_guid);

      for (let i = 0; i < guids.length; i += 500) {
        const batch = guids.slice(i, i + 500);
        const { error } = await supabase
          .from('assets')
          .delete()
          .in('fm_guid', batch)
          .eq('building_fm_guid', buildingFmGuid);
        if (error) throw error;
      }

      toast({ title: `${toDelete.length} of ${allAlarms.length} alarms deleted (90%)` });
      setShowDeleteRandom(false);
      setPage(0);
      fetchAlarms();
      onAlarmsDeleted?.();
    } catch (e: any) {
      toast({ title: 'Error deleting', description: e.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleShowIn3D = (alarm: AlarmAsset) => {
    const targetGuid = alarm.in_room_fm_guid || alarm.fm_guid;
    navigate(`/viewer?building=${buildingFmGuid}&object=${targetGuid}`);
  };

  const handleShowAnnotation = (alarm: AlarmAsset) => {
    navigate(`/viewer?building=${buildingFmGuid}&object=${alarm.fm_guid}&annotations=true`);
  };

  const handleSendEmail = (alarm: AlarmAsset) => {
    const alarmName = alarm.name || alarm.common_name || alarm.fm_guid;
    const floorName = alarm.level_fm_guid ? (levelNames.get(alarm.level_fm_guid) || alarm.level_fm_guid) : 'N/A';
    const roomName = alarm.in_room_fm_guid ? (roomNames.get(alarm.in_room_fm_guid) || alarm.in_room_fm_guid) : 'N/A';
    const attrs = alarm.attributes ? Object.entries(alarm.attributes).map(([k, v]) => `  ${k}: ${v}`).join('\n') : 'None';
    
    const subject = encodeURIComponent(`Alarm: ${alarmName} — ${buildingName || 'Building'}`);
    const body = encodeURIComponent(
`Alarm Details
─────────────
Name: ${alarmName}
FM GUID: ${alarm.fm_guid}
Type: ${alarm.asset_type || 'IfcAlarm'}
Floor: ${floorName}
Room: ${roomName}
Created: ${new Date(alarm.created_at).toLocaleString()}
Updated: ${new Date(alarm.updated_at).toLocaleString()}
Building: ${buildingName || buildingFmGuid}
${alarm.coordinate_x != null ? `Position: (${alarm.coordinate_x?.toFixed(2)}, ${alarm.coordinate_y?.toFixed(2)}, ${alarm.coordinate_z?.toFixed(2)})` : ''}

Attributes:
${attrs}
`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  };

  const filteredAlarms = searchQuery
    ? alarms.filter(a => 
        a.fm_guid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.common_name || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : alarms;

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search name or FM-GUID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-8 h-9"
          />
        </div>

        {/* Level filter chips */}
        <div className="flex gap-1 flex-wrap">
          <Button
            variant={levelFilter === '' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setLevelFilter(''); setPage(0); }}
          >All floors</Button>
          {Array.from(levelNames.entries()).map(([guid, name]) => (
            <Button
              key={guid}
              variant={levelFilter === guid ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setLevelFilter(guid); setPage(0); }}
            >{name}</Button>
          ))}
        </div>

        <div className="flex gap-2 ml-auto">
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteSelected(true)}
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete selected ({selectedIds.size})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteRandom(true)}
            disabled={isDeleting}
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete 90%
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteAll(true)}
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {levelFilter ? 'Delete floor alarms' : 'Delete all'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{totalCount.toLocaleString()} alarms total</span>
        {selectedIds.size > 0 && (
          <Badge variant="secondary">{selectedIds.size} selected</Badge>
        )}
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>

      {/* Table */}
      <ScrollArea className="h-[420px] border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selectedIds.size === filteredAlarms.length && filteredAlarms.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead>Name / FM-GUID</TableHead>
              <TableHead>Floor</TableHead>
              <TableHead>Room</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[120px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAlarms.map(alarm => (
              <TableRow
                key={alarm.id}
                className={`cursor-pointer ${selectedIds.has(alarm.fm_guid) ? 'bg-primary/5' : ''}`}
                onClick={() => setSelectedAlarm(alarm)}
              >
                <TableCell onClick={e => e.stopPropagation()}>
                  <Checkbox
                    checked={selectedIds.has(alarm.fm_guid)}
                    onCheckedChange={() => toggleSelect(alarm.fm_guid)}
                  />
                </TableCell>
                <TableCell>
                  <div className="text-xs font-medium">{alarm.name || alarm.common_name || '—'}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {alarm.fm_guid.length > 20 ? `${alarm.fm_guid.slice(0, 8)}...${alarm.fm_guid.slice(-6)}` : alarm.fm_guid}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {alarm.level_fm_guid
                    ? (levelNames.get(alarm.level_fm_guid) || alarm.level_fm_guid.slice(0, 10) + '…')
                    : <span className="text-muted-foreground">—</span>
                  }
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {alarm.in_room_fm_guid
                    ? (roomNames.get(alarm.in_room_fm_guid) || alarm.in_room_fm_guid.slice(0, 12) + '…')
                    : '—'
                  }
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(alarm.updated_at).toLocaleDateString('sv-SE')}
                </TableCell>
                <TableCell onClick={e => e.stopPropagation()}>
                  <div className="flex gap-1 justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Show in 3D"
                      onClick={() => handleShowIn3D(alarm)}
                    >
                      <Box className="h-3.5 w-3.5" />
                    </Button>
                    {alarm.annotation_placed && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Show annotation"
                        onClick={() => handleShowAnnotation(alarm)}
                      >
                        <MapPin className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      title="Delete"
                      onClick={async () => {
                        const { error } = await supabase
                          .from('assets')
                          .delete()
                          .eq('fm_guid', alarm.fm_guid);
                        if (!error) {
                          toast({ title: 'Alarm deleted' });
                          fetchAlarms();
                          onAlarmsDeleted?.();
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredAlarms.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  No alarms found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Alarm Detail Sheet */}
      <Sheet open={!!selectedAlarm} onOpenChange={(open) => !open && setSelectedAlarm(null)}>
        <SheetContent className="w-[400px] sm:w-[480px] overflow-y-auto">
          {selectedAlarm && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                  {selectedAlarm.name || selectedAlarm.common_name || 'Alarm'}
                </SheetTitle>
              </SheetHeader>
              
              <div className="space-y-4 mt-4">
                {/* Quick actions */}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleShowIn3D(selectedAlarm)}>
                    <Box className="h-4 w-4 mr-1" /> Show in 3D
                  </Button>
                  {selectedAlarm.annotation_placed && (
                    <Button size="sm" variant="outline" onClick={() => handleShowAnnotation(selectedAlarm)}>
                      <MapPin className="h-4 w-4 mr-1" /> Annotation
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => handleSendEmail(selectedAlarm)}>
                    <Mail className="h-4 w-4 mr-1" /> Send via Email
                  </Button>
                </div>

                {/* Basic info */}
                <div className="space-y-2 text-sm">
                  <h4 className="font-semibold text-foreground">Details</h4>
                  <div className="grid grid-cols-[120px_1fr] gap-y-1.5 gap-x-2">
                    <span className="text-muted-foreground">FM GUID</span>
                    <span className="font-mono text-xs break-all">{selectedAlarm.fm_guid}</span>
                    
                    <span className="text-muted-foreground">Type</span>
                    <span>{selectedAlarm.asset_type || 'IfcAlarm'}</span>
                    
                    <span className="text-muted-foreground">Floor</span>
                    <span>{selectedAlarm.level_fm_guid ? (levelNames.get(selectedAlarm.level_fm_guid) || selectedAlarm.level_fm_guid) : '—'}</span>
                    
                    <span className="text-muted-foreground">Room</span>
                    <span>{selectedAlarm.in_room_fm_guid ? (roomNames.get(selectedAlarm.in_room_fm_guid) || selectedAlarm.in_room_fm_guid) : '—'}</span>
                    
                    <span className="text-muted-foreground">Created</span>
                    <span>{new Date(selectedAlarm.created_at).toLocaleString()}</span>
                    
                    <span className="text-muted-foreground">Updated</span>
                    <span>{new Date(selectedAlarm.updated_at).toLocaleString()}</span>

                    {selectedAlarm.coordinate_x != null && (
                      <>
                        <span className="text-muted-foreground">Position</span>
                        <span className="font-mono text-xs">
                          ({selectedAlarm.coordinate_x?.toFixed(2)}, {selectedAlarm.coordinate_y?.toFixed(2)}, {selectedAlarm.coordinate_z?.toFixed(2)})
                        </span>
                      </>
                    )}

                    <span className="text-muted-foreground">Annotation</span>
                    <span>{selectedAlarm.annotation_placed ? 'Placed' : 'Not placed'}</span>
                  </div>
                </div>

                {/* Attributes */}
                {selectedAlarm.attributes && Object.keys(selectedAlarm.attributes).length > 0 && (
                  <div className="space-y-2 text-sm">
                    <h4 className="font-semibold text-foreground">Attributes</h4>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-1.5">
                      {Object.entries(selectedAlarm.attributes).map(([key, value]) => (
                        <div key={key} className="grid grid-cols-[140px_1fr] gap-x-2">
                          <span className="text-muted-foreground truncate text-xs">{key}</span>
                          <span className="text-xs break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete Selected Dialog */}
      <AlertDialog open={showDeleteSelected} onOpenChange={setShowDeleteSelected}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete {selectedIds.size} alarms
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the selected alarms? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteSelected}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Dialog */}
      <AlertDialog open={showDeleteAll} onOpenChange={setShowDeleteAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete {levelFilter ? 'all alarms for this floor' : `all ${totalCount.toLocaleString()} alarms`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {levelFilter
                ? `This will delete all IfcAlarm objects on the selected floor for ${buildingName || 'the building'}.`
                : `This will delete ALL ${totalCount.toLocaleString()} IfcAlarm objects for ${buildingName || 'the building'}.`
              } This action CANNOT be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteAll}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete 90% Dialog */}
      <AlertDialog open={showDeleteRandom} onOpenChange={setShowDeleteRandom}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete 90% of alarms randomly
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will randomly select and delete approximately 90% of the {totalCount.toLocaleString()} alarms
              for {buildingName || 'the building'}, keeping only ~{Math.ceil(totalCount * 0.1)} alarms.
              This action CANNOT be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteRandom90}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Yes, delete 90%
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
