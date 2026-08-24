/**
 * GeminusBaseV2ViewerPanel — Embeds Geminus Base viewer via postMessage auth (External Auth API, v5.1+).
 *
 * Auth flow:
 * 1. Load iframe with ?awaitConfig=true&viewport=EmbeddedViewer
 * 2. Receive HDC_APP_READY_FOR_CONFIG → send HDC_ENABLE_EXTERNAL_AUTH + HDC_START_APP
 * 3. Receive HDC_AUTH_TOKEN_REQUEST → fetch fresh token from edge fn → HDC_AUTH_TOKEN_RESPONSE
 * 4. Receive HDC_APP_SYSTEM_READY → viewer is ready, expose postMessage EmbeddedAPI
 *
 * EmbeddedAPI (postMessage format, based on HD.EmbeddedApi docs):
 *   showObject, showMultiObject, clearView, applyFilter, setExternalFilter, getSelectedObjects
 */
import React, {
  useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef,
} from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GeminusBaseViewerObject {
  objectId: string | number;
  classId: string | number;
}

export interface GeminusBaseViewPreference {
  mode?: '2D' | '3D' | 'PC';
  fitMode?: 0 | 1;
  fitMargin?: number;
  autoSyncGrid?: boolean;
  syncPreference?: 'object' | 'document' | 'auto';
}

export interface GeminusBaseV2ViewerHandle {
  showObject: (objectId: string | number, classId: string | number, domain?: string | number, viewPreference?: GeminusBaseViewPreference | '2D' | '3D') => void;
  showMultiObject: (gridObject: GeminusBaseViewerObject | null, viewerObject: GeminusBaseViewerObject | null, domain?: string | number, viewPreference?: GeminusBaseViewPreference) => void;
  showObjectByGuid: (masterGuid: string, viewPreference?: GeminusBaseViewPreference | '2D' | '3D') => void;
  clearView: () => void;
  applyFilter: (filterId: string | number) => void;
  clearFilter: () => void;
  setExternalFilter: (filterData: object, autoApply?: boolean) => void;
  getSelectedObjects: (domainId: string, callback: (success: boolean, data: any) => void) => void;
  /** Escape hatch: send a raw EmbeddedApi postMessage (for commands not wrapped above) */
  postRaw: (message: object) => void;
  isReady: () => boolean;
}

interface EmbedConfig {
  apiUrl: string;
  token: string;
}

interface GeminusBaseV2ViewerPanelProps {
  buildingFmGuid: string;
  buildingName?: string;
  geminusBaseBuildingGuid?: string;
  className?: string;
  onObjectSelected?: (objects: any[]) => void;
  onReady?: () => void;
}

type Phase = 'idle' | 'fetching' | 'loading' | 'ready' | 'error';

// ── Component ─────────────────────────────────────────────────────────────────

