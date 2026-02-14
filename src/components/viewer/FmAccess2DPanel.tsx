/**
 * FmAccess2DPanel — Embeds FM Access 2D viewer in an iframe.
 * Fetches an authenticated viewer URL via the fm-access-query edge function.
 */
import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Square, MapPin, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface FmAccess2DPanelProps {
  buildingFmGuid: string;
  floorId?: string;
  floorName?: string;
  fmAccessBuildingGuid?: string;
  buildingName?: string;
  className?: string;
  onChangeFloor?: () => void;
}

const FmAccess2DPanel: React.FC<FmAccess2DPanelProps> = ({
  buildingFmGuid,
  floorId,
  floorName,
  fmAccessBuildingGuid,
  buildingName,
  className = '',
  onChangeFloor,
}) => {
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // If no floor is selected at all, show a prompt instead of fetching
  const noFloorSelected = !floorId && !floorName;

  useEffect(() => {
    if (noFloorSelected) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchViewerUrl() {
      setLoading(true);
      setError(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke('fm-access-query', {
          body: {
            action: 'get-viewer-url',
            buildingId: buildingFmGuid,
            floorId: floorId || '',
            floorName: floorName || '',
            fmAccessBuildingGuid: fmAccessBuildingGuid || '',
            buildingName: buildingName || '',
          },
        });

        if (cancelled) return;

        if (fnError) {
          setError(fnError.message || 'Kunde inte hämta viewer-URL');
          return;
        }

        if (!data?.success) {
          setError(data?.error || 'FM Access är inte konfigurerat');
          return;
        }

        setViewerUrl(data.url);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Oväntat fel');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchViewerUrl();
    return () => { cancelled = true; };
  }, [buildingFmGuid, floorId, floorName, fmAccessBuildingGuid, buildingName, retryCount, noFloorSelected]);

  // ─── No floor selected state ───────────────────────────────────────
  if (noFloorSelected) {
    return (
      <div className={`flex items-center justify-center h-full bg-background ${className}`}>
        <div className="text-center max-w-sm">
          <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">Ingen våning vald</p>
          <p className="text-xs text-muted-foreground mb-1">
            {buildingName ? `Byggnad: ${buildingName}` : 'Välj en våning för att visa 2D-ritningen.'}
          </p>
          {buildingName && (
            <p className="text-xs text-muted-foreground mb-3">
              Välj en våning i 3D-vyn för att visa ritningen.
            </p>
          )}
          {onChangeFloor && (
            <Button variant="outline" size="sm" onClick={onChangeFloor} className="gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              Välj våning i 3D
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ─── Loading state ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full bg-background ${className}`}>
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Laddar 2D-ritning...</p>
        </div>
      </div>
    );
  }

  // ─── Error state with contextual info ──────────────────────────────
  if (error) {
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
            >
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

  return (
    <div className={`relative h-full w-full bg-background ${className}`}>
      <iframe
        src={viewerUrl || ''}
        className="w-full h-full border-0"
        title="FM Access 2D Viewer"
        allow="fullscreen"
      />
      {/* Small badge to indicate FM Access source */}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-background/80 backdrop-blur-sm rounded px-2 py-1 text-[10px] text-muted-foreground border">
        <Square className="h-3 w-3" />
        FM Access 2D
      </div>
    </div>
  );
};

export default FmAccess2DPanel;
