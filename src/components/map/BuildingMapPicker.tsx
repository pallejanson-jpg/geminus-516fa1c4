import React, { useState, useEffect, useCallback } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl } from 'react-map-gl';
import { MapPin, Loader2, MousePointer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import 'mapbox-gl/dist/mapbox-gl.css';

interface BuildingMapPickerProps {
  latitude: number | null;
  longitude: number | null;
  onPositionChange: (lat: number, lng: number) => void;
  className?: string;
}

/**
 * Interactive map picker for setting building coordinates.
 * Click on the map to set position.
 */
const BuildingMapPicker: React.FC<BuildingMapPickerProps> = ({
  latitude,
  longitude,
  onPositionChange,
  className,
}) => {
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingPosition, setPendingPosition] = useState<{ lat: number; lng: number } | null>(null);
  
  // Initial view state - center on current position or default Nordic location
  const [viewState, setViewState] = useState({
    latitude: latitude || 59.3293,
    longitude: longitude || 18.0686,
    zoom: latitude && longitude ? 14 : 5,
  });

  // Fetch Mapbox token
  useEffect(() => {
    const fetchToken = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        
        if (error) {
          console.error('Error fetching Mapbox token:', error);
          setError('Could not fetch map token');
          return;
        }
        
        if (data?.token) {
          setMapboxToken(data.token);
        } else {
          setError('Mapbox token is not configured');
        }
      } catch (err) {
        console.error('Failed to fetch Mapbox token:', err);
        setError('Could not connect to server');
      } finally {
        setIsLoading(false);
      }
    };

    fetchToken();
  }, []);

  // Update view when lat/lng props change
  useEffect(() => {
    if (latitude && longitude) {
      setViewState(prev => ({
        ...prev,
        latitude,
        longitude,
        zoom: 14,
      }));
      setPendingPosition(null);
    }
  }, [latitude, longitude]);

  // Handle map click to set position
  const handleMapClick = useCallback((event: any) => {
    const { lngLat } = event;
    setPendingPosition({ lat: lngLat.lat, lng: lngLat.lng });
    onPositionChange(lngLat.lat, lngLat.lng);
  }, [onPositionChange]);

  // Loading state
  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center h-60 bg-muted/30 rounded-lg", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (error || !mapboxToken) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-60 bg-muted/30 rounded-lg text-center p-4", className)}>
        <MapPin className="h-6 w-6 text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">{error || 'Map not available'}</p>
      </div>
    );
  }

  // Determine which position to show
  const markerLat = pendingPosition?.lat ?? latitude;
  const markerLng = pendingPosition?.lng ?? longitude;
  const hasMarker = markerLat !== null && markerLng !== null;

  return (
    <div className={cn("relative rounded-lg overflow-hidden border", className)}>
      {/* Click instruction overlay */}
      <div className="absolute top-2 left-2 z-10 bg-card/90 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5">
        <MousePointer className="h-3 w-3 text-primary" />
        <span className="text-[10px] text-muted-foreground">Klicka för att sätta position</span>
      </div>

      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        onClick={handleMapClick}
        style={{ width: '100%', height: 200 }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        mapboxAccessToken={mapboxToken}
        cursor="crosshair"
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        <GeolocateControl 
          position="bottom-right" 
          showUserLocation={false}
          showAccuracyCircle={false}
          onGeolocate={(e) => {
            const { latitude: lat, longitude: lng } = e.coords;
            setPendingPosition({ lat, lng });
            onPositionChange(lat, lng);
          }}
        />

        {/* Marker for current/pending position */}
        {hasMarker && (
          <Marker latitude={markerLat!} longitude={markerLng!} anchor="bottom">
            <div className="relative">
              <MapPin 
                className={cn(
                  "h-8 w-8 drop-shadow-lg transition-colors",
                  pendingPosition ? "text-primary animate-bounce" : "text-accent"
                )} 
                fill={pendingPosition ? "currentColor" : "none"}
              />
              {pendingPosition && (
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap">
                  <span className="text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded">
                    Ny position
                  </span>
                </div>
              )}
            </div>
          </Marker>
        )}
      </Map>
    </div>
  );
};

export default BuildingMapPicker;
