import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Loader2, RefreshCw, Building2, CheckCircle2, Play,
  ChevronDown, ChevronRight, FolderOpen, FileCode2, AlertCircle, Plus, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/context/LanguageContext';
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

interface SyncLog {
  time: string;
  msg: string;
  level: 'info' | 'ok' | 'warn' | 'error';
}

interface SelectedFile {
  versionUrn: string;
  itemId: string;
  name: string;
  isMaster: boolean;
  folderId: string;
  folderName: string;
}

// Simplified folder tree node (read-only, file-picker only)
function FolderNode({
  folder,
  depth,
  expanded,
  onToggle,
  selectedUrns,
  masterUrn,
  onToggleFile,
  onSetMaster,
}: {
  folder: any;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedUrns: Set<string>;
  masterUrn: string;
  onToggleFile: (file: { versionUrn: string; itemId: string; name: string; folderId: string; folderName: string }) => void;
  onSetMaster: (urn: string) => void;
}) {
  const { t } = useLanguage();
  const isOpen = expanded.has(folder.id);
  const items: any[] = folder.items || [];
  const children: any[] = folder.children || [];
  const bimItems = items.filter((i: any) => i.versionUrn);

  return (
    <div style={{ marginLeft: depth > 0 ? `${Math.min(depth * 12, 36)}px` : undefined }}>
      <button
        onClick={() => onToggle(folder.id)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-muted/50 rounded text-xs"
      >
        {isOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <FolderOpen className="h-3 w-3 shrink-0 text-amber-500" />
        <span className="font-medium truncate flex-1">{folder.name}</span>
        {bimItems.length > 0 && <Badge variant="outline" className="text-[9px] shrink-0">{bimItems.length}</Badge>}
      </button>

      {isOpen && (
        <div className="mt-0.5 space-y-0.5">
          {bimItems.map((item: any) => {
            const selected = selectedUrns.has(item.versionUrn);
            const isMaster = masterUrn === item.versionUrn;
            return (
              <div
                key={item.id}
                style={{ marginLeft: `${Math.min((depth + 1) * 12, 48)}px` }}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${selected ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/40'}`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleFile({ versionUrn: item.versionUrn, itemId: item.id, name: item.name, folderId: folder.id, folderName: folder.name })}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <FileCode2 className="h-3 w-3 shrink-0 text-blue-400" />
                <span className="truncate flex-1">{item.name}</span>
                {selected && (
                  <button
                    title={t('Markera som A-modell (master)', 'Mark as A-model (master)')}
                    onClick={() => onSetMaster(item.versionUrn)}
                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${isMaster ? 'bg-primary text-primary-foreground border-primary' : 'border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary'}`}
                  >
                    A
                  </button>
                )}
              </div>
            );
          })}

          {children.map((child: any) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedUrns={selectedUrns}
              masterUrn={masterUrn}
              onToggleFile={onToggleFile}
              onSetMaster={onSetMaster}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FormaToGeminusPlusPanel() {
  const { t } = useLanguage();
  const { toast } = useToast();

  // APS connection
  // Hubs
  const [hubs, setHubs] = useState<any[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('gt_hubs') || '[]'); } catch { return []; }
  });
  const [selectedHubId, setSelectedHubId] = useState(() => sessionStorage.getItem('gt_hub_id') || '');
  const [isLoadingHubs, setIsLoadingHubs] = useState(false);
  const selectedHubRegion = hubs.find((h: any) => h.id === selectedHubId)?.region || 'US';

  // Projects
  const [projects, setProjects] = useState<any[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('gt_projects') || '[]'); } catch { return []; }
  });
  const [selectedProjectId, setSelectedProjectId] = useState(() => sessionStorage.getItem('gt_project_id') || '');
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  // Folders & file selection
  const [folders, setFolders] = useState<any[]>([]);
  const [topLevelItems, setTopLevelItems] = useState<any[]>([]);
  const [isLoadingFolders, setIsLoadingFolders] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [masterUrn, setMasterUrn] = useState('');

  // Geminus Plus hierarchy: Complex → Building → Model (fetched from edge function)
  const [gpComplexes, setGpComplexes] = useState<any[]>([]);
  const [gpError, setGpError] = useState<string | null>(null);
  const [isLoadingGp, setIsLoadingGp] = useState(false);
  const [expandedComplexes, setExpandedComplexes] = useState<Set<string>>(new Set());
  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(new Set());
  const [selectedModelBimObjectId, setSelectedModelBimObjectId] = useState(() =>
    sessionStorage.getItem('gt_model_bim_object_id') || ''
  );
  // Derived info for selected model
  const selectedModelInfo = useMemo(() => {
    for (const c of gpComplexes) {
      for (const b of c.buildings) {
        const m = b.models.find((m: any) => m.bimObjectId === selectedModelBimObjectId);
        if (m) return { complexName: c.name, buildingName: b.name, buildingBimObjectId: b.bimObjectId, modelName: m.name, label: `${c.name} → ${b.name} → ${m.name}` };
      }
    }
    return null;
  }, [gpComplexes, selectedModelBimObjectId]);
  const selectedModelLabel = selectedModelInfo?.label ?? '';

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [syncDone, setSyncDone] = useState(false);
  const [doConvert3d, setDoConvert3d] = useState(true);
  const [doSyncData, setDoSyncData] = useState(false);

  const log = useCallback((msg: string, level: SyncLog['level'] = 'info') => {
    setSyncLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, level }]);
  }, []);

  // Translation job status
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    const { data, error } = await supabase.functions.invoke('acc-to-geminus-plus', {
      body: { action: 'list-jobs' },
    });
    setJobsLoading(false);
    if (error) {
      setJobsError(error.message);
      return [];
    }
    const rows = data?.jobs ?? [];
    setJobs(rows);
    return rows;
  }, []);

  // Job deletion confirmation
  const [jobToDelete, setJobToDelete] = useState<any | null>(null);
  const [deletingJob, setDeletingJob] = useState(false);

  const handleDeleteJob = useCallback(async () => {
    if (!jobToDelete) return;
    setDeletingJob(true);
    try {
      const { data, error } = await supabase.functions.invoke('acc-to-geminus-plus', {
        body: { action: 'delete-job', versionUrn: jobToDelete.version_urn },
      });
      if (error || data?.error) {
        throw new Error(error?.message || data?.error || 'Delete failed');
      }
      await fetchJobs();
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: t('Kunde inte radera jobbet', 'Failed to delete job'),
        description: e.message,
      });
    } finally {
      setDeletingJob(false);
      setJobToDelete(null);
    }
  }, [jobToDelete, fetchJobs, toast, t]);

  // Per-job check status messages
  const [jobCheckResults, setJobCheckResults] = useState<Record<string, string>>({});

  const checkJob = useCallback(async (versionUrn: string, buildingFmGuid: string | null) => {
    setJobCheckResults(prev => ({ ...prev, [versionUrn]: '…' }));
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: { action: 'check-translation', versionUrn, buildingFmGuid },
      });
      const msg = error?.message || data?.error || data?.status || data?.message || 'ok';
      setJobCheckResults(prev => ({ ...prev, [versionUrn]: msg }));
    } catch (e: any) {
      setJobCheckResults(prev => ({ ...prev, [versionUrn]: e.message }));
    }
    await fetchJobs();
  }, [fetchJobs]);

  // Check active jobs with Autodesk MD API — this triggers IFC→XKT pipeline when done
  const checkActiveJobs = useCallback(async () => {
    const data = await fetchJobs();
    const active = data.filter((j: any) => j.translation_status === 'pending' || j.translation_status === 'inprogress');
    for (const job of active) {
      checkJob(job.version_urn, job.building_fm_guid);
    }
  }, [fetchJobs, checkJob]);

  useEffect(() => { checkActiveJobs(); }, [checkActiveJobs]);
  useEffect(() => {
    const hasActive = jobs.some(j => j.translation_status === 'pending' || j.translation_status === 'inprogress');
    if (!hasActive) return;
    const id = setInterval(checkActiveJobs, 30000);
    return () => clearInterval(id);
  }, [jobs, checkActiveJobs]);

  // Persist selections
  useEffect(() => { sessionStorage.setItem('gt_hub_id', selectedHubId); }, [selectedHubId]);
  useEffect(() => { sessionStorage.setItem('gt_project_id', selectedProjectId); }, [selectedProjectId]);
  useEffect(() => { sessionStorage.setItem('gt_model_bim_object_id', selectedModelBimObjectId); }, [selectedModelBimObjectId]);

  // Fetch Geminus Plus hierarchy using server-side credentials from Supabase env vars
  const fetchGpHierarchy = useCallback(async () => {
    setIsLoadingGp(true);
    setGpError(null);
    try {
      const { data, error } = await supabase.functions.invoke('acc-to-geminus-plus', {
        body: { action: 'list-buildings' },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || data?.detail || 'Unknown error');
      setGpComplexes(data.complexes || []);
    } catch (err: any) {
      setGpError(err.message);
    } finally {
      setIsLoadingGp(false);
    }
  }, []);
  useEffect(() => { if (hubs.length) sessionStorage.setItem('gt_hubs', JSON.stringify(hubs)); }, [hubs]);
  useEffect(() => { if (projects.length) sessionStorage.setItem('gt_projects', JSON.stringify(projects)); }, [projects]);
  useEffect(() => { fetchGpHierarchy(); }, [fetchGpHierarchy]);

  // Inline "create model" form state
  const [creatingModelFor, setCreatingModelFor] = useState<string | null>(null);
  const [newModelName, setNewModelName] = useState('');
  const [isCreatingModel, setIsCreatingModel] = useState(false);

  const createModel = useCallback(async (buildingBimObjectId: string) => {
    if (!newModelName.trim()) return;
    setIsCreatingModel(true);
    try {
      const { data, error } = await supabase.functions.invoke('acc-to-geminus-plus', {
        body: { action: 'create-model', buildingBimObjectId, modelName: newModelName.trim() },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message);
      toast({ title: t('Modell skapad', 'Model created'), description: newModelName.trim() });
      setCreatingModelFor(null);
      setNewModelName('');
      await fetchGpHierarchy();
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('Kunde inte skapa modell', 'Could not create model'), description: err.message });
    } finally {
      setIsCreatingModel(false);
    }
  }, [newModelName, fetchGpHierarchy, toast, t]);

  // Auto-fetch projects when hub changes
  useEffect(() => {
    if (selectedHubId) fetchProjects();
  }, [selectedHubId]);

  // Auto-fetch folders when project changes
  useEffect(() => {
    if (selectedProjectId) {
      fetchFolders();
      setSelectedFiles([]);
      setMasterUrn('');
    }
  }, [selectedProjectId]);

  const fetchHubs = async () => {
    setIsLoadingHubs(true);
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', { body: { action: 'list-hubs' } });
      if (error) throw error;
      setHubs(data?.hubs || []);
      if (data?.hubs?.length === 1) setSelectedHubId(data.hubs[0].id);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Fel', description: err.message });
    } finally {
      setIsLoadingHubs(false);
    }
  };

  const fetchProjects = async () => {
    if (!selectedHubId) return;
    setIsLoadingProjects(true);
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: { action: 'list-projects', accountId: selectedHubId, region: selectedHubRegion },
      });
      if (error) throw error;
      setProjects(data?.projects || []);
      if (data?.projects?.length === 1) setSelectedProjectId(data.projects[0].id);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Fel', description: err.message });
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const fetchFolders = async () => {
    if (!selectedProjectId) return;
    setIsLoadingFolders(true);
    try {
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: { action: 'list-archive-files', projectId: selectedProjectId, region: selectedHubRegion, accountId: selectedHubId },
      });
      if (error) throw error;
      setFolders(data?.folders || []);
      setTopLevelItems((data?.topLevelItems || []).filter((i: any) => i.versionUrn));
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('Fel vid hämtning av mappar', 'Folder fetch error'), description: err.message });
    } finally {
      setIsLoadingFolders(false);
    }
  };

  const toggleFolder = (id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleFile = (file: { versionUrn: string; itemId: string; name: string; folderId?: string; folderName?: string }) => {
    setSelectedFiles(prev => {
      const exists = prev.find(f => f.versionUrn === file.versionUrn);
      if (exists) {
        const next = prev.filter(f => f.versionUrn !== file.versionUrn);
        if (masterUrn === file.versionUrn) setMasterUrn(next[0]?.versionUrn || '');
        return next;
      }
      const isMaster = prev.length === 0;
      if (isMaster) setMasterUrn(file.versionUrn);
      return [...prev, { ...file, isMaster }];
    });
  };

  const runSync = async () => {
    if (!selectedProjectId || !selectedModelInfo) {
      toast({ variant: 'destructive', title: 'Missing selection', description: 'Select a Forma project and target model in Geminus Plus.' });
      return;
    }
    if (!doConvert3d && !doSyncData) {
      toast({ variant: 'destructive', title: 'Nothing selected', description: 'Check at least one operation to run.' });
      return;
    }
    const buildingFmGuid = selectedModelInfo.buildingBimObjectId;
    const effectiveModelName = selectedModelInfo.modelName;

    setIsSyncing(true);
    setSyncDone(false);
    setSyncLogs([]);

    try {
      let anyStarted = false;

      // ── 3D conversion ──────────────────────────────────────────────
      if (doConvert3d) {
        if (selectedFiles.length === 0) {
          log('No files selected — pick at least one Revit model to convert.', 'warn');
        } else {
          log(`Starting 3D conversion for ${selectedFiles.length} model(s) → slot "${effectiveModelName}"…`);

          for (const file of selectedFiles) {
            const isMasterModel = masterUrn === file.versionUrn || selectedFiles.length === 1;
            log(`Submitting: ${file.name}${isMasterModel ? ' (A)' : ''}`);

            const { data: transData, error: transErr } = await supabase.functions.invoke('acc-sync', {
              body: {
                action: 'translate-model',
                fileItemId: file.itemId,
                versionUrn: file.versionUrn,
                buildingFmGuid,
                modelName: effectiveModelName || file.name,
                isMasterModel,
                region: selectedHubRegion,
              },
            });

            const transError = transErr?.message || transData?.error;
            if (transError && !transData?.success) {
              log(`Error: ${transError}`, 'error');
              continue;
            }

            if (transData?.alreadyDone) {
              log('Model already converted — skipping.', 'ok');
              anyStarted = true;
            } else if (transData?.status === 'pending' || transData?.status === 'inprogress') {
              log('Conversion job already in progress.', 'ok');
              anyStarted = true;
            } else if (transData?.jobId || transData?.success) {
              log(`Job started: ${transData.jobId ?? '✓'}`, 'ok');
              anyStarted = true;
            } else {
              log('Unexpected response from conversion service.', 'warn');
            }
          }

          if (anyStarted) {
            log(`Conversion running in background. The 3D model will appear in Geminus Plus → ${effectiveModelName} when done (typically 2–10 min).`, 'ok');
          }
        }
      }

      // ── Data sync (BIM hierarchy: levels, rooms, instances) ────────
      if (doSyncData) {
        const filesToSync = selectedFiles.filter(f => f.folderId);
        if (filesToSync.length === 0) {
          log('Data sync: no files with folder context selected.', 'warn');
        } else {
          // Group by folder so each folder is one sync-bim-data call
          const byFolder = new Map<string, { folderId: string; folderName: string; files: SelectedFile[] }>();
          for (const f of filesToSync) {
            const key = f.folderId!;
            if (!byFolder.has(key)) byFolder.set(key, { folderId: f.folderId!, folderName: f.folderName || f.folderId!, files: [] });
            byFolder.get(key)!.files.push(f);
          }

          for (const { folderId, folderName, files } of byFolder.values()) {
            log(`Syncing BIM data from "${folderName}" (${files.length} file(s))…`);
            for (const file of files) {
              const { data: bimRaw, error: bimErr } = await supabase.functions.invoke('acc-sync', {
                body: {
                  action: 'sync-bim-data',
                  projectId: selectedProjectId,
                  folderId,
                  folderName,
                  singleItem: { versionUrn: file.versionUrn, name: file.name },
                  buildingFmGuid,
                  region: selectedHubRegion,
                },
                responseType: 'text',
              });
              // Parse manually so we can log the raw body on parse error
              let bimData: any = null;
              if (bimRaw) {
                try { bimData = JSON.parse(bimRaw); } catch {
                  log(`${file.name}: RAW response: ${String(bimRaw).substring(0, 300)}`, 'error');
                }
              }
              if (bimErr || bimData?.state === 'PROCESSING') {
                const msg = bimData?.error || bimData?.message || bimErr?.message || 'Indexing still in progress — try again in 60s.';
                log(`${file.name}: ${msg}`, bimData?.state === 'PROCESSING' ? 'warn' : 'error');
              } else if (bimData?.success) {
                log(`${file.name}: ${bimData.message}`, 'ok');
                anyStarted = true;
              } else {
                log(`${file.name}: ${bimData?.error || bimData?.message || 'Unknown error'}`, 'error');
              }
            }
          }
        }
      }

      setSyncDone(anyStarted);
      if (anyStarted) {
        toast({ title: 'Conversion started', description: '3D model is being built in the background.' });
        await fetchJobs();
      }
    } catch (err: any) {
      log(`${t('Fel:', 'Error:')} ${err.message}`, 'error');
      toast({ variant: 'destructive', title: t('Synk misslyckades', 'Sync failed'), description: err.message });
    } finally {
      setIsSyncing(false);
    }
  };

  const canSync = !!selectedProjectId && !!selectedModelInfo && !isSyncing;
  const selectedUrns = new Set(selectedFiles.map(f => f.versionUrn));
  const hasFolders = folders.length > 0 || topLevelItems.length > 0;

  return (
    <div className="space-y-4 max-w-2xl">

      {/* Hub + Project */}
      <div className="rounded-lg border p-4 space-y-3">
        <Label className="text-sm font-medium">{t('Forma-projekt', 'Forma project')}</Label>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <select
              className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
              value={selectedHubId}
              onChange={e => { setSelectedHubId(e.target.value); setSelectedProjectId(''); setProjects([]); setFolders([]); setTopLevelItems([]); }}
            >
              <option value="">{t('— Välj konto (Hub) —', '— Select account (Hub) —')}</option>
              {hubs.map((h: any) => <option key={h.id} value={h.id}>{h.name} ({h.region})</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={fetchHubs} disabled={isLoadingHubs} className="shrink-0 gap-1">
              {isLoadingHubs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {hubs.length === 0 ? t('Hämta', 'Fetch') : t('Uppdatera', 'Refresh')}
            </Button>
          </div>

          {selectedHubId && (
            <div className="flex items-center gap-2">
              <select
                className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
              >
                <option value="">{t('— Välj projekt —', '— Select project —')}</option>
                {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Button variant="outline" size="sm" onClick={fetchProjects} disabled={isLoadingProjects} className="shrink-0 gap-1">
                {isLoadingProjects ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {projects.length === 0 ? t('Hämta', 'Fetch') : t('Uppdatera', 'Refresh')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Folder + File browser */}
      {selectedProjectId && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-amber-500" />
              {t('Välj BIM-modeller', 'Select BIM models')}
              {selectedFiles.length > 0 && (
                <Badge className="bg-primary/10 text-primary border-primary/20">{selectedFiles.length} {t('valda', 'selected')}</Badge>
              )}
            </Label>
            <Button variant="ghost" size="sm" onClick={fetchFolders} disabled={isLoadingFolders} className="gap-1 h-7 text-xs">
              {isLoadingFolders ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {t('Uppdatera', 'Refresh')}
            </Button>
          </div>

          {isLoadingFolders ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('Hämtar mappar…', 'Loading folders…')}
            </div>
          ) : hasFolders ? (
            <div className="max-h-64 overflow-y-auto rounded border bg-muted/20 p-2">
              <div className="space-y-0.5">
                {/* Top-level loose items */}
                {topLevelItems.map((item: any) => {
                  const sel = selectedUrns.has(item.versionUrn);
                  const isMaster = masterUrn === item.versionUrn;
                  return (
                    <div key={item.id} className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${sel ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/40'}`}>
                      <input type="checkbox" checked={sel} onChange={() => toggleFile({ versionUrn: item.versionUrn, itemId: item.id, name: item.name })} className="h-3.5 w-3.5 shrink-0" />
                      <FileCode2 className="h-3 w-3 shrink-0 text-blue-400" />
                      <span className="truncate flex-1">{item.name}</span>
                      {sel && (
                        <button onClick={() => setMasterUrn(item.versionUrn)} className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold border ${isMaster ? 'bg-primary text-primary-foreground border-primary' : 'border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary'}`}>A</button>
                      )}
                    </div>
                  );
                })}
                {folders.map((folder: any) => (
                  <FolderNode
                    key={folder.id}
                    folder={folder}
                    depth={0}
                    expanded={expandedFolders}
                    onToggle={toggleFolder}
                    selectedUrns={selectedUrns}
                    masterUrn={masterUrn}
                    onToggleFile={toggleFile}
                    onSetMaster={setMasterUrn}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {t('Inga filer hittades i projektet.', 'No files found in the project.')}
            </p>
          )}

          {selectedFiles.length > 0 && (
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p className="font-medium text-foreground">{t('Valda modeller:', 'Selected models:')}</p>
              {selectedFiles.map(f => (
                <div key={f.versionUrn} className="flex items-center gap-1.5">
                  {masterUrn === f.versionUrn && <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1 rounded">A</span>}
                  <span>{f.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Target building + model in Geminus Plus */}
      <div className="rounded-lg border p-4 space-y-3">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Building2 className="h-4 w-4 text-blue-500" />
          {t('Målbyggnad och modell i Geminus Plus', 'Target building and model in Geminus Plus')}
          <button onClick={fetchGpHierarchy} disabled={isLoadingGp} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingGp ? 'animate-spin' : ''}`} />
          </button>
          {selectedModelLabel && (
            <Badge className="bg-primary/10 text-primary border-primary/20 font-normal max-w-[55%] truncate">
              {selectedModelLabel}
            </Badge>
          )}
        </Label>

        {isLoadingGp ? (
          <p className="text-xs text-muted-foreground">{t('Hämtar...', 'Loading...')}</p>
        ) : gpError ? (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 p-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <p className="text-xs text-destructive font-medium">{t('Kunde inte hämta hierarki', 'Could not fetch hierarchy')}</p>
              <p className="text-xs text-destructive/80 break-words">{gpError}</p>
            </div>
          </div>
        ) : gpComplexes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('Inga byggnader hittades i Geminus Plus. Kontrollera API-inställningar.', 'No buildings found in Geminus Plus. Check API settings.')}
          </p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded border bg-muted/20 p-1">
            <div className="space-y-0.5">
              {gpComplexes.map((complex: any) => {
                const isComplexOpen = expandedComplexes.has(complex.name);
                return (
                  <div key={complex.bimObjectId ?? complex.name}>
                    {/* Complex row */}
                    <button
                      onClick={() => setExpandedComplexes(prev => {
                        const next = new Set(prev); if (next.has(complex.name)) next.delete(complex.name); else next.add(complex.name); return next;
                      })}
                      className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-xs font-semibold text-left hover:bg-muted/50"
                    >
                      {isComplexOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="truncate flex-1">{complex.name}</span>
                      <Badge variant="outline" className="text-[9px] shrink-0">{complex.buildings.length}</Badge>
                    </button>

                    {isComplexOpen && complex.buildings.map((building: any) => {
                      const buildingKey = building.bimObjectId ?? building.name;
                      const isBuildingOpen = expandedBuildings.has(buildingKey);
                      return (
                        <div key={buildingKey} className="ml-4">
                          {/* Building row */}
                          <button
                            onClick={() => setExpandedBuildings(prev => {
                              const next = new Set(prev); if (next.has(buildingKey)) next.delete(buildingKey); else next.add(buildingKey); return next;
                            })}
                            className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-xs text-left hover:bg-muted/50"
                          >
                            {isBuildingOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                            <Building2 className="h-3 w-3 shrink-0 text-blue-400" />
                            <span className="truncate flex-1">{building.name}</span>
                            {building.models.length > 0 && <Badge variant="outline" className="text-[9px] shrink-0">{building.models.length}</Badge>}
                          </button>

                          {isBuildingOpen && (
                            <div className="ml-5 space-y-0.5 mb-0.5">
                              {building.models.map((model: any) => {
                                const isSelected = selectedModelBimObjectId === model.bimObjectId;
                                return (
                                  <button key={model.bimObjectId} onClick={() => setSelectedModelBimObjectId(model.bimObjectId)}
                                    className={`flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-left ${isSelected ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-muted/50'}`}>
                                    <FileCode2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    <span className="truncate flex-1">{model.name}</span>
                                    <span className="text-[9px] text-muted-foreground shrink-0">{model.modelType}</span>
                                    {isSelected && <CheckCircle2 className="h-3 w-3 ml-1 shrink-0" />}
                                  </button>
                                );
                              })}

                              {/* Create model inline form */}
                              {creatingModelFor === buildingKey ? (
                                <div className="flex items-center gap-1 px-1 py-1">
                                  <input
                                    autoFocus
                                    type="text"
                                    placeholder={t('Modellnamn…', 'Model name…')}
                                    value={newModelName}
                                    onChange={e => setNewModelName(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') createModel(building.bimObjectId);
                                      if (e.key === 'Escape') { setCreatingModelFor(null); setNewModelName(''); }
                                    }}
                                    className="flex-1 h-6 px-2 rounded border border-input bg-background text-xs min-w-0"
                                  />
                                  <button
                                    onClick={() => createModel(building.bimObjectId)}
                                    disabled={isCreatingModel || !newModelName.trim()}
                                    className="shrink-0 flex items-center justify-center h-6 w-6 rounded bg-primary text-primary-foreground disabled:opacity-50"
                                  >
                                    {isCreatingModel ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                                  </button>
                                  <button
                                    onClick={() => { setCreatingModelFor(null); setNewModelName(''); }}
                                    className="shrink-0 flex items-center justify-center h-6 w-6 rounded hover:bg-muted"
                                  >
                                    <X className="h-3 w-3 text-muted-foreground" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setCreatingModelFor(buildingKey); setNewModelName(''); }}
                                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 w-full"
                                >
                                  <Plus className="h-3 w-3" />
                                  {t('Lägg till modell', 'Add model')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sync button */}
      <div className="rounded-lg border p-4 space-y-3">
        {/* Operation checkboxes */}
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={doConvert3d}
              onChange={e => setDoConvert3d(e.target.checked)}
              disabled={isSyncing}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-sm font-medium">Convert to 3D</span>
            <span className="text-xs text-muted-foreground">Revit → XKT in Geminus Plus</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={doSyncData}
              onChange={e => setDoSyncData(e.target.checked)}
              disabled={isSyncing}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span className="text-sm font-medium">Sync data</span>
            <span className="text-xs text-muted-foreground">Rooms, assets and metadata</span>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={runSync} disabled={!canSync || (!doConvert3d && !doSyncData)} size="lg" className="gap-2">
            {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {isSyncing ? 'Running…' : 'Run selected'}
          </Button>
          {syncDone && <CheckCircle2 className="h-5 w-5 text-green-600" />}
        </div>

        {syncLogs.length > 0 && (
          <ScrollArea className="h-40 rounded-md border bg-muted/30 p-2">
            <div className="space-y-0.5 font-mono text-[11px]">
              {syncLogs.map((l, i) => (
                <div key={i} className={
                  l.level === 'ok' ? 'text-green-700 dark:text-green-400' :
                  l.level === 'warn' ? 'text-yellow-700 dark:text-yellow-400' :
                  l.level === 'error' ? 'text-destructive' :
                  'text-muted-foreground'
                }>
                  <span className="opacity-60">{l.time}</span> {l.msg}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Translation job status — always visible */}
      <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium flex items-center gap-2">
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${jobsLoading ? 'animate-spin' : ''}`} />
              {t('Konverteringsjobb', 'Conversion jobs')}
            </Label>
            <button onClick={() => fetchJobs()} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {t('Uppdatera', 'Refresh')}
            </button>
          </div>
          {jobsError && <p className="text-xs text-destructive">{jobsError}</p>}
          {!jobsLoading && jobs.length === 0 && !jobsError && (
            <p className="text-xs text-muted-foreground">{t('Inga jobb ännu.', 'No jobs yet.')}</p>
          )}
          <div className="space-y-1.5">
            {jobs.map(job => {
              const status = job.translation_status as string;
              const isActive = status === 'pending' || status === 'inprogress';
              const isDone = status === 'success';
              const isFailed = status === 'failed';
              const startedAt = job.started_at ? new Date(job.started_at) : null;
              const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 60000) : null;

              return (
                <div key={job.version_urn} className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-xs ${
                  isActive ? 'border-blue-400/40 bg-blue-500/5' :
                  isDone   ? 'border-green-400/40 bg-green-500/5' :
                  isFailed ? 'border-red-400/40 bg-red-500/5' :
                  'border-border bg-muted/20'
                }`}>
                  <div className="mt-0.5 shrink-0">
                    {isActive && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
                    {isDone   && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                    {isFailed && <AlertCircle className="h-3.5 w-3.5 text-destructive" />}
                  </div>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <p className="font-medium truncate">{job.model_name || job.file_name || job.version_urn}</p>
                    <p className="text-muted-foreground">
                      {isActive && elapsed !== null && t(`Pågår — startad för ${elapsed} min sedan`, `Running — started ${elapsed} min ago`)}
                      {isActive && elapsed === null && t('Pågår…', 'Running…')}
                      {isDone && t('Klar', 'Done')}
                      {isFailed && t('Misslyckades', 'Failed')}
                      {!isActive && !isDone && !isFailed && status}
                    </p>
                    {jobCheckResults[job.version_urn] && (
                      <p className="text-[10px] text-muted-foreground italic truncate">{jobCheckResults[job.version_urn]}</p>
                    )}
                  </div>
                  {(isActive || isDone) && (
                    <button
                      onClick={() => checkJob(job.version_urn, job.building_fm_guid ?? null)}
                      className="shrink-0 text-[10px] text-blue-600 hover:underline"
                    >
                      {jobCheckResults[job.version_urn] === '…' ? '…' : t('Kör check', 'Run check')}
                    </button>
                  )}
                  <button
                    onClick={() => setJobToDelete(job)}
                    className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
                    title={t('Radera jobb', 'Delete job')}
                  >✕</button>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    isActive ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' :
                    isDone   ? 'bg-green-500/15 text-green-700 dark:text-green-400' :
                    isFailed ? 'bg-red-500/15 text-destructive' :
                    'bg-muted text-muted-foreground'
                  }`}>{status}</span>
                </div>
              );
            })}
          </div>
        </div>

      {/* Delete job confirmation dialog */}
      <AlertDialog open={!!jobToDelete} onOpenChange={(open) => { if (!open) setJobToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Radera konverteringsjobb?', 'Delete conversion job?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `Är du säker på att du vill radera jobbet "${jobToDelete?.model_name || jobToDelete?.file_name || jobToDelete?.version_urn}"? Åtgärden kan inte ångras.`,
                `Are you sure you want to delete the job "${jobToDelete?.model_name || jobToDelete?.file_name || jobToDelete?.version_urn}"? This action cannot be undone.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingJob}>{t('Avbryt', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingJob}
              onClick={handleDeleteJob}
            >
              {t('Radera', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
