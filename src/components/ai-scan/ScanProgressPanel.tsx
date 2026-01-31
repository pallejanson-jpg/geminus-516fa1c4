import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, Clock, CheckCircle2, XCircle, AlertCircle, Pause, Play, StopCircle, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ScanJob {
  id: string;
  building_fm_guid: string;
  ivion_site_id: string;
  templates: string[];
  status: string;
  total_images: number;
  processed_images: number;
  detections_found: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

interface ScanProgressPanelProps {
  activeScanJob: ScanJob | null;
  recentJobs: ScanJob[];
  onScanCompleted: (job: ScanJob) => void;
  onScanCancelled: () => void;
  onRefresh: () => void;
}

const ScanProgressPanel: React.FC<ScanProgressPanelProps> = ({
  activeScanJob,
  recentJobs,
  onScanCompleted,
  onScanCancelled,
  onRefresh,
}) => {
  const { toast } = useToast();
  const [currentJob, setCurrentJob] = useState<ScanJob | null>(activeScanJob);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Update current job when prop changes
  useEffect(() => {
    setCurrentJob(activeScanJob);
  }, [activeScanJob]);

  // Poll for updates when job is running
  useEffect(() => {
    if (currentJob && (currentJob.status === 'running' || currentJob.status === 'queued')) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [currentJob?.id, currentJob?.status]);

  const startPolling = () => {
    if (pollIntervalRef.current) return;
    
    pollIntervalRef.current = setInterval(async () => {
      if (!currentJob) return;
      
      try {
        const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
          body: { action: 'get-scan-status', scanJobId: currentJob.id }
        });

        if (error) throw error;
        setCurrentJob(data);

        if (data.status === 'completed' || data.status === 'failed') {
          stopPolling();
          onScanCompleted(data);
        }
      } catch (error) {
        console.error('Poll error:', error);
      }
    }, 3000);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  // Process next batch
  const processBatch = async () => {
    if (!currentJob) return;
    
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'process-batch', scanJobId: currentJob.id }
      });

      if (error) throw error;
      
      // Refresh job status
      const { data: jobData } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'get-scan-status', scanJobId: currentJob.id }
      });
      
      if (jobData) {
        setCurrentJob(jobData);
        
        if (jobData.status === 'completed') {
          onScanCompleted(jobData);
          toast({
            title: 'Skanning klar!',
            description: `Hittade ${jobData.detections_found} potentiella objekt`,
          });
        }
      }
    } catch (error: any) {
      toast({
        title: 'Fel vid bearbetning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Cancel scan
  const cancelScan = async () => {
    if (!currentJob) return;
    
    setIsCancelling(true);
    try {
      const { error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'cancel-scan', scanJobId: currentJob.id }
      });

      if (error) throw error;
      
      stopPolling();
      toast({
        title: 'Skanning avbruten',
        description: 'Skanningen har avbrutits. Hittade objekt finns kvar för granskning.',
      });
      
      onScanCancelled();
    } catch (error: any) {
      toast({
        title: 'Fel vid avbrytning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsCancelling(false);
    }
  };

  // Delete scan job
  const deleteScanJob = async (jobId: string) => {
    setIsDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'delete-scan-job', scanJobId: jobId }
      });

      if (error) throw error;
      
      toast({
        title: 'Skanning borttagen',
        description: 'Skanningsjobbet och relaterade detektioner har tagits bort.',
      });
      
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Fel vid borttagning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setDeleteJobId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'queued':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Köad</Badge>;
      case 'running':
        return <Badge variant="default"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Pågår</Badge>;
      case 'paused':
        return <Badge variant="outline"><Pause className="h-3 w-3 mr-1" />Pausad</Badge>;
      case 'completed':
        return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Klar</Badge>;
      case 'cancelled':
        return <Badge variant="outline"><StopCircle className="h-3 w-3 mr-1" />Avbruten</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Misslyckades</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDuration = (startedAt: string | null, completedAt: string | null) => {
    if (!startedAt) return '-';
    
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec < 60) return `${diffSec} sek`;
    const minutes = Math.floor(diffSec / 60);
    const seconds = diffSec % 60;
    return `${minutes} min ${seconds} sek`;
  };

  const canDeleteJob = (status: string) => {
    return status !== 'running' && status !== 'queued';
  };

  return (
    <div className="space-y-6">
      {/* Active Scan */}
      {currentJob ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className={`h-5 w-5 ${currentJob.status === 'running' ? 'animate-spin' : ''}`} />
                  Aktiv skanning
                </CardTitle>
                <CardDescription>
                  Söker efter: {currentJob.templates.join(', ')}
                </CardDescription>
              </div>
              {getStatusBadge(currentJob.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Bearbetade bilder</span>
                <span>{currentJob.processed_images} / {currentJob.total_images || '?'}</span>
              </div>
              <Progress 
                value={currentJob.total_images > 0 
                  ? (currentJob.processed_images / currentJob.total_images) * 100 
                  : 0
                } 
              />
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{currentJob.processed_images}</div>
                <div className="text-xs text-muted-foreground">Bilder</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold text-primary">{currentJob.detections_found}</div>
                <div className="text-xs text-muted-foreground">Hittade</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-2xl font-bold">{formatDuration(currentJob.started_at, currentJob.completed_at)}</div>
                <div className="text-xs text-muted-foreground">Tid</div>
              </div>
            </div>

            {/* Error message */}
            {currentJob.error_message && (
              <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="h-5 w-5 mt-0.5" />
                <span className="text-sm">{currentJob.error_message}</span>
              </div>
            )}

            {/* Actions */}
            {(currentJob.status === 'queued' || currentJob.status === 'running') && (
              <div className="flex gap-2">
                <Button 
                  onClick={processBatch} 
                  disabled={isProcessing || isCancelling}
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Bearbetar...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Bearbeta nästa batch
                    </>
                  )}
                </Button>
                <Button 
                  variant="outline"
                  onClick={cancelScan} 
                  disabled={isProcessing || isCancelling}
                >
                  {isCancelling ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Avbryter...
                    </>
                  ) : (
                    <>
                      <StopCircle className="h-4 w-4 mr-2" />
                      Avbryt
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <RefreshCw className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium mb-2">Ingen aktiv skanning</h3>
            <p className="text-sm text-muted-foreground">
              Gå till "Konfigurera" för att starta en ny AI-skanning
            </p>
          </CardContent>
        </Card>
      )}

      {/* Recent Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tidigare skanningar</CardTitle>
        </CardHeader>
        <CardContent>
          {recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Inga tidigare skanningar
            </p>
          ) : (
            <div className="space-y-3">
              {recentJobs.map(job => (
                <div 
                  key={job.id} 
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {getStatusBadge(job.status)}
                      <span className="text-sm font-medium truncate">
                        {job.templates.join(', ')}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(job.created_at).toLocaleString('sv-SE')}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {job.detections_found} hittade
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {job.processed_images} bilder
                      </div>
                    </div>
                    {canDeleteJob(job.status) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteJobId(job.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteJobId} onOpenChange={() => setDeleteJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort skanning?</AlertDialogTitle>
            <AlertDialogDescription>
              Denna åtgärd tar bort skanningsjobbet och alla relaterade detektioner som 
              ännu inte har granskats. Godkända objekt påverkas inte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Avbryt</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deleteJobId && deleteScanJob(deleteJobId)}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Tar bort...
                </>
              ) : (
                'Ta bort'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ScanProgressPanel;