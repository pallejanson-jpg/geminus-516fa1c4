import React, { useState, useEffect } from 'react';
import { Scan, Building2, CheckCircle2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import ScanConfigPanel from '@/components/ai-scan/ScanConfigPanel';
import ScanProgressPanel from '@/components/ai-scan/ScanProgressPanel';
import DetectionReviewQueue from '@/components/ai-scan/DetectionReviewQueue';

interface DetectionTemplate {
  id: string;
  name: string;
  object_type: string;
  description: string | null;
  is_active: boolean;
}

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

interface Building {
  fm_guid: string;
  name: string;
}

const AiAssetScan: React.FC = () => {
  const { toast } = useToast();
  
  const [templates, setTemplates] = useState<DetectionTemplate[]>([]);
  const [scanJobs, setScanJobs] = useState<ScanJob[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [activeScanJob, setActiveScanJob] = useState<ScanJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('configure');

  // Load templates, scan jobs, and buildings on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load templates
      const { data: templateData, error: templateError } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'get-templates' }
      });
      
      if (templateError) throw templateError;
      setTemplates(templateData || []);
      
      // Load scan jobs
      const { data: jobData, error: jobError } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'get-scan-jobs' }
      });
      
      if (jobError) throw jobError;
      setScanJobs(jobData || []);
      
      // Load buildings from assets (Category = "Building")
      const { data: buildingData, error: buildingError } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name')
        .eq('category', 'Building')
        .order('name');
      
      if (buildingError) throw buildingError;
      setBuildings((buildingData || []).map(b => ({
        fm_guid: b.fm_guid,
        name: b.name || b.common_name || 'Unnamed Building'
      })));
      
      // Check if there's an active scan
      const runningJob = (jobData || []).find((j: ScanJob) => j.status === 'running' || j.status === 'queued');
      if (runningJob) {
        setActiveScanJob(runningJob);
        setActiveTab('progress');
      }
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

  const handleScanStarted = (job: ScanJob) => {
    setActiveScanJob(job);
    setScanJobs(prev => [job, ...prev]);
    setActiveTab('progress');
  };

  const handleScanCompleted = (job: ScanJob) => {
    setActiveScanJob(null);
    setScanJobs(prev => prev.map(j => j.id === job.id ? job : j));
    setActiveTab('review');
    loadData(); // Reload to get pending detections count
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Laddar...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 md:p-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Scan className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">AI-assisterad inventering</h1>
            <p className="text-sm text-muted-foreground">
              Automatisk detektion av brandsläckare och nödutgångsskyltar i 360°-bilder
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Uppdatera
        </Button>
      </div>

      {/* Main content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="configure" disabled={!!activeScanJob}>
            <Building2 className="h-4 w-4 mr-2" />
            Konfigurera
          </TabsTrigger>
          <TabsTrigger value="progress">
            <RefreshCw className="h-4 w-4 mr-2" />
            Skanning
            {activeScanJob && (
              <Badge variant="secondary" className="ml-2 text-xs">
                Aktiv
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="review">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Granska
          </TabsTrigger>
        </TabsList>

        <TabsContent value="configure" className="flex-1 overflow-auto mt-0">
          <ScanConfigPanel
            templates={templates}
            buildings={buildings}
            onScanStarted={handleScanStarted}
          />
        </TabsContent>

        <TabsContent value="progress" className="flex-1 overflow-auto mt-0">
          <ScanProgressPanel
            activeScanJob={activeScanJob}
            recentJobs={scanJobs.slice(0, 5)}
            onScanCompleted={handleScanCompleted}
            onRefresh={loadData}
          />
        </TabsContent>

        <TabsContent value="review" className="flex-1 overflow-auto mt-0">
          <DetectionReviewQueue
            scanJobs={scanJobs}
            onDetectionProcessed={loadData}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AiAssetScan;
