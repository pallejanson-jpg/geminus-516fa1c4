import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { TranslationStatus } from '@/services/acc-xkt-converter';

interface ConversionProgressOverlayProps {
  translationStatuses: Record<string, TranslationStatus>;
  fileNames?: Record<string, string>;
}

const formatElapsed = (ms: number): string => {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
};

const ConversionProgressOverlay: React.FC<ConversionProgressOverlayProps> = ({
  translationStatuses,
  fileNames = {},
}) => {
  const [startTimes, setStartTimes] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());

  // Find the active job (first one that's not idle/complete/failed/success)
  const activeEntry = Object.entries(translationStatuses).find(
    ([, s]) => s.status !== 'idle' && s.status !== 'complete' && s.status !== 'success' && s.status !== 'failed'
  );

  const activeUrn = activeEntry?.[0];
  const activeStatus = activeEntry?.[1];

  // Track start time per urn
  useEffect(() => {
    if (activeUrn && !startTimes[activeUrn]) {
      setStartTimes((prev) => ({ ...prev, [activeUrn]: Date.now() }));
    }
  }, [activeUrn, startTimes]);

  // Tick every second while active
  useEffect(() => {
    if (!activeUrn) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeUrn]);

  if (!activeUrn || !activeStatus) return null;

  const elapsed = now - (startTimes[activeUrn] || now);
  const pct = activeStatus.progressPercent ?? 0;
  const step = activeStatus.step || activeStatus.message || 'Bearbetar...';
  const fileName = fileNames[activeUrn] || activeUrn.substring(0, 30);

  return (
    <div className={cn(
      'rounded-lg border border-primary/30 bg-primary/[0.04] p-3 space-y-2 animate-in fade-in duration-300',
    )}>
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
        <span className="text-sm font-medium truncate">
          Konverterar: {fileName}
        </span>
      </div>

      <div className="space-y-1">
        <Progress value={pct} className="h-2" />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{step}</span>
          <span className="flex items-center gap-2">
            {pct > 0 && <span>{pct}%</span>}
            <span>{formatElapsed(elapsed)}</span>
          </span>
        </div>
      </div>
    </div>
  );
};

export default ConversionProgressOverlay;
