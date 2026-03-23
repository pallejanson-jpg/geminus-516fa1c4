import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// CRITICAL: Set base URL before importing Cesium so it can find Workers/Assets
(window as any).CESIUM_BASE_URL = '/cesiumStatic';

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Building2, Eye, Box, RotateCcw, Loader2, Boxes, ArrowRight, MapPin } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { useMapFacilities, MapFacility } from '@/hooks/useMapFacilities';
import BuildingSidebar from '@/components/map/BuildingSidebar';
import BuildingInfoCard from '@/components/map/BuildingInfoCard';
import StreetViewOverlay from '@/components/globe/StreetViewOverlay';

interface SelectedBuilding {
  facility: MapFacility;
  screenX: number;
  screenY: number;
}

/** Hide OSM buildings within a radius of a given lat/lng by applying a Cesium3DTileStyle */
function hideOsmBuildingsNear(tileset: Cesium.Cesium3DTileset, lat: number, lng: number, radiusMeters = 60) {
  // Approximate degree delta from meters (rough at Nordic latitudes)
  const latDelta = radiusMeters / 111320;
  const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));
  const minLat = lat - latDelta;
  const maxLat = lat + latDelta;
  const minLng = lng - lngDelta;
  const maxLng = lng + lngDelta;

  tileset.style = new Cesium.Cesium3DTileStyle({
    show: {
      conditions: [
        [
          `\${feature['cesium#longitude']} > ${minLng} && \${feature['cesium#longitude']} < ${maxLng} && \${feature['cesium#latitude']} > ${minLat} && \${feature['cesium#latitude']} < ${maxLat}`,
          'false',
        ],
        ['true', 'true'],
      ],
    },
  });
}

/** Reset OSM tileset style so all buildings are visible again */
function resetOsmStyle(tileset: Cesium.Cesium3DTileset) {
  tileset.style = new Cesium.Cesium3DTileStyle({ show: 'true' });
}

function toCartesian(lat: number, lng: number, height = 0) {
  return Cesium.Cartesian3.fromDegrees(lng, lat, height);
}

const PORTFOLIO_RETURN_APP_KEY = 'portfolio-return-app';
const VIEWER_RETURN_APP_KEY = 'viewer-return-app';
const CESIUM_CAMERA_STATE_KEY = 'cesium-camera-state';

