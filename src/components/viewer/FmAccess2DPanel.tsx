/**
 * FmAccess2DPanel — Embeds FM Access 2D viewer in an iframe.
 * Fetches an authenticated viewer URL via the fm-access-query edge function.
 */
import React, { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface FmAccess2DPanelProps {
  buildingFmGuid: string;
  floorId?: string;
  className?: string;
}

const FmAccess2DPanel: React.FC<FmAccess2DPanelProps> = ({
  buildingFmGuid,
  floorId,
  className = '',
}) => {
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [buildingFmGuid, floorId]);

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

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full bg-background ${className}`}>
        <div className="text-center max-w-sm">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground mb-1">Kunde inte ladda 2D-vy</p>
          <p className="text-xs text-muted-foreground mb-3">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              setError(null);
              // Re-trigger effect
              setViewerUrl(null);
            }}
          >
            Försök igen
          </Button>
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
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
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
