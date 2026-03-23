import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface StreetViewThumbnailProps {
  lat: number;
  lng: number;
  heading?: number;
  apiKey: string;
}

const StreetViewThumbnail: React.FC<StreetViewThumbnailProps> = ({
  lat, lng, heading = 0, apiKey,
}) => {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const thumbUrl = `https://maps.googleapis.com/maps/api/streetview?size=160x90&location=${lat},${lng}&heading=${Math.round(heading)}&fov=90&key=${apiKey}`;
  const largeUrl = `https://maps.googleapis.com/maps/api/streetview?size=640x400&location=${lat},${lng}&heading=${Math.round(heading)}&fov=90&key=${apiKey}`;

  if (failed) return null;

  return (
    <>
      <button
        className="relative w-full h-[45px] rounded overflow-hidden border border-border/50 hover:border-primary/40 transition-colors group mt-0.5"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Visa Street View"
      >
        <img
          src={thumbUrl}
          alt="Street View"
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
          <Eye size={14} className="text-white opacity-0 group-hover:opacity-80 transition-opacity drop-shadow" />
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-2xl p-0 overflow-hidden">
          <DialogHeader className="p-3 pb-0">
            <DialogTitle className="text-sm">Street View</DialogTitle>
          </DialogHeader>
          <div className="p-3 pt-1">
            <img
              src={largeUrl}
              alt="Street View"
              className="w-full rounded-md"
              onError={() => setFailed(true)}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {lat.toFixed(5)}, {lng.toFixed(5)} · heading {Math.round(heading)}°
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default StreetViewThumbnail;