const CesiumGlobeView: React.FC = () => {
  const { navigatorTreeData, setActiveApp, setSelectedFacility, setViewer3dFmGuid } = useContext(AppContext);
  const { facilities: mapFacilities } = useMapFacilities();

  const containerRef = useRef<HTMLDivElement>(null);
  const cesiumViewerRef = useRef<Cesium.Viewer | null>(null);
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const pinDataSourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const facilitiesByGuidRef = useRef<Map<string, MapFacility>>(new Map());
  const osmBuildingsLayerRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const hasFlewInRef = useRef(false);
  const zoomedFmGuidRef = useRef<string | null>(null);
  const bimEntityRef = useRef<Cesium.Entity | null>(null);

  const [tokenReady, setTokenReady] = useState(false);
  const [show3dBuildings, setShow3dBuildings] = useState(true);
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null);
  const [selectedFmGuid, setSelectedFmGuid] = useState<string | null>(null);
  const [zoomedFmGuid, setZoomedFmGuid] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [bimLoading, setBimLoading] = useState(false);
  const [bimLoadedFmGuid, setBimLoadedFmGuid] = useState<string | null>(null);
  const [streetViewFacility, setStreetViewFacility] = useState<MapFacility | null>(null);
  const [cesiumToken, setCesiumToken] = useState<string | null>(null);

  // Sidebar items from shared hook
  const sidebarItems = useMemo(() =>
    mapFacilities.map(f => ({
      id: f.fmGuid!,
      displayName: f.displayName,
      address: f.address || '',
    })),
    [mapFacilities],
  );

  const facilitiesByGuid = useMemo(() => {
    const map = new Map<string, MapFacility>();
    mapFacilities.forEach(f => map.set(f.fmGuid!, f));
    return map;
  }, [mapFacilities]);

  useEffect(() => { facilitiesByGuidRef.current = facilitiesByGuid; }, [facilitiesByGuid]);
  useEffect(() => { zoomedFmGuidRef.current = zoomedFmGuid; }, [zoomedFmGuid]);

  // Fetch Cesium token
  useEffect(() => {
    supabase.functions.invoke('get-cesium-token').then(({ data, error }) => {
      if (!error && data?.token) {
        Cesium.Ion.defaultAccessToken = data.token;
        setCesiumToken(data.token);
      } else {
        const fallback = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc4ZTkiLCJpZCI6NTc3MzMsImlhdCI6MTYyMjY0NjQ5OH0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk';
        Cesium.Ion.defaultAccessToken = fallback;
        setCesiumToken(fallback);
      }
      setTokenReady(true);
    });
  }, []);

  // Create Cesium Viewer imperatively
  useEffect(() => {
    if (!containerRef.current || !tokenReady) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      timeline: false, animation: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      infoBox: false, selectionIndicator: false,
    });

    cesiumViewerRef.current = viewer;
    viewer.resolutionScale = window.innerWidth > 768 ? 0.85 : 1.0;

    // Minimize Cesium credits on mobile
    if (window.innerWidth < 768) {
      const creditContainer = viewer.cesiumWidget.creditContainer as HTMLElement;
      if (creditContainer) {
        creditContainer.style.transform = 'scale(0.6)';
        creditContainer.style.transformOrigin = 'bottom right';
        creditContainer.style.opacity = '0.5';
      }
    }

    // Start fully zoomed out to show the whole globe
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(15.0, 20.0, 20000000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
    });

    Cesium.CesiumTerrainProvider.fromIonAssetId(1).then(tp => {
      if (cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) cesiumViewerRef.current.terrainProvider = tp;
    }).catch(() => {});

    viewer.scene.globe.depthTestAgainstTerrain = true;

    const pinDataSource = new Cesium.CustomDataSource('facility-pins');
    pinDataSourceRef.current = pinDataSource;
    viewer.dataSources.add(pinDataSource);

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandlerRef.current = handler;

    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      if (viewer.isDestroyed()) return;
      const picked = viewer.scene.pick(movement.position);
      const entity = picked?.id as Cesium.Entity | undefined;
      const fmGuid = entity?.properties?.fm_guid?.getValue?.() as string | undefined;

      if (!fmGuid) {
        setSelectedBuilding(null); setSelectedFmGuid(null); setZoomedFmGuid(null);
        return;
      }

      const facility = facilitiesByGuidRef.current.get(fmGuid);
      if (!facility) return;

      setSelectedFmGuid(facility.fmGuid!);
      const alreadyZoomed = zoomedFmGuidRef.current === fmGuid;

      if (alreadyZoomed) {
        const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, toCartesian(facility.lat, facility.lng, 0));
        if (screenPos) setSelectedBuilding({ facility, screenX: screenPos.x, screenY: screenPos.y });
        return;
      }

      setSelectedBuilding(null);
      setZoomedFmGuid(fmGuid);
      viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(toCartesian(facility.lat, facility.lng, 0), 24),
        { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 360), duration: 1.4 },
      );
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    setViewerReady(true);

    return () => {
      setViewerReady(false);
      handler.destroy();
      clickHandlerRef.current = null;
      pinDataSourceRef.current = null;
      if (!viewer.isDestroyed()) viewer.destroy();
      cesiumViewerRef.current = null;
    };
  }, [tokenReady]);

  // Save camera state helper
  const saveCameraState = useCallback(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const cam = viewer.camera;
    try {
      sessionStorage.setItem(CESIUM_CAMERA_STATE_KEY, JSON.stringify({
        pos: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        dir: { x: cam.direction.x, y: cam.direction.y, z: cam.direction.z },
        up: { x: cam.up.x, y: cam.up.y, z: cam.up.z },
        selectedFmGuid, zoomedFmGuid,
      }));
    } catch { /* ignore */ }
  }, [selectedFmGuid, zoomedFmGuid]);

  // Navigation handlers
  const handleNavigateToFacility = useCallback((fmGuid: string) => {
    saveCameraState();
    setSelectedBuilding(null); setSelectedFmGuid(null); setZoomedFmGuid(null);
    const node = navigatorTreeData.find(n => n.fmGuid.toLowerCase() === fmGuid.toLowerCase());
    if (node) {
      sessionStorage.setItem(PORTFOLIO_RETURN_APP_KEY, 'globe');
      setSelectedFacility(node);
    }
    setActiveApp('portfolio');
  }, [navigatorTreeData, setSelectedFacility, setActiveApp, saveCameraState]);

  const handleOpenViewer = useCallback((fmGuid: string) => {
    saveCameraState();
    setSelectedBuilding(null); setSelectedFmGuid(null); setZoomedFmGuid(null);
    sessionStorage.setItem(VIEWER_RETURN_APP_KEY, 'globe');
    setViewer3dFmGuid(fmGuid);
  }, [setViewer3dFmGuid, saveCameraState]);

  const handleShowBim = useCallback(async (fmGuid: string) => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const facility = facilitiesByGuidRef.current.get(fmGuid);
    if (!facility) return;

    if (bimLoadedFmGuid === fmGuid && bimEntityRef.current) {
      viewer.entities.remove(bimEntityRef.current);
      bimEntityRef.current = null;
      setBimLoadedFmGuid(null);
      // Restore hidden OSM buildings
      if (osmBuildingsLayerRef.current) resetOsmStyle(osmBuildingsLayerRef.current);
      toast.info('BIM model removed');
      return;
    }

    setBimLoading(true);
    setSelectedBuilding(null);

    try {
      const { data: checkData, error: checkError } = await supabase.functions.invoke('bim-to-gltf', { body: { action: 'check', buildingFmGuid: fmGuid } });
      if (checkError) throw new Error(checkError.message);

      let glbUrl: string | null = null;

      if (checkData?.cached && checkData.glbUrl) {
        glbUrl = checkData.glbUrl;
      } else if (checkData?.hasIfc || checkData?.hasXkt) {
        toast.info('Konverterar BIM-modell...', { duration: 12000, id: 'bim-convert' });
        const { data: convertData, error: convertError } = await supabase.functions.invoke('bim-to-gltf', { body: { action: 'convert', buildingFmGuid: fmGuid } });
        toast.dismiss('bim-convert');
        if (convertError) throw new Error(convertError.message);
        if (!convertData?.glbUrl) throw new Error(convertData?.error || 'No GLB URL returned');
        glbUrl = convertData.glbUrl;
      } else {
        toast.warning('Ingen BIM-källa hittades (IFC/XKT) för denna byggnad');
        setBimLoading(false);
        return;
      }

      if (bimEntityRef.current) { viewer.entities.remove(bimEntityRef.current); bimEntityRef.current = null; }

      const position = Cesium.Cartesian3.fromDegrees(facility.lng, facility.lat, 0);
      const heading = Cesium.Math.toRadians(facility.rotation || 0);
      const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

      const entity = viewer.entities.add({
        position, orientation,
        model: {
          uri: glbUrl!,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          minimumPixelSize: 64, maximumScale: 20000,
          color: Cesium.Color.WHITE.withAlpha(0.85),
          silhouetteColor: Cesium.Color.fromCssColorString('hsl(212, 92%, 60%)'),
          silhouetteSize: 1.5,
        },
      });

      bimEntityRef.current = entity;
      setBimLoadedFmGuid(fmGuid);

      // Hide overlapping OSM buildings near the BIM placement
      if (osmBuildingsLayerRef.current) {
        hideOsmBuildingsNear(osmBuildingsLayerRef.current, facility.lat, facility.lng, 60);
      }

      viewer.camera.flyTo({
        destination: toCartesian(facility.lat, facility.lng, 200),
        orientation: { heading: Cesium.Math.toRadians(45), pitch: Cesium.Math.toRadians(-35), roll: 0 },
        duration: 1.5,
      });

      toast.success('BIM-modell laddad');
    } catch (err: any) {
      console.error('BIM load error:', err);
      toast.error(`Kunde inte ladda BIM: ${err.message}`);
    } finally {
      setBimLoading(false);
    }
  }, [bimLoadedFmGuid]);

  const handleResetView = useCallback(() => {
    setSelectedBuilding(null); setSelectedFmGuid(null); setZoomedFmGuid(null);
    const viewer = cesiumViewerRef.current;
    if (viewer && !viewer.isDestroyed() && mapFacilities.length > 0) {
      const lats = mapFacilities.map(f => f.lat);
      const lngs = mapFacilities.map(f => f.lng);
      viewer.camera.flyTo({
        destination: toCartesian((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2, 1500000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.5,
      });
    }
  }, [mapFacilities]);

  // Pin layer sync
  useEffect(() => {
    const dataSource = pinDataSourceRef.current;
    if (!dataSource || !viewerReady) return;
    dataSource.entities.removeAll();

    mapFacilities.forEach(facility => {
      const isSelected = selectedFmGuid === facility.fmGuid;
      dataSource.entities.add({
        id: `facility-${facility.fmGuid}`,
        position: toCartesian(facility.lat, facility.lng),
        properties: { fm_guid: facility.fmGuid },
        point: {
          pixelSize: isSelected ? 18 : 14,
          color: isSelected
            ? Cesium.Color.fromCssColorString('hsl(262, 83%, 58%)')
            : Cesium.Color.fromCssColorString('hsl(212, 92%, 60%)'),
          outlineColor: Cesium.Color.WHITE, outlineWidth: isSelected ? 2.5 : 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new Cesium.NearFarScalar(500, 1.4, 2000000, 0.8),
        },
        label: {
          text: facility.displayName, font: '13px sans-serif',
          fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -24),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.5)'),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          scaleByDistance: new Cesium.NearFarScalar(500, 1.2, 2000000, 0.7),
        },
      });
    });
  }, [mapFacilities, selectedFmGuid, viewerReady]);

  // Fly-in / restore camera — starts zoomed out, then flies in to Nordics after a short delay
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed() || !viewerReady || mapFacilities.length === 0 || hasFlewInRef.current) return;
    hasFlewInRef.current = true;

    try {
      const saved = sessionStorage.getItem(CESIUM_CAMERA_STATE_KEY);
      if (saved) {
        sessionStorage.removeItem(CESIUM_CAMERA_STATE_KEY);
        const state = JSON.parse(saved);
        viewer.camera.setView({
          destination: new Cesium.Cartesian3(state.pos.x, state.pos.y, state.pos.z),
          orientation: {
            direction: new Cesium.Cartesian3(state.dir.x, state.dir.y, state.dir.z),
            up: new Cesium.Cartesian3(state.up.x, state.up.y, state.up.z),
          },
        });
        if (state.selectedFmGuid) setSelectedFmGuid(state.selectedFmGuid);
        if (state.zoomedFmGuid) setZoomedFmGuid(state.zoomedFmGuid);
        return;
      }
    } catch { /* ignore */ }

    // Wait 3 seconds showing the whole globe, then fly in to the Nordics
    const lats = mapFacilities.map(f => f.lat);
    const lngs = mapFacilities.map(f => f.lng);
    const flyInTimer = setTimeout(() => {
      if (viewer.isDestroyed()) return;
      viewer.camera.flyTo({
        destination: toCartesian((Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2, 1500000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 2.5,
      });
    }, 3000);

    return () => clearTimeout(flyInTimer);
  }, [mapFacilities, viewerReady]);

  // Toggle OSM 3D buildings
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed() || !viewerReady) return;

    if (show3dBuildings) {
      let cancelled = false;
      Cesium.createOsmBuildingsAsync()
        .then(tileset => { if (!cancelled) { viewer.scene.primitives.add(tileset); osmBuildingsLayerRef.current = tileset; } })
        .catch(() => {});
      return () => { cancelled = true; };
    }

    if (osmBuildingsLayerRef.current) {
      viewer.scene.primitives.remove(osmBuildingsLayerRef.current);
      osmBuildingsLayerRef.current = null;
    }
  }, [show3dBuildings, viewerReady]);

  // Close popup on outside click
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const canvas = cesiumViewerRef.current?.scene?.canvas;
      if (canvas && canvas.contains(e.target as Node)) return;
      setSelectedBuilding(null);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // Update popup position on camera move
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed() || !viewerReady || !selectedBuilding) return;

    let frameId = 0;
    const update = () => {
      if (viewer.isDestroyed()) return;
      frameId++;
      if (frameId % 2 !== 0 || !selectedBuilding) return;
      const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, toCartesian(selectedBuilding.facility.lat, selectedBuilding.facility.lng, 0));
      if (screenPos) setSelectedBuilding(prev => prev ? { ...prev, screenX: screenPos.x, screenY: screenPos.y } : null);
    };

    viewer.scene.postRender.addEventListener(update);
    return () => { if (!viewer.isDestroyed()) viewer.scene.postRender.removeEventListener(update); };
  }, [viewerReady, selectedBuilding?.facility.fmGuid]);

  // Sidebar select handler
  const handleSidebarSelect = useCallback((id: string) => {
    const viewer = cesiumViewerRef.current;
    const facility = facilitiesByGuidRef.current.get(id);
    if (!viewer || viewer.isDestroyed() || !facility) return;

    setSelectedFmGuid(id);
    setZoomedFmGuid(id);
    setSelectedBuilding(null);

    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(toCartesian(facility.lat, facility.lng, 0), 24),
      { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 360), duration: 1.4 },
    );
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Shared sidebar */}
      <BuildingSidebar
        facilities={sidebarItems}
        selectedId={selectedFmGuid}
        onSelect={handleSidebarSelect}
        title="Byggnader"
        searchPlaceholder="Sök byggnader..."
        emptyLabel="Inga byggnader"
        noMatchLabel="Inga matchningar"
      />

      {/* Top-right controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
        <div className="flex items-center gap-1.5 bg-card/80 backdrop-blur-sm rounded-full px-3 py-1.5 shadow border border-border/50">
          <Box size={12} className="text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">3D</span>
          <Switch id="toggle-3d" checked={show3dBuildings} onCheckedChange={setShow3dBuildings} className="scale-75 origin-center" />
        </div>
        <Button variant="secondary" size="icon" onClick={handleResetView} className="bg-card/80 backdrop-blur-sm shadow border border-border/50 h-8 w-8" title="Återställ vy">
          <RotateCcw size={14} />
        </Button>
      </div>

      {bimLoading && (
        <div className="absolute top-14 right-3 z-20 bg-card/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow border border-border/50 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-primary" />
          <span className="text-[11px] text-muted-foreground">Loading BIM…</span>
        </div>
      )}

      {/* Info popup using shared BuildingInfoCard */}
      {selectedBuilding && (
        <div
          className="fixed z-50 pointer-events-auto"
          style={{
            left: Math.min(selectedBuilding.screenX + 20, window.innerWidth - 190),
            top: Math.max(selectedBuilding.screenY - 60, 8),
          }}
          onClick={e => e.stopPropagation()}
        >
          <BuildingInfoCard
            name={selectedBuilding.facility.displayName}
            address={selectedBuilding.facility.address}
            has360={selectedBuilding.facility.has360}
            onViewDetails={() => handleNavigateToFacility(selectedBuilding.facility.fmGuid!)}
            onOpen3D={() => handleOpenViewer(selectedBuilding.facility.fmGuid!)}
            extraActions={
              <>
                <button
                  className="w-full flex items-center justify-between px-1.5 py-1.5 text-[10px] sm:text-[11px] font-medium text-foreground hover:bg-primary/10 rounded transition-colors"
                  onClick={() => handleShowBim(selectedBuilding.facility.fmGuid!)}
                  disabled={bimLoading}
                >
                  <span className="flex items-center gap-1.5">
                    {bimLoading ? <Loader2 size={11} className="text-primary animate-spin" /> : <Boxes size={11} className="text-primary" />}
                    {bimLoadedFmGuid === selectedBuilding.facility.fmGuid ? 'Dölj BIM' : 'Visa BIM'}
                  </span>
                  <ArrowRight size={10} className="text-muted-foreground" />
                </button>
                <button
                  className="w-full flex items-center justify-between px-1.5 py-1.5 text-[10px] sm:text-[11px] font-medium text-foreground hover:bg-primary/10 rounded transition-colors"
                  onClick={() => { setStreetViewFacility(selectedBuilding.facility); setSelectedBuilding(null); }}
                >
                  <span className="flex items-center gap-1.5">
                    <MapPin size={11} className="text-primary" />
                    Street View
                  </span>
                  <ArrowRight size={10} className="text-muted-foreground" />
                </button>
              </>
            }
          />
        </div>
      )}

      {mapFacilities.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <Card className="bg-card/90 backdrop-blur-sm">
            <CardContent className="p-4 flex flex-col items-center gap-2">
              <Building2 size={24} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">Inga byggnader laddade.<br />Synkronisera data i Inställningar.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default CesiumGlobeView;
