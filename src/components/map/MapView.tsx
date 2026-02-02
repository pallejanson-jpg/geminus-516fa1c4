import React, { useState, useContext, useCallback, useEffect, useMemo, useRef } from 'react';
import Map, { Popup, NavigationControl, GeolocateControl } from 'react-map-gl';
import { Building2, MapPin, Maximize2, Layers, Loader2, ChevronDown, ChevronUp, Search, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AppContext } from '@/context/AppContext';
import { Facility } from '@/lib/types';
import { BUILDING_IMAGES, NORDIC_CITIES } from '@/lib/constants';
import { supabase } from '@/integrations/supabase/client';
import { ClusterMarker, SingleMarker } from './MapCluster';
import Supercluster from 'supercluster';
import {
  MapColoringMode,
  BuildingMetrics,
  getBuildingColor,
  generateMockBuildingMetrics,
  COLORING_MODE_LABELS,
  COLORING_MODE_LEGENDS,
} from '@/lib/map-coloring-utils';
import 'mapbox-gl/dist/mapbox-gl.css';

type MapFacility = Facility & { lat: number; lng: number };

interface ClusterProperties {
  cluster: boolean;
  point_count?: number;
  facility?: MapFacility;
}

interface BuildingCoordinates {
  fm_guid: string;
  latitude: number | null;
  longitude: number | null;
}

