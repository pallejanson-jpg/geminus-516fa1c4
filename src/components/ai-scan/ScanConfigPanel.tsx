import React, { useState, useEffect } from 'react';
import { Building2, Scan, AlertCircle, CheckCircle2, Info, Download, Loader2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';

interface DetectionTemplate {
  id: string;
  name: string;
  object_type: string;
  description: string | null;
  is_active: boolean;
}

interface Building {
  fm_guid: string;
  name: string;
}

interface BuildingSettings {
  fm_guid: string;
  ivion_site_id: string | null;
}

interface DownloadAttempt {
  method: string;
  url: string;
  status: number;
  contentType?: string;
  size?: number;
}

interface DownloadTestResult {
  success: boolean;
  attempts: DownloadAttempt[];
  imageSize?: number;
  contentType?: string;
  error?: string;
}

interface IvionStatus {
  connected: boolean;
  message: string;
  authMethod?: string;
}

interface ScanConfigPanelProps {
  templates: DetectionTemplate[];
  buildings: Building[];
  onScanStarted: (job: any, browserConfig?: { ivionBaseUrl: string }) => void;
  preselectedBuildingGuid?: string;
}

const ScanConfigPanel: React.FC<ScanConfigPanelProps> = ({
  templates,
  buildings,
  onScanStarted,
  preselectedBuildingGuid,
}) => {
  const { toast } = useToast();
  
  const [selectedBuilding, setSelectedBuilding] = useState<string>('');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isTestingAccess, setIsTestingAccess] = useState(false);
  const [isTestingDownload, setIsTestingDownload] = useState(false);
  const [isCheckingIvion, setIsCheckingIvion] = useState(false);
  const [ivionStatus, setIvionStatus] = useState<IvionStatus | null>(null);
  const [accessTestResult, setAccessTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [downloadTestResult, setDownloadTestResult] = useState<DownloadTestResult | null>(null);
  const [buildingSettings, setBuildingSettings] = useState<Record<string, BuildingSettings>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);

  useEffect(() => {
    if (templates.length > 0 && selectedTemplates.length === 0) {
      const allActive = templates.filter(t => t.is_active).map(t => t.object_type);
      if (allActive.length > 0) setSelectedTemplates(allActive);
    }
  }, [templates]);

  useEffect(() => {
    if (preselectedBuildingGuid && !selectedBuilding) {
      setSelectedBuilding(preselectedBuildingGuid);
    }
  }, [preselectedBuildingGuid]);

  useEffect(() => {
    loadBuildingSettings();
  }, []);

  useEffect(() => {
    if (selectedBuilding && buildingSettings[selectedBuilding]?.ivion_site_id) {
      checkIvionConnection();
    } else {
      setIvionStatus(null);
    }
  }, [selectedBuilding, buildingSettings]);

  const loadBuildingSettings = async () => {
    setLoadingSettings(true);
    try {
      const { data, error } = await supabase
        .from('building_settings')
        .select('fm_guid, ivion_site_id');
      
      if (error) throw error;
      
      const settings: Record<string, BuildingSettings> = {};
      (data || []).forEach((s: BuildingSettings) => {
        settings[s.fm_guid] = s;
      });
      setBuildingSettings(settings);
    } catch (error: any) {
      console.error('Failed to load building settings:', error);
    } finally {
      setLoadingSettings(false);
    }
  };

  const checkIvionConnection = async () => {
    setIsCheckingIvion(true);
    setIvionStatus(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('ivion-poi', {
        body: { 
          action: 'test-connection-auto',
          buildingFmGuid: selectedBuilding
        }
      });

      if (error) throw error;

      setIvionStatus({
        connected: data?.success || false,
        message: data?.message || 'Unknown status',
        authMethod: data?.authMethod,
      });
    } catch (error: any) {
      setIvionStatus({
        connected: false,
        message: error.message || 'Connection check failed',
      });
    } finally {
      setIsCheckingIvion(false);
    }
  };

  const toggleTemplate = (objectType: string) => {
    setSelectedTemplates(prev => 
      prev.includes(objectType)
        ? prev.filter(t => t !== objectType)
        : [...prev, objectType]
    );
  };

  const getIvionSiteId = (): string | null => {
    if (!selectedBuilding) return null;
    return buildingSettings[selectedBuilding]?.ivion_site_id || null;
  };

  const testImageAccess = async () => {
    const siteId = getIvionSiteId();
    if (!siteId) {
      toast({
        title: 'Ivion not configured',
        description: 'Selected building has no Ivion site configured',
        variant: 'destructive',
      });
      return;
    }

    setIsTestingAccess(true);
    setAccessTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'test-image-access', siteId }
      });

      if (error) throw error;
      setAccessTestResult(data);
    } catch (error: any) {
      setAccessTestResult({
        success: false,
        message: error.message || 'Could not test image access',
      });
    } finally {
      setIsTestingAccess(false);
    }
  };

  const testImageDownload = async () => {
    const siteId = getIvionSiteId();
    if (!siteId) {
      toast({
        title: 'Ivion not configured',
        description: 'Selected building has no Ivion site configured',
        variant: 'destructive',
      });
      return;
    }

    setIsTestingDownload(true);
    setDownloadTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'test-image-download', siteId }
      });

      if (error) throw error;
      setDownloadTestResult(data);
      
      if (!data.success) {
        toast({
          title: 'Image download failed',
          description: data.error || 'Check NavVis/Ivion permissions',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      setDownloadTestResult({
        success: false,
        attempts: [],
        error: error.message || 'Could not test image download',
      });
    } finally {
      setIsTestingDownload(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const startScan = async () => {
    const siteId = getIvionSiteId();
    if (!selectedBuilding || !siteId || selectedTemplates.length === 0) {
      toast({
        title: 'Incomplete configuration',
        description: 'Select a building and at least one object type to scan for',
        variant: 'destructive',
      });
      return;
    }

    setIsStarting(true);

    try {
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: {
          action: 'start-scan',
          buildingFmGuid: selectedBuilding,
          ivionSiteId: siteId,
          templates: selectedTemplates,
        }
      });

      if (error) throw error;

      const ivionBaseUrl = IVION_DEFAULT_BASE_URL;

      toast({
        title: 'Scan starting',
        description: 'Opening 360° viewer for browser-based scanning...',
      });

      onScanStarted(data, { ivionBaseUrl });
    } catch (error: any) {
      toast({
        title: 'Could not start scan',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsStarting(false);
    }
  };

  const buildingsWithIvion = buildings.filter(b => 
    buildingSettings[b.fm_guid]?.ivion_site_id
  );

  const canStartScan = selectedBuilding && 
    getIvionSiteId() && 
    selectedTemplates.length > 0 && 
    !isStarting &&
    ivionStatus?.connected;

  return (
    <div className="space-y-6 pb-4 max-w-4xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Building Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Select Building
          </CardTitle>
          <CardDescription>
            Choose which building to scan. Only buildings with a configured Ivion connection are shown.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingSettings ? (
            <p className="text-sm text-muted-foreground">Loading buildings...</p>
          ) : buildingsWithIvion.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No buildings have an Ivion site configured. Go to building settings and add an Ivion Site ID.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Select value={selectedBuilding} onValueChange={setSelectedBuilding}>
                <SelectTrigger>
                  <SelectValue placeholder="Select building..." />
                </SelectTrigger>
                <SelectContent>
                  {buildingsWithIvion.map(building => (
                    <SelectItem key={building.fm_guid} value={building.fm_guid}>
                      {building.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedBuilding && (
                <div className="space-y-3">
                  {/* Ivion Connection Status */}
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                    {isCheckingIvion ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Checking Ivion connection...</span>
                      </>
                    ) : ivionStatus?.connected ? (
                      <>
                        <Wifi className="h-4 w-4 text-green-600" />
                        <span className="text-sm text-green-700 dark:text-green-400">
                          Ivion connected
                        </span>
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {ivionStatus.authMethod === 'credentials' ? 'Auto-login' : 'Token'}
                        </Badge>
                      </>
                    ) : (
                      <>
                        <WifiOff className="h-4 w-4 text-destructive" />
                        <span className="text-sm text-destructive">
                          {ivionStatus?.message || 'Ivion not connected'}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={checkIvionConnection}
                          className="ml-auto"
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Quick access test */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testImageAccess}
                      disabled={isTestingAccess || isTestingDownload || !ivionStatus?.connected}
                    >
                      {isTestingAccess ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                      {isTestingAccess ? 'Testing...' : 'Test access (quick)'}
                    </Button>
                    {accessTestResult && (
                      <div className={`flex items-center gap-1 text-sm ${
                        accessTestResult.success ? 'text-green-600' : 'text-destructive'
                      }`}>
                        {accessTestResult.success ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <AlertCircle className="h-4 w-4" />
                        )}
                        <span className="truncate max-w-xs">{accessTestResult.message}</span>
                      </div>
                    )}
                  </div>

                  {/* Full download test */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testImageDownload}
                      disabled={isTestingAccess || isTestingDownload}
                    >
                      {isTestingDownload ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
                      {isTestingDownload ? 'Downloading...' : 'Test image download (GET)'}
                    </Button>
                  </div>

                  {/* Download test result */}
                  {downloadTestResult && (
                    <div className={`p-3 rounded-lg text-sm ${
                      downloadTestResult.success 
                        ? 'bg-green-50 border border-green-200 dark:bg-green-950/20 dark:border-green-900' 
                        : 'bg-destructive/10 border border-destructive/30'
                    }`}>
                      <div className="flex items-center gap-2 font-medium mb-2">
                        {downloadTestResult.success ? (
                          <>
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                            <span className="text-green-700 dark:text-green-400">
                              Image download OK ({downloadTestResult.contentType}, {formatBytes(downloadTestResult.imageSize || 0)})
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <span className="text-destructive">
                              {downloadTestResult.error || 'Image download failed'}
                            </span>
                          </>
                        )}
                      </div>
                      
                      {/* Show attempts for debugging */}
                      {downloadTestResult.attempts.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Attempts:</p>
                          {downloadTestResult.attempts.map((attempt, i) => (
                            <div key={i} className="text-xs font-mono bg-background/50 p-1 rounded flex items-center gap-2">
                              <span className={`px-1 rounded ${
                                attempt.status >= 200 && attempt.status < 300 
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' 
                                  : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                              }`}>
                                {attempt.status}
                              </span>
                              <span className="text-muted-foreground">{attempt.method}</span>
                              {attempt.contentType && <span className="text-muted-foreground">({attempt.contentType})</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {!downloadTestResult.success && (
                        <p className="text-xs text-muted-foreground mt-2">
                          This indicates the NavVis/Ivion account can list datasets but lacks permission to download image data.
                          Check the account permissions in NavVis.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Template Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Select Object Types
          </CardTitle>
          <CardDescription>
            Choose which types of objects the AI should look for in the 360° images.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {templates.map(template => (
              <div key={template.id} className="flex items-start space-x-3">
                <Checkbox
                  id={template.id}
                  checked={selectedTemplates.includes(template.object_type)}
                  onCheckedChange={() => toggleTemplate(template.object_type)}
                />
                <div className="space-y-1">
                  <Label
                    htmlFor={template.id}
                    className="font-medium cursor-pointer"
                  >
                    {template.name}
                  </Label>
                  {template.description && (
                    <p className="text-sm text-muted-foreground">
                      {template.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
            
            {templates.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No detection templates configured.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                <strong>How it works:</strong> The scan runs directly in the browser via the 360° viewer.
                The AI analyzes screenshots taken from the panorama view and identifies objects based on selected templates.
              </p>
              <p>
                Detected objects appear in the review queue where you can approve or reject them.
                Approved objects are automatically created as assets in the system.
              </p>
              <p>
                <strong>Note:</strong> Keep the browser tab open during the entire scan.
                You can pause and resume at any time.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Start Button */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={startScan}
          disabled={!canStartScan}
        >
          <Scan className="h-5 w-5 mr-2" />
          {isStarting ? 'Starting...' : 'Start AI Scan'}
        </Button>
      </div>
    </div>
  );
};

export default ScanConfigPanel;
