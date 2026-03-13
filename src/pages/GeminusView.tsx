import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Building2, Upload, Search, Eye, ArrowLeft, Loader2, AlertTriangle,
  FileText, Camera, Box,
} from 'lucide-react';

interface BuildingItem {
  fmGuid: string;
  name: string;
  commonName: string | null;
}

interface SavedView {
  id: string;
  name: string;
  buildingFmGuid: string;
  buildingName: string | null;
  screenshotUrl: string | null;
}

type ViewMode = 'menu' | 'buildings' | 'ifc-upload' | 'ifc-viewer';

const MAX_FILE_SIZE_MB = 50;

export default function GeminusView() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ViewMode>('menu');
  const [buildings, setBuildings] = useState<BuildingItem[]>([]);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [search, setSearch] = useState('');
  const [loadingData, setLoadingData] = useState(false);

  // IFC state
  const [ifcFile, setIfcFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [conversionLog, setConversionLog] = useState<string[]>([]);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [xktData, setXktData] = useState<ArrayBuffer | null>(null);
  const [metaModelJson, setMetaModelJson] = useState<any>(null);

  const viewerCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<any>(null);

  // Fetch buildings & saved views when entering buildings mode
  useEffect(() => {
    if (mode !== 'buildings') return;
    setLoadingData(true);
    Promise.all([
      supabase
        .from('assets')
        .select('fm_guid, name, common_name')
        .eq('category', 'Building')
        .order('name'),
      supabase
        .from('saved_views')
        .select('id, name, building_fm_guid, building_name, screenshot_url')
        .order('name'),
    ]).then(([bRes, vRes]) => {
      if (bRes.data) {
        setBuildings(bRes.data.map(b => ({
          fmGuid: b.fm_guid,
          name: b.name || b.fm_guid,
          commonName: b.common_name,
        })));
      }
      if (vRes.data) {
        setSavedViews(vRes.data.map(v => ({
          id: v.id,
          name: v.name,
          buildingFmGuid: v.building_fm_guid,
          buildingName: v.building_name,
          screenshotUrl: v.screenshot_url,
        })));
      }
    }).finally(() => setLoadingData(false));
  }, [mode]);

  // IFC file handler
  const handleFileSelect = useCallback(async (file: File) => {
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_FILE_SIZE_MB) {
      setConversionError(`Filen är ${sizeMB.toFixed(0)} MB — maxgräns är ${MAX_FILE_SIZE_MB} MB för webbläsarkonvertering.`);
      return;
    }
    setIfcFile(file);
    setConversionError(null);
    setConversionLog([]);
    setConverting(true);
    setConversionProgress(5);
    setMode('ifc-upload');

    const log = (msg: string) => setConversionLog(prev => [...prev, msg]);

    try {
      log(`Läser ${file.name} (${sizeMB.toFixed(1)} MB)...`);
      const buffer = await file.arrayBuffer();
      setConversionProgress(15);
      log('Laddar konverterare...');

      const converterModule = await import('@/services/acc-xkt-converter');
      setConversionProgress(25);
      log('Startar IFC-parsning...');

      const result = await converterModule.convertToXktWithMetadata(buffer, (msg: string) => log(msg));
      setConversionProgress(90);
      log(`XKT genererad: ${(result.xktData.byteLength / 1024 / 1024).toFixed(2)} MB`);
      log(`Hierarki: ${result.levels?.length || 0} våningar, ${result.spaces?.length || 0} rum`);

      setXktData(result.xktData);
      setMetaModelJson(result.metaModelJson || null);
      setConversionProgress(100);
      log('✅ Konvertering klar — öppnar viewer...');

      // Small delay then switch to viewer
      setTimeout(() => setMode('ifc-viewer'), 600);
    } catch (err: any) {
      setConversionError(err.message || 'Konverteringsfel');
      log(`❌ ${err.message}`);
    } finally {
      setConverting(false);
    }
  }, []);

  // Initialize xeokit viewer when entering ifc-viewer mode
  useEffect(() => {
    if (mode !== 'ifc-viewer' || !xktData || !viewerCanvasRef.current) return;

    let destroyed = false;

    (async () => {
      try {
        const xeokitModule = await (Function('return import("/lib/xeokit/xeokit-sdk.es.js")')() as Promise<any>);
        const { Viewer, XKTLoaderPlugin, NavCubePlugin } = xeokitModule;

        const viewer = new Viewer({
          canvasId: viewerCanvasRef.current!.id,
          transparent: true,
        });
        viewerRef.current = viewer;

        // NavCube
        new NavCubePlugin(viewer, {
          canvasId: 'geminus-view-navcube',
          visible: true,
          size: 200,
        });

        const loader = new XKTLoaderPlugin(viewer);
        const model = loader.load({
          id: 'ifc-preview',
          xkt: xktData,
          edges: true,
        });

        model.on('loaded', () => {
          if (destroyed) return;
          viewer.cameraFlight.flyTo({ aabb: model.aabb, duration: 0.5 });
        });
      } catch (err: any) {
        console.error('Failed to init xeokit viewer:', err);
        setConversionError('Kunde inte starta 3D-viewern: ' + err.message);
      }
    })();

    return () => {
      destroyed = true;
      if (viewerRef.current) {
        try { viewerRef.current.destroy(); } catch {}
        viewerRef.current = null;
      }
    };
  }, [mode, xktData]);

  const filteredBuildings = buildings.filter(b =>
    (b.name + ' ' + (b.commonName || '')).toLowerCase().includes(search.toLowerCase())
  );
  const filteredViews = savedViews.filter(v =>
    (v.name + ' ' + (v.buildingName || '')).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-screen w-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <Button variant="ghost" size="icon" onClick={() => {
          if (mode === 'menu') navigate('/');
          else if (mode === 'ifc-viewer') { setMode('menu'); setXktData(null); }
          else setMode('menu');
        }}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Eye className="h-5 w-5 text-primary" />
        <span className="font-semibold text-sm">Geminus View</span>
      </div>

      {/* Menu */}
      {mode === 'menu' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
          <h1 className="text-xl font-bold text-foreground">Geminus View</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Öppna en befintlig byggnad i 3D-viewern eller ladda upp en IFC-fil för snabbvisning.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
            <Button
              variant="outline"
              className="flex-1 h-24 flex-col gap-2"
              onClick={() => setMode('buildings')}
            >
              <Building2 className="h-6 w-6 text-primary" />
              <span className="text-sm">Välj byggnad</span>
            </Button>
            <label className="flex-1">
              <input
                type="file"
                accept=".ifc"
                className="sr-only"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />
              <div className={cn(
                "h-24 flex flex-col items-center justify-center gap-2 rounded-md border border-input bg-background cursor-pointer",
                "hover:bg-accent transition-colors text-sm"
              )}>
                <Upload className="h-6 w-6 text-primary" />
                <span>Ladda upp IFC</span>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Building selector */}
      {mode === 'buildings' && (
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Sök byggnad eller vy..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {loadingData ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-4">
              {filteredBuildings.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2">Byggnader</h3>
                  <div className="space-y-1">
                    {filteredBuildings.map(b => (
                      <button
                        key={b.fmGuid}
                        className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent transition-colors flex items-center gap-2 min-h-[44px]"
                        onClick={() => navigate(`/viewer?building=${b.fmGuid}&mode=3d`)}
                      >
                        <Building2 className="h-4 w-4 text-primary shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{b.commonName || b.name}</div>
                          {b.commonName && b.name !== b.commonName && (
                            <div className="text-xs text-muted-foreground truncate">{b.name}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredViews.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-muted-foreground uppercase mb-2">Sparade vyer</h3>
                  <div className="space-y-1">
                    {filteredViews.map(v => (
                      <button
                        key={v.id}
                        className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent transition-colors flex items-center gap-2 min-h-[44px]"
                        onClick={() => navigate(`/viewer?building=${v.buildingFmGuid}&mode=3d&view=${v.id}`)}
                      >
                        <Camera className="h-4 w-4 text-primary shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{v.name}</div>
                          {v.buildingName && (
                            <div className="text-xs text-muted-foreground truncate">{v.buildingName}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {filteredBuildings.length === 0 && filteredViews.length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-8">
                  Inga resultat hittades
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* IFC upload / conversion progress */}
      {mode === 'ifc-upload' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
          <Box className="h-10 w-10 text-primary" />
          <h2 className="text-lg font-semibold">Konverterar IFC</h2>
          {ifcFile && <p className="text-sm text-muted-foreground">{ifcFile.name}</p>}

          <div className="w-full max-w-md">
            <Progress value={conversionProgress} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1 text-right">{conversionProgress}%</p>
          </div>

          <div className="w-full max-w-md max-h-40 overflow-y-auto bg-muted/50 rounded-md p-3 text-xs font-mono space-y-0.5">
            {conversionLog.map((line, i) => (
              <div key={i} className="text-muted-foreground">{line}</div>
            ))}
          </div>

          {conversionError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertTriangle className="h-4 w-4" />
              {conversionError}
            </div>
          )}

          {conversionError && (
            <Button variant="outline" onClick={() => setMode('menu')}>
              Tillbaka
            </Button>
          )}
        </div>
      )}

      {/* IFC viewer */}
      {mode === 'ifc-viewer' && (
        <div className="flex-1 relative">
          <canvas
            id="geminus-view-canvas"
            ref={viewerCanvasRef}
            className="absolute inset-0 w-full h-full"
          />
          <canvas
            id="geminus-view-navcube"
            className="absolute top-3 right-3 w-[120px] h-[120px]"
          />
          {ifcFile && (
            <div className="absolute bottom-3 left-3 bg-card/80 backdrop-blur-sm rounded-md px-3 py-1.5 text-xs text-muted-foreground">
              {ifcFile.name}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
