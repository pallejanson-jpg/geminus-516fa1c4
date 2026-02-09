/**
 * Virtual Twin Page
 * 
 * Overlays a semi-transparent 3D BIM model on top of the live 360° panorama.
 * The user navigates panoramas naturally while the BIM geometry is ghosted on top.
 * 
 * Architecture:
 *   SDK mode (transparent overlay):
 *     Layer 1 (bottom, z-0): Ivion SDK <div> - receives all pointer events
 *     Layer 2 (top, z-10): Asset+ 3D <canvas> - transparent, pointer-events: none
 *     Camera sync: One-directional (Ivion drives → xeokit follows)
 * 
 *   Fallback mode (tabbed):
 *     Tab "360°": Ivion panorama in iframe (full viewport)
 *     Tab "3D":   Asset+ 3D viewer (full viewport)
 *     Both stay mounted to preserve state.
 * 
 * Route: /virtual-twin?building=<fmGuid>
 */

import React, { useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Layers, Move3D, Maximize2, Minimize2, Eye, RefreshCw, AlertTriangle, View, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import AssetPlusViewer from '@/components/viewer/AssetPlusViewer';
import AlignmentPanel from '@/components/viewer/AlignmentPanel';
import { useVirtualTwinSync } from '@/hooks/useVirtualTwinSync';
import { loadIvionSdk, createIvionElement, destroyIvionElement, type IvionApi } from '@/lib/ivion-sdk';
import { buildTransformFromSettings, IDENTITY_TRANSFORM, type IvionBimTransform } from '@/lib/ivion-bim-transform';
import { IVION_DEFAULT_BASE_URL } from '@/lib/constants';
import { toast } from 'sonner';

interface BuildingInfo {
  fmGuid: string;
  name: string;
  ivionSiteId: string;
  ivionUrl: string;
  transform: IvionBimTransform;
}

type FallbackTab = '360' | '3d';

const VirtualTwin: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { allData, appConfigs } = useContext(AppContext);

  const [buildingInfo, setBuildingInfo] = useState<BuildingInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showAlignment, setShowAlignment] = useState(false);
  const [ghostOpacity, setGhostOpacity] = useState(30); // 0-100%
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [transform, setTransform] = useState<IvionBimTransform>(IDENTITY_TRANSFORM);

  // Ivion SDK
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState(false);
  const [sdkRetryKey, setSdkRetryKey] = useState(0);
  const ivApiRef = useRef<IvionApi | null>(null);
  const sdkContainerRef = useRef<HTMLDivElement>(null);
  const ivionElementRef = useRef<HTMLElement | null>(null);

  // Asset+ viewer reference (for xeokit access)
  const viewerInstanceRef = useRef<any>(null);

  // Fallback tab mode (when SDK fails)
  const [fallbackTab, setFallbackTab] = useState<FallbackTab>('360');

  const buildingFmGuid = searchParams.get('building');

  // Navigation handler - always works
  const handleGoBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // ─── Load building data ────────────────────────────────────────────
  useEffect(() => {
    const loadBuilding = async () => {
      if (!buildingFmGuid) {
        setError('Ingen byggnad angiven');
        setIsLoading(false);
        return;
      }

      const building = allData.find(
        (item: any) =>
          item.fmGuid === buildingFmGuid &&
          (item.category === 'Building' || item.category === 'IfcBuilding')
      );

      if (!building) {
        setError('Byggnaden kunde inte hittas');
        setIsLoading(false);
        return;
      }

      try {
        const { data: settings, error: settingsError } = await supabase
          .from('building_settings')
          .select('ivion_site_id, ivion_bim_offset_x, ivion_bim_offset_y, ivion_bim_offset_z, ivion_bim_rotation, ivion_start_vlon, ivion_start_vlat')
          .eq('fm_guid', buildingFmGuid)
          .maybeSingle();

        if (settingsError) {
          console.error('Error fetching building settings:', settingsError);
        }

        if (!settings?.ivion_site_id) {
          setError('360°-vy är inte konfigurerad för denna byggnad. Konfigurera Ivion Site ID i byggnadsinställningarna.');
          setIsLoading(false);
          return;
        }

        // Build Ivion URL
        const configured = appConfigs?.radar?.url?.trim();
        const baseUrl = configured ? configured.replace(/\/$/, '') : IVION_DEFAULT_BASE_URL;
        let ivionUrl = `${baseUrl}/?site=${settings.ivion_site_id}`;
        if (settings.ivion_start_vlon != null) ivionUrl += `&vlon=${settings.ivion_start_vlon}`;
        if (settings.ivion_start_vlat != null) ivionUrl += `&vlat=${settings.ivion_start_vlat}`;

        const t = buildTransformFromSettings(settings);
        setTransform(t);

        setBuildingInfo({
          fmGuid: buildingFmGuid,
          name: building.commonName || building.name || 'Byggnad',
          ivionSiteId: settings.ivion_site_id,
          ivionUrl,
          transform: t,
        });
      } catch (err) {
        console.error('Error loading building data:', err);
        setError('Kunde inte ladda byggnadsdata');
      }

      setIsLoading(false);
    };

    if (allData.length > 0) {
      loadBuilding();
    }
  }, [buildingFmGuid, allData, appConfigs]);

  // ─── Load Ivion SDK ────────────────────────────────────────────────
  useEffect(() => {
    if (!buildingInfo) return;

    let cancelled = false;

    const loadSdk = async () => {
      try {
        // Fetch login token
        const { data: tokenData } = await supabase.functions.invoke('ivion-poi', {
          body: { action: 'get-login-token', buildingFmGuid: buildingInfo.fmGuid },
        });

        const loginToken = tokenData?.success ? tokenData.loginToken : undefined;

        if (cancelled) return;

        // Create SDK container
        if (sdkContainerRef.current && !ivionElementRef.current) {
          ivionElementRef.current = createIvionElement(sdkContainerRef.current);
        }

        const parsedUrl = new URL(buildingInfo.ivionUrl);
        const baseUrl = parsedUrl.origin;

        const api = await loadIvionSdk(baseUrl, 15000, loginToken);
        if (cancelled) return;

        ivApiRef.current = api;
        setSdkReady(true);
        setSdkError(false);
        console.log('[VirtualTwin] Ivion SDK ready');
      } catch (err) {
        console.error('[VirtualTwin] SDK load failed:', err);
        if (!cancelled) {
          setSdkError(true);
          console.log('[VirtualTwin] Switching to iframe fallback mode');
        }
      }
    };

    loadSdk();

    return () => {
      cancelled = true;
      if (sdkContainerRef.current && ivionElementRef.current) {
        destroyIvionElement(sdkContainerRef.current, ivionElementRef.current);
        ivionElementRef.current = null;
      }
      ivApiRef.current = null;
      setSdkReady(false);
    };
  }, [buildingInfo, sdkRetryKey]);

  // Token refresh loop
  useEffect(() => {
    if (!sdkReady || !ivApiRef.current?.auth || !buildingInfo) return;

    const refresh = async () => {
      try {
        const { data } = await supabase.functions.invoke('ivion-poi', {
          body: { action: 'get-login-token', buildingFmGuid: buildingInfo.fmGuid },
        });
        if (data?.loginToken && ivApiRef.current?.auth) {
          ivApiRef.current.auth.updateToken(data.loginToken);
        }
      } catch (e) {
        console.warn('[VirtualTwin] Token refresh failed:', e);
      }
    };

    const interval = setInterval(refresh, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [sdkReady, buildingInfo]);

  // ─── Camera sync ───────────────────────────────────────────────────
  const { isActive: syncActive, currentImageId } = useVirtualTwinSync({
    ivApiRef,
    viewerInstanceRef,
    transform,
    enabled: sdkReady,
  });

  // ─── Ghost opacity - apply to xeokit objects ──────────────────────
  useEffect(() => {
    if (!sdkReady) return;
    const xeokitViewer = viewerInstanceRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) return;

    try {
      const objectIds = xeokitViewer.scene.objectIds;
      if (objectIds?.length) {
        xeokitViewer.scene.setObjectsOpacity(objectIds, ghostOpacity / 100);
      }
    } catch (e) {
      console.debug('[VirtualTwin] Ghost opacity error:', e);
    }
  }, [ghostOpacity, sdkReady]);

  // ─── Fullscreen ────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ─── Capture viewer instance from AssetPlusViewer ─────────────────
  useEffect(() => {
    const checkForViewer = () => {
      const win = window as any;
      if (win.__assetPlusViewerInstance) {
        viewerInstanceRef.current = win.__assetPlusViewerInstance;
        return true;
      }
      return false;
    };

    const interval = setInterval(() => {
      if (checkForViewer()) clearInterval(interval);
    }, 500);

    return () => clearInterval(interval);
  }, [buildingInfo]);

  // ─── Retry SDK handler ──────────────────────────────────────────────
  const handleRetrySDK = useCallback(() => {
    setSdkError(false);
    setSdkReady(false);
    ivApiRef.current = null;
    if (sdkContainerRef.current && ivionElementRef.current) {
      destroyIvionElement(sdkContainerRef.current, ivionElementRef.current);
      ivionElementRef.current = null;
    }
    setSdkRetryKey(k => k + 1);
  }, []);

  const showFallback = sdkError && !sdkReady;

  // ─── Render ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Laddar Virtual Twin...</p>
        </div>
      </div>
    );
  }

  if (error || !buildingInfo) {
    return (
      <div className="h-screen flex items-center justify-center p-4 bg-background">
        <div className="text-center max-w-md">
          <Layers className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-destructive font-medium mb-2">{error || 'Byggnadsdata saknas'}</p>
          <Button variant="outline" onClick={handleGoBack}>
            Tillbaka
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-black">
      {/* ─── SDK MODE: Transparent overlay ─── */}
      {!showFallback && (
        <>
          {/* Layer 1: Ivion SDK (bottom) - receives all pointer events */}
          <div
            ref={sdkContainerRef}
            className="absolute inset-0 z-0"
            style={{ width: '100%', height: '100%' }}
          />

          {/* Layer 2: Asset+ 3D viewer - transparent overlay */}
          <div
            className="absolute inset-0 z-10"
            style={{ pointerEvents: 'none' }}
          >
            <AssetPlusViewer
              fmGuid={buildingInfo.fmGuid}
              transparentBackground={true}
              ghostOpacity={ghostOpacity / 100}
              suppressOverlay={true}
              onClose={handleGoBack}
            />
          </div>
        </>
      )}

      {/* ─── FALLBACK MODE: Tabbed 360/3D ─── */}
      {showFallback && (
        <>
          {/* 360° iframe - hidden when 3D tab is active, but stays mounted */}
          <div
            className="absolute inset-0 z-0"
            style={{ display: fallbackTab === '360' ? 'block' : 'none' }}
          >
            <iframe
              src={buildingInfo.ivionUrl}
              className="w-full h-full border-0"
              allow="fullscreen"
              title="360° Panorama"
            />
          </div>

          {/* 3D viewer - hidden when 360 tab is active, but stays mounted */}
          <div
            className="absolute inset-0 z-0"
            style={{ display: fallbackTab === '3d' ? 'block' : 'none' }}
          >
            <AssetPlusViewer
              fmGuid={buildingInfo.fmGuid}
              transparentBackground={false}
              suppressOverlay={true}
              onClose={handleGoBack}
            />
          </div>

          {/* Tab switcher */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex gap-1 bg-black/60 backdrop-blur-md rounded-lg p-1 shadow-2xl border border-white/10">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFallbackTab('360')}
              className={`gap-1.5 px-4 h-9 rounded-md transition-all ${
                fallbackTab === '360'
                  ? 'bg-white/20 text-white shadow-inner'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <View className="h-4 w-4" />
              360°
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFallbackTab('3d')}
              className={`gap-1.5 px-4 h-9 rounded-md transition-all ${
                fallbackTab === '3d'
                  ? 'bg-white/20 text-white shadow-inner'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <Box className="h-4 w-4" />
              3D
            </Button>
          </div>

          {/* Fallback info banner */}
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 bg-amber-900/80 backdrop-blur-sm text-amber-100 px-4 py-2 rounded-lg flex items-center gap-3 shadow-lg max-w-md">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="text-xs">SDK ej tillgängligt – visas i delat läge</span>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 h-7 text-xs"
              onClick={handleRetrySDK}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Försök igen
            </Button>
          </div>
        </>
      )}

      {/* Header toolbar - z-40 to stay above ALL child overlays */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between p-2 bg-black/40 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGoBack}
            className="text-white hover:bg-white/20 gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Tillbaka</span>
          </Button>
          <div className="h-5 w-px bg-white/30" />
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <div>
              <h1 className="text-sm font-semibold text-white">{buildingInfo.name}</h1>
              <p className="text-[10px] text-white/60">Virtual Twin</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Sync status - only in SDK mode */}
          {!showFallback && syncActive && (
            <span className="text-xs text-green-400 bg-green-900/40 px-2 py-0.5 rounded flex items-center gap-1 mr-2">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              Synk aktiv
            </span>
          )}

          {/* Ghost opacity slider - only in SDK mode */}
          {!showFallback && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 bg-white/10 rounded px-3 py-1 min-w-[160px]">
                  <Eye className="h-3.5 w-3.5 text-white/70 shrink-0" />
                  <Slider
                    value={[ghostOpacity]}
                    onValueChange={([v]) => setGhostOpacity(v)}
                    min={0}
                    max={100}
                    step={5}
                    className="w-28"
                  />
                  <span className="text-xs text-white/70 w-8 text-right shrink-0">{ghostOpacity}%</span>
                </div>
              </TooltipTrigger>
              <TooltipContent>3D-modellens synlighet</TooltipContent>
            </Tooltip>
          )}

          {/* Alignment toggle - only in SDK mode */}
          {!showFallback && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`text-white hover:bg-white/20 h-8 w-8 ${showAlignment ? 'bg-white/20' : ''}`}
                  onClick={() => setShowAlignment(!showAlignment)}
                >
                  <Move3D className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Alignment-kalibrering</TooltipContent>
            </Tooltip>
          )}

          {/* Fullscreen */}
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20 h-8 w-8"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Alignment panel (slide-out) */}
      {showAlignment && buildingInfo && (
        <div className="absolute top-14 left-4 z-40">
          <AlignmentPanel
            transform={transform}
            onChange={setTransform}
            buildingFmGuid={buildingInfo.fmGuid}
            onSaved={() => setShowAlignment(false)}
          />
        </div>
      )}
    </div>
  );
};

export default VirtualTwin;
