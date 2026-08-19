import React, { useEffect, useState, useCallback, useContext } from 'react';
import {
  HardHat, Plus, RefreshCw, CheckCircle, Clock, Archive, Activity,
  ExternalLink, AlertCircle, Copy, ChevronRight, ChevronDown, FolderOpen, Folder, Trash2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { AppContext } from '@/context/AppContext';

interface RenovationProject {
  id: string;
  building_fm_guid: string;
  name: string;
  acc_renovation_project_id: string | null;
  acc_account_id: string | null;
  archive_project_id: string | null;
  archive_file_item_id: string | null;
  archive_file_name: string | null;
  archive_version_urn: string | null;
  acc_setup_status: 'pending' | 'creating' | 'ready' | 'error';
  acc_setup_error: string | null;
  status: 'planning' | 'active' | 'completed' | 'archived';
  affected_level_fm_guids: string[];
  affected_room_fm_guids: string[];
  affected_system_types: string[];
  scope_zone_description: string | null;
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
}

interface BuildingOption { fm_guid: string; name: string; common_name: string | null }
interface LevelOption { fm_guid: string; name: string; common_name: string | null }
interface RoomOption { fm_guid: string; name: string; common_name: string | null }
interface ArchiveFile { itemId: string; name: string; versionUrn: string | null; folderId: string; folderName?: string }

const SYSTEM_TYPES = [
  { id: 'LUF', label: 'LUF — Luftbehandling', description: 'Ventilation, air handling units' },
  { id: 'VS',  label: 'VS — Värme/Sanitet',   description: 'Heating, plumbing, domestic water' },
  { id: 'KYL', label: 'KYL — Kyla',            description: 'Cooling, chilled water' },
  { id: 'EL',  label: 'EL — El och data',       description: 'Power, lighting, data networks' },
  { id: 'SP',  label: 'SP — Sprinkler',          description: 'Fire suppression' },
  { id: 'BRAND', label: 'BRAND — Brandlarm',    description: 'Fire detection and alarm' },
  { id: 'AUTO',  label: 'AUTO — Automation/BAS', description: 'Building automation, BAS/DDC' },
];

const STATUS_CONFIG = {
  planning:  { label: 'Planning',  icon: Clock,        color: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
  active:    { label: 'Active',    icon: Activity,     color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  completed: { label: 'Completed', icon: CheckCircle,  color: 'bg-green-500/15 text-green-400 border-green-500/30' },
  archived:  { label: 'Archived',  icon: Archive,      color: 'bg-muted/40 text-muted-foreground border-border' },
};

const SETUP_STATUS_CONFIG = {
  pending:   { label: 'Not set up in Autodesk Forma', color: 'text-muted-foreground' },
  creating:  { label: 'Setting up in Autodesk Forma…', color: 'text-blue-400' },
  ready:     { label: 'Ready in Autodesk Forma',       color: 'text-green-400' },
  error:     { label: 'Setup error',        color: 'text-red-400' },
};

export default function BlmFormaView() {
  const { toast } = useToast();
  const { appConfigs } = useContext(AppContext);

  const [projects, setProjects] = useState<RenovationProject[]>([]);
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState<string | null>(null); // renovationProjectId
  const [levelsByBuilding, setLevelsByBuilding] = useState<Record<string, LevelOption[]>>({});
  const [roomsByBuilding, setRoomsByBuilding] = useState<Record<string, RoomOption[]>>({});

  // Create form
  const [form, setForm] = useState({
    name: '', building_fm_guid: '',
    affected_level_fm_guids: [] as string[],
    affected_room_fm_guids: [] as string[],
    affected_system_types: [] as string[],
    scope_zone_description: '',
    started_at: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  // ACC Setup modal state
  const [accHubs, setAccHubs] = useState<{ id: string; name: string; region: string }[]>([]);
  const [accProjects, setAccProjects] = useState<{ id: string; name: string }[]>([]);
  const [setupForm, setSetupForm] = useState({ accountId: '', projectId: '', archiveRegion: 'US', archiveFolderId: '', archiveFolderName: '', renovationFolderId: '', renovationFolderName: '' });
  const [folderTree, setFolderTree] = useState<Record<string, { name: string; parentId: string | null }>>({});
  const [loadingHubs, setLoadingHubs] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [creatingAccProject, setCreatingAccProject] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    const { data, error } = await supabase.from('renovation_projects').select('*')
      .not('status', 'eq', 'archived').order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Failed to load renovation projects', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    if (data) setProjects(data as RenovationProject[]);
    setLoading(false);
  }, [toast]);

  const loadBuildings = useCallback(async () => {
    const { data, error } = await supabase.from('assets').select('fm_guid, name, common_name').eq('category', 'Building').order('name');
    if (error) {
      toast({ title: 'Failed to load buildings', description: error.message, variant: 'destructive' });
      return;
    }
    if (data) setBuildings(data as BuildingOption[]);
  }, [toast]);

  useEffect(() => { loadProjects(); loadBuildings(); }, [loadProjects, loadBuildings]);

  const loadLevels = useCallback(async (buildingFmGuid: string) => {
    if (levelsByBuilding[buildingFmGuid]) return;
    const { data } = await supabase.from('assets').select('fm_guid, name, common_name')
      .in('category', ['Building Storey', 'IfcBuildingStorey'])
      .eq('building_fm_guid', buildingFmGuid)
      .order('name');
    if (data) setLevelsByBuilding(prev => ({ ...prev, [buildingFmGuid]: data as LevelOption[] }));
  }, [levelsByBuilding]);

  const loadRooms = useCallback(async (buildingFmGuid: string) => {
    if (roomsByBuilding[buildingFmGuid]) return;
    const { data } = await supabase.from('assets').select('fm_guid, name, common_name')
      .in('category', ['Space', 'IfcSpace', 'Room', 'Zone'])
      .eq('building_fm_guid', buildingFmGuid)
      .order('name');
    if (data) setRoomsByBuilding(prev => ({ ...prev, [buildingFmGuid]: data as RoomOption[] }));
  }, [roomsByBuilding]);

  useEffect(() => {
    projects.forEach(p => {
      if (p.building_fm_guid) {
        loadLevels(p.building_fm_guid);
        if (p.affected_room_fm_guids?.length > 0) loadRooms(p.building_fm_guid);
      }
    });
  }, [projects, loadLevels, loadRooms]);

  // Poll projects that are in "creating" state
  useEffect(() => {
    const creating = projects.filter(p => p.acc_setup_status === 'creating');
    if (!creating.length) return;
    const interval = setInterval(async () => {
      const ids = creating.map(p => p.id);
      const { data } = await supabase.from('renovation_projects').select('id, acc_setup_status, acc_renovation_project_id, acc_setup_error').in('id', ids);
      if (!data) return;
      let changed = false;
      setProjects(prev => prev.map(p => {
        const updated = data.find((d: any) => d.id === p.id);
        if (updated && updated.acc_setup_status !== p.acc_setup_status) { changed = true; return { ...p, ...updated }; }
        return p;
      }));
      if (data.some((d: any) => d.acc_setup_status !== 'creating')) clearInterval(interval);
    }, 5000);
    return () => clearInterval(interval);
  }, [projects]);

  const levelDisplayName = (l: LevelOption) => l.name || l.common_name || l.fm_guid;

  const getBuildingName = (guid: string) => {
    const b = buildings.find(b => b.fm_guid === guid);
    return b?.common_name || b?.name || guid;
  };

  const getLevelNames = (project: RenovationProject): string | null => {
    const levels = levelsByBuilding[project.building_fm_guid];
    if (!levels || !project.affected_level_fm_guids?.length) return null;
    return project.affected_level_fm_guids.map(g => { const l = levels.find(lv => lv.fm_guid === g); return l ? levelDisplayName(l) : g; }).join(', ');
  };

  const getWorksetGuide = (project: RenovationProject): { name: string; fmGuid: string }[] => {
    const levels = levelsByBuilding[project.building_fm_guid] || [];
    return (project.affected_level_fm_guids || []).map(g => {
      const l = levels.find(lv => lv.fm_guid === g);
      return {
      name: `BLM_${l ? levelDisplayName(l) : g}`,
      fmGuid: g,
    };});
  };

  // Create project
  const handleCreate = async () => {
    if (!form.name.trim() || !form.building_fm_guid) { toast({ title: 'Name and building are required', variant: 'destructive' }); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('renovation_projects').insert({
      name: form.name.trim(), building_fm_guid: form.building_fm_guid,
      affected_level_fm_guids: form.affected_level_fm_guids,
      affected_room_fm_guids: form.affected_room_fm_guids,
      affected_system_types: form.affected_system_types,
      scope_zone_description: form.scope_zone_description.trim() || null,
      started_at: form.started_at || null, notes: form.notes.trim() || null,
      status: 'planning', acc_setup_status: 'pending', created_by: user?.id,
    });
    setSaving(false);
    if (error) { toast({ title: 'Failed to create project', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Project created' });
    setCreateOpen(false);
    setForm({ name: '', building_fm_guid: '', affected_level_fm_guids: [], affected_room_fm_guids: [], affected_system_types: [], scope_zone_description: '', started_at: '', notes: '' });
    loadProjects();
  };

  const handleDeleteProject = async (id: string) => {
    const { error } = await supabase.from('renovation_projects').delete().eq('id', id);
    if (error) { toast({ title: 'Delete failed', description: error.message, variant: 'destructive' }); return; }
    setProjects(prev => prev.filter(p => p.id !== id));
    setDeleteConfirm(null);
    toast({ title: 'Project deleted' });
  };

  // Status change
  const handleStatusChange = async (project: RenovationProject, newStatus: RenovationProject['status']) => {
    const { error } = await supabase.from('renovation_projects').update({ status: newStatus }).eq('id', project.id);
    if (error) { toast({ title: 'Failed to update status', description: error.message, variant: 'destructive' }); return; }
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, status: newStatus } : p));
    toast({ title: `Project marked as ${newStatus}` });
  };

  // Complete & sync (when already set up in ACC — uses sync-back-to-archive)
  const handleCompleteAndSync = async (project: RenovationProject) => {
    setSyncing(project.id);
    if (project.acc_setup_status === 'ready' && project.acc_renovation_project_id) {
      // Full sync-back
      const { data, error } = await supabase.functions.invoke('acc-sync', {
        body: { action: 'sync-back-to-archive', renovationProjectId: project.id },
      });
      setSyncing(null);
      if (error) { toast({ title: 'Sync failed', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Syncing to archive', description: 'Model is being copied back to the archive project. BIM sync will follow.' });
      loadProjects();
    } else {
      // Simple complete (no ACC)
      const { error } = await supabase.functions.invoke('acc-sync', {
        body: { action: 'complete-renovation-project', renovationProjectId: project.id, buildingFmGuid: project.building_fm_guid },
      });
      setSyncing(null);
      if (error) { toast({ title: 'Failed', description: error.message, variant: 'destructive' }); return; }
      setProjects(prev => prev.filter(p => p.id !== project.id));
      toast({ title: 'Project completed', description: 'Re-sync from master Autodesk Forma project triggered.' });
    }
  };

  // ---- ACC Setup flow ----
  const openSetupModal = async (projectId: string) => {
    setSetupOpen(projectId);
    setSetupForm({ accountId: '', projectId: '', archiveRegion: 'US', archiveFolderId: '', archiveFolderName: '', renovationFolderId: '', renovationFolderName: '' });
    setAccProjects([]);
    setFolderTree({});
    setLoadingHubs(true);
    const { data } = await supabase.functions.invoke('acc-sync', { body: { action: 'list-hubs' } });
    setLoadingHubs(false);
    if (data?.hubs) {
      const hubs = data.hubs.map((h: any) => ({ id: h.id?.replace(/^b\./, ''), name: h.name, region: h.region || 'US' }));
      setAccHubs(hubs);
      const emeaHub = hubs.find((h: any) => h.region === 'EMEA') || (hubs.length === 1 ? hubs[0] : null);
      if (emeaHub) handleHubSelect(emeaHub.id, emeaHub.region);
    }
  };

  const handleHubSelect = async (accountId: string, region: string) => {
    setSetupForm(f => ({ ...f, accountId, archiveRegion: region, projectId: '', archiveFolderId: '', renovationFolderId: '' }));
    setFolderTree({});
    setLoadingProjects(true);
    const { data } = await supabase.functions.invoke('acc-sync', { body: { action: 'list-projects', accountId, region } });
    setLoadingProjects(false);
    if (data?.projects) setAccProjects(data.projects.map((p: any) => ({ id: p.id?.replace(/^b\./, ''), name: p.name })));
  };

  const handleProjectSelect = async (projectId: string) => {
    const currentAccountId = setupForm.accountId;
    const currentRegion = setupForm.archiveRegion;
    setSetupForm(f => ({ ...f, projectId, archiveFolderId: '', archiveFolderName: '', renovationFolderId: '', renovationFolderName: '' }));
    setFolderTree({});
    setLoadingFolders(true);
    const { data, error } = await supabase.functions.invoke('acc-sync', {
      body: { action: 'list-folders', projectId, region: currentRegion, accountId: currentAccountId },
    });
    setLoadingFolders(false);
    if (error || !data?.success) {
      let msg = data?.error || error?.message || 'Failed to load folders';
      if (error && (error as any).context) { try { const b = await (error as any).context.json(); msg = b?.error || msg; } catch {} }
      toast({ title: 'Could not load folders', description: msg, variant: 'destructive' });
    } else if (data?.folders) {
      setFolderTree(data.folders);
    }
  };

  const handleLinkAccProject = async () => {
    if (!setupOpen || !setupForm.accountId || !setupForm.projectId || !setupForm.archiveFolderId || !setupForm.renovationFolderId) {
      toast({ title: 'Select account, project, archive folder and renovation folder', variant: 'destructive' }); return;
    }
    setCreatingAccProject(true);
    const { error } = await supabase.from('renovation_projects').update({
      acc_renovation_project_id: setupForm.projectId,
      acc_account_id: setupForm.accountId,
      archive_folder_id: setupForm.archiveFolderId,
      archive_folder_name: setupForm.archiveFolderName,
      renovation_folder_id: setupForm.renovationFolderId,
      renovation_folder_name: setupForm.renovationFolderName,
      acc_setup_status: 'ready',
      acc_setup_error: null,
    }).eq('id', setupOpen);
    setCreatingAccProject(false);
    if (error) { toast({ title: 'Failed to link project', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Linked to Autodesk Forma', description: 'Renovation project is now connected to the Autodesk Forma project.' });
    setSetupOpen(null);
    loadProjects();
  };

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); toast({ title: 'Copied' }); };

  const accPortalUrl = (project: RenovationProject) =>
    project.acc_renovation_project_id
      ? `https://acc.autodesk.com/projects/${project.acc_renovation_project_id}`
      : null;

  return (
    <div className="flex flex-col min-h-full bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardHat className="h-5 w-5 text-orange-400" />
          <h1 className="text-lg font-semibold">BLM ↔ Forma</h1>
          <span className="text-sm text-muted-foreground">Renovation project handover</span>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> New Project
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground gap-3">
            <HardHat className="h-10 w-10 opacity-30" />
            <p className="font-medium">No active renovation projects</p>
            <p className="text-sm max-w-xs">Create a project to track a renovation and manage its ACC handover.</p>
            <Button variant="outline" size="sm" className="mt-2 gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New Project
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 max-w-4xl">
            {projects.map(project => {
              const cfg = STATUS_CONFIG[project.status];
              const StatusIcon = cfg.icon;
              const setupCfg = SETUP_STATUS_CONFIG[project.acc_setup_status || 'pending'];
              const levelNames = getLevelNames(project);
              const worksetGuide = getWorksetGuide(project);
              const accUrl = accPortalUrl(project);

              return (
                <Card key={project.id} className="border-border">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-base font-medium truncate">{project.name}</CardTitle>
                        <p className="text-sm text-muted-foreground mt-0.5">{getBuildingName(project.building_fm_guid)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={`gap-1.5 text-xs ${cfg.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {cfg.label}
                        </Badge>
                        {deleteConfirm === project.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-red-400">Delete?</span>
                            <Button variant="destructive" size="sm" className="h-6 px-2 text-xs" onClick={() => handleDeleteProject(project.id)}>Yes</Button>
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setDeleteConfirm(null)}>No</Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-400" onClick={() => setDeleteConfirm(project.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-4">
                    {/* Meta */}
                    <div className="space-y-1.5 text-sm text-muted-foreground">
                      {levelNames && <p><span className="text-foreground/70">Floors:</span> {levelNames}</p>}
                      {project.affected_room_fm_guids?.length > 0 && (() => {
                        const rooms = roomsByBuilding[project.building_fm_guid];
                        const names = project.affected_room_fm_guids.map(g => { const r = rooms?.find(rm => rm.fm_guid === g); return r?.common_name || r?.name || g; }).join(', ');
                        return <p><span className="text-foreground/70">Rooms:</span> {names}</p>;
                      })()}
                      {project.scope_zone_description && <p><span className="text-foreground/70">Zone:</span> {project.scope_zone_description}</p>}
                      {project.affected_system_types?.length > 0 && (
                        <p><span className="text-foreground/70">Systems:</span> {project.affected_system_types.join(', ')}</p>
                      )}
                      {project.notes && <p className="text-xs">{project.notes}</p>}
                    </div>

                    {/* ACC Setup status */}
                    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-medium flex items-center gap-1.5 ${setupCfg.color}`}>
                          {project.acc_setup_status === 'creating' && <RefreshCw className="h-3 w-3 animate-spin" />}
                          {project.acc_setup_status === 'error' && <AlertCircle className="h-3 w-3" />}
                          {project.acc_setup_status === 'ready' && <CheckCircle className="h-3 w-3" />}
                          {setupCfg.label}
                        </span>
                        {(project.acc_setup_status === 'pending' || project.acc_setup_status === 'error') && (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => openSetupModal(project.id)}>
                            <FolderOpen className="h-3 w-3" />
                            {project.acc_setup_status === 'error' ? 'Retry Setup' : 'Set up in ACC'}
                          </Button>
                        )}
                        {project.acc_setup_status === 'ready' && accUrl && (
                          <a href={accUrl} target="_blank" rel="noopener noreferrer">
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                              <ExternalLink className="h-3 w-3" /> Open in Autodesk Forma
                            </Button>
                          </a>
                        )}
                      </div>

                      {project.acc_setup_error && (
                        <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{project.acc_setup_error}</p>
                      )}

                      {/* Workset guide — shown when ready */}
                      {project.acc_setup_status === 'ready' && worksetGuide.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-muted-foreground font-medium">Revit Workset Setup Guide</p>
                          <p className="text-xs text-muted-foreground">Run "Checkout Setup" in the BLM Forma Revit Add-in, or set up manually:</p>
                          <div className="space-y-1">
                            {worksetGuide.map(ws => (
                              <div key={ws.fmGuid} className="flex items-center justify-between gap-2 text-xs bg-background rounded px-2 py-1">
                                <span>
                                  <span className="font-mono text-foreground">{ws.name}</span>
                                  <span className="text-muted-foreground ml-2">→ fm_guid: {ws.fmGuid}</span>
                                </span>
                                <button onClick={() => copyToClipboard(ws.name)} className="text-muted-foreground hover:text-foreground">
                                  <Copy className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {project.status === 'planning' && (
                        <Button variant="outline" size="sm" onClick={() => handleStatusChange(project, 'active')}>
                          Mark Active
                        </Button>
                      )}
                      {(project.status === 'planning' || project.status === 'active') && (
                        <Button
                          size="sm"
                          className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                          disabled={syncing === project.id}
                          onClick={() => handleCompleteAndSync(project)}
                        >
                          {syncing === project.id
                            ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Syncing…</>
                            : project.acc_setup_status === 'ready'
                              ? <><CheckCircle className="h-3.5 w-3.5" /> Sync to Archive &amp; Complete</>
                              : <><CheckCircle className="h-3.5 w-3.5" /> Complete &amp; Sync</>
                          }
                        </Button>
                      )}
                      {project.status === 'completed' && (
                        <Button variant="ghost" size="sm" className="text-muted-foreground gap-1.5" onClick={() => handleStatusChange(project, 'archived')}>
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md bg-background text-foreground">
          <DialogHeader><DialogTitle className="text-foreground">New Renovation Project</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Project name *</Label>
              <Input placeholder="e.g. Floor 2-3 renovation" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Building *</Label>
              <Select value={form.building_fm_guid} onValueChange={guid => { setForm(f => ({ ...f, building_fm_guid: guid, affected_level_fm_guids: [] })); loadLevels(guid); }}>
                <SelectTrigger><SelectValue placeholder="Select building" /></SelectTrigger>
                <SelectContent>
                  {buildings.map(b => <SelectItem key={b.fm_guid} value={b.fm_guid}>{b.common_name || b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.building_fm_guid && (
              <div className="space-y-1.5">
                <Label>Affected floors</Label>
                <div className="border border-border rounded-md p-3 max-h-40 overflow-y-auto space-y-2">
                  {!(levelsByBuilding[form.building_fm_guid]?.length) ? (
                    <p className="text-xs text-muted-foreground">Loading floors…</p>
                  ) : (levelsByBuilding[form.building_fm_guid] || []).map(level => (
                    <div key={level.fm_guid} className="flex items-center gap-2">
                      <Checkbox id={level.fm_guid}
                        checked={form.affected_level_fm_guids.includes(level.fm_guid)}
                        onCheckedChange={() => setForm(f => ({
                          ...f,
                          affected_level_fm_guids: f.affected_level_fm_guids.includes(level.fm_guid)
                            ? f.affected_level_fm_guids.filter(g => g !== level.fm_guid)
                            : [...f.affected_level_fm_guids, level.fm_guid],
                        }))} />
                      <label htmlFor={level.fm_guid} className="text-sm cursor-pointer">{levelDisplayName(level)}</label>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Rooms — shown after floors are selected */}
            {form.building_fm_guid && form.affected_level_fm_guids.length > 0 && (() => {
              const allRooms = roomsByBuilding[form.building_fm_guid];
              if (!allRooms) { loadRooms(form.building_fm_guid); }
              return (
                <div className="space-y-1.5">
                  <Label>Affected rooms <span className="text-muted-foreground font-normal">(optional — select specific spaces)</span></Label>
                  <div className="border border-border rounded-md p-3 max-h-40 overflow-y-auto space-y-2">
                    {!allRooms ? (
                      <p className="text-xs text-muted-foreground">Loading rooms…</p>
                    ) : allRooms.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No spaces found for this building.</p>
                    ) : allRooms.map(room => (
                      <div key={room.fm_guid} className="flex items-center gap-2">
                        <Checkbox id={`room-${room.fm_guid}`}
                          checked={form.affected_room_fm_guids.includes(room.fm_guid)}
                          onCheckedChange={() => setForm(f => ({
                            ...f,
                            affected_room_fm_guids: f.affected_room_fm_guids.includes(room.fm_guid)
                              ? f.affected_room_fm_guids.filter(g => g !== room.fm_guid)
                              : [...f.affected_room_fm_guids, room.fm_guid],
                          }))} />
                        <label htmlFor={`room-${room.fm_guid}`} className="text-sm cursor-pointer">
                          {room.common_name || room.name}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Zone description */}
            {form.building_fm_guid && (
              <div className="space-y-1.5">
                <Label>Zone description <span className="text-muted-foreground font-normal">(optional — e.g. "Northern wing, rooms 301–315")</span></Label>
                <Input placeholder="Describe the affected zone…" value={form.scope_zone_description}
                  onChange={e => setForm(f => ({ ...f, scope_zone_description: e.target.value }))} />
              </div>
            )}

            {/* Installation systems */}
            <div className="space-y-1.5">
              <Label>Affected installation systems <span className="text-muted-foreground font-normal">(optional — systems spanning beyond primary floors)</span></Label>
              <div className="border border-border rounded-md p-3 space-y-2">
                {SYSTEM_TYPES.map(sys => (
                  <div key={sys.id} className="flex items-start gap-2">
                    <Checkbox id={`sys-${sys.id}`}
                      checked={form.affected_system_types.includes(sys.id)}
                      onCheckedChange={() => setForm(f => ({
                        ...f,
                        affected_system_types: f.affected_system_types.includes(sys.id)
                          ? f.affected_system_types.filter(s => s !== sys.id)
                          : [...f.affected_system_types, sys.id],
                      }))} />
                    <div>
                      <label htmlFor={`sys-${sys.id}`} className="text-sm cursor-pointer font-medium">{sys.label}</label>
                      <p className="text-xs text-muted-foreground">{sys.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Start date <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input type="date" value={form.started_at} onChange={e => setForm(f => ({ ...f, started_at: e.target.value }))} className="[color-scheme:dark]" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea placeholder="Scope, contacts, constraints…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving} className="gap-2">
              {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />} Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ACC Setup modal */}
      <Dialog open={!!setupOpen} onOpenChange={open => { if (!open) setSetupOpen(null); }}>
        <DialogContent className="max-w-lg bg-background text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-orange-400" /> Set Up in Autodesk Forma
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Select the ACC project and tag two folders — one as <strong className="text-foreground">Archive</strong> (where the master models live) and one as <strong className="text-foreground">Renovation</strong> (where the consultant works). Geminus records this so the Revit add-in can set up workset locking automatically.</p>

            {/* Hub */}
            <div className="space-y-1.5">
              <Label>Account (Hub)</Label>
              {loadingHubs ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading…</div> : (
                <Select value={setupForm.accountId} onValueChange={id => { const hub = accHubs.find(h => h.id === id); handleHubSelect(id, hub?.region || 'US'); }}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>{accHubs.map(h => <SelectItem key={h.id} value={h.id}>{h.name} ({h.region})</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>

            {/* Project */}
            {setupForm.accountId && (
              <div className="space-y-1.5">
                <Label>Project</Label>
                {loadingProjects ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading…</div> : (
                  <Select value={setupForm.projectId} onValueChange={handleProjectSelect}>
                    <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                    <SelectContent>{accProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* Folder pickers */}
            {setupForm.projectId && (() => {
              if (loadingFolders) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" /> Loading folders…</div>;
              const rootIds = Object.entries(folderTree).filter(([, v]) => v.parentId === null).map(([id]) => id);
              const renderFolderOption = (folderId: string, depth = 0): React.ReactNode => {
                const f = folderTree[folderId];
                if (!f) return null;
                const children = Object.entries(folderTree).filter(([, v]) => v.parentId === folderId).map(([id]) => id);
                return (
                  <div key={folderId}>
                    <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 12}px` }}>
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-yellow-500" />
                      <span className="text-sm flex-1 truncate">{f.name}</span>
                      <Button variant={setupForm.archiveFolderId === folderId ? 'default' : 'ghost'} size="sm" className="h-5 px-1.5 text-xs"
                        onClick={() => setSetupForm(s => ({ ...s, archiveFolderId: folderId, archiveFolderName: f.name }))}>Archive</Button>
                      <Button variant={setupForm.renovationFolderId === folderId ? 'default' : 'ghost'} size="sm" className="h-5 px-1.5 text-xs"
                        onClick={() => setSetupForm(s => ({ ...s, renovationFolderId: folderId, renovationFolderName: f.name }))}>Renovation</Button>
                    </div>
                    {children.map(id => renderFolderOption(id, depth + 1))}
                  </div>
                );
              };
              return (
                <div className="space-y-1.5">
                  <div className="flex gap-4 text-xs text-muted-foreground mb-1">
                    <span>Archive: <strong className="text-foreground">{setupForm.archiveFolderName || 'not set'}</strong></span>
                    <span>Renovation: <strong className="text-foreground">{setupForm.renovationFolderName || 'not set'}</strong></span>
                  </div>
                  <div className="border rounded-md max-h-56 overflow-y-auto p-2 space-y-0.5">
                    {rootIds.length === 0
                      ? <p className="text-xs text-muted-foreground py-2 text-center">No folders found in this project.</p>
                      : rootIds.map(id => renderFolderOption(id))}
                  </div>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetupOpen(null)}>Cancel</Button>
            <Button
              onClick={handleLinkAccProject}
              disabled={!setupForm.archiveFolderId || !setupForm.renovationFolderId || creatingAccProject}
              className="gap-2"
            >
              {creatingAccProject
                ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Linking…</>
                : <><ExternalLink className="h-3.5 w-3.5" /> Link to Autodesk Forma</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
