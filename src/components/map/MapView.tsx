import React, { useState, useContext, useCallback } from 'react';
import Map, { Marker, Popup, NavigationControl, GeolocateControl } from 'react-map-gl';
import { Building2, MapPin, Maximize2, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { NORDIC_CITIES, BUILDING_IMAGES } from '@/lib/constants';
import 'mapbox-gl/dist/mapbox-gl.css';

// Mapbox public access token - stored as environment variable
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';

// Mock facilities with coordinates for demo
const MOCK_MAP_FACILITIES: (Facility & { lat: number; lng: number })[] = [
  {
    fmGuid: '1',
    name: 'Kontorshus Centrum',
    commonName: 'Kontorshus Centrum',
    category: 'Building',
    address: 'Storgatan 1, Stockholm',
    image: BUILDING_IMAGES[0],
    numberOfLevels: 8,
    numberOfSpaces: 156,
    area: 12500,
    lat: 59.3293,
    lng: 18.0686,
  },
  {
    fmGuid: '2',
    name: 'Kv. Björken',
    commonName: 'Kv. Björken',
    category: 'Building',
    address: 'Björkvägen 23, Göteborg',
    image: BUILDING_IMAGES[1],
    numberOfLevels: 5,
    numberOfSpaces: 84,
    area: 7800,
    lat: 57.7089,
    lng: 11.9746,
  },
  {
    fmGuid: '3',
    name: 'Lagerlokaler Syd',
    commonName: 'Lagerlokaler Syd',
    category: 'Building',
    address: 'Industrivägen 45, Malmö',
    image: BUILDING_IMAGES[2],
    numberOfLevels: 2,
    numberOfSpaces: 12,
    area: 15200,
    lat: 55.6049,
    lng: 13.0038,
  },
  {
    fmGuid: '4',
    name: 'Oslo Kontor',
    commonName: 'Oslo Kontor',
    category: 'Building',
    address: 'Karl Johans gate 15, Oslo',
    image: BUILDING_IMAGES[3],
    numberOfLevels: 6,
    numberOfSpaces: 92,
    area: 9200,
    lat: 59.9139,
    lng: 10.7522,
  },
  {
    fmGuid: '5',
    name: 'Helsingfors Center',
    commonName: 'Helsingfors Center',
    category: 'Building',
    address: 'Mannerheimintie 10, Helsinki',
    image: BUILDING_IMAGES[4],
    numberOfLevels: 7,
    numberOfSpaces: 120,
    area: 11000,
    lat: 60.1699,
    lng: 24.9384,
  },
];

const MapView: React.FC = () => {
  const { setSelectedFacility, setActiveApp } = useContext(AppContext);
  const [viewState, setViewState] = useState({
    latitude: 59.0,
    longitude: 15.0,
    zoom: 4.5,
  });
  const [selectedMarker, setSelectedMarker] = useState<typeof MOCK_MAP_FACILITIES[0] | null>(null);
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');

  const handleMarkerClick = useCallback((facility: typeof MOCK_MAP_FACILITIES[0]) => {
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

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="text-destructive" />
              Mapbox Token saknas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              För att använda kartvyn behöver du en Mapbox access token. 
              Lägg till VITE_MAPBOX_ACCESS_TOKEN i projektets miljövariabler.
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
              Fastigheter ({MOCK_MAP_FACILITIES.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto space-y-2 pt-0">
            {MOCK_MAP_FACILITIES.map((facility) => (
              <div
                key={facility.fmGuid}
                onClick={() => handleMarkerClick(facility)}
                className={`p-2 rounded-md cursor-pointer transition-colors ${
                  selectedMarker?.fmGuid === facility.fmGuid
                    ? 'bg-primary/20 border border-primary/50'
                    : 'bg-muted/50 hover:bg-muted'
                }`}
              >
                <p className="text-sm font-medium truncate">{facility.name}</p>
                <p className="text-xs text-muted-foreground truncate">{facility.address}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Map */}
      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        mapboxAccessToken={MAPBOX_TOKEN}
      >
        <NavigationControl position="bottom-right" />
        <GeolocateControl position="bottom-right" />

        {/* Markers */}
        {MOCK_MAP_FACILITIES.map((facility) => (
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
                  <h3 className="font-semibold text-foreground">{selectedMarker.name}</h3>
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
