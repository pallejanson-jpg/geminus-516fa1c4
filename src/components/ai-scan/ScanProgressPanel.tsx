import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RefreshCw, Clock, CheckCircle2, XCircle, AlertCircle, Pause, Play, StopCircle, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
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
  const isMobile = useIsMobile();
  const [currentJob, setCurrentJob] = useState<ScanJob | null>(activeScanJob);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [autoProcess, setAutoProcess] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoProcessRef = useRef<NodeJS.Timeout | null>(null);

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

  // Auto-process effect
  useEffect(() => {
    if (autoProcessRef.current) {
      clearTimeout(autoProcessRef.current);
      autoProcessRef.current = null;
    }

    if (autoProcess && currentJob && 
        (currentJob.status === 'running' || currentJob.status === 'queued') && 
        !isProcessing) {
      // Wait a bit between batches
      autoProcessRef.current = setTimeout(() => {
        processBatch();
      }, 1500);
    }

    return () => {
      if (autoProcessRef.current) {
        clearTimeout(autoProcessRef.current);
      }
    };
  }, [autoProcess, currentJob?.processed_images, isProcessing, currentJob?.status]);

  // Stop auto-process when job completes
  useEffect(() => {
    if (currentJob && (currentJob.status === 'completed' || currentJob.status === 'failed' || currentJob.status === 'cancelled')) {
      setAutoProcess(false);
    }
  }, [currentJob?.status]);

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
  const processBatch = useCallback(async () => {
    if (!currentJob || isProcessing) return;
    
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
          setAutoProcess(false);
          onScanCompleted(jobData);
          toast({
            title: 'Scan complete!',
            description: `Found ${jobData.detections_found} potential objects`,
          });
        }
      }
    } catch (error: any) {
      setAutoProcess(false);
      toast({
        title: 'Fel vid bearbetning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [currentJob, isProcessing, onScanCompleted, toast]);

  // Cancel scan
  const cancelScan = async () => {
    if (!currentJob) return;
    
    setIsCancelling(true);
    setAutoProcess(false);
    try {
      const { error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'cancel-scan', scanJobId: currentJob.id }
      });

      if (error) throw error;
      
      stopPolling();
      toast({
        title: 'Scan cancelled',
        description: 'The scan has been cancelled. Detected objects are still available for review.',
      });
      
      onScanCancelled();
    } catch (error: any) {
      toast({
        title: 'Cancellation error',
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
        title: 'Scan deleted',
        description: 'The scan job and related detections have been removed.',
      });
      
      onRefresh();
    } catch (error: any) {
      toast({
        title: 'Deletion error',
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
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Queued</Badge>;
      case 'running':
        return <Badge variant="default"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
      case 'paused':
        return <Badge variant="outline"><Pause className="h-3 w-3 mr-1" />Paused</Badge>;
      case 'completed':
        return <Badge variant="default" className="bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Done</Badge>;
      case 'cancelled':
        return <Badge variant="outline"><StopCircle className="h-3 w-3 mr-1" />Cancelled</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
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
    
    if (diffSec < 60) return `${diffSec}s`;
    const minutes = Math.floor(diffSec / 60);
    const seconds = diffSec % 60;
    return `${minutes}m ${seconds}s`;
  };

  const canDeleteJob = (status: string) => {
    return status !== 'running' && status !== 'queued';
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Active Scan */}
      {currentJob ? (
        <Card>
          <CardHeader className="pb-3 md:pb-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <RefreshCw className={`h-4 w-4 md:h-5 md:w-5 shrink-0 ${currentJob.status === 'running' ? 'animate-spin' : ''}`} />
                  <span className="truncate">Active scan</span>
                </CardTitle>
                <CardDescription className="text-xs md:text-sm mt-1 line-clamp-2">
                  Searching for: {currentJob.templates.join(', ')}
                </CardDescription>
              </div>
              {getStatusBadge(currentJob.status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs md:text-sm">
                <span>Processed images</span>
                <span>{currentJob.processed_images} / {currentJob.total_images || '?'}</span>
              </div>
              <Progress 
                value={currentJob.total_images > 0 
                  ? (currentJob.processed_images / currentJob.total_images) * 100 
                  : 0
                } 
              />
            </div>

            {/* Stats - Compact on mobile */}
            <div className="grid grid-cols-3 gap-2 md:gap-4 text-center">
              <div className="p-2 md:p-3 bg-muted rounded-lg">
                <div className="text-lg md:text-2xl font-bold">{currentJob.processed_images}</div>
                <div className="text-[10px] md:text-xs text-muted-foreground">Images</div>
              </div>
              <div className="p-2 md:p-3 bg-muted rounded-lg">
                <div className="text-lg md:text-2xl font-bold text-primary">{currentJob.detections_found}</div>
                <div className="text-[10px] md:text-xs text-muted-foreground">Found</div>
              </div>
              <div className="p-2 md:p-3 bg-muted rounded-lg">
                <div className="text-lg md:text-2xl font-bold">{formatDuration(currentJob.started_at, currentJob.completed_at)}</div>
                <div className="text-[10px] md:text-xs text-muted-foreground">Time</div>
              </div>
            </div>

            {/* Auto-process indicator */}
            {autoProcess && (
              <div className="flex items-center gap-2 p-2 bg-primary/10 text-primary rounded-lg">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span className="text-sm font-medium">Automatic processing in progress…</span>
              </div>
            )}

            {/* Error message */}
            {currentJob.error_message && (
              <div className="flex items-start gap-2 p-2 md:p-3 bg-destructive/10 text-destructive rounded-lg">
                <AlertCircle className="h-4 w-4 md:h-5 md:w-5 mt-0.5 shrink-0" />
                <span className="text-xs md:text-sm">{currentJob.error_message}</span>
              </div>
            )}

            {/* Actions - Stack vertically on mobile */}
            {(currentJob.status === 'queued' || currentJob.status === 'running') && (
              <div className="flex flex-col gap-2">
                {/* Auto-process toggle */}
                <Button 
                  onClick={() => setAutoProcess(!autoProcess)} 
                  disabled={isCancelling}
                  variant={autoProcess ? "secondary" : "default"}
                  className="w-full"
                >
                  {autoProcess ? (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Pause auto-processing
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Run automatically
                    </>
                  )}
                </Button>

                {/* Manual batch button (only show if not auto-processing) */}
                {!autoProcess && (
                  <Button 
                    onClick={processBatch} 
                    disabled={isProcessing || isCancelling}
                    variant="outline"
                    className="w-full"
                  >
                    {isProcessing ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Processing batch…
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Process next batch (25 images)
                      </>
                    )}
                  </Button>
                )}

                <Button 
                  variant="destructive"
                  onClick={() => setCancelDialogOpen(true)} 
                  disabled={isProcessing || isCancelling}
                  className="w-full"
                >
                  <StopCircle className="h-4 w-4 mr-2" />
                  Cancel scan
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 md:py-12 text-center">
            <RefreshCw className="h-10 w-10 md:h-12 md:w-12 mx-auto mb-3 md:mb-4 text-muted-foreground/50" />
            <h3 className="text-base md:text-lg font-medium mb-2">No active scan</h3>
            <p className="text-xs md:text-sm text-muted-foreground">
              Go to "Configure" to start a new AI scan
            </p>
          </CardContent>
        </Card>
      )}

      {/* Recent Jobs */}
      <Card>
        <CardHeader className="pb-2 md:pb-4">
          <CardTitle className="text-sm md:text-base">Previous scans</CardTitle>
        </CardHeader>
        <CardContent>
          {recentJobs.length === 0 ? (
            <p className="text-xs md:text-sm text-muted-foreground text-center py-4">
              No previous scans
            </p>
          ) : (
            <div className="space-y-3">
              {recentJobs.map(job => (
                <div 
                  key={job.id} 
                  className="flex flex-col gap-2 p-3 bg-muted/50 rounded-lg"
                >
                  {/* Row 1: Status + templates */}
                  <div className="flex items-center gap-2 min-w-0">
                    {getStatusBadge(job.status)}
                    <span className="text-xs md:text-sm font-medium truncate flex-1">
                      {job.templates.join(', ')}
                    </span>
                  </div>
                  
                  {/* Row 2: Date + stats */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span>{new Date(job.created_at).toLocaleDateString('en-US')}</span>
                    <span>•</span>
                    <span className="text-foreground font-medium">{job.detections_found} found</span>
                    <span>•</span>
                    <span>{job.processed_images}/{job.total_images || '?'} images</span>
                  </div>
                  
                  {/* Row 3: Delete button - full width on mobile */}
                  {canDeleteJob(job.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteJobId(job.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete scan
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel scan?</AlertDialogTitle>
            <AlertDialogDescription>
              Do you want to cancel the ongoing scan? Detected objects not yet reviewed will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>Keep scanning</AlertDialogCancel>
            <AlertDialogAction 
              onClick={async () => {
                setCancelDialogOpen(false);
                await cancelScan();
              }}
              disabled={isCancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isCancelling ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Cancelling…
                </>
              ) : (
                'Cancel scan'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteJobId} onOpenChange={() => setDeleteJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete scan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the scan job and all related detections that have not yet been reviewed. 
              Approved objects will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => deleteJobId && deleteScanJob(deleteJobId)}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ScanProgressPanel;