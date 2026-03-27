import React, { useMemo } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Loader2, Clock, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface SyncProgressCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  localCount: number;
  remoteCount?: number | null;
  remoteLabel?: string;
  inSync?: boolean | null;
  isSyncing: boolean;
  isCheckingSync: boolean;
  disabled: boolean;
  onSync: () => void;
  syncButtonLabel?: string;
  syncButtonVariant?: 'default' | 'secondary' | 'outline';
  // Progress tracking
  syncStartedAt?: string | null;
  syncCompletedAt?: string | null;
  syncStatus?: string | null;
  errorMessage?: string | null;
  // Detailed progress (from asset_sync_progress)
  progressCurrent?: number | null;
  progressTotal?: number | null;
  progressLabel?: string | null;
  totalSynced?: number | null;
  // Extra actions
  extraActions?: React.ReactNode;
  // Last result summary (shown after sync completes)
  lastResult?: string | null;
}

const formatDate = (dateStr: string | null, fallbackDateStr?: string | null) => {
  const dateToUse = dateStr || fallbackDateStr;
  if (!dateToUse) return 'Aldrig';
  const date = new Date(dateToUse);
  return date.toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
};

export const SyncProgressCard: React.FC<SyncProgressCardProps> = ({
  icon,
  title,
  subtitle,
  localCount,
  remoteCount,
  remoteLabel = 'i Asset+',
  inSync,
  isSyncing,
  isCheckingSync,
  disabled,
  onSync,
  syncButtonLabel = 'Synka',
  syncButtonVariant = 'default',
  syncStartedAt,
  syncCompletedAt,
  syncStatus,
  errorMessage,
  progressCurrent,
  progressTotal,
  progressLabel,
  totalSynced,
  extraActions,
  lastResult,
}) => {
  const isRunning = isSyncing || syncStatus === 'running';

  // Calculate progress percentage
  const progressPercent = useMemo(() => {
    if (!isRunning) return 0;
    if (progressTotal && progressTotal > 0 && progressCurrent !== null && progressCurrent !== undefined) {
      return Math.min(Math.round((progressCurrent / progressTotal) * 100), 99);
    }
    return null; // indeterminate
  }, [isRunning, progressCurrent, progressTotal]);

  // Calculate elapsed time and ETA
  const { elapsed, eta } = useMemo(() => {
    if (!isRunning || !syncStartedAt) return { elapsed: null, eta: null };

    const startTime = new Date(syncStartedAt).getTime();
    const now = Date.now();
    const elapsedSec = (now - startTime) / 1000;

    if (progressPercent && progressPercent > 5) {
      const totalEstimated = elapsedSec / (progressPercent / 100);
      const remainingSec = totalEstimated - elapsedSec;
      return {
        elapsed: formatDuration(elapsedSec),
        eta: remainingSec > 0 ? `~${formatDuration(remainingSec)} kvar` : 'Snart klar...',
      };
    }

    return { elapsed: formatDuration(elapsedSec), eta: null };
  }, [isRunning, syncStartedAt, progressPercent]);

  return (
    <div className={cn(
      'border rounded-lg p-4 space-y-3 transition-all duration-300',
      isRunning && 'border-primary/40 bg-primary/[0.02] shadow-sm',
    )}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            'transition-transform',
            isRunning && 'animate-pulse',
          )}>
            {icon}
          </div>
          <div>
            <h4 className="font-medium">{title}</h4>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isCheckingSync ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : inSync === true ? (
            <Badge variant="default" className="bg-green-600 text-xs gap-1">
              <CheckCircle2 className="h-3 w-3" />
              I synk
            </Badge>
          ) : inSync === false ? (
            <Badge variant="destructive" className="text-xs gap-1">
              <AlertCircle className="h-3 w-3" />
              Ej synkad
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Counts + Sync button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {localCount.toLocaleString()} lokala
          {remoteCount != null && ` • ${remoteCount.toLocaleString()} ${remoteLabel}`}
        </p>
        <div className="flex items-center gap-2">
          {extraActions}
          <Button
            onClick={onSync}
            disabled={disabled || isRunning}
            size="sm"
            variant={syncButtonVariant}
            className="gap-1 h-8"
          >
            {isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {isRunning ? 'Synkar...' : syncButtonLabel}
          </Button>
        </div>
      </div>

      {/* Progress section - only while syncing */}
      {isRunning && (
        <div className="space-y-2 pt-1">
          {/* Progress bar */}
          <div className="space-y-1">
            {progressPercent !== null ? (
              <Progress value={progressPercent} className="h-2" />
            ) : (
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-1/3 rounded-full bg-primary animate-[indeterminate_1.5s_ease-in-out_infinite]" />
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                {progressLabel || (
                  totalSynced != null
                    ? `${totalSynced.toLocaleString()} objekt synkade`
                    : 'Synkroniserar...'
                )}
              </span>
              <span className="flex items-center gap-1">
                {progressPercent !== null && `${progressPercent}%`}
              </span>
            </div>
          </div>

          {/* Time info */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {elapsed && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {elapsed}
              </span>
            )}
            {eta && (
              <span className="flex items-center gap-1 text-primary font-medium">
                <Timer className="h-3 w-3" />
                {eta}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Status footer - when not syncing */}
      {!isRunning && (syncStatus || syncStartedAt || syncCompletedAt) && (
        <div className="text-xs text-muted-foreground border-t pt-2 space-y-1">
          <div className="flex items-center gap-1">
            <span>Senast: {formatDate(syncCompletedAt, syncStartedAt)}</span>
            {errorMessage && (
              <span className="text-destructive ml-2 line-clamp-1">{errorMessage}</span>
            )}
          </div>
          {lastResult && (
            <p className="font-medium text-foreground">{lastResult}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default SyncProgressCard;
