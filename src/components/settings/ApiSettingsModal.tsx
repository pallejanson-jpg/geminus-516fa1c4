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
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
    Box, Database, RefreshCw, CheckCircle2, AlertCircle, 
    Loader2, Server, Clock, Eye, EyeOff, Zap, Settings2, Save, Edit2,
    LayoutGrid, ExternalLink, Building2, Archive, Radar, BarChart2, Circle, Layers, Wrench
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { AppContext } from '@/context/AppContext';
import { DEFAULT_APP_CONFIGS } from '@/lib/constants';
import SymbolSettings from './SymbolSettings';

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

interface SyncCheckResult {
    inSync: boolean;
    localCount: number;
    remoteCount: number;
    modifiedSinceLastSync: number;
    lastSyncAt: string | null;
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
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([]);
    const [assetCount, setAssetCount] = useState<number>(0);
    const [syncCheck, setSyncCheck] = useState<SyncCheckResult | null>(null);
    const [isCheckingSync, setIsCheckingSync] = useState(false);
    
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
                setSyncCheck(data as SyncCheckResult);
            }
        } catch (error) {
            console.error('Failed to check sync status:', error);
        } finally {
            setIsCheckingSync(false);
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

    // Trigger sync for all buildings (objectType 1 only)
    const handleSyncAllBuildings = async () => {
        setIsSyncing(true);
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

            // Poll for status
            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
                const latestStatus = syncStatuses.find(s => s.subtree_id === 'buildings');
                if (latestStatus?.sync_status === 'completed' || latestStatus?.sync_status === 'failed') {
                    clearInterval(pollInterval);
                    setIsSyncing(false);
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
                setIsSyncing(false);
                fetchSyncStatus();
                checkSyncStatus();
            }, 300000);

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Synk misslyckades",
                description: error.message,
            });
            setIsSyncing(false);
        }
    };

    // Trigger building sync
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

        setIsSyncing(true);
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

            // Poll for status
            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
                const latestStatus = syncStatuses.find(s => s.subtree_id === buildingFmGuid);
                if (latestStatus?.sync_status === 'completed' || latestStatus?.sync_status === 'failed') {
                    clearInterval(pollInterval);
                    setIsSyncing(false);
                    checkSyncStatus();
                }
            }, 3000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncing(false);
                fetchSyncStatus();
                checkSyncStatus();
            }, 300000);

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Synk misslyckades",
                description: error.message,
            });
            setIsSyncing(false);
        }
    };

    // Trigger incremental sync
    const handleIncrementalSync = async () => {
        setIsSyncing(true);
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

            // Poll for status
            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
                const latestStatus = syncStatuses.find(s => s.subtree_id === 'full');
                if (latestStatus?.sync_status === 'completed' || latestStatus?.sync_status === 'failed') {
                    clearInterval(pollInterval);
                    setIsSyncing(false);
                    checkSyncStatus(); // Refresh sync check
                }
            }, 3000);

            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncing(false);
                fetchSyncStatus();
                checkSyncStatus();
            }, 300000);

        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Sync Failed",
                description: error.message,
            });
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchSyncStatus();
            fetchConfig();
            checkSyncStatus();
            fetchFavoriteBuildings();
            setConnectionStatus('idle');
            setConnectionMessage('');
            setIsEditMode(false);
        }
    }, [isOpen]);

    const handleCancelEdit = () => {
        if (originalConfig) {
            setConfig(originalConfig);
        }
        setIsEditMode(false);
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

    const handleTriggerSync = async () => {
        setIsSyncing(true);
        try {
            // Fire and forget - the edge function may timeout for large datasets
            // but continues syncing in batches. We track progress via polling.
            supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'full-sync' }
            }).catch((err) => {
                // Edge function timeout is expected for large datasets
                console.log('Edge function call ended (may be timeout):', err?.message);
            });

            toast({
                title: "Sync Started",
                description: `Syncing data from Asset+. This may take a few minutes for large datasets.`,
            });

            // Poll for status updates - longer duration for large datasets
            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
                // Check if sync completed or failed
                const latestStatus = syncStatuses.find(s => s.subtree_id === 'full');
                if (latestStatus?.sync_status === 'completed' || latestStatus?.sync_status === 'failed') {
                    clearInterval(pollInterval);
                    setIsSyncing(false);
                }
            }, 3000);

            // Stop polling after 5 minutes max
            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncing(false);
                fetchSyncStatus();
            }, 300000);

        } catch (error: any) {
            console.error('Sync error:', error);
            toast({
                variant: "destructive",
                title: "Sync Failed",
                description: error.message || "Could not start synchronization",
            });
            setIsSyncing(false);
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
                    <TabsList className="grid w-full grid-cols-4 flex-shrink-0">
                        <TabsTrigger value="apps" className="gap-2">
                            <LayoutGrid className="h-4 w-4" />
                            Apps
                        </TabsTrigger>
                        <TabsTrigger value="apis" className="gap-2">
                            <Settings2 className="h-4 w-4" />
                            API's
                        </TabsTrigger>
                        <TabsTrigger value="sync" className="gap-2">
                            <Database className="h-4 w-4" />
                            Sync
                        </TabsTrigger>
                        <TabsTrigger value="symbols" className="gap-2">
                            <Circle className="h-4 w-4" />
                            Symboler
                        </TabsTrigger>
                    </TabsList>

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
                            <div className="space-y-6">
                                {/* Asset+ API Section */}
                                <div className="border rounded-lg p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Box className="h-5 w-5 text-primary" />
                                            <h4 className="font-medium">Asset+</h4>
                                        </div>
                                        <div className="flex items-center gap-2">
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
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setIsEditMode(true)}
                                                    className="gap-1 h-7 text-xs"
                                                >
                                                    <Edit2 className="h-3 w-3" />
                                                    Edit
                                                </Button>
                                            ) : (
                                                <>
                                                    <Button
                                                        onClick={handleSaveConfig}
                                                        disabled={isSaving}
                                                        size="sm"
                                                        className="gap-1 h-7 text-xs"
                                                    >
                                                        {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                                        Save
                                                    </Button>
                                                    <Button
                                                        onClick={handleCancelEdit}
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={isSaving}
                                                        className="h-7 text-xs"
                                                    >
                                                        Cancel
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid gap-4">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <Label className="text-sm font-medium">OpenID Token Endpoint</Label>
                                                <Input
                                                    value={config.keycloakUrl}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, keycloakUrl: e.target.value }))}
                                                    placeholder="https://sso.example.com/realms/xxx/..."
                                                    disabled={!isEditMode}
                                                    className={`h-11 text-base ${!isEditMode ? "bg-muted" : ""}`}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-sm font-medium">API URL</Label>
                                                <Input
                                                    value={config.apiUrl}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                                                    placeholder="https://api.example.com"
                                                    disabled={!isEditMode}
                                                    className={`h-11 text-base ${!isEditMode ? "bg-muted" : ""}`}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <Label className="text-sm font-medium">Client ID</Label>
                                                <Input
                                                    value={config.clientId}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, clientId: e.target.value }))}
                                                    placeholder="asset-api"
                                                    disabled={!isEditMode}
                                                    className={`h-11 text-base ${!isEditMode ? "bg-muted" : ""}`}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-sm font-medium">Client Secret</Label>
                                                <Input
                                                    type={showSecrets ? "text" : "password"}
                                                    value={isEditMode && config.clientSecret === '••••••••' ? '' : config.clientSecret}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, clientSecret: e.target.value }))}
                                                    placeholder={isEditMode ? "Enter new value..." : "••••••••"}
                                                    disabled={!isEditMode}
                                                    className={`h-11 text-base ${!isEditMode ? "bg-muted" : ""}`}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <Label className="text-sm font-medium">Username</Label>
                                                <Input
                                                    value={config.username}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, username: e.target.value }))}
                                                    placeholder="service-user@example.com"
                                                    disabled={!isEditMode}
                                                    className={`h-11 text-base ${!isEditMode ? "bg-muted" : ""}`}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-sm font-medium">Password</Label>
                                                <Input
                                                    type={showSecrets ? "text" : "password"}
                                                    value={isEditMode && config.password === '••••••••' ? '' : config.password}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, password: e.target.value }))}
                                                    placeholder={isEditMode ? "Enter new value..." : "••••••••"}
                                                    disabled={!isEditMode}
                                                    className={`h-11 text-base ${!isEditMode ? "bg-muted" : ""}`}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <Label className="text-sm font-medium">API Key</Label>
                                                <Input
                                                    type={showSecrets ? "text" : "password"}
                                                    value={isEditMode && config.apiKey === '••••••••' ? '' : config.apiKey}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                                                    placeholder={isEditMode ? "Enter new value..." : "••••••••"}
                                                    disabled={!isEditMode}
                                                    className={`h-11 text-base ${!isEditMode ? "bg-muted" : ""}`}
                                                />
                                            </div>
                                            <div className="space-y-1.5 flex items-end">
                                                <Button
                                                    onClick={handleTestConnection}
                                                    disabled={isTestingConnection || isEditMode}
                                                    variant="outline"
                                                    className="gap-2 h-11"
                                                >
                                                    {isTestingConnection ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Zap className="h-4 w-4" />
                                                    )}
                                                    {isTestingConnection ? 'Testing...' : 'Test Connection'}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Connection test result */}
                                    {connectionStatus !== 'idle' && (
                                        <div className={`rounded-lg border p-3 text-sm ${
                                            connectionStatus === 'success' 
                                                ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' 
                                                : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
                                        }`}>
                                            <div className="flex items-start gap-2">
                                                {connectionStatus === 'success' ? (
                                                    <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                                                ) : (
                                                    <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                                                )}
                                                <div>
                                                    <p className={`font-medium ${
                                                        connectionStatus === 'success' ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                                                    }`}>
                                                        {connectionStatus === 'success' ? 'Connection Successful' : 'Connection Failed'}
                                                    </p>
                                                    <p className={`text-xs ${
                                                        connectionStatus === 'success' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                                                    }`}>
                                                        {connectionMessage}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* FM Access API Section */}
                                <div className="border rounded-lg p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Building2 className="h-5 w-5 text-primary" />
                                            <h4 className="font-medium">FM Access</h4>
                                        </div>
                                        <Badge variant="secondary" className="text-xs">Konfiguration</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Anslut till FM Access för att hämta ritningar och dokument. Token URL och Client ID är förkonfigurerade.
                                    </p>
                                    <div className="space-y-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Token URL</Label>
                                            <Input
                                                placeholder="https://auth.bim.cloud/auth/realms/swg_demo/protocol/openid-connect/token"
                                                defaultValue="https://auth.bim.cloud/auth/realms/swg_demo/protocol/openid-connect/token"
                                                className="h-9 text-sm font-mono"
                                                readOnly
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">Client ID</Label>
                                                <Input
                                                    placeholder="HDCAgent Basic"
                                                    defaultValue="HDCAgent Basic"
                                                    className="h-9 text-sm"
                                                    readOnly
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">API Base URL</Label>
                                                <Input
                                                    placeholder="https://api.fmaccess.se"
                                                    className="h-9 text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">Username (valfritt)</Label>
                                                <Input
                                                    placeholder="Användarnamn"
                                                    className="h-9 text-sm"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Password (valfritt)</Label>
                                                <Input
                                                    type="password"
                                                    placeholder="••••••••"
                                                    className="h-9 text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex gap-2 pt-2">
                                            <Button variant="outline" size="sm" className="flex-1" disabled>
                                                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                                Testa anslutning
                                            </Button>
                                            <Button variant="default" size="sm" className="flex-1" disabled>
                                                <Save className="h-3.5 w-3.5 mr-1.5" />
                                                Spara
                                            </Button>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground">
                                            Obs: FM Access-integration kräver att secrets konfigureras i Lovable Cloud. Kontakta admin för att aktivera.
                                        </p>
                                    </div>
                                </div>

                                {/* Senslinc API Section */}
                                <div className="border rounded-lg p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Radar className="h-5 w-5 text-primary" />
                                            <h4 className="font-medium">Senslinc</h4>
                                        </div>
                                        <Badge variant="outline" className="text-xs">Kommer snart</Badge>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs">API URL</Label>
                                            <Input
                                                placeholder="https://api.senslinc.se"
                                                disabled
                                                className="h-8 text-sm bg-muted"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">API Key</Label>
                                            <Input
                                                type="password"
                                                placeholder="••••••••"
                                                disabled
                                                className="h-8 text-sm bg-muted"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Ivion API Section */}
                                <div className="border rounded-lg p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Zap className="h-5 w-5 text-primary" />
                                            <h4 className="font-medium">Ivion</h4>
                                        </div>
                                        <Badge variant="outline" className="text-xs">Kommer snart</Badge>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Base URL</Label>
                                            <Input
                                                placeholder="https://ivion.se"
                                                disabled
                                                className="h-8 text-sm bg-muted"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">API Token</Label>
                                            <Input
                                                type="password"
                                                placeholder="••••••••"
                                                disabled
                                                className="h-8 text-sm bg-muted"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Faciliate API Section */}
                                <div className="border rounded-lg p-4 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Wrench className="h-5 w-5 text-orange-500" />
                                            <h4 className="font-medium">Faciliate</h4>
                                        </div>
                                        <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                                            FM System
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Integration med Faciliate för arbetsorder och underhållshantering.
                                        Konfigureras via REST API med JWT eller Basic Auth.
                                    </p>
                                    <div className="grid grid-cols-1 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs">API Base URL</Label>
                                            <Input
                                                placeholder="https://faciliate.example.com/api/v2"
                                                disabled
                                                className="h-8 text-sm bg-muted"
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="space-y-1">
                                                <Label className="text-xs">Username</Label>
                                                <Input
                                                    placeholder="api-user"
                                                    disabled
                                                    className="h-8 text-sm bg-muted"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-xs">Password / Token</Label>
                                                <Input
                                                    type="password"
                                                    placeholder="••••••••"
                                                    disabled
                                                    className="h-8 text-sm bg-muted"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                                        <strong>Endpoints:</strong> /workorder, /building, /customer
                                    </div>
                                </div>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="sync" className="space-y-4 mt-4 flex-1 overflow-y-auto">
                        <div className="space-y-6">
                            {/* Asset+ Sync Section */}
                            <div className="border rounded-lg p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Box className="h-5 w-5 text-primary" />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-medium">Asset+</h4>
                                                {/* Sync status indicator */}
                                                {isCheckingSync ? (
                                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                ) : syncCheck ? (
                                                    syncCheck.inSync ? (
                                                        <Badge variant="default" className="bg-green-600 text-xs gap-1">
                                                            <CheckCircle2 className="h-3 w-3" />
                                                            I synk
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="destructive" className="text-xs gap-1">
                                                            <AlertCircle className="h-3 w-3" />
                                                            {syncCheck.modifiedSinceLastSync > 0 
                                                                ? `${syncCheck.modifiedSinceLastSync} ändringar` 
                                                                : 'Ej synkad'}
                                                        </Badge>
                                                    )
                                                ) : null}
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                {assetCount.toLocaleString()} lokala • {syncCheck?.remoteCount?.toLocaleString() || '?'} i Asset+
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
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
                                                <CheckCircle2 className="h-3 w-3" />
                                            )}
                                            Kontrollera
                                        </Button>
                                        <Button 
                                            onClick={handleSyncAllBuildings}
                                            disabled={isSyncing}
                                            size="sm"
                                            variant="outline"
                                            className="gap-1 h-8 text-xs"
                                        >
                                            {isSyncing ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <Building2 className="h-3 w-3" />
                                            )}
                                            Alla Byggnader
                                        </Button>
                                        <Button 
                                            onClick={handleBuildingSync}
                                            disabled={isSyncing || favoriteBuildings.length === 0}
                                            size="sm"
                                            variant="secondary"
                                            className="gap-1 h-8 text-xs"
                                        >
                                            {isSyncing ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <Layers className="h-3 w-3" />
                                            )}
                                            Synka Plan+Rum
                                        </Button>
                                        <Button 
                                            onClick={syncCheck?.inSync ? handleIncrementalSync : handleTriggerSync}
                                            disabled={isSyncing}
                                            size="sm"
                                            className="gap-1 h-8 text-xs"
                                        >
                                            {isSyncing ? (
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                                <RefreshCw className="h-3 w-3" />
                                            )}
                                            {isSyncing ? 'Synkar...' : (syncCheck?.inSync ? 'Uppdatera' : 'Full synk')}
                                        </Button>
                                    </div>
                                </div>

                                {/* Sync info card */}
                                {syncCheck && !syncCheck.inSync && (
                                    <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 p-3">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
                                            <div className="text-sm">
                                                <p className="font-medium text-amber-800 dark:text-amber-200">Synkronisering rekommenderas</p>
                                                <p className="text-xs text-amber-700 dark:text-amber-300">
                                                    {syncCheck.modifiedSinceLastSync > 0 
                                                        ? `${syncCheck.modifiedSinceLastSync} objekt har ändrats i Asset+ sedan ${formatDate(syncCheck.lastSyncAt)}`
                                                        : `Lokal databas (${syncCheck.localCount}) matchar inte Asset+ (${syncCheck.remoteCount})`}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {syncStatuses.length === 0 ? (
                                    <div className="text-center py-4 text-muted-foreground border rounded-lg bg-muted/30">
                                        <Database className="h-6 w-6 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">Ingen synkronisering har körts ännu</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {syncStatuses.map((status) => (
                                            <div 
                                                key={status.subtree_id} 
                                                className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                                            >
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium">{status.subtree_name || status.subtree_id}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {status.total_assets.toLocaleString()} objekt • 
                                                        {status.sync_status === 'running' ? ' Startad: ' : ' Senast: '}
                                                        {status.sync_status === 'running' 
                                                            ? formatDate(status.last_sync_started_at)
                                                            : formatDate(status.last_sync_completed_at, status.last_sync_started_at)}
                                                    </p>
                                                    {status.error_message && (
                                                        <p className="text-xs text-destructive mt-1 line-clamp-2">{status.error_message}</p>
                                                    )}
                                                </div>
                                                {getSyncStatusBadge(status.sync_status)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

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
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

export default ApiSettingsModal;
