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
    Loader2, Server, Clock 
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

const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ isOpen, onClose }) => {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState('assetplus');
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncStatuses, setSyncStatuses] = useState<SyncStatus[]>([]);
    const [assetCount, setAssetCount] = useState<number>(0);

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
        }
    }, [isOpen]);

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
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
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
                        <div className="rounded-lg border p-4 bg-muted/30">
                            <h4 className="font-medium mb-2 flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                Asset+ är konfigurerat
                            </h4>
                            <p className="text-sm text-muted-foreground">
                                API-credentials hanteras säkert som backend-secrets. 
                                Kontakta administratör för att uppdatera credentials.
                            </p>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 rounded-lg border">
                                <div>
                                    <p className="font-medium">Keycloak OAuth</p>
                                    <p className="text-sm text-muted-foreground">Autentisering mot Asset+ API</p>
                                </div>
                                <Badge variant="outline" className="text-green-600 border-green-600">Aktiv</Badge>
                            </div>
                            <div className="flex items-center justify-between p-3 rounded-lg border">
                                <div>
                                    <p className="font-medium">API Endpoint</p>
                                    <p className="text-sm text-muted-foreground">ASSET_PLUS_API_URL</p>
                                </div>
                                <Badge variant="outline" className="text-green-600 border-green-600">Konfigurerad</Badge>
                            </div>
                        </div>
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
