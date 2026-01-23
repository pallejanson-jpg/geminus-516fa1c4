import React, { useState, useEffect } from 'react';
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
    Loader2, Server, Clock, Eye, EyeOff, Zap, Settings2, Save, Edit2
} from 'lucide-react';
import { Badge } from "@/components/ui/badge";

interface ApiSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface SyncStatus {
    subtree_id: string;
    subtree_name: string | null;
    sync_status: string;
    total_assets: number;
    last_sync_completed_at: string | null;
    error_message: string | null;
}

interface ConfigState {
    keycloakUrl: string;
    apiUrl: string;
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    apiKey: string;
}

const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ isOpen, onClose }) => {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState('assetplus');
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([]);
    const [assetCount, setAssetCount] = useState<number>(0);
    
    // Config form state
    const [config, setConfig] = useState<ConfigState>({
        keycloakUrl: '',
        apiUrl: '',
        clientId: '',
        clientSecret: '',
        username: '',
        password: '',
        apiKey: '',
    });
    const [showSecrets, setShowSecrets] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [connectionMessage, setConnectionMessage] = useState('');
    const [isLoadingConfig, setIsLoadingConfig] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [originalConfig, setOriginalConfig] = useState<ConfigState | null>(null);

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

    useEffect(() => {
        if (isOpen) {
            fetchSyncStatus();
            fetchConfig();
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
                    title: "Uppdatera secrets",
                    description: `Följande secrets måste uppdateras i Lovable: ${data.secretsToUpdate.join(", ")}`,
                    duration: 10000,
                });
            }

            setIsEditMode(false);
            setOriginalConfig(config);
            
            toast({
                title: "Konfiguration sparad",
                description: "Värdena har registrerats. Uppdatera secrets i Lovable för att tillämpa ändringarna.",
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Fel vid sparning",
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
                    title: "Anslutning lyckades",
                    description: data.message,
                });
            } else {
                setConnectionStatus('error');
                setConnectionMessage(data?.error || 'Okänt fel');
                toast({
                    variant: "destructive",
                    title: "Anslutning misslyckades",
                    description: data?.error,
                });
            }
        } catch (error: any) {
            setConnectionStatus('error');
            setConnectionMessage(error.message);
            toast({
                variant: "destructive",
                title: "Fel",
                description: error.message,
            });
        } finally {
            setIsTestingConnection(false);
        }
    };

    const handleTriggerSync = async () => {
        setIsSyncing(true);
        try {
            const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
                body: { action: 'full-sync' }
            });

            if (error) throw error;

            toast({
                title: "Synkronisering startad",
                description: `Synkar data från Asset+...`,
            });

            // Poll for status updates
            const pollInterval = setInterval(async () => {
                await fetchSyncStatus();
            }, 2000);

            // Stop polling after 30 seconds
            setTimeout(() => {
                clearInterval(pollInterval);
                setIsSyncing(false);
                fetchSyncStatus();
            }, 30000);

        } catch (error: any) {
            console.error('Sync error:', error);
            toast({
                variant: "destructive",
                title: "Synkronisering misslyckades",
                description: error.message || "Kunde inte starta synkronisering",
            });
            setIsSyncing(false);
        }
    };

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Aldrig';
        return new Date(dateStr).toLocaleString('sv-SE');
    };

    const getSyncStatusBadge = (status: string) => {
        switch (status) {
            case 'completed':
                return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1" />Klar</Badge>;
            case 'running':
                return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Synkar</Badge>;
            case 'failed':
                return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Fel</Badge>;
            default:
                return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Väntar</Badge>;
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        API-inställningar
                    </DialogTitle>
                    <DialogDescription>
                        Hantera anslutningar till externa system och synkronisering av data.
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="assetplus" className="gap-2">
                            <Box className="h-4 w-4" />
                            Asset+
                        </TabsTrigger>
                        <TabsTrigger value="sync" className="gap-2">
                            <Database className="h-4 w-4" />
                            Datasynk
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="assetplus" className="space-y-4 mt-4">
                        {isLoadingConfig ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="font-medium flex items-center gap-2">
                                            <Settings2 className="h-4 w-4" />
                                            Keycloak & API-konfiguration
                                        </h4>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setShowSecrets(!showSecrets)}
                                                className="gap-2"
                                            >
                                                {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                {showSecrets ? 'Dölj' : 'Visa'}
                                            </Button>
                                            {!isEditMode && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setIsEditMode(true)}
                                                    className="gap-2"
                                                >
                                                    <Edit2 className="h-4 w-4" />
                                                    Redigera
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid gap-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="keycloakUrl">Keycloak Token URL</Label>
                                                <Input
                                                    id="keycloakUrl"
                                                    value={config.keycloakUrl}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, keycloakUrl: e.target.value }))}
                                                    placeholder="https://auth.example.com/realms/xxx/protocol/openid-connect/token"
                                                    disabled={!isEditMode}
                                                    className={!isEditMode ? "bg-muted" : ""}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="apiUrl">API URL</Label>
                                                <Input
                                                    id="apiUrl"
                                                    value={config.apiUrl}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                                                    placeholder="https://api.example.com"
                                                    disabled={!isEditMode}
                                                    className={!isEditMode ? "bg-muted" : ""}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="clientId">Client ID</Label>
                                                <Input
                                                    id="clientId"
                                                    value={config.clientId}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, clientId: e.target.value }))}
                                                    placeholder="my-client-id"
                                                    disabled={!isEditMode}
                                                    className={!isEditMode ? "bg-muted" : ""}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="clientSecret">Client Secret</Label>
                                                <Input
                                                    id="clientSecret"
                                                    type={showSecrets ? "text" : "password"}
                                                    value={isEditMode && config.clientSecret === '••••••••' ? '' : config.clientSecret}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, clientSecret: e.target.value }))}
                                                    placeholder={isEditMode ? "Ange nytt värde..." : "••••••••"}
                                                    disabled={!isEditMode}
                                                    className={!isEditMode ? "bg-muted" : ""}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="username">Användarnamn</Label>
                                                <Input
                                                    id="username"
                                                    value={config.username}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, username: e.target.value }))}
                                                    placeholder="service-user"
                                                    disabled={!isEditMode}
                                                    className={!isEditMode ? "bg-muted" : ""}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="password">Lösenord</Label>
                                                <Input
                                                    id="password"
                                                    type={showSecrets ? "text" : "password"}
                                                    value={isEditMode && config.password === '••••••••' ? '' : config.password}
                                                    onChange={(e) => setConfig(prev => ({ ...prev, password: e.target.value }))}
                                                    placeholder={isEditMode ? "Ange nytt värde..." : "••••••••"}
                                                    disabled={!isEditMode}
                                                    className={!isEditMode ? "bg-muted" : ""}
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="apiKey">API Key</Label>
                                            <Input
                                                id="apiKey"
                                                type={showSecrets ? "text" : "password"}
                                                value={isEditMode && config.apiKey === '••••••••' ? '' : config.apiKey}
                                                onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                                                placeholder={isEditMode ? "Ange nytt värde..." : "••••••••"}
                                                disabled={!isEditMode}
                                                className={!isEditMode ? "bg-muted" : ""}
                                            />
                                        </div>
                                    </div>

                                    {isEditMode ? (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3">
                                            <p className="text-sm text-amber-800 dark:text-amber-200">
                                                <strong>OBS:</strong> Efter att du sparar kommer du behöva uppdatera secrets i Lovable manuellt. 
                                                Skriv i chatten: "Uppdatera ASSET_PLUS_CLIENT_ID till [värde]" etc.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="rounded-lg border p-3 bg-muted/30">
                                            <p className="text-sm text-muted-foreground">
                                                <strong>OBS:</strong> Dessa värden hanteras som säkra backend-secrets. 
                                                Klicka på "Redigera" för att ändra dem.
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Connection test result */}
                                {connectionStatus !== 'idle' && (
                                    <div className={`rounded-lg border p-4 ${
                                        connectionStatus === 'success' 
                                            ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' 
                                            : 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
                                    }`}>
                                        <div className="flex items-start gap-3">
                                            {connectionStatus === 'success' ? (
                                                <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                                            ) : (
                                                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                                            )}
                                            <div>
                                                <p className={`font-medium ${
                                                    connectionStatus === 'success' ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                                                }`}>
                                                    {connectionStatus === 'success' ? 'Anslutning lyckades' : 'Anslutning misslyckades'}
                                                </p>
                                                <p className={`text-sm ${
                                                    connectionStatus === 'success' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                                                }`}>
                                                    {connectionMessage}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    {isEditMode ? (
                                        <>
                                            <Button
                                                onClick={handleSaveConfig}
                                                disabled={isSaving}
                                                className="gap-2"
                                            >
                                                {isSaving ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <Save className="h-4 w-4" />
                                                )}
                                                {isSaving ? 'Sparar...' : 'Spara ändringar'}
                                            </Button>
                                            <Button
                                                onClick={handleCancelEdit}
                                                variant="outline"
                                                disabled={isSaving}
                                            >
                                                Avbryt
                                            </Button>
                                        </>
                                    ) : (
                                        <Button
                                            onClick={handleTestConnection}
                                            disabled={isTestingConnection}
                                            variant="outline"
                                            className="gap-2"
                                        >
                                            {isTestingConnection ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Zap className="h-4 w-4" />
                                            )}
                                            {isTestingConnection ? 'Testar...' : 'Testa anslutning'}
                                        </Button>
                                    )}
                                </div>
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="sync" className="space-y-4 mt-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h4 className="font-medium">Synkronisera från Asset+</h4>
                                <p className="text-sm text-muted-foreground">
                                    {assetCount.toLocaleString()} assets i lokal databas
                                </p>
                            </div>
                            <Button 
                                onClick={handleTriggerSync} 
                                disabled={isSyncing}
                                className="gap-2"
                            >
                                {isSyncing ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <RefreshCw className="h-4 w-4" />
                                )}
                                {isSyncing ? 'Synkar...' : 'Starta synk'}
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <h5 className="text-sm font-medium text-muted-foreground">Sync-status</h5>
                            {syncStatuses.length === 0 ? (
                                <div className="text-center py-6 text-muted-foreground border rounded-lg">
                                    <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p>Ingen synkronisering har körts ännu</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {syncStatuses.map((status) => (
                                        <div 
                                            key={status.subtree_id} 
                                            className="flex items-center justify-between p-3 rounded-lg border"
                                        >
                                            <div className="flex-1">
                                                <p className="font-medium">{status.subtree_name || status.subtree_id}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {status.total_assets} assets • Senast: {formatDate(status.last_sync_completed_at)}
                                                </p>
                                                {status.error_message && (
                                                    <p className="text-xs text-destructive mt-1">{status.error_message}</p>
                                                )}
                                            </div>
                                            {getSyncStatusBadge(status.sync_status)}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};

export default ApiSettingsModal;
