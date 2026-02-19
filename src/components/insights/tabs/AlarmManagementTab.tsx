import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { Trash2, Search, Loader2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AlarmAsset {
  id: string;
  fm_guid: string;
  level_fm_guid: string | null;
  in_room_fm_guid: string | null;
  updated_at: string;
}

interface LevelName {
  fm_guid: string;
  name: string | null;
  common_name: string | null;
}

interface AlarmManagementTabProps {
  buildingFmGuid: string;
  buildingName?: string;
  onAlarmsDeleted?: () => void;
}

const PAGE_SIZE = 100;

export default function AlarmManagementTab({ buildingFmGuid, buildingName, onAlarmsDeleted }: AlarmManagementTabProps) {
  const { toast } = useToast();
  const [alarms, setAlarms] = useState<AlarmAsset[]>([]);
  const [levelNames, setLevelNames] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteSelected, setShowDeleteSelected] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const fetchAlarms = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('assets')
        .select('id, fm_guid, level_fm_guid, in_room_fm_guid, updated_at', { count: 'exact' })
        .eq('building_fm_guid', buildingFmGuid)
        .eq('asset_type', 'IfcAlarm')
        .order('updated_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (levelFilter) {
        query = query.eq('level_fm_guid', levelFilter);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setAlarms(data || []);
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
  }, [fetchLevelNames]);

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
      toast({ title: `${selectedIds.size} larm raderade` });
      setSelectedIds(new Set());
      setShowDeleteSelected(false);
      fetchAlarms();
      onAlarmsDeleted?.();
    } catch (e: any) {
      toast({ title: 'Fel vid radering', description: e.message, variant: 'destructive' });
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
      toast({ title: 'Alla larm raderade' });
      setShowDeleteAll(false);
      setPage(0);
      fetchAlarms();
      onAlarmsDeleted?.();
    } catch (e: any) {
      toast({ title: 'Fel vid radering', description: e.message, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
    }
  };

  const uniqueLevels = Array.from(new Set(
    alarms.map(a => a.level_fm_guid).filter(Boolean) as string[]
  ));

  const filteredAlarms = searchQuery
    ? alarms.filter(a => a.fm_guid.toLowerCase().includes(searchQuery.toLowerCase()))
    : alarms;

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Sök FM-GUID..."
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
          >Alla våningar</Button>
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
              Radera valda ({selectedIds.size})
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteAll(true)}
            disabled={isDeleting}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            {levelFilter ? 'Radera för denna våning' : 'Radera alla'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{totalCount.toLocaleString()} larm totalt</span>
        {selectedIds.size > 0 && (
          <Badge variant="secondary">{selectedIds.size} valda</Badge>
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
              <TableHead>FM-GUID</TableHead>
              <TableHead>Våning</TableHead>
              <TableHead>Rum (GUID)</TableHead>
              <TableHead>Uppdaterad</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAlarms.map(alarm => (
              <TableRow key={alarm.id} className={selectedIds.has(alarm.fm_guid) ? 'bg-primary/5' : ''}>
                <TableCell>
                  <Checkbox
                    checked={selectedIds.has(alarm.fm_guid)}
                    onCheckedChange={() => toggleSelect(alarm.fm_guid)}
                  />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {alarm.fm_guid.length > 20 ? `${alarm.fm_guid.slice(0, 8)}...${alarm.fm_guid.slice(-6)}` : alarm.fm_guid}
                </TableCell>
                <TableCell className="text-xs">
                  {alarm.level_fm_guid
                    ? (levelNames.get(alarm.level_fm_guid) || alarm.level_fm_guid.slice(0, 10) + '…')
                    : <span className="text-muted-foreground">—</span>
                  }
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {alarm.in_room_fm_guid ? alarm.in_room_fm_guid.slice(0, 12) + '…' : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(alarm.updated_at).toLocaleDateString('sv-SE')}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:bg-destructive/10"
                    onClick={async () => {
                      const { error } = await supabase
                        .from('assets')
                        .delete()
                        .eq('fm_guid', alarm.fm_guid);
                      if (!error) {
                        toast({ title: 'Larm raderat' });
                        fetchAlarms();
                        onAlarmsDeleted?.();
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filteredAlarms.length === 0 && !isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  Inga larm hittades
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
            Sida {page + 1} av {totalPages}
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

      {/* Delete Selected Dialog */}
      <AlertDialog open={showDeleteSelected} onOpenChange={setShowDeleteSelected}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Radera {selectedIds.size} larm
            </AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill radera de valda larmen? Åtgärden kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteSelected}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Radera
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
              Radera {levelFilter ? 'alla larm för denna våning' : `alla ${totalCount.toLocaleString()} larm`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {levelFilter
                ? `Detta raderar alla IfcAlarm-objekt på vald våning för ${buildingName || 'byggnaden'}.`
                : `Detta raderar ALLA ${totalCount.toLocaleString()} IfcAlarm-objekt för ${buildingName || 'byggnaden'}.`
              } Åtgärden kan INTE ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteAll}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Ja, radera
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
