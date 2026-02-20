import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { convertToXktWithMetadata, type IfcHierarchyResult } from '@/services/acc-xkt-converter';
import {
  Building2, MapPin, Upload, Loader2, CheckCircle2, FileText, Layers
} from 'lucide-react';

interface CreatedBuilding {
  complexFmGuid: string;
  buildingFmGuid: string;
  modelFmGuid: string;
  modelName: string;
  buildingName: string;
}

interface ExistingBuilding {
  fmGuid: string;
  name: string;
  commonName: string;
}

const CreateBuildingPanel: React.FC = () => {
  const { toast } = useToast();

  // Form state
  const [complexDesignation, setComplexDesignation] = useState('');
  const [complexName, setComplexName] = useState('');
  const [buildingDesignation, setBuildingDesignation] = useState('');
  const [buildingName, setBuildingName] = useState('');
  const [modelName, setModelName] = useState('A-modell');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [createdBuilding, setCreatedBuilding] = useState<CreatedBuilding | null>(null);

  // Existing building state
  const [existingBuildings, setExistingBuildings] = useState<ExistingBuilding[]>([]);
  const [selectedExistingFmGuid, setSelectedExistingFmGuid] = useState('');

  // IFC upload state
  const [ifcFile, setIfcFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [conversionLogs, setConversionLogs] = useState<string[]>([]);
  const [conversionDone, setConversionDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch existing buildings
  useEffect(() => {
    const fetchBuildings = async () => {
      const { data } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name')
        .in('category', ['Building', 'IfcBuilding'])
        .order('common_name');
      if (data) {
        setExistingBuildings(data.map(b => ({
          fmGuid: b.fm_guid,
          name: b.name || '',
          commonName: b.common_name || b.name || b.fm_guid,
        })));
      }
    };
    fetchBuildings();
  }, [createdBuilding]);

  const addLog = (msg: string) => {
    setConversionLogs(prev => [...prev, msg]);
  };

  const handleCreate = async () => {
    if (!complexDesignation || !complexName || !buildingDesignation || !buildingName) {
      toast({ variant: 'destructive', title: 'Fyll i alla obligatoriska fält' });
      return;
    }

    setIsCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('asset-plus-create-building', {
        body: {
          complexDesignation,
          complexName,
          buildingDesignation,
          buildingName,
          modelName: modelName || 'A-modell',
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Skapandet misslyckades');

      setCreatedBuilding({
        complexFmGuid: data.complexFmGuid,
        buildingFmGuid: data.buildingFmGuid,
        modelFmGuid: data.modelFmGuid,
        modelName: data.modelName,
        buildingName,
      });

      toast({
        title: 'Byggnad skapad!',
        description: data.message,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Fel vid skapande',
        description: err.message,
      });
    } finally {
      setIsCreating(false);
    }
  };

  // The building FM GUID to use for IFC upload (either newly created or selected existing)
  const targetBuildingFmGuid = createdBuilding?.buildingFmGuid || selectedExistingFmGuid;
  const targetModelFmGuid = createdBuilding?.modelFmGuid || '';

  const handleIfcUpload = async () => {
    if (!ifcFile || !targetBuildingFmGuid) return;

    setIsConverting(true);
    setConversionProgress(0);
    setConversionLogs([]);
    setConversionDone(false);

    try {
      addLog(`Läser fil: ${ifcFile.name} (${(ifcFile.size / 1024 / 1024).toFixed(1)} MB)`);
      setConversionProgress(10);

      const arrayBuffer = await ifcFile.arrayBuffer();
      setConversionProgress(20);

      addLog('Konverterar IFC till XKT och extraherar hierarki...');
      const result: IfcHierarchyResult = await convertToXktWithMetadata(arrayBuffer, (msg) => {
        addLog(msg);
        setConversionProgress(prev => Math.min(prev + 5, 70));
      });

      setConversionProgress(75);
      addLog(`XKT genererad: ${(result.xktData.byteLength / 1024 / 1024).toFixed(2)} MB`);
      addLog(`Hierarki: ${result.levels.length} våningsplan, ${result.spaces.length} rum`);

      // Upload XKT to storage
      const modelId = `ifc-${Date.now()}`;
      const storageFileName = `${modelId}.xkt`;
      const storagePath = `${targetBuildingFmGuid}/${storageFileName}`;

      addLog('Laddar upp XKT till storage...');
      const blob = new Blob([result.xktData], { type: 'application/octet-stream' });
      const { error: uploadError } = await supabase.storage
        .from('xkt-models')
        .upload(storagePath, blob, {
          contentType: 'application/octet-stream',
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload misslyckades: ${uploadError.message}`);
      setConversionProgress(82);

      // Save XKT metadata
      addLog('Sparar XKT-metadata...');
      const { error: dbError } = await supabase
        .from('xkt_models')
        .upsert({
          building_fm_guid: targetBuildingFmGuid,
          model_id: modelId,
          model_name: ifcFile.name.replace(/\.ifc$/i, ''),
          file_name: storageFileName,
          file_size: result.xktData.byteLength,
          storage_path: storagePath,
          format: 'xkt',
          synced_at: new Date().toISOString(),
          source_updated_at: new Date().toISOString(),
        } as any, { onConflict: 'building_fm_guid,model_id' });

      if (dbError) throw new Error(`Databasfel: ${dbError.message}`);
      setConversionProgress(88);

      // Create hierarchy in Asset+ if we have levels/spaces
      if ((result.levels.length > 0 || result.spaces.length > 0) && targetModelFmGuid) {
        addLog(`Skapar ${result.levels.length} våningsplan och ${result.spaces.length} rum i Asset+...`);

        // Build level FmGuid map (IFC id -> generated FmGuid)
        const levelFmGuids = new Map<string, string>();
        const hierarchyLevels = result.levels.map(level => {
          const fmGuid = crypto.randomUUID();
          levelFmGuids.set(level.id, fmGuid);
          return {
            fmGuid,
            designation: level.name,
            commonName: level.name,
          };
        });

        const hierarchySpaces = result.spaces.map(space => {
          const fmGuid = crypto.randomUUID();
          return {
            fmGuid,
            designation: space.name,
            commonName: space.name,
            levelFmGuid: levelFmGuids.get(space.parentId) || undefined,
          };
        });

        const { data: hierarchyData, error: hierarchyError } = await supabase.functions.invoke(
          'asset-plus-create-hierarchy',
          {
            body: {
              buildingFmGuid: targetBuildingFmGuid,
              modelFmGuid: targetModelFmGuid,
              levels: hierarchyLevels,
              spaces: hierarchySpaces,
            },
          }
        );

        if (hierarchyError) {
          addLog(`⚠️ Hierarki-skapande misslyckades: ${hierarchyError.message}`);
        } else if (hierarchyData?.success) {
          addLog(`✅ ${hierarchyData.message}`);
        } else {
          addLog(`⚠️ ${hierarchyData?.error || 'Hierarki-skapande misslyckades'}`);
        }
      } else if (result.levels.length > 0 || result.spaces.length > 0) {
        addLog('ℹ️ Hierarki extraherad men ingen modelFmGuid – sparas bara lokalt.');
      }

      setConversionProgress(100);
      setConversionDone(true);
      addLog('✅ Klart! Modellen är redo att visas i 3D-viewern.');

      toast({
        title: 'IFC uppladdad!',
        description: `${ifcFile.name} konverterad och sparad som 3D-modell.`,
      });
    } catch (err: any) {
      addLog(`❌ Fel: ${err.message}`);
      toast({
        variant: 'destructive',
        title: 'Konverteringsfel',
        description: err.message,
      });
    } finally {
      setIsConverting(false);
    }
  };

  const handleReset = () => {
    setCreatedBuilding(null);
    setComplexDesignation('');
    setComplexName('');
    setBuildingDesignation('');
    setBuildingName('');
    setModelName('A-modell');
    setLatitude('');
    setLongitude('');
    setIfcFile(null);
    setConversionLogs([]);
    setConversionDone(false);
    setConversionProgress(0);
    setSelectedExistingFmGuid('');
  };

  const showIfcUpload = createdBuilding || selectedExistingFmGuid;

  return (
    <div className="space-y-6 py-2">
      {/* Section 1: Upload IFC to existing building */}
      {!createdBuilding && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Ladda upp IFC till befintlig byggnad</h3>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Välj byggnad</Label>
            <Select value={selectedExistingFmGuid} onValueChange={setSelectedExistingFmGuid}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Välj en befintlig byggnad..." />
              </SelectTrigger>
              <SelectContent>
                {existingBuildings.map(b => (
                  <SelectItem key={b.fmGuid} value={b.fmGuid}>
                    {b.commonName} {b.name && b.name !== b.commonName ? `(${b.name})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!selectedExistingFmGuid && (
            <p className="text-xs text-muted-foreground text-center py-2">— ELLER —</p>
          )}
        </div>
      )}

      {/* Section 2: Create new building */}
      {!selectedExistingFmGuid && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">
              {createdBuilding ? 'Byggnad skapad' : 'Skapa ny fastighet & byggnad'}
            </h3>
            {createdBuilding && (
              <Badge variant="default" className="ml-auto gap-1">
                <CheckCircle2 className="h-3 w-3" /> Skapad
              </Badge>
            )}
          </div>

          {!createdBuilding ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fastighetsbeteckning *</Label>
                  <Input placeholder="t.ex. FASTIGHET-01" value={complexDesignation} onChange={e => setComplexDesignation(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Fastighetsnamn *</Label>
                  <Input placeholder="t.ex. Kvarngatan 5" value={complexName} onChange={e => setComplexName(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Byggnadsbeteckning *</Label>
                  <Input placeholder="t.ex. HUS-A" value={buildingDesignation} onChange={e => setBuildingDesignation(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Byggnadsnamn *</Label>
                  <Input placeholder="t.ex. Huvudbyggnaden" value={buildingName} onChange={e => setBuildingName(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Modellnamn
                </Label>
                <Input placeholder="t.ex. A-modell" value={modelName} onChange={e => setModelName(e.target.value)} className="h-9 text-sm" />
                <p className="text-[10px] text-muted-foreground">Skapar en BIM-modell (ObjectType 5) under byggnaden i Asset+</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Latitud</Label>
                  <Input type="number" step="any" placeholder="t.ex. 59.3293" value={latitude} onChange={e => setLatitude(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Longitud</Label>
                  <Input type="number" step="any" placeholder="t.ex. 18.0686" value={longitude} onChange={e => setLongitude(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>

              <Button onClick={handleCreate} disabled={isCreating || !complexDesignation || !complexName || !buildingDesignation || !buildingName} className="w-full gap-2">
                {isCreating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Skapar i Asset+...</>
                ) : (
                  <><Building2 className="h-4 w-4" />Skapa i Asset+</>
                )}
              </Button>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
              <p><span className="text-muted-foreground">Fastighet:</span> {complexName} ({complexDesignation})</p>
              <p><span className="text-muted-foreground">Byggnad:</span> {createdBuilding.buildingName} ({buildingDesignation})</p>
              <p><span className="text-muted-foreground">Modell:</span> {createdBuilding.modelName}</p>
              <p className="text-muted-foreground font-mono text-[10px]">Building: {createdBuilding.buildingFmGuid}</p>
              <p className="text-muted-foreground font-mono text-[10px]">Model: {createdBuilding.modelFmGuid}</p>
            </div>
          )}
        </div>
      )}

      {/* Step 3: IFC Upload */}
      {showIfcUpload && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Ladda upp IFC-fil</h3>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                ref={fileInputRef}
                type="file"
                accept=".ifc"
                onChange={e => setIfcFile(e.target.files?.[0] ?? null)}
                className="text-sm"
                disabled={isConverting || conversionDone}
              />
              {ifcFile && !isConverting && !conversionDone && (
                <Button onClick={handleIfcUpload} size="sm" className="gap-1.5 shrink-0">
                  <Upload className="h-3.5 w-3.5" />
                  Konvertera
                </Button>
              )}
            </div>

            {ifcFile && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                {ifcFile.name} — {(ifcFile.size / 1024 / 1024).toFixed(1)} MB
              </div>
            )}

            {(isConverting || conversionDone) && (
              <div className="space-y-2">
                <Progress value={conversionProgress} className="h-2" />
                <div className="rounded-md border bg-background p-2 max-h-32 overflow-y-auto">
                  {conversionLogs.map((log, i) => (
                    <p key={i} className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                      {log}
                    </p>
                  ))}
                </div>
                {conversionDone && (
                  <div className="flex items-center gap-1.5 text-xs text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Modellen är klar och visas automatiskt i 3D-viewern.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reset button */}
      {(createdBuilding || selectedExistingFmGuid) && (
        <Button variant="outline" size="sm" onClick={handleReset} className="w-full">
          {createdBuilding ? 'Skapa ytterligare en byggnad' : 'Börja om'}
        </Button>
      )}
    </div>
  );
};

export default CreateBuildingPanel;
