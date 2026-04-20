import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, X, Play, RotateCcw } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes — detect stale faster
const STALE_CHECK_INTERVAL_MS = 30_000; // re-evaluate every 30s

interface SyncState {
  subtree_id: string;
  subtree_name: string | null;
  sync_status: string | null;
  total_assets: number | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  error_message: string | null;
}

interface SyncProgress {
  totalSynced: number | null;
  totalBuildings: number | null;
  currentBuildingIndex: number | null;
}

export const SyncProgressBanner: React.FC = () => {
  const { toast } = useToast();
  const [activeSyncs, setActiveSyncs] = useState<SyncState[]>([]);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const resumeRef = useRef(false);
  const autoResumedRef = useRef(false);
  const [, forceRender] = useState(0); // tick to re-evaluate staleness

  const isStale = useCallback((sync: SyncState) => {
    if (sync.sync_status !== 'running' || !sync.last_sync_started_at) return false;
    return Date.now() - new Date(sync.last_sync_started_at).getTime() > STALE_THRESHOLD_MS;
  }, []);

  const handleResume = useCallback(async (subtreeId: string) => {
    if (resumeRef.current) return;
    resumeRef.current = true;
    setIsResuming(true);

    const isStructure = subtreeId === 'structure';
    const action = isStructure ? 'sync-structure' : 'sync-assets-resumable';

    // Track progress between iterations to detect "stuck" loops where the function
    // keeps returning interrupted:true without actually advancing.
    let lastTotalSynced = -1;
    let stuckCount = 0;
    const MAX_STUCK_ITERATIONS = 2;
    const MAX_TOTAL_ITERATIONS = 30; // hard cap to avoid runaway
    let iterations = 0;

    const runLoop = async () => {
      iterations++;
      try {
        const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
          body: { action }
        });

        if (error) {
          console.error('Resume sync error:', error);
          toast({ variant: 'destructive', title: 'Sync error', description: error.message });
          setIsResuming(false);
          resumeRef.current = false;
          return;
        }

        if (data?.interrupted) {
          const currentTotal = data?.totalSynced ?? 0;
          if (currentTotal === lastTotalSynced) {
            stuckCount++;
          } else {
            stuckCount = 0;
            lastTotalSynced = currentTotal;
          }

          if (stuckCount >= MAX_STUCK_ITERATIONS || iterations >= MAX_TOTAL_ITERATIONS) {
            console.warn(`[SyncProgressBanner] Aborting sync loop — no progress after ${stuckCount} attempts (total iterations: ${iterations})`);
            toast({
              variant: 'destructive',
              title: 'Sync stuck',
              description: `Sync stopped advancing at ${currentTotal.toLocaleString()} items. Use Reset and try again.`,
            });
            setIsResuming(false);
            resumeRef.current = false;
            return;
          }

          setTimeout(() => runLoop(), 2000);
        } else {
          toast({
            title: 'Sync complete',
            description: `${data?.totalSynced || 0} ${isStructure ? 'structure items' : 'assets'} synced.`,
          });
          setIsResuming(false);
          resumeRef.current = false;
          autoResumedRef.current = false;
          window.dispatchEvent(new CustomEvent('asset-sync-completed'));
        }
      } catch (err: any) {
        console.error('Resume sync exception:', err);
        setIsResuming(false);
        resumeRef.current = false;
      }
    };

    toast({
      title: 'Resuming sync',
      description: `Continuing interrupted ${isStructure ? 'structure' : 'asset'} synchronization...`,
    });

    runLoop();
  }, [toast]);

  const handleReset = useCallback(async (subtreeId: string) => {
    setIsResetting(true);
    const action = subtreeId === 'structure' ? 'reset-structure-progress' : 'reset-assets-progress';
    try {
      const { error } = await supabase.functions.invoke('asset-plus-sync', {
        body: { action }
      });

      if (error) throw error;

      toast({
        title: 'Reset',
        description: 'Sync status has been reset. You can start a new sync.',
      });

      setActiveSyncs(prev => prev.filter(s => s.subtree_id !== subtreeId));
      autoResumedRef.current = false;
      window.dispatchEvent(new CustomEvent('asset-sync-completed'));
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Reset failed',
        description: err.message,
      });
    } finally {
      setIsResetting(false);
    }
  }, [toast]);

  // Fetch sync progress details
  const fetchProgress = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('asset_sync_progress')
        .select('total_synced, total_buildings, current_building_index')
        .eq('job', 'assets_instances')
        .maybeSingle();

      if (data) {
        setProgress({
          totalSynced: data.total_synced,
          totalBuildings: data.total_buildings,
          currentBuildingIndex: data.current_building_index,
        });
      }
    } catch (err) {
      console.error('Failed to fetch sync progress:', err);
    }
  }, []);

  // Periodic staleness re-evaluation
  useEffect(() => {
    if (activeSyncs.length === 0) return;
    const timer = setInterval(() => forceRender(n => n + 1), STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeSyncs.length]);

  // Auto-resume stale "assets" or "structure" jobs once per page load
  useEffect(() => {
    if (autoResumedRef.current || resumeRef.current || isResuming) return;
    const staleSync = activeSyncs.find(
      s => (s.subtree_id === 'assets' || s.subtree_id === 'structure') && isStale(s)
    );
    if (staleSync) {
      autoResumedRef.current = true;
      console.log(`[SyncProgressBanner] Auto-resuming stale ${staleSync.subtree_id} sync`);
      handleResume(staleSync.subtree_id);
    }
  }, [activeSyncs, isStale, handleResume, isResuming]);

  useEffect(() => {
    const fetchSyncStates = async () => {
      // Fetch both running AND recently-interrupted syncs
      const { data } = await supabase
        .from('asset_sync_state')
        .select('*')
        .in('sync_status', ['running', 'interrupted']);
      
      if (data && data.length > 0) {
        setActiveSyncs(data);
        fetchProgress();
      }
    };

    fetchSyncStates();

    const channel = supabase
      .channel('sync-progress')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'asset_sync_state'
        },
        (payload) => {
          const newState = payload.new as SyncState;
          
          if (payload.eventType === 'DELETE') {
            setActiveSyncs(prev => prev.filter(s => s.subtree_id !== (payload.old as SyncState).subtree_id));
            return;
          }
          
          if (newState.sync_status === 'running' || newState.sync_status === 'interrupted') {
            setDismissed(false);
            setActiveSyncs(prev => {
              const existing = prev.findIndex(s => s.subtree_id === newState.subtree_id);
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = newState;
                return updated;
              }
              return [...prev, newState];
            });
            fetchProgress();
          } else {
            setTimeout(() => {
              setActiveSyncs(prev => prev.filter(s => s.subtree_id !== newState.subtree_id));
            }, 3000);
          }
        }
      )
      .subscribe();

    const progressChannel = supabase
      .channel('sync-progress-detail')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'asset_sync_progress'
        },
        () => {
          fetchProgress();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(progressChannel);
    };
  }, [fetchProgress]);

  if (dismissed || activeSyncs.length === 0) {
    return null;
  }

  return (
    <div className="bg-primary/5 border-b border-primary/20 px-4 py-2">
      {activeSyncs.map((sync) => {
        const stale = isStale(sync);
        const interrupted = sync.sync_status === 'interrupted';
        const showActions = stale || interrupted;
        const progressPercent = progress?.totalBuildings && progress.totalBuildings > 0
          ? Math.round(((progress.currentBuildingIndex ?? 0) / progress.totalBuildings) * 100)
          : null;
        const progressLabel = progress?.totalBuildings
          ? `(${(progress.currentBuildingIndex ?? 0) + 1}/${progress.totalBuildings})`
          : '';

        return (
          <div key={sync.subtree_id} className="flex items-center gap-3">
            {showActions && !isResuming ? (
              <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
            ) : (
              <RefreshCw className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
            )}
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {showActions && !isResuming ? 'Sync stalled' : 'Syncing'} {sync.subtree_name || sync.subtree_id} {progressLabel}
                  </span>
                  {showActions && !isResuming && (
                    <Badge variant="outline" className="text-xs border-yellow-300 bg-yellow-50 text-yellow-700 flex-shrink-0">
                      Interrupted
                    </Badge>
                  )}
                </div>
                {sync.total_assets != null && sync.total_assets > 0 && (
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {(progress?.totalSynced ?? sync.total_assets).toLocaleString()} items
                  </span>
                )}
              </div>
              
              {!showActions && progressPercent !== null && (
                <Progress 
                  value={progressPercent} 
                  className="h-1 mt-1" 
                />
              )}

              {isResuming && progressPercent !== null && (
                <Progress 
                  value={progressPercent} 
                  className="h-1 mt-1" 
                />
              )}

              {showActions && !isResuming && (
                <div className="flex gap-2 mt-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => handleResume(sync.subtree_id)}
                    disabled={isResuming || isResetting}
                  >
                    {isResuming ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                    Resume
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => handleReset(sync.subtree_id)}
                    disabled={isResuming || isResetting}
                  >
                    {isResetting ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Reset
                  </Button>
                </div>
              )}
            </div>
            
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={() => setDismissed(true)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
    </div>
  );
};

export default SyncProgressBanner;
