import React, { useState, useCallback, useContext, useMemo, useEffect, useRef } from 'react';
import {
  Upload, FileCode2, CheckCircle2, Loader2, RefreshCw,
  Building2, Play, ChevronRight, ChevronDown, RotateCcw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from '@/context/LanguageContext';
import { AppContext } from '@/context/AppContext';

// ─── Types ──────────────────────────────────────────────────────────────────

type Step = 'upload' | 'analyzing' | 'configure' | 'queuing' | 'monitoring' | 'done';

interface FmguidStats {
  total_elements: number;
  had_fmguid: number;
  reused_from_map: number;
  newly_generated: number;
}

interface SyncLog {
  time: string;
  msg: string;
  level: 'info' | 'ok' | 'warn' | 'error';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Above this size, skip the client-side regex scan of the full file text —
// reading a multi-hundred-MB / multi-GB IFC file into a JS string can freeze
// or crash the tab. The scan is only a quick pre-check (real FMGuid stats are
// computed server-side in `ifc-fmguid-prep` during queueJob), so it is safe
// to skip and proceed straight to the configure step.
const CLIENT_SCAN_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function StepBadge({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${done ? 'border-green-500/40 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400' : active ? 'border-primary/40 bg-primary/10 text-primary font-medium' : 'border-muted text-muted-foreground'}`}>
      {done ? <CheckCircle2 className="h-3 w-3" /> : active ? <div className="h-2 w-2 rounded-full bg-primary animate-pulse" /> : <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />}
      {label}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IfcToGeminusPlusPanel() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const { allData } = useContext(AppContext);

  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);

  // Uploaded file
  const [ifcFile, setIfcFile] = useState<File | null>(null);
  const [storagePath, setStoragePath] = useState('');

  // FMGUID analysis
  const [stats, setStats] = useState<FmguidStats | null>(null);

  // Buildings — same logic as FormaToGeminusPlusPanel
  const buildings = useMemo(() =>
    allData
      .filter((a: any) => a.category === 'Building' || a.category === 'IfcBuilding')
      .map((a: any) => ({
        fm_guid: a.fmGuid,
        name: a.name || a.commonName || a.fmGuid,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [allData]
  );

  // Model slots from xkt_models — same as FormaToGeminusPlusPanel
  const [modelSlotsByBuilding, setModelSlotsByBuilding] = useState<Record<string, string[]>>({});
  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(new Set());
  const [selectedBuildingFmGuid, setSelectedBuildingFmGuid] = useState('');
  const [selectedModelName, setSelectedModelName] = useState('');

  // Job monitoring
  const [jobId, setJobId] = useState('');
  const [jobProgress, setJobProgress] = useState(0);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string, level: SyncLog['level'] = 'info') => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, level }]);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Load model slots from xkt_models on mount — identical to FormaToGeminusPlusPanel
  useEffect(() => {
    supabase
      .from('xkt_models')
      .select('building_fm_guid, model_name')
      .then(({ data }) => {
        const grouped: Record<string, string[]> = {};
        for (const row of (data || [])) {
          const name = row.model_name?.trim();
          if (!row.building_fm_guid || !name) continue;
          if (!grouped[row.building_fm_guid]) grouped[row.building_fm_guid] = [];
          const key = name.toLowerCase();
          if (!grouped[row.building_fm_guid].some(n => n.toLowerCase() === key)) {
            grouped[row.building_fm_guid].push(name);
          }
        }
        setModelSlotsByBuilding(grouped);
      });
  }, []);

  // ── Realtime job monitoring ────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    const channel = supabase
      .channel(`ifc-job-${jobId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversion_jobs',
        filter: `id=eq.${jobId}`,
      }, (payload: any) => {
        const job = payload.new;
        setJobProgress(job.progress ?? 0);
        const msgs: string[] = job.log_messages || [];
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          addLog(last, last.toLowerCase().includes('error') || last.toLowerCase().includes('failed') ? 'error' : 'info');
        }
        if (job.status === 'done' || job.status === 'complete') {
          addLog(t('Konvertering klar!', 'Conversion complete!'), 'ok');
          setStep('done');
        } else if (job.status === 'error' || job.status === 'failed') {
          addLog(t('Jobbet misslyckades: ', 'Job failed: ') + (job.error_message || '?'), 'error');
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [jobId, addLog, t]);

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.ifc')) {
      toast({ variant: 'destructive', title: t('Fel filformat', 'Wrong file format'), description: t('Välj en .ifc-fil.', 'Please select a .ifc file.') });
      return;
    }
    setIfcFile(file);
    setStats(null);
    setStep('upload');
  }, [toast, t]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  // ── Upload + Analyze ──────────────────────────────────────────────────────

  const uploadAndAnalyze = async () => {
    if (!ifcFile) return;

    setStep('analyzing');
    addLog(t('Laddar upp IFC-fil…', 'Uploading IFC file…'));

    try {
      const ts = Date.now();
      const safeName = ifcFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${ts}_${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from('ifc-uploads')
        .upload(path, ifcFile, { upsert: false });

      if (uploadErr) throw uploadErr;
      setStoragePath(path);
      addLog(`${t('Uppladdad:', 'Uploaded:')} ${formatBytes(ifcFile.size)}`, 'ok');

      // Quick client-side scan: detect FMGuid property presence + element count.
      // Skipped for large files — reading the whole file into a JS string is
      // only safe for reasonably small IFCs; the real analysis happens
      // server-side in ifc-fmguid-prep during queueJob regardless.
      if (ifcFile.size > CLIENT_SCAN_MAX_BYTES) {
        addLog(
          t(
            `Filen är stor (${formatBytes(ifcFile.size)}) – hoppar över snabbanalys i webbläsaren, fortsätter till uppladdning.`,
            `File is large (${formatBytes(ifcFile.size)}) – skipping quick in-browser validation, proceeding with upload.`
          ),
          'info'
        );
        toast({
          title: t('Snabbanalys hoppas över', 'Quick validation skipped'),
          description: t(
            `Filen är för stor (${formatBytes(ifcFile.size)}) för analys i webbläsaren. Full FMGUID-analys körs på servern i nästa steg.`,
            `The file is too large (${formatBytes(ifcFile.size)}) for the in-browser check. Full FMGUID analysis will run server-side in the next step.`
          ),
        });
      } else {
        addLog(t('Analyserar IFC-modellen…', 'Analysing IFC model…'));
        const text = await ifcFile.text();
        const hasFmguidInFile = /FMGuid/i.test(text);
        const productMatches = text.match(
          /^#\d+=IFC(WALL|DOOR|WINDOW|SLAB|COLUMN|BEAM|PIPE|DUCT|SPACE|BUILDINGSTOREY|BUILDING|FURNISHING|FURNITURE|FLOWTERMINAL|FLOWSEGMENT|BUILDINGELEMENTPROXY)/gim
        );
        const approxCount = productMatches?.length ?? 0;

        setStats({
          total_elements: approxCount,
          had_fmguid: hasFmguidInFile ? approxCount : 0,
          reused_from_map: 0,
          newly_generated: hasFmguidInFile ? 0 : approxCount,
        });

        addLog(
          hasFmguidInFile
            ? t(`IFC innehåller redan FMGuid-egenskaper (ca ${approxCount} element).`, `IFC already contains FMGuid properties (~${approxCount} elements).`)
            : t(`Inga FMGuid hittades – ca ${approxCount} element tilldelas FMGuid vid bearbetning.`, `No FMGuid found – ~${approxCount} elements will be assigned FMGuid during processing.`),
          hasFmguidInFile ? 'ok' : 'info'
        );
      }

      // Pre-fill model name from filename, default expand first building
      const defaultName = ifcFile.name.replace(/\.ifc$/i, '');
      setSelectedModelName(defaultName);
      if (buildings.length > 0 && expandedBuildings.size === 0) {
        setExpandedBuildings(new Set([buildings[0].fm_guid]));
      }

      setStep('configure');
    } catch (err: any) {
      addLog(t('Fel: ', 'Error: ') + err.message, 'error');
      toast({ variant: 'destructive', title: t('Uppladdning misslyckades', 'Upload failed'), description: err.message });
      setStep('upload');
    }
  };

  // ── Queue Job ─────────────────────────────────────────────────────────────

  const queueJob = async () => {
    if (!storagePath || !selectedBuildingFmGuid) {
      toast({ variant: 'destructive', title: t('Saknade val', 'Missing selection'), description: t('Välj en målbyggnad.', 'Please select a target building.') });
      return;
    }

    setStep('queuing');
    addLog(t('Kör FMGUID-förberedelse…', 'Running FMGUID preparation…'));

    try {
      // Run full server-side ifc-fmguid-prep
      const { data: prepData, error: prepErr } = await supabase.functions.invoke('ifc-fmguid-prep', {
        body: { storage_path: storagePath, building_fm_guid: selectedBuildingFmGuid },
      });
      if (prepErr) throw prepErr;

      if (prepData) {
        setStats({
          total_elements: prepData.total_elements ?? 0,
          had_fmguid: prepData.had_fmguid ?? 0,
          reused_from_map: prepData.reused_from_map ?? 0,
          newly_generated: prepData.newly_generated ?? 0,
        });
        addLog(
          t(
            `FMGUID klart: ${prepData.had_fmguid} befintliga, ${prepData.reused_from_map} återanvända, ${prepData.newly_generated} nya`,
            `FMGUID done: ${prepData.had_fmguid} existing, ${prepData.reused_from_map} reused, ${prepData.newly_generated} new`
          ),
          'ok'
        );
      }

      // Determine model name: selected slot or filename-derived
      const finalModelName = selectedModelName.trim() || ifcFile?.name.replace(/\.ifc$/i, '') || 'IFC-modell';

      addLog(t('Lägger till i konverteringskön…', 'Adding to conversion queue…'));
      const { data: job, error: jobErr } = await supabase
        .from('conversion_jobs')
        .insert({
          building_fm_guid: selectedBuildingFmGuid,
          ifc_storage_path: storagePath,
          model_name: finalModelName,
          status: 'pending',
          progress: 0,
          log_messages: ['Submitted from IFC → Geminus Plus tool'],
          source_type: 'ifc',
          source_bucket: 'ifc-uploads',
          use_fmguid_map: true,
        })
        .select('id')
        .single();

      if (jobErr) throw jobErr;

      setJobId(job.id);
      addLog(t(`Jobb skapat (ID: ${job.id.slice(0, 8)}…)`, `Job created (ID: ${job.id.slice(0, 8)}…)`), 'ok');

      // Trigger ifc-to-xkt directly (fire-and-forget; progress tracked via realtime)
      addLog(t('Startar konvertering…', 'Starting conversion…'));
      supabase.functions.invoke('ifc-to-xkt', {
        body: {
          ifcStoragePath: storagePath,
          buildingFmGuid: selectedBuildingFmGuid,
          modelName: finalModelName,
          jobId: job.id,
          isMasterModel: true,
          useFmguidMap: true,
        },
      }).then(({ error: convErr }: { error: any }) => {
        if (convErr) addLog(t('Konverteringsfel: ', 'Conversion error: ') + convErr.message, 'error');
      }).catch((e: any) => {
        addLog(t('Konverteringsanrop misslyckades: ', 'Conversion call failed: ') + e.message, 'error');
      });

      setStep('monitoring');
    } catch (err: any) {
      addLog(t('Fel: ', 'Error: ') + err.message, 'error');
      toast({ variant: 'destructive', title: t('Fel', 'Error'), description: err.message });
      setStep('configure');
    }
  };

  const reset = () => {
    setStep('upload');
    setIfcFile(null);
    setStoragePath('');
    setStats(null);
    setSelectedBuildingFmGuid('');
    setSelectedModelName('');
    setJobId('');
    setJobProgress(0);
    setLogs([]);
  };

  const toggleBuilding = (fmGuid: string) => {
    setExpandedBuildings(prev => {
      const next = new Set(prev);
      if (next.has(fmGuid)) next.delete(fmGuid); else next.add(fmGuid);
      return next;
    });
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const isDone = step === 'done';
  const isAnalyzing = step === 'analyzing';
  const isMonitoring = step === 'monitoring' || step === 'queuing';
  const canQueue = !!selectedBuildingFmGuid && step === 'configure';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Progress stepper */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <StepBadge active={step === 'upload'} done={!!ifcFile && step !== 'upload'} label={t('1. Ladda upp IFC', '1. Upload IFC')} />
        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <StepBadge active={isAnalyzing} done={!!stats} label={t('2. Analysera', '2. Analyse')} />
        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <StepBadge active={step === 'configure'} done={isMonitoring || isDone} label={t('3. Konfigurera', '3. Configure')} />
        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        <StepBadge active={isMonitoring} done={isDone} label={t('4. Kör', '4. Run')} />
      </div>

      {/* Step 1: Upload drop zone */}
      {(step === 'upload' || step === 'analyzing') && (
        <div className="space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors ${isDragging ? 'border-primary bg-primary/5' : ifcFile ? 'border-green-500/50 bg-green-50/30 dark:bg-green-950/10' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'}`}
          >
            <label className="absolute inset-0 cursor-pointer" htmlFor="ifc-file-input" />
            <input
              id="ifc-file-input"
              type="file"
              accept=".ifc"
              className="sr-only"
              onChange={onFileInput}
              disabled={isAnalyzing}
            />
            {ifcFile ? (
              <div className="space-y-1">
                <FileCode2 className="h-8 w-8 mx-auto text-green-500" />
                <p className="text-sm font-medium">{ifcFile.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(ifcFile.size)}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">{t('Dra och släpp en IFC-fil här', 'Drag and drop an IFC file here')}</p>
                <p className="text-xs text-muted-foreground">{t('eller klicka för att välja fil', 'or click to select file')}</p>
              </div>
            )}
          </div>

          {ifcFile && (
            <Button onClick={uploadAndAnalyze} disabled={isAnalyzing} className="w-full gap-2">
              {isAnalyzing
                ? <><Loader2 className="h-4 w-4 animate-spin" />{t('Analyserar…', 'Analysing…')}</>
                : <><Upload className="h-4 w-4" />{t('Ladda upp och analysera', 'Upload and analyse')}</>
              }
            </Button>
          )}
        </div>
      )}

      {/* FMGUID stats — shown once analyzed */}
      {stats && (
        <div className="rounded-lg border p-4 space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-primary" />
            {t('FMGUID-analys', 'FMGUID analysis')}
            <Badge variant="outline" className="ml-auto font-normal">
              {stats.total_elements} {t('element', 'elements')}
            </Badge>
          </Label>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md bg-success/10 border border-success/30 p-2">
              <p className="text-lg font-bold text-success">{stats.had_fmguid}</p>
              <p className="text-2xs text-success">{t('Befintliga i IFC', 'Existing in IFC')}</p>
            </div>
            <div className="rounded-md bg-accent/10 border border-accent/30 p-2">
              <p className="text-lg font-bold text-accent">{stats.reused_from_map}</p>
              <p className="text-2xs text-accent">{t('Återanvända', 'Reused')}</p>
            </div>
            <div className="rounded-md bg-warning/10 border border-warning/30 p-2">
              <p className="text-lg font-bold text-warning">{stats.newly_generated}</p>
              <p className="text-2xs text-warning">{t('Nya', 'New')}</p>
            </div>
          </div>
          {stats.reused_from_map > 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              {t(`${stats.reused_from_map} element matchade mot tidigare uppladdning via IFC GlobalId.`, `${stats.reused_from_map} elements matched from a previous upload via IFC GlobalId.`)}
            </p>
          )}
        </div>
      )}

      {/* Step 3: Configure — building + model slot tree (same as FormaToGeminusPlusPanel) */}
      {step === 'configure' && (
        <div className="rounded-lg border p-4 space-y-3">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            {t('Välj byggnad och modell i Geminus Plus', 'Select building and model in Geminus Plus')}
            {selectedBuildingFmGuid && (
              <Badge className="bg-primary/10 text-primary border-primary/20 ml-auto font-normal max-w-[60%] truncate">
                {(() => {
                  const b = buildings.find(x => x.fm_guid === selectedBuildingFmGuid);
                  return [b?.name, selectedModelName || t('Ny modell', 'New model')].filter(Boolean).join(' → ');
                })()}
              </Badge>
            )}
          </Label>

          {buildings.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('Inga byggnader hittades. Synka en byggnad från Geminus Plus via Portfolio-vyn först.', 'No buildings found. Sync a building from Geminus Plus via Portfolio view first.')}
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded border bg-muted/20 p-1">
              <div className="space-y-0.5">
                {buildings.map((b: any) => {
                  const slots = modelSlotsByBuilding[b.fm_guid] || [];
                  const isOpen = expandedBuildings.has(b.fm_guid);
                  const isBuildingSelected = selectedBuildingFmGuid === b.fm_guid;
                  return (
                    <div key={b.fm_guid}>
                      <button
                        onClick={() => toggleBuilding(b.fm_guid)}
                        className={`flex items-center gap-1.5 w-full px-2 py-1.5 rounded text-xs text-left hover:bg-muted/50 ${isBuildingSelected ? 'font-medium' : ''}`}
                      >
                        {isOpen
                          ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                          : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        <Building2 className="h-3 w-3 shrink-0 text-primary/70" />
                        <span className="truncate flex-1">{b.name}</span>
                        {slots.length > 0 && (
                          <Badge variant="outline" className="text-2xs shrink-0">{slots.length}</Badge>
                        )}
                      </button>

                      {isOpen && (
                        <div className="ml-5 space-y-0.5 mb-0.5">
                          {/* Existing model slots */}
                          {slots.map((slotName: string) => {
                            const isSelected = isBuildingSelected && selectedModelName === slotName;
                            return (
                              <button
                                key={slotName}
                                onClick={() => { setSelectedBuildingFmGuid(b.fm_guid); setSelectedModelName(slotName); }}
                                className={`flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-left ${isSelected ? 'bg-primary/15 text-primary font-medium' : 'hover:bg-muted/50'}`}
                              >
                                <FileCode2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span className="truncate">{slotName}</span>
                                {isSelected && <CheckCircle2 className="h-3 w-3 ml-auto shrink-0" />}
                              </button>
                            );
                          })}
                          {/* New model option */}
                          <button
                            onClick={() => {
                              setSelectedBuildingFmGuid(b.fm_guid);
                              setSelectedModelName(ifcFile?.name.replace(/\.ifc$/i, '') || '');
                            }}
                            className={`flex items-center gap-1.5 w-full px-2 py-1 rounded text-xs text-left text-muted-foreground hover:bg-muted/50 border border-dashed border-muted-foreground/20 mt-1 ${isBuildingSelected && !slots.includes(selectedModelName) ? 'bg-primary/10 border-primary/30 text-primary' : ''}`}
                          >
                            <span className="text-2xs">＋</span>
                            <span>{t('Ny modell', 'New model')}</span>
                            {isBuildingSelected && !slots.includes(selectedModelName) && selectedModelName && (
                              <span className="ml-1 text-muted-foreground font-normal truncate">({selectedModelName})</span>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedBuildingFmGuid && !modelSlotsByBuilding[selectedBuildingFmGuid]?.includes(selectedModelName) && (
            <p className="text-xs text-muted-foreground">
              {t('Ny modell skapas med namn från den valda IFC-filen.', 'New model will be created using the name from the selected IFC file.')}
            </p>
          )}

          <Button onClick={queueJob} disabled={!canQueue} className="w-full gap-2">
            <Play className="h-4 w-4" />
            {t('Kör FMGUID-prep och lägg i kön', 'Run FMGUID prep and queue job')}
          </Button>
        </div>
      )}

      {/* Step 4: Monitor */}
      {(isMonitoring || isDone) && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              {isDone
                ? t('Konvertering klar', 'Conversion complete')
                : t('Bearbetning pågår…', 'Processing…')
              }
            </Label>
            {isDone
              ? <CheckCircle2 className="h-4 w-4 text-green-500" />
              : step === 'queuing'
                ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                : <Badge variant="outline" className="font-mono text-xs">{jobProgress}%</Badge>
            }
          </div>

          {!isDone && jobProgress > 0 && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all duration-500" style={{ width: `${jobProgress}%` }} />
            </div>
          )}

          <ScrollArea className="h-40 rounded-md border bg-muted/20 p-2">
            <div className="space-y-1 font-mono text-2xs">
              {logs.map((l, i) => (
                <div key={i} className={`flex gap-2 ${l.level === 'error' ? 'text-destructive' : l.level === 'ok' ? 'text-success' : l.level === 'warn' ? 'text-warning' : 'text-muted-foreground'}`}>
                  <span className="shrink-0 text-muted-foreground/60">{l.time}</span>
                  <span>{l.msg}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </ScrollArea>

          {isDone && (
            <Button variant="outline" onClick={reset} className="w-full gap-2">
              <RotateCcw className="h-4 w-4" />
              {t('Ladda upp en ny IFC', 'Upload another IFC')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
