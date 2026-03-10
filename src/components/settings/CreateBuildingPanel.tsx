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
  Building2, MapPin, Upload, Loader2, CheckCircle2, FileText, Layers, Timer, Cloud, FileSpreadsheet
} from 'lucide-react';
import ExcelTemplateDownload from '@/components/import/ExcelTemplateDownload';
import ExcelImportDialog from '@/components/import/ExcelImportDialog';

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

  // Excel import state
  const [excelImportOpen, setExcelImportOpen] = useState(false);

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

    const fileSizeMB = ifcFile.size / 1024 / 1024;
    const useDirectBrowser = fileSizeMB > 20;

    try {
      addLog(`Reading file: ${ifcFile.name} (${fileSizeMB.toFixed(1)} MB)`);
      setConversionProgress(5);

      // 1. Upload IFC to storage (always, for archival)
      const ifcStoragePath = `${targetBuildingFmGuid}/${ifcFile.name}`;
      addLog('📡 Uploading IFC to storage...');
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

      // Route: >20MB → direct browser, ≤20MB → try edge function first
      if (useDirectBrowser) {
        addLog(`File is ${fileSizeMB.toFixed(0)} MB — using browser-based conversion (skipping server)`);
        await runBrowserConversion(ifcFile, targetBuildingFmGuid, jobId, safeModelName, addLog, setConversionProgress);
      } else {
        addLog('Conversion job created. Starting server-side conversion...');

        // Start polling for progress
        startPolling(jobId);

        // Invoke edge function
        let convResult: any = null;
        let fnError: any = null;
        let isWorkerLimit = false;

        try {
          const resp = await supabase.functions.invoke('ifc-to-xkt', {
            body: {
              ifcStoragePath,
              buildingFmGuid: targetBuildingFmGuid,
              modelName: safeModelName,
              jobId,
            },
          });
          convResult = resp.data;
          fnError = resp.error;

          if (fnError && typeof fnError === 'object' && 'context' in fnError) {
            try {
              const errResponse = (fnError as any).context;
              if (errResponse && typeof errResponse.json === 'function') {
                const errBody = await errResponse.json();
                console.log('[ifc-convert] Edge function error body:', errBody);
                if (errBody?.code === 'WORKER_LIMIT' || errBody?.message?.includes('compute resources')) {
                  isWorkerLimit = true;
                }
              }
            } catch (_) { /* response already consumed */ }
          }
        } catch (e: any) {
          fnError = e;
        }

        if (!isWorkerLimit) {
          const errorString = JSON.stringify(fnError ?? '') + JSON.stringify(convResult ?? '') + (fnError?.message ?? '');
          isWorkerLimit = errorString.includes('WORKER_LIMIT') || 
            errorString.includes('not having enough compute resources') ||
            errorString.includes('546');
        }

        console.log('[ifc-convert] fnError:', fnError, 'isWorkerLimit:', isWorkerLimit);

        if (fnError && !isWorkerLimit) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          throw new Error(`Server conversion failed: ${fnError?.message || JSON.stringify(fnError)}`);
        }

        if (isWorkerLimit) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          addLog('⚠️ Server memory limit exceeded — switching to browser-based conversion...');
          setConversionProgress(20);
          await runBrowserConversion(ifcFile, targetBuildingFmGuid, jobId, safeModelName, addLog, setConversionProgress);
        } else if (convResult && !convResult.success) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          throw new Error(convResult.error || 'Conversion failed');
        } else if (convResult?.success) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;

          setConversionProgress(90);
          addLog(`XKT generated: ${convResult.xktSizeMB} MB`);
          addLog(`Hierarchy: ${convResult.levels?.length || 0} levels, ${convResult.spaces?.length || 0} spaces`);
          if (convResult.systemsCount || convResult.connectionsCount) {
            addLog(`Systems: ${convResult.systemsCount || 0} system, ${convResult.connectionsCount || 0} connections`);
          }

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
          toast({ title: 'IFC uploaded!', description: `${ifcFile.name} converted and saved as a 3D model.` });
          setIsConverting(false);
        }
        // If convResult is null (timeout but still processing), polling continues
      }
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`);
      toast({ variant: 'destructive', title: 'Conversion error', description: err.message });
      setIsConverting(false);
    }

    /** Browser-side conversion with metadata extraction and system persistence */
    async function runBrowserConversion(
      file: File,
      buildingGuid: string,
      jobId: string,
      modelNameSafe: string,
      log: (msg: string) => void,
      setProgress: (p: number) => void,
    ) {
      try {
        const fileBuffer = await file.arrayBuffer();
        log(`Loaded ${(fileBuffer.byteLength / 1024 / 1024).toFixed(1)} MB into browser memory`);

        let converterModule: any;
        try {
          converterModule = await import('@/services/acc-xkt-converter');
        } catch (importErr: any) {
          throw new Error(`Failed to load converter: ${importErr.message}`);
        }

        log('Converter loaded, starting IFC parsing...');

        // Mark job as processing immediately
        await supabase.from('conversion_jobs').update({
          status: 'processing', progress: 20,
          updated_at: new Date().toISOString(),
        }).eq('id', jobId);

        const result = await converterModule.convertToXktWithMetadata(fileBuffer, (msg: string) => {
          log(msg);
        });

        setProgress(70);
        log(`XKT generated: ${(result.xktData.byteLength / 1024 / 1024).toFixed(2)} MB`);
        log(`Hierarchy: ${result.levels.length} levels, ${result.spaces.length} spaces`);
        if (result.systems?.length > 0) {
          log(`Systems: ${result.systems.length} extracted client-side`);
        }

        // Upload XKT to storage
        const modelId = `ifc-${Date.now()}`;
        const storageFileName = `${modelId}.xkt`;
        const storagePath = `${buildingGuid}/${storageFileName}`;
        log('Uploading XKT to storage...');

        const blob = new Blob([result.xktData], { type: 'application/octet-stream' });
        const { error: uploadErr } = await supabase.storage
          .from('xkt-models')
          .upload(storagePath, blob, { contentType: 'application/octet-stream', upsert: true });
        if (uploadErr) throw new Error(`XKT upload failed: ${uploadErr.message}`);

        // Upload metadata.json alongside
        if (result.metaModelJson && result.metaModelJson.metaObjects?.length > 0) {
          const metaPath = `${buildingGuid}/${modelId}_metadata.json`;
          const metaBlob = new Blob([JSON.stringify(result.metaModelJson)], { type: 'application/json' });
          const { error: metaUpErr } = await supabase.storage
            .from('xkt-models')
            .upload(metaPath, metaBlob, { contentType: 'application/json', upsert: true });
          if (metaUpErr) {
            log(`⚠️ Metadata upload failed: ${metaUpErr.message}`);
          } else {
            log(`Metadata JSON uploaded (${result.metaModelJson.metaObjects.length} objects)`);
          }
        }

        setProgress(85);

        // Save XKT model record
        await supabase.from('xkt_models').upsert({
          building_fm_guid: buildingGuid,
          model_id: modelId,
          model_name: modelNameSafe,
          file_name: storageFileName,
          file_size: result.xktData.byteLength,
          storage_path: storagePath,
          file_url: null,
          format: 'xkt',
          synced_at: new Date().toISOString(),
          source_updated_at: new Date().toISOString(),
        } as any, { onConflict: 'building_fm_guid,model_id' });

        // Persist extracted systems to DB
        if (result.systems?.length > 0) {
          log(`Persisting ${result.systems.length} systems to database...`);
          for (const sys of result.systems) {
            const sysFmGuid = crypto.randomUUID();
            const { data: sysRow } = await supabase.from('systems').upsert({
              fm_guid: sysFmGuid,
              name: sys.name,
              system_type: sys.type,
              discipline: sys.discipline,
              building_fm_guid: buildingGuid,
              source: 'ifc-browser',
            } as any, { onConflict: 'fm_guid' }).select('id').single();

            if (sysRow?.id && sys.memberIds.length > 0) {
              const links = sys.memberIds.slice(0, 500).map(mid => ({
                system_id: sysRow.id,
                asset_fm_guid: mid,
              }));
              await supabase.from('asset_system').upsert(links as any[], { onConflict: 'system_id,asset_fm_guid' });
            }
          }
          log(`✅ ${result.systems.length} systems saved`);
        }

        // Persist extracted hierarchy (levels + spaces) to assets table
        const levelFmGuids = new Map<string, string>();
        if (result.levels?.length > 0) {
          log(`Persisting ${result.levels.length} levels to assets table...`);
          const levelRows = result.levels.map((level: any) => {
            const fmGuid = crypto.randomUUID();
            levelFmGuids.set(level.id || level.name, fmGuid);
            return {
              fm_guid: fmGuid,
              name: level.name,
              common_name: level.name,
              category: 'Building Storey',
              building_fm_guid: buildingGuid,
              level_fm_guid: fmGuid,
              is_local: false,
              created_in_model: false,
              synced_at: new Date().toISOString(),
            };
          });
          const { error: levelErr } = await supabase.from('assets').upsert(levelRows, { onConflict: 'fm_guid' });
          if (levelErr) log(`⚠️ Level insert error: ${levelErr.message}`);
          else log(`✅ ${result.levels.length} levels saved`);
        }

        if (result.spaces?.length > 0) {
          log(`Persisting ${result.spaces.length} spaces to assets table...`);
          const spaceRows = result.spaces.map((space: any) => {
            const fmGuid = crypto.randomUUID();
            const parentLevelFmGuid = levelFmGuids.get(space.parentId) || levelFmGuids.get(space.levelName) || null;
            return {
              fm_guid: fmGuid,
              name: space.name,
              common_name: space.name,
              category: 'Space',
              building_fm_guid: buildingGuid,
              level_fm_guid: parentLevelFmGuid,
              is_local: false,
              created_in_model: false,
              synced_at: new Date().toISOString(),
            };
          });
          const { error: spaceErr } = await supabase.from('assets').upsert(spaceRows, { onConflict: 'fm_guid' });
          if (spaceErr) log(`⚠️ Space insert error: ${spaceErr.message}`);
          else log(`✅ ${result.spaces.length} spaces saved`);
        }

        // Call asset-plus-create-hierarchy if we have hierarchy data and a model GUID
        if ((result.levels?.length > 0 || result.spaces?.length > 0) && targetModelFmGuid) {
          log('Creating hierarchy in Asset+...');
          const hierarchyLevels = result.levels.map((level: any) => ({
            fmGuid: levelFmGuids.get(level.id || level.name) || crypto.randomUUID(),
            designation: level.name,
            commonName: level.name,
          }));
          const hierarchySpaces = result.spaces.map((space: any) => ({
            fmGuid: crypto.randomUUID(),
            designation: space.name,
            commonName: space.name,
            levelFmGuid: levelFmGuids.get(space.parentId) || levelFmGuids.get(space.levelName) || undefined,
          }));
          const { data: hData, error: hError } = await supabase.functions.invoke(
            'asset-plus-create-hierarchy',
            { body: { buildingFmGuid: buildingGuid, modelFmGuid: targetModelFmGuid, levels: hierarchyLevels, spaces: hierarchySpaces } }
          );
          if (hError) log(`⚠️ Asset+ hierarchy failed: ${hError.message}`);
          else if (hData?.success) log(`✅ ${hData.message}`);
          else log(`⚠️ ${hData?.error || 'Hierarchy creation failed'}`);
        }

        // Update conversion job to done
        await supabase.from('conversion_jobs').update({
          status: 'done', progress: 100,
          result_model_id: modelId,
          updated_at: new Date().toISOString(),
        }).eq('id', jobId);

        setProgress(100);
        setConversionDone(true);
        log('✅ Done! Browser-based conversion succeeded.');
        toast({ title: 'IFC converted!', description: `${file.name} converted in browser and saved.` });
      } catch (clientErr: any) {
        log(`❌ Browser conversion failed: ${clientErr.message}`);
        toast({ variant: 'destructive', title: 'Conversion failed', description: clientErr.message });
      }
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

      {/* Section 4: Excel Import */}
      {showIfcUpload && (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            <h3 className="font-semibold text-sm">Import Excel</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Download a template pre-filled with floors and rooms, fill in assets offline, and import back.
          </p>
          <div className="flex items-center gap-2">
            <ExcelTemplateDownload
              buildingFmGuid={targetBuildingFmGuid}
              buildingName={
                createdBuilding?.buildingName ||
                existingBuildings.find(b => b.fmGuid === selectedExistingFmGuid)?.commonName ||
                 'Building'
              }
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExcelImportOpen(true)}
              className="gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" /> Import Excel
            </Button>
          </div>
          <ExcelImportDialog
            open={excelImportOpen}
            onOpenChange={setExcelImportOpen}
            buildingFmGuid={targetBuildingFmGuid}
            buildingName={
              createdBuilding?.buildingName ||
              existingBuildings.find(b => b.fmGuid === selectedExistingFmGuid)?.commonName ||
              'Byggnad'
            }
          />
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