// Collapsible building sidebar component for mobile responsiveness
const BuildingSidebar: React.FC<{
  facilities: MapFacility[];
  selectedMarker: MapFacility | null;
  onMarkerClick: (facility: MapFacility) => void;
}> = ({ facilities, selectedMarker, onMarkerClick }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter facilities based on search query
  const filteredFacilities = useMemo(() => {
    if (!searchQuery.trim()) return facilities;
    const query = searchQuery.toLowerCase();
    return facilities.filter(f => 
      (f.commonName || f.name || '').toLowerCase().includes(query) ||
      (f.address || '').toLowerCase().includes(query)
    );
  }, [facilities, searchQuery]);

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
          {/* Search input */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search buildings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
          
          {filteredFacilities.length === 0 ? (
            <p className="text-xs sm:text-sm text-muted-foreground py-4 text-center">
              {searchQuery ? 'No matching buildings' : 'No buildings loaded'}
            </p>
          ) : (
            filteredFacilities.map((facility) => (
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

// Legend component for coloring modes
const ColoringLegend: React.FC<{ mode: MapColoringMode }> = ({ mode }) => {
  if (mode === 'none') return null;
  
  const legend = COLORING_MODE_LEGENDS[mode];
  if (!legend) return null;

  return (
    <div className="absolute bottom-20 right-3 sm:right-4 z-10">
      <Card className="bg-card/95 backdrop-blur-sm shadow-lg">
        <CardContent className="p-2 sm:p-3">
          <p className="text-[10px] sm:text-xs font-medium mb-2 text-muted-foreground">
            {COLORING_MODE_LABELS[mode]}
          </p>
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            {legend.map((item) => (
              <div key={item.label} className="flex items-center gap-1">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[10px] sm:text-xs">{item.label}</span>
              </div>
            ))}
          </div>
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
  const [buildingCoordinates, setBuildingCoordinates] = useState<BuildingCoordinates[]>([]);
  const [coloringMode, setColoringMode] = useState<MapColoringMode>('none');
  const mapRef = useRef<any>(null);

  // Fetch saved building coordinates from database
  useEffect(() => {
    const fetchBuildingCoordinates = async () => {
      try {
        const { data, error } = await supabase
          .from('building_settings')
          .select('fm_guid, latitude, longitude');
        
        if (!error && data) {
          setBuildingCoordinates(data);
        }
      } catch (e) {
        console.debug('Failed to fetch building coordinates:', e);
      }
    };
    
    fetchBuildingCoordinates();
  }, []);

  // Convert navigatorTreeData to map facilities with coordinates
  // Prioritize saved coordinates from building_settings
  const mapFacilities: MapFacility[] = useMemo(() => {
    // Create lookup map for saved coordinates
    const coordsLookup: Record<string, { lat: number; lng: number }> = {};
    buildingCoordinates.forEach(bc => {
      if (bc.latitude !== null && bc.longitude !== null) {
        coordsLookup[bc.fm_guid.toLowerCase()] = { lat: bc.latitude, lng: bc.longitude };
      }
    });

    return navigatorTreeData.map((building, index) => {
      // Count storeys and spaces
      const storeys = building.children || [];
      const totalSpaces = storeys.reduce((sum: number, storey: any) => {
        return sum + (storey.children?.length || 0);
      }, 0);
      
      // Calculate total area from spaces - use NTA/area attributes
      const totalArea = allData
        .filter((a: any) => a.category === 'Space' && a.buildingFmGuid === building.fmGuid)
        .reduce((sum: number, space: any) => {
          const attrs = space.attributes || {};
          let areaValue = 0;
          
          const ntaKey = Object.keys(attrs).find(k => k.toLowerCase().startsWith('nta'));
          if (ntaKey && attrs[ntaKey]) {
            areaValue = Number(attrs[ntaKey]) || 0;
          } else if (attrs.area) {
            areaValue = Number(attrs.area) || 0;
          } else if (space.grossArea) {
            areaValue = Number(space.grossArea) || 0;
          }
          
          return sum + areaValue;
        }, 0);

      // Check for saved coordinates first
      const savedCoords = coordsLookup[building.fmGuid.toLowerCase()];
      
      let lat: number;
      let lng: number;
      let address: string;
      
      if (savedCoords) {
        // Use saved coordinates
        lat = savedCoords.lat;
        lng = savedCoords.lng;
        address = building.attributes?.address || 'Custom Location';
      } else {
        // Fallback to Nordic cities (cycle through them)
        const cityIndex = index % NORDIC_CITIES.length;
        const city = NORDIC_CITIES[cityIndex];
        lat = city.lat + (Math.random() - 0.5) * 0.1;
        lng = city.lng + (Math.random() - 0.5) * 0.1;
        address = building.attributes?.address || city.name;
      }

      return {
        fmGuid: building.fmGuid,
        name: building.name,
        commonName: building.commonName,
        category: 'Building',
        image: BUILDING_IMAGES[index % BUILDING_IMAGES.length],
        numberOfLevels: storeys.length,
        numberOfSpaces: totalSpaces,
        area: Math.round(totalArea),
        address,
        lat,
        lng,
      };
    });
  }, [navigatorTreeData, allData, buildingCoordinates]);

  // Generate metrics for all buildings
  const buildingMetricsMap = useMemo(() => {
    const map: Record<string, BuildingMetrics> = {};
    mapFacilities.forEach(f => {
      map[f.fmGuid] = generateMockBuildingMetrics(f.fmGuid, f.area || 0);
    });
    return map;
  }, [mapFacilities]);

  // Create supercluster instance
  const supercluster = useMemo(() => {
    const cluster = new Supercluster<ClusterProperties>({
      radius: 60,
      maxZoom: 16,
    });

    const points = mapFacilities.map(facility => ({
      type: 'Feature' as const,
      properties: {
        cluster: false,
        facility,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [facility.lng, facility.lat],
      },
    }));

    cluster.load(points);
    return cluster;
  }, [mapFacilities]);

  // Get clusters for current viewport
  const clusters = useMemo(() => {
    const bounds: [number, number, number, number] = [
      viewState.longitude - 180 / Math.pow(2, viewState.zoom),
      viewState.latitude - 90 / Math.pow(2, viewState.zoom),
      viewState.longitude + 180 / Math.pow(2, viewState.zoom),
      viewState.latitude + 90 / Math.pow(2, viewState.zoom),
    ];

    return supercluster.getClusters(bounds, Math.floor(viewState.zoom));
  }, [supercluster, viewState]);

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

  const handleClusterClick = useCallback((clusterId: number, longitude: number, latitude: number) => {
    const expansionZoom = Math.min(supercluster.getClusterExpansionZoom(clusterId), 16);
    setViewState(prev => ({
      ...prev,
      longitude,
      latitude,
      zoom: expansionZoom,
    }));
    setSelectedMarker(null);
  }, [supercluster]);

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
        {/* Coloring mode dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className={`h-8 w-8 sm:h-9 sm:w-9 bg-card/90 backdrop-blur-sm shadow-lg ${
                coloringMode !== 'none' ? 'ring-2 ring-primary' : ''
              }`}
            >
              <Palette size={16} className="sm:w-[18px] sm:h-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Color markers by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup 
              value={coloringMode} 
              onValueChange={(v) => setColoringMode(v as MapColoringMode)}
            >
              {(Object.keys(COLORING_MODE_LABELS) as MapColoringMode[]).map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  {COLORING_MODE_LABELS[mode]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

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

      {/* Color legend */}
      <ColoringLegend mode={coloringMode} />

      {/* Map */}
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        mapboxAccessToken={mapboxToken}
      >
        <NavigationControl position="bottom-right" />
        <GeolocateControl position="bottom-right" />

        {/* Render clusters and markers */}
        {clusters.map((cluster) => {
          const [longitude, latitude] = cluster.geometry.coordinates;
          const { cluster: isCluster, point_count: pointCount } = cluster.properties;

          if (isCluster) {
            return (
              <ClusterMarker
                key={`cluster-${cluster.id}`}
                longitude={longitude}
                latitude={latitude}
                pointCount={pointCount || 0}
                totalPoints={mapFacilities.length}
                onClick={() => handleClusterClick(cluster.id as number, longitude, latitude)}
              />
            );
          }

          const facility = cluster.properties.facility!;
          const metrics = buildingMetricsMap[facility.fmGuid];
          const markerColor = coloringMode !== 'none' && metrics 
            ? getBuildingColor(metrics, coloringMode) 
            : undefined;

          return (
            <SingleMarker
              key={facility.fmGuid}
              longitude={longitude}
              latitude={latitude}
              name={facility.commonName || facility.name || ''}
              onClick={() => handleMarkerClick(facility)}
              isSelected={selectedMarker?.fmGuid === facility.fmGuid}
              color={markerColor}
            />
          );
        })}

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
            <Card className="border-0 shadow-xl bg-black/95 backdrop-blur-sm">
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
