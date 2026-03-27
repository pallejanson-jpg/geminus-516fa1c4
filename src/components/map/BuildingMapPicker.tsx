import React, { useState, useEffect, useCallback, useRef } from 'react';
import Map, { Marker, NavigationControl, GeolocateControl } from 'react-map-gl';
import { MapPin, Loader2, MousePointer, Maximize2, Minimize2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
 * Click on the map to set position, or search by address.
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
  const [isExpanded, setIsExpanded] = useState(false);
  const [addressQuery, setAddressQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Initial view state
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
        if (error) { setError('Could not fetch map token'); return; }
        if (data?.token) { setMapboxToken(data.token); }
        else { setError('Mapbox token is not configured'); }
      } catch { setError('Could not connect to server'); }
      finally { setIsLoading(false); }
    };
    fetchToken();
  }, []);

  // Update view when lat/lng props change
  useEffect(() => {
    if (latitude && longitude) {
      setViewState(prev => ({ ...prev, latitude, longitude, zoom: 14 }));
      setPendingPosition(null);
    }
  }, [latitude, longitude]);

  // Handle map click
  const handleMapClick = useCallback((event: any) => {
    const { lngLat } = event;
    setPendingPosition({ lat: lngLat.lat, lng: lngLat.lng });
    onPositionChange(lngLat.lat, lngLat.lng);
  }, [onPositionChange]);

  // Geocode address using Mapbox Geocoding API
  const handleAddressSearch = useCallback(async () => {
    if (!addressQuery.trim() || !mapboxToken) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const encoded = encodeURIComponent(addressQuery.trim());
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${mapboxToken}&limit=1&language=sv,en`
      );
      const json = await res.json();
      if (json.features && json.features.length > 0) {
        const [lng, lat] = json.features[0].center;
        setPendingPosition({ lat, lng });
        onPositionChange(lat, lng);
        setViewState(prev => ({ ...prev, latitude: lat, longitude: lng, zoom: 16 }));
        setAddressQuery(json.features[0].place_name || addressQuery);
      } else {
        setSearchError('Ingen plats hittades');
      }
    } catch {
      setSearchError('Sökningen misslyckades');
    } finally {
      setIsSearching(false);
    }
  }, [addressQuery, mapboxToken, onPositionChange]);

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

  const markerLat = pendingPosition?.lat ?? latitude;
  const markerLng = pendingPosition?.lng ?? longitude;
  const hasMarker = markerLat !== null && markerLng !== null;
  const mapHeight = isExpanded ? 420 : 200;

  return (
    <div className={cn("relative rounded-lg overflow-hidden border transition-all duration-300", className)}>
      {/* Address search bar */}
      <div className="flex items-center gap-1.5 p-2 bg-card border-b">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          ref={searchInputRef}
          value={addressQuery}
          onChange={(e) => { setAddressQuery(e.target.value); setSearchError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAddressSearch(); }}
          placeholder="Sök adress..."
          className="h-7 text-xs border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
        />
        {addressQuery && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 shrink-0"
            onClick={() => { setAddressQuery(''); setSearchError(null); }}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          className="h-7 px-2 text-xs shrink-0"
          disabled={!addressQuery.trim() || isSearching}
          onClick={handleAddressSearch}
        >
          {isSearching ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Sök'}
        </Button>
      </div>

      {searchError && (
        <div className="px-2 py-1 text-[10px] text-destructive bg-destructive/10">
          {searchError}
        </div>
      )}

      {/* Map */}
      <div className="relative">
        {/* Click instruction + expand button */}
        <div className="absolute top-2 left-2 z-10 bg-card/90 backdrop-blur-sm rounded-md px-2 py-1 flex items-center gap-1.5">
          <MousePointer className="h-3 w-3 text-primary" />
          <span className="text-[10px] text-muted-foreground">Klicka för att sätta position</span>
        </div>

        <Button
          size="icon"
          variant="secondary"
          className="absolute top-2 right-2 z-10 h-7 w-7 bg-card/90 backdrop-blur-sm"
          onClick={() => setIsExpanded(!isExpanded)}
          title={isExpanded ? 'Förminska' : 'Förstora'}
        >
          {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>

        <Map
          {...viewState}
          onMove={(evt) => setViewState(evt.viewState)}
          onClick={handleMapClick}
          style={{ width: '100%', height: mapHeight }}
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
    </div>
  );
};

export default BuildingMapPicker;
