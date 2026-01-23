import React, { useState, useContext, useCallback, useEffect, useMemo } from 'react';
import Map, { Marker, Popup, NavigationControl, GeolocateControl } from 'react-map-gl';
import { Building2, MapPin, Maximize2, Layers, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { BUILDING_IMAGES, NORDIC_CITIES } from '@/lib/constants';
import { supabase } from '@/integrations/supabase/client';
import 'mapbox-gl/dist/mapbox-gl.css';

type MapFacility = Facility & { lat: number; lng: number };

const MapView: React.FC = () => {
  const { setSelectedFacility, setActiveApp, navigatorTreeData, isLoadingData, allData } = useContext(AppContext);
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewState, setViewState] = useState({
    latitude: 59.0,
    longitude: 15.0,
    zoom: 4.5,
  });
  const [selectedMarker, setSelectedMarker] = useState<MapFacility | null>(null);
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');

  // Convert navigatorTreeData to map facilities with coordinates
  const mapFacilities: MapFacility[] = useMemo(() => {
    return navigatorTreeData.map((building, index) => {
      // Count storeys and spaces
      const storeys = building.children || [];
      const totalSpaces = storeys.reduce((sum: number, storey: any) => {
        return sum + (storey.children?.length || 0);
      }, 0);
      
      // Calculate total area from spaces
      const totalArea = allData
        .filter((a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid)
        .reduce((sum: number, space: any) => sum + (space.grossArea || 0), 0);

      // Assign coordinates from Nordic cities (cycle through them)
      const cityIndex = index % NORDIC_CITIES.length;
      const city = NORDIC_CITIES[cityIndex];

      return {
        fmGuid: building.fmGuid,
        name: building.name,
        commonName: building.commonName,
        category: 'Building',
        image: BUILDING_IMAGES[index % BUILDING_IMAGES.length],
        numberOfLevels: storeys.length,
        numberOfSpaces: totalSpaces,
        area: totalArea,
        address: building.attributes?.address || city.name,
        lat: city.lat + (Math.random() - 0.5) * 0.1, // Small offset for visual separation
        lng: city.lng + (Math.random() - 0.5) * 0.1,
      };
    });
  }, [navigatorTreeData, allData]);

  // Fetch Mapbox token from backend
  useEffect(() => {
    const fetchToken = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        
        if (error) {
          console.error('Error fetching Mapbox token:', error);
          setError('Kunde inte hämta karttoken');
          return;
        }
        
        if (data?.token) {
          setMapboxToken(data.token);
        } else {
          setError('Mapbox token är inte konfigurerad');
        }
      } catch (err) {
        console.error('Failed to fetch Mapbox token:', err);
        setError('Kunde inte ansluta till servern');
      } finally {
        setIsLoading(false);
      }
    };

    fetchToken();
  }, []);

  const handleMarkerClick = useCallback((facility: MapFacility) => {
    setSelectedMarker(facility);
    setViewState(prev => ({
      ...prev,
      latitude: facility.lat,
      longitude: facility.lng,
      zoom: 12,
    }));
  }, []);

  const handleOpenFacility = useCallback((facility: Facility) => {
    setSelectedFacility(facility);
    setActiveApp('portfolio');
  }, [setSelectedFacility, setActiveApp]);

  const toggleMapStyle = useCallback(() => {
    setMapStyle(prev => 
      prev.includes('dark-v11') 
        ? 'mapbox://styles/mapbox/satellite-streets-v12' 
        : 'mapbox://styles/mapbox/dark-v11'
    );
  }, []);

  // Loading state
  if (isLoading || isLoadingData) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Laddar karta...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !mapboxToken) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="text-destructive" />
              {error || 'Mapbox Token saknas'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Kontakta administratören för att konfigurera kartfunktionen.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* Map Controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="icon"
          onClick={toggleMapStyle}
          className="bg-card/90 backdrop-blur-sm shadow-lg"
        >
          <Layers size={18} />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setViewState({ latitude: 59.0, longitude: 15.0, zoom: 4.5 })}
          className="bg-card/90 backdrop-blur-sm shadow-lg"
        >
          <Maximize2 size={18} />
        </Button>
      </div>

      {/* Facility List Sidebar */}
      <div className="absolute top-4 left-4 z-10 w-72 max-h-[calc(100%-2rem)] overflow-hidden">
        <Card className="bg-card/95 backdrop-blur-sm shadow-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 size={16} className="text-primary" />
              Byggnader ({mapFacilities.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto space-y-2 pt-0">
            {mapFacilities.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Inga byggnader laddade
              </p>
            ) : (
              mapFacilities.map((facility) => (
                <div
                  key={facility.fmGuid}
                  onClick={() => handleMarkerClick(facility)}
                  className={`p-2 rounded-md cursor-pointer transition-colors ${
                    selectedMarker?.fmGuid === facility.fmGuid
                      ? 'bg-primary/20 border border-primary/50'
                      : 'bg-muted/50 hover:bg-muted'
                  }`}
                >
                  <p className="text-sm font-medium truncate">{facility.commonName || facility.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{facility.address}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Map */}
      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        mapboxAccessToken={mapboxToken}
      >
        <NavigationControl position="bottom-right" />
        <GeolocateControl position="bottom-right" />

        {/* Markers */}
        {mapFacilities.map((facility) => (
          <Marker
            key={facility.fmGuid}
            latitude={facility.lat}
            longitude={facility.lng}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              handleMarkerClick(facility);
            }}
          >
            <div
              className={`p-2 rounded-full cursor-pointer transition-all ${
                selectedMarker?.fmGuid === facility.fmGuid
                  ? 'bg-primary scale-125 shadow-lg'
                  : 'bg-primary/80 hover:bg-primary hover:scale-110'
              }`}
            >
              <Building2 size={16} className="text-primary-foreground" />
            </div>
          </Marker>
        ))}

        {/* Popup */}
        {selectedMarker && (
          <Popup
            latitude={selectedMarker.lat}
            longitude={selectedMarker.lng}
            anchor="top"
            onClose={() => setSelectedMarker(null)}
            closeOnClick={false}
            className="map-popup"
          >
            <Card className="border-0 shadow-none bg-transparent">
              <CardContent className="p-0">
                {selectedMarker.image && (
                  <img
                    src={selectedMarker.image}
                    alt={selectedMarker.name}
                    className="w-full h-24 object-cover rounded-t-md"
                  />
                )}
                <div className="p-3">
                  <h3 className="font-semibold text-foreground">{selectedMarker.commonName || selectedMarker.name}</h3>
                  <p className="text-xs text-muted-foreground mb-2">{selectedMarker.address}</p>
                  <div className="flex gap-2 mb-3">
                    <Badge variant="secondary" className="text-xs">
                      {selectedMarker.numberOfLevels} våningar
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {selectedMarker.area?.toLocaleString()} m²
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleOpenFacility(selectedMarker)}
                  >
                    Visa detaljer
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Popup>
        )}
      </Map>
    </div>
  );
};

export default MapView;