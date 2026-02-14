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
import { supabase } from "@/integrations/supabase/client";
import { 
    Box, Database, RefreshCw, CheckCircle2, AlertCircle, 
    Loader2, Server, Clock, Eye, EyeOff, Zap, Settings2, Save, Edit2,
    LayoutGrid, ExternalLink, Building2, Archive, Radar, BarChart2, Circle, Layers, Wrench, Mic, Palette, View, User, Sparkles, FileText, FolderOpen, ChevronRight, ChevronDown as ChevronDownIcon, File, Database as DatabaseIcon, Cuboid
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AppContext } from '@/context/AppContext';
import { DEFAULT_APP_CONFIGS, SENSLINC_POLL_OPTIONS } from '@/lib/constants';
import SymbolSettings from './SymbolSettings';
import VoiceSettings from './VoiceSettings';
import ViewerThemeSettings from './ViewerThemeSettings';
import RoomLabelSettings from './RoomLabelSettings';
import ProfileSettings from './ProfileSettings';
import IvionConnectionModal from './IvionConnectionModal';
import GunnarSettings from './GunnarSettings';
import { SyncProgressCard } from './SyncProgressCard';
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
    total: { localCount: number; remoteCount: number };
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
        case 'asset_plus': return Box;
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
}> = ({ folder, depth, expandedFolders, toggleFolder, syncingBimFolderId, bimSyncProgress, handleSyncBimData, formatFileSize, selectedBimFiles, toggleBimFile, translationStatuses, onTranslate3D }) => {
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
                        {totalCount} {totalCount === 1 ? 'fil' : 'filer'}
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
                            ? (bimSyncProgress || 'Synkar...')
                            : selectedCount > 0
                                ? `Synka ${selectedCount}`
                                : 'Synka BIM'}
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
                                                    {ts?.status === 'failed' ? 'Igen' : '3D'}
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
                                />
                            ))}
                        </div>
                    )}

                    {/* Empty folder message */}
                    {(!folder.items || folder.items.length === 0) && !hasChildren && (
                        <p className="px-2.5 pl-8 text-xs text-muted-foreground italic">Inga filer i denna mapp.</p>
                    )}

                    {folder.truncated && (
                        <p className="px-2.5 pl-8 text-xs text-muted-foreground italic">Undermappar ej laddade (max djup nått).</p>
                    )}
                </div>
            )}
        </div>
    );
};
const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ isOpen, onClose }) => {

    const { toast } = useToast();
    const { appConfigs, setAppConfigs } = useContext(AppContext);
    const [activeTab, setActiveTab] = useState('apps');
    // Separate syncing states for each sync type
    const [isSyncingStructure, setIsSyncingStructure] = useState(false);
    const [isSyncingAssets, setIsSyncingAssets] = useState(false);
    const [isSyncingXkt, setIsSyncingXkt] = useState(false);
    const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([]);
    const [assetCount, setAssetCount] = useState<number>(0);
    const [syncCheck, setSyncCheck] = useState<NewSyncCheckResult | null>(null);
    const [isCheckingSync, setIsCheckingSync] = useState(false);
    const [hasCheckedSync, setHasCheckedSync] = useState(false);
    
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
    
    // FM Access state
    const [fmAccessConfig, setFmAccessConfig] = useState({
        apiUrl: '',
        username: '',
        password: '',
    });
    const [isSavingFmAccess, setIsSavingFmAccess] = useState(false);
    const [isTestingFmAccess, setIsTestingFmAccess] = useState(false);
    const [fmAccessStatus, setFmAccessStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [fmAccessMessage, setFmAccessMessage] = useState('');

    // Congeria state
    const [congeriaLinks, setCongeriaLinks] = useState<Record<string, string>>({});
    const [isSyncingCongeria, setIsSyncingCongeria] = useState(false);
    const [documentCount, setDocumentCount] = useState(0);
    const [allBuildings, setAllBuildings] = useState<any[]>([]);
    
    // Ivion connection modal state
    const [isIvionModalOpen, setIsIvionModalOpen] = useState(false);
    
    // ACC (Autodesk Construction Cloud) state
    const [accProjects, setAccProjects] = useState<any[]>([]);
    const [selectedAccProjectId, setSelectedAccProjectId] = useState('');
    const [manualAccProjectId, setManualAccProjectId] = useState('');
    const [isLoadingAccProjects, setIsLoadingAccProjects] = useState(false);
    const [isTestingAcc, setIsTestingAcc] = useState(false);
    const [accConnectionStatus, setAccConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [accConnectionMessage, setAccConnectionMessage] = useState('');
    const [isSyncingAccLocations, setIsSyncingAccLocations] = useState(false);
    const [isSyncingAccAssets, setIsSyncingAccAssets] = useState(false);
    const [accStatus, setAccStatus] = useState<any>(null);
    const [isCheckingAccStatus, setIsCheckingAccStatus] = useState(false);
    const [accRegion, setAccRegion] = useState<'US' | 'EMEA'>('US');
    const [ivionConnectionStatus, setIvionConnectionStatus] = useState<'idle' | 'connected' | 'error'>('idle');
    const [accLocationsHint, setAccLocationsHint] = useState<string | null>(null);
    
    // ACC folder browsing state
    const [accFolders, setAccFolders] = useState<any[] | null>(null);
    const [accTopLevelItems, setAccTopLevelItems] = useState<any[]>([]);
    const [accRootFolderName, setAccRootFolderName] = useState('');
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
    
    // ACC -> Asset+ sync state
    const [accToApStatus, setAccToApStatus] = useState<any>(null);
    const [isCheckingAccToAp, setIsCheckingAccToAp] = useState(false);
    const [isSyncingAccToAp, setIsSyncingAccToAp] = useState(false);
    const [accToApResult, setAccToApResult] = useState<any>(null);

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
                        toast({ title: 'Autodesk-inloggning lyckades', description: 'Du är nu inloggad med ditt Autodesk-konto.' });
                    } else {
                        throw new Error(data?.error || 'Token exchange failed');
                    }
                } catch (err: any) {
                    toast({ variant: 'destructive', title: 'Inloggning misslyckades', description: err.message });
                } finally {
                    setIsAccLoggingIn(false);
                }
            } else if (event.data?.type === 'autodesk-oauth-error') {
                toast({ variant: 'destructive', title: 'Autodesk-inloggning avbruten', description: event.data.error });
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
            toast({ variant: 'destructive', title: 'Fel', description: err.message });
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
            toast({ title: 'Utloggad', description: 'Du har loggats ut från Autodesk.' });
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Fel', description: err.message });
        } finally {
            setIsAccLoggingOut(false);
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
                toast({ title: 'Anslutning OK', description: data.message });
            } else {
                setAccConnectionStatus('error');
                setAccConnectionMessage(data?.error || 'Okänt fel');
                toast({ variant: 'destructive', title: 'Anslutning misslyckades', description: data?.error });
            }
        } catch (err: any) {
            setAccConnectionStatus('error');
            setAccConnectionMessage(err.message);
            toast({ variant: 'destructive', title: 'Fel', description: err.message });
        } finally {
            setIsTestingAcc(false);
        }
    };

    const handleFetchAccProjects = async () => {
        setIsLoadingAccProjects(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'list-projects', region: accRegion }
            });
            if (error) throw error;
            if (data?.success && data.projects) {
                setAccProjects(data.projects);
                if (data.projects.length > 0 && !selectedAccProjectId) {
                    setSelectedAccProjectId(data.projects[0].id);
                }
                toast({ title: 'Projekt hämtade', description: `Hittade ${data.projects.length} projekt i ACC.` });
            } else {
                toast({ variant: 'destructive', title: 'Fel', description: data?.error || 'Kunde inte hämta projekt' });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Fel', description: err.message });
        } finally {
            setIsLoadingAccProjects(false);
        }
    };

    const handleSyncAccLocations = async () => {
        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        if (!effectiveProjectId) {
            toast({ variant: 'destructive', title: 'Välj projekt', description: 'Välj ett ACC-projekt eller ange ett projekt-ID manuellt.' });
            return;
        }
        setIsSyncingAccLocations(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'sync-locations', projectId: effectiveProjectId, region: accRegion }
            });
            if (error) throw error;
            if (data?.success) {
                toast({ title: 'Synk klar', description: data.message });
                if (data.hint) {
                    setAccLocationsHint(data.hint);
                } else {
                    setAccLocationsHint(null);
                }
                handleCheckAccStatus();
            } else {
                toast({ variant: 'destructive', title: 'Synk misslyckades', description: data?.error });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Fel', description: err.message });
        } finally {
            setIsSyncingAccLocations(false);
        }
    };

    const handleSyncAccAssets = async () => {
        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        if (!effectiveProjectId) {
            toast({ variant: 'destructive', title: 'Välj projekt', description: 'Välj ett ACC-projekt eller ange ett projekt-ID manuellt.' });
            return;
        }
        setIsSyncingAccAssets(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'sync-assets', projectId: effectiveProjectId, region: accRegion }
            });
            if (error) throw error;
            if (data?.success) {
                toast({ title: 'Synk klar', description: data.message });
                handleCheckAccStatus();
            } else {
                toast({ variant: 'destructive', title: 'Synk misslyckades', description: data?.error });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Fel', description: err.message });
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

    // ACC -> Asset+ sync handlers
    const handleCheckAccToAssetPlus = async () => {
        setIsCheckingAccToAp(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-to-assetplus', {
                body: { action: 'check-status' }
            });
            if (error) throw error;
            setAccToApStatus(data);
        } catch (err: any) {
            console.error('Failed to check ACC->Asset+ status:', err);
            toast({ variant: 'destructive', title: 'Fel', description: err.message });
        } finally {
            setIsCheckingAccToAp(false);
        }
    };

    const handleSyncAccToAssetPlus = async () => {
        setIsSyncingAccToAp(true);
        setAccToApResult(null);
        try {
            const { data, error } = await supabase.functions.invoke('acc-to-assetplus', {
                body: { action: 'sync' }
            });
            if (error) throw error;
            setAccToApResult(data);
            if (data?.success) {
                toast({ 
                    title: 'Synk till Asset+ klar', 
                    description: `${data.summary?.buildingsSynced || 0} byggnader synkade` 
                });
            } else {
                toast({ 
                    variant: 'destructive', 
                    title: 'Synk delvis misslyckad', 
                    description: `${data?.summary?.totalErrors || 0} fel uppstod` 
                });
            }
            // Refresh status
            handleCheckAccToAssetPlus();
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Synk misslyckades', description: err.message });
        } finally {
            setIsSyncingAccToAp(false);
        }
    };

    useEffect(() => {
        if (isOpen && accAuthStatus !== 'checking' && !hasLoadedAccSettings) {
            setHasLoadedAccSettings(true);
            handleCheckAccStatus();
        }
    }, [isOpen, accAuthStatus, hasLoadedAccSettings]);

    // Reset ACC settings loaded flag when modal closes
    useEffect(() => {
        if (!isOpen) {
            setHasLoadedAccSettings(false);
        }
    }, [isOpen]);

    // Fetch ACC folders via Data Management API
    const handleFetchAccFolders = async () => {
        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        if (!effectiveProjectId) {
            toast({ variant: 'destructive', title: 'Projekt-ID saknas', description: 'Ange ett ACC-projekt-ID först.' });
            return;
        }
        setIsLoadingAccFolders(true);
        try {
            const { data, error } = await supabase.functions.invoke('acc-sync', {
                body: { action: 'list-folders', projectId: effectiveProjectId, region: accRegion }
            });
            if (error) throw error;
            if (data?.success) {
                setAccFolders(data.folders || []);
                setAccTopLevelItems(data.topLevelItems || []);
                setAccRootFolderName(data.rootFolder || '');
                toast({ title: 'Mappar hämtade', description: `Hittade ${(data.folders || []).length} mappar i "${data.rootFolder}".` });
            } else {
                toast({ variant: 'destructive', title: 'Fel', description: data?.error || 'Kunde inte hämta mappar' });
            }
        } catch (err: any) {
            toast({ variant: 'destructive', title: 'Fel', description: err.message });
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
            toast({ variant: 'destructive', title: 'Projekt-ID saknas', description: 'Ange ett ACC-projekt-ID först.' });
            return;
        }

        const allItems = selectedFiles || folder.items || [];
        const bimItems = allItems.filter((item: any) => item.versionUrn);
        if (bimItems.length === 0) {
            const bimWithoutUrn = allItems.filter((i: any) => i.isBim && !i.versionUrn);
            console.warn('[BIM Sync] No items with versionUrn. All items:', allItems.length, 'BIM without URN:', bimWithoutUrn.length, bimWithoutUrn.map((i: any) => i.name));
            toast({ 
                variant: 'destructive', 
                title: 'Inga BIM-filer', 
                description: bimWithoutUrn.length > 0
                    ? `Hittade ${bimWithoutUrn.length} BIM-fil(er) men utan version-URN. Filerna kan vara Cloud Models som kräver direkt API-åtkomst.`
                    : 'Denna mapp innehåller inga BIM-filer.'
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
            setBimSyncProgress(`Fil ${i + 1}/${bimItems.length}: ${item.name}`);

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
                        title: 'Indexering pågår',
                        description: `${item.name}: Modellen indexeras. Prova igen om en stund.`,
                    });
                } else {
                    failures.push(`${item.name}: ${data?.error || 'Okänt fel'}`);
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
                title: 'BIM-synk klar',
                description: `${totalLevels} våningsplan, ${totalRooms} rum, ${totalInstances} instanser från ${bimItems.length - failures.length}/${bimItems.length} fil(er)`,
            });
            handleCheckAccStatus();
        } else if (failures.length === 0) {
            // All files processed but no levels/rooms found
            toast({
                variant: 'destructive',
                title: 'Inga rum/våningar hittades',
                description: 'BIM-modellerna kunde indexeras men innehöll inga Revit Levels eller Rooms.',
            });
        }
        
        if (failures.length > 0) {
            toast({
                variant: 'destructive',
                title: `${failures.length} fil(er) misslyckades`,
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
            toast({ variant: 'destructive', title: 'Fel', description: 'Filen saknar versionUrn.' });
            return;
        }

        const effectiveProjectId = manualAccProjectId.trim() || selectedAccProjectId;
        const buildingFmGuid = `acc-bim-building-${folder.id.replace(/[^a-zA-Z0-9-]/g, '')}`;

        // Update status to pending
        setTranslationStatuses(prev => ({ ...prev, [item.versionUrn]: { status: 'pending', message: 'Startar...' } }));

        toast({ title: 'Konvertering startad', description: `Startar 3D-konvertering för ${item.name}...` });

        const { accXktConverter } = await import('@/services/acc-xkt-converter');
        const result = await accXktConverter.runFullPipeline(
            item.versionUrn,
            {
                buildingFmGuid,
                folderId: folder.id,
                fileName: item.name,
                region: accRegion,
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
                title: isFormatLimitation ? 'Formatbegränsning' : 'Konvertering misslyckades', 
                description: result.error || 'Okänt fel',
            });
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
            const { data, error } = await supabase.functions.invoke('update-asset-plus-config', {
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
            const [syncResult, countResult] = await Promise.all([
                supabase.from('asset_sync_state').select('*').order('subtree_name'),
                supabase.from('assets').select('id', { count: 'exact', head: true })
            ]);
            
            if (syncResult.data) {
                setSyncStatuses(syncResult.data as SyncStatus[]);
            }
            if (countResult.count !== null) {
                setAssetCount(countResult.count);
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

    // Check sync status against Asset+
    const checkSyncStatus = async () => {
        setIsCheckingSync(true);
        try {
            const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
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

    // Sync structure (buildings, storeys, spaces) - uses sync-with-cleanup to also remove orphans
    const handleSyncStructure = async () => {
        setIsSyncingStructure(true);
        try {
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'sync-with-cleanup' }
            }).then(({ data }) => {
                if (data?.success) {
                    toast({
                        title: 'Synkronisering klar',
                        description: data.message,
                    });
                }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Synkar struktur",
                description: "Hämtar data och tar bort objekt som inte längre finns i Asset+.",
            });

            // Spinner stops via Realtime subscription (no more polling/timeout)

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Synk misslyckades",
                description: error.message,
            });
            setIsSyncingStructure(false);
        }
    };

    // Sync all assets with loop-until-complete behavior
    const handleSyncAssetsChunked = async () => {
        setIsSyncingAssets(true);
        
        const runResumableSync = async (): Promise<void> => {
            try {
                const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
                    body: { action: 'sync-assets-resumable' }
                });

                if (error) {
                    console.error('Asset sync error:', error);
                    
                    // Check for sort memory error in the response
                    const errorMsg = error.message || '';
                    if (errorMsg.includes('Sort exceeded memory limit') || errorMsg.includes('SORT_MEMORY_LIMIT')) {
                        toast({
                            title: "Provar alternativ strategi",
                            description: "Asset+ servern hade minnesproblem. Synken fortsätter med mindre batcher...",
                        });
                        // Continue after a brief delay
                        setTimeout(() => runResumableSync(), 2000);
                        return;
                    }
                    
                    toast({
                        variant: "destructive",
                        title: "Sync Error",
                        description: error.message,
                    });
                    setIsSyncingAssets(false);
                    return;
                }

                // Update status display
                await fetchSyncStatus();

                // Handle soft errors (mode switches, etc.)
                if (data?.softError === 'SWITCHED_TO_CURSOR_MODE') {
                    toast({
                        title: "Ändrar strategi",
                        description: "Byter till cursor-baserad pagination för denna byggnad...",
                    });
                }

                if (data?.interrupted) {
                    // Continue syncing - call again after a short delay
                    const progressInfo = data.progress;
                    const modeInfo = progressInfo?.pageMode === 'cursor' ? ' (cursor)' : '';
                    console.log(`Asset sync progress: ${data.totalSynced} synced, mode: ${progressInfo?.pageMode}, continuing...`);
                    toast({
                        title: "Synkar tillgångar",
                        description: `${data.totalSynced} tillgångar synkade (${progressInfo?.currentBuildingIndex + 1}/${progressInfo?.totalBuildings})${modeInfo}. Fortsätter...`,
                    });
                    
                    // Wait 1 second then continue
                    setTimeout(() => runResumableSync(), 1000);
                } else {
                    // Completed
                    console.log(`Asset sync completed: ${data?.totalSynced} total`);
                    toast({
                        title: "Sync Complete",
                        description: `${data?.totalSynced || 0} assets synced successfully.`,
                    });
                    setIsSyncingAssets(false);
                    await checkSyncStatus();
                }
            } catch (error: any) {
                console.error('Asset sync exception:', error);
                
                // Check for sort memory error
                const errorMsg = error.message || '';
                if (errorMsg.includes('Sort exceeded memory limit') || errorMsg.includes('SORT_MEMORY_LIMIT')) {
                    toast({
                        title: "Provar igen",
                        description: "Asset+ servern hade minnesproblem. Försöker igen...",
                    });
                    setTimeout(() => runResumableSync(), 3000);
                    return;
                }
                
                toast({
                    variant: "destructive",
                    title: "Sync Failed",
                    description: error.message,
                });
                setIsSyncingAssets(false);
            }
        };

        toast({
            title: "Startar synkronisering",
            description: "Synkar alla tillgångar byggnad för byggnad. Fortsätter automatiskt.",
        });

        runResumableSync();
    };

    // Reset assets sync progress (admin action)
    const handleResetAssetsProgress = async () => {
        try {
            const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'reset-assets-progress' }
            });
            
            if (error) throw error;
            
            toast({
                title: "Progress återställd",
                description: data?.message || "Du kan nu starta en ny synkronisering.",
            });
            
            await fetchSyncStatus();
            await checkSyncStatus();
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Kunde inte återställa",
                description: error.message,
            });
        }
    };

    // Sync all XKT models with loop-until-complete behavior
    const handleSyncXkt = async () => {
        setIsSyncingXkt(true);
        
        const runResumableSync = async (): Promise<void> => {
            try {
                const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
                    body: { action: 'sync-xkt-resumable' }
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

                if (data?.interrupted) {
                    // Continue syncing - call again after a short delay
                    console.log(`XKT sync progress: ${data.synced} synced, continuing...`);
                    toast({
                        title: "Syncing XKT Models",
                        description: `${data.synced} models synced. Continuing...`,
                    });
                    
                    setTimeout(() => runResumableSync(), 1000);
                } else {
                    // Completed
                    console.log(`XKT sync completed: ${data?.synced} total`);
                    toast({
                        title: "XKT Sync Complete",
                        description: `${data?.synced || 0} 3D models synced successfully.`,
                    });
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
            title: "Starting XKT Sync",
            description: "Syncing 3D models for all buildings. This will complete automatically.",
        });

        runResumableSync();
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
                title: "URL sparad",
                description: "Congeria-länken har sparats.",
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Fel",
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
                title: "Synk startad",
                description: `Synkar dokument för ${linkedBuildings.length} byggnader.`,
            });

            // Refetch document count
            await fetchCongeriaData();
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Synk misslyckades",
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
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'sync-all-buildings' }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Synkar alla byggnader",
                description: "Hämtar alla byggnader från Asset+. Detta kan ta en stund.",
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
                            title: "Synk klar!",
                            description: `${latestStatus.total_assets} byggnader synkade.`,
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
                title: "Synk misslyckades",
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
                title: "Ingen byggnad",
                description: "Kunde inte hitta någon byggnad att synkronisera.",
            });
            return;
        }

        const buildingFmGuid = favoriteBuildings[0].fm_guid;
        const buildingName = favoriteBuildings[0].common_name || favoriteBuildings[0].name;

        setIsSyncingStructure(true);
        try {
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'building-sync', buildingFmGuid }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Byggnadssynk startad",
                description: `Synkar ${buildingName} med byggnadsplan och rum.`,
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
                title: "Synk misslyckades",
                description: error.message,
            });
            setIsSyncingStructure(false);
        }
    };

    // Trigger incremental sync - Legacy, uses assets sync state
    const handleIncrementalSync = async () => {
        setIsSyncingAssets(true);
        try {
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'incremental-sync' }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Inkrementell synk startad",
                description: "Synkar endast ändrade objekt sedan senaste synk.",
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
            fetchConfig();
            checkSyncStatus();
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

    // FM Access: Test connection
    const handleTestFmAccessConnection = async () => {
        setIsTestingFmAccess(true);
        setFmAccessStatus('idle');
        setFmAccessMessage('');

        try {
            const { data, error } = await supabase.functions.invoke('fm-access-query', {
                body: { action: 'test-connection' }
            });

            if (error) throw error;

            if (data?.success) {
                setFmAccessStatus('success');
                setFmAccessMessage(data.message || 'Anslutning lyckades');
                toast({
                    title: "FM Access ansluten",
                    description: data.message || 'Anslutningen till FM Access fungerar.',
                });
            } else {
                setFmAccessStatus('error');
                setFmAccessMessage(data?.error || 'Okänt fel');
                toast({
                    variant: "destructive",
                    title: "Anslutning misslyckades",
                    description: data?.error || 'Kunde inte ansluta till FM Access.',
                });
            }
        } catch (error: any) {
            setFmAccessStatus('error');
            setFmAccessMessage(error.message);
            toast({
                variant: "destructive",
                title: "Fel",
                description: error.message,
            });
        } finally {
            setIsTestingFmAccess(false);
        }
    };

    // FM Access: Save config (updates secrets via edge function)
    const handleSaveFmAccessConfig = async () => {
        setIsSavingFmAccess(true);
        try {
            // For now, just test connection to verify config is set
            const { data, error } = await supabase.functions.invoke('fm-access-query', {
                body: { action: 'test-connection' }
            });

            if (error) throw error;

            if (data?.success) {
                toast({
                    title: "Inställningar verifierade",
                    description: "FM Access-inställningarna är konfigurerade och fungerar.",
                });
                setFmAccessStatus('success');
            } else {
                toast({
                    variant: "destructive",
                    title: "Konfigurationsfel",
                    description: data?.error || 'FM Access-secrets behöver konfigureras i Cloud.',
                });
                setFmAccessStatus('error');
                setFmAccessMessage(data?.error || 'Secrets saknas');
            }
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Fel",
                description: error.message,
            });
        } finally {
            setIsSavingFmAccess(false);
        }
    };

    const handleSaveConfig = async () => {
        setIsSaving(true);
        try {
            const { data, error } = await supabase.functions.invoke('update-asset-plus-config', {
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
            const { data, error } = await supabase.functions.invoke('update-asset-plus-config', {
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
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'full-sync' }
            }).catch((err) => {
                console.log('Edge function call ended (may be timeout):', err?.message);
            });

            toast({
                title: "Sync Started",
                description: `Syncing data from Asset+. This may take a few minutes for large datasets.`,
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
        // Use fallback (e.g., last_sync_started_at) if primary is null
        const dateToUse = dateStr || fallbackDateStr;
        if (!dateToUse) return 'Aldrig';
        
        const date = new Date(dateToUse);
        // Swedish locale with date and time
        return date.toLocaleDateString('sv-SE', {
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
            <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[calc(100dvh-2rem)] sm:h-[85vh] flex flex-col">
                <DialogHeader className="flex-shrink-0 pr-8">
                    <DialogTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        App & API Settings
                    </DialogTitle>
                    <DialogDescription>
                        Manage application configurations and API connections.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 flex-1 flex flex-col min-h-0">
                    <TabsList className="flex w-full overflow-x-auto flex-shrink-0 gap-0.5 h-auto flex-wrap sm:flex-nowrap">
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
                            Symboler
                        </TabsTrigger>
                        <TabsTrigger value="viewer" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <View className="h-3 w-3 sm:h-4 sm:w-4" />
                            Viewer
                        </TabsTrigger>
                        <TabsTrigger value="voice" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Mic className="h-3 w-3 sm:h-4 sm:w-4" />
                            Röst
                        </TabsTrigger>
                        <TabsTrigger value="gunnar" className="gap-1 px-2 py-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3 whitespace-nowrap flex-shrink-0">
                            <Sparkles className="h-3 w-3 sm:h-4 sm:w-4" />
                            Gunnar
                        </TabsTrigger>
                    </TabsList>

                    {/* Profile Settings Tab */}
                    <TabsContent value="profile" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <ProfileSettings />
                    </TabsContent>

                    {/* Applications Settings Tab */}
                    <TabsContent value="apps" className="space-y-4 mt-4 flex-1 overflow-y-auto">
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
                                                        <span className="text-xs text-muted-foreground">Öppna i ny flik</span>
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

                    <TabsContent value="apis" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        {isLoadingConfig ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                    API-secrets konfigureras via Lovable Cloud. Klicka på sektionerna nedan för att se detaljer.
                                </p>
                                
                                <Accordion type="multiple" className="space-y-2">
                                    {/* Asset+ API Section */}
                                    <AccordionItem value="assetplus" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Box className="h-5 w-5 text-primary" />
                                                <span className="font-medium">Asset+</span>
                                                <Badge variant="outline" className="ml-auto mr-2 text-xs">Konfigurerad</Badge>
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
                                                        {showSecrets ? 'Dölj' : 'Visa'}
                                                    </Button>
                                                    {!isEditMode ? (
                                                        <Button variant="outline" size="sm" onClick={() => setIsEditMode(true)} className="gap-1 h-7 text-xs">
                                                            <Edit2 className="h-3 w-3" /> Redigera
                                                        </Button>
                                                    ) : (
                                                        <>
                                                            <Button onClick={handleSaveConfig} disabled={isSaving} size="sm" className="gap-1 h-7 text-xs">
                                                                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Spara
                                                            </Button>
                                                            <Button onClick={handleCancelEdit} variant="ghost" size="sm" disabled={isSaving} className="h-7 text-xs">Avbryt</Button>
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
                                                        <Input type={showSecrets ? "text" : "password"} value={isEditMode && config.clientSecret === '••••••••' ? '' : config.clientSecret} onChange={(e) => setConfig(prev => ({ ...prev, clientSecret: e.target.value }))} placeholder={isEditMode ? "Nytt värde..." : "••••••••"} disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="space-y-1.5">
                                                        <Label className="text-sm">Username</Label>
                                                        <Input value={config.username} onChange={(e) => setConfig(prev => ({ ...prev, username: e.target.value }))} placeholder="service-user@example.com" disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label className="text-sm">Password</Label>
                                                        <Input type={showSecrets ? "text" : "password"} value={isEditMode && config.password === '••••••••' ? '' : config.password} onChange={(e) => setConfig(prev => ({ ...prev, password: e.target.value }))} placeholder={isEditMode ? "Nytt värde..." : "••••••••"} disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                </div>
                                                <div className="flex items-end gap-3">
                                                    <div className="flex-1 space-y-1.5">
                                                        <Label className="text-sm">API Key</Label>
                                                        <Input type={showSecrets ? "text" : "password"} value={isEditMode && config.apiKey === '••••••••' ? '' : config.apiKey} onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))} placeholder={isEditMode ? "Nytt värde..." : "••••••••"} disabled={!isEditMode} className={`h-10 ${!isEditMode ? "bg-muted" : ""}`} />
                                                    </div>
                                                    <Button onClick={handleTestConnection} disabled={isTestingConnection || isEditMode} variant="outline" className="gap-2 h-10">
                                                        {isTestingConnection ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                                                        {isTestingConnection ? 'Testar...' : 'Testa'}
                                                    </Button>
                                                </div>
                                                {connectionStatus !== 'idle' && (
                                                    <div className={`rounded-lg border p-3 text-sm ${connectionStatus === 'success' ? 'bg-green-50 border-green-200 dark:bg-green-950/30' : 'bg-red-50 border-red-200 dark:bg-red-950/30'}`}>
                                                        <div className="flex items-start gap-2">
                                                            {connectionStatus === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
                                                            <div><p className="font-medium">{connectionStatus === 'success' ? 'Anslutning lyckades' : 'Anslutning misslyckades'}</p><p className="text-xs">{connectionMessage}</p></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* FM Access API Section */}
                                    <AccordionItem value="fmaccess" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Building2 className="h-5 w-5 text-primary" />
                                                <span className="font-medium">FM Access</span>
                                                {fmAccessStatus === 'success' && <Badge className="ml-auto mr-2 text-xs bg-green-100 text-green-800">Ansluten</Badge>}
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <p className="text-xs text-muted-foreground mb-3">Secrets konfigureras i Lovable Cloud (FM_ACCESS_API_URL, FM_ACCESS_USERNAME, FM_ACCESS_PASSWORD).</p>
                                            <div className="flex gap-2">
                                                <Button variant="outline" size="sm" onClick={handleTestFmAccessConnection} disabled={isTestingFmAccess}>
                                                    {isTestingFmAccess ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                                                    Testa anslutning
                                                </Button>
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

                                    {/* Senslinc API Section */}
                                    <AccordionItem value="senslinc" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Zap className="h-5 w-5 text-yellow-500" />
                                                <span className="font-medium">Senslinc</span>
                                                <Badge variant="outline" className="ml-auto mr-2 text-xs bg-green-50 text-green-700 border-green-200">IoT</Badge>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <div className="space-y-4">
                                                <p className="text-xs text-muted-foreground">
                                                    IoT-sensorer och mätvärden från Senslinc (InUse). Secrets (SENSLINC_API_URL, SENSLINC_EMAIL, SENSLINC_PASSWORD) konfigureras i Lovable Cloud.
                                                </p>
                                                
                                                {/* Polling interval setting */}
                                                <div className="space-y-2">
                                                    <Label className="text-sm font-medium">Pollningsintervall</Label>
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
                                                        {SENSLINC_POLL_OPTIONS.map(opt => (
                                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                        ))}
                                                    </select>
                                                    <p className="text-xs text-muted-foreground">
                                                        Hur ofta sensordata ska hämtas automatiskt. Standard är var 24:e timme.
                                                    </p>
                                                </div>

                                                <div className="flex gap-2">
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        onClick={async () => {
                                                            try {
                                                                const { data, error } = await supabase.functions.invoke('senslinc-query', { 
                                                                    body: { action: 'test-connection' } 
                                                                });
                                                                if (error) throw error;
                                                                toast({ 
                                                                    title: data?.success ? 'Anslutning OK' : 'Misslyckades', 
                                                                    description: data?.message || data?.error 
                                                                });
                                                            } catch (err: any) { 
                                                                toast({ 
                                                                    variant: 'destructive', 
                                                                    title: 'Fel', 
                                                                    description: err.message 
                                                                }); 
                                                            }
                                                        }}
                                                    >
                                                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Testa anslutning
                                                    </Button>
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm" 
                                                        onClick={async () => {
                                                            try {
                                                                const { data, error } = await supabase.functions.invoke('senslinc-query', { 
                                                                    body: { action: 'get-sites' } 
                                                                });
                                                                if (error) throw error;
                                                                const count = Array.isArray(data?.data) ? data.data.length : 0;
                                                                toast({ 
                                                                    title: 'Data hämtad', 
                                                                    description: `Hittade ${count} sites i Senslinc.` 
                                                                });
                                                            } catch (err: any) { 
                                                                toast({ 
                                                                    variant: 'destructive', 
                                                                    title: 'Fel', 
                                                                    description: err.message 
                                                                }); 
                                                            }
                                                        }}
                                                    >
                                                        <Database className="h-3.5 w-3.5 mr-1.5" /> Hämta data nu
                                                    </Button>
                                                </div>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* Faciliate API Section */}
                                    <AccordionItem value="faciliate" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Wrench className="h-5 w-5 text-orange-500" />
                                                <span className="font-medium">Faciliate</span>
                                                <Badge variant="outline" className="ml-auto mr-2 text-xs bg-orange-50 text-orange-700 border-orange-200">FM System</Badge>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <p className="text-xs text-muted-foreground">Integration med Faciliate för arbetsorder. Inte konfigurerad ännu.</p>
                                        </AccordionContent>
                                    </AccordionItem>

                                    {/* Autodesk Construction Cloud (ACC) Section */}
                                    <AccordionItem value="acc" className="border rounded-lg">
                                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                                            <div className="flex items-center gap-2 flex-1">
                                                <Layers className="h-5 w-5 text-blue-500" />
                                                <span className="font-medium">Autodesk Construction Cloud</span>
                                                {accAuthStatus === 'authenticated' && <Badge className="ml-auto mr-2 text-xs bg-green-100 text-green-800 border-green-200">Inloggad</Badge>}
                                                {accAuthStatus === 'unauthenticated' && accConnectionStatus === 'success' && <Badge className="ml-auto mr-2 text-xs bg-yellow-100 text-yellow-800 border-yellow-200">App-token</Badge>}
                                                {accAuthStatus === 'unauthenticated' && accConnectionStatus === 'idle' && <Badge variant="outline" className="ml-auto mr-2 text-xs">ACC</Badge>}
                                                {accAuthStatus === 'checking' && <Loader2 className="ml-auto mr-2 h-3.5 w-3.5 animate-spin" />}
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent className="px-4 pb-4 pt-2">
                                            <div className="space-y-4">
                                                <p className="text-xs text-muted-foreground">
                                                    Integration med Autodesk Construction Cloud. Logga in med ditt Autodesk-konto för att ge appen tillgång till dina ACC-projekt.
                                                </p>

                                                {/* Autodesk Login Section */}
                                                <div className="rounded-lg border p-3 space-y-3">
                                                    <Label className="text-sm font-medium">Autodesk-inloggning (3-legged OAuth)</Label>
                                                    {accAuthStatus === 'authenticated' ? (
                                                        <div className="flex items-center gap-2">
                                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                                            <span className="text-sm text-green-700 dark:text-green-400">Inloggad med Autodesk-konto</span>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={handleAutodeskLogout}
                                                                disabled={isAccLoggingOut}
                                                                className="ml-auto"
                                                            >
                                                                {isAccLoggingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Logga ut'}
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
                                                                Logga in med Autodesk
                                                            </Button>
                                                            <p className="text-xs text-muted-foreground">
                                                                Öppnar Autodesk-inloggning i ett popup-fönster. Dina API-anrop använder sedan dina egna behörigheter.
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-sm font-medium">Region</Label>
                                                    <div className="flex gap-2">
                                                        <Button
                                                            variant={accRegion === 'US' ? 'default' : 'outline'}
                                                            size="sm"
                                                            onClick={() => {
                                                                setAccRegion('US');
                                                                setAccFolders(null);
                                                                setAccTopLevelItems([]);
                                                                setAccProjects([]);
                                                            }}
                                                        >
                                                            US
                                                        </Button>
                                                        <Button
                                                            variant={accRegion === 'EMEA' ? 'default' : 'outline'}
                                                            size="sm"
                                                            onClick={() => {
                                                                setAccRegion('EMEA');
                                                                setAccFolders(null);
                                                                setAccTopLevelItems([]);
                                                                setAccProjects([]);
                                                            }}
                                                        >
                                                            EMEA
                                                        </Button>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">Välj den region där ditt ACC-konto finns. Varje region använder sitt eget Account ID (ACC_ACCOUNT_ID_US / ACC_ACCOUNT_ID_EMEA).</p>
                                                </div>

                                                <div className="flex gap-2 flex-col sm:flex-row sm:flex-wrap">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={handleTestAccConnection}
                                                        disabled={isTestingAcc}
                                                        className="w-full sm:w-auto"
                                                    >
                                                        {isTestingAcc ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
                                                        Testa anslutning
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={handleFetchAccProjects}
                                                        disabled={isLoadingAccProjects}
                                                        className="w-full sm:w-auto"
                                                    >
                                                        {isLoadingAccProjects ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Database className="h-3.5 w-3.5 mr-1.5" />}
                                                        Hämta projekt
                                                    </Button>
                                                </div>

                                                {accConnectionStatus !== 'idle' && (
                                                    <div className={`rounded-lg border p-3 text-sm ${accConnectionStatus === 'success' ? 'bg-green-50 border-green-200 dark:bg-green-950/30' : 'bg-red-50 border-red-200 dark:bg-red-950/30'}`}>
                                                        <div className="flex items-start gap-2">
                                                            {accConnectionStatus === 'success' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
                                                            <div>
                                                                <p className="font-medium">{accConnectionStatus === 'success' ? 'Anslutning lyckades' : 'Anslutning misslyckades'}</p>
                                                                <p className="text-xs">{accConnectionMessage}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {accProjects.length > 0 && (
                                                    <div className="space-y-2">
                                                        <Label className="text-sm font-medium">Välj ACC-projekt</Label>
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
                                                    <Label className="text-sm font-medium text-muted-foreground">Eller ange projekt-ID manuellt</Label>
                                                    <Input
                                                        placeholder="Klistra in ACC projekt-ID (GUID från URL:en)"
                                                        value={manualAccProjectId}
                                                        onChange={(e) => setManualAccProjectId(e.target.value)}
                                                        className="font-mono text-xs"
                                                    />
                                                    <p className="text-xs text-muted-foreground">
                                                        Om projekthämtningen inte fungerar kan du kopiera projekt-ID:t från ACC-webbadressen och klistra in det här.
                                                    </p>
                                                </div>

                                                {(selectedAccProjectId || manualAccProjectId.trim()) && (
                                                    <div className="flex gap-2 flex-col sm:flex-row sm:flex-wrap">
                                                        <Button
                                                            onClick={handleSyncAccLocations}
                                                            disabled={isSyncingAccLocations || isSyncingAccAssets}
                                                            size="sm"
                                                            className="gap-1 w-full sm:w-auto"
                                                        >
                                                            {isSyncingAccLocations ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
                                                            Synka platser
                                                        </Button>
                                                        <Button
                                                            onClick={handleSyncAccAssets}
                                                            disabled={isSyncingAccLocations || isSyncingAccAssets}
                                                            size="sm"
                                                            variant="secondary"
                                                            className="gap-1 w-full sm:w-auto"
                                                        >
                                                            {isSyncingAccAssets ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
                                                            Synka tillgångar
                                                        </Button>
                                                        <Button
                                                            onClick={handleFetchAccFolders}
                                                            disabled={isLoadingAccFolders}
                                                            size="sm"
                                                            variant="outline"
                                                            className="gap-1 w-full sm:w-auto"
                                                        >
                                                            {isLoadingAccFolders ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                                                            Visa mappar
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

                                                {/* ACC Folder Browser */}
                                                {accFolders !== null && (
                                                    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                                                        <div className="flex items-center justify-between">
                                                            <Label className="text-sm font-medium flex items-center gap-1.5">
                                                                <FolderOpen className="h-4 w-4" />
                                                                {accRootFolderName || 'Mappar'}
                                                            </Label>
                                                            <span className="text-xs text-muted-foreground">{accFolders.length} mappar</span>
                                                        </div>
                                                        
                                                        {accFolders.length === 0 && accTopLevelItems.length === 0 && (
                                                            <p className="text-xs text-muted-foreground italic">Inga mappar eller filer hittades.</p>
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
                                                                />
                                                            ))}

                                                            {accTopLevelItems.length > 0 && (
                                                                <div className="pt-1 border-t">
                                                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide px-2.5 py-1">Filer i rotkatalogen</p>
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
                                                )}

                                                {accStatus && (
                                                    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                                                        <div className="flex items-center justify-between text-sm">
                                                            <span className="text-muted-foreground">Platser (lokalt):</span>
                                                            <span className="font-medium">{accStatus.localLocationCount}</span>
                                                        </div>
                                                        <div className="flex items-center justify-between text-sm">
                                                            <span className="text-muted-foreground">Tillgångar (lokalt):</span>
                                                            <span className="font-medium">{accStatus.localAssetCount}</span>
                                                        </div>
                                                        {accStatus.locationsSyncState && (
                                                            <div className="flex items-center justify-between text-sm">
                                                                <span className="text-muted-foreground">Plats-synk:</span>
                                                                <span className="font-medium">{accStatus.locationsSyncState.sync_status}</span>
                                                            </div>
                                                        )}
                                                        {accStatus.assetsSyncState && (
                                                            <div className="flex items-center justify-between text-sm">
                                                                <span className="text-muted-foreground">Tillgångs-synk:</span>
                                                                <span className="font-medium">{accStatus.assetsSyncState.sync_status}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* ACC -> Asset+ Sync Section */}
                                                <div className="rounded-lg border p-3 space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-sm font-medium flex items-center gap-1.5">
                                                            <Box className="h-4 w-4 text-primary" />
                                                            Synka till Asset+
                                                        </Label>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={handleCheckAccToAssetPlus}
                                                            disabled={isCheckingAccToAp}
                                                            className="h-7 text-xs gap-1"
                                                        >
                                                            {isCheckingAccToAp ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                            Status
                                                        </Button>
                                                    </div>

                                                    <p className="text-xs text-muted-foreground">
                                                        Skapa ACC-synkade objekt i Asset+ med genererade UUID:n. Byggnader, plan, rum och installationer skapas hierarkiskt.
                                                    </p>

                                                    {accToApStatus && (
                                                        <div className="space-y-1.5 text-sm">
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">ACC-objekt totalt:</span>
                                                                <span className="font-medium">{accToApStatus.totalAccObjects}</span>
                                                            </div>
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Synkade till Asset+:</span>
                                                                <span className="font-medium">{accToApStatus.syncedToAssetPlus}</span>
                                                            </div>
                                                            <div className="flex justify-between">
                                                                <span className="text-muted-foreground">Ej synkade:</span>
                                                                <Badge variant={accToApStatus.unsyncedCount > 0 ? "destructive" : "secondary"} className="text-xs">
                                                                    {accToApStatus.unsyncedCount}
                                                                </Badge>
                                                            </div>
                                                            {accToApStatus.buildings?.length > 0 && (
                                                                <div className="mt-2 space-y-1">
                                                                    <p className="text-xs font-medium text-muted-foreground">Byggnader:</p>
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
                                                        onClick={handleSyncAccToAssetPlus}
                                                        disabled={isSyncingAccToAp}
                                                        size="sm"
                                                        className="w-full gap-1.5"
                                                    >
                                                        {isSyncingAccToAp ? (
                                                            <>
                                                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                                Synkar till Asset+...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Box className="h-3.5 w-3.5" />
                                                                Synka ACC → Asset+
                                                            </>
                                                        )}
                                                    </Button>

                                                    {accToApResult && (
                                                        <div className={`rounded-lg border p-2.5 text-xs space-y-1 ${accToApResult.success ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800'}`}>
                                                            <p className="font-medium">{accToApResult.success ? 'Synk lyckades' : 'Synk med varningar'}</p>
                                                            {accToApResult.summary && (
                                                                <div className="space-y-0.5">
                                                                    <p>Byggnader: {accToApResult.summary.created?.buildings || 0} skapade</p>
                                                                    <p>Plan: {accToApResult.summary.created?.levels || 0} | Rum: {accToApResult.summary.created?.spaces || 0} | Instanser: {accToApResult.summary.created?.instances || 0}</p>
                                                                    <p>Relationer: {accToApResult.summary.totalRelationships || 0} | Egenskaper: {accToApResult.summary.totalPropertiesUpdated || 0}</p>
                                                                    {accToApResult.summary.totalErrors > 0 && (
                                                                        <p className="text-red-600 dark:text-red-400">Fel: {accToApResult.summary.totalErrors}</p>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                </Accordion>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="sync" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <div className="space-y-6">
                            {/* Asset+ Sync Header */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Box className="h-5 w-5 text-primary" />
                                    <h4 className="font-medium">Asset+ Synkronisering</h4>
                                </div>
                                <Button
                                    onClick={checkSyncStatus}
                                    disabled={isCheckingSync}
                                    size="sm"
                                    variant="outline"
                                    className="gap-1 h-8 text-xs"
                                >
                                    {isCheckingSync ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-3 w-3" />
                                    )}
                                    Kontrollera status
                                </Button>
                            </div>

                            {/* 1. Structure Sync Card */}
                            <SyncProgressCard
                                icon={<Building2 className="h-5 w-5 text-primary" />}
                                title="Byggnad/Plan/Rum"
                                subtitle="Byggnader, våningsplan och rum"
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
                                totalSynced={syncCheck?.structure?.syncState?.total_assets}
                            />

                            {/* 2. Assets Sync Card */}
                            <SyncProgressCard
                                icon={<Layers className="h-5 w-5 text-primary" />}
                                title="Alla Tillgångar"
                                subtitle="Installationer och inventarier (per byggnad)"
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
                                        ? `Byggnad ${(syncProgress.currentBuildingIndex + 1)} av ${syncProgress.totalBuildings} • ${(syncProgress.totalSynced || 0).toLocaleString()} objekt`
                                        : undefined
                                }
                                totalSynced={syncProgress?.totalSynced}
                                extraActions={
                                    <Button
                                        onClick={handleResetAssetsProgress}
                                        size="sm"
                                        variant="ghost"
                                        className="gap-1 h-8 text-xs text-muted-foreground"
                                        title="Återställ progress"
                                    >
                                        <RefreshCw className="h-3 w-3" />
                                    </Button>
                                }
                            />

                            {/* 3. XKT Sync Card */}
                            <SyncProgressCard
                                icon={<Box className="h-5 w-5 text-primary" />}
                                title="XKT-filer"
                                subtitle="3D-modellfiler för snabbare laddning"
                                localCount={syncCheck?.xkt?.localCount || 0}
                                remoteLabel={syncCheck?.xkt?.buildingCount ? `${syncCheck.xkt.buildingCount} byggnader` : undefined}
                                inSync={syncCheck?.xkt?.localCount && syncCheck.xkt.localCount > 0 ? true : false}
                                isSyncing={isSyncingXkt}
                                isCheckingSync={isCheckingSync}
                                disabled={isSyncingStructure || isSyncingAssets || isSyncingXkt}
                                onSync={handleSyncXkt}
                                syncButtonVariant="secondary"
                                syncStartedAt={syncCheck?.xkt?.syncState?.last_sync_started_at}
                                syncCompletedAt={syncCheck?.xkt?.syncState?.last_sync_completed_at}
                                syncStatus={syncCheck?.xkt?.syncState?.sync_status}
                                errorMessage={syncCheck?.xkt?.syncState?.error_message}
                            />

                            {/* Total Summary */}
                            {syncCheck && (
                                <div className="rounded-lg border bg-muted/30 p-3">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="text-muted-foreground">Totalt i lokal databas:</span>
                                        <span className="font-medium">{syncCheck.total?.localCount?.toLocaleString() || assetCount.toLocaleString()} objekt</span>
                                    </div>
                                    <div className="flex items-center justify-between text-sm mt-1">
                                        <span className="text-muted-foreground">Totalt i Asset+:</span>
                                        <span className="font-medium">{syncCheck.total?.remoteCount?.toLocaleString() || '?'} objekt</span>
                                    </div>
                                </div>
                            )}

                            {/* FM Access Sync Section */}
                            <div className="border rounded-lg p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Building2 className="h-5 w-5 text-primary" />
                                        <div>
                                            <h4 className="font-medium">FM Access</h4>
                                            <p className="text-xs text-muted-foreground">0 objekt synkade</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-xs">Kommer snart</Badge>
                                        <Button 
                                            disabled
                                            size="sm"
                                            variant="outline"
                                            className="gap-1 h-8 text-xs"
                                        >
                                            <RefreshCw className="h-3 w-3" />
                                            Starta synk
                                        </Button>
                                    </div>
                                </div>
                                <div className="text-center py-4 text-muted-foreground border rounded-lg bg-muted/30">
                                    <Database className="h-6 w-6 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">Konfigurera FM Access API först</p>
                                </div>
                            </div>

                            {/* Senslinc Sync Section */}
                            <div className="border rounded-lg p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Radar className="h-5 w-5 text-primary" />
                                        <div>
                                            <h4 className="font-medium">Senslinc</h4>
                                            <p className="text-xs text-muted-foreground">IoT-sensorer via Senslinc (InUse)</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button 
                                            size="sm"
                                            variant="outline"
                                            className="gap-1 h-8 text-xs"
                                            onClick={async () => {
                                                try {
                                                    const { data, error } = await supabase.functions.invoke('senslinc-query', {
                                                        body: { action: 'get-indices' }
                                                    });
                                                    if (error) throw error;
                                                    if (data?.success) {
                                                        toast({
                                                            title: 'Anslutning OK',
                                                            description: `Hittade ${data.indices?.length || 0} index i Senslinc.`,
                                                        });
                                                    } else {
                                                        toast({
                                                            variant: 'destructive',
                                                            title: 'Anslutningsfel',
                                                            description: data?.error || 'Kunde inte nå Senslinc API (möjlig rate limit)',
                                                        });
                                                    }
                                                } catch (err: any) {
                                                    toast({
                                                        variant: 'destructive',
                                                        title: 'Fel',
                                                        description: err.message,
                                                    });
                                                }
                                            }}
                                        >
                                            <RefreshCw className="h-3 w-3" />
                                            Testa anslutning
                                        </Button>
                                    </div>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Tryck "Testa anslutning" för att kontrollera om Senslinc API:t är tillgängligt. Om du får rate limit-fel (429), vänta en stund och försök igen.
                                </p>
                            </div>

                            {/* Ivion Sync Section */}
                            <div className="border rounded-lg p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Zap className="h-5 w-5 text-primary" />
                                        <div>
                                            <h4 className="font-medium">Ivion</h4>
                                            <p className="text-xs text-muted-foreground">0 platser synkade</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-xs">Kommer snart</Badge>
                                        <Button 
                                            disabled
                                            size="sm"
                                            variant="outline"
                                            className="gap-1 h-8 text-xs"
                                        >
                                            <RefreshCw className="h-3 w-3" />
                                            Starta synk
                                        </Button>
                                    </div>
                                </div>
                                <div className="text-center py-4 text-muted-foreground border rounded-lg bg-muted/30">
                                    <Database className="h-6 w-6 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">Konfigurera Ivion API först</p>
                                </div>
                            </div>

                            {/* Congeria Document Sync Section */}
                            <div className="border rounded-lg p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <FileText className="h-5 w-5 text-blue-500" />
                                        <div>
                                            <h4 className="font-medium">Congeria Dokument</h4>
                                            <p className="text-xs text-muted-foreground">{documentCount} dokument synkade</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button 
                                            onClick={handleSyncAllCongeria}
                                            disabled={isSyncingCongeria || Object.keys(congeriaLinks).length === 0}
                                            size="sm"
                                            variant="outline"
                                            className="gap-1 h-8 text-xs"
                                        >
                                            {isSyncingCongeria ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-3 w-3" />
                                            )}
                                            Synka alla
                                        </Button>
                                    </div>
                                </div>
                                
                                {/* Building URL mapping */}
                                <div className="space-y-2">
                                    <p className="text-xs text-muted-foreground">
                                        Ange Congeria mapp-URL för varje byggnad
                                    </p>
                                    {allBuildings.length === 0 ? (
                                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-muted/30">
                                            <Database className="h-6 w-6 mx-auto mb-2 opacity-50" />
                                            <p className="text-sm">Synka byggnader från Asset+ först</p>
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
                        </div>
                    </TabsContent>

                    {/* Symbols Settings Tab */}
                    <TabsContent value="symbols" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <SymbolSettings />
                    </TabsContent>

                    {/* Viewer Settings Tab (Themes + Room Labels) */}
                    <TabsContent value="viewer" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <Accordion type="multiple" defaultValue={['themes', 'labels']} className="space-y-2">
                            <AccordionItem value="themes" className="border rounded-lg px-4">
                                <AccordionTrigger className="py-3">
                                    <div className="flex items-center gap-2">
                                        <Palette className="h-4 w-4" />
                                        <span>Viewer-teman</span>
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
                                        <span>Rumsetiketter</span>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <RoomLabelSettings />
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </TabsContent>

                    {/* Voice Settings Tab */}
                    <TabsContent value="voice" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <VoiceSettings />
                    </TabsContent>

                    {/* Gunnar AI Settings Tab */}
                    <TabsContent value="gunnar" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <GunnarSettings />
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
