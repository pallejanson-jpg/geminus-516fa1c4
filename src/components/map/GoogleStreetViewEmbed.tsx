import React, { useEffect, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/context/LanguageContext';

interface GoogleStreetViewEmbedProps {
  lat: number;
  lng: number;
  buildingName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type EmbedState = { status: 'loading' } | { status: 'ready'; key: string } | { status: 'unavailable' };

/**
 * Google's own Street View, embedded directly in-app via the Maps Embed API
 * iframe — free, no per-request billing. Kept as a separate path from the
 * Cesium-based 3D panorama (StreetViewOverlay): that one renders the same
 * underlying Street View imagery through Cesium's engine so it can share a
 * camera with the 3D globe, this one is the simpler, more reliable official
 * widget for when that isn't needed.
 *
 * Only a *direct* Google Maps API key (get-streetview-key's "direct" source,
 * from the GOOGLE_STREET_VIEW_API_KEY secret) works here — the Cesium ion
 * fallback key is a short-lived JWT scoped to ion's own proxy endpoint and is
 * not accepted by maps.google.com/maps/embed.
 */
const GoogleStreetViewEmbed: React.FC<GoogleStreetViewEmbedProps> = ({
  lat, lng, buildingName, open, onOpenChange,
}) => {
  const { t } = useLanguage();
  const [state, setState] = useState<EmbedState>({ status: 'loading' });

  useEffect(() => {
    if (!open) return;
    setState({ status: 'loading' });
    supabase.functions.invoke('get-streetview-key').then(({ data, error }) => {
      if (!error && data?.key && data?.source === 'direct') {
        setState({ status: 'ready', key: data.key });
      } else {
        setState({ status: 'unavailable' });
      }
    });
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="p-0 overflow-hidden flex flex-col gap-0">
        <DialogHeader className="p-3 pb-2 border-b border-border/50 shrink-0">
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <Eye size={14} className="text-primary" />
            {t('Gatuvy', 'Street View')} — {buildingName}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 relative bg-muted min-h-0">
          {state.status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
          )}
          {state.status === 'ready' && (
            <iframe
              title="Google Street View"
              className="absolute inset-0 w-full h-full border-0"
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://www.google.com/maps/embed/v1/streetview?key=${state.key}&location=${lat},${lng}`}
            />
          )}
          {state.status === 'unavailable' && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="text-sm text-muted-foreground max-w-sm">
                {t(
                  'Ingen Google Maps API-nyckel konfigurerad. Lägg till GOOGLE_STREET_VIEW_API_KEY som Supabase-secret (med Maps Embed API aktiverat) för att aktivera detta.',
                  'No Google Maps API key configured. Add GOOGLE_STREET_VIEW_API_KEY as a Supabase secret (with Maps Embed API enabled) to enable this.'
                )}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GoogleStreetViewEmbed;
