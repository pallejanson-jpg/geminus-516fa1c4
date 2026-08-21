import React, { useState, useEffect, useMemo, useContext, useCallback, useRef } from "react";
import { useLanguage } from '@/context/LanguageContext';
import { Loader2, ExternalLink, X, Maximize2, Minimize2, Plus, MapPin, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppContext, Ivion360Context } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import IvionRegistrationPanel from "@/components/inventory/IvionRegistrationPanel";
import GeminusPluginMenu from "./GeminusPluginMenu";
import UnplacedAssetsPanel from "@/components/inventory/UnplacedAssetsPanel";
import { useIvionCameraSync } from "@/hooks/useIvionCameraSync";
import { useIvionSdk } from "@/hooks/useIvionSdk";
import type { BuildingOrigin } from "@/lib/coordinate-transform";
import type { IvionBimTransform } from "@/lib/ivion-bim-transform";
import { useIsMobile } from "@/hooks/use-mobile";
import { logger } from '@/lib/logger';

interface IvionPoiData {
  id: number;
  titles: Record<string, string>;
  location: { x: number; y: number; z: number };
  pointOfView?: { imageId: number };
}

type ConnectionStatus = 'unknown' | 'connected' | 'error' | 'expired';

interface Ivion360ViewProps {
  url?: string;
  onClose?: () => void;
  /** Enable camera synchronization with 3D viewer */
  syncEnabled?: boolean;
  /** Building origin for coordinate transformation */
  buildingOrigin?: BuildingOrigin | null;
  /** Building FM GUID for token renewal */
  buildingFmGuid?: string;
  /** Ivion site ID for sync */
  ivionSiteIdProp?: string;
  /** Callback when manual sync button is clicked */
  onSyncRequest?: () => void;
  /** Ivion-to-BIM coordinate transform */
  ivionBimTransform?: IvionBimTransform;
  /** Initial heading in degrees (e.g. from Street View transition) */
  initialHeading?: number | null;
}

