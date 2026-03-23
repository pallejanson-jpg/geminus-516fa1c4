import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { supabase } from '@/integrations/supabase/client';
import { Map as MapIcon, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface StreetViewMiniMapProps {
  lng: number;
  lat: number;
  heading: number; // degrees
  buildingLng: number;
  buildingLat: number;
  buildingName: string;
}

const StreetViewMiniMap: React.FC<StreetViewMiniMapProps> = ({
  lng, lat, heading, buildingLng, buildingLat, buildingName,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const buildingMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Fetch Mapbox token
  useEffect(() => {
    supabase.functions.invoke('get-mapbox-token').then(({ data }) => {
      if (data?.token) setToken(data.token);
    });
  }, []);

  // Init map
  useEffect(() => {
    if (!token || !mapContainer.current || collapsed) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [lng, lat],
      zoom: 17,
      interactive: false,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('load', () => {
      // Create heading cone element
      const el = document.createElement('div');
      el.className = 'sv-minimap-marker';
      el.innerHTML = `
        <div style="position:relative;width:28px;height:28px;">
          <div class="sv-heading-cone" style="
            position:absolute;top:-18px;left:50%;transform:translateX(-50%) rotate(${heading}deg);
            width:0;height:0;
            border-left:10px solid transparent;
            border-right:10px solid transparent;
            border-bottom:18px solid hsl(var(--primary) / 0.5);
            transform-origin:center bottom;
          "></div>
          <div style="
            width:12px;height:12px;border-radius:50%;
            background:hsl(var(--primary));
            border:2px solid white;
            position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
            box-shadow:0 0 6px hsl(var(--primary) / 0.6);
          "></div>
        </div>
      `;

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map);
      markerRef.current = marker;

      // Building marker
      const bEl = document.createElement('div');
      bEl.style.cssText = 'width:10px;height:10px;border-radius:50%;background:hsl(0 84% 60%);border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.4);';
      const bMarker = new mapboxgl.Marker({ element: bEl, anchor: 'center' })
        .setLngLat([buildingLng, buildingLat])
        .addTo(map);
      buildingMarkerRef.current = bMarker;
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      buildingMarkerRef.current = null;
    };
  }, [token, collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update position and heading
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;

    markerRef.current.setLngLat([lng, lat]);
    mapRef.current.setCenter([lng, lat]);

    // Update heading cone rotation
    const cone = markerRef.current.getElement().querySelector('.sv-heading-cone') as HTMLElement;
    if (cone) {
      cone.style.transform = `translateX(-50%) rotate(${heading}deg)`;
    }
  }, [lng, lat, heading]);

  if (!token) return null;

  if (collapsed) {
    return (
      <Button
        variant="secondary"
        size="icon"
        className="absolute bottom-4 left-4 z-30 h-8 w-8 rounded-md shadow-lg bg-card/90 backdrop-blur-sm"
        onClick={() => setCollapsed(false)}
        title="Visa minikarta"
      >
        <MapIcon size={14} />
      </Button>
    );
  }

  return (
    <div className="absolute bottom-4 left-4 z-30 rounded-lg overflow-hidden shadow-xl border border-border bg-card">
      <div className="relative">
        <div
          ref={mapContainer}
          className="w-36 h-36 sm:w-44 sm:h-44"
        />
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1 right-1 h-5 w-5 bg-background/60 backdrop-blur-sm hover:bg-background/80 rounded"
          onClick={() => setCollapsed(true)}
        >
          <Minimize2 size={10} />
        </Button>
        {/* Building label */}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-background/80 to-transparent px-1.5 py-1">
          <span className="text-[9px] text-foreground font-medium truncate block">{buildingName}</span>
        </div>
      </div>
    </div>
  );
};

export default StreetViewMiniMap;
