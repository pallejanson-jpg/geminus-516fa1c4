import React, { useState, useContext, useCallback, useEffect, useMemo, useRef } from 'react';
import Map, { Popup, NavigationControl, GeolocateControl } from 'react-map-gl';
import { MapPin, Maximize2, Layers, Loader2, Palette, ArrowLeft } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { supabase } from '@/integrations/supabase/client';
import { ClusterMarker, SingleMarker } from './MapCluster';
import BuildingSidebar from './BuildingSidebar';
import Supercluster from 'supercluster';
import {
  MapColoringMode,
  BuildingMetrics,
  getBuildingColor,
  generateMockBuildingMetrics,
  COLORING_MODE_LABELS,
  COLORING_MODE_LEGENDS,
} from '@/lib/map-coloring-utils';
import { useMapFacilities, MapFacility } from '@/hooks/useMapFacilities';
import 'mapbox-gl/dist/mapbox-gl.css';

interface ClusterProperties {
  cluster: boolean;
  point_count?: number;
  facility?: MapFacility;
}

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
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[10px] sm:text-xs">{item.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

interface MapViewProps {
  initialColoringMode?: MapColoringMode;
  hideSidebar?: boolean;
  compact?: boolean;
  externalColoringMode?: MapColoringMode;
}

const MapView: React.FC<MapViewProps> = ({ initialColoringMode = 'none', hideSidebar, compact, externalColoringMode }) => {
  const { setSelectedFacility, setActiveApp, isLoadingData } = useContext(AppContext);
  const isMobile = useIsMobile();
  const { facilities: mapFacilities } = useMapFacilities();

  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewState, setViewState] = useState({ latitude: 59.0, longitude: 15.0, zoom: 4.5 });
  const [selectedMarker, setSelectedMarker] = useState<MapFacility | null>(null);
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');
  const [coloringMode, setColoringMode] = useState<MapColoringMode>(initialColoringMode);
  const effectiveColoringMode = externalColoringMode ?? coloringMode;
  const mapRef = useRef<any>(null);

  // Build sidebar items from facilities
  const sidebarItems = useMemo(() =>
    mapFacilities.map(f => ({
      id: f.fmGuid!,
      displayName: f.displayName,
      address: f.address || '',
    })),
    [mapFacilities],
  );

  // Generate metrics for all buildings
  const buildingMetricsMap = useMemo(() => {
    const map: Record<string, BuildingMetrics> = {};
    mapFacilities.forEach(f => {
      map[f.fmGuid!] = generateMockBuildingMetrics(f.fmGuid!, f.area || 0);
    });
    return map;
  }, [mapFacilities]);

  // Create supercluster instance
  const supercluster = useMemo(() => {
    const cluster = new Supercluster<ClusterProperties>({ radius: 60, maxZoom: 16 });
    const points = mapFacilities.map(facility => ({
      type: 'Feature' as const,
      properties: { cluster: false, facility },
      geometry: { type: 'Point' as const, coordinates: [facility.lng, facility.lat] },
    }));
    cluster.load(points);
    return cluster;
  }, [mapFacilities]);

  // Get clusters for current viewport
  const clusters = useMemo(() => {
    let bounds: [number, number, number, number];
    const mapInstance = mapRef.current?.getMap?.();
    if (mapInstance) {
      try {
        const b = mapInstance.getBounds();
        bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      } catch {
        const pad = 2.0;
        const lonDelta = (180 / Math.pow(2, viewState.zoom)) * pad;
        const latDelta = (90 / Math.pow(2, viewState.zoom)) * pad;
        bounds = [viewState.longitude - lonDelta, viewState.latitude - latDelta, viewState.longitude + lonDelta, viewState.latitude + latDelta];
      }
    } else {
      const pad = 2.0;
      const lonDelta = (180 / Math.pow(2, viewState.zoom)) * pad;
      const latDelta = (90 / Math.pow(2, viewState.zoom)) * pad;
      bounds = [viewState.longitude - lonDelta, viewState.latitude - latDelta, viewState.longitude + lonDelta, viewState.latitude + latDelta];
    }
    return supercluster.getClusters(bounds, Math.floor(viewState.zoom));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supercluster, viewState, coloringMode, externalColoringMode]);

  // Fetch Mapbox token
  useEffect(() => {
    supabase.functions.invoke('get-mapbox-token').then(({ data, error }) => {
      if (!error && data?.token) setMapboxToken(data.token);
      else setError(error?.message || 'Mapbox token is not configured');
      setIsLoading(false);
    });
  }, []);

  const handleMarkerClick = useCallback((facility: MapFacility) => {
    setSelectedMarker(facility);
    setViewState(prev => ({ ...prev, latitude: facility.lat, longitude: facility.lng, zoom: 12 }));
  }, []);

  const handleSidebarSelect = useCallback((id: string) => {
    const f = mapFacilities.find(f => f.fmGuid === id);
    if (f) handleMarkerClick(f);
  }, [mapFacilities, handleMarkerClick]);

  const handleClusterClick = useCallback((clusterId: number, longitude: number, latitude: number) => {
    const expansionZoom = Math.min(supercluster.getClusterExpansionZoom(clusterId), 16);
    setViewState(prev => ({ ...prev, longitude, latitude, zoom: expansionZoom }));
    setSelectedMarker(null);
  }, [supercluster]);

  const handleOpenFacility = useCallback((facility: Facility) => {
    setSelectedFacility(facility);
    setActiveApp('portfolio');
  }, [setSelectedFacility, setActiveApp]);

  const toggleMapStyle = useCallback(() => {
    setMapStyle(prev => prev.includes('dark-v11') ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/dark-v11');
  }, []);

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
            <p className="text-sm text-muted-foreground">Contact the administrator to configure the map functionality.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {isMobile && (
        <Button
          variant="secondary"
          size="icon"
          onClick={() => setActiveApp('portfolio')}
          className="absolute top-3 left-3 z-20 h-9 w-9 bg-card/90 backdrop-blur-sm shadow-lg rounded-full"
        >
          <ArrowLeft size={18} />
        </Button>
      )}

      {/* Map Controls */}
      <div className="absolute top-3 sm:top-4 right-3 sm:right-4 z-10 flex flex-col gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              className={`h-8 w-8 sm:h-9 sm:w-9 bg-card/90 backdrop-blur-sm shadow-lg ${effectiveColoringMode !== 'none' ? 'ring-2 ring-primary' : ''}`}
            >
              <Palette size={16} className="sm:w-[18px] sm:h-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Color markers by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={coloringMode} onValueChange={(v) => setColoringMode(v as MapColoringMode)}>
              {(Object.keys(COLORING_MODE_LABELS) as MapColoringMode[]).map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode}>{COLORING_MODE_LABELS[mode]}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="secondary" size="icon" onClick={toggleMapStyle} className="h-8 w-8 sm:h-9 sm:w-9 bg-card/90 backdrop-blur-sm shadow-lg">
          <Layers size={16} className="sm:w-[18px] sm:h-[18px]" />
        </Button>
        <Button variant="secondary" size="icon" onClick={() => setViewState({ latitude: 59.0, longitude: 15.0, zoom: 4.5 })} className="h-8 w-8 sm:h-9 sm:w-9 bg-card/90 backdrop-blur-sm shadow-lg">
          <Maximize2 size={16} className="sm:w-[18px] sm:h-[18px]" />
        </Button>
      </div>

      {/* Shared sidebar */}
      {!hideSidebar && (
        <BuildingSidebar
          facilities={sidebarItems}
          selectedId={selectedMarker?.fmGuid ?? null}
          onSelect={handleSidebarSelect}
          title="Buildings"
          searchPlaceholder="Search buildings..."
          emptyLabel="No buildings loaded"
          noMatchLabel="No matching buildings"
        />
      )}

      <ColoringLegend mode={effectiveColoringMode} />

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
                compact={compact}
              />
            );
          }

          const facility = cluster.properties.facility!;
          const metrics = buildingMetricsMap[facility.fmGuid!];
          const markerColor = effectiveColoringMode !== 'none' && metrics ? getBuildingColor(metrics, effectiveColoringMode) : undefined;

          return (
            <SingleMarker
              key={facility.fmGuid}
              longitude={longitude}
              latitude={latitude}
              name={facility.commonName || facility.name || ''}
              onClick={() => handleMarkerClick(facility)}
              isSelected={selectedMarker?.fmGuid === facility.fmGuid}
              color={markerColor}
              compact={compact}
            />
          );
        })}

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
                  <img src={selectedMarker.image} alt={selectedMarker.name} className="w-full h-20 sm:h-24 object-cover rounded-t-md" />
                )}
                <div className="p-2 sm:p-3">
                  <h3 className="font-semibold text-sm text-foreground">{selectedMarker.commonName || selectedMarker.name}</h3>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mb-2">{selectedMarker.address}</p>
                  <div className="flex gap-2 mb-2 sm:mb-3">
                    <Badge variant="secondary" className="text-[10px] sm:text-xs">{selectedMarker.numberOfLevels} floors</Badge>
                    <Badge variant="secondary" className="text-[10px] sm:text-xs">{selectedMarker.area?.toLocaleString()} m²</Badge>
                  </div>
                  <Button size="sm" className="w-full text-xs sm:text-sm" onClick={() => handleOpenFacility(selectedMarker)}>
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