const GeminusBaseV2ViewerPanel = forwardRef<GeminusBaseV2ViewerHandle, GeminusBaseV2ViewerPanelProps>((
  { buildingFmGuid, buildingName, geminusBaseBuildingGuid, className = '', onObjectSelected, onReady },
  ref,
) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const embedConfigRef = useRef<EmbedConfig | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);

  // ── Fetch embed config (apiUrl + token) ──────────────────────────────────────
  useEffect(() => {
    if (!buildingFmGuid) return;
    let cancelled = false;

    async function load() {
      setPhase('fetching');
      setError(null);
      readyRef.current = false;
      try {
        const { data, error: fnError } = await supabase.functions.invoke('geminus-base-query', {
          body: {
            action: 'get-embed-config',
            buildingId: buildingFmGuid,
            geminusBaseBuildingGuid: geminusBaseBuildingGuid || '',
            buildingName: buildingName || '',
          },
        });
        if (cancelled) return;
        if (fnError || !data?.success) {
          setError(fnError?.message || data?.error || 'Could not load Geminus Base configuration');
          setPhase('error');
          return;
        }
        embedConfigRef.current = { apiUrl: data.apiUrl, token: data.token };
        setPhase('loading');
      } catch (e: any) {
        if (!cancelled) { setError(e.message); setPhase('error'); }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [buildingFmGuid, geminusBaseBuildingGuid, buildingName, retryCount]);

  // ── postMessage helper ────────────────────────────────────────────────────────
  // Target the trusted viewer origin (same derivation as the origin guard in
  // handleMessage below) instead of '*', so auth tokens can't leak to an
  // unintended origin if the iframe ever navigates away.
  const post = useCallback((message: object) => {
    const cfg = embedConfigRef.current;
    if (!cfg) return;
    try {
      const targetOrigin = new URL(cfg.apiUrl).origin;
      iframeRef.current?.contentWindow?.postMessage(message, targetOrigin);
    } catch {
      // invalid apiUrl — do not send
    }
  }, []);

  // ── Message handler (auth flow + selection events) ────────────────────────────
  const handleMessage = useCallback((event: MessageEvent) => {
    const cfg = embedConfigRef.current;
    if (!cfg) return;

    // Origin guard
    try {
      if (event.origin !== new URL(cfg.apiUrl).origin) return;
    } catch { return; }

    // The viewer's ready signal comes in one of two shapes depending on the
    // deployed Tessel client version: the documented `{ type: 'HDC_APP_SYSTEM_READY' }`,
    // or (observed live on swg-demo.bim.cloud, confirmed by manual postMessage probing)
    // an `{ operation: 'event', event: 'ui.system.messageapi.ready' }` envelope from a
    // newer client build. Recognize both so an unannounced vendor protocol bump doesn't
    // strand the handshake forever with a valid, authenticated session we never reveal.
    if (event.data?.operation === 'event' && event.data?.event === 'ui.system.messageapi.ready') {
      readyRef.current = true;
      setPhase('ready');
      onReady?.();
      return;
    }

    const type = event.data?.type ?? event.data;

    switch (type) {
      case 'HDC_APP_READY_FOR_CONFIG':
        post({ type: 'HDC_ENABLE_EXTERNAL_AUTH' });
        post({ type: 'HDC_START_APP' });
        break;

      case 'HDC_AUTH_TOKEN_REQUEST':
        // Supply the token we already have; a full production impl would re-fetch here
        post({ type: 'HDC_AUTH_TOKEN_RESPONSE', token: { access_token: cfg.token } });
        break;

      case 'HDC_APP_SYSTEM_READY':
        readyRef.current = true;
        setPhase('ready');
        onReady?.();
        break;

      default:
        // Selection / navigation events
        if (event.data?.objects?.length) {
          onObjectSelected?.(event.data.objects);
        } else if (event.data?.objectId) {
          onObjectSelected?.([{ objectId: event.data.objectId, classId: event.data.classId }]);
        }
    }
  }, [post, onReady, onObjectSelected]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // 15-second reveal fallback (same as GeminusBase2DPanel)
  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setTimeout(() => { readyRef.current = true; setPhase('ready'); }, 15000);
    return () => clearTimeout(t);
  }, [phase]);

  // ── Imperative EmbeddedAPI handle ─────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    showObject: (objectId, classId, domain, viewPreference) =>
      post({ type: 'showObject', objectId, classId, domain, viewPreference }),
    showMultiObject: (gridObject, viewerObject, domain, viewPreference) =>
      post({ type: 'showMultiObject', gridObject, viewerObject, domain, viewPreference }),
    showObjectByGuid: (masterGuid, viewPreference) =>
      post({ type: 'showObjectByGuid', masterGuid, viewPreference }),
    clearView: () =>
      post({ type: 'clearView' }),
    applyFilter: (filterId) =>
      post({ type: 'applyFilter', filterId }),
    clearFilter: () =>
      post({ type: 'clearFilter' }),
    setExternalFilter: (filterData, autoApply = true) =>
      post({ type: 'setExternalFilter', filter: filterData, autoApply }),
    getSelectedObjects: (domainId, callback) => {
      post({ type: 'getSelectedObjects', domain: domainId });
      // Response arrives via handleMessage → onObjectSelected
    },
    postRaw: (message) => post(message),
    isReady: () => readyRef.current,
  }), [post]);

  // ── Iframe src ─────────────────────────────────────────────────────────────
  const iframeSrc = embedConfigRef.current
    ? `${embedConfigRef.current.apiUrl}/client/?awaitConfig=true&viewport=EmbeddedViewer&toolbar=false`
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className={`flex items-center justify-center h-full bg-background ${className}`}>
        <div className="text-center max-w-xs">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-xs text-muted-foreground mb-3">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setRetryCount(c => c + 1)} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const loading = phase === 'fetching' || phase === 'loading';

  return (
    <div className={`relative h-full w-full bg-background overflow-hidden ${className}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}
      {iframeSrc && (
        // No CSS transition here: a `transition: opacity` that toggles in the same
        // render as the initial mount can get stuck at its start value if the
        // browser skips a frame before the change (observed live: computed opacity
        // stayed 0 indefinitely despite the inline style already reading 1). An
        // instant, untransitioned flip has no such race.
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          className="w-full h-full border-0"
          style={{ opacity: phase === 'ready' ? 1 : 0 }}
          title="Geminus Base Viewer"
          allow="fullscreen"
        />
      )}
    </div>
  );
});

GeminusBaseV2ViewerPanel.displayName = 'GeminusBaseV2ViewerPanel';
export default GeminusBaseV2ViewerPanel;
