import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, RefreshCw, X, Database, Building2, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { SyncStatusLog, type SyncStep, type SyncOutcome } from '@/components/settings/SyncStatusLog';

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
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

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
  const [isSyncingStructure, setIsSyncingStructure] = useState(false);
  const [isSyncingAssets, setIsSyncingAssets] = useState(false);
  const [dismissed, setDismissed] = useState(() => isDismissedInStorage());
  const { toast } = useToast();
  const resumeRef = useRef(false);

  // Sync log state
  const [syncSteps, setSyncSteps] = useState<SyncStep[]>([]);
  const [syncOutcome, setSyncOutcome] = useState<SyncOutcome | null>(null);

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
      if (data?.success) setDeltaResult(data);
    } catch (error) {
      console.error('Failed to check data consistency:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const updateStep = (id: string, updates: Partial<SyncStep>) => {
    setSyncSteps(prev => {
      const existing = prev.find(s => s.id === id);
      if (existing) return prev.map(s => s.id === id ? { ...s, ...updates } : s);
      return [...prev, { id, label: id, status: 'pending' as const, ...updates }];
    });
  };

  const syncStructure = async () => {
    if (isSyncingStructure) return;
    setIsSyncingStructure(true);
    setSyncSteps([{ id: 'structure', label: 'Syncing buildings, floors & rooms', status: 'running', startedAt: Date.now() }]);
    setSyncOutcome(null);
    const startTime = Date.now();

    const runLoop = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
          body: { action: 'sync-structure' }
        });
        if (error) throw error;

        if (data?.interrupted) {
          updateStep('structure', { count: data.totalSynced || 0, message: data.phase });
          setTimeout(() => runLoop(), 2000);
          return;
        }

        updateStep('structure', { status: 'done', count: data?.totalSynced || 0, completedAt: Date.now() });
        setSyncOutcome({
          success: true,
          summary: `${(data?.totalSynced || 0).toLocaleString()} buildings/floors/rooms synced`,
          durationMs: Date.now() - startTime,
        });
        setIsSyncingStructure(false);
        setTimeout(checkDelta, 2000);
      } catch (err: any) {
        updateStep('structure', { status: 'error', message: err.message, completedAt: Date.now() });
        setSyncOutcome({ success: false, summary: 'Structure sync failed', details: [err.message], durationMs: Date.now() - startTime });
        setIsSyncingStructure(false);
      }
    };

    runLoop();
  };

  const syncAssets = async () => {
    if (isSyncingAssets || resumeRef.current) return;
    resumeRef.current = true;
    setIsSyncingAssets(true);
    setSyncSteps([
      { id: 'pull', label: 'Pulling assets from Asset+', status: 'running', startedAt: Date.now() },
      { id: 'push', label: 'Pushing local objects to Asset+', status: 'pending' },
    ]);
    setSyncOutcome(null);
    const startTime = Date.now();
    let totalPulled = 0;

    const runLoop = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
          body: { action: 'sync-assets-resumable' }
        });

        if (error) {
          const errorMsg = error.message || '';
          if (errorMsg.includes('Sort exceeded memory limit')) {
            setTimeout(() => runLoop(), 2000);
            return;
          }
          updateStep('pull', { status: 'error', message: error.message, completedAt: Date.now() });
          setSyncOutcome({ success: false, summary: 'Asset sync failed', details: [error.message], durationMs: Date.now() - startTime });
          setIsSyncingAssets(false);
          resumeRef.current = false;
          return;
        }

        if (data?.interrupted) {
          totalPulled = data.totalSynced || totalPulled;
          updateStep('pull', { count: totalPulled });
          setTimeout(() => runLoop(), 1000);
          return;
        }

        totalPulled = data?.totalSynced || totalPulled;
        updateStep('pull', { status: 'done', count: totalPulled, completedAt: Date.now() });

        // Push local objects
        updateStep('push', { status: 'running', startedAt: Date.now() });
        try {
          const { data: pushData, error: pushError } = await supabase.functions.invoke('asset-plus-sync', {
            body: { action: 'push-missing-to-assetplus' }
          });
          if (pushError) throw pushError;
          const pushed = pushData?.created || 0;
          updateStep('push', { status: 'done', count: pushed, completedAt: Date.now() });
          setSyncOutcome({
            success: true,
            summary: 'Asset sync complete',
            details: [
              `${totalPulled.toLocaleString()} assets pulled`,
              pushed > 0 ? `${pushed} local objects pushed to Asset+` : 'No local objects to push',
            ],
            durationMs: Date.now() - startTime,
          });
        } catch (pushErr: any) {
          updateStep('push', { status: 'error', message: pushErr.message, completedAt: Date.now() });
          setSyncOutcome({
            success: true,
            summary: 'Assets pulled, push failed',
            details: [`${totalPulled.toLocaleString()} assets pulled`, `Push error: ${pushErr.message}`],
            durationMs: Date.now() - startTime,
          });
        }

        setIsSyncingAssets(false);
        resumeRef.current = false;
        setDeltaResult(null);
        setDismissed(false);
        try { localStorage.removeItem(DISMISS_KEY); } catch {}
        window.dispatchEvent(new CustomEvent('asset-sync-completed', { detail: { totalSynced: totalPulled } }));
        setTimeout(checkDelta, 2000);
      } catch (err: any) {
        updateStep('pull', { status: 'error', message: err.message, completedAt: Date.now() });
        setSyncOutcome({ success: false, summary: 'Asset sync failed', details: [err.message], durationMs: Date.now() - startTime });
        setIsSyncingAssets(false);
        resumeRef.current = false;
      }
    };

    runLoop();
  };

  useEffect(() => {
    if (dismissed) return;
    checkDelta();
  }, [dismissed]);

  const isSyncing = isSyncingStructure || isSyncingAssets;

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
              variant="outline"
              onClick={syncStructure}
              disabled={isSyncing}
              className="gap-1.5"
            >
              <Building2 className={`h-3.5 w-3.5 ${isSyncingStructure ? 'animate-spin' : ''}`} />
              {isSyncingStructure ? 'Syncing...' : 'Sync Structure'}
            </Button>
            <Button
              size="sm"
              onClick={syncAssets}
              disabled={isSyncing}
              className="gap-1.5"
            >
              <Layers className={`h-3.5 w-3.5 ${isSyncingAssets ? 'animate-spin' : ''}`} />
              {isSyncingAssets ? 'Syncing...' : 'Sync Assets'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={dismiss}
            >
              Dismiss
            </Button>
          </div>

          {/* Sync progress log */}
          {(syncSteps.length > 0 || syncOutcome) && (
            <div className="mt-3">
              <SyncStatusLog steps={syncSteps} outcome={syncOutcome} />
            </div>
          )}
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
