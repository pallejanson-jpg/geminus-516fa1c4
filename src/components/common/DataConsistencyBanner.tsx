import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, RefreshCw, X, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface DeltaResult {
  localCount: number;
  remoteCount: number;
  orphanCount: number;
  newCount: number;
  inSync: boolean;
  discrepancy: number;
  message: string;
}

const DISMISS_KEY = 'data-consistency-dismissed';
const DEMO_MODE_KEY = 'geminus-demo-mode';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function isDismissedInStorage(): boolean {
  try {
    if (localStorage.getItem(DEMO_MODE_KEY) === 'true') return true;
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const { dismissedAt } = JSON.parse(raw);
    return Date.now() - dismissedAt < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export const DataConsistencyBanner: React.FC = () => {
  const [deltaResult, setDeltaResult] = useState<DeltaResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(() => isDismissedInStorage());
  const { toast } = useToast();
  const resumeRef = useRef(false);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify({ dismissedAt: Date.now() }));
    } catch {}
  };

  const checkDelta = async () => {
    setIsChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
        body: { action: 'check-delta' }
      });
      
      if (error) throw error;
      
      if (data?.success) {
        setDeltaResult(data);
      }
    } catch (error) {
      console.error('Failed to check data consistency:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const syncWithCleanup = async () => {
    if (resumeRef.current) return;
    resumeRef.current = true;
    setIsSyncing(true);

    try {
      toast({
        title: 'Syncing...',
        description: 'Step 1: Syncing building structure (buildings, floors, rooms)...',
      });

      // Step 1: Resumable structure sync loop
      const runStructureLoop = async () => {
        try {
          const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
            body: { action: 'sync-structure' }
          });

          if (error) {
            console.error('Structure sync error:', error);
            toast({ variant: 'destructive', title: 'Sync error', description: error.message });
            setIsSyncing(false);
            resumeRef.current = false;
            return;
          }

          if (data?.interrupted) {
            toast({
              title: 'Syncing structure...',
              description: `${data.totalSynced || 0} items so far (${data.phase})...`,
            });
            setTimeout(() => runStructureLoop(), 2000);
          } else {
            // Structure done — start asset loop
            toast({
              title: 'Structure synced',
              description: `${data?.totalSynced || 0} structural objects synced. Starting asset sync...`,
            });
            runAssetLoop();
          }
        } catch (err: any) {
          console.error('Structure sync exception:', err);
          toast({ variant: 'destructive', title: 'Sync error', description: err.message || 'Unknown error' });
          setIsSyncing(false);
          resumeRef.current = false;
        }
      };

      // Step 2: Resumable asset sync loop
      const runAssetLoop = async () => {
        try {
          const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
            body: { action: 'sync-assets-resumable' }
          });

          if (error) {
            console.error('Asset sync error:', error);
            toast({ variant: 'destructive', title: 'Sync error', description: error.message });
            setIsSyncing(false);
            resumeRef.current = false;
            return;
          }

          if (data?.interrupted) {
            setTimeout(() => runAssetLoop(), 2000);
          } else {
            toast({
              title: 'Sync complete',
              description: `${data?.totalSynced || 0} assets synced.`,
            });
            setIsSyncing(false);
            resumeRef.current = false;
            setDeltaResult(null);
            setDismissed(false);
            try { localStorage.removeItem(DISMISS_KEY); } catch {}

            window.dispatchEvent(new CustomEvent('asset-sync-completed', {
              detail: { totalSynced: data?.totalSynced }
            }));

            setTimeout(checkDelta, 2000);
          }
        } catch (err: any) {
          console.error('Asset sync exception:', err);
          toast({ variant: 'destructive', title: 'Sync error', description: err.message || 'Unknown error' });
          setIsSyncing(false);
          resumeRef.current = false;
        }
      };

      runStructureLoop();
    } catch (error) {
      console.error('Sync failed:', error);
      toast({
        title: 'Sync failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setIsSyncing(false);
      resumeRef.current = false;
    }
  };

  useEffect(() => {
    if (dismissed) return;
    checkDelta();
  }, [dismissed]);

  if (dismissed || deltaResult?.inSync || isChecking || !deltaResult) {
    return null;
  }

  return (
    <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 mx-4 mt-2">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0 mt-0.5" />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <span>Data discrepancy detected</span>
          </div>
          
          <div className="mt-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Database className="h-3.5 w-3.5" />
                Local: {deltaResult.localCount.toLocaleString()}
              </span>
              <span>Asset+: {deltaResult.remoteCount.toLocaleString()}</span>
            </div>
            <p className="mt-1">{deltaResult.message}</p>
          </div>
          
          <p className="mt-1 text-xs text-muted-foreground/70 italic">ACC data is managed via Asset+ and FM Access.</p>
          
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={syncWithCleanup}
              disabled={isSyncing}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync with Asset+'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={dismiss}
            >
              Dismiss
            </Button>
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default DataConsistencyBanner;
