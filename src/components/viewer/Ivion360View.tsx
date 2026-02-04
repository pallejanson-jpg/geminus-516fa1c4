import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import { Loader2, ExternalLink, X, Maximize2, Minimize2, Plus, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppContext, Ivion360Context } from "@/context/AppContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import IvionRegistrationPanel from "@/components/inventory/IvionRegistrationPanel";
import UnplacedAssetsPanel from "@/components/inventory/UnplacedAssetsPanel";
import { useIvionCameraSync } from "@/hooks/useIvionCameraSync";
import type { BuildingOrigin } from "@/lib/coordinate-transform";

interface IvionPoiData {
  id: number;
  titles: Record<string, string>;
  location: { x: number; y: number; z: number };
  pointOfView?: { imageId: number };
}

type ConnectionStatus = 'unknown' | 'connected' | 'error' | 'expired';

interface Ivion360ViewProps {
  url?: string; // Direct URL prop for inline usage (fallback)
  onClose?: () => void;
  /** Enable camera synchronization with 3D viewer */
  syncEnabled?: boolean;
  /** Building origin for coordinate transformation */
  buildingOrigin?: BuildingOrigin | null;
  /** Building FM GUID for token renewal (optional - uses context if not provided) */
  buildingFmGuid?: string;
  /** Ivion site ID for sync (optional - uses context if not provided) */
  ivionSiteIdProp?: string;
  /** Callback when manual sync button is clicked */
  onSyncRequest?: () => void;
}

