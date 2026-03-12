import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Building2, MapPin, Upload, Loader2, CheckCircle2, FileText, Layers, Timer, Cloud, FileSpreadsheet, KeyRound, Pencil, RefreshCw, Database, ChevronDown
} from 'lucide-react';
import ExcelTemplateDownload from '@/components/import/ExcelTemplateDownload';
import ExcelImportDialog from '@/components/import/ExcelImportDialog';
import CreatePropertyDialog from '@/components/properties/CreatePropertyDialog';

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
  hasCustomAssetPlus: boolean;
  hasCustomSenslinc: boolean;
}

interface CreateBuildingPanelProps {
  onSwitchToAccTab?: () => void;
}

const CreateBuildingPanel: React.FC<CreateBuildingPanelProps> = ({ onSwitchToAccTab }) => {
  const { toast } = useToast();

  // ── Shared building selector ──
  const [existingBuildings, setExistingBuildings] = useState<ExistingBuilding[]>([]);
  const [selectedBuildingFmGuid, setSelectedBuildingFmGuid] = useState('');
  const [loadingBuildings, setLoadingBuildings] = useState(true);

  // ── Create new building form ──
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [complexDesignation, setComplexDesignation] = useState('');
  const [complexName, setComplexName] = useState('');
  const [buildingDesignation, setBuildingDesignation] = useState('');
  const [buildingName, setBuildingName] = useState('');
  const [modelName, setModelName] = useState('A-modell');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdBuilding, setCreatedBuilding] = useState<CreatedBuilding | null>(null);

  // ── IFC upload state ──
  const [ifcFile, setIfcFile] = useState<File | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [conversionLogs, setConversionLogs] = useState<string[]>([]);
  const [conversionDone, setConversionDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [conversionStartTime, setConversionStartTime] = useState<number | null>(null);
  const [elapsedDisplay, setElapsedDisplay] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Excel import state ──
  const [excelImportOpen, setExcelImportOpen] = useState(false);

  // ── Property dialog state ──
  const [propertyDialogOpen, setPropertyDialogOpen] = useState(false);
  const [editFmGuid, setEditFmGuid] = useState<string | null>(null);

  // ── Sync from Asset+ state ──
  const [isSyncingAssetPlus, setIsSyncingAssetPlus] = useState(false);

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

  // ── Fetch buildings (merged from assets + building_settings) ──
  const fetchBuildings = useCallback(async () => {
    setLoadingBuildings(true);
    try {
      // Fetch buildings from assets table
      const { data: assets } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name')
        .in('category', ['Building', 'IfcBuilding'])
        .order('common_name');

      // Fetch building_settings for credential badges
      const { data: settings } = await supabase
        .from('building_settings')
        .select('fm_guid, assetplus_api_url, senslinc_api_url');

      const settingsMap: Record<string, { hasAp: boolean; hasSl: boolean }> = {};
      (settings || []).forEach((s: any) => {
        settingsMap[s.fm_guid] = {
          hasAp: !!s.assetplus_api_url,
          hasSl: !!s.senslinc_api_url,
        };
      });

      // Build merged list — assets are the source of truth for names
      const buildings: ExistingBuilding[] = (assets || []).map(b => ({
        fmGuid: b.fm_guid,
        name: b.name || '',
        commonName: b.common_name || b.name || b.fm_guid,
        hasCustomAssetPlus: settingsMap[b.fm_guid]?.hasAp || false,
        hasCustomSenslinc: settingsMap[b.fm_guid]?.hasSl || false,
      }));

      // Add any building_settings entries that don't have an asset row
      (settings || []).forEach((s: any) => {
        if (!buildings.find(b => b.fmGuid === s.fm_guid)) {
          buildings.push({
            fmGuid: s.fm_guid,
            name: '',
            commonName: s.fm_guid.slice(0, 12) + '…',
            hasCustomAssetPlus: !!s.assetplus_api_url,
            hasCustomSenslinc: !!s.senslinc_api_url,
          });
        }
      });

      setExistingBuildings(buildings);
    } catch (err) {
      console.error('Failed to fetch buildings:', err);
    } finally {
      setLoadingBuildings(false);
    }
  }, []);

  useEffect(() => {
    fetchBuildings();
    const handler = () => fetchBuildings();
    window.addEventListener('building-settings-changed', handler);
    return () => window.removeEventListener('building-settings-changed', handler);
  }, [fetchBuildings]);

  // Also refetch after creating a building
  useEffect(() => {
    if (createdBuilding) fetchBuildings();
  }, [createdBuilding, fetchBuildings]);

  const addLog = useCallback((msg: string) => {
    setConversionLogs(prev => [...prev, msg]);
  }, []);

  // ── Create building handler ──
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
      if (!data?.success) throw new Error(data?.error || 'Creation failed');

      const created: CreatedBuilding = {
        complexFmGuid: data.complexFmGuid,
        buildingFmGuid: data.buildingFmGuid,
        modelFmGuid: data.modelFmGuid,
        modelName: data.modelName,
        buildingName,
      };
      setCreatedBuilding(created);
      setSelectedBuildingFmGuid(created.buildingFmGuid);
      setShowCreateForm(false);

      toast({ title: 'Byggnad skapad!', description: data.message });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Fel vid skapande', description: err.message });
    } finally {
      setIsCreating(false);
    }
  };

  // The building FM GUID to use for actions
  const targetBuildingFmGuid = selectedBuildingFmGuid;
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
      if (data.progress != null) setConversionProgress(data.progress);
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

  // ── IFC upload handler (same logic as before) ──
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

      const ifcStoragePath = `${targetBuildingFmGuid}/${ifcFile.name}`;
      addLog('📡 Uploading IFC to storage...');
      const { error: ifcUploadError } = await supabase.storage
        .from('ifc-uploads')
        .upload(ifcStoragePath, ifcFile, { contentType: 'application/octet-stream', upsert: true });
      if (ifcUploadError) throw new Error(`IFC upload failed: ${ifcUploadError.message}`);
      setConversionProgress(15);
      addLog('IFC uploaded to storage.');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

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

      if (useDirectBrowser) {
        addLog(`File is ${fileSizeMB.toFixed(0)} MB — using browser-based conversion`);
        await runBrowserConversion(ifcFile, targetBuildingFmGuid, jobId, safeModelName, addLog, setConversionProgress);
      } else {
        addLog('Starting server-side conversion...');
        startPolling(jobId);

        let convResult: any = null;
        let fnError: any = null;
        let isWorkerLimit = false;

        try {
          const resp = await supabase.functions.invoke('ifc-to-xkt', {
            body: { ifcStoragePath, buildingFmGuid: targetBuildingFmGuid, modelName: safeModelName, jobId },
          });
          convResult = resp.data;
          fnError = resp.error;

          if (fnError && typeof fnError === 'object' && 'context' in fnError) {
            try {
              const errResponse = (fnError as any).context;
              if (errResponse && typeof errResponse.json === 'function') {
                const errBody = await errResponse.json();
                if (errBody?.code === 'WORKER_LIMIT' || errBody?.message?.includes('compute resources')) {
                  isWorkerLimit = true;
                }
              }
            } catch (_) {}
          }
        } catch (e: any) {
          fnError = e;
        }

        if (!isWorkerLimit) {
          const errorString = JSON.stringify(fnError ?? '') + JSON.stringify(convResult ?? '') + (fnError?.message ?? '');
          isWorkerLimit = errorString.includes('WORKER_LIMIT') || errorString.includes('not having enough compute resources') || errorString.includes('546');
        }

        if (fnError && !isWorkerLimit) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          throw new Error(`Server conversion failed: ${fnError?.message || JSON.stringify(fnError)}`);
        }

        if (isWorkerLimit) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          addLog('⚠️ Server memory limit — switching to browser conversion...');
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
            addLog(`Systems: ${convResult.systemsCount || 0}, ${convResult.connectionsCount || 0} connections`);
          }

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
                fmGuid, designation: space.name, commonName: space.name,
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
          addLog('✅ Done! Model is ready in the 3D viewer.');
          toast({ title: 'IFC uploaded!', description: `${ifcFile.name} converted and saved.` });
          setIsConverting(false);
        }
      }
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`);
      toast({ variant: 'destructive', title: 'Conversion error', description: err.message });
      setIsConverting(false);
    }

    async function runBrowserConversion(
      file: File, buildingGuid: string, jobId: string, modelNameSafe: string,
      log: (msg: string) => void, setProgress: (p: number) => void,
    ) {
      try {
        const fileBuffer = await file.arrayBuffer();
        log(`Loaded ${(fileBuffer.byteLength / 1024 / 1024).toFixed(1)} MB into browser memory`);

        let converterModule: any;
        try { converterModule = await import('@/services/acc-xkt-converter'); }
        catch (importErr: any) { throw new Error(`Failed to load converter: ${importErr.message}`); }

        log('Converter loaded, starting IFC parsing...');
        await supabase.from('conversion_jobs').update({ status: 'processing', progress: 20, updated_at: new Date().toISOString() }).eq('id', jobId);

        const result = await converterModule.convertToXktWithMetadata(fileBuffer, (msg: string) => { log(msg); });
        setProgress(70);
        log(`XKT generated: ${(result.xktData.byteLength / 1024 / 1024).toFixed(2)} MB`);
        log(`Hierarchy: ${result.levels.length} levels, ${result.spaces.length} spaces`);
        if (result.systems?.length > 0) log(`Systems: ${result.systems.length} extracted`);

        const modelId = `ifc-${Date.now()}`;
        const storageFileName = `${modelId}.xkt`;
        const storagePath = `${buildingGuid}/${storageFileName}`;
        log('Uploading XKT to storage...');

        const blob = new Blob([result.xktData], { type: 'application/octet-stream' });
        const { error: uploadErr } = await supabase.storage.from('xkt-models').upload(storagePath, blob, { contentType: 'application/octet-stream', upsert: true });
        if (uploadErr) throw new Error(`XKT upload failed: ${uploadErr.message}`);

        if (result.metaModelJson && result.metaModelJson.metaObjects?.length > 0) {
          const metaPath = `${buildingGuid}/${modelId}_metadata.json`;
          const metaBlob = new Blob([JSON.stringify(result.metaModelJson)], { type: 'application/json' });
          const { error: metaUpErr } = await supabase.storage.from('xkt-models').upload(metaPath, metaBlob, { contentType: 'application/json', upsert: true });
          if (metaUpErr) log(`⚠️ Metadata upload failed: ${metaUpErr.message}`);
          else log(`Metadata JSON uploaded (${result.metaModelJson.metaObjects.length} objects)`);
        }

        setProgress(85);
        await supabase.from('xkt_models').upsert({
          building_fm_guid: buildingGuid, model_id: modelId, model_name: modelNameSafe,
          file_name: storageFileName, file_size: result.xktData.byteLength,
          storage_path: storagePath, file_url: null, format: 'xkt',
          synced_at: new Date().toISOString(), source_updated_at: new Date().toISOString(),
        } as any, { onConflict: 'building_fm_guid,model_id' });

        // Persist systems
        if (result.systems?.length > 0) {
          log(`Persisting ${result.systems.length} systems...`);
          for (const sys of result.systems) {
            const sysFmGuid = crypto.randomUUID();
            const { data: sysRow } = await supabase.from('systems').upsert({
              fm_guid: sysFmGuid, name: sys.name, system_type: sys.type, discipline: sys.discipline,
              building_fm_guid: buildingGuid, source: 'ifc-browser',
            } as any, { onConflict: 'fm_guid' }).select('id').single();
            if (sysRow?.id && sys.memberIds.length > 0) {
              const links = sys.memberIds.slice(0, 500).map((mid: string) => ({ system_id: sysRow.id, asset_fm_guid: mid }));
              await supabase.from('asset_system').upsert(links as any[], { onConflict: 'system_id,asset_fm_guid' });
            }
          }
          log(`✅ ${result.systems.length} systems saved`);
        }

        // Persist hierarchy to assets using IFC GlobalIds (deterministic)
        const now = new Date().toISOString();
        const importedFmGuids = new Set<string>();
        const levelFmGuids = new Map<string, string>();

        // Helper: deterministic GUID from building + name + type
        async function deterministicGuid(parts: string[]): Promise<string> {
          const data = new TextEncoder().encode(parts.join('|'));
          const hash = await crypto.subtle.digest('SHA-256', data);
          const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
          return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-${(parseInt(hex.slice(16,18),16) & 0x3f | 0x80).toString(16).padStart(2,'0')}${hex.slice(18,20)}-${hex.slice(20,32)}`;
        }

        if (result.levels?.length > 0) {
          const levelRows = [];
          for (const level of result.levels) {
            // Use IFC GlobalId if available from metaObjects, otherwise deterministic
            const fmGuid = level.globalId || await deterministicGuid([buildingGuid, level.name || '', 'IfcBuildingStorey']);
            levelFmGuids.set(level.id || level.name, fmGuid);
            importedFmGuids.add(fmGuid);
            levelRows.push({
              fm_guid: fmGuid, name: level.name, common_name: level.name,
              category: 'Building Storey', building_fm_guid: buildingGuid, level_fm_guid: fmGuid,
              is_local: false, created_in_model: true, synced_at: now,
            });
          }
          await supabase.from('assets').upsert(levelRows, { onConflict: 'fm_guid' });
          log(`✅ ${result.levels.length} levels saved`);
        }
        if (result.spaces?.length > 0) {
          const spaceRows = [];
          for (const space of result.spaces) {
            const fmGuid = space.globalId || await deterministicGuid([buildingGuid, space.name || '', 'IfcSpace']);
            importedFmGuids.add(fmGuid);
            const parentLevelFmGuid = levelFmGuids.get(space.parentId) || levelFmGuids.get(space.levelName) || null;
            spaceRows.push({
              fm_guid: fmGuid, name: space.name, common_name: space.name,
              category: 'Space', building_fm_guid: buildingGuid, level_fm_guid: parentLevelFmGuid,
              is_local: false, created_in_model: true, synced_at: now,
            });
          }
          await supabase.from('assets').upsert(spaceRows, { onConflict: 'fm_guid' });
          log(`✅ ${result.spaces.length} spaces saved`);
        }

        // Diff: soft-delete removed objects
        if (importedFmGuids.size > 0) {
          const { data: existingAssets } = await supabase
            .from('assets')
            .select('fm_guid')
            .eq('building_fm_guid', buildingGuid)
            .eq('created_in_model', true)
            .in('category', ['Building Storey', 'Space', 'Instance']);

          if (existingAssets && existingAssets.length > 0) {
            const removedGuids = existingAssets
              .map((a: any) => a.fm_guid)
              .filter((guid: string) => !importedFmGuids.has(guid));
            if (removedGuids.length > 0) {
              for (let i = 0; i < removedGuids.length; i += 500) {
                await supabase
                  .from('assets')
                  .update({ modification_status: 'removed', updated_at: now })
                  .in('fm_guid', removedGuids.slice(i, i + 500))
                  .eq('building_fm_guid', buildingGuid);
              }
              log(`🗑️ Marked ${removedGuids.length} removed assets`);
            }
          }
        }

        if ((result.levels?.length > 0 || result.spaces?.length > 0) && targetModelFmGuid) {
          log('Creating hierarchy in Asset+...');
          const hierarchyLevels = result.levels.map((level: any) => ({
            fmGuid: levelFmGuids.get(level.id || level.name) || crypto.randomUUID(),
            designation: level.name, commonName: level.name,
          }));
          const hierarchySpaces = result.spaces.map((space: any) => ({
            fmGuid: crypto.randomUUID(), designation: space.name, commonName: space.name,
            levelFmGuid: levelFmGuids.get(space.parentId) || levelFmGuids.get(space.levelName) || undefined,
          }));
          const { data: hData, error: hError } = await supabase.functions.invoke(
            'asset-plus-create-hierarchy',
            { body: { buildingFmGuid: buildingGuid, modelFmGuid: targetModelFmGuid, levels: hierarchyLevels, spaces: hierarchySpaces } }
          );
          if (hError) log(`⚠️ Asset+ hierarchy failed: ${hError.message}`);
          else if (hData?.success) log(`✅ ${hData.message}`);
        }

        await supabase.from('conversion_jobs').update({ status: 'done', progress: 100, result_model_id: modelId, updated_at: new Date().toISOString() }).eq('id', jobId);
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

  // ── Sync from Asset+ for selected building ──
  const handleSyncAssetPlus = async () => {
    if (!targetBuildingFmGuid) return;
    setIsSyncingAssetPlus(true);
    try {
      const { data, error } = await supabase.functions.invoke('asset-plus-sync', {
        body: { action: 'sync-building', buildingFmGuid: targetBuildingFmGuid },
      });
      if (error) throw error;
      toast({
        title: 'Asset+ sync complete',
        description: data?.message || `Synced ${data?.totalSynced || 0} objects.`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Asset+ sync failed', description: err.message });
    } finally {
      setIsSyncingAssetPlus(false);
    }
  };

  const handleResetIfc = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    setIfcFile(null);
    setConversionLogs([]);
    setConversionDone(false);
    setConversionProgress(0);
  };

  const selectedBuilding = existingBuildings.find(b => b.fmGuid === selectedBuildingFmGuid);

  return (
    <div className="space-y-5 py-2">
      {/* ══════ Building Selector ══════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-sm">Välj byggnad</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={fetchBuildings}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {loadingBuildings ? (
          <div className="text-xs text-muted-foreground py-2">Laddar byggnader...</div>
        ) : (
          <Select value={selectedBuildingFmGuid} onValueChange={(v) => { setSelectedBuildingFmGuid(v); setShowCreateForm(false); handleResetIfc(); }}>
            <SelectTrigger className="h-10 text-sm">
              <SelectValue placeholder="Välj en byggnad..." />
            </SelectTrigger>
            <SelectContent>
              {existingBuildings.map(b => (
                <SelectItem key={b.fmGuid} value={b.fmGuid}>
                  <span className="flex items-center gap-2">
                    {b.commonName}
                    {b.hasCustomAssetPlus && <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-1">Asset+</Badge>}
                    {b.hasCustomSenslinc && <Badge variant="secondary" className="text-[9px] px-1 py-0">Senslinc</Badge>}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {!selectedBuildingFmGuid && !showCreateForm && (
          <Button variant="outline" size="sm" onClick={() => setShowCreateForm(true)} className="w-full gap-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5" />
            Skapa ny byggnad i Asset+
          </Button>
        )}
      </div>

      {/* ══════ Create New Building (expandable) ══════ */}
      {showCreateForm && !selectedBuildingFmGuid && (
        <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
          <h4 className="font-medium text-sm">Skapa ny fastighet & byggnad</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Fastighetsbeteckning *</Label>
              <Input placeholder="t.ex. FASTIGHET-01" value={complexDesignation} onChange={e => setComplexDesignation(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fastighetsnamn *</Label>
              <Input placeholder="t.ex. Storgatan 5" value={complexName} onChange={e => setComplexName(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Byggnadsbeteckning *</Label>
              <Input placeholder="t.ex. HUS-A" value={buildingDesignation} onChange={e => setBuildingDesignation(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Byggnadsnamn *</Label>
              <Input placeholder="t.ex. Huvudbyggnad" value={buildingName} onChange={e => setBuildingName(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1"><Layers className="h-3 w-3" /> Modellnamn</Label>
            <Input placeholder="t.ex. A-modell" value={modelName} onChange={e => setModelName(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Latitud</Label>
              <Input type="number" step="any" placeholder="59.3293" value={latitude} onChange={e => setLatitude(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Longitud</Label>
              <Input type="number" step="any" placeholder="18.0686" value={longitude} onChange={e => setLongitude(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={isCreating || !complexDesignation || !complexName || !buildingDesignation || !buildingName} className="flex-1 gap-2">
              {isCreating ? <><Loader2 className="h-4 w-4 animate-spin" />Skapar...</> : <><Building2 className="h-4 w-4" />Skapa i Asset+</>}
            </Button>
            <Button variant="outline" onClick={() => setShowCreateForm(false)}>Avbryt</Button>
          </div>
        </div>
      )}

      {/* ══════ Actions for selected building ══════ */}
      {selectedBuildingFmGuid && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-3 px-1">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm truncate">{selectedBuilding?.commonName || selectedBuildingFmGuid}</span>
            <span className="text-[10px] font-mono text-muted-foreground truncate">{selectedBuildingFmGuid.slice(0, 8)}…</span>
          </div>

          <Accordion type="multiple" className="space-y-1">
            {/* ── Edit Credentials ── */}
            <AccordionItem value="credentials" className="border rounded-lg">
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/50 text-sm">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  <span>Redigera credentials</span>
                  {(selectedBuilding?.hasCustomAssetPlus || selectedBuilding?.hasCustomSenslinc) && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 ml-1">Custom</Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-1">
                <p className="text-xs text-muted-foreground mb-2">
                  Lägg till egna API-credentials för denna byggnad (Asset+, Senslinc).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { setEditFmGuid(selectedBuildingFmGuid); setPropertyDialogOpen(true); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Redigera
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* ── Upload IFC ── */}
            <AccordionItem value="ifc" className="border rounded-lg">
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/50 text-sm">
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  <span>Upload IFC</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Input ref={fileInputRef} type="file" accept=".ifc" onChange={e => setIfcFile(e.target.files?.[0] ?? null)} className="text-sm" disabled={isConverting || conversionDone} />
                  {ifcFile && !isConverting && !conversionDone && (
                    <Button onClick={handleIfcUpload} size="sm" className="gap-1.5 shrink-0">
                      <Upload className="h-3.5 w-3.5" /> Convert
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
                          <Timer className="h-3 w-3 animate-pulse text-primary" /> {elapsedDisplay}
                        </span>
                      )}
                    </div>
                    {isConverting && !conversionDone && (
                      <p className="text-[10px] text-muted-foreground animate-pulse flex items-center gap-1">
                        <Cloud className="h-3 w-3" /> Converting — kan ta några minuter…
                      </p>
                    )}
                    <div className="rounded-md border bg-background p-2 max-h-32 overflow-y-auto">
                      {conversionLogs.map((log, i) => (
                        <p key={i} className="text-[10px] font-mono text-muted-foreground leading-relaxed">{log}</p>
                      ))}
                    </div>
                    {conversionDone && (
                      <div className="flex items-center gap-1.5 text-xs text-green-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Modellen är klar — visas automatiskt i 3D-viewern.
                      </div>
                    )}
                  </div>
                )}
                {conversionDone && (
                  <Button variant="outline" size="sm" onClick={handleResetIfc} className="text-xs">
                    Ladda upp en till
                  </Button>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* ── Upload from ACC ── */}
            <AccordionItem value="acc" className="border rounded-lg">
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/50 text-sm">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-blue-500" />
                  <span>Upload from ACC</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-1 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Autodesk Construction Cloud-inställningar (inloggning, hub, projekt och filval) hanteras under{' '}
                  <strong>API</strong>-fliken. Där kan du logga in, bläddra i mappar och synka BIM-data till denna byggnad.
                </p>
                {onSwitchToAccTab && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={onSwitchToAccTab}>
                    <Layers className="h-3.5 w-3.5" /> Öppna ACC-inställningar
                  </Button>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* ── Sync from Asset+ ── */}
            <AccordionItem value="assetplus-sync" className="border rounded-lg">
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/50 text-sm">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span>Sync from Asset+</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-1 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Synka struktur och tillgångar från Asset+ för denna byggnad. Använd <strong>Sync</strong>-fliken för att synka alla byggnader.
                </p>
                <Button
                  onClick={handleSyncAssetPlus}
                  disabled={isSyncingAssetPlus}
                  size="sm"
                  className="gap-1.5"
                >
                  {isSyncingAssetPlus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Synka denna byggnad
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* ── Excel Import ── */}
            <AccordionItem value="excel" className="border rounded-lg">
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/50 text-sm">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                  <span>Import Excel</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-1 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Ladda ner en mall med våningar och rum, fyll i tillgångar offline, och importera tillbaka.
                </p>
                <div className="flex items-center gap-2">
                  <ExcelTemplateDownload
                    buildingFmGuid={targetBuildingFmGuid}
                    buildingName={selectedBuilding?.commonName || 'Building'}
                  />
                  <Button variant="outline" size="sm" onClick={() => setExcelImportOpen(true)} className="gap-1.5">
                    <Upload className="h-3.5 w-3.5" /> Import Excel
                  </Button>
                </div>
                <ExcelImportDialog
                  open={excelImportOpen}
                  onOpenChange={setExcelImportOpen}
                  buildingFmGuid={targetBuildingFmGuid}
                  buildingName={selectedBuilding?.commonName || 'Building'}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      {/* Property dialog */}
      <CreatePropertyDialog
        open={propertyDialogOpen}
        onOpenChange={setPropertyDialogOpen}
        editFmGuid={editFmGuid}
        onSaved={fetchBuildings}
      />
    </div>
  );
};

export default CreateBuildingPanel;
