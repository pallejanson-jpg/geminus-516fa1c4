import React, { useState, useEffect } from 'react';
import { Building2, Scan, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

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

interface ScanConfigPanelProps {
  templates: DetectionTemplate[];
  buildings: Building[];
  onScanStarted: (job: any) => void;
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
  const [accessTestResult, setAccessTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [buildingSettings, setBuildingSettings] = useState<Record<string, BuildingSettings>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Load building settings to check Ivion configuration
  useEffect(() => {
    loadBuildingSettings();
  }, []);

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

  // Test image access for selected building
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

  // Start scan
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
      const { data, error } = await supabase.functions.invoke('ai-asset-detection', {
        body: {
          action: 'start-scan',
          buildingFmGuid: selectedBuilding,
          ivionSiteId: siteId,
          templates: selectedTemplates,
        }
      });

      if (error) throw error;

      toast({
        title: 'Skanning startad',
        description: 'AI-skanningen har påbörjats',
      });

      onScanStarted(data);
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
    !isStarting;

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
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testImageAccess}
                    disabled={isTestingAccess}
                  >
                    {isTestingAccess ? 'Testar...' : 'Testa bildåtkomst'}
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
                      <span>{accessTestResult.message}</span>
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
                <strong>Så fungerar det:</strong> AI:n analyserar alla panoramabilder i den valda byggnaden
                och identifierar objekt baserat på valda mallar.
              </p>
              <p>
                Detekterade objekt visas i granskningskön där du kan godkänna eller avvisa dem.
                Godkända objekt skapas automatiskt som tillgångar i systemet.
              </p>
              <p>
                <strong>Uppskattad tid:</strong> ~1-2 min per 100 panoramabilder beroende på bildstorlek.
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
