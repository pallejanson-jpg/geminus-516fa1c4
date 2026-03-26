import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scan, Building2, CheckCircle2, RefreshCw, ArrowLeft, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import ScanConfigPanel from '@/components/ai-scan/ScanConfigPanel';
import ScanProgressPanel from '@/components/ai-scan/ScanProgressPanel';
import DetectionReviewQueue from '@/components/ai-scan/DetectionReviewQueue';
import TemplateManagement from '@/components/ai-scan/TemplateManagement';
import BrowserScanRunner from '@/components/ai-scan/BrowserScanRunner';

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

interface BrowserScanConfig {
  scanJobId: string;
  buildingFmGuid: string;
  ivionSiteId: string;
  ivionBaseUrl: string;
  templates: string[];
}

interface AiAssetScanProps {
  preselectedBuildingGuid?: string;
}

const AiAssetScan: React.FC<AiAssetScanProps> = ({ preselectedBuildingGuid: propBuildingGuid }) => {
  // Also read from URL search params as fallback
  const urlBuildingGuid = new URLSearchParams(window.location.search).get('building');
  const preselectedBuildingGuid = propBuildingGuid || urlBuildingGuid || undefined;
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  
  const [templates, setTemplates] = useState<DetectionTemplate[]>([]);
  const [scanJobs, setScanJobs] = useState<ScanJob[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [activeScanJob, setActiveScanJob] = useState<ScanJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('configure');
  const [browserScanConfig, setBrowserScanConfig] = useState<BrowserScanConfig | null>(null);

  const handleBack = () => {
    if (browserScanConfig) {
      if (confirm('Cancel ongoing scan?')) {
        setBrowserScanConfig(null);
      }
      return;
    }
    navigate('/inventory');
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const { data: templateData, error: templateError } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'get-templates' }
      });
      if (templateError) throw templateError;
      setTemplates(templateData || []);
      
      const { data: jobData, error: jobError } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'get-scan-jobs' }
      });
      if (jobError) throw jobError;
      setScanJobs(jobData || []);
      
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
      
      const runningJob = (jobData || []).find((j: ScanJob) => j.status === 'running' || j.status === 'queued');
      if (runningJob) {
        setActiveScanJob(runningJob);
        setActiveTab('progress');
      }
    } catch (error: any) {
      toast({
        title: 'Loading error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleScanStarted = (job: ScanJob, browserConfig?: { ivionBaseUrl: string }) => {
    setActiveScanJob(job);
    setScanJobs(prev => [job, ...prev]);

    if (browserConfig) {
      // Launch browser-based scan
      setBrowserScanConfig({
        scanJobId: job.id,
        buildingFmGuid: job.building_fm_guid,
        ivionSiteId: job.ivion_site_id,
        ivionBaseUrl: browserConfig.ivionBaseUrl,
        templates: job.templates,
      });
    } else {
      setActiveTab('progress');
    }
  };

  const handleScanCompleted = (job: ScanJob) => {
    setActiveScanJob(null);
    setBrowserScanConfig(null);
    setScanJobs(prev => prev.map(j => j.id === job.id ? job : j));
    setActiveTab('review');
    loadData();
  };

  const handleBrowserScanCancelled = () => {
    setActiveScanJob(null);
    setBrowserScanConfig(null);
    loadData();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show browser scan runner when active
  if (browserScanConfig) {
    return (
      <div className="h-full flex flex-col p-3 md:p-6 bg-background">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="icon" onClick={handleBack} className="shrink-0 h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="p-1.5 bg-primary/10 rounded-lg shrink-0">
            <Scan className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-base md:text-xl font-semibold">AI scan in progress</h1>
        </div>
        <BrowserScanRunner
          scanJobId={browserScanConfig.scanJobId}
          buildingFmGuid={browserScanConfig.buildingFmGuid}
          ivionSiteId={browserScanConfig.ivionSiteId}
          ivionBaseUrl={browserScanConfig.ivionBaseUrl}
          templates={browserScanConfig.templates}
          onCompleted={handleScanCompleted}
          onCancelled={handleBrowserScanCancelled}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-3 md:p-6 overflow-auto bg-background">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6 gap-2">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleBack}
            className="shrink-0 h-8 w-8 md:h-10 md:w-10"
          >
            <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
          </Button>
          <div className="p-1.5 md:p-2 bg-primary/10 rounded-lg shrink-0">
            <Scan className="h-5 w-5 md:h-6 md:w-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base md:text-xl font-semibold truncate text-foreground">AI-Assisted Inventory</h1>
            {!isMobile && (
              <p className="text-sm text-foreground/70">
                Automatic detection of assets in 360° images
              </p>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} className="shrink-0">
          <RefreshCw className="h-4 w-4" />
          {!isMobile && <span className="ml-2">Refresh</span>}
        </Button>
      </div>

      {/* Main content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid w-full grid-cols-4 mb-3 md:mb-4 h-auto p-1">
          <TabsTrigger 
            value="configure" 
            disabled={!!activeScanJob}
            className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 py-2 px-1 md:px-3 text-xs md:text-sm"
          >
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="truncate">{isMobile ? 'Config' : 'Configure'}</span>
          </TabsTrigger>
          <TabsTrigger 
            value="progress"
            className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 py-2 px-1 md:px-3 text-xs md:text-sm relative"
          >
            <RefreshCw className="h-4 w-4 shrink-0" />
            <span className="truncate">Scanning</span>
            {activeScanJob && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full md:hidden" />
            )}
            {activeScanJob && !isMobile && (
              <Badge variant="secondary" className="ml-1 text-xs">Active</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger 
            value="review"
            className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 py-2 px-1 md:px-3 text-xs md:text-sm"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="truncate">Review</span>
          </TabsTrigger>
          <TabsTrigger 
            value="templates"
            className="flex flex-col md:flex-row items-center gap-0.5 md:gap-2 py-2 px-1 md:px-3 text-xs md:text-sm"
          >
            <Settings2 className="h-4 w-4 shrink-0" />
            <span className="truncate">Templates</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="configure" className="flex-1 overflow-auto mt-0">
          <ScanConfigPanel
            templates={templates}
            buildings={buildings}
            onScanStarted={handleScanStarted}
            preselectedBuildingGuid={preselectedBuildingGuid}
          />
        </TabsContent>

        <TabsContent value="progress" className="flex-1 overflow-auto mt-0">
          <ScanProgressPanel
            activeScanJob={activeScanJob}
            recentJobs={scanJobs.slice(0, 5)}
            onScanCompleted={handleScanCompleted}
            onScanCancelled={() => {
              setActiveScanJob(null);
              loadData();
            }}
            onRefresh={loadData}
          />
        </TabsContent>

        <TabsContent value="review" className="flex-1 overflow-auto mt-0">
          <DetectionReviewQueue
            scanJobs={scanJobs}
            onDetectionProcessed={loadData}
          />
        </TabsContent>

        <TabsContent value="templates" className="flex-1 overflow-auto mt-0">
          <TemplateManagement onTemplatesChanged={loadData} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AiAssetScan;
