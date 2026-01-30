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
    LayoutGrid, ExternalLink, Building2, Archive, Radar, BarChart2, Circle, Layers, Wrench, Mic, Palette, View, User
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AppContext } from '@/context/AppContext';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';
import SymbolSettings from './SymbolSettings';
import VoiceSettings from './VoiceSettings';
import ViewerThemeSettings from './ViewerThemeSettings';
import ProfileSettings from './ProfileSettings';

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

    // Sync structure (buildings, storeys, spaces)
    const handleSyncStructure = async () => {
        setIsSyncingStructure(true);
        try {
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'sync-structure' }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Synkar struktur",
                description: "Hämtar byggnader, våningsplan och rum från Asset+.",
            });

            // Poll only fetchSyncStatus, not checkSyncStatus continuously
            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
            }, 3000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncingStructure(false);
                fetchSyncStatus();
                checkSyncStatus(); // Only check once when done
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

    // Sync all assets (chunked by building)
    const handleSyncAssetsChunked = async () => {
        setIsSyncingAssets(true);
        try {
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'sync-assets-chunked' }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Synkar tillgångar",
                description: "Hämtar alla tillgångar byggnad för byggnad. Detta kan ta lång tid.",
            });

            // Poll only fetchSyncStatus, not checkSyncStatus continuously
            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
            }, 5000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncingAssets(false);
                fetchSyncStatus();
                checkSyncStatus(); // Only check once when done
            }, 600000);

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Synk misslyckades",
                description: error.message,
            });
            setIsSyncingAssets(false);
        }
    };

    // Sync all XKT models to database
    const handleSyncXkt = async () => {
        setIsSyncingXkt(true);
        try {
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'sync-xkt' }
            }).catch((err) => {
                console.log('Edge function call ended:', err?.message);
            });

            toast({
                title: "Synkar XKT-filer",
                description: "Hämtar och sparar 3D-modeller till databasen för snabbare laddning.",
            });

            // Poll only fetchSyncStatus, not checkSyncStatus continuously
            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
            }, 5000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncingXkt(false);
                fetchSyncStatus();
                checkSyncStatus(); // Only check once when done
            }, 600000);

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Synk misslyckades",
                description: error.message,
            });
            setIsSyncingXkt(false);
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
            fetchFavoriteBuildings();
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
            <DialogContent className="sm:max-w-2xl h-full sm:h-[85vh] flex flex-col">
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
                    <TabsList className="grid w-full grid-cols-6 flex-shrink-0">
                        <TabsTrigger value="apps" className="gap-1 px-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3">
                            <LayoutGrid className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline">Apps</span>
                        </TabsTrigger>
                        <TabsTrigger value="apis" className="gap-1 px-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3">
                            <Settings2 className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline">API's</span>
                        </TabsTrigger>
                        <TabsTrigger value="sync" className="gap-1 px-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3">
                            <Database className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline">Sync</span>
                        </TabsTrigger>
                        <TabsTrigger value="symbols" className="gap-1 px-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3">
                            <Circle className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline">Symboler</span>
                        </TabsTrigger>
                        <TabsTrigger value="themes" className="gap-1 px-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3">
                            <Palette className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline">Teman</span>
                        </TabsTrigger>
                        <TabsTrigger value="voice" className="gap-1 px-1.5 text-[10px] sm:text-sm sm:gap-2 sm:px-3">
                            <Mic className="h-3 w-3 sm:h-4 sm:w-4" />
                            <span className="hidden sm:inline">Röst</span>
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
                            
                            {Object.entries(DEFAULT_APP_CONFIGS).map(([key, defaultCfg]: [string, any]) => {
                                const cfg = appConfigs[key] || defaultCfg;
                                const IconComp = getAppIcon(key);
                                
                                return (
                                    <div key={key} className="border rounded-lg p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <IconComp className="h-5 w-5 text-primary" />
                                                <h4 className="font-medium">{cfg.label}</h4>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-muted-foreground">
                                                    {cfg.openMode === 'external' ? 'New Tab' : 'In App'}
                                                </span>
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
                                );
                            })}
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
                                
                                {/* Asset+ API Section */}
                                <details className="border rounded-lg group">
                                    <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 font-medium list-none">
                                        <Box className="h-5 w-5 text-primary" />
                                        <span>Asset+</span>
                                        <Badge variant="outline" className="ml-auto text-xs">Konfigurerad</Badge>
                                    </summary>
                                    <div className="px-4 pb-4 space-y-4 border-t pt-4">
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
                                </details>

                                {/* FM Access API Section */}
                                <details className="border rounded-lg">
                                    <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 font-medium list-none">
                                        <Building2 className="h-5 w-5 text-primary" />
                                        <span>FM Access</span>
                                        {fmAccessStatus === 'success' && <Badge className="ml-auto text-xs bg-green-100 text-green-800">Ansluten</Badge>}
                                    </summary>
                                    <div className="px-4 pb-4 space-y-3 border-t pt-4">
                                        <p className="text-xs text-muted-foreground">Secrets konfigureras i Lovable Cloud (FM_ACCESS_API_URL, FM_ACCESS_USERNAME, FM_ACCESS_PASSWORD).</p>
                                        <div className="flex gap-2">
                                            <Button variant="outline" size="sm" onClick={handleTestFmAccessConnection} disabled={isTestingFmAccess}>
                                                {isTestingFmAccess ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                                                Testa anslutning
                                            </Button>
                                        </div>
                                    </div>
                                </details>

                                {/* Ivion API Section */}
                                <details className="border rounded-lg">
                                    <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 font-medium list-none">
                                        <View className="h-5 w-5 text-primary" />
                                        <span>Ivion (360+)</span>
                                        <Badge variant="outline" className="ml-auto text-xs bg-green-50 text-green-700 border-green-200">Aktiv</Badge>
                                    </summary>
                                    <div className="px-4 pb-4 space-y-3 border-t pt-4">
                                        <p className="text-xs text-muted-foreground">Integration med NavVis Ivion för 360°-panorama. Secrets (IVION_API_URL, IVION_USERNAME, IVION_PASSWORD) konfigureras i Lovable Cloud.</p>
                                        <div className="space-y-2">
                                            <Label className="text-xs">Embed URL för Ivion</Label>
                                            <div className="flex gap-2">
                                                <Input value={`${window.location.origin}/ivion-create`} readOnly className="h-8 text-sm font-mono bg-muted" />
                                                <Button variant="outline" size="sm" className="h-8" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/ivion-create`); toast({ title: 'Kopierat!' }); }}>
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                        <Button variant="outline" size="sm" onClick={async () => {
                                            try {
                                                const { data, error } = await supabase.functions.invoke('ivion-poi', { body: { action: 'test-connection' } });
                                                if (error) throw error;
                                                toast({ title: data?.success ? 'Anslutning OK' : 'Misslyckades', description: data?.message });
                                            } catch (err: any) { toast({ variant: 'destructive', title: 'Fel', description: err.message }); }
                                        }}>
                                            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Testa anslutning
                                        </Button>
                                    </div>
                                </details>

                                {/* Senslinc API Section */}
                                <details className="border rounded-lg">
                                    <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 font-medium list-none">
                                        <Radar className="h-5 w-5 text-primary" />
                                        <span>Senslinc</span>
                                        <Badge variant="outline" className="ml-auto text-xs">Kommer snart</Badge>
                                    </summary>
                                    <div className="px-4 pb-4 space-y-3 border-t pt-4">
                                        <p className="text-xs text-muted-foreground">IoT-sensorer och mätvärden. Inte konfigurerad ännu.</p>
                                    </div>
                                </details>

                                {/* Faciliate API Section */}
                                <details className="border rounded-lg">
                                    <summary className="px-4 py-3 cursor-pointer flex items-center gap-2 font-medium list-none">
                                        <Wrench className="h-5 w-5 text-orange-500" />
                                        <span>Faciliate</span>
                                        <Badge variant="outline" className="ml-auto text-xs bg-orange-50 text-orange-700 border-orange-200">FM System</Badge>
                                    </summary>
                                    <div className="px-4 pb-4 space-y-3 border-t pt-4">
                                        <p className="text-xs text-muted-foreground">Integration med Faciliate för arbetsorder. Inte konfigurerad ännu.</p>
                                    </div>
                                </details>
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
                            <div className="border rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Building2 className="h-5 w-5 text-blue-600" />
                                        <div>
                                            <h4 className="font-medium">Byggnad/Plan/Rum</h4>
                                            <p className="text-xs text-muted-foreground">
                                                Byggnader, våningsplan och rum
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isCheckingSync ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : syncCheck?.structure ? (
                                            syncCheck.structure.inSync ? (
                                                <Badge variant="default" className="bg-green-600 text-xs gap-1">
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    I synk
                                                </Badge>
                                            ) : (
                                                <Badge variant="destructive" className="text-xs gap-1">
                                                    <AlertCircle className="h-3 w-3" />
                                                    Ej synkad
                                                </Badge>
                                            )
                                        ) : null}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        {syncCheck?.structure?.localCount?.toLocaleString() || '0'} lokala • {syncCheck?.structure?.remoteCount?.toLocaleString() || '?'} i Asset+
                                    </p>
                                    <Button 
                                        onClick={handleSyncStructure}
                                        disabled={isSyncingStructure || isSyncingAssets || isSyncingXkt}
                                        size="sm"
                                        className="gap-1 h-8"
                                    >
                                        {isSyncingStructure ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <RefreshCw className="h-3 w-3" />
                                        )}
                                        Synka
                                    </Button>
                                </div>
                                {syncCheck?.structure?.syncState && (
                                    <div className="text-xs text-muted-foreground border-t pt-2">
                                        {syncCheck.structure.syncState.sync_status === 'running' ? 'Synkar...' : 'Senast: '}
                                        {formatDate(syncCheck.structure.syncState.last_sync_completed_at, syncCheck.structure.syncState.last_sync_started_at)}
                                        {syncCheck.structure.syncState.error_message && (
                                            <span className="text-destructive ml-2">{syncCheck.structure.syncState.error_message}</span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 2. Assets Sync Card */}
                            <div className="border rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Layers className="h-5 w-5 text-purple-600" />
                                        <div>
                                            <h4 className="font-medium">Alla Tillgångar</h4>
                                            <p className="text-xs text-muted-foreground">
                                                Installationer och inventarier (per byggnad)
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isCheckingSync ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : syncCheck?.assets ? (
                                            syncCheck.assets.inSync ? (
                                                <Badge variant="default" className="bg-green-600 text-xs gap-1">
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    I synk
                                                </Badge>
                                            ) : (
                                                <Badge variant="destructive" className="text-xs gap-1">
                                                    <AlertCircle className="h-3 w-3" />
                                                    Ej synkad
                                                </Badge>
                                            )
                                        ) : null}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        {syncCheck?.assets?.localCount?.toLocaleString() || '0'} lokala • {syncCheck?.assets?.remoteCount?.toLocaleString() || '?'} i Asset+
                                    </p>
                                    <Button 
                                        onClick={handleSyncAssetsChunked}
                                        disabled={isSyncingStructure || isSyncingAssets || isSyncingXkt}
                                        size="sm"
                                        className="gap-1 h-8"
                                    >
                                        {isSyncingAssets ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <RefreshCw className="h-3 w-3" />
                                        )}
                                        Synka
                                    </Button>
                                </div>
                                {syncCheck?.assets?.syncState && (
                                    <div className="text-xs text-muted-foreground border-t pt-2">
                                        {syncCheck.assets.syncState.sync_status === 'running' 
                                            ? `Synkar... ${syncCheck.assets.syncState.subtree_name || ''}`
                                            : 'Senast: '}
                                        {syncCheck.assets.syncState.sync_status !== 'running' && 
                                            formatDate(syncCheck.assets.syncState.last_sync_completed_at, syncCheck.assets.syncState.last_sync_started_at)}
                                        {syncCheck.assets.syncState.error_message && (
                                            <span className="text-destructive ml-2">{syncCheck.assets.syncState.error_message}</span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 3. XKT Sync Card */}
                            <div className="border rounded-lg p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Box className="h-5 w-5 text-orange-600" />
                                        <div>
                                            <h4 className="font-medium">XKT-filer</h4>
                                            <p className="text-xs text-muted-foreground">
                                                3D-modellfiler för snabbare laddning
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {isCheckingSync ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : syncCheck?.xkt?.localCount && syncCheck.xkt.localCount > 0 ? (
                                            <Badge variant="default" className="bg-green-600 text-xs gap-1">
                                                <CheckCircle2 className="h-3 w-3" />
                                                I synk
                                            </Badge>
                                        ) : (
                                            <Badge variant="destructive" className="text-xs gap-1">
                                                <AlertCircle className="h-3 w-3" />
                                                Ej synkad
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">
                                        {syncCheck?.xkt?.localCount || 0} modeller synkade 
                                        {syncCheck?.xkt?.buildingCount ? ` (${syncCheck.xkt.buildingCount} byggnader)` : ''}
                                    </p>
                                    <Button 
                                        onClick={handleSyncXkt}
                                        disabled={isSyncingStructure || isSyncingAssets || isSyncingXkt}
                                        size="sm"
                                        variant="secondary"
                                        className="gap-1 h-8"
                                    >
                                        {isSyncingXkt ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                            <RefreshCw className="h-3 w-3" />
                                        )}
                                        Synka
                                    </Button>
                                </div>
                                {syncCheck?.xkt?.syncState && (
                                    <div className="text-xs text-muted-foreground border-t pt-2">
                                        {syncCheck.xkt.syncState.sync_status === 'running' 
                                            ? `Cachar... ${syncCheck.xkt.syncState.subtree_name || ''}`
                                            : 'Senast: '}
                                        {syncCheck.xkt.syncState.sync_status !== 'running' && 
                                            formatDate(syncCheck.xkt.syncState.last_sync_completed_at, syncCheck.xkt.syncState.last_sync_started_at)}
                                        {syncCheck.xkt.syncState.error_message && (
                                            <span className="text-destructive ml-2 line-clamp-1">{syncCheck.xkt.syncState.error_message}</span>
                                        )}
                                    </div>
                                )}
                            </div>

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
                                            <p className="text-xs text-muted-foreground">0 sensorer synkade</p>
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
                                    <p className="text-sm">Konfigurera Senslinc API först</p>
                                </div>
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
                        </div>
                    </TabsContent>

                    {/* Symbols Settings Tab */}
                    <TabsContent value="symbols" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <SymbolSettings />
                    </TabsContent>

                    {/* Viewer Themes Settings Tab */}
                    <TabsContent value="themes" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <ViewerThemeSettings />
                    </TabsContent>

                    {/* Voice Settings Tab */}
                    <TabsContent value="voice" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <VoiceSettings />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

export default ApiSettingsModal;
