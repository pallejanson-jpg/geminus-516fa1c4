import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Eye, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface PendingDetection {
  id: string;
  object_type: string;
  confidence: number;
  bounding_box: any;
  thumbnail_url: string | null;
  ai_description: string | null;
  status: string;
  building_fm_guid: string;
  ivion_image_id: number | null;
  created_at: string;
  detection_templates: {
    name: string;
    description: string | null;
  } | null;
}

interface ScanJob {
  id: string;
  building_fm_guid: string;
  templates: string[];
  status: string;
  detections_found: number;
  created_at: string;
}

interface DetectionReviewQueueProps {
  scanJobs: ScanJob[];
  onDetectionProcessed: () => void;
}

const DetectionReviewQueue: React.FC<DetectionReviewQueueProps> = ({
  scanJobs,
  onDetectionProcessed,
}) => {
  const { toast } = useToast();
  
  const [detections, setDetections] = useState<PendingDetection[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [detailDialog, setDetailDialog] = useState<PendingDetection | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Load detections
  useEffect(() => {
    loadDetections();
  }, [statusFilter, selectedJobId]);

  const loadDetections = async () => {
    setIsLoading(true);
    try {
      const params: any = {
        action: 'get-pending',
        status: statusFilter || undefined,
        limit: 50,
      };
      
      if (selectedJobId) {
        params.scanJobId = selectedJobId;
      }

      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: params
      });

      if (error) throw error;
      
      setDetections(data.detections || []);
      setTotalCount(data.total || 0);
    } catch (error: any) {
      toast({
        title: 'Fel vid laddning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle selection
  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Select all visible
  const selectAll = () => {
    const pending = detections.filter(d => d.status === 'pending');
    setSelectedIds(new Set(pending.map(d => d.id)));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Approve single detection
  const approveDetection = async (id: string) => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'approve-detection', detectionId: id }
      });

      if (error) throw error;
      
      if (data.success) {
        toast({
          title: 'Godkänd',
          description: 'Tillgång skapad från detektion',
        });
        loadDetections();
        onDetectionProcessed();
      } else {
        throw new Error(data.message);
      }
    } catch (error: any) {
      toast({
        title: 'Fel vid godkännande',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Reject single detection
  const rejectDetection = async (id: string, reason?: string) => {
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'reject-detection', detectionId: id, reason }
      });

      if (error) throw error;
      
      toast({ title: 'Avvisad' });
      loadDetections();
      onDetectionProcessed();
    } catch (error: any) {
      toast({
        title: 'Fel',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Bulk approve
  const bulkApprove = async () => {
    if (selectedIds.size === 0) return;
    
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { 
          action: 'bulk-approve', 
          detectionIds: Array.from(selectedIds) 
        }
      });

      if (error) throw error;
      
      toast({
        title: 'Godkänt',
        description: `${data.approved} detektioner godkända`,
      });
      clearSelection();
      loadDetections();
      onDetectionProcessed();
    } catch (error: any) {
      toast({
        title: 'Fel',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Bulk reject
  const bulkReject = async () => {
    if (selectedIds.size === 0) return;
    
    setIsProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { 
          action: 'bulk-reject', 
          detectionIds: Array.from(selectedIds) 
        }
      });

      if (error) throw error;
      
      toast({
        title: 'Avvisade',
        description: `${data.rejected} detektioner avvisade`,
      });
      clearSelection();
      loadDetections();
      onDetectionProcessed();
    } catch (error: any) {
      toast({
        title: 'Fel',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Get confidence badge color
  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.85) {
      return <Badge variant="default" className="bg-green-600">{Math.round(confidence * 100)}%</Badge>;
    } else if (confidence >= 0.5) {
      return <Badge variant="secondary">{Math.round(confidence * 100)}%</Badge>;
    }
    return <Badge variant="outline">{Math.round(confidence * 100)}%</Badge>;
  };

  const pendingCount = detections.filter(d => d.status === 'pending').length;

  return (
    <div className="space-y-4">
      {/* Filters and Bulk Actions */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4 justify-between">
            <div className="flex items-center gap-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Väntande</SelectItem>
                  <SelectItem value="approved">Godkända</SelectItem>
                  <SelectItem value="rejected">Avvisade</SelectItem>
                </SelectContent>
              </Select>

              {scanJobs.length > 0 && (
                <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Alla skanningar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Alla skanningar</SelectItem>
                    {scanJobs.map(job => (
                      <SelectItem key={job.id} value={job.id}>
                        {new Date(job.created_at).toLocaleDateString('sv-SE')} ({job.detections_found})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <span className="text-sm text-muted-foreground">
                {totalCount} totalt, {pendingCount} väntande
              </span>
            </div>

            {statusFilter === 'pending' && pendingCount > 0 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Välj alla
                </Button>
                {selectedIds.size > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={clearSelection}>
                      Avmarkera ({selectedIds.size})
                    </Button>
                    <Button
                      size="sm"
                      onClick={bulkApprove}
                      disabled={isProcessing}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Godkänn valda
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={bulkReject}
                      disabled={isProcessing}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Avvisa valda
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detection Grid */}
      {isLoading ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Laddar detektioner...</p>
          </CardContent>
        </Card>
      ) : detections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {statusFilter === 'pending' 
                ? 'Inga väntande detektioner. Starta en skanning för att hitta objekt.'
                : 'Inga detektioner hittades med valt filter.'
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {detections.map(detection => (
            <Card 
              key={detection.id} 
              className={`overflow-hidden ${selectedIds.has(detection.id) ? 'ring-2 ring-primary' : ''}`}
            >
              {/* Thumbnail or placeholder */}
              <div className="aspect-video bg-muted flex items-center justify-center">
                {detection.thumbnail_url ? (
                  <img 
                    src={detection.thumbnail_url} 
                    alt={detection.object_type}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center text-muted-foreground text-sm p-4">
                    <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    Ingen förhandsvisning
                  </div>
                )}
              </div>

              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">
                    {detection.detection_templates?.name || detection.object_type}
                  </span>
                  {getConfidenceBadge(detection.confidence)}
                </div>

                {detection.ai_description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {detection.ai_description}
                  </p>
                )}

                <div className="text-xs text-muted-foreground">
                  Bild #{detection.ivion_image_id || '-'}
                </div>

                {detection.status === 'pending' ? (
                  <div className="flex items-center gap-2 pt-2">
                    <Checkbox
                      checked={selectedIds.has(detection.id)}
                      onCheckedChange={() => toggleSelection(detection.id)}
                    />
                    <div className="flex-1 flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => setDetailDialog(detection)}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => approveDetection(detection.id)}
                        disabled={isProcessing}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1"
                        onClick={() => rejectDetection(detection.id)}
                        disabled={isProcessing}
                      >
                        <XCircle className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Badge 
                    variant={detection.status === 'approved' ? 'default' : 'secondary'}
                    className="w-full justify-center"
                  >
                    {detection.status === 'approved' ? 'Godkänd' : 'Avvisad'}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!detailDialog} onOpenChange={() => setDetailDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detailDialog?.detection_templates?.name || detailDialog?.object_type}
            </DialogTitle>
          </DialogHeader>
          
          {detailDialog && (
            <div className="space-y-4">
              <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                {detailDialog.thumbnail_url ? (
                  <img 
                    src={detailDialog.thumbnail_url} 
                    alt={detailDialog.object_type}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    Ingen förhandsvisning
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Konfidens:</span>
                  <span className="ml-2 font-medium">{Math.round(detailDialog.confidence * 100)}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Bild ID:</span>
                  <span className="ml-2 font-medium">{detailDialog.ivion_image_id || '-'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">AI-beskrivning:</span>
                  <p className="mt-1">{detailDialog.ai_description || 'Ingen beskrivning'}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialog(null)}>
              Stäng
            </Button>
            {detailDialog?.status === 'pending' && (
              <>
                <Button
                  variant="destructive"
                  onClick={() => {
                    rejectDetection(detailDialog.id);
                    setDetailDialog(null);
                  }}
                  disabled={isProcessing}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Avvisa
                </Button>
                <Button
                  onClick={() => {
                    approveDetection(detailDialog.id);
                    setDetailDialog(null);
                  }}
                  disabled={isProcessing}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Godkänn
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DetectionReviewQueue;