export default function Ivion360View({ 
  url, 
  onClose, 
  syncEnabled = false,
  buildingOrigin = null,
  buildingFmGuid: propBuildingFmGuid,
  ivionSiteIdProp,
  onSyncRequest,
}: Ivion360ViewProps) {
  const { ivion360Context, setIvion360Context } = useContext(AppContext);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Panel states
  const [registrationPanelOpen, setRegistrationPanelOpen] = useState(false);
  const [unplacedPanelOpen, setUnplacedPanelOpen] = useState(false);

  // POI polling state (when registration panel is open)
  const [lastSeenPoiId, setLastSeenPoiId] = useState<number | null>(null);
  const [detectedPoi, setDetectedPoi] = useState<IvionPoiData | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [hasPendingPoi, setHasPendingPoi] = useState(false);
  const [pendingPoiQueue, setPendingPoiQueue] = useState<IvionPoiData[]>([]);

  // Determine the URL to use (context takes priority, then prop, then localStorage)
  const ivionUrl = ivion360Context?.ivionUrl || url || localStorage.getItem('ivion360Url');
  const hasContext = !!ivion360Context;
  const buildingFmGuid = propBuildingFmGuid || ivion360Context?.buildingFmGuid;
  const buildingName = ivion360Context?.buildingName;
  const ivionSiteId = ivionSiteIdProp || ivion360Context?.ivionSiteId;

  // Camera sync hook - using new image-based approach
  const { imageCache, isLoadingImages, currentImageId, syncToIvion, syncFrom360Url } = useIvionCameraSync({
    iframeRef,
    enabled: syncEnabled,
    buildingOrigin,
    ivionSiteId: ivionSiteId || '',
    buildingFmGuid,
  });

  // Token renewal state
  const [isRenewingToken, setIsRenewingToken] = useState(false);

  // Automatic token validation and renewal on mount
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
          console.warn('Ivion token validation failed:', error);
          setConnectionStatus('error');
        } else if (data?.success) {
          console.log('Ivion token valid/renewed:', data.message);
          setConnectionStatus('connected');
        } else {
          console.warn('Ivion token check returned unsuccessful:', data);
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

  const handleOpenExternal = () => {
    if (ivionUrl) {
      window.open(ivionUrl, '_blank');
    }
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleClose = useCallback(() => {
    // Clear 360 context when closing
    setIvion360Context(null);
    onClose?.();
  }, [setIvion360Context, onClose]);

  // Manual sync button handler
  const handleManualSync = useCallback(() => {
    if (onSyncRequest) {
      onSyncRequest();
    } else {
      syncToIvion();
      toast.success('360°-vy synkad till 3D-position');
    }
  }, [onSyncRequest, syncToIvion]);

  // POI polling effect - only when registration panel is open
  useEffect(() => {
    if (!ivionSiteId || !registrationPanelOpen) {
      return;
    }

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
          // Check if this is a new POI
          if (lastSeenPoiId !== null && data.id !== lastSeenPoiId) {
            // New POI detected!
            setDetectedPoi(data);
            setHasPendingPoi(true);
            setPendingPoiQueue(prev => [...prev, data]);
            toast.info('Ny POI upptäckt i Ivion!', {
              description: `Klicka för att ladda in koordinater`,
            });
          }
          setLastSeenPoiId(data.id);
        }
      } catch (err) {
        console.error('POI polling error:', err);
        setConnectionStatus('error');
      }
    };

    // Initial poll
    pollForNewPois();

    // Poll every 3 seconds
    const interval = setInterval(pollForNewPois, 3000);

    return () => clearInterval(interval);
  }, [ivionSiteId, registrationPanelOpen, lastSeenPoiId]);

  // Load pending POI into form
  const handleLoadPendingPoi = useCallback(() => {
    if (pendingPoiQueue.length > 0) {
      const nextPoi = pendingPoiQueue[0];
      setDetectedPoi(nextPoi);
      setPendingPoiQueue(prev => prev.slice(1));
      setHasPendingPoi(pendingPoiQueue.length > 1);
    }
  }, [pendingPoiQueue]);

  // Handle save completed
  const handleSaved = useCallback(() => {
    // Reset detected POI after saving
    setDetectedPoi(null);
    // Check if there are more pending POIs
    if (pendingPoiQueue.length > 0) {
      handleLoadPendingPoi();
    }
  }, [pendingPoiQueue, handleLoadPendingPoi]);

  // Handle save and close
  const handleSavedAndClose = useCallback(() => {
    setRegistrationPanelOpen(false);
    setDetectedPoi(null);
    setPendingPoiQueue([]);
    setHasPendingPoi(false);
  }, []);

  if (!ivionUrl) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">No 360° view configured</p>
          <p className="text-xs mt-2">Configure Ivion Site ID in building settings</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">360° Viewer</span>
          {buildingName && (
            <span className="text-sm text-muted-foreground">- {buildingName}</span>
          )}
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {syncEnabled && !isLoadingImages && imageCache.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              {imageCache.length} bilder
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Sync button - only show when sync is enabled */}
          {syncEnabled && imageCache.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleManualSync}
              title="Synka 360° till 3D"
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline text-xs">Synka</span>
            </Button>
          )}
          
          {/* Inventory tools - only show when context is available */}
          {hasContext && ivionSiteId && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRegistrationPanelOpen(true)}
                title="Registrera tillgång"
                className="gap-1.5"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline text-xs">Registrera</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUnplacedPanelOpen(true)}
                title="Skapa POI från Geminus"
                className="gap-1.5"
              >
                <MapPin className="h-4 w-4" />
                <span className="hidden sm:inline text-xs">POI</span>
              </Button>
              <div className="w-px h-5 bg-border mx-1" />
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleOpenExternal}
            title="Open in new tab"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          {(onClose || hasContext) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Iframe container */}
      <div className="flex-1 relative">
        {(isLoading || isRenewingToken || isLoadingImages) && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                {isRenewingToken 
                  ? 'Förnyar anslutning...' 
                  : isLoadingImages 
                    ? 'Laddar bildpositioner...'
                    : 'Laddar 360°-vy...'}
              </span>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={ivionUrl}
          className="w-full h-full border-0"
          onLoad={() => setIsLoading(false)}
          allow="fullscreen; autoplay"
          title="Ivion 360 Viewer"
        />

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
              toast.success('POIs skapade i Ivion');
            }}
          />
        )}
      </div>
    </div>
  );
}
