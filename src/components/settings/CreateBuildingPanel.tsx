import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { deleteBuilding } from '@/services/asset-plus-service';
import {
  Building2, MapPin, Upload, Loader2, CheckCircle2, FileText, Layers, Timer, Cloud, FileSpreadsheet, KeyRound, Pencil, RefreshCw, Database, ChevronDown, PlayCircle, Trash2, AlertTriangle, RotateCcw, Eye, X
} from 'lucide-react';
import ExcelTemplateDownload from '@/components/import/ExcelTemplateDownload';
import ExcelImportDialog from '@/components/import/ExcelImportDialog';
import CreatePropertyDialog from '@/components/properties/CreatePropertyDialog';
import { formatDistanceToNow } from 'date-fns';

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

  // ── Batch enqueue state ──
  const [isBatchEnqueuing, setIsBatchEnqueuing] = useState(false);

  // ── Delete building state ──
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Conversion jobs state ──
  const [conversionJobs, setConversionJobs] = useState<any[]>([]);
  const [expandedJobLogs, setExpandedJobLogs] = useState<Set<string>>(new Set());
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Track active job ID for beforeunload + heartbeat
  const activeJobIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling + heartbeat on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  // beforeunload guard — warn user if conversion is active
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (activeJobIdRef.current) {
        e.preventDefault();
        e.returnValue = 'IFC conversion in progress. Are you sure you want to leave?';
        // Mark job as failed on unload (best-effort via sendBeacon with auth headers)
        const jobId = activeJobIdRef.current;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/conversion_jobs?id=eq.${jobId}`;
        const body = JSON.stringify({ status: 'error', error_message: 'Browser tab closed during conversion', updated_at: new Date().toISOString() });
        // sendBeacon doesn't support custom headers, so we use fetch with keepalive instead
        try {
          fetch(url, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': anonKey,
              'Authorization': `Bearer ${anonKey}`,
              'Prefer': 'return=minimal',
            },
            body,
            keepalive: true,
          });
        } catch (_) { /* best-effort */ }
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Auto-reset own stale jobs on mount (processing > 3 min without updates)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const { data: staleJobs } = await supabase
        .from('conversion_jobs')
        .select('id, model_name')
        .eq('created_by', user.id)
        .eq('status', 'processing')
        .lt('updated_at', threeMinAgo);
      if (staleJobs && staleJobs.length > 0) {
        for (const job of staleJobs) {
          await supabase.from('conversion_jobs').update({
            status: 'error',
            error_message: 'Auto-reset: stale job detected (no progress for 3+ minutes)',
            updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          console.warn(`Auto-reset stale conversion job: ${job.id} (${job.model_name})`);
        }
      }
    })();
  }, []);

  // ── Fetch buildings (merged from assets + building_settings) ──
  const fetchBuildings = useCallback(async () => {
    setLoadingBuildings(true);
    try {
      // Fetch buildings from assets table (include complex_common_name)
      const { data: assets } = await supabase
        .from('assets')
        .select('fm_guid, name, common_name, complex_common_name')
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
      const buildings: ExistingBuilding[] = (assets || []).map(b => {
        const buildingLabel = b.common_name || b.name || b.fm_guid;
        const displayName = b.complex_common_name 
          ? `${b.complex_common_name} — ${buildingLabel}`
          : buildingLabel;
        return {
          fmGuid: b.fm_guid,
          name: b.name || '',
          commonName: displayName,
          hasCustomAssetPlus: settingsMap[b.fm_guid]?.hasAp || false,
          hasCustomSenslinc: settingsMap[b.fm_guid]?.hasSl || false,
        };
      });

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
      toast({ variant: 'destructive', title: 'Fill in all required fields' });
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

      toast({ title: 'Building created!', description: data.message });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error creating building', description: err.message });
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
    const useDirectBrowser = fileSizeMB > 10;

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
      
      // Determine if this is an IFC upload to an existing building (e.g. Asset+ building)
      const isUploadToExisting = !createdBuilding && existingBuildings.some(b => b.fmGuid === targetBuildingFmGuid);
      
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
          source_type: isUploadToExisting ? 'ifc-upload-to-existing' : 'ifc',
          source_bucket: 'ifc-uploads',
        } as any)
        .select('id')
        .single();

      if (jobError || !jobRow) throw new Error(`Failed to create conversion job: ${jobError?.message}`);
      const jobId = jobRow.id;

      // Trigger immediate hierarchy population (non-blocking, non-fatal)
      addLog('🏗️ Populating building hierarchy...');
      supabase.functions.invoke('ifc-extract-systems', {
        body: {
          buildingFmGuid: targetBuildingFmGuid,
          ifcStoragePath: ifcStoragePath,
          mode: 'enrich-guids',
        }
      }).then(async ({ data, error }) => {
        // Detect WORKER_LIMIT and auto-retry with metadata-only mode
        let isWorkerLimit = false;
        if (error) {
          const errStr = JSON.stringify(error);
          isWorkerLimit = errStr.includes('WORKER_LIMIT') || errStr.includes('compute resources') || errStr.includes('546');
        }

        if (isWorkerLimit) {
          addLog('⚠️ Server memory limit on hierarchy extraction — retrying with metadata fallback...');
          try {
            const { data: retryData, error: retryErr } = await supabase.functions.invoke('ifc-extract-systems', {
              body: {
                buildingFmGuid: targetBuildingFmGuid,
                ifcStoragePath: ifcStoragePath,
                mode: 'metadata-only',
              }
            });
            if (retryErr) {
              console.warn('Metadata-only hierarchy fallback failed:', retryErr);
              addLog('⚠️ Metadata fallback also failed — hierarchy will be populated after browser conversion');
            } else {
              const levels = retryData?.levelsCreated ?? 0;
              const spaces = retryData?.spacesCreated ?? 0;
              const instances = retryData?.instancesCreated ?? 0;
              addLog(`✅ Hierarchy populated (metadata fallback): ${levels} levels, ${spaces} spaces, ${instances} instances`);
            }
          } catch (retryE) {
            console.warn('Metadata fallback retry failed:', retryE);
          }
        } else if (error) {
          console.warn('Immediate hierarchy population failed:', error);
          addLog('⚠️ Hierarchy pre-population failed (browser conversion will handle it)');
        } else {
          const levels = data?.levelsCreated ?? 0;
          const spaces = data?.spacesCreated ?? 0;
          const instances = data?.instancesCreated ?? 0;
          addLog(`✅ Hierarchy populated: ${levels} levels, ${spaces} spaces, ${instances} instances`);
        }
      }).catch(e => {
        console.warn('Immediate hierarchy population failed:', e);
      });

      activeJobIdRef.current = jobId;

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
          isWorkerLimit = errorString.includes('WORKER_LIMIT') || errorString.includes('not having enough compute resources') || errorString.includes('546') || errorString.includes('Memory limit');
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
          // Trigger data refresh so Navigator shows new levels/rooms
          window.dispatchEvent(new Event('building-data-changed'));
        }
      }
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`);
      // Mark job as failed if we have a jobId
      if (activeJobIdRef.current) {
        await supabase.from('conversion_jobs').update({
          status: 'error',
          error_message: err.message,
          updated_at: new Date().toISOString(),
        }).eq('id', activeJobIdRef.current);
      }
      toast({ variant: 'destructive', title: 'Conversion error', description: err.message });
      setIsConverting(false);
    } finally {
      activeJobIdRef.current = null;
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    }

    async function runBrowserConversion(
      file: File, buildingGuid: string, jobId: string, modelNameSafe: string,
      log: (msg: string) => void, setProgress: (p: number) => void,
    ) {
      const localLogs: string[] = [];
      const logAndTrack = (msg: string) => { localLogs.push(msg); log(msg); };
      try {
        const fileBuffer = await file.arrayBuffer();
        log(`Loaded ${(fileBuffer.byteLength / 1024 / 1024).toFixed(1)} MB into browser memory`);

        let converterModule: any;
        try { converterModule = await import('@/services/acc-xkt-converter'); }
        catch (importErr: any) { throw new Error(`Failed to load converter: ${importErr.message}`); }

        log('Converter loaded, starting IFC parsing...');
        activeJobIdRef.current = jobId;
        await supabase.from('conversion_jobs').update({ status: 'processing', progress: 20, updated_at: new Date().toISOString() }).eq('id', jobId);

        // Start heartbeat: update updated_at every 30s to prove we're alive
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(async () => {
          await supabase.from('conversion_jobs').update({ updated_at: new Date().toISOString() }).eq('id', jobId).eq('status', 'processing');
        }, 30_000);

        const result = await converterModule.convertToXktWithMetadata(fileBuffer, (msg: string) => { log(msg); });
        setProgress(70);
        log(`XKT generated: ${(result.xktData.byteLength / 1024 / 1024).toFixed(2)} MB`);
        log(`Hierarchy: ${result.levels.length} levels, ${result.spaces.length} spaces`);
        
        // Fallback: if levels/spaces are empty but metaModelJson has objects, extract from metadata
        if (result.levels.length === 0 && result.metaModelJson?.metaObjects?.length > 0) {
          log('⚠️ No levels/spaces from XKT metaObjects — extracting from metadata JSON fallback...');
          for (const obj of result.metaModelJson.metaObjects) {
            const metaType = obj.type || '';
            const objId = obj.id || '';
            const objName = obj.name || metaType;
            const parentId = obj.parent || '';
            if (metaType === 'IfcBuildingStorey') {
              result.levels.push({ id: objId, name: objName, type: metaType });
            } else if (metaType === 'IfcSpace') {
              result.spaces.push({ id: objId, name: objName, type: metaType, parentId });
            }
          }
          if (result.levels.length > 0 || result.spaces.length > 0) {
            log(`✅ Metadata fallback found: ${result.levels.length} levels, ${result.spaces.length} spaces`);
          } else {
            log('⚠️ Metadata JSON also contains no IfcBuildingStorey/IfcSpace entries');
          }
        } else if (result.levels.length === 0) {
          log('⚠️ No levels/spaces found in IFC metadata and no metaModelJson available');
        }
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

        // Post-conversion hierarchy recovery: if browser extraction found nothing,
        // trigger server-side metadata-only extraction from the just-uploaded metadata JSON
        if (result.levels.length === 0 && result.spaces.length === 0) {
          log('⚠️ No hierarchy from browser — triggering server-side metadata-only extraction...');
          try {
            const { data: extractData, error: extractErr } = await supabase.functions.invoke(
              'ifc-extract-systems',
              { body: { ifcStoragePath: `${buildingGuid}/${file.name}`, buildingFmGuid: buildingGuid, mode: 'metadata-only' } }
            );
            if (extractErr) {
              log(`⚠️ Server-side extraction failed: ${extractErr.message}`);
            } else if (extractData?.levelsCreated > 0 || extractData?.spacesCreated > 0) {
              log(`✅ Server recovered hierarchy: ${extractData.levelsCreated} levels, ${extractData.spacesCreated} spaces`);
            } else {
              log('⚠️ Server-side extraction also found no hierarchy in metadata');
            }
          } catch (recoveryErr: any) {
            log(`⚠️ Hierarchy recovery error: ${recoveryErr.message}`);
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

        // Persist logs to DB before marking done
        await supabase.from('conversion_jobs').update({ log_messages: localLogs }).eq('id', jobId);

        await supabase.from('conversion_jobs').update({ status: 'done', progress: 100, result_model_id: modelId, updated_at: new Date().toISOString() }).eq('id', jobId);
        setProgress(100);
        setConversionDone(true);
        log('✅ Done! Browser-based conversion succeeded.');
        toast({ title: 'IFC converted!', description: `${file.name} converted in browser and saved.` });
        // Trigger data refresh so Navigator shows new levels/rooms
        window.dispatchEvent(new Event('building-data-changed'));
        toast({ title: 'IFC converted!', description: `${file.name} converted in browser and saved.` });
      } catch (clientErr: any) {
        log(`❌ Browser conversion failed: ${clientErr.message}`);
        // Mark job as failed so it doesn't stay stuck
        await supabase.from('conversion_jobs').update({
          status: 'error',
          error_message: `Browser conversion failed: ${clientErr.message}`,
          updated_at: new Date().toISOString(),
        }).eq('id', jobId);
        toast({ variant: 'destructive', title: 'Conversion failed', description: clientErr.message });
      } finally {
        // Stop heartbeat and clear active job
        activeJobIdRef.current = null;
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
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

  // ── Batch enqueue all buildings ──
  const handleBatchEnqueue = async () => {
    setIsBatchEnqueuing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const resp = await fetch(`${supabaseUrl}/functions/v1/conversion-worker-api/batch-enqueue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ created_by: user.id }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const result = await resp.json();
      toast({
        title: 'Buildings enqueued',
        description: `${result.enqueued} jobs enqueued, ${result.skipped} skipped (of ${result.total_buildings} buildings).`,
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Batch enqueue failed', description: err.message });
    } finally {
      setIsBatchEnqueuing(false);
    }
  };

  const selectedBuilding = existingBuildings.find(b => b.fmGuid === selectedBuildingFmGuid);

  // ── Fetch conversion jobs for selected building ──
  const fetchConversionJobs = useCallback(async () => {
    if (!selectedBuildingFmGuid) { setConversionJobs([]); return; }
    const { data } = await supabase
      .from('conversion_jobs')
      .select('*')
      .eq('building_fm_guid', selectedBuildingFmGuid)
      .order('created_at', { ascending: false })
      .limit(20);
    setConversionJobs(data || []);
  }, [selectedBuildingFmGuid]);

  useEffect(() => { fetchConversionJobs(); }, [fetchConversionJobs]);

  // Auto-refresh jobs if any are active
  useEffect(() => {
    if (jobPollRef.current) clearInterval(jobPollRef.current);
    const hasActive = conversionJobs.some(j => j.status === 'pending' || j.status === 'processing');
    if (hasActive) {
      jobPollRef.current = setInterval(fetchConversionJobs, 10000);
    }
    return () => { if (jobPollRef.current) clearInterval(jobPollRef.current); };
  }, [conversionJobs, fetchConversionJobs]);

  // ── Delete building handler ──
  const handleDeleteBuilding = async () => {
    if (!selectedBuildingFmGuid) return;
    setIsDeleting(true);
    try {
      const result = await deleteBuilding(selectedBuildingFmGuid);
      if (result.success) {
        toast({ title: 'Building deleted', description: `${result.summary.assetsDeleted} objects deleted, ${result.summary.expiredInAssetPlus} expired in Asset+.` });
        setSelectedBuildingFmGuid('');
        setCreatedBuilding(null);
        fetchBuildings();
      } else {
        toast({ variant: 'destructive', title: 'Partially failed', description: `${result.summary.expireErrors} objects could not be expired in Asset+.` });
        fetchBuildings();
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Deletion failed', description: err.message });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    await supabase.from('conversion_jobs').delete().eq('id', jobId);
    fetchConversionJobs();
  };

  const handleResetJob = async (jobId: string) => {
    await supabase.from('conversion_jobs').update({ status: 'pending', progress: 0, error_message: null, updated_at: new Date().toISOString() } as any).eq('id', jobId);
    fetchConversionJobs();
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      pending: { variant: 'secondary', label: 'Queued' },
      processing: { variant: 'default', label: 'Processing' },
      done: { variant: 'outline', label: 'Done' },
      error: { variant: 'destructive', label: 'Error' },
    };
    const s = map[status] || { variant: 'secondary' as const, label: status };
    return <Badge variant={s.variant} className="text-[9px]">{s.label}</Badge>;
  };

  const isStuckJob = (job: any) => {
    if (job.status !== 'processing') return false;
    const updatedAt = new Date(job.updated_at).getTime();
    return Date.now() - updatedAt > 10 * 60 * 1000; // >10min
  };

  return (
    <div className="space-y-5 py-2">
      {/* ══════ Building Selector ══════ */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <h3 className="font-semibold text-sm">Select Building</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={fetchBuildings}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {loadingBuildings ? (
          <div className="text-xs text-muted-foreground py-2">Loading buildings...</div>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={selectedBuildingFmGuid} onValueChange={(v) => { setSelectedBuildingFmGuid(v); setShowCreateForm(false); handleResetIfc(); }}>
              <SelectTrigger className="h-10 text-sm flex-1">
                <SelectValue placeholder="Select a building..." />
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

            {selectedBuildingFmGuid && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-destructive hover:bg-destructive/10" disabled={isDeleting}>
                    {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      Delete building?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      <strong>{selectedBuilding?.commonName}</strong> and all associated objects (floors, rooms, inventory) will be permanently deleted.
                      Synced objects will be expired in Asset+. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteBuilding} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}

        {!selectedBuildingFmGuid && !showCreateForm && (
          <Button variant="outline" size="sm" onClick={() => setShowCreateForm(true)} className="w-full gap-1.5 text-xs">
            <Building2 className="h-3.5 w-3.5" />
            Create new building in Asset+
          </Button>
        )}
      </div>

      {/* ══════ Create New Building (expandable) ══════ */}
      {showCreateForm && !selectedBuildingFmGuid && (
        <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
          <h4 className="font-medium text-sm">Create new property & building</h4>
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
            <Label className="text-xs flex items-center gap-1"><Layers className="h-3 w-3" /> Model name</Label>
            <Input placeholder="e.g. A-model" value={modelName} onChange={e => setModelName(e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Latitude</Label>
              <Input type="number" step="any" placeholder="59.3293" value={latitude} onChange={e => setLatitude(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><MapPin className="h-3 w-3" /> Longitude</Label>
              <Input type="number" step="any" placeholder="18.0686" value={longitude} onChange={e => setLongitude(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={isCreating || !complexDesignation || !complexName || !buildingDesignation || !buildingName} className="flex-1 gap-2">
              {isCreating ? <><Loader2 className="h-4 w-4 animate-spin" />Creating...</> : <><Building2 className="h-4 w-4" />Create in Asset+</>}
            </Button>
            <Button variant="outline" onClick={() => setShowCreateForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* ══════ Batch Enqueue All ══════ */}
      <div className="border-t pt-4">
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={handleBatchEnqueue}
          disabled={isBatchEnqueuing}
        >
          {isBatchEnqueuing ? (
            <><Loader2 className="h-4 w-4 animate-spin" />Enqueuing buildings...</>
          ) : (
            <><PlayCircle className="h-4 w-4" />Enqueue all buildings</>
          )}
        </Button>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Creates conversion jobs for all buildings with IFC or XKT files.
        </p>
      </div>

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
                  <span>Edit Credentials</span>
                  {(selectedBuilding?.hasCustomAssetPlus || selectedBuilding?.hasCustomSenslinc) && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 ml-1">Custom</Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-1">
                <p className="text-xs text-muted-foreground mb-2">
                  Add custom API credentials for this building (Asset+, Senslinc).
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { setEditFmGuid(selectedBuildingFmGuid); setPropertyDialogOpen(true); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
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
                        <Cloud className="h-3 w-3" /> Converting — this may take a few minutes…
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
                        Model is ready — it will appear automatically in the 3D viewer.
                      </div>
                    )}
                  </div>
                )}
                {conversionDone && (
                  <Button variant="outline" size="sm" onClick={handleResetIfc} className="text-xs">
                    Upload another
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
                  Autodesk Forma settings (login, hub, project and file selection) are managed under the{' '}
                  <strong>API</strong> tab. There you can log in, browse folders and sync BIM data to this building.
                </p>
                {onSwitchToAccTab && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={onSwitchToAccTab}>
                    <Layers className="h-3.5 w-3.5" /> Open ACC Settings
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
                  Sync structure and assets from Asset+ for this building. Use the <strong>Sync</strong> tab to sync all buildings.
                </p>
                <Button
                  onClick={handleSyncAssetPlus}
                  disabled={isSyncingAssetPlus}
                  size="sm"
                  className="gap-1.5"
                >
                  {isSyncingAssetPlus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync this building
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
                  Download a template with floors and rooms, fill in assets offline, and import back.
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

            {/* ── Conversion Jobs ── */}
            <AccordionItem value="jobs" className="border rounded-lg">
              <AccordionTrigger className="px-3 py-2.5 hover:no-underline hover:bg-muted/50 text-sm">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <span>Conversion Jobs</span>
                  {conversionJobs.length > 0 && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 ml-1">{conversionJobs.length}</Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-1 space-y-2">
                {conversionJobs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No conversion jobs for this building.</p>
                ) : (
                  conversionJobs.map(job => (
                    <div key={job.id} className="border rounded-md p-2.5 space-y-1.5 bg-muted/20">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate flex-1">{job.model_name || job.ifc_storage_path?.split('/').pop() || 'Unnamed'}</span>
                        {getStatusBadge(job.status)}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</span>
                        {job.progress > 0 && job.status !== 'done' && (
                          <span>• {job.progress}%</span>
                        )}
                      </div>
                      {job.status !== 'done' && job.progress > 0 && job.progress < 100 && (
                        <Progress value={job.progress} className="h-1.5" />
                      )}
                      {job.error_message && (
                        <p className="text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1">{job.error_message}</p>
                      )}
                      {expandedJobLogs.has(job.id) && job.log_messages && job.log_messages.length > 0 && (
                        <div className="rounded border bg-background p-2 max-h-32 overflow-y-auto">
                          {(job.log_messages as string[]).map((msg: string, i: number) => (
                            <p key={i} className="text-[10px] font-mono text-muted-foreground leading-relaxed">{msg}</p>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 pt-1">
                        {job.log_messages && job.log_messages.length > 0 && (
                          <Button
                            variant="ghost" size="sm" className="h-6 text-[10px] px-2 gap-1"
                            onClick={() => setExpandedJobLogs(prev => {
                              const next = new Set(prev);
                              next.has(job.id) ? next.delete(job.id) : next.add(job.id);
                              return next;
                            })}
                          >
                            <Eye className="h-3 w-3" />
                            {expandedJobLogs.has(job.id) ? 'Hide logs' : 'Show logs'}
                          </Button>
                        )}
                        {isStuckJob(job) && (
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 gap-1" onClick={() => handleResetJob(job.id)}>
                            <RotateCcw className="h-3 w-3" /> Reset
                          </Button>
                        )}
                        {(job.status === 'done' || job.status === 'error') && (
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 gap-1 text-destructive" onClick={() => handleDeleteJob(job.id)}>
                            <X className="h-3 w-3" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <Button variant="ghost" size="sm" className="w-full text-xs gap-1.5" onClick={fetchConversionJobs}>
                  <RefreshCw className="h-3 w-3" /> Refresh
                </Button>
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
