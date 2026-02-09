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
}

const ScanConfigPanel: React.FC<ScanConfigPanelProps> = ({
  templates,
  buildings,
  onScanStarted,
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

  // Load building settings to check Ivion configuration
  useEffect(() => {
    loadBuildingSettings();
  }, []);

  // Check Ivion connection when building is selected
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

  // Check Ivion connection status (auto-authenticates)
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

  // Toggle template selection
  const toggleTemplate = (objectType: string) => {
    setSelectedTemplates(prev => 
      prev.includes(objectType)
        ? prev.filter(t => t !== objectType)
        : [...prev, objectType]
    );
  };

  // Get Ivion site ID for selected building
  const getIvionSiteId = (): string | null => {
    if (!selectedBuilding) return null;
    return buildingSettings[selectedBuilding]?.ivion_site_id || null;
  };

  // Test image access for selected building (HEAD-based, quick check)
  const testImageAccess = async () => {
    const siteId = getIvionSiteId();
    if (!siteId) {
      toast({
        title: 'Ivion ej konfigurerat',
        description: 'Vald byggnad har ingen Ivion-site konfigurerad',
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
        message: error.message || 'Kunde inte testa bildåtkomst',
      });
    } finally {
      setIsTestingAccess(false);
    }
  };

  // Test actual image download (GET-based, real download verification)
  const testImageDownload = async () => {
    const siteId = getIvionSiteId();
    if (!siteId) {
      toast({
        title: 'Ivion ej konfigurerat',
        description: 'Vald byggnad har ingen Ivion-site konfigurerad',
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
          title: 'Bildnedladdning misslyckades',
          description: data.error || 'Kontrollera NavVis/Ivion behörigheter',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      setDownloadTestResult({
        success: false,
        attempts: [],
        error: error.message || 'Kunde inte testa bildnedladdning',
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

  // Start scan — browser-based mode
  const startScan = async () => {
    const siteId = getIvionSiteId();
    if (!selectedBuilding || !siteId || selectedTemplates.length === 0) {
      toast({
        title: 'Ofullständig konfiguration',
        description: 'Välj byggnad och minst en objekttyp att söka efter',
        variant: 'destructive',
      });
      return;
    }

    setIsStarting(true);

    try {
      // Create scan job in DB
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: {
          action: 'start-scan',
          buildingFmGuid: selectedBuilding,
          ivionSiteId: siteId,
          templates: selectedTemplates,
        }
      });

      if (error) throw error;

      // Use the same Ivion base URL as the rest of the app
      const ivionBaseUrl = IVION_DEFAULT_BASE_URL;

      toast({
        title: 'Skanning startar',
        description: 'Öppnar 360°-visaren för webbläsarbaserad skanning...',
      });

      // Launch browser-based scan
      onScanStarted(data, { ivionBaseUrl });
    } catch (error: any) {
      toast({
        title: 'Kunde inte starta skanning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsStarting(false);
    }
  };

  // Filter buildings with Ivion configured
  const buildingsWithIvion = buildings.filter(b => 
    buildingSettings[b.fm_guid]?.ivion_site_id
  );

  const canStartScan = selectedBuilding && 
    getIvionSiteId() && 
    selectedTemplates.length > 0 && 
    !isStarting &&
    ivionStatus?.connected;

  return (
    <div className="space-y-6">
      {/* Building Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Välj byggnad
          </CardTitle>
          <CardDescription>
            Välj vilken byggnad som ska skannas. Endast byggnader med konfigurerad Ivion-koppling visas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingSettings ? (
            <p className="text-sm text-muted-foreground">Laddar byggnader...</p>
          ) : buildingsWithIvion.length === 0 ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Inga byggnader har Ivion-site konfigurerat. Gå till byggnadsinställningar och lägg till Ivion Site ID.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Select value={selectedBuilding} onValueChange={setSelectedBuilding}>
                <SelectTrigger>
                  <SelectValue placeholder="Välj byggnad..." />
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
                        <span className="text-sm text-muted-foreground">Kontrollerar Ivion-anslutning...</span>
                      </>
                    ) : ivionStatus?.connected ? (
                      <>
                        <Wifi className="h-4 w-4 text-green-600" />
                        <span className="text-sm text-green-700 dark:text-green-400">
                          Ivion ansluten
                        </span>
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {ivionStatus.authMethod === 'credentials' ? 'Auto-inloggad' : 'Token'}
                        </Badge>
                      </>
                    ) : (
                      <>
                        <WifiOff className="h-4 w-4 text-destructive" />
                        <span className="text-sm text-destructive">
                          {ivionStatus?.message || 'Ivion ej ansluten'}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={checkIvionConnection}
                          className="ml-auto"
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Försök igen
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
                      {isTestingAccess ? 'Testar...' : 'Testa åtkomst (snabb)'}
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
                      {isTestingDownload ? 'Laddar ner...' : 'Testa bildnedladdning (GET)'}
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
                              Bildnedladdning OK ({downloadTestResult.contentType}, {formatBytes(downloadTestResult.imageSize || 0)})
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-4 w-4 text-destructive" />
                            <span className="text-destructive">
                              {downloadTestResult.error || 'Bildnedladdning misslyckades'}
                            </span>
                          </>
                        )}
                      </div>
                      
                      {/* Show attempts for debugging */}
                      {downloadTestResult.attempts.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <p className="text-xs font-medium text-muted-foreground">Försök:</p>
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
                          Detta indikerar att NavVis/Ivion-kontot kan lista datasets men saknar behörighet att ladda ner bilddata. 
                          Kontrollera kontots behörigheter i NavVis.
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
            Välj objekttyper
          </CardTitle>
          <CardDescription>
            Välj vilka typer av objekt AI:n ska leta efter i 360°-bilderna.
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
                Inga detektionsmallar konfigurerade.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                <strong>Så fungerar det:</strong> Skanningen körs direkt i webbläsaren via 360°-visaren.
                AI:n analyserar skärmbilder tagna från panoramavyn och identifierar objekt baserat på valda mallar.
              </p>
              <p>
                Detekterade objekt visas i granskningskön där du kan godkänna eller avvisa dem.
                Godkända objekt skapas automatiskt som tillgångar i systemet.
              </p>
              <p>
                <strong>OBS:</strong> Håll webbläsarfliken öppen under hela skanningen.
                Du kan pausa och återuppta när som helst.
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
          {isStarting ? 'Startar...' : 'Starta AI-skanning'}
        </Button>
      </div>
    </div>
  );
};

export default ScanConfigPanel;
