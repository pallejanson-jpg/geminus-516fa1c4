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
  Building2, MapPin, Upload, Loader2, CheckCircle2, FileText, Layers, Timer, Cloud, Monitor
} from 'lucide-react';

/** Files larger than this threshold (in bytes) are converted server-side */
const SERVER_CONVERSION_THRESHOLD = 20 * 1024 * 1024; // 20 MB

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
  const [conversionStartTime, setConversionStartTime] = useState<number | null>(null);
  const [elapsedDisplay, setElapsedDisplay] = useState('');

  // Elapsed timer tick
  useEffect(() => {
    if (!conversionStartTime || conversionDone) return;
    const tick = () => {
      const sec = Math.floor((Date.now() - conversionStartTime) / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      setElapsedDisplay(m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [conversionStartTime, conversionDone]);

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
      toast({ variant: 'destructive', title: 'Please fill in all required fields' });
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
      if (!data?.success) throw new Error(data?.error || 'Creation failed');

      setCreatedBuilding({
        complexFmGuid: data.complexFmGuid,
        buildingFmGuid: data.buildingFmGuid,
        modelFmGuid: data.modelFmGuid,
        modelName: data.modelName,
        buildingName,
      });

      toast({
        title: 'Building created!',
        description: data.message,
      });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error creating building',
        description: err.message,
      });
    } finally {
      setIsCreating(false);
    }
  };

  // The building FM GUID to use for IFC upload
  const targetBuildingFmGuid = createdBuilding?.buildingFmGuid || selectedExistingFmGuid;
  const targetModelFmGuid = createdBuilding?.modelFmGuid || '';

  const handleIfcUpload = async () => {
    if (!ifcFile || !targetBuildingFmGuid) return;

    setIsConverting(true);
    setConversionProgress(0);
    setConversionLogs([]);
    setConversionDone(false);
    setConversionStartTime(Date.now());

    const useServerSide = ifcFile.size > SERVER_CONVERSION_THRESHOLD;

    try {
      addLog(`Reading file: ${ifcFile.name} (${(ifcFile.size / 1024 / 1024).toFixed(1)} MB)`);
      if (useServerSide) {
        addLog('📡 Large file detected — using server-side conversion');
      }
      setConversionProgress(10);

      if (useServerSide) {
        // ── Server-side path: upload IFC → call edge function ──
        const ifcStoragePath = `${targetBuildingFmGuid}/${ifcFile.name}`;
        addLog('Uploading IFC to storage...');
        const { error: ifcUploadError } = await supabase.storage
          .from('ifc-uploads')
          .upload(ifcStoragePath, ifcFile, {
            contentType: 'application/octet-stream',
            upsert: true,
          });
        if (ifcUploadError) throw new Error(`IFC upload failed: ${ifcUploadError.message}`);
        setConversionProgress(30);
        addLog('IFC uploaded. Starting server conversion...');

        const { data: convResult, error: fnError } = await supabase.functions.invoke('ifc-to-xkt', {
          body: {
            ifcStoragePath,
            buildingFmGuid: targetBuildingFmGuid,
            modelName: ifcFile.name.replace(/\.ifc$/i, ''),
          },
        });

        if (fnError) throw new Error(`Server conversion failed: ${fnError.message}`);
        if (!convResult?.success) throw new Error(convResult?.error || 'Conversion failed');

        setConversionProgress(85);
        addLog(`XKT generated: ${convResult.xktSizeMB} MB`);
        addLog(`Hierarchy: ${convResult.levels?.length || 0} levels, ${convResult.spaces?.length || 0} spaces`);

        // Create hierarchy in Asset+ if available
        const levels = convResult.levels || [];
        const spaces = convResult.spaces || [];
        if ((levels.length > 0 || spaces.length > 0) && targetModelFmGuid) {
          addLog(`Creating ${levels.length} levels and ${spaces.length} spaces in Asset+...`);
          const levelFmGuids = new Map<string, string>();
          const hierarchyLevels = levels.map((level: any) => {
            const fmGuid = crypto.randomUUID();
            levelFmGuids.set(level.id, fmGuid);
            return { fmGuid, designation: level.name, commonName: level.name };
          });
          const hierarchySpaces = spaces.map((space: any) => {
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
            { body: { buildingFmGuid: targetBuildingFmGuid, modelFmGuid: targetModelFmGuid, levels: hierarchyLevels, spaces: hierarchySpaces } }
          );
          if (hierarchyError) addLog(`⚠️ Hierarchy creation failed: ${hierarchyError.message}`);
          else if (hierarchyData?.success) addLog(`✅ ${hierarchyData.message}`);
          else addLog(`⚠️ ${hierarchyData?.error || 'Hierarchy creation failed'}`);
        }

      } else {
        // ── Client-side path: convert on main thread for small files ──
        addLog('🖥️ Small file — converting locally');
        const arrayBuffer = await ifcFile.arrayBuffer();
        setConversionProgress(20);

        addLog('Converting IFC to XKT and extracting hierarchy...');
        const result: IfcHierarchyResult = await convertToXktWithMetadata(arrayBuffer, (msg) => {
          addLog(msg);
          setConversionProgress(prev => Math.min(prev + 5, 70));
        });

        setConversionProgress(75);
        addLog(`XKT generated: ${(result.xktData.byteLength / 1024 / 1024).toFixed(2)} MB`);
        addLog(`Hierarchy: ${result.levels.length} levels, ${result.spaces.length} spaces`);

        // Upload XKT to storage
        const modelId = `ifc-${Date.now()}`;
        const storageFileName = `${modelId}.xkt`;
        const storagePath = `${targetBuildingFmGuid}/${storageFileName}`;

        addLog('Uploading XKT to storage...');
        const blob = new Blob([result.xktData], { type: 'application/octet-stream' });
        const { error: uploadError } = await supabase.storage
          .from('xkt-models')
          .upload(storagePath, blob, { contentType: 'application/octet-stream', upsert: true });

        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
        setConversionProgress(82);

        addLog('Saving XKT metadata...');
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

        if (dbError) throw new Error(`Database error: ${dbError.message}`);
        setConversionProgress(88);

        // Create hierarchy in Asset+
        if ((result.levels.length > 0 || result.spaces.length > 0) && targetModelFmGuid) {
          addLog(`Creating ${result.levels.length} levels and ${result.spaces.length} spaces in Asset+...`);
          const levelFmGuids = new Map<string, string>();
          const hierarchyLevels = result.levels.map(level => {
            const fmGuid = crypto.randomUUID();
            levelFmGuids.set(level.id, fmGuid);
            return { fmGuid, designation: level.name, commonName: level.name };
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
            { body: { buildingFmGuid: targetBuildingFmGuid, modelFmGuid: targetModelFmGuid, levels: hierarchyLevels, spaces: hierarchySpaces } }
          );
          if (hierarchyError) addLog(`⚠️ Hierarchy creation failed: ${hierarchyError.message}`);
          else if (hierarchyData?.success) addLog(`✅ ${hierarchyData.message}`);
          else addLog(`⚠️ ${hierarchyData?.error || 'Hierarchy creation failed'}`);
        } else if (result.levels.length > 0 || result.spaces.length > 0) {
          addLog('ℹ️ Hierarchy extracted but no modelFmGuid — saved locally only.');
        }
      }

      setConversionProgress(100);
      setConversionDone(true);
      addLog('✅ Done! The model is ready to view in the 3D viewer.');

      toast({
        title: 'IFC uploaded!',
        description: `${ifcFile.name} converted and saved as a 3D model.`,
      });
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`);
      toast({
        variant: 'destructive',
        title: 'Conversion error',
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
            <h3 className="font-semibold text-sm">Upload IFC to existing building</h3>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Select building</Label>
            <Select value={selectedExistingFmGuid} onValueChange={setSelectedExistingFmGuid}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select an existing building..." />
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
            <p className="text-xs text-muted-foreground text-center py-2">— OR —</p>
          )}
        </div>
      )}

      {/* Section 2: Create new building */}
      {!selectedExistingFmGuid && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">
              {createdBuilding ? 'Building created' : 'Create new property & building'}
            </h3>
            {createdBuilding && (
              <Badge variant="default" className="ml-auto gap-1">
                <CheckCircle2 className="h-3 w-3" /> Created
              </Badge>
            )}
          </div>

          {!createdBuilding ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Property designation *</Label>
                  <Input placeholder="e.g. PROPERTY-01" value={complexDesignation} onChange={e => setComplexDesignation(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Property name *</Label>
                  <Input placeholder="e.g. Main Street 5" value={complexName} onChange={e => setComplexName(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Building designation *</Label>
                  <Input placeholder="e.g. BLDG-A" value={buildingDesignation} onChange={e => setBuildingDesignation(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Building name *</Label>
                  <Input placeholder="e.g. Main Building" value={buildingName} onChange={e => setBuildingName(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Model name
                </Label>
                <Input placeholder="e.g. A-modell" value={modelName} onChange={e => setModelName(e.target.value)} className="h-9 text-sm" />
                <p className="text-[10px] text-muted-foreground">Creates a BIM model (ObjectType 5) under the building in Asset+</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Latitude</Label>
                  <Input type="number" step="any" placeholder="e.g. 59.3293" value={latitude} onChange={e => setLatitude(e.target.value)} className="h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Longitude</Label>
                  <Input type="number" step="any" placeholder="e.g. 18.0686" value={longitude} onChange={e => setLongitude(e.target.value)} className="h-9 text-sm" />
                </div>
              </div>

              <Button onClick={handleCreate} disabled={isCreating || !complexDesignation || !complexName || !buildingDesignation || !buildingName} className="w-full gap-2">
                {isCreating ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Creating in Asset+...</>
                ) : (
                  <><Building2 className="h-4 w-4" />Create in Asset+</>
                )}
              </Button>
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
              <p><span className="text-muted-foreground">Property:</span> {complexName} ({complexDesignation})</p>
              <p><span className="text-muted-foreground">Building:</span> {createdBuilding.buildingName} ({buildingDesignation})</p>
              <p><span className="text-muted-foreground">Model:</span> {createdBuilding.modelName}</p>
              <p className="text-muted-foreground font-mono text-[10px]">Building: {createdBuilding.buildingFmGuid}</p>
              <p className="text-muted-foreground font-mono text-[10px]">Model: {createdBuilding.modelFmGuid}</p>
            </div>
          )}
        </div>
      )}

      {/* Section 3: IFC Upload */}
      {showIfcUpload && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Upload IFC file</h3>
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
                  Convert
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
                <div className="flex items-center gap-2">
                  <Progress value={conversionProgress} className="h-2 flex-1" />
                  {isConverting && !conversionDone && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 tabular-nums">
                      <Timer className="h-3 w-3 animate-pulse text-primary" />
                      {elapsedDisplay}
                    </span>
                  )}
                </div>
                {isConverting && !conversionDone && (
                  <p className="text-[10px] text-muted-foreground animate-pulse flex items-center gap-1">
                    {ifcFile && ifcFile.size > SERVER_CONVERSION_THRESHOLD
                      ? <><Cloud className="h-3 w-3" /> Converting on server — this may take a few minutes…</>
                      : <><Monitor className="h-3 w-3" /> Parsing IFC locally — this may take several minutes for large files…</>
                    }
                  </p>
                )}
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
                    Model ready — it will appear automatically in the 3D viewer.
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
          {createdBuilding ? 'Create another building' : 'Start over'}
        </Button>
      )}
    </div>
  );
};

export default CreateBuildingPanel;
