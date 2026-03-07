/**
 * FmAccess2DPanel — Embeds FM Access (HDC) web client in an iframe
 * using URL-parameter authentication (token, versionId, objectId).
 *
 * Flow:
 * 1. Fetch embed config (token, versionId, drawingObjectId) from edge function
 * 2. Build iframe URL with auth params: {apiUrl}/client/?token=...&versionId=...&objectId=...
 * 3. Wait for iframe load + optional HDC_APP_SYSTEM_READY or timeout → reveal
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, AlertCircle, Square, MapPin, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import GeminusPluginMenu from './GeminusPluginMenu';

interface FmAccess2DPanelProps {
  buildingFmGuid: string;
  floorId?: string;
  floorName?: string;
  fmAccessBuildingGuid?: string;
  buildingName?: string;
  className?: string;
  onChangeFloor?: () => void;
}

interface EmbedConfig {
  apiUrl: string;
  token: string;
  versionId: string;
  drawingObjectId: string | null;
}

type Phase = 'idle' | 'fetching-config' | 'loading-iframe' | 'ready' | 'error';

const FmAccess2DPanel: React.FC<FmAccess2DPanelProps> = ({
  buildingFmGuid,
  floorId,
  floorName,
  fmAccessBuildingGuid,
  buildingName,
  className = '',
  onChangeFloor,
}) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [embedConfig, setEmbedConfig] = useState<EmbedConfig | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const noFloorSelected = !floorId && !floorName;

  const phaseLabels: Record<Phase, string> = {
    'idle': '',
    'fetching-config': 'Fetching configuration...',
    'loading-iframe': 'Loading FM Access...',
    'ready': '',
    'error': '',
  };

  // ── Step 1: Fetch embed config from edge function ──
  useEffect(() => {
    if (noFloorSelected) {
      setPhase('idle');
      return;
    }

    let cancelled = false;

    async function fetchEmbedConfig() {
      setPhase('fetching-config');
      setError(null);
      setEmbedConfig(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke('fm-access-query', {
          body: {
            action: 'get-embed-config',
            buildingId: buildingFmGuid,
            floorName: floorName || '',
            fmAccessBuildingGuid: fmAccessBuildingGuid || '',
            buildingName: buildingName || '',
          },
        });

        if (cancelled) return;

        if (fnError) {
          setError(fnError.message || 'Could not fetch configuration');
          setPhase('error');
          return;
        }

        if (!data?.success) {
          setError(data?.error || 'FM Access is not configured');
          setPhase('error');
          return;
        }

        setEmbedConfig({
          apiUrl: data.apiUrl,
          token: data.token,
          versionId: data.versionId,
          drawingObjectId: data.drawingObjectId,
        });
        setPhase('loading-iframe');
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Unexpected error');
          setPhase('error');
        }
      }
    }

    fetchEmbedConfig();
    return () => { cancelled = true; };
  }, [buildingFmGuid, floorId, floorName, fmAccessBuildingGuid, buildingName, retryCount, noFloorSelected]);

  // ── Listen for HDC_APP_SYSTEM_READY + all navigation events ──
  const [hdcContext, setHdcContext] = useState<{ objectId?: string; objectType?: string }>({});

  const handleMessage = useCallback((event: MessageEvent) => {
    if (!embedConfig) return;
    try {
      const configOrigin = new URL(embedConfig.apiUrl).origin;
      if (event.origin !== configOrigin) return;
    } catch { return; }

    const msgType = event.data?.type || event.data;
    
    // Debug: log ALL messages from HDC for investigation
    console.log('[FmAccess2D] postMessage from HDC:', msgType, event.data);

    if (msgType === 'HDC_APP_SYSTEM_READY') {
      console.log('[FmAccess2D] HDC_APP_SYSTEM_READY received');
      setPhase('ready');
    }

    // Capture navigation / object selection events from HDC
    if (event.data?.objectId || event.data?.guid || event.data?.fmGuid) {
      const ctx = {
        objectId: event.data.objectId || event.data.guid || event.data.fmGuid,
        objectType: event.data.objectType || event.data.type || 'unknown',
      };
      setHdcContext(ctx);
      // Dispatch context change event for Gunnar/Ilean/Insights
      window.dispatchEvent(new CustomEvent('FM_ACCESS_CONTEXT_CHANGED', {
        detail: {
          objectId: ctx.objectId,
          objectType: ctx.objectType,
          buildingGuid: buildingFmGuid,
          raw: event.data,
        },
      }));
    }
  }, [embedConfig, buildingFmGuid]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // Timeout: reveal iframe after 15s regardless (app is now whitelisted)
  useEffect(() => {
    if (phase !== 'loading-iframe') return;
    const timeout = setTimeout(() => {
      console.log('[FmAccess2D] Timeout (15s), revealing iframe');
      setPhase('ready');
    }, 15000);
    return () => clearTimeout(timeout);
  }, [phase]);

  // When iframe loads, transition to ready (URL params handle auth)
  const handleIframeLoad = useCallback(() => {
    if (phase === 'loading-iframe') {
      console.log('[FmAccess2D] iframe loaded');
      // Give HDC a moment to send SYSTEM_READY, otherwise timeout handles it
    }
  }, [phase]);

  // ── Build iframe URL with auth params ──
  const iframeSrc = embedConfig
    ? (() => {
        const base = `${embedConfig.apiUrl}/viewer/2d`;
        const params = new URLSearchParams();
        params.set('token', embedConfig.token);
        if (embedConfig.versionId) params.set('versionId', embedConfig.versionId);
        if (embedConfig.drawingObjectId) params.set('objectId', embedConfig.drawingObjectId);
        return `${base}?${params.toString()}`;
      })()
    : null;

  // ─── No floor selected state ───
  if (noFloorSelected) {
    return (
      <div className={`flex items-center justify-center h-full bg-background ${className}`}>
        <div className="text-center max-w-sm">
          <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">No floor selected</p>
          <p className="text-xs text-muted-foreground mb-1">
            {buildingName ? `Building: ${buildingName}` : 'Select a floor to view the 2D drawing.'}
          </p>
          {buildingName && (
            <p className="text-xs text-muted-foreground mb-3">
              Select a floor in the 3D view to show the drawing.
            </p>
          )}
          {onChangeFloor && (
            <Button variant="outline" size="sm" onClick={onChangeFloor} className="gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              Select floor in 3D
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ─── Error state ──────────────
  if (phase === 'error') {
    return (
      <div className={`flex items-center justify-center h-full bg-background ${className}`}>
        <div className="text-center max-w-sm">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">Kunde inte ladda 2D-ritning</p>
          {(buildingName || floorName) && (
            <p className="text-xs text-muted-foreground mb-1">
              {buildingName && floorName
                ? `${buildingName} — ${floorName}`
                : buildingName || floorName}
            </p>
          )}
          <p className="text-xs text-muted-foreground mb-3">{error}</p>
          <div className="flex gap-2 justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRetryCount(c => c + 1)}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Försök igen
            </Button>
            {onChangeFloor && (
              <Button variant="outline" size="sm" onClick={onChangeFloor} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Byt våning
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isLoading = phase === 'fetching-config' || phase === 'loading-iframe';

  return (
    <div className={`relative h-full w-full bg-background ${className}`}>
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {phaseLabels[phase] || 'Laddar 2D-ritning...'}
            </p>
          </div>
        </div>
      )}

      {iframeSrc && (
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="w-full h-full border-0"
          style={{ opacity: phase === 'ready' ? 1 : 0 }}
          title="FM Access 2D Viewer"
          allow="fullscreen"
          onLoad={handleIframeLoad}
        />
      )}

      {/* Issue overlay - ready for when 2D view works */}
      {phase === 'ready' && buildingFmGuid && (
        <GeminusPluginMenu
          buildingFmGuid={buildingFmGuid}
          buildingName={buildingName}
          source="2d_fm_access"
          contextMetadata={{
            floorId,
            floorName,
            drawingObjectId: embedConfig?.drawingObjectId,
            hdcObjectId: hdcContext.objectId,
            hdcObjectType: hdcContext.objectType,
          }}
        />
      )}

      <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-background/80 backdrop-blur-sm rounded px-2 py-1 text-[10px] text-muted-foreground border z-20">
        <Square className="h-3 w-3" />
        FM Access 2D
      </div>
    </div>
  );
};

export default FmAccess2DPanel;
