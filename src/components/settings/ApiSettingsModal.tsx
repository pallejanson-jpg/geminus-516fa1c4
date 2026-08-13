import React, { useState, useEffect, useContext } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { 
    Box, Database, RefreshCw, CheckCircle2, AlertCircle,
    Loader2, Server, Clock, Eye, EyeOff, Zap, Settings2, Save, Edit2,
    LayoutGrid, ExternalLink, Building2, Archive, Radar, BarChart2, Circle, Layers, Wrench, Mic, Palette, View, User, Sparkles, FileText, FolderOpen, ChevronRight, ChevronDown as ChevronDownIcon, File, Database as DatabaseIcon, Cuboid, Bot, Network, RotateCcw, Copy, Users
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppContext } from '@/context/AppContext';
import { useLanguage } from '@/context/LanguageContext';
import { DEFAULT_APP_CONFIGS, GEMINUS_PREMIUM_POLL_OPTIONS } from '@/lib/constants';
import SymbolSettings from './SymbolSettings';
import VoiceSettings from './VoiceSettings';
import ViewerThemeSettings from './ViewerThemeSettings';
import RoomLabelSettings from './RoomLabelSettings';
import ProfileSettings from './ProfileSettings';
import IvionConnectionModal from './IvionConnectionModal';
import GunnarSettings from './GunnarSettings';
import IleanSettings from './IleanSettings';
import { getFastNavEnabled, setFastNavEnabled } from './VoiceSettings';
import KnowledgeBaseSettings from './KnowledgeBaseSettings';
import { SyncProgressCard } from './SyncProgressCard';
import ConversionProgressOverlay from './ConversionProgressOverlay';
import { SyncStatusLog, type SyncStep, type SyncOutcome } from './SyncStatusLog';
import CreateBuildingPanel from './CreateBuildingPanel';
import ApiProfilesManager from './ApiProfilesManager';
import TenantsManager from './TenantsManager';
import type { TranslationStatus } from '@/services/acc-xkt-converter';

interface ApiSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface SyncStatus {
    subtree_id: string;
    subtree_name: string | null;
    sync_status: string;
    total_assets: number;
    last_sync_started_at: string | null;
    last_sync_completed_at: string | null;
    error_message: string | null;
}

interface SyncCategoryState {
    localCount: number;
    remoteCount: number;
    accLocalCount?: number;
    inSync: boolean;
    syncState?: SyncStatus;
}

interface NewSyncCheckResult {
    success: boolean;
    structure: SyncCategoryState;
    assets: SyncCategoryState;
    xkt: { 
        localCount: number;
        buildingCount: number;
        syncState?: SyncStatus;
    };
    total: { localCount: number; remoteCount: number; totalWithAcc?: number; accExcluded?: number };
}

