import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Eye, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ExtractedProperties {
  brand?: string;
  model?: string;
  size?: string;
  type?: string;
  color?: string;
  mounting?: string;
  condition?: string;
  text_visible?: string;
}

interface PendingDetection {
  id: string;
  object_type: string;
  confidence: number;
  bounding_box: any;
  thumbnail_url: string | null;
  ai_description: string | null;
  extracted_properties: ExtractedProperties | null;
  status: string;
  building_fm_guid: string;
  ivion_image_id: number | null;
  ivion_dataset_name: string | null;
  coordinate_x: number | null;
  coordinate_y: number | null;
  coordinate_z: number | null;
  created_at: string;
  detection_templates: {
    name: string;
    description: string | null;
    default_category: string | null;
    default_symbol_id: string | null;
  } | null;
}

interface AnnotationSymbol {
  id: string;
  name: string;
  category: string;
  color: string;
  icon_url: string | null;
}

interface FloorAsset {
  fm_guid: string;
  name: string | null;
  common_name: string | null;
}

interface RoomAsset {
  fm_guid: string;
  name: string | null;
  common_name: string | null;
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

// ---------- ApprovalDialog ----------
interface ApprovalFormData {
  name: string;
  category: string;
  description: string;
  symbolId: string | null;
  levelFmGuid: string | null;
  roomFmGuid: string | null;
}

const ApprovalDialog: React.FC<{
  detection: PendingDetection;
  open: boolean;
  onClose: () => void;
  onApproved: () => void;
}> = ({ detection, open, onClose, onApproved }) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [floors, setFloors] = useState<FloorAsset[]>([]);
  const [rooms, setRooms] = useState<RoomAsset[]>([]);

  // Build pre-filled form data from template + extracted props
  const props = detection.extracted_properties || {};
  const templateName = detection.detection_templates?.name || detection.object_type;
  const defaultName = [props.brand, props.model, props.size].filter(Boolean).join(' ') || templateName;
  const defaultCategory = detection.detection_templates?.default_category || detection.object_type;
  const defaultDescription = [detection.detection_templates?.description, detection.ai_description]
    .filter(Boolean).join(' — ');

  const [form, setForm] = useState<ApprovalFormData>({
    name: defaultName,
    category: defaultCategory,
    description: defaultDescription,
    symbolId: detection.detection_templates?.default_symbol_id || null,
    levelFmGuid: null,
    roomFmGuid: null,
  });

  // Reset form when detection changes
  useEffect(() => {
    setForm({
      name: defaultName,
      category: defaultCategory,
      description: defaultDescription,
      symbolId: detection.detection_templates?.default_symbol_id || null,
      levelFmGuid: null,
      roomFmGuid: null,
    });
  }, [detection.id]);

  // Load symbols, floors, rooms
  useEffect(() => {
    if (!open) return;

    // Load annotation symbols
    supabase.from('annotation_symbols').select('id, name, category, color, icon_url')
      .order('name')
      .then(({ data }) => setSymbols(data || []));

    // Load floors (IfcBuildingStorey) for this building
    supabase.from('assets')
      .select('fm_guid, name, common_name')
      .eq('building_fm_guid', detection.building_fm_guid)
      .eq('category', 'IfcBuildingStorey')
      .order('name')
      .then(({ data }) => {
        const floorData = data || [];
        setFloors(floorData);

        // Auto-match floor by ivion_dataset_name
        if (detection.ivion_dataset_name && floorData.length > 0) {
          const dsName = detection.ivion_dataset_name.toLowerCase();
          const matched = floorData.find(f => {
            const fName = (f.name || '').toLowerCase();
            const fCommon = (f.common_name || '').toLowerCase();
            return fName === dsName || fCommon === dsName
              || dsName.includes(fName) || fName.includes(dsName)
              || dsName.includes(fCommon) || fCommon.includes(dsName);
          });
          if (matched) {
            setForm(prev => ({ ...prev, levelFmGuid: matched.fm_guid }));
          }
        }
      });
  }, [open, detection.building_fm_guid, detection.ivion_dataset_name]);

