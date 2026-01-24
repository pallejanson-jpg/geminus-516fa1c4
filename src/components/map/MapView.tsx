import React, { useState, useContext, useCallback, useEffect, useMemo } from 'react';
import Map, { Marker, Popup, NavigationControl, GeolocateControl } from 'react-map-gl';
import { Building2, MapPin, Maximize2, Layers, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { BUILDING_IMAGES, NORDIC_CITIES } from '@/lib/constants';
import { supabase } from '@/integrations/supabase/client';
import 'mapbox-gl/dist/mapbox-gl.css';

type MapFacility = Facility & { lat: number; lng: number };

// Collapsible building sidebar component for mobile responsiveness
const BuildingSidebar: React.FC<{
  facilities: MapFacility[];
  selectedMarker: MapFacility | null;
  onMarkerClick: (facility: MapFacility) => void;
}> = ({ facilities, selectedMarker, onMarkerClick }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="absolute top-3 sm:top-4 left-3 sm:left-4 z-10 w-[calc(100%-1.5rem)] sm:w-72 max-h-[calc(100%-1.5rem)] sm:max-h-[calc(100%-2rem)]">
      <Card className="bg-card/95 backdrop-blur-sm shadow-xl">
        <CardHeader 
          className="pb-2 cursor-pointer sm:cursor-default p-3 sm:p-4"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <CardTitle className="text-xs sm:text-sm flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Building2 size={14} className="sm:w-4 sm:h-4 text-primary" />
              Buildings ({facilities.length})
            </span>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 sm:hidden"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent 
          className={`overflow-y-auto space-y-2 pt-0 px-3 sm:px-4 pb-3 sm:pb-4 transition-all duration-200 ${
            isExpanded ? 'max-h-48 sm:max-h-60' : 'max-h-0 sm:max-h-80'
          } ${!isExpanded && 'hidden sm:block'}`}
        >
          {facilities.length === 0 ? (
            <p className="text-xs sm:text-sm text-muted-foreground py-4 text-center">
              No buildings loaded
            </p>
          ) : (
            facilities.map((facility) => (
              <div
                key={facility.fmGuid}
                onClick={() => onMarkerClick(facility)}
                className={`p-2 rounded-md cursor-pointer transition-colors ${
                  selectedMarker?.fmGuid === facility.fmGuid
                    ? 'bg-primary/20 border border-primary/50'
                    : 'bg-muted/50 hover:bg-muted'
                }`}
              >
                <p className="text-xs sm:text-sm font-medium truncate">{facility.commonName || facility.name}</p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{facility.address}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

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
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading map...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !mapboxToken) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <MapPin className="text-destructive" />
              {error || 'Mapbox Token Missing'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Contact the administrator to configure the map functionality.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* Map Controls */}
      <div className="absolute top-3 sm:top-4 right-3 sm:right-4 z-10 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="icon"
          onClick={toggleMapStyle}
          className="h-8 w-8 sm:h-9 sm:w-9 bg-card/90 backdrop-blur-sm shadow-lg"
        >
          <Layers size={16} className="sm:w-[18px] sm:h-[18px]" />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setViewState({ latitude: 59.0, longitude: 15.0, zoom: 4.5 })}
          className="h-8 w-8 sm:h-9 sm:w-9 bg-card/90 backdrop-blur-sm shadow-lg"
        >
          <Maximize2 size={16} className="sm:w-[18px] sm:h-[18px]" />
        </Button>
      </div>

      {/* Facility List Sidebar - Collapsible on mobile */}
      <BuildingSidebar 
        facilities={mapFacilities}
        selectedMarker={selectedMarker}
        onMarkerClick={handleMarkerClick}
      />

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
              className={`p-1.5 sm:p-2 rounded-full cursor-pointer transition-all ${
                selectedMarker?.fmGuid === facility.fmGuid
                  ? 'bg-primary scale-125 shadow-lg'
                  : 'bg-primary/80 hover:bg-primary hover:scale-110'
              }`}
            >
              <Building2 size={14} className="sm:w-4 sm:h-4 text-primary-foreground" />
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
                    className="w-full h-20 sm:h-24 object-cover rounded-t-md"
                  />
                )}
                <div className="p-2 sm:p-3">
                  <h3 className="font-semibold text-sm text-foreground">{selectedMarker.commonName || selectedMarker.name}</h3>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mb-2">{selectedMarker.address}</p>
                  <div className="flex gap-2 mb-2 sm:mb-3">
                    <Badge variant="secondary" className="text-[10px] sm:text-xs">
                      {selectedMarker.numberOfLevels} floors
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] sm:text-xs">
                      {selectedMarker.area?.toLocaleString()} m²
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    className="w-full text-xs sm:text-sm"
                    onClick={() => handleOpenFacility(selectedMarker)}
                  >
                    View details
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
