import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface SyncState {
  subtree_id: string;
  subtree_name: string | null;
  sync_status: string | null;
  total_assets: number | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  error_message: string | null;
}

export const SyncProgressBanner: React.FC = () => {
  const [activeSyncs, setActiveSyncs] = useState<SyncState[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Initial fetch
    const fetchSyncStates = async () => {
      const { data } = await supabase
        .from('asset_sync_state')
        .select('*')
        .eq('sync_status', 'running');
      
      if (data) {
        setActiveSyncs(data);
      }
    };

    fetchSyncStates();

    // Subscribe to realtime changes
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
          
          if (newState.sync_status === 'running') {
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
          } else {
            // Remove completed/failed syncs after a delay
            setTimeout(() => {
              setActiveSyncs(prev => prev.filter(s => s.subtree_id !== newState.subtree_id));
            }, 3000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (dismissed || activeSyncs.length === 0) {
    return null;
  }

  return (
    <div className="bg-primary/5 border-b border-primary/20 px-4 py-2">
      {activeSyncs.map((sync) => (
        <div key={sync.subtree_id} className="flex items-center gap-3">
          <RefreshCw className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">
                Synkar {sync.subtree_name || sync.subtree_id}
              </span>
              {sync.total_assets && sync.total_assets > 0 && (
                <span className="text-xs text-muted-foreground">
                  {sync.total_assets.toLocaleString()} objekt
                </span>
              )}
            </div>
            
            {sync.total_assets && sync.total_assets > 0 && (
              <Progress 
                value={100} 
                className="h-1 mt-1" 
              />
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
      ))}
    </div>
  );
};

export default SyncProgressBanner;