  // Load rooms when floor changes
  useEffect(() => {
    if (!form.levelFmGuid) {
      setRooms([]);
      return;
    }
    supabase.from('assets')
      .select('fm_guid, name, common_name')
      .eq('building_fm_guid', detection.building_fm_guid)
      .eq('level_fm_guid', form.levelFmGuid)
      .eq('category', 'IfcSpace')
      .order('name')
      .then(({ data }) => setRooms(data || []));
  }, [form.levelFmGuid, detection.building_fm_guid]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: {
          action: 'approve-detection',
          detectionId: detection.id,
          name: form.name,
          category: form.category,
          description: form.description,
          symbolId: form.symbolId,
          levelFmGuid: form.levelFmGuid,
          roomFmGuid: form.roomFmGuid,
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.message);

      toast({
        title: 'Approved',
        description: data.poiId
          ? `Asset created with POI #${data.poiId}`
          : 'Asset created from detection',
      });
      onClose();
      onApproved();
    } catch (error: any) {
      toast({ title: 'Error approving', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get building name for display
  const [buildingName, setBuildingName] = useState<string>('');
  useEffect(() => {
    if (!open) return;
    supabase.from('assets')
      .select('name, common_name')
      .eq('fm_guid', detection.building_fm_guid)
      .maybeSingle()
      .then(({ data }) => setBuildingName(data?.name || data?.common_name || detection.building_fm_guid));
  }, [open, detection.building_fm_guid]);

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Approve Detection</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Thumbnail */}
          {detection.thumbnail_url && (
            <div className="aspect-video bg-muted rounded-lg overflow-hidden">
              <img
                src={detection.thumbnail_url}
                alt={detection.object_type}
                className="w-full h-full object-contain"
              />
            </div>
          )}

          {/* Confidence badge */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              Confidence: {Math.round(detection.confidence * 100)}%
            </Badge>
            {props.brand && <Badge variant="outline">{props.brand}</Badge>}
            {props.model && <Badge variant="outline">{props.model}</Badge>}
          </div>

          {/* Name */}
          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>

          {/* Category */}
          <div className="space-y-1">
            <Label>Object type / Category</Label>
            <Input
              value={form.category}
              onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
            />
          </div>

          {/* Symbol */}
          <div className="space-y-1">
            <Label>Symbol</Label>
            <Select
              value={form.symbolId || 'none'}
              onValueChange={val => setForm(prev => ({ ...prev, symbolId: val === 'none' ? null : val }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select symbol" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No symbol</SelectItem>
                {symbols.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: s.color }} />
                      {s.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Building (read-only) */}
          <div className="space-y-1">
            <Label>Building</Label>
            <Input value={buildingName} readOnly className="bg-muted" />
          </div>

          {/* Floor */}
          <div className="space-y-1">
            <Label>Floor</Label>
            <Select
              value={form.levelFmGuid || 'none'}
              onValueChange={val => setForm(prev => ({ ...prev, levelFmGuid: val === 'none' ? null : val, roomFmGuid: null }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select floor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No floor</SelectItem>
                {floors.map(f => (
                  <SelectItem key={f.fm_guid} value={f.fm_guid}>
                    {f.name || f.common_name || f.fm_guid}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {detection.ivion_dataset_name && (
              <p className="text-xs text-muted-foreground">
                Ivion-dataset: {detection.ivion_dataset_name}
              </p>
            )}
          </div>

          {/* Room */}
          {form.levelFmGuid && (
            <div className="space-y-1">
              <Label>Room</Label>
              <Select
                value={form.roomFmGuid || 'none'}
                onValueChange={val => setForm(prev => ({ ...prev, roomFmGuid: val === 'none' ? null : val }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select room" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No room</SelectItem>
                  {rooms.map(r => (
                    <SelectItem key={r.fm_guid} value={r.fm_guid}>
                      {r.name || r.common_name || r.fm_guid}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Coordinates (read-only) */}
          {(detection.coordinate_x != null) && (
            <div className="space-y-1">
              <Label>Coordinates (3D)</Label>
              <div className="text-xs font-mono bg-muted p-2 rounded">
                X: {detection.coordinate_x?.toFixed(2)} &nbsp;
                Y: {detection.coordinate_y?.toFixed(2)} &nbsp;
                Z: {detection.coordinate_z?.toFixed(2)}
              </div>
            </div>
          )}

          {/* Extracted props summary */}
          {props && Object.keys(props).length > 0 && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <p className="text-xs font-medium mb-1">Extracted Properties</p>
              <div className="flex flex-wrap gap-1">
                {props.type && <Badge variant="outline" className="text-xs">{props.type}</Badge>}
                {props.color && <Badge variant="outline" className="text-xs">{props.color}</Badge>}
                {props.mounting && <Badge variant="outline" className="text-xs">{props.mounting}</Badge>}
                {props.condition && <Badge variant="outline" className="text-xs">{props.condition}</Badge>}
                {props.size && <Badge variant="secondary" className="text-xs">{props.size}</Badge>}
              </div>
              {props.text_visible && (
                <p className="mt-2 text-xs font-mono bg-background p-1 rounded">{props.text_visible}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !form.name}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Approve & Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ---------- Main component ----------
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
  const [approvalDetection, setApprovalDetection] = useState<PendingDetection | null>(null);
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

  // Open approval dialog for a single detection
  const openApprovalDialog = (detection: PendingDetection) => {
    setApprovalDetection(detection);
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
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>

              {scanJobs.length > 0 && (
                <Select value={selectedJobId || "all"} onValueChange={(val) => setSelectedJobId(val === "all" ? "" : val)}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="All scans" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All scans</SelectItem>
                    {scanJobs.map(job => (
                      <SelectItem key={job.id} value={job.id}>
                        {new Date(job.created_at).toLocaleDateString('en-US')} ({job.detections_found})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <span className="text-sm text-muted-foreground">
                {totalCount} total, {pendingCount} pending
              </span>
            </div>

            {statusFilter === 'pending' && pendingCount > 0 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                {selectedIds.size > 0 && (
                  <>
                    <Button variant="outline" size="sm" onClick={clearSelection}>
                      Deselect ({selectedIds.size})
                    </Button>
                    <Button
                      size="sm"
                      onClick={bulkApprove}
                      disabled={isProcessing}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Approve Selected
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={bulkReject}
                      disabled={isProcessing}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject Selected
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
            <p className="text-muted-foreground">Loading detections...</p>
          </CardContent>
        </Card>
      ) : detections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {statusFilter === 'pending' 
                ? 'No pending detections. Start a scan to find objects.'
                : 'No detections found with the selected filter.'
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
                    No preview
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

                {/* Show extracted brand/model badges */}
                {detection.extracted_properties && (
                  <div className="flex flex-wrap gap-1">
                    {detection.extracted_properties.brand && (
                      <Badge variant="outline" className="text-xs">
                        {detection.extracted_properties.brand}
                      </Badge>
                    )}
                    {detection.extracted_properties.model && (
                      <Badge variant="outline" className="text-xs">
                        {detection.extracted_properties.model}
                      </Badge>
                    )}
                    {detection.extracted_properties.size && (
                      <Badge variant="secondary" className="text-xs">
                        {detection.extracted_properties.size}
                      </Badge>
                    )}
                  </div>
                )}

                {detection.ai_description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {detection.ai_description}
                  </p>
                )}

                <div className="text-xs text-muted-foreground">
                  Image #{detection.ivion_image_id || '-'}
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
                        onClick={() => openApprovalDialog(detection)}
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
                    {detection.status === 'approved' ? 'Approved' : 'Rejected'}
                  </Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Detail Dialog (read-only view) */}
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
                    No preview
                  </div>
                )}
              </div>

              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-muted-foreground">Confidence:</span>
                    <span className="ml-2 font-medium">{Math.round(detailDialog.confidence * 100)}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Image ID:</span>
                    <span className="ml-2 font-medium">{detailDialog.ivion_image_id || '-'}</span>
                  </div>
                </div>

                {/* Extracted Properties Section */}
                {detailDialog.extracted_properties && Object.keys(detailDialog.extracted_properties).length > 0 && (
                  <div className="border rounded-lg p-3 bg-muted/30">
                    <h4 className="font-medium mb-2 text-foreground">Extracted Properties</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {detailDialog.extracted_properties.brand && (
                        <div>
                          <span className="text-muted-foreground">Brand:</span>
                          <span className="ml-2 font-medium">{detailDialog.extracted_properties.brand}</span>
                        </div>
                      )}
                      {detailDialog.extracted_properties.model && (
                        <div>
                          <span className="text-muted-foreground">Model:</span>
                          <span className="ml-2 font-medium">{detailDialog.extracted_properties.model}</span>
                        </div>
                      )}
                      {detailDialog.extracted_properties.size && (
                        <div>
                          <span className="text-muted-foreground">Size:</span>
                          <span className="ml-2 font-medium">{detailDialog.extracted_properties.size}</span>
                        </div>
                      )}
                      {detailDialog.extracted_properties.type && (
                        <div>
                          <span className="text-muted-foreground">Type:</span>
                          <span className="ml-2 font-medium">{detailDialog.extracted_properties.type}</span>
                        </div>
                      )}
                      {detailDialog.extracted_properties.color && (
                        <div>
                          <span className="text-muted-foreground">Färg:</span>
                          <span className="ml-2 font-medium">{detailDialog.extracted_properties.color}</span>
                        </div>
                      )}
                      {detailDialog.extracted_properties.mounting && (
                        <div>
                          <span className="text-muted-foreground">Montering:</span>
                          <span className="ml-2 font-medium">{detailDialog.extracted_properties.mounting}</span>
                        </div>
                      )}
                      {detailDialog.extracted_properties.condition && (
                        <div>
                          <span className="text-muted-foreground">Skick:</span>
                          <span className="ml-2 font-medium">{detailDialog.extracted_properties.condition}</span>
                        </div>
                      )}
                    </div>
                    {detailDialog.extracted_properties.text_visible && (
                      <div className="mt-2 pt-2 border-t">
                        <span className="text-muted-foreground">Synlig text:</span>
                        <p className="mt-1 font-mono text-xs bg-background p-2 rounded">
                          {detailDialog.extracted_properties.text_visible}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <span className="text-muted-foreground">AI Description:</span>
                  <p className="mt-1">{detailDialog.ai_description || 'No description'}</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialog(null)}>
              Close
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
                   Reject
                </Button>
                <Button
                  onClick={() => {
                    openApprovalDialog(detailDialog);
                    setDetailDialog(null);
                  }}
                  disabled={isProcessing}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval Dialog (pre-filled property form) */}
      {approvalDetection && (
        <ApprovalDialog
          detection={approvalDetection}
          open={!!approvalDetection}
          onClose={() => setApprovalDetection(null)}
          onApproved={() => {
            loadDetections();
            onDetectionProcessed();
          }}
        />
      )}
    </div>
  );
};

export default DetectionReviewQueue;