interface ConfigState {
    keycloakUrl: string;
    apiUrl: string;
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    apiKey: string;
    audience: string;
}
// Helper to get icon for app
const getAppIcon = (key: string) => {
    switch (key) {
        case 'insights': return BarChart2;
        case 'fma_plus': return Building2;
        case 'geminus_plus': return Box;
        case 'iot': return Zap;
        case 'original_archive': return Archive;
        case 'radar': return Radar;
        default: return Box;
    }
};
// Recursive folder tree node for ACC folder browser
const AccFolderNode: React.FC<{
    folder: any;
    depth: number;
    expandedFolders: Set<string>;
    toggleFolder: (id: string) => void;
    syncingBimFolderId: string | null;
    bimSyncProgress: string | null;
    handleSyncBimData: (folder: any, selectedFiles?: any[]) => void;
    formatFileSize: (bytes: number | null) => string;
    selectedBimFiles: Set<string>;
    toggleBimFile: (itemId: string) => void;
    translationStatuses: Record<string, TranslationStatus>;
    onTranslate3D: (item: any, folder: any) => void;
    masterModelUrn: string;
    setMasterModelUrn: (urn: string) => void;
}> = ({ folder, depth, expandedFolders, toggleFolder, syncingBimFolderId, bimSyncProgress, handleSyncBimData, formatFileSize, selectedBimFiles, toggleBimFile, translationStatuses, onTranslate3D, masterModelUrn, setMasterModelUrn }) => {
    const { t } = useLanguage();
    const hasChildren = (folder.children || []).length > 0;
    const isSyncingThisFolder = syncingBimFolderId === folder.id;
    const isExpanded = expandedFolders.has(folder.id);
    const totalCount = folder.totalItemCount ?? folder.items?.length ?? 0;

    // Collect all BIM items recursively for sync
    const collectAllBimItems = (f: any): any[] => {
        const items = (f.items || []).filter((i: any) => i.versionUrn || i.isBim);
        for (const child of (f.children || [])) {
            items.push(...collectAllBimItems(child));
        }
        return items;
    };

    const allBimItems = collectAllBimItems(folder);
    const hasAnyBimFiles = allBimItems.length > 0;
    
    // Count selected files in this folder
    const selectedInFolder = allBimItems.filter((i: any) => selectedBimFiles.has(i.id));
    const selectedCount = selectedInFolder.length;

    return (
        <div className="rounded border bg-background" style={{ marginLeft: depth > 0 ? `${Math.min(depth * 12, 36)}px` : undefined }}>
            <div className="flex flex-col sm:flex-row sm:items-center">
                <button
                    onClick={() => toggleFolder(folder.id)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1.5 text-left hover:bg-muted/50 rounded-l text-xs sm:text-sm"
                >
                    {(hasChildren || (folder.items || []).length > 0) ? (
                        isExpanded ? (
                            <ChevronDownIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                        ) : (
                            <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        )
                    ) : (
                        <span className="w-3 shrink-0" />
                    )}
                    <FolderOpen className="h-3 w-3 text-amber-500 shrink-0" />
                    <span className="font-medium truncate">{folder.name}</span>
                    <Badge variant="outline" className="ml-auto text-[9px] shrink-0">
                        {totalCount} {totalCount === 1 ? t('fil', 'file') : t('filer', 'files')}
                    </Badge>
                </button>
                {hasAnyBimFiles && (
                    <Button
                        onClick={(e) => {
                            e.stopPropagation();
                            const filesToSync = selectedCount > 0 ? selectedInFolder : allBimItems;
                            handleSyncBimData({ ...folder, items: filesToSync }, filesToSync);
                        }}
                        disabled={!!syncingBimFolderId}
                        size="sm"
                        variant="ghost"
                        className="gap-1 h-7 text-[10px] sm:text-xs shrink-0 mx-1 self-start sm:self-auto"
                    >
                        {isSyncingThisFolder ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                            <DatabaseIcon className="h-3 w-3" />
                        )}
                        {isSyncingThisFolder
                            ? (bimSyncProgress || 'Syncing...')
                            : selectedCount > 0
                                ? `Sync ${selectedCount}`
                                : 'Sync BIM'}
                    </Button>
                )}
            </div>

            {isExpanded && (
                <div className="pb-2">
                    {/* Files in this folder */}
                    {folder.items && folder.items.length > 0 && (
                        <div className="px-1 sm:px-2.5 pl-4 sm:pl-8 space-y-0.5">
                            {folder.items.map((item: any) => {
                                const isBim = item.versionUrn || item.isBim;
                                const isSelected = selectedBimFiles.has(item.id);
                                return (
                                    <div key={item.id} className="flex flex-wrap items-center gap-1 sm:gap-2 text-[10px] sm:text-xs py-1 px-1 sm:px-1.5 rounded hover:bg-muted/50">
                                        {isBim && (
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleBimFile(item.id)}
                                                className="h-3 w-3 sm:h-3.5 sm:w-3.5 rounded border-primary accent-primary shrink-0"
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        )}
                                        <File className="h-3 w-3 text-muted-foreground shrink-0" />
                                        <span className="truncate max-w-[120px] sm:max-w-none">{item.name}</span>
                                        {isBim && (
                                            <Badge variant="secondary" className="text-[8px] sm:text-[9px] shrink-0 px-1 py-0">BIM</Badge>
                                        )}
                                        {isBim && item.versionUrn && (
                                            <label className="flex items-center gap-0.5 cursor-pointer shrink-0" title="A-modell (master) — skapar våningsplan och rum">
                                                <input
                                                    type="radio"
                                                    name="masterModel"
                                                    checked={masterModelUrn === item.versionUrn}
                                                    onChange={() => setMasterModelUrn(item.versionUrn)}
                                                    className="h-2.5 w-2.5 accent-primary"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                <span className="text-[8px] sm:text-[9px] text-muted-foreground">A</span>
                                            </label>
                                        )}
                                        {isBim && item.versionUrn && (() => {
                                            const ts = translationStatuses[item.versionUrn];
                                            if (ts?.status === 'complete' || ts?.status === 'success') {
                                                return <Badge className="text-[8px] sm:text-[9px] shrink-0 px-1 py-0 bg-green-600">3D ✓</Badge>;
                                            }
                                            if (ts && ts.status !== 'idle' && ts.status !== 'failed') {
                                                return (
                                                    <Badge variant="outline" className="text-[8px] sm:text-[9px] shrink-0 px-1 py-0 gap-0.5">
                                                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                                        {ts.status === 'server-converting' ? 'Server...' : (ts.progress || ts.status)}
                                                    </Badge>
                                                );
                                            }
                                            return (
                                                <Button
                                                    onClick={(e) => { e.stopPropagation(); onTranslate3D(item, folder); }}
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-5 px-1 text-[8px] sm:text-[9px] gap-0.5"
                                                    disabled={ts?.status === 'pending' || ts?.status === 'inprogress'}
                                                >
                                                    <Cuboid className="h-2.5 w-2.5" />
                                                    {ts?.status === 'failed' ? t('Igen', 'Retry') : '3D'}
                                                </Button>
                                            );
                                        })()}
                                        <span className="ml-auto text-muted-foreground shrink-0 uppercase text-[9px] sm:text-[10px]">{item.type}</span>
                                        {item.size && <span className="text-muted-foreground shrink-0 text-[9px] sm:text-[10px]">{formatFileSize(item.size)}</span>}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Sub-folders (recursive) */}
                    {hasChildren && (
                        <div className="px-2.5 space-y-1 mt-1">
                            {folder.children.map((child: any) => (
                                <AccFolderNode
                                    key={child.id}
                                    folder={child}
                                    depth={depth + 1}
                                    expandedFolders={expandedFolders}
                                    toggleFolder={toggleFolder}
                                    syncingBimFolderId={syncingBimFolderId}
                                    bimSyncProgress={bimSyncProgress}
                                    handleSyncBimData={handleSyncBimData}
                                    formatFileSize={formatFileSize}
                                    selectedBimFiles={selectedBimFiles}
                                    toggleBimFile={toggleBimFile}
                                    translationStatuses={translationStatuses}
                                    onTranslate3D={onTranslate3D}
                                    masterModelUrn={masterModelUrn}
                                    setMasterModelUrn={setMasterModelUrn}
                                />
                            ))}
                        </div>
                    )}

                    {/* Empty folder message */}
                    {(!folder.items || folder.items.length === 0) && !hasChildren && (
                        <p className="px-2.5 pl-8 text-xs text-muted-foreground italic">No files in this folder.</p>
                    )}

                    {folder.truncated && (
                        <p className="px-2.5 pl-8 text-xs text-muted-foreground italic">Subfolders not loaded (max depth reached).</p>
                    )}
                </div>
            )}
        </div>
    );
};
// Geminus Base Document/Drawing sync sub-panel
const GeminusBaseDocSyncPanel: React.FC = () => {
    const { toast } = useToast();
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncAction, setSyncAction] = useState<string | null>(null);
    const [status, setStatus] = useState<{
        counts: { drawings: number; documents: number; dou: number };
        syncStates: any[];
    } | null>(null);

    const fetchStatus = async () => {
        try {
            const { data, error } = await supabase.functions.invoke('geminus-base-sync', {
                body: { action: 'get-status' },
            });
            if (!error && data?.success) setStatus(data);
        } catch {}
    };

    useEffect(() => { fetchStatus(); }, []);

    const handleSync = async (action: string) => {
        setIsSyncing(true);
        setSyncAction(action);
        try {
            const { data, error } = await supabase.functions.invoke('geminus-base-sync', {
                body: { action },
            });
            if (error) throw error;
            toast({
                title: 'Geminus Base sync complete',
                description: action === 'sync-all'
                    ? `Drawings: ${data?.results?.['sync-drawings']?.synced || 0}, Documents: ${data?.results?.['sync-documents']?.synced || 0}, DoU: ${data?.results?.['sync-dou']?.synced || 0}`
                    : `${data?.synced || 0} items synced.`,
            });
            fetchStatus();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Sync error', description: err.message });
        } finally {
            setIsSyncing(false);
            setSyncAction(null);
        }
    };

    const lastSync = status?.syncStates?.find(s => s.last_sync_completed_at)?.last_sync_completed_at;

    return (
        <div className="space-y-3">
            {status && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded border p-2 text-center">
                        <div className="font-medium text-lg">{status.counts.drawings}</div>
                        <div className="text-muted-foreground">Drawings</div>
                    </div>
                    <div className="rounded border p-2 text-center">
                        <div className="font-medium text-lg">{status.counts.documents}</div>
                        <div className="text-muted-foreground">Documents</div>
                    </div>
                    <div className="rounded border p-2 text-center">
                        <div className="font-medium text-lg">{status.counts.dou}</div>
                        <div className="text-muted-foreground">DoU</div>
                    </div>
                </div>
            )}
            {lastSync && (
                <p className="text-xs text-muted-foreground">
                    Last sync: {new Date(lastSync).toLocaleString('en-US')}
                </p>
            )}
            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1 h-7 text-[10px]" disabled={isSyncing} onClick={() => handleSync('sync-drawings')}>
                    {isSyncing && syncAction === 'sync-drawings' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                    Drawings
                </Button>
                <Button size="sm" variant="outline" className="gap-1 h-7 text-[10px]" disabled={isSyncing} onClick={() => handleSync('sync-documents')}>
                    {isSyncing && syncAction === 'sync-documents' ? <Loader2 className="h-3 w-3 animate-spin" /> : <File className="h-3 w-3" />}
                    Documents
                </Button>
                <Button size="sm" variant="outline" className="gap-1 h-7 text-[10px]" disabled={isSyncing} onClick={() => handleSync('sync-dou')}>
                    {isSyncing && syncAction === 'sync-dou' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                    DoU
                </Button>
                <Button size="sm" className="gap-1 h-7 text-[10px]" disabled={isSyncing} onClick={() => handleSync('sync-all')}>
                    {isSyncing && syncAction === 'sync-all' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Sync All
                </Button>
            </div>
        </div>
    );
};

// IMDF Export sub-panel
const ImdfExportPanel: React.FC<{ allBuildings: any[] }> = ({ allBuildings }) => {
    const { toast } = useToast();
    const [selectedBuilding, setSelectedBuilding] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [exportResult, setExportResult] = useState<string | null>(null);

    const handleExport = async () => {
        if (!selectedBuilding) return;
        setIsExporting(true);
        setExportResult(null);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const res = await fetch(
                `${SUPABASE_URL}/functions/v1/imdf-export`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${session?.access_token}`,
                        'apikey': SUPABASE_PUBLISHABLE_KEY,
                    },
                    body: JSON.stringify({ buildingFmGuid: selectedBuilding }),
                }
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(err.error || res.statusText);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `imdf-${selectedBuilding}.zip`;
            a.click();
            URL.revokeObjectURL(url);
            const buildingName = allBuildings.find(b => b.fm_guid === selectedBuilding)?.common_name || selectedBuilding;
            setExportResult(`Export complete — ${buildingName}`);
            toast({ title: 'IMDF Export complete', description: `ZIP file downloaded for ${buildingName}` });
        } catch (err: any) {
            setExportResult(`Error: ${err.message}`);
            toast({ title: 'IMDF Export failed', description: err.message, variant: 'destructive' });
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
                Export building data as IMDF (Indoor Mapping Data Format) for indoor mapping systems like Apple Maps Indoor.
            </p>
            <div className="space-y-2">
                <Label className="text-xs">Building</Label>
                <select
                    value={selectedBuilding}
                    onChange={(e) => setSelectedBuilding(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                    <option value="">Select building...</option>
                    {allBuildings.map((b) => (
                        <option key={b.fm_guid} value={b.fm_guid}>
                            {b.common_name || b.name || b.fm_guid}
                        </option>
                    ))}
                </select>
            </div>
            <div className="flex items-center gap-2">
                <Button
                    onClick={handleExport}
                    disabled={!selectedBuilding || isExporting}
                    size="sm"
                    className="gap-1"
                >
                    {isExporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
                    Export IMDF
                </Button>
                {exportResult && (
                    <span className={`text-xs ${exportResult.startsWith('Error') ? 'text-destructive' : 'text-green-600'}`}>
                        {exportResult}
                    </span>
                )}
            </div>
        </div>
    );
};

const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ isOpen, onClose }) => {

    const { toast } = useToast();
    const { t } = useLanguage();
    const { appConfigs, setAppConfigs, viewer3dFmGuid, selectedFacility } = useContext(AppContext);
    const [activeTab, setActiveTab] = useState('apps');
    // Separate syncing states for each sync type
    const [isSyncingStructure, setIsSyncingStructure] = useState(false);
    const [isSyncingAssets, setIsSyncingAssets] = useState(false);
    const [isSyncingXkt, setIsSyncingXkt] = useState(false);
    const [selectedSingleBuilding, setSelectedSingleBuilding] = useState<string>('');
    const [isSyncingSingleBuilding, setIsSyncingSingleBuilding] = useState(false);
    const [singleBuildingSyncResult, setSingleBuildingSyncResult] = useState<{ success: boolean; message: string } | null>(null);
    const [forceXkt, setForceXkt] = useState(false);
    const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([]);
    const [assetCount, setAssetCount] = useState<number>(0);
    const [syncCheck, setSyncCheck] = useState<NewSyncCheckResult | null>(null);
    const [isCheckingSync, setIsCheckingSync] = useState(false);
    const [hasCheckedSync, setHasCheckedSync] = useState(false);

    // Faciliate cache stats
    const [facilitateCacheStats, setFacilitateCacheStats] = useState<{
        total: number;
        byType: Record<string, number>;
        byBuilding: Array<{ building_name: string | null; building_id: string | null; count: number }>;
        lastSynced: string | null;
    } | null>(null);
    const [isLoadingFacilitateStats, setIsLoadingFacilitateStats] = useState(false);

    // Faciliate connector server
    const CONNECTOR_URL = `http://localhost:${typeof window !== 'undefined' ? (localStorage.getItem('facilitateConnectorPort') || '3001') : '3001'}`;
    const [connectorStatus, setConnectorStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
    const [facilitateBuildings, setFacilitateBuildings] = useState<Array<{ id: string; name: string; cadKey: string | null }>>([]);
    const [selectedFacBuildingId, setSelectedFacBuildingId] = useState('');
    const [selectedFacBuildingName, setSelectedFacBuildingName] = useState('');
    const [facilitateSyncTypes, setFacilitateSyncTypes] = useState(['workorder', 'rentlandlord', 'maintenance']);
    const [facilitateSyncLog, setFacilitateSyncLog] = useState<string[]>([]);
    const [isFacilitiateSyncing, setIsFacilitateSyncing] = useState(false);

    const checkConnectorStatus = async () => {
        try {
            const r = await fetch(`${CONNECTOR_URL}/status`, { signal: AbortSignal.timeout(3000) });
            setConnectorStatus(r.ok ? 'online' : 'offline');
        } catch {
            setConnectorStatus('offline');
        }
    };

    const fetchFacilitateBuildings = async () => {
        try {
            const r = await fetch(`${CONNECTOR_URL}/buildings`, { signal: AbortSignal.timeout(10000) });
            const data = await r.json();
            setFacilitateBuildings(data.buildings || []);
        } catch (e: any) {
            toast({ variant: 'destructive', title: t('Kunde inte hämta byggnader', 'Could not fetch buildings'), description: e.message });
        }
    };

    const startFacilitateSync = async () => {
        if (!selectedFacBuildingId || !selectedFacBuildingName) {
            toast({ variant: 'destructive', title: t('Välj en byggnad', 'Select a building') }); return;
        }
        setIsFacilitateSyncing(true);
        setFacilitateSyncLog([`Startar synk av ${selectedFacBuildingName}…`]);
        try {
            const res = await fetch(`${CONNECTOR_URL}/sync-building`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buildingId: selectedFacBuildingId, buildingName: selectedFacBuildingName, types: facilitateSyncTypes }),
            });
            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const parts = buf.split('\n\n');
                buf = parts.pop() ?? '';
                for (const part of parts) {
                    const line = part.replace(/^data: /, '').trim();
                    if (!line) continue;
                    try {
                        const ev = JSON.parse(line);
                        setFacilitateSyncLog(prev => [...prev, ev.message || '']);
                        if (ev.type === 'done') { loadFacilitateStats(); }
                    } catch {}
                }
            }
        } catch (e: any) {
            setFacilitateSyncLog(prev => [...prev, `❌ ${e.message}`]);
        } finally {
            setIsFacilitateSyncing(false);
        }
    };

    const loadFacilitateStats = async () => {
        setIsLoadingFacilitateStats(true);
        try {
            const [countRes, typeRes, buildingRes, latestRes] = await Promise.all([
                supabase.from('faciliate_records').select('id', { count: 'exact', head: true }),
                supabase.from('faciliate_records').select('object_type').then(({ data }) => {
                    const map: Record<string, number> = {};
                    for (const r of data || []) map[r.object_type] = (map[r.object_type] || 0) + 1;
                    return map;
                }),
                supabase.from('faciliate_records').select('building_name, building_id').then(({ data }) => {
                    const map = new Map<string, { building_name: string | null; building_id: string | null; count: number }>();
                    for (const r of data || []) {
                        const key = r.building_name || r.building_id || '__okänd__';
                        if (!map.has(key)) map.set(key, { building_name: r.building_name, building_id: r.building_id, count: 0 });
                        map.get(key)!.count++;
                    }
                    return [...map.values()].sort((a, b) => b.count - a.count);
                }),
                supabase.from('faciliate_records').select('synced_at').order('synced_at', { ascending: false }).limit(1)
                    .then(({ data }) => data?.[0]?.synced_at || null),
            ]);
            setFacilitateCacheStats({ total: countRes.count ?? 0, byType: typeRes as Record<string, number>, byBuilding: buildingRes as any, lastSynced: latestRes as string | null });
        } finally {
            setIsLoadingFacilitateStats(false);
        }
    };

    // Sync log state for SyncStatusLog
    const [structureSyncLog, setStructureSyncLog] = useState<SyncStep[]>([]);
    const [structureSyncOutcome, setStructureSyncOutcome] = useState<SyncOutcome | null>(null);
    const [assetSyncLog, setAssetSyncLog] = useState<SyncStep[]>([]);
    const [assetSyncOutcome, setAssetSyncOutcome] = useState<SyncOutcome | null>(null);

    // Progress tracking from asset_sync_progress
    const [syncProgress, setSyncProgress] = useState<{
        totalSynced: number | null;
        totalBuildings: number | null;
        currentBuildingIndex: number | null;
        lastError: string | null;
    } | null>(null);
    
    // Config form state
    const [config, setConfig] = useState<ConfigState>({
        keycloakUrl: '',
        apiUrl: '',
        clientId: '',
        clientSecret: '',
        username: '',
        password: '',
        apiKey: '',
        audience: 'asset-api',
    });
    const [showSecrets, setShowSecrets] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [connectionMessage, setConnectionMessage] = useState('');
    const [isLoadingConfig, setIsLoadingConfig] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingApps, setIsSavingApps] = useState(false);
    const [originalConfig, setOriginalConfig] = useState<ConfigState | null>(null);
    const [favoriteBuildings, setFavoriteBuildings] = useState<any[]>([]);
    
    // Geminus Base state
    const [geminusBaseConfig, setGeminusBaseConfig] = useState({
        apiUrl: '',
        username: '',
        password: '',
    });
    const [isSavingGeminusBase, setIsSavingGeminusBase] = useState(false);
    const [isTestingGeminusBase, setIsTestingGeminusBase] = useState(false);
    const [geminusBaseStatus, setGeminusBaseStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [geminusBaseMessage, setGeminusBaseMessage] = useState('');
    const [isSyncingGeminusBase, setIsSyncingGeminusBase] = useState(false);
    const [geminusBaseProfileId, setGeminusBaseProfileId] = useState<string | null>(null);

    // Load Geminus Base credentials from api_profiles on mount
    useEffect(() => {
        supabase
            .from('api_profiles')
            .select('id, geminus_base_api_url, geminus_base_username, geminus_base_password')
            .eq('is_default', true)
            .maybeSingle()
            .then(({ data }) => {
                if (data) {
                    setGeminusBaseProfileId(data.id);
                    setGeminusBaseConfig({
                        apiUrl: data.geminus_base_api_url || '',
                        username: data.geminus_base_username || '',
                        password: data.geminus_base_password || '',
                    });
                    if (data.geminus_base_api_url) setGeminusBaseStatus('success');
                }
            });
    }, []);
    const [geminusBaseSyncResult, setGeminusBaseSyncResult] = useState<{ success: number; failed: number; lastSync: string | null } | null>(null);
    const [geminusBaseLocalCount, setGeminusBaseLocalCount] = useState(0);

    // Congeria state
    const [congeriaLinks, setCongeriaLinks] = useState<Record<string, string>>({});
    const [isSyncingCongeria, setIsSyncingCongeria] = useState(false);
    const [documentCount, setDocumentCount] = useState(0);
    const [allBuildings, setAllBuildings] = useState<any[]>([]);
    
    // BIP import state
    const [isImportingBip, setIsImportingBip] = useState(false);
    const [bipImportResult, setBipImportResult] = useState<string | null>(null);

    // Ivion connection modal state
    const [isIvionModalOpen, setIsIvionModalOpen] = useState(false);
    
    // ACC (Autodesk Forma) state — with sessionStorage persistence
    const [accProjects, setAccProjects] = useState<any[]>(() => {
        try { return JSON.parse(sessionStorage.getItem('acc_projects') || '[]'); } catch { return []; }
    });
    const [selectedAccProjectId, setSelectedAccProjectId] = useState(() =>
        sessionStorage.getItem('acc_selected_project_id') || ''
    );
    const [manualAccProjectId, setManualAccProjectId] = useState(() =>
        sessionStorage.getItem('acc_manual_project_id') || ''
    );
    const [isLoadingAccProjects, setIsLoadingAccProjects] = useState(false);
    const [isTestingAcc, setIsTestingAcc] = useState(false);
    const [accConnectionStatus, setAccConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [accConnectionMessage, setAccConnectionMessage] = useState('');
    const [isSyncingAccLocations, setIsSyncingAccLocations] = useState(false);
    const [isSyncingAccAssets, setIsSyncingAccAssets] = useState(false);
    const [accStatus, setAccStatus] = useState<any>(null);
    const [isCheckingAccStatus, setIsCheckingAccStatus] = useState(false);
    const [accRegion, setAccRegion] = useState<'US' | 'EMEA'>(() =>
        (sessionStorage.getItem('acc_region') as 'US' | 'EMEA') || 'US'
    );
    const [ivionConnectionStatus, setIvionConnectionStatus] = useState<'idle' | 'connected' | 'error'>('idle');
    const [accLocationsHint, setAccLocationsHint] = useState<string | null>(null);

    // ACC Hubs (auto-discovered)
    const [accHubs, setAccHubs] = useState<any[]>(() => {
        try { return JSON.parse(sessionStorage.getItem('acc_hubs') || '[]'); } catch { return []; }
    });
    const [selectedHubId, setSelectedHubId] = useState(() =>
        sessionStorage.getItem('acc_selected_hub_id') || ''
    );
    const [isLoadingHubs, setIsLoadingHubs] = useState(false);
    
    // ACC folder browsing state — persisted in sessionStorage
    const [accFolders, setAccFolders] = useState<any[] | null>(() => {
        try {
            const stored = sessionStorage.getItem('acc_folders');
            return stored ? JSON.parse(stored) : null;
        } catch { return null; }
    });
    const [accTopLevelItems, setAccTopLevelItems] = useState<any[]>(() => {
        try { return JSON.parse(sessionStorage.getItem('acc_top_level_items') || '[]'); } catch { return []; }
    });
    const [accRootFolderName, setAccRootFolderName] = useState(() =>
        sessionStorage.getItem('acc_root_folder_name') || ''
    );
    const [isLoadingAccFolders, setIsLoadingAccFolders] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [hasLoadedAccSettings, setHasLoadedAccSettings] = useState(false);
    
    // BIM sync state
    const [syncingBimFolderId, setSyncingBimFolderId] = useState<string | null>(null);
    const [bimSyncProgress, setBimSyncProgress] = useState<string | null>(null);
    const [selectedBimFiles, setSelectedBimFiles] = useState<Set<string>>(new Set());
    
    // 3D translation state
    const [translationStatuses, setTranslationStatuses] = useState<Record<string, TranslationStatus>>({});
    
    // Autodesk 3-legged OAuth state
    const [accAuthStatus, setAccAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
    const [isAccLoggingIn, setIsAccLoggingIn] = useState(false);
    const [isAccLoggingOut, setIsAccLoggingOut] = useState(false);

    // APS App credentials (Client ID / Secret stored in geminus_plus_endpoint_cache)
    const [apsClientId, setApsClientId] = useState('');
    const [apsClientSecret, setApsClientSecret] = useState('');
    const [apsCredentialsSaved, setApsCredentialsSaved] = useState(false);
    const [isSavingApsCredentials, setIsSavingApsCredentials] = useState(false);
    
    // ACC -> Geminus Plus sync state
    const [accToApStatus, setAccToApStatus] = useState<any>(null);
    const [isCheckingAccToAp, setIsCheckingAccToAp] = useState(false);
    const [isSyncingAccToAp, setIsSyncingAccToAp] = useState(false);
    const [accToApResult, setAccToApResult] = useState<any>(null);

    // System count (displayed in sync status)
    const [systemCount, setSystemCount] = useState(0);

    // Forma import: target building + master model selection
    const [accTargetBuildingFmGuid, setAccTargetBuildingFmGuid] = useState(() =>
        sessionStorage.getItem('acc_target_building_fm_guid') || ''
    );
    const [accMasterModelUrn, setAccMasterModelUrn] = useState('');
    const [accBuildings, setAccBuildings] = useState<Array<{ fm_guid: string; name: string }>>([]);
    const [isLoadingAccBuildings, setIsLoadingAccBuildings] = useState(false);

    // Check Autodesk 3-legged auth status on mount
    useEffect(() => {
        const checkAccAuth = async () => {
            try {
                const { data, error } = await supabase.functions.invoke('acc-auth', {
                    body: { action: 'check-auth' }
                });
                if (error) throw error;
                setAccAuthStatus(data?.authenticated ? 'authenticated' : 'unauthenticated');
            } catch {
                setAccAuthStatus('unauthenticated');
            }
        };
        if (isOpen) checkAccAuth();
    }, [isOpen]);

    // Listen for OAuth callback messages from popup
    useEffect(() => {
        const handleMessage = async (event: MessageEvent) => {
            if (event.data?.type === 'autodesk-oauth-callback' && event.data.code) {
                setIsAccLoggingIn(true);
                try {
                    const redirectUri = `${window.location.origin}/auth/autodesk/callback`;
                    const { data, error } = await supabase.functions.invoke('acc-auth', {
                        body: { action: 'exchange-code', code: event.data.code, redirectUri }
                    });
                    if (error) throw error;
                    if (data?.success) {
                        setAccAuthStatus('authenticated');
                        toast({ title: t('Autodesk-inloggning lyckades', 'Autodesk login successful'), description: t('Du är nu inloggad med ditt Autodesk-konto.', 'You are now logged in with your Autodesk account.') });
                    } else {
                        throw new Error(data?.error || 'Token exchange failed');
                    }
                } catch (err: any) {
                    toast({ variant: 'destructive', title: t('Inloggning misslyckades', 'Login failed'), description: err.message });
                } finally {
                    setIsAccLoggingIn(false);
                }
            } else if (event.data?.type === 'autodesk-oauth-error') {
                toast({ variant: 'destructive', title: t('Autodesk-inloggning avbruten', 'Autodesk login cancelled'), description: event.data.error });
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [toast]);

    // Autodesk login via popup
    const handleAutodeskLogin = async () => {
        try {
            const redirectUri = `${window.location.origin}/auth/autodesk/callback`;
            const { data, error } = await supabase.functions.invoke('acc-auth', {
                body: { action: 'get-auth-url', redirectUri }
            });
            if (error) throw error;
            if (data?.authUrl) {
                const width = 600, height = 700;
                const left = window.screenX + (window.outerWidth - width) / 2;
                const top = window.screenY + (window.outerHeight - height) / 2;
                window.open(data.authUrl, 'autodesk-login', `width=${width},height=${height},left=${left},top=${top},popup=yes`);
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        }
    };

    // Autodesk logout
    const handleAutodeskLogout = async () => {
        setIsAccLoggingOut(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-auth', {
                body: { action: 'logout' }
            });
            if (error) throw error;
            setAccAuthStatus('unauthenticated');
            toast({ title: t('Utloggad', 'Logged out'), description: t('Du har loggats ut från Autodesk.', 'You have been logged out from Autodesk.') });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsAccLoggingOut(false);
        }
    };

    const handleSaveApsCredentials = async () => {
        if (!apsClientId.trim() || !apsClientSecret.trim()) {
            toast({ variant: 'destructive', title: 'Missing fields', description: 'Enter both Client ID and Client Secret.' });
            return;
        }
        setIsSavingApsCredentials(true);
        try {
            const { error: upsertError } = await supabase.from('geminus_plus_endpoint_cache').upsert([
                { key: 'aps_client_id', value: apsClientId.trim() },
                { key: 'aps_client_secret', value: apsClientSecret.trim() },
            ], { onConflict: 'key' });
            if (upsertError) throw upsertError;
            setApsCredentialsSaved(true);
            toast({ title: 'Credentials saved', description: 'Autodesk Forma app credentials stored. You can now log in.' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsSavingApsCredentials(false);
        }
    };

    // ACC handlers
    const handleTestAccConnection = async () => {
        setIsTestingAcc(true);
        setAccConnectionStatus('idle');
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'test-connection' }
            });
            if (error) throw error;
            if (data?.success) {
                setAccConnectionStatus('success');
                setAccConnectionMessage(data.message);
                toast({ title: t('Anslutning OK', 'Connection OK'), description: data.message });
            } else {
                setAccConnectionStatus('error');
                setAccConnectionMessage(data?.error || t('Okänt fel', 'Unknown error'));
                toast({ variant: 'destructive', title: t('Anslutning misslyckades', 'Connection failed'), description: data?.error });
            }
        } catch (err: any) {
            setAccConnectionStatus('error');
            setAccConnectionMessage(err.message);
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsTestingAcc(false);
        }
    };

    const handleFetchAccProjects = async () => {
        setIsLoadingAccProjects(true);
        try {
            // Get accountId from selected hub if available
            const selectedHub = accHubs.find(h => h.id === selectedHubId);
            const accountId = selectedHub?.accountId;
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'list-projects', region: accRegion, ...(accountId ? { accountId } : {}) }
            });
            if (error) throw error;
            if (data?.success && data.projects) {
                setAccProjects(data.projects);
                if (data.projects.length > 0 && !selectedAccProjectId) {
                    setSelectedAccProjectId(data.projects[0].id);
                }
                toast({ title: 'Projects fetched', description: `Found ${data.projects.length} projects in ACC.` });
            } else {
                toast({ variant: 'destructive', title: 'Error', description: data?.error || 'Could not fetch projects' });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsLoadingAccProjects(false);
        }
    };

    const handleSyncAccLocations = async () => {
        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        if (!effectiveProjectId) {
            toast({ variant: 'destructive', title: 'Select project', description: 'Select an ACC project or enter a project ID manually.' });
            return;
        }
        setIsSyncingAccLocations(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'sync-locations', projectId: effectiveProjectId, region: accRegion }
            });
            if (error) throw error;
            if (data?.success) {
                toast({ title: 'Sync complete', description: data.message });
                if (data.hint) {
                    setAccLocationsHint(data.hint);
                } else {
                    setAccLocationsHint(null);
                }
                handleCheckAccStatus();
            } else {
                toast({ variant: 'destructive', title: 'Sync failed', description: data?.error });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsSyncingAccLocations(false);
        }
    };

    const handleSyncAccAssets = async () => {
        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        if (!effectiveProjectId) {
            toast({ variant: 'destructive', title: 'Select project', description: 'Select an ACC project or enter a project ID manually.' });
            return;
        }
        setIsSyncingAccAssets(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'sync-assets', projectId: effectiveProjectId, region: accRegion }
            });
            if (error) throw error;
            if (data?.success) {
                toast({ title: 'Sync complete', description: data.message });
                handleCheckAccStatus();
            } else {
                toast({ variant: 'destructive', title: 'Sync failed', description: data?.error });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsSyncingAccAssets(false);
        }
    };

    const handleCheckAccStatus = async () => {
        setIsCheckingAccStatus(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'check-status' }
            });
            if (error) throw error;
            if (data?.success) {
                setAccStatus(data);
                if (data.savedProjectId) {
                    if (!manualAccProjectId) setManualAccProjectId(data.savedProjectId);
                    if (!selectedAccProjectId) setSelectedAccProjectId(data.savedProjectId);
                }
                if (data.savedRegion) {
                    setAccRegion(data.savedRegion as 'US' | 'EMEA');
                }
            }
        } catch (err: any) {
            console.error('Failed to check ACC status:', err);
        } finally {
            setIsCheckingAccStatus(false);
        }
    };

    // ACC -> Geminus Plus sync handlers
    const handleCheckAccToGeminusPlus = async () => {
        setIsCheckingAccToAp(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-to-geminus-plus', {
                body: { action: 'check-status' }
            });
            if (error) throw error;
            setAccToApStatus(data);
        } catch (err: any) {
            console.error('Failed to check ACC->Geminus Plus status:', err);
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsCheckingAccToAp(false);
        }
    };

    const handleSyncAccToGeminusPlus = async () => {
        setIsSyncingAccToAp(true);
        setAccToApResult(null);
        try {
            const { data, error } = await supabase.functions.invoke('acc-to-geminus-plus', {
                body: { action: 'sync' }
            });
            if (error) throw error;
            setAccToApResult(data);
            if (data?.success) {
                toast({ 
                    title: 'Sync to Geminus Plus complete', 
                    description: `${data.summary?.buildingsSynced || 0} buildings synced` 
                });
            } else {
                toast({ 
                    variant: 'destructive', 
                    title: 'Sync partially failed', 
                    description: `${data?.summary?.totalErrors || 0} errors occurred` 
                });
            }
            // Refresh status
            handleCheckAccToGeminusPlus();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Sync failed', description: err.message });
        } finally {
            setIsSyncingAccToAp(false);
        }
    };

    // Persist ACC state to sessionStorage whenever they change
    useEffect(() => { sessionStorage.setItem('acc_projects', JSON.stringify(accProjects)); }, [accProjects]);
    useEffect(() => { sessionStorage.setItem('acc_selected_project_id', selectedAccProjectId); }, [selectedAccProjectId]);
    useEffect(() => { sessionStorage.setItem('acc_manual_project_id', manualAccProjectId); }, [manualAccProjectId]);
    useEffect(() => { sessionStorage.setItem('acc_region', accRegion); }, [accRegion]);
    useEffect(() => { sessionStorage.setItem('acc_hubs', JSON.stringify(accHubs)); }, [accHubs]);
    useEffect(() => { sessionStorage.setItem('acc_selected_hub_id', selectedHubId); }, [selectedHubId]);
    useEffect(() => {
        if (accFolders !== null) sessionStorage.setItem('acc_folders', JSON.stringify(accFolders));
    }, [accFolders]);
    useEffect(() => { sessionStorage.setItem('acc_top_level_items', JSON.stringify(accTopLevelItems)); }, [accTopLevelItems]);
    useEffect(() => { sessionStorage.setItem('acc_root_folder_name', accRootFolderName); }, [accRootFolderName]);

    // Load APS credentials from DB when modal opens
    useEffect(() => {
        if (!isOpen) return;
        supabase.from('geminus_plus_endpoint_cache')
            .select('key, value')
            .in('key', ['aps_client_id', 'aps_client_secret'])
            .then(({ data }) => {
                if (!data) return;
                const id = data.find(r => r.key === 'aps_client_id')?.value || '';
                const secret = data.find(r => r.key === 'aps_client_secret')?.value || '';
                setApsClientId(id);
                setApsClientSecret(secret);
                setApsCredentialsSaved(!!(id && secret));
            });
    }, [isOpen]);

    useEffect(() => {
        if (isOpen && accAuthStatus !== 'checking' && !hasLoadedAccSettings) {
            setHasLoadedAccSettings(true);
            handleCheckAccStatus();
            // Auto-fetch hubs ONLY if authenticated — avoids red error toast when not logged in
            if (accHubs.length === 0 && accAuthStatus === 'authenticated') {
                handleFetchHubs();
            }
            // Folders are NOT auto-fetched — user must click "Fetch folders" to avoid 403 errors
        }
    }, [isOpen, accAuthStatus, hasLoadedAccSettings]);

    // Reset ACC settings loaded flag when modal closes
    useEffect(() => {
        if (!isOpen) {
            setHasLoadedAccSettings(false);
        }
    }, [isOpen]);

    // Fetch ACC Hubs via /project/v1/hubs (auto-discovers all accounts + regions)
    const handleFetchHubs = async () => {
        if (accAuthStatus !== 'authenticated') return; // Guard: only fetch if authenticated
        setIsLoadingHubs(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'list-hubs' }
            });
            if (error) throw error;
            if (data?.success && data.hubs) {
                setAccHubs(data.hubs);
                // If no hub selected yet, auto-select first
                if (!selectedHubId && data.hubs.length > 0) {
                    const firstHub = data.hubs[0];
                    setSelectedHubId(firstHub.id);
                    setAccRegion(firstHub.region === 'EMEA' ? 'EMEA' : 'US');
                }
            } else {
                toast({ variant: 'destructive', title: 'Could not fetch hubs', description: data?.error });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsLoadingHubs(false);
        }
    };

    // Fetch ACC folders via Data Management API
    const handleFetchAccFolders = async () => {
        if (accAuthStatus !== 'authenticated') return; // Guard: only fetch if authenticated
        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        if (!effectiveProjectId) {
            toast({ variant: 'destructive', title: 'Project ID missing', description: 'Enter an ACC project ID first.' });
            return;
        }
        setIsLoadingAccFolders(true);
        try {
            const selectedHub = accHubs.find(h => h.id === selectedHubId);
            const accountId = selectedHub?.accountId;
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'list-folders', projectId: effectiveProjectId, region: accRegion, ...(accountId ? { accountId } : {}) }
            });
            if (error) throw error;
            if (data?.success) {
                setAccFolders(data.folders || []);
                setAccTopLevelItems(data.topLevelItems || []);
                setAccRootFolderName(data.rootFolder || '');
                toast({ title: 'Folders fetched', description: `Found ${(data.folders || []).length} folders in "${data.rootFolder}".` });
            } else {
                toast({ variant: 'destructive', title: 'Error', description: data?.error || 'Could not fetch folders' });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
        } finally {
            setIsLoadingAccFolders(false);
        }
    };

    const toggleFolder = (folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            return next;
        });
    };

    const toggleBimFile = (itemId: string) => {
        setSelectedBimFiles(prev => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId);
            else next.add(itemId);
            return next;
        });
    };

    // BIM sync handler - sequential per-file processing
    const handleSyncBimData = async (folder: any, selectedFiles?: any[]) => {
        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        if (!effectiveProjectId) {
            toast({ variant: 'destructive', title: 'Project ID missing', description: 'Enter an Autodesk Forma project ID first.' });
            return;
        }

        const allItems = selectedFiles || folder.items || [];
        const bimItems = allItems.filter((item: any) => item.versionUrn);
        if (bimItems.length === 0) {
            const bimWithoutUrn = allItems.filter((i: any) => i.isBim && !i.versionUrn);
            console.warn('[BIM Sync] No items with versionUrn. All items:', allItems.length, 'BIM without URN:', bimWithoutUrn.length, bimWithoutUrn.map((i: any) => i.name));
            toast({ 
                variant: 'destructive', 
                title: 'No BIM files', 
                description: bimWithoutUrn.length > 0
                    ? `Found ${bimWithoutUrn.length} BIM file(s) but without version URN. These may be Cloud Models requiring direct API access.`
                    : 'This folder contains no BIM files.'
            });
            return;
        }
        console.log(`[BIM Sync] Starting sync: ${bimItems.length} files with versionUrn`, bimItems.map((i: any) => ({ name: i.name, urn: i.versionUrn?.slice(-30) })));

        setSyncingBimFolderId(folder.id);
        
        let totalLevels = 0;
        let totalRooms = 0;
        let totalInstances = 0;
        let failures: string[] = [];

        // Process files one at a time to avoid memory limits
        for (let i = 0; i < bimItems.length; i++) {
            const item = bimItems[i];
            setBimSyncProgress(`File ${i + 1}/${bimItems.length}: ${item.name}`);

            try {
                const { data, error } = await supabase.functions.invoke('acc-sync', {
                    body: {
                        action: 'sync-bim-data',
                        projectId: effectiveProjectId,
                        region: accRegion,
                        folderName: folder.name,
                        folderId: folder.id,
                        singleItem: item,
                    }
                });

                if (error) throw error;

                if (data?.success) {
                    totalLevels += data.levels || 0;
                    totalRooms += data.rooms || 0;
                    totalInstances += data.instances || 0;
                } else if (data?.state === 'PROCESSING') {
                    toast({
                        title: 'Indexing in progress',
                        description: `${item.name}: Model is being indexed. Try again shortly.`,
                    });
                } else {
                    failures.push(`${item.name}: ${data?.error || 'Unknown error'}`);
                }
            } catch (err: any) {
                console.error(`[BIM Sync] Error syncing ${item.name}:`, err);
                const errMsg = err?.context?.body ? JSON.stringify(err.context.body) : err.message;
                failures.push(`${item.name}: ${errMsg}`);
            }
        }

        // Summary
        if (totalLevels > 0 || totalRooms > 0 || totalInstances > 0) {
            toast({
                title: 'BIM sync complete',
                description: `${totalLevels} floors, ${totalRooms} rooms, ${totalInstances} instances from ${bimItems.length - failures.length}/${bimItems.length} file(s)`,
            });
            handleCheckAccStatus();
            // Auto-extract technical systems from synced BIM data
            handleAutoSyncSystems();
        } else if (failures.length === 0) {
            // All files processed but no levels/rooms found
            toast({
                variant: 'destructive',
                title: 'No rooms/floors found',
                description: 'BIM models were indexed but contained no Revit Levels or Rooms.',
            });
        }
        
        if (failures.length > 0) {
            toast({
                variant: 'destructive',
                title: `${failures.length} file(s) failed`,
                description: failures[0],
            });
        }

        setSyncingBimFolderId(null);
        setBimSyncProgress(null);
    };

    const formatFileSize = (bytes: number | null) => {
        if (!bytes) return '';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };
    // Handle 3D translation for a BIM file
    const handleTranslate3D = async (item: any, folder: any) => {
        if (!item.versionUrn) {
            toast({ variant: 'destructive', title: 'Error', description: 'File is missing versionUrn.' });
            return;
        }

        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        const buildingFmGuid = accTargetBuildingFmGuid ||
            `acc-bim-building-${folder.id.replace(/[^a-zA-Z0-9-]/g, '')}`;

        if (!accTargetBuildingFmGuid) {
            toast({ variant: 'destructive', title: t('Välj byggnad', 'Select building'), description: t('Koppla importen till en byggnad innan 3D-konvertering.', 'Link the import to a building before 3D conversion.') });
            return;
        }

        const isMasterModel = !accMasterModelUrn || accMasterModelUrn === item.versionUrn;

        // Update status to pending
        setTranslationStatuses(prev => ({ ...prev, [item.versionUrn]: { status: 'pending', message: t('Startar...', 'Starting...') } }));

        toast({ title: t('Konvertering startad', 'Conversion started'), description: t(`Startar 3D-konvertering för ${item.name}...`, `Starting 3D conversion for ${item.name}...`) });

        const { accXktConverter } = await import('@/services/acc-xkt-converter');
        const result = await accXktConverter.runFullPipeline(
            item.versionUrn,
            {
                buildingFmGuid,
                folderId: folder.id,
                fileName: item.name,
                modelName: item.name.replace(/\.[^.]+$/, ''),
                region: accRegion,
                isMasterModel,
            },
            (status) => {
                setTranslationStatuses(prev => ({ ...prev, [item.versionUrn]: status }));
            }
        );

        if (result.status === 'complete') {
            toast({ title: '3D-konvertering klar', description: `${item.name} har konverterats och laddats upp.` });
        } else if (result.status === 'failed') {
            const isFormatLimitation = result.error?.includes('SVF2') || result.error?.includes('serverbaserad') || result.error?.includes('formatLimitation');
            toast({ 
                variant: 'destructive', 
                title: isFormatLimitation ? t('Formatbegränsning', 'Format limitation') : t('Konvertering misslyckades', 'Conversion failed'),
                description: result.error || t('Okänt fel', 'Unknown error'),
            });
        }
    };

    // Persist accTargetBuildingFmGuid to sessionStorage
    useEffect(() => {
        sessionStorage.setItem('acc_target_building_fm_guid', accTargetBuildingFmGuid);
    }, [accTargetBuildingFmGuid]);

    const fetchAccBuildings = async () => {
        setIsLoadingAccBuildings(true);
        try {
            const { data, error } = await supabase
                .from('assets')
                .select('fm_guid, common_name, name')
                .eq('category', 'Building')
                .order('common_name');
            if (error) throw error;
            setAccBuildings((data || []).map((b: any) => ({ fm_guid: b.fm_guid, name: b.common_name || b.name || b.fm_guid })));
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Kunde inte hämta byggnader', description: err.message });
        } finally {
            setIsLoadingAccBuildings(false);
        }
    };

    // Cleanup translation polling on unmount
    useEffect(() => {
        return () => {
            import('@/services/acc-xkt-converter').then(m => m.accXktConverter.stopAllPolling());
        };
    }, []);

    
    // Save app configs to localStorage (no backend table for apps currently)
    const handleSaveAppConfigs = async () => {
        setIsSavingApps(true);
        try {
            // Persist to localStorage for now
            localStorage.setItem('appConfigs', JSON.stringify(appConfigs));
            toast({
                title: "Settings Saved",
                description: "Application settings have been saved.",
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Save Error",
                description: error.message || "Failed to save settings",
            });
        } finally {
            setIsSavingApps(false);
        }
    };

    // Fetch current config
    const fetchConfig = async () => {
        setIsLoadingConfig(true);
        try {
            const { data, error } = await supabase.functions.invoke('update-geminus-plus-config', {
                body: { action: 'get-config' }
            });

            if (error) throw error;

            if (data?.config) {
                const loadedConfig = {
                    keycloakUrl: data.config.keycloakUrl || '',
                    apiUrl: data.config.apiUrl || '',
                    clientId: data.config.clientId || '',
                    username: data.config.username || '',
                    audience: data.config.audience || 'asset-api',
                    clientSecret: data.config.hasClientSecret ? '••••••••' : '',
                    password: data.config.hasPassword ? '••••••••' : '',
                    apiKey: data.config.hasApiKey ? '••••••••' : '',
                };
                setConfig(loadedConfig);
                setOriginalConfig(loadedConfig);
            }
        } catch (error) {
            console.error('Failed to fetch config:', error);
        } finally {
            setIsLoadingConfig(false);
        }
    };

    // Fetch sync status and asset count
    const fetchSyncStatus = async () => {
        try {
            const [syncResult, countResult, systemCountResult] = await Promise.all([
                supabase.from('asset_sync_state').select('*').order('subtree_name'),
                supabase.from('assets').select('id', { count: 'exact', head: true }),
                supabase.from('systems').select('id', { count: 'exact', head: true }),
            ]);
            
            if (syncResult.data) {
                setSyncStatuses(syncResult.data as SyncStatus[]);
            }
            if (countResult.count !== null) {
                setAssetCount(countResult.count);
            }
            if (systemCountResult.count !== null) {
                setSystemCount(systemCountResult.count);
            }
        } catch (error) {
            console.error('Failed to fetch sync status:', error);
        }
    };

    // Fetch progress data from asset_sync_progress
    const fetchSyncProgress = async () => {
        try {
            const { data } = await supabase
                .from('asset_sync_progress')
                .select('total_synced, total_buildings, current_building_index, last_error')
                .eq('job', 'assets_instances')
                .maybeSingle();
            
            if (data) {
                setSyncProgress({
                    totalSynced: data.total_synced,
                    totalBuildings: data.total_buildings,
                    currentBuildingIndex: data.current_building_index,
                    lastError: data.last_error,
                });
            }
        } catch (error) {
            console.error('Failed to fetch sync progress:', error);
        }
    };

    // Check sync status against Geminus Plus
    const checkSyncStatus = async () => {
        setIsCheckingSync(true);
        try {
            const { data, error } = await supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'check-sync-status' }
            });
            if (error) throw error;
            if (data?.success) {
                setSyncCheck(data as NewSyncCheckResult);
            }
        } catch (error) {
            console.error('Failed to check sync status:', error);
        } finally {
            setIsCheckingSync(false);
        }
    };

    // Sync structure only (decoupled from asset sync)
    const handleSyncStructure = async () => {
        if (isSyncingStructure) return;

        setIsSyncingStructure(true);
        setStructureSyncLog([]);
        setStructureSyncOutcome(null);
        const startTime = Date.now();

        const addStep = (id: string, label: string, status: 'running' | 'done' | 'error' | 'pending' = 'running') => {
            setStructureSyncLog(prev => {
                const existing = prev.find(s => s.id === id);
                if (existing) {
                    return prev.map(s => s.id === id ? { ...s, status, completedAt: status === 'done' || status === 'error' ? Date.now() : undefined } : s);
                }
                return [...prev, { id, label, status, startedAt: Date.now() }];
            });
        };

        const updateStep = (id: string, updates: Partial<import('./SyncStatusLog').SyncStep>) => {
            setStructureSyncLog(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
        };

        try {
            addStep('structure', 'Syncing buildings, floors & rooms');

            const runStructureLoop = async (isFirst = false): Promise<void> => {
                const { data, error } = await supabase.functions.invoke('geminus-plus-sync', {
                    body: { action: 'sync-structure', force: isFirst }
                });

                if (error) throw error;

                await fetchSyncStatus();

                if (data?.interrupted) {
                    updateStep('structure', {
                        message: `${data.totalSynced || 0} items (${data.phase})...`,
                        count: data.totalSynced || 0,
                    });
                    setTimeout(() => runStructureLoop(false), 2000);
                    return;
                }

                updateStep('structure', { status: 'done', count: data?.totalSynced || 0, completedAt: Date.now() });

                const elapsed = Date.now() - startTime;
                setStructureSyncOutcome({
                    success: true,
                    summary: `Structure sync complete`,
                    details: [
                        `${(data?.totalSynced || 0).toLocaleString()} buildings/floors/rooms synced`,
                    ],
                    durationMs: elapsed,
                });

                window.dispatchEvent(new Event('building-data-changed'));
                setIsSyncingStructure(false);
                await checkSyncStatus();
            };

            toast({
                title: 'Starting structure sync',
                description: 'Syncing buildings, floors and rooms...',
            });

            runStructureLoop(true);
        } catch (error: any) {
            setStructureSyncLog(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'error' as const, message: error.message, completedAt: Date.now() } : s));
            setStructureSyncOutcome({
                success: false,
                summary: 'Structure sync failed',
                details: [error.message],
                durationMs: Date.now() - startTime,
            });
            toast({
                variant: 'destructive',
                title: 'Sync failed',
                description: error.message,
            });
            setIsSyncingStructure(false);
        }
    };

    // Sync all assets with loop-until-complete behavior + push local objects
    const handleSyncAssetsChunked = async () => {
        setIsSyncingAssets(true);
        setAssetSyncLog([
            { id: 'pull', label: 'Pulling assets from Geminus Plus', status: 'running', startedAt: Date.now() },
            { id: 'push', label: 'Pushing local objects to Geminus Plus', status: 'pending' },
        ]);
        setAssetSyncOutcome(null);
        const startTime = Date.now();
        let totalPulled = 0;

        const updateStep = (id: string, updates: Partial<SyncStep>) => {
            setAssetSyncLog(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
        };
        
        const runResumableSync = async (): Promise<void> => {
            try {
                const { data, error } = await supabase.functions.invoke('geminus-plus-sync', {
                    body: { action: 'sync-assets-resumable', force: true }
                });

                if (error) {
                    console.error('Asset sync error:', error);
                    const errorMsg = error.message || '';
                    if (errorMsg.includes('Sort exceeded memory limit') || errorMsg.includes('SORT_MEMORY_LIMIT')) {
                        setTimeout(() => runResumableSync(), 2000);
                        return;
                    }
                    updateStep('pull', { status: 'error', message: error.message, completedAt: Date.now() });
                    setAssetSyncOutcome({ success: false, summary: 'Asset sync failed', details: [error.message], durationMs: Date.now() - startTime });
                    setIsSyncingAssets(false);
                    return;
                }

                await fetchSyncStatus();

                if (data?.interrupted) {
                    totalPulled = data.totalSynced || totalPulled;
                    const progressInfo = data.progress;
                    updateStep('pull', {
                        count: totalPulled,
                        message: progressInfo ? `Building ${(progressInfo.currentBuildingIndex || 0) + 1}/${progressInfo.totalBuildings || '?'}` : undefined,
                    });
                    setTimeout(() => runResumableSync(), 1000);
                } else {
                    totalPulled = data?.totalSynced || totalPulled;
                    updateStep('pull', { status: 'done', count: totalPulled, completedAt: Date.now() });

                    // Step 2: Push local objects to Geminus Plus
                    updateStep('push', { status: 'running', startedAt: Date.now() });
                    try {
                        const { data: pushData, error: pushError } = await supabase.functions.invoke('geminus-plus-sync', {
                            body: { action: 'push-missing-to-geminus-plus' }
                        });
                        if (pushError) throw pushError;
                        const pushed = pushData?.created || 0;
                        updateStep('push', { status: 'done', count: pushed, completedAt: Date.now() });

                        setAssetSyncOutcome({
                            success: true,
                            summary: 'Asset sync complete',
                            details: [
                                `${totalPulled.toLocaleString()} assets pulled from Geminus Plus`,
                                pushed > 0 ? `${pushed} local objects pushed to Geminus Plus` : 'No local objects to push',
                            ],
                            durationMs: Date.now() - startTime,
                        });
                    } catch (pushErr: any) {
                        updateStep('push', { status: 'error', message: pushErr.message, completedAt: Date.now() });
                        setAssetSyncOutcome({
                            success: true,
                            summary: 'Assets pulled, but push failed',
                            details: [
                                `${totalPulled.toLocaleString()} assets pulled from Geminus Plus`,
                                `Push failed: ${pushErr.message}`,
                            ],
                            durationMs: Date.now() - startTime,
                        });
                    }

                    setIsSyncingAssets(false);
                    await checkSyncStatus();
                    handleAutoSyncSystems();
                    window.dispatchEvent(new CustomEvent('asset-sync-completed', { detail: { totalSynced: totalPulled } }));
                }
            } catch (error: any) {
                console.error('Asset sync exception:', error);
                const errorMsg = error.message || '';
                if (errorMsg.includes('Sort exceeded memory limit') || errorMsg.includes('SORT_MEMORY_LIMIT')) {
                    setTimeout(() => runResumableSync(), 3000);
                    return;
                }
                updateStep('pull', { status: 'error', message: error.message, completedAt: Date.now() });
                setAssetSyncOutcome({ success: false, summary: 'Asset sync failed', details: [error.message], durationMs: Date.now() - startTime });
                setIsSyncingAssets(false);
            }
        };

        toast({
            title: 'Starting asset sync',
            description: 'Syncing all assets building by building...',
        });

        runResumableSync();
    };

    // Reset assets sync progress (admin action)
    const handleResetAssetsProgress = async () => {
        try {
            const { data, error } = await supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'reset-assets-progress' }
            });
            
            if (error) throw error;
            
            toast({
                title: 'Progress reset',
                description: data?.message || 'You can now start a fresh sync.',
            });
            
            await fetchSyncStatus();
            await checkSyncStatus();
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: 'Reset failed',
                description: error.message,
            });
        }
    };

    const handleSyncSingleBuilding = async () => {
        if (!selectedSingleBuilding || isSyncingSingleBuilding) return;
        setIsSyncingSingleBuilding(true);
        setSingleBuildingSyncResult(null);
        try {
            const { data, error } = await supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'sync-single-building', buildingFmGuid: selectedSingleBuilding }
            });
            if (error) throw error;
            setSingleBuildingSyncResult({ success: true, message: `${(data?.totalSynced || 0).toLocaleString()} assets synced` });
            toast({ title: 'Building synced', description: `${(data?.totalSynced || 0).toLocaleString()} assets updated` });
            await checkSyncStatus();
        } catch (error: any) {
            setSingleBuildingSyncResult({ success: false, message: error.message });
            toast({ variant: 'destructive', title: 'Sync failed', description: error.message });
        } finally {
            setIsSyncingSingleBuilding(false);
        }
    };

    // Force refresh XKT models for a single building
    const handleForceRefreshXkt = async (bFmGuid?: string) => {
        // Priority: explicit arg > active viewer building > selected facility > first favorite
        const targetGuid = bFmGuid
            || viewer3dFmGuid
            || selectedFacility?.fmGuid
            || favoriteBuildings[0]?.fmGuid;
        if (!targetGuid) {
            toast({ variant: 'destructive', title: 'No building selected' });
            return;
        }
        // Resolve building name for UI
        const targetName = favoriteBuildings.find((b: any) => b.fmGuid === targetGuid)?.commonName
            || selectedFacility?.commonName
            || targetGuid.substring(0, 8) + '...';
        setIsSyncingXkt(true);
        try {
            toast({ title: `Force refreshing 3D models for ${targetName}...`, description: 'Downloading latest XKT from Geminus Plus' });
            
            // 1. Call backend with force: true
            const { data, error } = await supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'sync-xkt-building', buildingFmGuid: targetGuid, force: true }
            });
            if (error) throw error;

            const syncedCount = data?.synced || 0;

            if (syncedCount > 0) {
                // 2. Clear frontend caches only if something was actually refreshed
                const { clearBuildingFromMemory } = await import('@/hooks/useXktPreload');
                clearBuildingFromMemory(targetGuid);

                // 3. Signal the viewer to reload
                window.dispatchEvent(new CustomEvent('XKT_FORCE_RELOAD', { detail: { buildingFmGuid: targetGuid } }));

                toast({
                    title: 'XKT Force Refresh Complete',
                    description: `${syncedCount} models refreshed for ${targetName}. Viewer will reload.`,
                });
            } else {
                // No models refreshed — show error details
                const errDetails = data?.errors?.join('; ') || data?.message || 'No models were downloaded.';
                toast({
                    variant: 'destructive',
                    title: 'Force refresh: no models updated',
                    description: errDetails.substring(0, 200),
                });
            }
            await checkSyncStatus();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Force refresh failed', description: err.message });
        } finally {
            setIsSyncingXkt(false);
        }
    };

    // Sync all XKT models with loop-until-complete behavior
    const handleSyncXkt = async () => {
        const isForce = forceXkt;
        setIsSyncingXkt(true);
        let totalSyncedOverall = 0;
        
        const runResumableSync = async (): Promise<void> => {
            try {
                const { data, error } = await supabase.functions.invoke('geminus-plus-sync', {
                    body: { action: 'sync-xkt-resumable', force: isForce }
                });

                if (error) {
                    console.error('XKT sync error:', error);
                    toast({
                        variant: "destructive",
                        title: "Sync Error",
                        description: error.message,
                    });
                    setIsSyncingXkt(false);
                    return;
                }

                // Update status display
                await fetchSyncStatus();
                totalSyncedOverall += (data?.synced || 0);

                if (data?.interrupted) {
                    // Continue syncing - call again after a short delay
                    console.log(`XKT sync progress: ${data.synced} synced, continuing...`);
                    toast({
                        title: "Syncing XKT Models",
                        description: `${totalSyncedOverall} models synced. Continuing...`,
                    });
                    
                    setTimeout(() => runResumableSync(), 1000);
                } else {
                    // Completed
                    console.log(`XKT sync completed: ${totalSyncedOverall} total`);

                    if (totalSyncedOverall > 0) {
                        // Clear all building caches and reload viewer
                        const { clearBuildingFromMemory } = await import('@/hooks/useXktPreload');
                        // Clear active viewer building if available
                        if (viewer3dFmGuid) clearBuildingFromMemory(viewer3dFmGuid);
                        window.dispatchEvent(new CustomEvent('XKT_FORCE_RELOAD', { detail: {} }));
                        toast({
                            title: "XKT Sync Complete",
                            description: `${totalSyncedOverall} 3D models synced. Viewer will reload.`,
                        });
                    } else {
                        toast({
                            title: "XKT Sync Complete",
                            description: `No new models were downloaded.`,
                        });
                    }
                    setIsSyncingXkt(false);
                    await checkSyncStatus();
                }
            } catch (error: any) {
                console.error('XKT sync exception:', error);
                toast({
                    variant: "destructive",
                    title: "Sync Failed",
                    description: error.message,
                });
                setIsSyncingXkt(false);
            }
        };

        toast({
            title: isForce ? "Force-syncing XKT Models" : "Starting XKT Sync",
            description: isForce
                ? "Re-downloading all 3D models regardless of revision..."
                : "Syncing 3D models for all buildings. This will complete automatically.",
        });

        runResumableSync();
    };

    // Auto-trigger system sync (called after asset sync completes)
    const handleAutoSyncSystems = async () => {
        try {
            const { data, error } = await supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'sync-systems' }
            });

            if (error) {
                console.error('Auto system sync error:', error);
                return;
            }

            const created = data?.systemsCreated || 0;
            const links = data?.linksCreated || 0;
            if (created > 0 || links > 0) {
                toast({
                    title: "Technical systems synced",
                    description: `${created} system, ${links} kopplingar extraherade.`,
                });
            }
            await fetchSyncStatus();
        } catch (error: any) {
            console.error('Auto system sync exception:', error);
        }
    };

    // Fetch favorite building(s)
    const fetchFavoriteBuildings = async () => {
        try {
            // Always get all buildings first
            const { data: allBuildings, error: buildError } = await supabase
                .from('assets')
                .select('fm_guid, common_name, name')
                .eq('category', 'Building');

            if (buildError) throw buildError;
            
            if (!allBuildings || allBuildings.length === 0) {
                console.log('No buildings found in assets table');
                setFavoriteBuildings([]);
                return;
            }

            // Check for favorites
            const { data: favorites } = await supabase
                .from('building_settings')
                .select('fm_guid')
                .eq('is_favorite', true);

            if (favorites && favorites.length > 0) {
                // Find matching buildings from our list
                const favoriteFmGuids = favorites.map(f => f.fm_guid);
                const favoriteBuildings = allBuildings.filter(b => favoriteFmGuids.includes(b.fm_guid));
                
                if (favoriteBuildings.length > 0) {
                    setFavoriteBuildings(favoriteBuildings);
                    return;
                }
            }
            
            // Fallback: use first building if no favorites match
            setFavoriteBuildings([allBuildings[0]]);
        } catch (error) {
            console.error('Failed to fetch favorite buildings:', error);
        }
    };

    // Congeria functions
    const fetchCongeriaData = async () => {
        try {
            // Fetch all buildings
            const { data: buildings } = await supabase
                .from('assets')
                .select('fm_guid, common_name, name')
                .eq('category', 'Building');
            
            if (buildings) {
                setAllBuildings(buildings);
            }

            // Fetch existing Congeria links
            const { data: links } = await supabase
                .from('building_external_links')
                .select('building_fm_guid, external_url')
                .eq('system_name', 'congeria');

            if (links) {
                const linkMap: Record<string, string> = {};
                links.forEach(link => {
                    linkMap[link.building_fm_guid] = link.external_url;
                });
                setCongeriaLinks(linkMap);
            }

            // Fetch document count
            const { count } = await supabase
                .from('documents')
                .select('id', { count: 'exact', head: true });
            
            if (count !== null) {
                setDocumentCount(count);
            }
        } catch (error) {
            console.error('Failed to fetch Congeria data:', error);
        }
    };

    const handleCongeriaUrlChange = (buildingFmGuid: string, url: string) => {
        setCongeriaLinks(prev => ({
            ...prev,
            [buildingFmGuid]: url
        }));
    };

    const handleSaveCongeriaUrl = async (buildingFmGuid: string) => {
        const url = congeriaLinks[buildingFmGuid];
        if (!url) return;

        try {
            const { error } = await supabase
                .from('building_external_links')
                .upsert({
                    building_fm_guid: buildingFmGuid,
                    system_name: 'congeria',
                    external_url: url,
                    display_name: 'Document Archive'
                }, { onConflict: 'building_fm_guid,system_name' });

            if (error) throw error;

            toast({
                title: "URL saved",
                description: "The Congeria link has been saved.",
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message,
            });
        }
    };

    const handleSyncAllCongeria = async () => {
        setIsSyncingCongeria(true);
        try {
            // Get all buildings with Congeria links
            const linkedBuildings = Object.keys(congeriaLinks).filter(guid => congeriaLinks[guid]);
            
            for (const buildingFmGuid of linkedBuildings) {
                await supabase.functions.invoke('congeria-sync', {
                    body: { buildingFmGuid, action: 'sync' }
                });
            }

            toast({
                title: "Sync started",
                description: `Syncing documents for ${linkedBuildings.length} buildings.`,
            });

            // Refetch document count
            await fetchCongeriaData();
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Sync failed",
                description: error.message,
            });
        } finally {
            setIsSyncingCongeria(false);
        }
    };

    // Trigger sync for all buildings (objectType 1 only) - Legacy, uses structure sync state
    const handleSyncAllBuildings = async () => {
        setIsSyncingStructure(true);
        try {
            supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'sync-all-buildings' }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Syncing all buildings",
                description: "Fetching all buildings from Geminus Plus. This may take a while.",
            });

            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
                const latestStatus = syncStatuses.find(s => s.subtree_id === 'buildings');
                if (latestStatus?.sync_status === 'completed' || latestStatus?.sync_status === 'failed') {
                    clearInterval(pollInterval);
                    setIsSyncingStructure(false);
                    checkSyncStatus();
                    if (latestStatus.sync_status === 'completed') {
                        toast({
                            title: "Sync complete!",
                            description: `${latestStatus.total_assets} buildings synced.`,
                        });
                    }
                }
            }, 3000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncingStructure(false);
                fetchSyncStatus();
                checkSyncStatus();
            }, 300000);

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Sync failed",
                description: error.message,
            });
            setIsSyncingStructure(false);
        }
    };

    // Trigger building sync - Legacy, uses structure sync state
    const handleBuildingSync = async () => {
        if (favoriteBuildings.length === 0) {
            toast({
                variant: "destructive",
                title: "No building",
                description: "Could not find a building to synchronize.",
            });
            return;
        }

        const buildingFmGuid = favoriteBuildings[0].fm_guid;
        const buildingName = favoriteBuildings[0].common_name || favoriteBuildings[0].name;

        setIsSyncingStructure(true);
        try {
            supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'building-sync', buildingFmGuid }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Building sync started",
                description: `Syncing ${buildingName} with floor plans and rooms.`,
            });

            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
                const latestStatus = syncStatuses.find(s => s.subtree_id === buildingFmGuid);
                if (latestStatus?.sync_status === 'completed' || latestStatus?.sync_status === 'failed') {
                    clearInterval(pollInterval);
                    setIsSyncingStructure(false);
                    checkSyncStatus();
                }
            }, 3000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncingStructure(false);
                fetchSyncStatus();
                checkSyncStatus();
            }, 300000);

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Sync failed",
                description: error.message,
            });
            setIsSyncingStructure(false);
        }
    };

    // Trigger incremental sync - Legacy, uses assets sync state
    const handleIncrementalSync = async () => {
        setIsSyncingAssets(true);
        try {
            supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'incremental-sync' }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: t('Inkrementell synk startad', 'Incremental sync started'),
                description: t('Synkar bara ändrade objekt sedan senaste synk.', 'Syncs only changed objects since last sync.'),
            });

            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
                const latestStatus = syncStatuses.find(s => s.subtree_id === 'full');
                if (latestStatus?.sync_status === 'completed' || latestStatus?.sync_status === 'failed') {
                    clearInterval(pollInterval);
                    setIsSyncingAssets(false);
                    checkSyncStatus();
                }
            }, 3000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncingAssets(false);
                fetchSyncStatus();
                checkSyncStatus();
            }, 300000);

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Sync Failed",
                description: error.message,
            });
            setIsSyncingAssets(false);
        }
    };

    useEffect(() => {
        if (isOpen && !hasCheckedSync) {
            fetchSyncStatus();
            checkSyncStatus();
            fetchConfig();
            fetchSyncProgress();
            fetchFavoriteBuildings();
            fetchCongeriaData();
            setConnectionStatus('idle');
            setConnectionMessage('');
            setIsEditMode(false);
            setHasCheckedSync(true);
        }
        // Reset when modal closes
        if (!isOpen) {
            setHasCheckedSync(false);
        }
    }, [isOpen, hasCheckedSync]);

    // Realtime subscription for asset_sync_state changes
    useEffect(() => {
        if (!isOpen) return;

        const channel = supabase
            .channel('sync-settings-monitor')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'asset_sync_state'
            }, (payload) => {
                const newState = payload.new as SyncStatus;

                // Auto-refresh sync statuses and progress
                fetchSyncStatus();
                fetchSyncProgress();

                // If a sync completed or failed, refresh the full check and stop spinners
                if (newState?.sync_status === 'completed' || newState?.sync_status === 'failed') {
                    checkSyncStatus();

                    if (newState.subtree_id === 'structure') setIsSyncingStructure(false);
                    if (newState.subtree_id === 'assets') setIsSyncingAssets(false);
                    if (newState.subtree_id === 'xkt') setIsSyncingXkt(false);
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [isOpen]);

    // Listen for custom sync-completed events from DataConsistencyBanner
    useEffect(() => {
        if (!isOpen) return;

        const handleSyncCompleted = () => {
            fetchSyncStatus();
            checkSyncStatus();
        };

        window.addEventListener('asset-sync-completed', handleSyncCompleted);
        return () => {
            window.removeEventListener('asset-sync-completed', handleSyncCompleted);
        };
    }, [isOpen]);

    // Realtime subscription for asset_sync_progress (detailed progress data)
    useEffect(() => {
        if (!isOpen) return;

        const channel = supabase
            .channel('sync-progress-monitor')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'asset_sync_progress'
            }, () => {
                fetchSyncProgress();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [isOpen]);

    const handleCancelEdit = () => {
        if (originalConfig) {
            setConfig(originalConfig);
        }
        setIsEditMode(false);
    };

    // Geminus Base: Test connection
    const handleTestGeminusBaseConnection = async () => {
        setIsTestingGeminusBase(true);
        setGeminusBaseStatus('idle');
        setGeminusBaseMessage('');

        try {
            const { data, error } = await supabase.functions.invoke('geminus-base-query', {
                body: { action: 'test-connection' }
            });

            if (error) throw error;

            if (data?.success) {
                setGeminusBaseStatus('success');
                setGeminusBaseMessage(data.message || t('Anslutning lyckades', 'Connection successful'));
                toast({
                    title: t('Geminus Base ansluten', 'Geminus Base connected'),
                    description: data.message || t('Anslutningen till Geminus Base fungerar.', 'The Geminus Base connection is working.'),
                });
            } else {
                setGeminusBaseStatus('error');
                setGeminusBaseMessage(data?.error || t('Okänt fel', 'Unknown error'));
                toast({
                    variant: "destructive",
                    title: t('Anslutning misslyckades', 'Connection failed'),
                    description: data?.error || t('Kunde inte ansluta till Geminus Base.', 'Could not connect to Geminus Base.'),
                });
            }
        } catch (error: any) {
            setGeminusBaseStatus('error');
            setGeminusBaseMessage(error.message);
            toast({
                variant: "destructive",
                title: "Fel",
                description: error.message,
            });
        } finally {
            setIsTestingGeminusBase(false);
        }
    };

    // Geminus Base: Save credentials via edge function (uses service role → bypasses RLS)
    const handleSaveGeminusBaseConfig = async () => {
        setIsSavingGeminusBase(true);
        setGeminusBaseMessage('');
        try {
            // Save via edge function (service role bypasses RLS)
            const { data: saveData, error: saveError } = await supabase.functions.invoke('geminus-base-query', {
                body: {
                    action: 'save-api-config',
                    apiUrl: geminusBaseConfig.apiUrl,
                    username: geminusBaseConfig.username,
                    password: geminusBaseConfig.password,
                }
            });
            if (saveError) throw saveError;
            if (!saveData?.success) throw new Error(saveData?.error || 'Could not save credentials');
            if (saveData.id) setGeminusBaseProfileId(saveData.id);

            // Test connection
            const { data, error: testError } = await supabase.functions.invoke('geminus-base-query', {
                body: { action: 'test-connection' }
            });
            if (testError) throw testError;

            if (data?.success) {
                toast({ title: t('Geminus Base sparat', 'Geminus Base saved'), description: t('Credentials sparade och anslutning verifierad.', 'Credentials saved and connection verified.') });
                setGeminusBaseStatus('success');
                setGeminusBaseMessage(t('Anslutning OK — ', 'Connection OK — ') + (data.message || ''));
            } else {
                toast({ variant: 'destructive', title: t('Sparat men anslutning misslyckades', 'Saved but connection failed'), description: data?.error || t('Kontrollera URL och credentials.', 'Check URL and credentials.') });
                setGeminusBaseStatus('error');
                setGeminusBaseMessage(data?.error || t('Kontrollera credentials', 'Check credentials'));
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Error', description: err.message });
            setGeminusBaseStatus('error');
            setGeminusBaseMessage(err.message);
        } finally {
            setIsSavingGeminusBase(false);
        }
    };

    // Geminus Base: Smart bidirectional sync — auto-creates hierarchy, then syncs inventoried objects
    const handleSyncToGeminusBase = async () => {
        setIsSyncingGeminusBase(true);
        try {
            // 1. Test connection first
            const { data: connData, error: connError } = await supabase.functions.invoke('geminus-base-query', {
                body: { action: 'test-connection' }
            });
            if (connError || !connData?.success) {
                toast({ variant: 'destructive', title: t('Geminus Base ej ansluten', 'Geminus Base not connected'), description: connData?.error || connError?.message || t('Kunde inte ansluta.', 'Could not connect.') });
                setGeminusBaseStatus('error');
                return;
            }
            setGeminusBaseStatus('success');

            // 2. Find all unique building_fm_guids from assets
            const { data: allAssets, error: allError } = await supabase
                .from('assets')
                .select('fm_guid, building_fm_guid, created_in_model')
                .not('building_fm_guid', 'is', null);

            if (allError) throw allError;
            const allItems = allAssets || [];

            // Get unique building GUIDs
            const uniqueBuildingGuids = [...new Set(allItems.map(a => a.building_fm_guid).filter(Boolean))] as string[];
            console.log('[Geminus Base] Unique buildings to ensure hierarchy for:', uniqueBuildingGuids.length);

            // 3. Auto-create hierarchy for each building if needed
            const { ensureGeminusBaseHierarchy } = await import('@/services/geminus-base-service');
            let hierarchyCreated = 0;
            let hierarchySkipped = 0;
            for (let i = 0; i < uniqueBuildingGuids.length; i++) {
                const bldGuid = uniqueBuildingGuids[i];
                try {
                    const hResult = await ensureGeminusBaseHierarchy(bldGuid);
                    if (hResult.success && hResult.action === 'created') {
                        hierarchyCreated++;
                        console.log('[Geminus Base] Hierarchy created for building:', bldGuid, hResult.created);
                    } else {
                        hierarchySkipped++;
                    }
                } catch (e: any) {
                    console.error('[Geminus Base] Hierarchy error for', bldGuid, e.message);
                }
            }

            // 4. Sync inventoried assets (created_in_model = false)
            const fmAssets = allItems.filter(a => a.created_in_model === false);
            setGeminusBaseLocalCount(fmAssets.length);

            const { syncAssetWithGeminusBase } = await import('@/services/geminus-base-service');
            let created = 0;
            let updated = 0;
            let pulled = 0;
            let skipped = 0;
            let failed = 0;
            for (const asset of fmAssets) {
                try {
                    const result = await syncAssetWithGeminusBase(asset.fm_guid);
                    if (!result.success) { failed++; continue; }
                    if (result.action === 'created') created++;
                    else if (result.action === 'updated') updated++;
                    else if (result.action === 'pull' || result.pulled) pulled++;
                    else skipped++;
                } catch {
                    failed++;
                }
            }

            const now = new Date().toISOString();
            setGeminusBaseSyncResult({ success: created + updated + pulled + hierarchyCreated, failed, lastSync: now });

            const parts: string[] = [];
            if (hierarchyCreated > 0) parts.push(`${hierarchyCreated} buildings created`);
            if (created > 0) parts.push(`${created} objects created`);
            if (updated > 0) parts.push(`${updated} updated (push)`);
            if (pulled > 0) parts.push(`${pulled} updated (pull)`);
            if (skipped > 0) parts.push(`${skipped} already synced`);
            if (failed > 0) parts.push(`${failed} failed`);

            toast({
                title: t('Geminus Base-synk klar', 'Geminus Base sync complete'),
                description: parts.join(', ') || t('Inget att synka.', 'Nothing to sync.'),
            });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Sync error', description: error.message });
        } finally {
            setIsSyncingGeminusBase(false);
        }
    };

    // Geminus Base: Count inventoried assets (created_in_model=false) with FM link
    useEffect(() => {
        if (activeTab !== 'sync') return;
        const countFmAssets = async () => {
            try {
                // Use a simpler count query - head:true with count:'exact'
                const { count, error } = await supabase
                    .from('assets')
                    .select('fm_guid', { count: 'exact', head: true })
                    .not('building_fm_guid', 'is', null)
                    .eq('created_in_model', false);
                console.log('[Geminus Base] Inventoried asset count:', count, 'error:', error);
                if (!error) {
                    setGeminusBaseLocalCount(count ?? 0);
                } else {
                    // Fallback: do a regular query and count rows
                    const { data } = await supabase
                        .from('assets')
                        .select('fm_guid')
                        .not('building_fm_guid', 'is', null)
                        .eq('created_in_model', false)
                        .limit(5000);
                    setGeminusBaseLocalCount(data?.length ?? 0);
                }
            } catch (e) {
                console.error('[Geminus Base] Count error:', e);
            }
        };
        countFmAssets();
    }, [activeTab]);

    const handleSaveConfig = async () => {
        setIsSaving(true);
        try {
            const { data, error } = await supabase.functions.invoke('update-geminus-plus-config', {
                body: { action: 'update-config', config }
            });

            if (error) throw error;

            if (data?.secretsToUpdate && data.secretsToUpdate.length > 0) {
                toast({
                    title: "Update Secrets",
                    description: `The following secrets need to be updated in Lovable: ${data.secretsToUpdate.join(", ")}`,
                    duration: 10000,
                });
            }

            setIsEditMode(false);
            setOriginalConfig(config);
            
            toast({
                title: "Configuration Saved",
                description: "Values have been registered. Update secrets in Lovable to apply changes.",
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Save Error",
                description: error.message,
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestConnection = async () => {
        setIsTestingConnection(true);
        setConnectionStatus('idle');
        setConnectionMessage('');

        try {
            const { data, error } = await supabase.functions.invoke('update-geminus-plus-config', {
                body: { action: 'test-connection' }
            });

            if (error) throw error;

            if (data?.success) {
                setConnectionStatus('success');
                setConnectionMessage(data.message);
                toast({
                    title: "Connection Successful",
                    description: data.message,
                });
            } else {
                setConnectionStatus('error');
                setConnectionMessage(data?.error || 'Unknown error');
                toast({
                    variant: "destructive",
                    title: "Connection Failed",
                    description: data?.error,
                });
            }
        } catch (error: any) {
            setConnectionStatus('error');
            setConnectionMessage(error.message);
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message,
            });
        } finally {
            setIsTestingConnection(false);
        }
    };

    // Legacy full sync - uses assets sync state
    const handleTriggerSync = async () => {
        setIsSyncingAssets(true);
        try {
            supabase.functions.invoke('geminus-plus-sync', {
                body: { action: 'full-sync' }
            }).catch((err) => {
                console.log('Edge function call ended (may be timeout):', err?.message);
            });

            toast({
                title: "Sync Started",
                description: `Syncing data from Geminus Plus. This may take a few minutes for large datasets.`,
            });

            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
                const latestStatus = syncStatuses.find(s => s.subtree_id === 'full');
                if (latestStatus?.sync_status === 'completed' || latestStatus?.sync_status === 'failed') {
                    clearInterval(pollInterval);
                    setIsSyncingAssets(false);
                }
            }, 3000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncingAssets(false);
                fetchSyncStatus();
            }, 300000);

        } catch (error: any) {
            console.error('Sync error:', error);
            toast({
                variant: "destructive",
                title: "Sync Failed",
                description: error.message || "Could not start synchronization",
            });
            setIsSyncingAssets(false);
        }
    };

    const formatDate = (dateStr: string | null, fallbackDateStr?: string | null) => {
        const dateToUse = dateStr || fallbackDateStr;
        if (!dateToUse) return 'Never';
        
        const date = new Date(dateToUse);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit', 
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getSyncStatusBadge = (status: string) => {
        switch (status) {
            case 'completed':
                return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" />Complete</Badge>;
            case 'running':
                return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Syncing</Badge>;
            case 'failed':
                return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>;
            default:
                return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="fixed left-[50%] top-[50%] flex h-full max-h-dvh w-full max-w-full translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-none sm:h-[90vh] sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-[88rem] sm:rounded-lg">
                <DialogHeader className="flex-shrink-0 pr-8">
                    <DialogTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        App & API Settings
                    </DialogTitle>
                    <DialogDescription>
                        Manage application configurations and API connections.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 flex flex-1 min-h-0 flex-col overflow-hidden">
                    <TabsList className="flex h-auto w-full flex-shrink-0 flex-nowrap gap-0.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-x-visible">
                        <TabsTrigger value="apps" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <LayoutGrid className="h-3 w-3 sm:h-4 sm:w-4" />
                            Apps
                        </TabsTrigger>
                        <TabsTrigger value="apis" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Settings2 className="h-3 w-3 sm:h-4 sm:w-4" />
                            API
                        </TabsTrigger>
                        <TabsTrigger value="sync" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Database className="h-3 w-3 sm:h-4 sm:w-4" />
                            Sync
                        </TabsTrigger>
                        <TabsTrigger value="symbols" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Circle className="h-3 w-3 sm:h-4 sm:w-4" />
                            Symbols
                        </TabsTrigger>
                        <TabsTrigger value="viewer" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <View className="h-3 w-3 sm:h-4 sm:w-4" />
                            Viewer
                        </TabsTrigger>
                        <TabsTrigger value="assistants" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Bot className="h-3 w-3 sm:h-4 sm:w-4" />
                            AI Assistants
                        </TabsTrigger>
                        <TabsTrigger value="building" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Building2 className="h-3 w-3 sm:h-4 sm:w-4" />
                            Building
                        </TabsTrigger>
                        <TabsTrigger value="api-profiles" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Network className="h-3 w-3 sm:h-4 sm:w-4" />
                            API Profiles
                        </TabsTrigger>
                        <TabsTrigger value="tenants" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                            Customers
                        </TabsTrigger>
                    </TabsList>

                    {/* Profile Settings Tab */}
                    <TabsContent value="profile" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <ProfileSettings />
                    </TabsContent>

                    {/* Applications Settings Tab */}
                    <TabsContent value="apps" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-muted-foreground">
                                    Configure how external applications are launched and their credentials.
                                </p>
                                <Button
                                    onClick={handleSaveAppConfigs}
                                    disabled={isSavingApps}
                                    size="sm"
                                    className="gap-2"
                                >
                                    {isSavingApps ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Save className="h-4 w-4" />
                                    )}
                                    Save
                                </Button>
                            </div>
                            
                            <Accordion type="multiple" className="space-y-2">
                                {Object.entries(DEFAULT_APP_CONFIGS).map(([key, defaultCfg]: [string, any]) => {
                                    const cfg = appConfigs[key] || defaultCfg;
                                    const IconComp = getAppIcon(key);
                                    
                                    return (
                                        <AccordionItem key={key} value={key} className="border rounded-lg">
                                            <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                                <div className="flex items-center gap-2 flex-1">
                                                    <IconComp className="h-5 w-5 text-primary" />
                                                    <span className="font-medium">{cfg.label}</span>
                                                    <span className="text-xs text-muted-foreground ml-auto mr-2">
                                                        {cfg.openMode === 'external' ? 'New Tab' : 'In App'}
                                                    </span>
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent className="px-4 pb-4 pt-2">
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-end gap-2 pb-2 border-b">
                                                        <span className="text-xs text-muted-foreground">Open in new tab</span>
                                                        <Switch
                                                            checked={cfg.openMode === 'external'}
                                                            onCheckedChange={(checked) => {
                                                                setAppConfigs({
                                                                    ...appConfigs,
                                                                    [key]: { 
                                                                        ...cfg, 
                                                                        openMode: checked ? 'external' : 'internal' 
                                                                    }
                                                                });
                                                            }}
                                                        />
                                                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                                    </div>
                                                    
                                                    <div className="grid gap-3">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-sm font-medium">URL</Label>
                                                            <Input
                                                                value={cfg.url || ''}
                                                                onChange={(e) => {
                                                                    setAppConfigs({
                                                                        ...appConfigs,
                                                                        [key]: { ...cfg, url: e.target.value }
                                                                    });
                                                                }}
                                                                placeholder="https://app.example.com"
                                                                className="h-11 text-base"
                                                            />
                                                        </div>
                                                        <div className="grid grid-cols-1 gap-3">
                                                            <div className="space-y-1.5">
                                                                <Label className="text-sm font-medium">Username</Label>
                                                                <Input
                                                                    value={cfg.username || ''}
                                                                    onChange={(e) => {
                                                                        setAppConfigs({
                                                                            ...appConfigs,
                                                                            [key]: { ...cfg, username: e.target.value }
                                                                        });
                                                                    }}
                                                                    placeholder="user@example.com"
                                                                    className="h-11 text-base"
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <Label className="text-sm font-medium">Password</Label>
                                                                <Input
                                                                    type="password"
                                                                    value={cfg.password || ''}
                                                                    onChange={(e) => {
                                                                        setAppConfigs({
                                                                            ...appConfigs,
                                                                            [key]: { ...cfg, password: e.target.value }
                                                                        });
                                                                    }}
                                                                    placeholder="••••••••"
                                                                    className="h-11 text-base"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    );
                                })}
                            </Accordion>
                        </div>
                    </TabsContent>

                    <TabsContent value="apis" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        {isLoadingConfig ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                    API credentials are stored in the Geminus database. Click on sections below for details.
                                </p>
                                
                                <Accordion type="multiple" className="space-y-2">
                                    {/* Geminus Plus API Section */}
                                    <AccordionItem value="geminus-plus" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Box className="h-5 w-5 text-primary" />
                                                <span className="font-medium">Geminus Plus</span>
                                                <Badge variant="outline" className="ml-auto mr-2 text-xs">Configured</Badge>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <div className="space-y-4">
                                                <div className="flex items-center gap-2 mb-3">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setShowSecrets(!showSecrets)}
                                                        className="gap-1 h-7 text-xs"
                                                    >
                                                        {showSecrets ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                                        {showSecrets ? 'Hide' : 'Show'}
                                                    </Button>
                                                    {!isEditMode ? (
                                                        <Button variant="outline" size="sm" onClick={() => setIsEditMode(true)} className="gap-1 h-7 text-xs">
                                                            <Edit2 className="h-3 w-3" /> Edit
                                                        </Button>
                                                    ) : (
                                                        <>
                                                            <Button onClick={handleSaveConfig} disabled={isSaving} size="sm" className="gap-1 h-7 text-xs">
                                                                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                                                            </Button>
                                                            <Button onClick={handleCancelEdit} variant="ghost" size="sm" disabled={isSaving} className="h-7 text-xs">Cancel</Button>
                                                        </>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-sm">OpenID Token Endpoint</Label>
                                                        <Input value={config.keycloakUrl} onChange={(e) => setConfig(prev => ({ ...prev, keycloakUrl: e.target.value }))} placeholder="https://sso.example.com/..." disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-sm">API URL</Label>
                                                        <Input value={config.apiUrl} onChange={(e) => setConfig(prev => ({ ...prev, apiUrl: e.target.value }))} placeholder="https://api.example.com" disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-sm">Client ID</Label>
                                                        <Input value={config.clientId} onChange={(e) => setConfig(prev => ({ ...prev, clientId: e.target.value }))} placeholder="asset-api" disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-sm">Client Secret</Label>
                                                        <Input type={showSecrets ? "text" : "password"} value={isEditMode && config.clientSecret === '••••••••' ? '' : config.clientSecret} onChange={(e) => setConfig(prev => ({ ...prev, clientSecret: e.target.value }))} placeholder={isEditMode ? "New value..." : "••••••••"} disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-sm">Username</Label>
                                                        <Input value={config.username} onChange={(e) => setConfig(prev => ({ ...prev, username: e.target.value }))} placeholder="service-user@example.com" disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-sm">Password</Label>
                                                        <Input type={showSecrets ? "text" : "password"} value={isEditMode && config.password === '••••••••' ? '' : config.password} onChange={(e) => setConfig(prev => ({ ...prev, password: e.target.value }))} placeholder={isEditMode ? "New value..." : "••••••••"} disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                </div>
                                                <div className="flex items-end gap-3">
                                                    <div className="flex-1 space-y-1.5">
                                                        <Label className="text-sm">API Key</Label>
                                                        <Input type={showSecrets ? "text" : "password"} value={isEditMode && config.apiKey === '••••••••' ? '' : config.apiKey} onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))} placeholder={isEditMode ? "New value..." : "••••••••"} disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                    <Button onClick={handleTestConnection} disabled={isTestingConnection || isEditMode} variant="outline" className="gap-2 h-10">
                                                        {isTestingConnection ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                                                        {isTestingConnection ? 'Testing...' : 'Test'}
                                                    </Button>
                                                </div>
                                                {connectionStatus !== 'idle' && (
                                                    <div className={`rounded-lg border p-3 text-sm ${connectionStatus === 'success' ? 'bg-green-50 border-green-200 dark:bg-green-950/30' : 'bg-red-50 border-red-200 dark:bg-red-950/30'}`}>
                                                        <div className="flex items-start gap-2">
                                                            {connectionStatus === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
                                                            <div><p className="font-medium">{connectionStatus === 'success' ? 'Connection successful' : 'Connection failed'}</p><p className="text-xs">{connectionMessage}</p></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* Geminus Base API Section */}
                                    <AccordionItem value="geminus-base" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Building2 className="h-5 w-5 text-primary" />
                                                <span className="font-medium">Geminus Base</span>
                                                {geminusBaseStatus === 'success' && <Badge className="ml-auto mr-2 text-xs bg-green-100 text-green-800">Connected</Badge>}
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <div className="space-y-3">
                                                <div className="space-y-1.5">
                                                    <label className="text-xs font-medium text-muted-foreground">API URL</label>
                                                    <Input
                                                        placeholder="https://your-geminus-base.domain.com"
                                                        value={geminusBaseConfig.apiUrl}
                                                        onChange={e => setGeminusBaseConfig(c => ({ ...c, apiUrl: e.target.value }))}
                                                        className="h-8 text-sm"
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-xs font-medium text-muted-foreground">Användarnamn</label>
                                                    <Input
                                                        placeholder="user@example.com"
                                                        value={geminusBaseConfig.username}
                                                        onChange={e => setGeminusBaseConfig(c => ({ ...c, username: e.target.value }))}
                                                        className="h-8 text-sm"
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-xs font-medium text-muted-foreground">Lösenord</label>
                                                    <Input
                                                        type="password"
                                                        placeholder="••••••••"
                                                        value={geminusBaseConfig.password}
                                                        onChange={e => setGeminusBaseConfig(c => ({ ...c, password: e.target.value }))}
                                                        className="h-8 text-sm"
                                                    />
                                                </div>
                                                {geminusBaseMessage && (
                                                    <p className={`text-xs ${geminusBaseStatus === 'success' ? 'text-green-600' : 'text-destructive'}`}>
                                                        {geminusBaseMessage}
                                                    </p>
                                                )}
                                                <div className="flex gap-2 pt-1">
                                                    <Button
                                                        size="sm"
                                                        onClick={handleSaveGeminusBaseConfig}
                                                        disabled={isSavingGeminusBase || !geminusBaseConfig.apiUrl || !geminusBaseConfig.username || !geminusBaseConfig.password}
                                                    >
                                                        {isSavingGeminusBase ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                                                        Spara
                                                    </Button>
                                                    <Button variant="outline" size="sm" onClick={handleTestGeminusBaseConnection} disabled={isTestingGeminusBase}>
                                                        {isTestingGeminusBase ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                                                        Test connection
                                                    </Button>
                                                </div>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* Ivion API Section */}
                                    <AccordionItem value="ivion" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <View className="h-5 w-5 text-primary" />
                                                <span className="font-medium">Ivion (360+)</span>
                                                {ivionConnectionStatus === 'connected' ? (
                                                    <Badge className="ml-auto mr-2 text-xs bg-green-100 text-green-800 border-green-200">Connected</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="ml-auto mr-2 text-xs">Not Connected</Badge>
                                                )}
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <div className="space-y-4">
                                                <p className="text-xs text-muted-foreground">
                                                    Integration with NavVis IVION for 360° panoramas. Uses OAuth mandate-based authentication.
                                                </p>
                                                
                                                {/* OAuth Connect Button */}
                                                <div className="p-3 bg-muted/50 rounded-lg border">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-sm font-medium">Authentication</span>
                                                        {ivionConnectionStatus === 'connected' && (
                                                            <Badge className="bg-green-600 text-xs gap-1">
                                                                <CheckCircle2 className="h-3 w-3" />
                                                                Active
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mb-3">
                                                        Connect using NavVis OAuth to obtain access tokens. Tokens are cached for automatic renewal.
                                                    </p>
                                                    <Button 
                                                        onClick={() => setIsIvionModalOpen(true)}
                                                        variant="outline"
                                                        size="sm"
                                                        className="gap-2"
                                                    >
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                        {ivionConnectionStatus === 'connected' ? 'Reconnect to NavVis' : 'Connect with NavVis OAuth'}
                                                    </Button>
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs">Embed URL for Ivion</Label>
                                                    <div className="flex gap-2">
                                                        <Input value={`${window.location.origin}/ivion-create`} readOnly className="h-8 text-sm font-mono bg-muted" />
                                                        <Button variant="outline" size="sm" className="h-8" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/ivion-create`); toast({ title: 'Copied!' }); }}>
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                                
                                                <Button variant="outline" size="sm" onClick={async () => {
                                                    try {
                                                        const { data, error } = await supabase.functions.invoke('ivion-poi', { body: { action: 'test-connection' } });
                                                        if (error) throw error;
                                                        if (data?.success) {
                                                            setIvionConnectionStatus('connected');
                                                        }
                                                        toast({ title: data?.success ? 'Connection OK' : 'Failed', description: data?.message });
                                                    } catch (err: any) { 
                                                        setIvionConnectionStatus('error');
                                                        toast({ variant: 'destructive', title: 'Error', description: err.message }); 
                                                    }
                                                }}>
                                                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Test Connection
                                                </Button>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* Geminus Premium API Section */}
                                    <AccordionItem value="geminus-premium" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Zap className="h-5 w-5 text-yellow-500" />
                                                <span className="font-medium">Geminus Premium</span>
                                                <Badge variant="outline" className="ml-auto mr-2 text-xs bg-green-50 text-green-700 border-green-200">IoT</Badge>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <div className="space-y-4">
                                                <p className="text-xs text-muted-foreground">
                                                    IoT sensors and measurements from Geminus Premium (InUse). Secrets (GEMINUS_PREMIUM_API_URL, GEMINUS_PREMIUM_EMAIL, GEMINUS_PREMIUM_PASSWORD) are configured in Lovable Cloud.
                                                </p>
                                                
                                                {/* Polling interval setting */}
                                                <div className="space-y-2">
                                                    <Label className="text-sm font-medium">Polling Interval</Label>
                                                    <select 
                                                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                                                        value={appConfigs.iot?.pollIntervalHours ?? 24}
                                                        onChange={(e) => {
                                                            setAppConfigs({
                                                                ...appConfigs,
                                                                iot: { 
                                                                    ...appConfigs.iot, 
                                                                    pollIntervalHours: parseInt(e.target.value) 
                                                                }
                                                            });
                                                        }}
                                                    >
                                                        {GEMINUS_PREMIUM_POLL_OPTIONS.map(opt => (
                                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <p className="text-xs text-muted-foreground">
                                                        How often sensor data should be fetched automatically. Default is every 24 hours.
                                                    </p>
                                                </div>

                                                <div className="flex gap-2">
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        onClick={async () => {
                                                            try {
                                                                const { data, error } = await supabase.functions.invoke('geminus-premium-query', { 
                                                                    body: { action: 'test-connection' } 
                                                                });
                                                                if (error) throw error;
                                                                toast({ 
                                                                    title: data?.success ? 'Connection OK' : 'Failed',
                                                                    description: data?.message || data?.error
                                                                });
                                                            } catch (err: any) {
                                                                toast({
                                                                    variant: 'destructive',
                                                                    title: 'Error',
                                                                    description: err.message
                                                                });
                                                            }
                                                        }}
                                                    >
                                                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Test connection
                                                    </Button>
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        onClick={async () => {
                                                            try {
                                                                const { data, error } = await supabase.functions.invoke('geminus-premium-query', { 
                                                                    body: { action: 'get-sites' } 
                                                                });
                                                                if (error) throw error;
                                                                const count = Array.isArray(data?.data) ? data.data.length : 0;
                                                                toast({
                                                                    title: 'Data fetched',
                                                                    description: `Found ${count} sites in Geminus Premium.`
                                                                });
                                                            } catch (err: any) { 
                                                                toast({
                                                                    variant: 'destructive',
                                                                    title: 'Error',
                                                                    description: err.message
                                                                });
                                                            }
                                                        }}
                                                    >
                                                        <Database className="h-3.5 w-3.5 mr-1.5" /> Fetch data now
                                                    </Button>
                                                </div>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* Faciliate API Section */}
                                    <AccordionItem value="faciliate" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50" onClick={() => { loadFacilitateStats(); checkConnectorStatus(); }}>
                                            <div className="flex items-center gap-2 flex-1">
                                                <Wrench className="h-5 w-5 text-orange-500" />
                                                <span className="font-medium">Faciliate</span>
                                                {facilitateCacheStats && facilitateCacheStats.total > 0
                                                    ? <Badge variant="outline" className="ml-auto mr-2 text-xs bg-green-50 text-green-700 border-green-200">{facilitateCacheStats.total.toLocaleString()} records</Badge>
                                                    : <Badge variant="outline" className="ml-auto mr-2 text-xs bg-orange-50 text-orange-700 border-orange-200">FM System</Badge>}
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <div className="space-y-4">
                                                <p className="text-xs text-muted-foreground">
                                                    Faciliate is a locally installed FM system. Synchronization runs via a local connector server on your computer inside the SWG VPN.
                                                </p>

                                                {/* Connector server status */}
                                                <div className="rounded-lg border p-3 space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <div className={`h-2 w-2 rounded-full ${connectorStatus === 'online' ? 'bg-green-500' : connectorStatus === 'offline' ? 'bg-red-400' : 'bg-gray-300'}`} />
                                                            <span className="text-sm font-medium">
                                                                {connectorStatus === 'online' ? 'Connector online' : connectorStatus === 'offline' ? 'Connector offline' : 'Status okänd'}
                                                            </span>
                                                        </div>
                                                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={checkConnectorStatus}>
                                                            <RefreshCw className="h-3 w-3" /> {t('Kontrollera', 'Check')}
                                                        </Button>
                                                    </div>
                                                    {connectorStatus === 'offline' && (
                                                        <div className="rounded bg-muted p-2">
                                                            <p className="text-[10px] text-muted-foreground mb-1">{t('Starta connectorn (kräver VPN):', 'Start the connector (requires VPN):')}</p>
                                                            <div className="flex items-center gap-1.5">
                                                                <code className="text-[10px] font-mono flex-1">cd faciliate-connector &amp;&amp; node connector.mjs serve</code>
                                                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] shrink-0"
                                                                    onClick={() => { navigator.clipboard.writeText('cd faciliate-connector && node connector.mjs serve'); toast({ title: t('Kopierat!', 'Copied!') }); }}>
                                                                    {t('Kopiera', 'Copy')}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Building selector + sync */}
                                                {connectorStatus === 'online' && (
                                                    <div className="space-y-3">
                                                        <div className="flex gap-2">
                                                            <div className="flex-1 space-y-1">
                                                                <Label className="text-xs">Byggnad</Label>
                                                                {facilitateBuildings.length > 0 ? (
                                                                    <select
                                                                        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                                                                        value={selectedFacBuildingId}
                                                                        onChange={e => {
                                                                            const b = facilitateBuildings.find(x => x.id === e.target.value);
                                                                            setSelectedFacBuildingId(e.target.value);
                                                                            setSelectedFacBuildingName(b?.name || '');
                                                                        }}
                                                                    >
                                                                        <option value="">{t('Välj byggnad…', 'Select building…')}</option>
                                                                        {facilitateBuildings.map(b => <option key={b.id} value={b.id}>{b.name} ({b.id})</option>)}
                                                                    </select>
                                                                ) : (
                                                                    <div className="flex gap-2">
                                                                        <Input placeholder="Byggnads-ID (t.ex. S1)" value={selectedFacBuildingId} onChange={e => setSelectedFacBuildingId(e.target.value)} className="h-9 text-sm" />
                                                                        <Input placeholder="Namn (t.ex. Småviken)" value={selectedFacBuildingName} onChange={e => setSelectedFacBuildingName(e.target.value)} className="h-9 text-sm" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {facilitateBuildings.length === 0 && (
                                                                <Button variant="outline" size="sm" className="self-end h-9 text-xs gap-1" onClick={fetchFacilitateBuildings}>
                                                                    <Database className="h-3 w-3" /> {t('Hämta', 'Fetch')}
                                                                </Button>
                                                            )}
                                                        </div>

                                                        <div className="space-y-1">
                                                            <Label className="text-xs">{t('Objekttyper', 'Object types')}</Label>
                                                            <div className="flex gap-3">
                                                                {[[`workorder`, t('Arbetsordrar', 'Work orders')], [`rentlandlord`, t('Hyreskontrakt', 'Lease contracts')], [`maintenance`, t('Underhåll', 'Maintenance')]].map(([val, lbl]) => (
                                                                    <label key={val} className="flex items-center gap-1.5 text-xs cursor-pointer">
                                                                        <input type="checkbox" checked={facilitateSyncTypes.includes(val)}
                                                                            onChange={e => setFacilitateSyncTypes(prev => e.target.checked ? [...prev, val] : prev.filter(t => t !== val))}
                                                                            className="h-3.5 w-3.5" />
                                                                        {lbl}
                                                                    </label>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <Button
                                                            onClick={startFacilitateSync}
                                                            disabled={isFacilitiateSyncing || !selectedFacBuildingId}
                                                            className="w-full gap-2"
                                                            size="sm"
                                                        >
                                                            {isFacilitiateSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                                            {isFacilitiateSyncing ? t('Synkar…', 'Syncing…') : t('Synka nu', 'Sync now')}
                                                        </Button>

                                                        {facilitateSyncLog.length > 0 && (
                                                            <div className="rounded border bg-muted/50 p-2 max-h-32 overflow-y-auto space-y-0.5">
                                                                {facilitateSyncLog.map((line, i) => (
                                                                    <p key={i} className="text-[11px] font-mono text-muted-foreground">{line}</p>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Cache status */}
                                                {facilitateCacheStats && facilitateCacheStats.total > 0 && (
                                                    <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t('Cachestatus', 'Cache status')}</p>
                                                        {Object.entries(facilitateCacheStats.byType).map(([type, count]) => (
                                                            <div key={type} className="flex items-center justify-between text-sm">
                                                                <span className="text-muted-foreground">{type === 'workorder' ? t('Arbetsordrar', 'Work orders') : type === 'rentlandlord' ? t('Hyreskontrakt', 'Lease contracts') : type === 'maintenance' ? t('Planerat underhåll', 'Planned maintenance') : type}</span>
                                                                <span className="font-medium">{(count as number).toLocaleString()}</span>
                                                            </div>
                                                        ))}
                                                        {facilitateCacheStats.byBuilding.filter(b => b.building_name || b.building_id).slice(0, 6).map((b, i) => (
                                                            <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                                                                <span className="truncate max-w-[65%]">↳ {b.building_name || b.building_id}</span>
                                                                <span>{b.count.toLocaleString()}</span>
                                                            </div>
                                                        ))}
                                                        {facilitateCacheStats.lastSynced && (
                                                            <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-1.5 mt-1.5">
                                                                <span>{t('Senast synkad', 'Last synced')}</span>
                                                                <span>{new Date(facilitateCacheStats.lastSynced).toLocaleString('sv-SE')}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs text-muted-foreground" onClick={loadFacilitateStats} disabled={isLoadingFacilitateStats}>
                                                    {isLoadingFacilitateStats ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                    {t('Uppdatera cachestatus', 'Refresh cache status')}
                                                </Button>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* Autodesk Forma Section */}
                                    <AccordionItem value="acc" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Layers className="h-5 w-5 text-blue-500" />
                                                <span className="font-medium">Autodesk Forma</span>
                                                {accAuthStatus === 'authenticated' && <Badge className="ml-auto mr-2 text-xs bg-green-100 text-green-800 border-green-200">Inloggad</Badge>}
                                                {accAuthStatus === 'unauthenticated' && accConnectionStatus === 'success' && <Badge className="ml-auto mr-2 text-xs bg-yellow-100 text-yellow-800 border-yellow-200">App-token</Badge>}
                                                {accAuthStatus === 'unauthenticated' && accConnectionStatus === 'idle' && <Badge variant="outline" className="ml-auto mr-2 text-xs">Autodesk Forma</Badge>}
                                                {accAuthStatus === 'checking' && <Loader2 className="ml-auto mr-2 h-3.5 w-3.5 animate-spin" />}
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <div className="space-y-4">
                                                <p className="text-xs text-muted-foreground">
                                                    Connect to Autodesk Forma. Log in with your Autodesk account to give the app access to your Forma projects.
                                                </p>

                                                {/* APS App Credentials */}
                                                <div className="rounded-lg border p-3 space-y-3">
                                                    <Label className="text-sm font-medium">App Credentials (APS Client ID &amp; Secret)</Label>
                                                    <p className="text-xs text-muted-foreground">
                                                        Register an app at Autodesk Platform Services (APS) and enter the Client ID and Secret below. Required for OAuth login to work.
                                                    </p>
                                                    <div className="space-y-2">
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Client ID</Label>
                                                            <Input
                                                                value={apsClientId}
                                                                onChange={e => { setApsClientId(e.target.value); setApsCredentialsSaved(false); }}
                                                                placeholder="Enter APS Client ID"
                                                                className="h-8 text-sm font-mono"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs text-muted-foreground">Client Secret</Label>
                                                            <Input
                                                                type="password"
                                                                value={apsClientSecret}
                                                                onChange={e => { setApsClientSecret(e.target.value); setApsCredentialsSaved(false); }}
                                                                placeholder="Enter APS Client Secret"
                                                                className="h-8 text-sm font-mono"
                                                            />
                                                        </div>
                                                        <Button
                                                            size="sm"
                                                            onClick={handleSaveApsCredentials}
                                                            disabled={isSavingApsCredentials || (!apsClientId.trim() || !apsClientSecret.trim())}
                                                            className="gap-1.5"
                                                        >
                                                            {isSavingApsCredentials
                                                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                : apsCredentialsSaved
                                                                    ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                                                    : null}
                                                            {apsCredentialsSaved ? 'Saved' : 'Save credentials'}
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* Autodesk Login Section */}
                                                <div className="rounded-lg border p-3 space-y-3">
                                                    <Label className="text-sm font-medium">Autodesk Login (3-legged OAuth)</Label>
                                                    {accAuthStatus === 'authenticated' ? (
                                                        <div className="flex items-center gap-2">
                                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                            <span className="text-sm text-green-700 dark:text-green-400">{t('Inloggad med Autodesk-konto', 'Logged in with Autodesk account')}</span>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={handleAutodeskLogout}
                                                                disabled={isAccLoggingOut}
                                                                className="ml-auto"
                                                            >
                                                                {isAccLoggingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('Logga ut', 'Log out')}
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            <Button
                                                                onClick={handleAutodeskLogin}
                                                                disabled={isAccLoggingIn}
                                                                size="sm"
                                                                className="gap-1.5"
                                                            >
                                                                {isAccLoggingIn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <User className="h-3.5 w-3.5" />}
                                                                {t('Logga in med Autodesk', 'Log in with Autodesk')}
                                                            </Button>
                                                            <div className="rounded border bg-muted/50 px-2 py-1.5 space-y-1">
                                                                <p className="text-xs text-muted-foreground">Register this exact callback URL in your APS app:</p>
                                                                <div className="flex items-center gap-1">
                                                                    <code className="text-xs font-mono break-all flex-1">{window.location.origin}/auth/autodesk/callback</code>
                                                                    <Button variant="ghost" size="sm" className="h-6 px-1.5 shrink-0" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/auth/autodesk/callback`); toast({ title: 'Copied' }); }}>
                                                                        <Copy className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Hub/Account selector — auto-discovered via API */}
                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-sm font-medium">{t('Konto (Hub)', 'Account (Hub)')}</Label>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={handleFetchHubs}
                                                            disabled={isLoadingHubs}
                                                            className="h-7 text-xs gap-1"
                                                        >
                                                            {isLoadingHubs ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                            {accHubs.length === 0 ? 'Fetch accounts' : 'Refresh'}
                                                        </Button>
                                                    </div>
                                                    {accHubs.length > 0 ? (
                                                        <select
                                                            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                                                            value={selectedHubId}
                                                            onChange={(e) => {
                                                                const hub = accHubs.find(h => h.id === e.target.value);
                                                                setSelectedHubId(e.target.value);
                                                                if (hub) {
                                                                    setAccRegion(hub.region === 'EMEA' ? 'EMEA' : 'US');
                                                                    setAccProjects([]);
                                                                    setAccFolders(null);
                                                                }
                                                            }}
                                                        >
                                                            {accHubs.map((hub: any) => (
                                                                <option key={hub.id} value={hub.id}>
                                                                    {hub.name} ({hub.region || 'US'})
                                                                </option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <p className="text-xs text-muted-foreground">
                                                            Click "Fetch accounts" to auto-discover your Autodesk accounts and regions. Region is set automatically.
                                                        </p>
                                                    )}
                                                    {selectedHubId && (
                                                        <p className="text-xs text-muted-foreground">
                                                            Region: <span className="font-medium">{accRegion}</span>
                                                        </p>
                                                    )}
                                                </div>

                                                {accProjects.length > 0 && (
                                                    <div className="space-y-2">
                                                        <Label className="text-sm font-medium">Select Autodesk Forma project</Label>
                                                        <select
                                                            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                                                            value={selectedAccProjectId}
                                                            onChange={(e) => setSelectedAccProjectId(e.target.value)}
                                                        >
                                                            {accProjects.map((p: any) => (
                                                                <option key={p.id} value={p.id}>
                                                                    {p.name} ({p.status || 'active'})
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}

                                                {/* Manual project ID input */}
                                                <div className="space-y-2">
                                                    <Label className="text-sm font-medium text-muted-foreground">Project ID</Label>
                                                    <div className="flex gap-2">
                                                        <Input
                                                            placeholder={t('Klistra in Autodesk Forma projekt-ID (GUID)', 'Paste Autodesk Forma project ID (GUID)')}
                                                            value={manualAccProjectId}
                                                            onChange={(e) => setManualAccProjectId(e.target.value)}
                                                            className="font-mono text-xs"
                                                        />
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={handleFetchAccProjects}
                                                            disabled={isLoadingAccProjects || !selectedHubId}
                                                            className="shrink-0"
                                                        >
                                                            {isLoadingAccProjects ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
                                                        </Button>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        Select a project from the dropdown or enter an ID manually.
                                                    </p>
                                                </div>

                                                {/* Primary action: Visa mappar */}
                                                {(selectedAccProjectId || manualAccProjectId.trim()) && (
                                                    <Button
                                                        onClick={handleFetchAccFolders}
                                                        disabled={isLoadingAccFolders}
                                                        size="sm"
                                                        className="gap-1.5 w-full"
                                                    >
                                                        {isLoadingAccFolders ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                                                        {accFolders !== null ? t('Uppdatera mappar', 'Refresh folders') : t('Visa mappar', 'Show folders')}
                                                    </Button>
                                                )}

                                                {/* Advanced / secondary actions */}
                                                {(selectedAccProjectId || manualAccProjectId.trim()) && (
                                                    <Accordion type="single" collapsible className="w-full">
                                                        <AccordionItem value="advanced" className="border rounded-lg">
                                                            <AccordionTrigger className="px-3 py-2 hover:no-underline hover:bg-muted/50 text-xs text-muted-foreground">
                                                                <div className="flex items-center gap-1.5">
                                                                    <Settings2 className="h-3.5 w-3.5" />
                                                                    More actions
                                                                </div>
                                                            </AccordionTrigger>
                                                            <AccordionContent className="px-3 pb-3 pt-1">
                                                                <div className="flex gap-2 flex-col sm:flex-row sm:flex-wrap">
                                                                    <Button
                                                                        onClick={handleSyncAccLocations}
                                                                        disabled={isSyncingAccLocations || isSyncingAccAssets}
                                                                        size="sm"
                                                                        variant="outline"
                                                                        className="gap-1 w-full sm:w-auto"
                                                                    >
                                                                        {isSyncingAccLocations ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
                                                                        Sync places
                                                                    </Button>
                                                                    <Button
                                                                        onClick={handleSyncAccAssets}
                                                                        disabled={isSyncingAccLocations || isSyncingAccAssets}
                                                                        size="sm"
                                                                        variant="outline"
                                                                        className="gap-1 w-full sm:w-auto"
                                                                    >
                                                                        {isSyncingAccAssets ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                                                                        Sync assets
                                                                    </Button>
                                                                    <Button
                                                                        onClick={handleTestAccConnection}
                                                                        disabled={isTestingAcc}
                                                                        size="sm"
                                                                        variant="outline"
                                                                        className="gap-1 w-full sm:w-auto"
                                                                    >
                                                                        {isTestingAcc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                                                                        Test connection
                                                                    </Button>
                                                                    <Button
                                                                        onClick={handleCheckAccStatus}
                                                                        disabled={isCheckingAccStatus}
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        className="gap-1 w-full sm:w-auto"
                                                                    >
                                                                        {isCheckingAccStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                                                        Status
                                                                    </Button>
                                                                </div>
                                                            </AccordionContent>
                                                        </AccordionItem>
                                                    </Accordion>
                                                )}

                                                {/* Hint banner when ACC has no locations */}
                                                {accLocationsHint && (
                                                    <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 p-3 flex gap-2 items-start">
                                                        <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                                                        <div className="space-y-1">
                                                            <p className="text-sm text-blue-800 dark:text-blue-200">{accLocationsHint}</p>
                                                            <Button
                                                                variant="link"
                                                                size="sm"
                                                                className="h-auto p-0 text-blue-600 dark:text-blue-400"
                                                                onClick={() => { setAccLocationsHint(null); handleFetchAccFolders(); }}
                                                            >
                                                                <FolderOpen className="h-3.5 w-3.5 mr-1" />
                                                                Visa mappar nu
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Building selector — link import to a Geminus building */}
                                                <div className="rounded-lg border p-3 space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-sm font-medium flex items-center gap-1.5">
                                                            <Building2 className="h-4 w-4 text-blue-500" />
                                                            {t('Koppla till byggnad', 'Link to building')}
                                                        </Label>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={fetchAccBuildings}
                                                            disabled={isLoadingAccBuildings}
                                                            className="h-7 text-xs gap-1"
                                                        >
                                                            {isLoadingAccBuildings ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                            {accBuildings.length === 0 ? t('Hämta byggnader', 'Load buildings') : t('Uppdatera', 'Refresh')}
                                                        </Button>
                                                    </div>
                                                    {accBuildings.length > 0 ? (
                                                        <select
                                                            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                                                            value={accTargetBuildingFmGuid}
                                                            onChange={(e) => setAccTargetBuildingFmGuid(e.target.value)}
                                                        >
                                                            <option value="">{t('— Välj byggnad —', '— Select building —')}</option>
                                                            {accBuildings.map((b) => (
                                                                <option key={b.fm_guid} value={b.fm_guid}>{b.name}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <p className="text-xs text-muted-foreground">
                                                            {t('Klicka "Hämta byggnader" för att välja vilken byggnad importen ska kopplas till.', 'Click "Load buildings" to choose which building the import links to.')}
                                                        </p>
                                                    )}
                                                    {accTargetBuildingFmGuid && (
                                                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                                                            {accTargetBuildingFmGuid}
                                                        </p>
                                                    )}
                                                    <p className="text-[10px] text-muted-foreground">
                                                        {t('Markera radio "A" vid den fil som är A-modellen — den skapar våningsplan och rum. Övriga modeller matchar automatiskt mot A-modellens plan.', 'Mark radio "A" on the architecture model — it creates floors and rooms. Other models match automatically.')}
                                                    </p>
                                                </div>

                                                {/* ACC Folder Browser */}
                                                {accFolders !== null && (
                                                    <>
                                                    <ConversionProgressOverlay translationStatuses={translationStatuses} />
                                                    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-sm font-medium flex items-center gap-1.5">
                                                                <FolderOpen className="h-4 w-4" />
                                                                {accRootFolderName || t('Mappar', 'Folders')}
                                                            </Label>
                                                            <span className="text-xs text-muted-foreground">{accFolders.length} {t('mappar', 'folders')}</span>
                                                        </div>
                                                        
                                                        {accFolders.length === 0 && accTopLevelItems.length === 0 && (
                                                            <p className="text-xs text-muted-foreground italic">No folders or files found.</p>
                                                        )}

                                                        <div className="space-y-1 max-h-[50vh] sm:max-h-96 overflow-y-auto overflow-x-hidden">
                                                            {accFolders.map((folder: any) => (
                                                                <AccFolderNode
                                                                    key={folder.id}
                                                                    folder={folder}
                                                                    depth={0}
                                                                    expandedFolders={expandedFolders}
                                                                    toggleFolder={toggleFolder}
                                                                    syncingBimFolderId={syncingBimFolderId}
                                                                    bimSyncProgress={bimSyncProgress}
                                                                    handleSyncBimData={handleSyncBimData}
                                                                    formatFileSize={formatFileSize}
                                                                    selectedBimFiles={selectedBimFiles}
                                                                    toggleBimFile={toggleBimFile}
                                                                    translationStatuses={translationStatuses}
                                                                    onTranslate3D={handleTranslate3D}
                                                                    masterModelUrn={accMasterModelUrn}
                                                                    setMasterModelUrn={setAccMasterModelUrn}
                                                                />
                                                            ))}

                                                            {accTopLevelItems.length > 0 && (
                                                                <div className="pt-1 border-t">
                                                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide px-2.5 py-1">Files in root folder</p>
                                                                    {accTopLevelItems.map((item: any) => (
                                                                        <div key={item.id} className="flex items-center gap-2 text-xs py-1 px-2.5 rounded hover:bg-muted/50">
                                                                            <File className="h-3 w-3 text-muted-foreground shrink-0" />
                                                                            <span className="truncate">{item.name}</span>
                                                                            <span className="ml-auto text-muted-foreground shrink-0 uppercase text-[10px]">{item.type}</span>
                                                                            {item.size && <span className="text-muted-foreground shrink-0 text-[10px]">{formatFileSize(item.size)}</span>}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    </>
                                                )}
                                                {accStatus && (
                                                    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                                                        <div className="flex items-center justify-between text-sm">
                                                            <span className="text-muted-foreground">Locations (local):</span>
                                                            <span className="font-medium">{accStatus.localLocationCount}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between text-sm">
                                                            <span className="text-muted-foreground">Assets (local):</span>
                                                            <span className="font-medium">{accStatus.localAssetCount}</span>
                                                        </div>
                                                        {accStatus.locationsSyncState && (
                                                            <div className="flex items-center justify-between text-sm">
                                                                <span className="text-muted-foreground">Location sync:</span>
                                                                <span className="font-medium">{accStatus.locationsSyncState.sync_status}</span>
                                                            </div>
                                                        )}
                                                        {accStatus.assetsSyncState && (
                                                            <div className="flex items-center justify-between text-sm">
                                                                <span className="text-muted-foreground">Asset sync:</span>
                                                                <span className="font-medium">{accStatus.assetsSyncState.sync_status}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="sync" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <Accordion type="multiple" className="space-y-2">
                            {/* ACC -> Geminus Plus Sync */}
                            <AccordionItem value="acc-to-geminus-plus" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Box className="h-4 w-4 text-primary" />
                                        <span>Sync to Geminus Plus</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="space-y-3 pb-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs text-muted-foreground">
                                                Create Autodesk Forma-synced objects in Geminus Plus with generated UUIDs. Buildings, floors, rooms and installations are created hierarchically.
                                            </p>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleCheckAccToGeminusPlus}
                                                disabled={isCheckingAccToAp}
                                                className="h-7 text-xs gap-1 ml-2 shrink-0"
                                            >
                                                {isCheckingAccToAp ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                Status
                                            </Button>
                                        </div>

                                        {accToApStatus && (
                                            <div className="space-y-1.5 text-sm">
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Total Autodesk Forma objects:</span>
                                                    <span className="font-medium">{accToApStatus.totalAccObjects}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Synced to Geminus Plus:</span>
                                                    <span className="font-medium">{accToApStatus.syncedToGeminusPlus}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Not synced:</span>
                                                    <Badge variant={accToApStatus.unsyncedCount > 0 ? "destructive" : "secondary"} className="text-xs">
                                                        {accToApStatus.unsyncedCount}
                                                    </Badge>
                                                </div>
                                                {accToApStatus.buildings?.length > 0 && (
                                                    <div className="mt-2 space-y-1">
                                                        <p className="text-xs font-medium text-muted-foreground">Buildings:</p>
                                                        {accToApStatus.buildings.map((b: any) => (
                                                            <div key={b.accFmGuid} className="flex items-center justify-between text-xs py-0.5">
                                                                <span className="truncate">{b.name}</span>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-muted-foreground">{b.childCount} obj</span>
                                                                    {b.synced ? (
                                                                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                                                                    ) : (
                                                                        <Circle className="h-3 w-3 text-muted-foreground" />
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <Button
                                            onClick={handleSyncAccToGeminusPlus}
                                            disabled={isSyncingAccToAp}
                                            size="sm"
                                            className="w-full gap-1.5"
                                        >
                                            {isSyncingAccToAp ? (
                                                <>
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    Syncing to Geminus Plus...
                                                </>
                                            ) : (
                                                <>
                                                    <Box className="h-3.5 w-3.5" />
                                                    Sync Autodesk Forma → Geminus Plus
                                                </>
                                            )}
                                        </Button>

                                        {accToApResult && (
                                            <div className={`rounded-lg border p-2.5 text-xs space-y-1 ${accToApResult.success ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800'}`}>
                                                <p className="font-medium">{accToApResult.success ? 'Sync succeeded' : 'Sync with warnings'}</p>
                                                {accToApResult.summary && (
                                                    <div className="space-y-0.5">
                                                        <p>Buildings: {accToApResult.summary.created?.buildings || 0} created</p>
                                                        <p>Floors: {accToApResult.summary.created?.levels || 0} | Rooms: {accToApResult.summary.created?.spaces || 0} | Instances: {accToApResult.summary.created?.instances || 0}</p>
                                                        <p>Relationships: {accToApResult.summary.totalRelationships || 0} | Properties: {accToApResult.summary.totalPropertiesUpdated || 0}</p>
                                                        {accToApResult.summary.totalErrors > 0 && (
                                                            <p className="text-red-600 dark:text-red-400">Errors: {accToApResult.summary.totalErrors}</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            {/* Geminus Plus Sync */}
                            <AccordionItem value="geminus-plus-sync" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Box className="h-4 w-4 text-primary" />
                                        <span>Geminus Plus Sync</span>
                                        {syncCheck && (
                                            <Badge variant="outline" className="ml-auto mr-2 text-xs">
                                                {syncCheck.total?.localCount?.toLocaleString() || assetCount.toLocaleString()} objects
                                                {syncCheck.total?.accExcluded ? ` (+${syncCheck.total.accExcluded.toLocaleString()} ACC/IFC)` : ''}
                                            </Badge>
                                        )}
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-end">
                                            <Button
                                                onClick={checkSyncStatus}
                                                disabled={isCheckingSync}
                                                size="sm"
                                                variant="outline"
                                                className="gap-1 h-8 text-xs"
                                            >
                                                {isCheckingSync ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                Check Status
                                            </Button>
                                        </div>

                                        <SyncProgressCard
                                            icon={<Building2 className="h-5 w-5 text-primary" />}
                                            title="Buildings/Floors/Rooms"
                                            subtitle={syncCheck?.structure?.accLocalCount 
                                                ? `Geminus Plus scope (${syncCheck.structure.accLocalCount} ACC/IFC objects excluded)` 
                                                : 'Buildings, floors and rooms'}
                                            localCount={syncCheck?.structure?.localCount || 0}
                                            remoteCount={syncCheck?.structure?.remoteCount}
                                            inSync={syncCheck?.structure ? syncCheck.structure.inSync : null}
                                            isSyncing={isSyncingStructure}
                                            isCheckingSync={isCheckingSync}
                                            disabled={isSyncingStructure || isSyncingAssets || isSyncingXkt}
                                            onSync={handleSyncStructure}
                                            syncStartedAt={syncCheck?.structure?.syncState?.last_sync_started_at}
                                            syncCompletedAt={syncCheck?.structure?.syncState?.last_sync_completed_at}
                                            syncStatus={syncCheck?.structure?.syncState?.sync_status}
                                            errorMessage={syncCheck?.structure?.syncState?.error_message}
                                            totalSynced={syncCheck?.structure?.localCount}
                                        />
                                        <SyncStatusLog steps={structureSyncLog} outcome={structureSyncOutcome} />

                                        <SyncProgressCard
                                            icon={<Layers className="h-5 w-5 text-primary" />}
                                            title="All Assets"
                                            subtitle={syncCheck?.assets?.accLocalCount
                                                ? `Geminus Plus scope (${syncCheck.assets.accLocalCount} ACC/IFC objects excluded)`
                                                : 'Installations and inventories (per building)'}
                                            localCount={syncCheck?.assets?.localCount || 0}
                                            remoteCount={syncCheck?.assets?.remoteCount}
                                            inSync={syncCheck?.assets ? syncCheck.assets.inSync : null}
                                            isSyncing={isSyncingAssets}
                                            isCheckingSync={isCheckingSync}
                                            disabled={isSyncingStructure || isSyncingAssets || isSyncingXkt}
                                            onSync={handleSyncAssetsChunked}
                                            syncStartedAt={syncCheck?.assets?.syncState?.last_sync_started_at}
                                            syncCompletedAt={syncCheck?.assets?.syncState?.last_sync_completed_at}
                                            syncStatus={syncCheck?.assets?.syncState?.sync_status}
                                            errorMessage={syncCheck?.assets?.syncState?.error_message}
                                            progressCurrent={syncProgress?.currentBuildingIndex}
                                            progressTotal={syncProgress?.totalBuildings}
                                            progressLabel={
                                                syncProgress?.currentBuildingIndex != null && syncProgress?.totalBuildings
                                                    ? `Building ${(syncProgress.currentBuildingIndex + 1)} of ${syncProgress.totalBuildings} • ${(syncProgress.totalSynced || 0).toLocaleString()} objects`
                                                    : undefined
                                            }
                                            totalSynced={syncProgress?.totalSynced}
                                            extraActions={
                                                <Button
                                                    onClick={handleResetAssetsProgress}
                                                    size="sm"
                                                    variant="ghost"
                                                    className="gap-1 h-8 text-xs text-muted-foreground"
                                                    title="Reset progress"
                                                >
                                                    <RefreshCw className="h-3 w-3" />
                                                </Button>
                                            }
                                        />
                                        <SyncStatusLog steps={assetSyncLog} outcome={assetSyncOutcome} />

                                        {/* Per-building sync */}
                                        <div className="border rounded-lg p-4 space-y-3">
                                            <div>
                                                <p className="text-sm font-medium">{t('Synka enskild byggnad', 'Sync individual building')}</p>
                                                <p className="text-xs text-muted-foreground mt-0.5">{t('Snabb sync av assets för en specifik byggnad (~10–30 s)', 'Quick asset sync for a specific building (~10–30 s)')}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <Select value={selectedSingleBuilding} onValueChange={setSelectedSingleBuilding}>
                                                    <SelectTrigger className="flex-1 h-8 text-sm">
                                                        <SelectValue placeholder={t('Välj byggnad...', 'Select building...')} />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {allBuildings.map(b => (
                                                            <SelectItem key={b.fm_guid} value={b.fm_guid}>
                                                                {b.common_name || b.fm_guid}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Button
                                                    size="sm"
                                                    className="h-8 text-xs"
                                                    disabled={!selectedSingleBuilding || isSyncingSingleBuilding || isSyncingStructure || isSyncingAssets}
                                                    onClick={handleSyncSingleBuilding}
                                                >
                                                    {isSyncingSingleBuilding ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />{t('Synkar...', 'Syncing...')}</> : t('Synka', 'Sync')}
                                                </Button>
                                            </div>
                                            {singleBuildingSyncResult && (
                                                <p className={`text-xs ${singleBuildingSyncResult.success ? 'text-green-600' : 'text-destructive'}`}>
                                                    {singleBuildingSyncResult.success ? '✓ ' : '✗ '}{singleBuildingSyncResult.message}
                                                </p>
                                            )}
                                        </div>

                                        <SyncProgressCard
                                            icon={<Box className="h-5 w-5 text-primary" />}
                                            title="XKT Files"
                                            subtitle="3D model files for faster loading"
                                            localCount={syncCheck?.xkt?.localCount || 0}
                                            remoteLabel={syncCheck?.xkt?.buildingCount ? `${syncCheck.xkt.buildingCount} buildings (${syncCheck.xkt.localCount || 0} models cached)` : undefined}
                                            inSync={syncCheck?.xkt?.localCount != null && syncCheck?.xkt?.buildingCount != null && syncCheck.xkt.buildingCount > 0 && syncCheck.xkt.localCount >= syncCheck.xkt.buildingCount}
                                            isSyncing={isSyncingXkt}
                                            isCheckingSync={isCheckingSync}
                                            disabled={isSyncingStructure || isSyncingAssets || isSyncingXkt}
                                            onSync={handleSyncXkt}
                                            syncButtonVariant="secondary"
                                            syncStartedAt={syncCheck?.xkt?.syncState?.last_sync_started_at}
                                            syncCompletedAt={syncCheck?.xkt?.syncState?.last_sync_completed_at}
                                            syncStatus={syncCheck?.xkt?.syncState?.sync_status}
                                            errorMessage={syncCheck?.xkt?.syncState?.error_message}
                                            extraActions={
                                                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none" title="Force re-download of all models regardless of revision">
                                                    <Switch
                                                        checked={forceXkt}
                                                        onCheckedChange={setForceXkt}
                                                        className="h-4 w-8 [&>span]:h-3 [&>span]:w-3 data-[state=checked]:[&>span]:translate-x-4"
                                                    />
                                                    Force
                                                </label>
                                            }
                                        />

                                        <div className="flex items-center gap-2 rounded-lg border p-3 bg-muted/20">
                                            <Database className="h-4 w-4 text-primary" />
                                            <div className="flex-1">
                                                <span className="text-sm font-medium">Geometry Mappings</span>
                                                <p className="text-xs text-muted-foreground">Rebuild model/floor/entity linkage from existing data</p>
                                            </div>
                                            <Button
                                                onClick={async () => {
                                                    try {
                                                        toast({ title: "Rebuilding geometry mappings..." });
                                                        const { data, error } = await supabase.functions.invoke('rebuild-geometry-map', {
                                                            body: { buildingFmGuid: favoriteBuildings[0]?.fm_guid },
                                                        });
                                                        if (error) throw error;
                                                        toast({
                                                            title: "Mappings rebuilt",
                                                            description: `${data?.mappingsCreated || 0} mappings created for ${data?.totalAssets || 0} assets`,
                                                        });
                                                    } catch (err: any) {
                                                        toast({ title: "Rebuild failed", description: err.message, variant: "destructive" });
                                                    }
                                                }}
                                                size="sm"
                                                variant="outline"
                                                className="gap-1"
                                                disabled={!favoriteBuildings[0]?.fm_guid || isSyncingStructure || isSyncingAssets}
                                            >
                                                <RotateCcw className="h-3 w-3" />
                                                Rebuild
                                            </Button>
                                        </div>

                                        {/* System count in status summary */}
                                        {systemCount > 0 && (
                                            <div className="flex items-center gap-2 rounded-lg border p-3 bg-muted/20">
                                                <Network className="h-4 w-4 text-primary" />
                                                <span className="text-sm text-muted-foreground">Tekniska system:</span>
                                                <span className="text-sm font-medium">{systemCount}</span>
                                                <span className="text-xs text-muted-foreground ml-auto">Synced automatically with Geminus Plus / IFC</span>
                                            </div>
                                        )}

                                        {syncCheck && (
                                            <div className="rounded-lg border bg-muted/30 p-3">
                                                <div className="flex items-center justify-between text-sm">
                                                    <span className="text-muted-foreground">Total in local database:</span>
                                                    <span className="font-medium">{syncCheck.total?.localCount?.toLocaleString() || assetCount.toLocaleString()} objects</span>
                                                </div>
                                                <div className="flex items-center justify-between text-sm mt-1">
                                                    <span className="text-muted-foreground">Total in Geminus Plus:</span>
                                                    <span className="font-medium">{syncCheck.total?.remoteCount?.toLocaleString() || '?'} objects</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            {/* Geminus Base Sync */}
                            <AccordionItem value="geminus-base-sync" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Building2 className="h-4 w-4 text-primary" />
                                        <span>Geminus Base</span>
                                        {geminusBaseStatus === 'success' && <Badge variant="outline" className="ml-auto mr-2 text-xs">Connected</Badge>}
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="space-y-4">
                                        <p className="text-xs text-muted-foreground">Sync inventoried objects (not in model) with Geminus Base</p>
                                        <div className="space-y-2 text-sm">
                                            <div className="flex items-center justify-between">
                                                <span className="text-muted-foreground">Inventoried objects with FM link:</span>
                                                <span className="font-medium">{geminusBaseLocalCount}</span>
                                            </div>
                                            {geminusBaseSyncResult && (
                                                <>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-muted-foreground">Last sync:</span>
                                                        <span className="font-medium text-xs">{geminusBaseSyncResult.lastSync ? new Date(geminusBaseSyncResult.lastSync).toLocaleString('en-US') : '–'}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-muted-foreground">Result:</span>
                                                        <span className="font-medium text-xs">
                                                            <span className="text-green-600">{geminusBaseSyncResult.success} succeeded</span>
                                                            {geminusBaseSyncResult.failed > 0 && <span className="text-red-600 ml-1.5">{geminusBaseSyncResult.failed} failed</span>}
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={handleTestGeminusBaseConnection} disabled={isTestingGeminusBase || isSyncingGeminusBase}>
                                                {isTestingGeminusBase ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                Test Connection
                                            </Button>
                                            <Button size="sm" className="gap-1 h-8 text-xs" onClick={handleSyncToGeminusBase} disabled={isSyncingGeminusBase || isTestingGeminusBase}>
                                                {isSyncingGeminusBase ? <Loader2 className="h-3 w-3 animate-spin" /> : <Building2 className="h-3 w-3" />}
                                                {isSyncingGeminusBase ? 'Syncing...' : 'Sync with Geminus Base ↔'}
                                            </Button>
                                        </div>

                                        {/* Geminus Base Document/Drawing Sync */}
                                        <div className="border-t pt-3 mt-3">
                                            <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                                                <FileText className="h-3.5 w-3.5" />
                                                Sync documents &amp; drawings
                                            </h4>
                                            <p className="text-xs text-muted-foreground mb-3">
                                                Syncs drawings, documents and O&M instructions from Geminus Base to local database for fast search via Geminus AI.
                                            </p>
                                            <GeminusBaseDocSyncPanel />
                                        </div>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            {/* Geminus Premium Sync */}
                            <AccordionItem value="geminus-premium-sync" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Radar className="h-4 w-4 text-primary" />
                                        <span>Geminus Premium</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="space-y-4">
                                        <p className="text-xs text-muted-foreground">IoT sensors via Geminus Premium (InUse). Press "Test Connection" to check if the API is available.</p>
                                        <Button 
                                            size="sm"
                                            variant="outline"
                                            className="gap-1 h-8 text-xs"
                                            onClick={async () => {
                                                try {
                                                    const { data, error } = await supabase.functions.invoke('geminus-premium-query', {
                                                        body: { action: 'get-indices' }
                                                    });
                                                    if (error) throw error;
                                                    if (data?.success) {
                                                        toast({ title: 'Connection OK', description: `Found ${data.indices?.length || 0} indices in Geminus Premium.` });
                                                    } else {
                                                        toast({ variant: 'destructive', title: 'Connection Error', description: data?.error || 'Could not reach Geminus Premium API (possible rate limit)' });
                                                    }
                                                } catch (err: any) {
                                                    toast({ variant: 'destructive', title: 'Error', description: err.message });
                                                }
                                            }}
                                        >
                                            <RefreshCw className="h-3 w-3" />
                                            Test Connection
                                        </Button>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            {/* Faciliate Sync */}
                            <AccordionItem value="faciliate-sync" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3" onClick={() => { loadFacilitateStats(); checkConnectorStatus(); }}>
                                    <div className="flex items-center gap-2">
                                        <Wrench className="h-4 w-4 text-orange-500" />
                                        <span>Faciliate</span>
                                        {connectorStatus === 'online'
                                            ? <Badge variant="outline" className="ml-auto mr-2 text-xs bg-green-50 text-green-700 border-green-200">Online</Badge>
                                            : facilitateCacheStats && facilitateCacheStats.total > 0
                                                ? <Badge variant="outline" className="ml-auto mr-2 text-xs">{facilitateCacheStats.total.toLocaleString()} records</Badge>
                                                : <Badge variant="outline" className="ml-auto mr-2 text-xs">Ej synkad</Badge>}
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="space-y-4">

                                        {/* Connector status + start-server hint */}
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className={`h-2 w-2 rounded-full ${connectorStatus === 'online' ? 'bg-green-500' : connectorStatus === 'offline' ? 'bg-red-400' : 'bg-gray-300'}`} />
                                                <span className="text-sm text-muted-foreground">
                                                    {connectorStatus === 'online' ? t('Connector igång', 'Connector running') : connectorStatus === 'offline' ? t('Connector ej igång', 'Connector not running') : t('Okänd status', 'Unknown status')}
                                                </span>
                                            </div>
                                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={checkConnectorStatus}>
                                                <RefreshCw className="h-3 w-3" /> {t('Kontrollera', 'Check')}
                                            </Button>
                                        </div>

                                        {connectorStatus === 'offline' && (
                                            <div className="rounded bg-muted p-2 text-[11px] text-muted-foreground">
                                                {t('Starta connectorn (kräver VPN):', 'Start the connector (requires VPN):')}<br />
                                                <code className="font-mono">cd faciliate-connector &amp;&amp; node connector.mjs serve</code>
                                            </div>
                                        )}

                                        {/* Sync controls — always visible, disabled when offline */}
                                        <div className="space-y-2">
                                            {facilitateBuildings.length > 0 ? (
                                                <select
                                                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                                                    value={selectedFacBuildingId}
                                                    onChange={e => {
                                                        const b = facilitateBuildings.find(x => x.id === e.target.value);
                                                        setSelectedFacBuildingId(e.target.value);
                                                        setSelectedFacBuildingName(b?.name || '');
                                                    }}
                                                    disabled={connectorStatus !== 'online'}
                                                >
                                                    <option value="">{t('Välj byggnad…', 'Select building…')}</option>
                                                    {facilitateBuildings.map(b => <option key={b.id} value={b.id}>{b.name} ({b.id})</option>)}
                                                </select>
                                            ) : (
                                                <div className="flex gap-2">
                                                    <Input placeholder="Byggnads-ID (t.ex. S1)" value={selectedFacBuildingId} onChange={e => setSelectedFacBuildingId(e.target.value)} className="h-9 text-sm" disabled={connectorStatus !== 'online'} />
                                                    <Input placeholder="Namn" value={selectedFacBuildingName} onChange={e => setSelectedFacBuildingName(e.target.value)} className="h-9 text-sm" disabled={connectorStatus !== 'online'} />
                                                    <Button variant="outline" size="sm" className="h-9 text-xs shrink-0 gap-1" onClick={fetchFacilitateBuildings} disabled={connectorStatus !== 'online'}>
                                                        <Database className="h-3 w-3" /> {t('Hämta', 'Fetch')}
                                                    </Button>
                                                </div>
                                            )}

                                            <Button
                                                onClick={startFacilitateSync}
                                                disabled={isFacilitiateSyncing || connectorStatus !== 'online' || !selectedFacBuildingId}
                                                className="w-full gap-2"
                                                size="sm"
                                            >
                                                {isFacilitiateSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                                {isFacilitiateSyncing ? t('Synkar…', 'Syncing…') : connectorStatus !== 'online' ? t('Starta connector för att synka', 'Start connector to sync') : t('Synka nu', 'Sync now')}
                                            </Button>
                                        </div>

                                        {/* Live progress log */}
                                        {facilitateSyncLog.length > 0 && (
                                            <div className="rounded border bg-muted/50 p-2 max-h-28 overflow-y-auto space-y-0.5">
                                                {facilitateSyncLog.map((line, i) => (
                                                    <p key={i} className="text-[11px] font-mono text-muted-foreground">{line}</p>
                                                ))}
                                            </div>
                                        )}

                                        {/* Cache stats */}
                                        {facilitateCacheStats && facilitateCacheStats.total > 0 && (
                                            <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                                                {Object.entries(facilitateCacheStats.byType).map(([type, count]) => (
                                                    <div key={type} className="flex items-center justify-between text-sm">
                                                        <span className="text-muted-foreground">{type === 'workorder' ? t('Arbetsordrar', 'Work orders') : type === 'rentlandlord' ? t('Hyreskontrakt', 'Lease contracts') : type === 'maintenance' ? t('Planerat underhåll', 'Planned maintenance') : type}</span>
                                                        <span className="font-medium">{(count as number).toLocaleString()}</span>
                                                    </div>
                                                ))}
                                                {facilitateCacheStats.byBuilding.filter(b => b.building_name).map((b, i) => (
                                                    <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                                                        <span className="truncate max-w-[65%]">↳ {b.building_name}</span>
                                                        <span>{b.count.toLocaleString()}</span>
                                                    </div>
                                                ))}
                                                {facilitateCacheStats.lastSynced && (
                                                    <div className="flex items-center justify-between text-xs text-muted-foreground border-t pt-1.5 mt-1">
                                                        <span>{t('Senast synkad', 'Last synced')}</span>
                                                        <span>{new Date(facilitateCacheStats.lastSynced).toLocaleString('sv-SE')}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs text-muted-foreground" onClick={loadFacilitateStats} disabled={isLoadingFacilitateStats}>
                                            {isLoadingFacilitateStats ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                            Uppdatera cachestatus
                                        </Button>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            {/* Ivion Sync */}
                            <AccordionItem value="ivion-sync" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Zap className="h-4 w-4 text-primary" />
                                        <span>Ivion</span>
                                        <Badge variant="outline" className="ml-auto mr-2 text-xs">Coming soon</Badge>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="text-center py-4 text-muted-foreground border rounded-lg bg-muted/30">
                                        <Database className="h-6 w-6 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">Configure Ivion API first</p>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            {/* Congeria Documents */}
                            <AccordionItem value="congeria-sync" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <FileText className="h-4 w-4 text-blue-500" />
                                        <span>Congeria Documents</span>
                                        <Badge variant="outline" className="ml-auto mr-2 text-xs">{documentCount} docs</Badge>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-end">
                                            <Button 
                                                onClick={handleSyncAllCongeria}
                                                disabled={isSyncingCongeria || Object.keys(congeriaLinks).length === 0}
                                                size="sm"
                                                variant="outline"
                                                className="gap-1 h-8 text-xs"
                                            >
                                                {isSyncingCongeria ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                Sync All
                                            </Button>
                                        </div>
                                        <div className="space-y-2">
                                            <p className="text-xs text-muted-foreground">Enter Congeria folder URL for each building</p>
                                            {allBuildings.length === 0 ? (
                                                <div className="text-center py-4 text-muted-foreground border rounded-lg bg-muted/30">
                                                    <Database className="h-6 w-6 mx-auto mb-2 opacity-50" />
                                                    <p className="text-sm">Sync buildings from Geminus Plus first</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                                                    {allBuildings.map((building) => (
                                                        <div key={building.fm_guid} className="flex items-center gap-2">
                                                            <span className="text-sm min-w-[120px] truncate">
                                                                {building.common_name || building.name}
                                                            </span>
                                                            <Input 
                                                                placeholder="https://fms.congeria.com/..."
                                                                value={congeriaLinks[building.fm_guid] || ''}
                                                                onChange={(e) => handleCongeriaUrlChange(building.fm_guid, e.target.value)}
                                                                className="flex-1 h-8 text-xs"
                                                            />
                                                            <Button 
                                                                size="sm" 
                                                                variant="ghost"
                                                                className="h-8 px-2"
                                                                onClick={() => handleSaveCongeriaUrl(building.fm_guid)}
                                                                disabled={!congeriaLinks[building.fm_guid]}
                                                            >
                                                                <Save className="h-3 w-3" />
                                                            </Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            {/* BIP Reference Data */}
                            <AccordionItem value="bip-sync" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Database className="h-4 w-4 text-primary" />
                                        <span>BIP Reference Data</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="space-y-3">
                                        <p className="text-xs text-muted-foreground">
                                            Import BIP classification codes (main categories, subcategories, properties, schemas) from the open GitLab repository. Required for BIP auto-classification.
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                onClick={async () => {
                                                    setIsImportingBip(true);
                                                    setBipImportResult(null);
                                                    const categories = ['maincategory', 'subcategory', 'property', 'schema'];
                                                    const allStats: Record<string, number> = {};
                                                    try {
                                                        const { data: { session } } = await supabase.auth.getSession();
                                                        for (const cat of categories) {
                                                            setBipImportResult(`Importing ${cat}...`);
                                                            const { data, error } = await supabase.functions.invoke('bip-import', {
                                                                headers: { Authorization: `Bearer ${session?.access_token}` },
                                                                body: { category: cat },
                                                            });
                                                            if (error) throw new Error(`${cat}: ${error.message}`);
                                                            const count = data?.stats?.[cat] ?? 0;
                                                            allStats[cat] = count;
                                                        }
                                                        const total = Object.values(allStats).reduce((a, b) => a + b, 0);
                                                        setBipImportResult(`Imported ${total} items (${Object.entries(allStats).map(([k,v]) => `${k}: ${v}`).join(', ')})`);
                                                        toast({ title: 'BIP Import Complete', description: `${total} reference items imported` });
                                                    } catch (e: any) {
                                                        setBipImportResult(`Error: ${e.message}`);
                                                        toast({ title: 'BIP Import Failed', description: e.message, variant: 'destructive' });
                                                    } finally {
                                                        setIsImportingBip(false);
                                                    }
                                                }}
                                                disabled={isImportingBip}
                                                size="sm"
                                                className="gap-1"
                                            >
                                                {isImportingBip ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                Import BIP Data
                                            </Button>
                                        </div>
                                        {bipImportResult && (
                                            <p className={`text-xs ${bipImportResult.startsWith('Error') || bipImportResult.startsWith('Importing') ? (bipImportResult.startsWith('Error') ? 'text-destructive' : 'text-muted-foreground') : 'text-green-600'}`}>
                                                {bipImportResult}
                                            </p>
                                        )}
                                    </div>
                                </AccordionContent>
                            </AccordionItem>

                            {/* IMDF Export */}
                            <AccordionItem value="imdf-export" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Archive className="h-4 w-4 text-primary" />
                                        <span>IMDF Export</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <ImdfExportPanel allBuildings={allBuildings} />
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </TabsContent>

                    {/* Symbols Settings Tab */}
                    <TabsContent value="symbols" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <SymbolSettings />
                    </TabsContent>

                    {/* Viewer Settings Tab (Themes + Room Labels + Performance) */}
                    <TabsContent value="viewer" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <Accordion type="multiple" className="space-y-2">
                            <AccordionItem value="themes" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Palette className="h-4 w-4" />
                                        <span>Viewer Themes</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <ViewerThemeSettings />
                                </AccordionContent>
                            </AccordionItem>
                            <AccordionItem value="labels" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Layers className="h-4 w-4" />
                                        <span>Room Labels</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <RoomLabelSettings />
                                </AccordionContent>
                            </AccordionItem>
                            <AccordionItem value="performance" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Eye className="h-4 w-4" />
                                        <span>Performance</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between py-2">
                                            <div>
                                                <span className="text-sm font-medium">Smooth Navigation (FastNav)</span>
                                                <p className="text-xs text-muted-foreground">Lowers resolution during camera movement for better performance. May cause blurry visuals while moving. Requires viewer reload.</p>
                                            </div>
                                            <Switch
                                                checked={getFastNavEnabled()}
                                                onCheckedChange={(checked) => {
                                                    setFastNavEnabled(checked);
                                                    toast({
                                                        title: checked ? 'FastNav enabled' : 'FastNav disabled',
                                                        description: 'Reload the viewer to apply changes.',
                                                    });
                                                }}
                                            />
                                        </div>
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </TabsContent>

                    {/* AI Assistants Tab */}
                    <TabsContent value="assistants" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <Accordion type="multiple" className="space-y-2">
                            <AccordionItem value="gunnar" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Sparkles className="h-4 w-4" />
                                        <span>Geminus AI</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <GunnarSettings />
                                </AccordionContent>
                            </AccordionItem>
                            <AccordionItem value="ilean" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <FileText className="h-4 w-4" />
                                        <span>Ilean AI</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <IleanSettings />
                                </AccordionContent>
                            </AccordionItem>
                            <AccordionItem value="voice" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Mic className="h-4 w-4" />
                                        <span>Voice Control</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <VoiceSettings />
                                </AccordionContent>
                            </AccordionItem>
                            <AccordionItem value="knowledge-base" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <DatabaseIcon className="h-4 w-4" />
                                        <span>Knowledge Base Sources</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <KnowledgeBaseSettings />
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </TabsContent>

                    {/* Create Building Tab */}
                    <TabsContent value="building" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <CreateBuildingPanel onSwitchToAccTab={() => setActiveTab('apis')} />
                    </TabsContent>

                    {/* API Profiles Tab */}
                    <TabsContent value="api-profiles" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <ApiProfilesManager />
                    </TabsContent>
                    <TabsContent value="tenants" className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
                        <TenantsManager />
                    </TabsContent>
                </Tabs>
            </DialogContent>
            
            {/* Ivion Connection Modal */}
            <IvionConnectionModal 
                isOpen={isIvionModalOpen} 
                onClose={() => setIsIvionModalOpen(false)}
                onConnected={() => setIvionConnectionStatus('connected')}
            />
        </Dialog>
    );
};

export default ApiSettingsModal;
