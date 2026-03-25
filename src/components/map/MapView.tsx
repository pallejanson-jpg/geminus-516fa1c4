import React, { useState, useContext, useCallback, useEffect, useMemo, useRef } from 'react';
import Map, { Popup, Marker, NavigationControl, GeolocateControl, Source, Layer } from 'react-map-gl';
import { MapPin, Maximize2, Layers, Loader2, Palette, ArrowLeft, Navigation, Eye } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
import NavigationMapPanel from './NavigationMapPanel';
import IndoorFloorSwitcher from './IndoorFloorSwitcher';
import StreetViewOverlay from '@/components/globe/StreetViewOverlay';
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
import { useIndoorGeoJSON } from '@/hooks/useIndoorGeoJSON';
import { localToGeo, BuildingOrigin } from '@/lib/coordinate-transform';
import { parseNavGraph, dijkstra, findNodeByRoom, findNearestEntranceNode, mergeGraphs, generateIndoorSteps } from '@/lib/pathfinding';
import type { Json } from '@/integrations/supabase/types';
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

const INDOOR_ZOOM_THRESHOLD = 17;

const MapView: React.FC<MapViewProps> = ({ initialColoringMode = 'none', hideSidebar, compact, externalColoringMode }) => {
  const { setSelectedFacility, setActiveApp, isLoadingData } = useContext(AppContext);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
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

  // Navigation state
  const [showNavPanel, setShowNavPanel] = useState(false);
  const [outdoorRoute, setOutdoorRoute] = useState<GeoJSON.LineString | null>(null);
  const [indoorRoute, setIndoorRoute] = useState<GeoJSON.FeatureCollection | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [routeDestination, setRouteDestination] = useState<{ lat: number; lng: number } | null>(null);
  const [outdoorSteps, setOutdoorSteps] = useState<any[] | null>(null);
  const [routeSummary, setRouteSummary] = useState<{
    outdoorDistance: number;
    outdoorDuration: number;
    indoorDistance: number;
    transitSteps?: any[];
    outdoorSteps?: any[];
    indoorSteps?: Array<{
      instruction: string;
      distance: number;
      coordinates: { lat: number; lng: number };
      type: string;
    }>;
  } | null>(null);
  const [navBuildingGuid, setNavBuildingGuid] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);

  // Pick-on-map state
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [mapClickedPosition, setMapClickedPosition] = useState<{ lat: number; lng: number } | null>(null);

  // Active step state
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [activeStepCoords, setActiveStepCoords] = useState<{ lat: number; lng: number } | null>(null);

  // Street View overlay state
  const [streetViewTarget, setStreetViewTarget] = useState<{ lat: number; lng: number; name: string; fmGuid: string; has360: boolean } | null>(null);
  const [cesiumToken, setCesiumToken] = useState<string | null>(null);

  // Building origin for indoor mode
  const [buildingOrigin, setBuildingOrigin] = useState<BuildingOrigin | null>(null);

  const isIndoorMode = viewState.zoom >= INDOOR_ZOOM_THRESHOLD && navBuildingGuid != null;

  // Fetch building origin when navBuilding changes
  useEffect(() => {
    if (!navBuildingGuid) { setBuildingOrigin(null); return; }
    supabase
      .from('building_settings')
      .select('latitude, longitude, rotation')
      .eq('fm_guid', navBuildingGuid)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.latitude && data?.longitude) {
          setBuildingOrigin({ lat: data.latitude, lng: data.longitude, rotation: data.rotation || 0 });
        }
      });
  }, [navBuildingGuid]);

  // Indoor GeoJSON
  const { roomPolygons, floorIds } = useIndoorGeoJSON(
    isIndoorMode ? navBuildingGuid : null,
    buildingOrigin,
    selectedFloor
  );

  const floorOptions = useMemo(
    () => floorIds.map((id, i) => ({ id, label: `${i + 1}` })),
    [floorIds]
  );

  // Set default floor
  useEffect(() => {
    if (floorIds.length > 0 && !selectedFloor) setSelectedFloor(floorIds[0]);
  }, [floorIds, selectedFloor]);

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

  // Fetch Cesium token for Street View overlay
  useEffect(() => {
    supabase.functions.invoke('get-cesium-token').then(({ data }) => {
      if (data?.token) setCesiumToken(data.token);
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

  // Handle map click for picking origin
  const handleMapClick = useCallback((evt: any) => {
    if (!pickingOrigin) return;
    const { lng, lat } = evt.lngLat;
    const pos = { lat, lng };
    setMapClickedPosition(pos);
    setRouteOrigin(pos);
    setPickingOrigin(false);
  }, [pickingOrigin]);

  const handleRequestMapClick = useCallback(() => {
    setPickingOrigin(prev => !prev);
  }, []);

  // Handle step click — flyTo
  const handleStepClick = useCallback((index: number, coords: { lat: number; lng: number }) => {
    setActiveStepIndex(index);
    setActiveStepCoords(coords);
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [coords.lng, coords.lat],
        zoom: 15,
        duration: 800,
      });
    }
  }, []);

  // Handle navigation
  const handleNavigate = useCallback(async (params: {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    buildingFmGuid: string;
    targetRoomFmGuid: string | null;
    profile: 'walking' | 'driving' | 'transit';
  }) => {
    setNavBuildingGuid(params.buildingFmGuid);
    setRouteOrigin(params.origin);
    setRouteDestination(params.destination);
    setActiveStepIndex(null);
    setActiveStepCoords(null);

    try {
      let geometry: GeoJSON.LineString | null = null;
      let distance = 0;
      let duration = 0;
      let transitSteps: any[] | undefined;
      let mapboxSteps: any[] | undefined;

      if (params.profile === 'transit') {
        const { data, error } = await supabase.functions.invoke('google-routes', {
          body: {
            origin: { lat: params.origin.lat, lng: params.origin.lng },
            destination: { lat: params.destination.lat, lng: params.destination.lng },
          },
        });

        if (!error && data?.geometry) {
          geometry = data.geometry;
          distance = data.distance || 0;
          duration = data.duration || 0;
          transitSteps = data.steps;
        }
      } else {
        const { data, error } = await supabase.functions.invoke('mapbox-directions', {
          body: {
            origin: { lat: params.origin.lat, lng: params.origin.lng },
            destination: { lat: params.destination.lat, lng: params.destination.lng },
            profile: params.profile,
          },
        });

        if (!error && data?.geometry) {
          geometry = data.geometry;
          distance = data.distance || 0;
          duration = data.duration || 0;
          mapboxSteps = data.steps;
        }
      }

      if (geometry) {
        setOutdoorRoute(geometry);
        setOutdoorSteps(mapboxSteps || null);

        let indoorDist = 0;

        let indoorStepsGeo: Array<{
          instruction: string;
          distance: number;
          coordinates: { lat: number; lng: number };
          type: string;
        }> | undefined;

        if (params.targetRoomFmGuid) {
          // Fetch building origin for coordinate conversion
          const { data: bsData } = await supabase
            .from('building_settings')
            .select('latitude, longitude, rotation')
            .eq('fm_guid', params.buildingFmGuid)
            .maybeSingle();

          const bOrigin = bsData?.latitude && bsData?.longitude
            ? { lat: Number(bsData.latitude), lng: Number(bsData.longitude), rotation: Number(bsData.rotation || 0) }
            : null;

          const { data: graphRows } = await supabase
            .from('navigation_graphs')
            .select('graph_data')
            .eq('building_fm_guid', params.buildingFmGuid);

          if (graphRows && graphRows.length > 0) {
            const graphs = graphRows.map(r => parseNavGraph(r.graph_data as unknown as GeoJSON.FeatureCollection));
            const merged = mergeGraphs(graphs);
            const entrance = findNearestEntranceNode(merged);
            const target = findNodeByRoom(merged, params.targetRoomFmGuid);

            if (entrance && target) {
              const result = dijkstra(merged, entrance.nodeId, target.nodeId);
              if (result) {
                indoorDist = result.totalDistance;

                // Generate detailed indoor steps
                const rawSteps = generateIndoorSteps(result);

                if (bOrigin) {
                  // Convert normalized % coords to geo for map display
                  const geoCoords = result.path.map(n => {
                    // Normalized coords are [x%, y%] — treat as local meters offset (scale factor)
                    // For buildings, the nav graph uses percentage-based coords of the floor plan
                    // We approximate by scaling to a reasonable building size
                    const local = { x: n.coordinates[0], y: 0, z: n.coordinates[1] };
                    const geo = localToGeo(local, bOrigin);
                    return [geo.lng, geo.lat] as [number, number];
                  });

                  setIndoorRoute({
                    type: 'FeatureCollection',
                    features: [{
                      type: 'Feature',
                      geometry: { type: 'LineString', coordinates: geoCoords },
                      properties: {},
                    }],
                  });

                  // Convert indoor step coordinates to geo
                  indoorStepsGeo = rawSteps.map(s => {
                    const local = { x: s.coordinates[0], y: 0, z: s.coordinates[1] };
                    const geo = localToGeo(local, bOrigin);
                    return {
                      instruction: s.instruction,
                      distance: s.distance,
                      coordinates: { lat: geo.lat, lng: geo.lng },
                      type: s.type,
                    };
                  });
                } else {
                  // No origin — use raw normalized coords (indoor route only in 3D)
                  const coords = result.path.map(n => [n.coordinates[0], n.coordinates[1]]);
                  setIndoorRoute({
                    type: 'FeatureCollection',
                    features: [{
                      type: 'Feature',
                      geometry: { type: 'LineString', coordinates: coords },
                      properties: {},
                    }],
                  });
                }
              }
            }
          }
        }

        setRouteSummary({
          outdoorDistance: distance,
          outdoorDuration: duration,
          indoorDistance: indoorDist,
          transitSteps,
          outdoorSteps: mapboxSteps,
          indoorSteps: indoorStepsGeo,
        });

        // fitBounds to route
        const coords = geometry.coordinates;
        if (coords.length > 0 && mapRef.current) {
          let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
          for (const c of coords) {
            if (c[0] < minLng) minLng = c[0];
            if (c[0] > maxLng) maxLng = c[0];
            if (c[1] < minLat) minLat = c[1];
            if (c[1] > maxLat) maxLat = c[1];
          }
          mapRef.current.fitBounds(
            [[minLng, minLat], [maxLng, maxLat]],
            { padding: window.innerWidth < 768 ? { top: 60, bottom: 200, left: 40, right: 40 } : { top: 80, bottom: 80, left: 340, right: 80 }, duration: 1000 }
          );
        }
      }
    } catch (err) {
      console.error('Navigation error:', err);
    }
  }, []);

  const handleCloseNav = useCallback(() => {
    setShowNavPanel(false);
    setOutdoorRoute(null);
    setIndoorRoute(null);
    setRouteSummary(null);
    setNavBuildingGuid(null);
    setSelectedFloor(null);
    setRouteOrigin(null);
    setRouteDestination(null);
    setOutdoorSteps(null);
    setPickingOrigin(false);
    setMapClickedPosition(null);
    setActiveStepIndex(null);
    setActiveStepCoords(null);
  }, []);

  const handleShowIndoor = useCallback(() => {
    if (!navBuildingGuid) return;
    // Navigate to viewer with building; if indoor route exists, persist it
    if (indoorRoute) {
      sessionStorage.setItem('pending_indoor_route', JSON.stringify({
        buildingFmGuid: navBuildingGuid,
        route: indoorRoute,
      }));
    }
    navigate(`/viewer?building=${navBuildingGuid}`);
  }, [navBuildingGuid, indoorRoute, navigate]);

  // Outdoor route GeoJSON
  const outdoorRouteGeoJSON = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!outdoorRoute) return null;
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: outdoorRoute, properties: {} }],
    };
  }, [outdoorRoute]);

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

      {/* Navigation panel */}
      {showNavPanel && (
        <NavigationMapPanel
          facilities={mapFacilities}
          onNavigate={handleNavigate}
          onClose={handleCloseNav}
          routeSummary={routeSummary}
          hasIndoorRoute={!!indoorRoute}
          onShowIndoor={handleShowIndoor}
          onRequestMapClick={handleRequestMapClick}
          mapClickedPosition={mapClickedPosition}
          onStepClick={handleStepClick}
          activeStepIndex={activeStepIndex}
          pickingOrigin={pickingOrigin}
        />
      )}

      {/* Indoor floor switcher */}
      {isIndoorMode && (
        <IndoorFloorSwitcher
          floors={floorOptions}
          selectedFloor={selectedFloor}
          onSelectFloor={setSelectedFloor}
        />
      )}

      {/* Map Controls */}
      <div className="absolute top-3 sm:top-4 right-3 sm:right-4 z-10 flex flex-col gap-2">
        {/* Navigation toggle */}
        <Button
          variant="secondary"
          size="icon"
          className={`h-8 w-8 sm:h-9 sm:w-9 bg-card/90 backdrop-blur-sm shadow-lg ${showNavPanel ? 'ring-2 ring-primary' : ''}`}
          onClick={() => setShowNavPanel(prev => !prev)}
        >
          <Navigation size={16} className="sm:w-[18px] sm:h-[18px]" />
        </Button>

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

      {/* Shared sidebar — hide on mobile when nav panel is open */}
      {!hideSidebar && !(isMobile && showNavPanel) && (
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
        onClick={handleMapClick}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        mapboxAccessToken={mapboxToken}
        cursor={pickingOrigin ? 'crosshair' : undefined}
      >
        <NavigationControl position="bottom-right" />
        <GeolocateControl position="bottom-right" />

        {/* Outdoor route layer */}
        {outdoorRouteGeoJSON && (
          <Source id="outdoor-route" type="geojson" data={outdoorRouteGeoJSON}>
            <Layer
              id="outdoor-route-line"
              type="line"
              paint={{
                'line-color': 'hsl(217, 91%, 60%)',
                'line-width': 4,
                'line-opacity': isIndoorMode ? 0.3 : 1,
              }}
            />
            <Layer
              id="outdoor-route-arrows"
              type="symbol"
              layout={{
                'symbol-placement': 'line',
                'symbol-spacing': 80,
                'text-field': '▶',
                'text-size': 12,
                'text-rotate': 0,
                'text-keep-upright': false,
                'text-allow-overlap': true,
              }}
              paint={{
                'text-color': 'hsl(0, 0%, 100%)',
                'text-opacity': isIndoorMode ? 0.3 : 0.9,
              }}
            />
          </Source>
        )}

        {/* Origin marker (A) */}
        {routeOrigin && outdoorRoute && (
          <Marker latitude={routeOrigin.lat} longitude={routeOrigin.lng} anchor="center">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold shadow-lg border-2 border-background">
              A
            </div>
          </Marker>
        )}

        {/* Destination marker (B) */}
        {routeDestination && outdoorRoute && (
          <Marker latitude={routeDestination.lat} longitude={routeDestination.lng} anchor="center">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-destructive text-destructive-foreground text-xs font-bold shadow-lg border-2 border-background">
              B
            </div>
          </Marker>
        )}

        {/* Active step marker */}
        {activeStepCoords && (
          <Marker latitude={activeStepCoords.lat} longitude={activeStepCoords.lng} anchor="center">
            <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/80 border-2 border-primary-foreground shadow-lg animate-pulse" />
          </Marker>
        )}

        {/* Indoor room polygons */}
        {isIndoorMode && roomPolygons.features.length > 0 && (
          <Source id="indoor-rooms" type="geojson" data={roomPolygons}>
            <Layer
              id="indoor-rooms-fill"
              type="fill"
              paint={{
                'fill-color': 'hsl(217, 91%, 60%)',
                'fill-opacity': 0.15,
              }}
            />
            <Layer
              id="indoor-rooms-outline"
              type="line"
              paint={{
                'line-color': 'hsl(217, 91%, 60%)',
                'line-width': 1.5,
                'line-opacity': 0.6,
              }}
            />
            <Layer
              id="indoor-rooms-labels"
              type="symbol"
              layout={{
                'text-field': ['get', 'name'],
                'text-size': 10,
                'text-allow-overlap': false,
              }}
              paint={{
                'text-color': 'hsl(0, 0%, 95%)',
                'text-halo-color': 'hsl(0, 0%, 10%)',
                'text-halo-width': 1,
              }}
            />
          </Source>
        )}

        {/* Indoor route layer — show at any zoom when route exists */}
        {indoorRoute && (
          <Source id="indoor-route" type="geojson" data={indoorRoute}>
            <Layer
              id="indoor-route-line"
              type="line"
              paint={{
                'line-color': 'hsl(142, 71%, 45%)',
                'line-width': 3,
                'line-dasharray': [2, 1],
              }}
            />
            <Layer
              id="indoor-route-arrows"
              type="symbol"
              layout={{
                'symbol-placement': 'line',
                'symbol-spacing': 60,
                'text-field': '▶',
                'text-size': 10,
                'text-keep-upright': false,
                'text-allow-overlap': true,
              }}
              paint={{
                'text-color': 'hsl(0, 0%, 100%)',
                'text-opacity': 0.8,
              }}
            />
          </Source>
        )}

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
                  <div className="flex gap-1.5">
                    <Button size="sm" className="flex-1 text-xs sm:text-sm" onClick={() => handleOpenFacility(selectedMarker)}>
                      View details
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs sm:text-sm gap-1"
                      disabled={!cesiumToken}
                      onClick={() => {
                        setStreetViewTarget({
                          lat: selectedMarker.lat,
                          lng: selectedMarker.lng,
                          name: selectedMarker.commonName || selectedMarker.name,
                          fmGuid: selectedMarker.fmGuid!,
                          has360: !!selectedMarker.ivionSiteId,
                        });
                        setSelectedMarker(null);
                      }}
                    >
                      <Eye size={14} />
                      Street View
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Popup>
        )}
      </Map>

      {/* Street View overlay (Cesium-based) */}
      {streetViewTarget && cesiumToken && (
        <StreetViewOverlay
          lat={streetViewTarget.lat}
          lng={streetViewTarget.lng}
          buildingName={streetViewTarget.name}
          fmGuid={streetViewTarget.fmGuid}
          has360={streetViewTarget.has360}
          cesiumToken={cesiumToken}
          onClose={() => setStreetViewTarget(null)}
        />
      )}
    </div>
  );
};

export default MapView;
