import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Building2, MapPin, Upload, Loader2, CheckCircle2, FileText, Layers, Timer, Cloud
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
  const [conversionStartTime, setConversionStartTime] = useState<number | null>(null);
  const [elapsedDisplay, setElapsedDisplay] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

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

  const addLog = useCallback((msg: string) => {
    setConversionLogs(prev => [...prev, msg]);
  }, []);

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

  /** Poll conversion_jobs for progress updates */
  const startPolling = useCallback((jobId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('conversion_jobs')
        .select('status, progress, log_messages, error_message, result_model_id')
        .eq('id', jobId)
        .single();

      if (!data) return;

      // Update progress
      if (data.progress != null) setConversionProgress(data.progress);

      // Update logs from server
      if (data.log_messages && Array.isArray(data.log_messages)) {
        setConversionLogs(data.log_messages as string[]);
      }

      if (data.status === 'done') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setConversionDone(true);
        setIsConverting(false);
      } else if (data.status === 'error') {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setIsConverting(false);
        addLog(`❌ Error: ${data.error_message || 'Unknown error'}`);
      }
    }, 2000);
  }, [addLog]);

  const handleIfcUpload = async () => {
    if (!ifcFile || !targetBuildingFmGuid) return;

    setIsConverting(true);
    setConversionProgress(0);
    setConversionLogs([]);
    setConversionDone(false);
    setConversionStartTime(Date.now());

    try {
      addLog(`Reading file: ${ifcFile.name} (${(ifcFile.size / 1024 / 1024).toFixed(1)} MB)`);
      addLog('📡 Uploading IFC to server for conversion...');
      setConversionProgress(5);

      // 1. Upload IFC to storage
      const ifcStoragePath = `${targetBuildingFmGuid}/${ifcFile.name}`;
      const { error: ifcUploadError } = await supabase.storage
        .from('ifc-uploads')
        .upload(ifcStoragePath, ifcFile, {
          contentType: 'application/octet-stream',
          upsert: true,
        });
      if (ifcUploadError) throw new Error(`IFC upload failed: ${ifcUploadError.message}`);
      setConversionProgress(15);
      addLog('IFC uploaded to storage.');

      // 2. Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 3. Create conversion job row
      const safeModelName = ifcFile.name.replace(/\.ifc$/i, '');
      const { data: jobRow, error: jobError } = await supabase
        .from('conversion_jobs')
        .insert({
          building_fm_guid: targetBuildingFmGuid,
          ifc_storage_path: ifcStoragePath,
          model_name: safeModelName,
          status: 'pending',
          progress: 0,
          log_messages: [],
          created_by: user.id,
        })
        .select('id')
        .single();

      if (jobError || !jobRow) throw new Error(`Failed to create conversion job: ${jobError?.message}`);
      const jobId = jobRow.id;
      addLog('Conversion job created. Starting server-side conversion...');

      // 4. Start polling for progress
      startPolling(jobId);

      // 5. Invoke edge function (fire-and-forget style — polling handles updates)
      const { data: convResult, error: fnError } = await supabase.functions.invoke('ifc-to-xkt', {
        body: {
          ifcStoragePath,
          buildingFmGuid: targetBuildingFmGuid,
          modelName: safeModelName,
          jobId,
        },
      });

      if (fnError) {
        // Edge function returned error immediately
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        throw new Error(`Server conversion failed: ${fnError.message}`);
      }

      if (convResult && !convResult.success) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        throw new Error(convResult.error || 'Conversion failed');
      }

      // Edge function returned success — polling may already have set done
      if (convResult?.success) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;

        setConversionProgress(90);
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

        setConversionProgress(100);
        setConversionDone(true);
        addLog('✅ Done! The model is ready to view in the 3D viewer.');

        toast({
          title: 'IFC uploaded!',
          description: `${ifcFile.name} converted and saved as a 3D model.`,
        });
        setIsConverting(false);
      }
      // If convResult is null (timeout but still processing), polling continues
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`);
      toast({
        variant: 'destructive',
        title: 'Conversion error',
        description: err.message,
      });
      setIsConverting(false);
    }
  };

  const handleReset = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
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
                    <Cloud className="h-3 w-3" /> Converting on server — this may take a few minutes…
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
