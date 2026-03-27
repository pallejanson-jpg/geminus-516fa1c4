import React from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, ArrowUpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SyncStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface SyncStep {
  id: string;
  label: string;
  status: SyncStepStatus;
  message?: string;
  count?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface SyncOutcome {
  success: boolean;
  summary: string;
  details?: string[];
  durationMs?: number;
}

interface SyncStatusLogProps {
  steps: SyncStep[];
  outcome?: SyncOutcome | null;
  className?: string;
}

const formatDuration = (ms: number): string => {
  const seconds = ms / 1000;
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

const StepIcon: React.FC<{ status: SyncStepStatus }> = ({ status }) => {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin flex-shrink-0" />;
    case 'skipped':
      return <ArrowUpCircle className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />;
  }
};

export const SyncStatusLog: React.FC<SyncStatusLogProps> = ({ steps, outcome, className }) => {
  if (steps.length === 0 && !outcome) return null;

  return (
    <div className={cn('space-y-2', className)}>
      {/* Steps */}
      {steps.length > 0 && (
        <div className="space-y-1">
          {steps.map((step) => {
            const elapsed = step.startedAt
              ? (step.completedAt || Date.now()) - step.startedAt
              : null;

            return (
              <div
                key={step.id}
                className={cn(
                  'flex items-center gap-2 text-xs px-2 py-1 rounded',
                  step.status === 'running' && 'bg-primary/5',
                  step.status === 'error' && 'bg-destructive/5',
                )}
              >
                <StepIcon status={step.status} />
                <span className={cn(
                  'flex-1 min-w-0 truncate',
                  step.status === 'pending' && 'text-muted-foreground/50',
                  step.status === 'running' && 'font-medium',
                )}>
                  {step.label}
                </span>
                {step.count != null && step.status !== 'pending' && (
                  <span className="text-muted-foreground tabular-nums flex-shrink-0">
                    {step.count.toLocaleString()}
                  </span>
                )}
                {elapsed != null && elapsed > 1000 && step.status !== 'pending' && (
                  <span className="text-muted-foreground/70 tabular-nums flex-shrink-0">
                    {formatDuration(elapsed)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Error messages */}
      {steps.filter(s => s.status === 'error' && s.message).map(s => (
        <p key={`err-${s.id}`} className="text-xs text-destructive px-2">
          {s.message}
        </p>
      ))}

      {/* Outcome */}
      {outcome && (
        <div className={cn(
          'rounded-md border p-2.5 text-xs',
          outcome.success
            ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30'
            : 'border-destructive/30 bg-destructive/5',
        )}>
          <p className={cn(
            'font-medium',
            outcome.success ? 'text-green-700 dark:text-green-400' : 'text-destructive',
          )}>
            {outcome.summary}
          </p>
          {outcome.details && outcome.details.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {outcome.details.map((d, i) => (
                <li key={i}>• {d}</li>
              ))}
            </ul>
          )}
          {outcome.durationMs != null && outcome.durationMs > 1000 && (
            <p className="mt-1 text-muted-foreground/70">
              Total time: {formatDuration(outcome.durationMs)}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SyncStatusLog;