export default function Ivion360View({ 
  url, 
  onClose, 
  syncEnabled = false,
  buildingOrigin = null,
  buildingFmGuid: propBuildingFmGuid,
  ivionSiteIdProp,
  onSyncRequest,
  ivionBimTransform,
  initialHeading,
}: Ivion360ViewProps) {
  const isMobile = useIsMobile();
  const { t } = useLanguage();
  const { ivion360Context, setIvion360Context } = useContext(AppContext);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const sdkContainerRef = useRef<HTMLDivElement>(null);

  // Panel states
  const [registrationPanelOpen, setRegistrationPanelOpen] = useState(false);
  const [unplacedPanelOpen, setUnplacedPanelOpen] = useState(false);

  // POI polling state
  const [lastSeenPoiId, setLastSeenPoiId] = useState<number | null>(null);
  const [detectedPoi, setDetectedPoi] = useState<IvionPoiData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [hasPendingPoi, setHasPendingPoi] = useState(false);
  const [pendingPoiQueue, setPendingPoiQueue] = useState<IvionPoiData[]>([]);

  // URL/context resolution
  const ivionUrl = ivion360Context?.ivionUrl || url || localStorage.getItem('ivion360Url');
  const hasContext = !!ivion360Context;
  const buildingFmGuid = propBuildingFmGuid || ivion360Context?.buildingFmGuid;
  const buildingName = ivion360Context?.buildingName;
  const ivionSiteId = ivionSiteIdProp || ivion360Context?.ivionSiteId;

  // ─── SDK Loading ──────────────────────────────────────────────────
  // Loading, auto-auth, token refresh, and <ivion> element lifecycle are all owned by
  // useIvionSdk now (Phase 4 consolidation — this file used to duplicate all of that
  // inline with its own, slightly different refresh interval).

  // Origin-only base URL, memoized and parse-error-safe: a malformed ivionUrl must
  // fall through to the iframe fallback below, not throw during render.
  const ivionBaseUrl = useMemo(() => {
    if (!ivionUrl) return '';
    try {
      return new URL(ivionUrl).origin;
    } catch {
      return '';
    }
  }, [ivionUrl]);

  const { sdkStatus, ivApiRef } = useIvionSdk({
    baseUrl: ivionBaseUrl,
    siteId: ivionSiteId || '',
    buildingFmGuid: buildingFmGuid || '',
    containerRef: sdkContainerRef,
    enabled: !!ivionUrl,
  });

  // Rendering mode: 'sdk' if SDK loaded successfully, 'iframe' as fallback
  const renderMode = sdkStatus === 'ready' ? 'sdk' : 'iframe';

  // Once ivionUrl is confirmed present (we're past the early-return guard below),
  // 'idle' can no longer mean "haven't started yet" — useIvionSdk only stays idle when
  // enabled/baseUrl/siteId aren't all set (e.g. a malformed URL, or no site configured),
  // which needs the same iframe fallback as an outright load failure.
  const sdkUnavailable = sdkStatus === 'failed' || sdkStatus === 'idle';

  // Camera sync hook - supports both SDK and iframe modes
  const {
    imageCache,
    isLoadingImages,
    currentImageId,
    syncToIvion,
    syncFrom360Url,
    sendSubscribeCommand,
    lastSyncSource,
    postMessageActive,
    hasImageLoadError,
    retryLoadImages,
  } = useIvionCameraSync({
    iframeRef,
    ivApiRef,
    enabled: syncEnabled,
    buildingOrigin,
    ivionSiteId: ivionSiteId || '',
    buildingFmGuid,
    buildingTransform: ivionBimTransform,
  });

  // Token renewal state
  const [isRenewingToken, setIsRenewingToken] = useState(false);

  useEffect(() => {
    if (sdkStatus === 'ready') setIsLoading(false);
  }, [sdkStatus]);

  // Toast once per successful connect (not on every re-render while status stays 'ready').
  const hasShownReadyToastRef = useRef(false);
  useEffect(() => {
    if (sdkStatus === 'ready' && !hasShownReadyToastRef.current) {
      hasShownReadyToastRef.current = true;
      toast.success(t('360° SDK ansluten', '360° SDK connected'), {
        description: t('Automatisk synkronisering aktiv', 'Automatic synchronization active'),
      });
    } else if (sdkStatus !== 'ready') {
      hasShownReadyToastRef.current = false;
    }
  }, [sdkStatus, t]);

  // Inject CSS to shrink Ivion SDK UI elements when ready
  useEffect(() => {
    if (sdkStatus !== 'ready' || !sdkContainerRef.current) return;
    const container = sdkContainerRef.current;
    const styleId = 'ivion-ui-scale-override';
    if (container.querySelector(`#${styleId}`)) return;

    const style = document.createElement('style');
    style.id = styleId;
    const mobileRules = isMobile ? `
      ivion .iv-sidebar { display: none !important; }
      ivion .iv-sidebar-toggle { transform: scale(0.5); transform-origin: top left; }
      ivion .iv-floor-selector { transform: scale(0.45); transform-origin: bottom left; max-height: 28vh !important; }
      ivion .iv-controls { transform: scale(0.45); transform-origin: bottom right; }
      ivion .iv-minimap { transform: scale(0.4); transform-origin: bottom right; }
      ivion .iv-toolbar { transform: scale(0.45); transform-origin: bottom center; }
      ivion .iv-button { font-size: 8px !important; padding: 2px 4px !important; }
      ivion .iv-navigation { transform: scale(0.4); transform-origin: bottom right; }
      ivion .iv-header, ivion [class*="search"], ivion [class*="Search"] {
        transform: scale(0.5); transform-origin: top center;
      }
      ivion [class*="panel"], ivion [class*="Panel"] {
        transform: scale(0.45); transform-origin: bottom right;
      }
    ` : `
      ivion .iv-sidebar { max-width: 220px !important; }
      ivion .iv-sidebar-toggle { transform: scale(0.85); transform-origin: top left; }
      ivion .iv-floor-selector { transform: scale(0.85); transform-origin: bottom left; }
      ivion .iv-controls { transform: scale(0.85); transform-origin: bottom right; }
      ivion .iv-minimap { transform: scale(0.8); transform-origin: bottom left; }
      ivion .iv-toolbar { transform: scale(0.85); transform-origin: bottom center; }
      ivion .iv-button { font-size: 12px !important; }
    `;
    style.textContent = mobileRules;
    container.appendChild(style);

    return () => {
      const el = container.querySelector(`#${styleId}`);
      if (el) el.remove();
    };
  }, [sdkStatus, isMobile]);

  // Hide Ivion sidebar items on mobile when SDK is ready
  useEffect(() => {
    if (sdkStatus !== 'ready' || !isMobile || !ivApiRef.current) return;

    try {
      // Try to hide all sidebar menu items
      const menuItems = ivApiRef.current.getMenuItems?.();
      if (menuItems && Array.isArray(menuItems)) {
        menuItems.forEach(item => {
          if (item.setVisible) {
            item.setVisible(false);
          } else if (item.isVisible) {
            // Override isVisible to always return false
            item.isVisible = () => false;
          }
        });
        logger.log('[Ivion360View] Hidden', menuItems.length, 'sidebar menu items on mobile');
      }

      // Try to close the sidebar menu
      ivApiRef.current.closeMenu?.();
    } catch (e) {
      logger.warn('[Ivion360View] Could not hide SDK sidebar items:', e);
    }
  }, [sdkStatus, isMobile]);

  // Apply initial heading from Street View transition
  useEffect(() => {
    if (sdkStatus !== 'ready' || initialHeading == null || !ivApiRef.current) return;
    try {
      const api = ivApiRef.current as any;
      if (api.camera?.setHeading) {
        api.camera.setHeading(initialHeading);
        logger.log('[Ivion360View] Applied initial heading from Street View:', initialHeading);
      } else if (api.resolveMoveTo) {
        api.resolveMoveTo({ heading: initialHeading });
        logger.log('[Ivion360View] Applied heading via resolveMoveTo:', initialHeading);
      }
    } catch (e) {
      logger.warn('[Ivion360View] Could not apply initial heading:', e);
    }
  }, [sdkStatus, initialHeading]);

  // ─── Token renewal ────────────────────────────────────────────────

  useEffect(() => {
    if (!buildingFmGuid) return;
    
    const validateAndRefreshToken = async () => {
      try {
        setIsRenewingToken(true);
        
        const { data, error } = await supabase.functions.invoke('ivion-poi', {
          body: { 
            action: 'test-connection-auto',
            buildingFmGuid,
          },
        });
        
        if (error) {
          logger.warn('Ivion token validation failed:', error);
          setConnectionStatus('error');
        } else if (data?.success) {
          logger.log('Ivion token valid/renewed:', data.message);
          setConnectionStatus('connected');
        } else {
          logger.warn('Ivion token check returned unsuccessful:', data);
          setConnectionStatus('expired');
        }
      } catch (e) {
        console.error('Token renewal error:', e);
        setConnectionStatus('error');
      } finally {
        setIsRenewingToken(false);
      }
    };
    
    validateAndRefreshToken();
  }, [buildingFmGuid]);

  // ─── Iframe handlers ──────────────────────────────────────────────

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    
    // On mobile, aggressively hide Ivion sidebar with multiple retries
    if (isMobile && iframeRef.current?.contentWindow) {
      const RETRY_DELAYS = [1000, 3000, 5000, 8000];
      RETRY_DELAYS.forEach(delay => {
        setTimeout(() => {
          try {
            iframeRef.current?.contentWindow?.postMessage({
              command: 'setSidebarVisibility',
              params: { visible: false }
            }, '*');
          } catch (e) {
            logger.warn('[Ivion360View] Could not send sidebar postMessage:', e);
          }
        }, delay);
      });
    }
  }, [isMobile]);

  // ─── UI handlers ──────────────────────────────────────────────────

  const handleOpenExternal = () => {
    if (ivionUrl) {
      window.open(ivionUrl, '_blank');
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleClose = useCallback(() => {
    setIvion360Context(null);
    onClose?.();
  }, [setIvion360Context, onClose]);

  const handleManualSync = useCallback(() => {
    if (onSyncRequest) {
      onSyncRequest();
    } else {
      syncToIvion();
      toast.success(t('360°-vy synkad till 3D-position', '360° view synced to 3D position'));
    }
  }, [onSyncRequest, syncToIvion]);

  // ─── POI polling ──────────────────────────────────────────────────

  useEffect(() => {
    if (!ivionSiteId || !registrationPanelOpen) return;

    const pollForNewPois = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('ivion-poi', {
          body: {
            action: 'get-latest-poi',
            siteId: ivionSiteId,
          },
        });

        if (error) {
          setConnectionStatus('error');
          return;
        }

        setConnectionStatus('connected');

        if (data?.location && data?.id) {
          if (lastSeenPoiId !== null && data.id !== lastSeenPoiId) {
            setDetectedPoi(data);
            setHasPendingPoi(true);
            setPendingPoiQueue(prev => [...prev, data]);
            toast.info('New POI detected in Ivion!', {
              description: 'Click to load coordinates',
            });
          }
          setLastSeenPoiId(data.id);
        }
      } catch (err) {
        console.error('POI polling error:', err);
        setConnectionStatus('error');
      }
    };

    pollForNewPois();
    const interval = setInterval(pollForNewPois, 3000);
    return () => clearInterval(interval);
  }, [ivionSiteId, registrationPanelOpen, lastSeenPoiId]);

  const handleLoadPendingPoi = useCallback(() => {
    if (pendingPoiQueue.length > 0) {
      const nextPoi = pendingPoiQueue[0];
      setDetectedPoi(nextPoi);
      setPendingPoiQueue(prev => prev.slice(1));
      setHasPendingPoi(pendingPoiQueue.length > 1);
    }
  }, [pendingPoiQueue]);

  const handleSaved = useCallback(() => {
    setDetectedPoi(null);
    if (pendingPoiQueue.length > 0) {
      handleLoadPendingPoi();
    }
  }, [pendingPoiQueue, handleLoadPendingPoi]);

  const handleSavedAndClose = useCallback(() => {
    setRegistrationPanelOpen(false);
    setDetectedPoi(null);
    setPendingPoiQueue([]);
    setHasPendingPoi(false);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────

  if (!ivionUrl) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">{t('Ingen 360°-vy konfigurerad', 'No 360° view configured')}</p>
          <p className="text-xs mt-2">{t('Konfigurera Ivion Site ID i byggnadsinställningar', 'Configure Ivion Site ID in building settings')}</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`h-full flex flex-col overflow-hidden ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : ''}`}
      style={isMobile ? { touchAction: 'none' } : undefined}
    >
      {/* Toolbar - hidden on mobile */}
      {!isMobile && (
        <div className="flex items-center justify-between p-2 border-b bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">360° Viewer</span>
            {buildingName && (
              <span className="text-sm text-muted-foreground">- {buildingName}</span>
            )}
            {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            
            {/* Sync mode indicator */}
            {syncEnabled && (
              <>
                {postMessageActive && (
                  <span className="text-xs text-success bg-success/15 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                    {renderMode === 'sdk' ? 'SDK Sync' : 'Auto-sync'}
                  </span>
                )}
                {renderMode === 'iframe' && sdkUnavailable && (
                  <span className="text-xs text-warning bg-warning/15 px-1.5 py-0.5 rounded flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {t('Iframe-läge', 'Iframe mode')}
                  </span>
                )}
                {!isLoadingImages && imageCache.length > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {t(`${imageCache.length} bilder`, `${imageCache.length} images`)}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Sync button */}
            {syncEnabled && imageCache.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleManualSync}
                title={t('Synka 360° till 3D', 'Sync 360° to 3D')}
                className="gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline text-xs">{t('Synka', 'Sync')}</span>
              </Button>
            )}
            
            {/* Inventory tools */}
            {hasContext && ivionSiteId && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRegistrationPanelOpen(true)}
                  title={t('Registrera tillgång', 'Register asset')}
                  className="gap-1.5"
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs">{t('Registrera', 'Register')}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUnplacedPanelOpen(true)}
                  title={t('Skapa POI från Geminus', 'Create POI from Geminus')}
                  className="gap-1.5"
                >
                  <MapPin className="h-4 w-4" />
                  <span className="hidden sm:inline text-xs">POI</span>
                </Button>
                <div className="w-px h-5 bg-border mx-1" />
              </>
            )}
            <Button variant="ghost" size="icon" onClick={handleOpenExternal} title="Open in new tab">
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            {(onClose || hasContext) && (
              <Button variant="ghost" size="icon" onClick={handleClose} title="Close">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Viewer container */}
      <div className="flex-1 relative">
        {/* Loading overlay */}
        {(isLoading || isRenewingToken || isLoadingImages || sdkStatus === 'loading') && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                 {sdkStatus === 'loading'
                   ? t('Laddar 360° SDK...', 'Loading 360° SDK...')
                   : isRenewingToken
                     ? t('Förnyar anslutning...', 'Renewing connection...')
                     : isLoadingImages
                       ? t('Laddar bildpositioner...', 'Loading image positions...')
                       : t('Laddar 360°-vy...', 'Loading 360° view...')}
              </span>
            </div>
          </div>
        )}
        
        {/* Image cache error banner */}
        {syncEnabled && !isLoadingImages && imageCache.length === 0 && hasImageLoadError && (
          <div className="absolute top-12 left-2 right-2 z-20 bg-warning/15
                          text-warning text-xs px-3 py-2 rounded shadow flex items-center justify-between gap-2">
             <span>⚠️ {t('Kunde inte hämta bildpositioner för synk.', 'Could not fetch image positions for sync.')}</span>
             <button
               onClick={retryLoadImages}
               className="underline hover:no-underline whitespace-nowrap"
             >
               {t('Försök igen', 'Try again')}
             </button>
          </div>
        )}

        {/* SDK rendering container - always present to allow SDK loading */}
        <div 
          ref={sdkContainerRef} 
          className="w-full h-full transition-opacity duration-300"
          style={{
            display: sdkUnavailable ? 'none' : 'block',
            opacity: sdkStatus === 'ready' ? 1 : 0,
          }}
        />

        {/* Iframe fallback - shown when SDK definitively fails, or never attempts to
            load (e.g. no Ivion site configured for this building) */}
        {sdkUnavailable && (
          <iframe
            ref={iframeRef}
            src={ivionUrl}
            className="w-full h-full border-0"
            onLoad={handleIframeLoad}
            allow="fullscreen; autoplay"
            title="Ivion 360 Viewer"
          />
        )}

        {/* Registration panel overlay */}
        {registrationPanelOpen && buildingFmGuid && (
          <IvionRegistrationPanel
            buildingFmGuid={buildingFmGuid}
            ivionSiteId={ivionSiteId || null}
            onClose={() => setRegistrationPanelOpen(false)}
            onSaved={handleSaved}
            onSavedAndClose={handleSavedAndClose}
            initialPoi={detectedPoi}
            connectionStatus={connectionStatus}
            onLoadPendingPoi={handleLoadPendingPoi}
            hasPendingPoi={hasPendingPoi}
          />
        )}

        {/* Unplaced assets panel overlay */}
        {unplacedPanelOpen && buildingFmGuid && (
          <UnplacedAssetsPanel
            buildingFmGuid={buildingFmGuid}
            ivionSiteId={ivionSiteId || null}
            onClose={() => setUnplacedPanelOpen(false)}
            onAssetsCreated={() => {
              toast.success(t('POIs skapade i Ivion', 'POIs created in Ivion'));
            }}
          />
        )}

        {/* Geminus plugin menu */}
        {buildingFmGuid && (
          <GeminusPluginMenu
            buildingFmGuid={buildingFmGuid}
            buildingName={buildingName}
            source="ivion_360"
          />
        )}
      </div>
    </div>
  );
}
