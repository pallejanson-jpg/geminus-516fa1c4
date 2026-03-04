import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// CRITICAL: Set base URL before importing Cesium so it can find Workers/Assets
(window as any).CESIUM_BASE_URL = '/cesiumStatic';

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Building2, Eye, Globe, Box, RotateCcw, ArrowRight, Loader2, Boxes } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

interface BuildingCoord {
  fm_guid: string;
  latitude: number;
  longitude: number;
  name?: string;
  ivion_site_id?: string | null;
  rotation?: number | null;
}

interface SelectedBuilding {
  facility: BuildingCoord & { displayName: string; has360: boolean };
  screenX: number;
  screenY: number;
}

function toCartesian(lat: number, lng: number, height = 0) {
  return Cesium.Cartesian3.fromDegrees(lng, lat, height);
}

const PORTFOLIO_RETURN_APP_KEY = 'portfolio-return-app';
const VIEWER_RETURN_APP_KEY = 'viewer-return-app';

const CesiumGlobeView: React.FC = () => {
  const { navigatorTreeData, setActiveApp, setSelectedFacility, setViewer3dFmGuid, open360WithContext, appConfigs } = useContext(AppContext);

  const containerRef = useRef<HTMLDivElement>(null);
  const cesiumViewerRef = useRef<Cesium.Viewer | null>(null);
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const pinDataSourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const facilitiesByGuidRef = useRef<Map<string, BuildingCoord & { displayName: string; has360: boolean }>>(new Map());
  const osmBuildingsLayerRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const hasFlewInRef = useRef(false);
  const zoomedFmGuidRef = useRef<string | null>(null);
  const bimEntityRef = useRef<Cesium.Entity | null>(null);

  const [tokenError, setTokenError] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);
  const [buildingCoords, setBuildingCoords] = useState<BuildingCoord[]>([]);
  const [show3dBuildings, setShow3dBuildings] = useState(true);
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null);
  const [selectedFmGuid, setSelectedFmGuid] = useState<string | null>(null);
  const [zoomedFmGuid, setZoomedFmGuid] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [bimLoading, setBimLoading] = useState(false);
  const [bimLoadedFmGuid, setBimLoadedFmGuid] = useState<string | null>(null);

  // Fetch Cesium token
  useEffect(() => {
    supabase.functions.invoke('get-cesium-token').then(({ data, error }) => {
      if (!error && data?.token) {
        Cesium.Ion.defaultAccessToken = data.token;
      } else {
        setTokenError(true);
        Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlYWE1OWUxNy1mMWZiLTQzYjYtYTQ0OS1kMWFjYmFkNjc4ZTkiLCJpZCI6NTc3MzMsImlhdCI6MTYyMjY0NjQ5OH0.XcKpgANiY19MC4bdFUXMVEBToBmqS8kuYpUlxJHYZxk';
      }
      setTokenReady(true);
    });
  }, []);

  // Create Cesium Viewer imperatively — wait for token
  useEffect(() => {
    if (!containerRef.current || !tokenReady) return;

    const viewer = new Cesium.Viewer(containerRef.current, {
      timeline: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
    });

    cesiumViewerRef.current = viewer;

    // Reduce resolution on desktop for better performance
    viewer.resolutionScale = window.innerWidth > 768 ? 0.85 : 1.0;

    // Start in a visible Nordic overview immediately (before heavy layers are ready)
    viewer.camera.setView({
      destination: toCartesian(62.5, 15.0, 2200000),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0,
      },
    });

    // Add Cesium World Terrain so 3D buildings sit correctly on the ground
    Cesium.CesiumTerrainProvider.fromIonAssetId(1).then(terrainProvider => {
      if (cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) {
        cesiumViewerRef.current.terrainProvider = terrainProvider;
      }
    }).catch(err => {
      console.warn('Could not load Cesium World Terrain:', err);
    });

    viewer.scene.globe.depthTestAgainstTerrain = true;

    // Pin data source
    const pinDataSource = new Cesium.CustomDataSource('facility-pins');
    pinDataSourceRef.current = pinDataSource;
    viewer.dataSources.add(pinDataSource);

    // Click handler
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandlerRef.current = handler;

    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      if (viewer.isDestroyed()) return;
      const picked = viewer.scene.pick(movement.position);
      const entity = picked?.id as Cesium.Entity | undefined;
      const fmGuid = entity?.properties?.fm_guid?.getValue?.() as string | undefined;

      // If clicked empty space, close popup and reset
      if (!fmGuid) {
        setSelectedBuilding(null);
        setSelectedFmGuid(null);
        setZoomedFmGuid(null);
        return;
      }

      const facility = facilitiesByGuidRef.current.get(fmGuid);
      if (!facility) return;

      setSelectedFmGuid(facility.fm_guid);

      // Check if we already zoomed to this building — second click shows popup
      const alreadyZoomed = zoomedFmGuidRef.current === fmGuid;

      if (alreadyZoomed) {
        // Second click: show popup
        const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(
          viewer.scene,
          toCartesian(facility.latitude, facility.longitude, 0),
        );
        if (screenPos) {
          setSelectedBuilding({
            facility,
            screenX: screenPos.x,
            screenY: screenPos.y,
          });
        }
        return;
      }

      // First click: zoom in to centered pin, no popup
      setSelectedBuilding(null);
      setZoomedFmGuid(fmGuid);

      const pinCenter = toCartesian(facility.latitude, facility.longitude, 0);
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(pinCenter, 24), {
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(0),
          Cesium.Math.toRadians(-50),
          360,
        ),
        duration: 1.4,
      });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    setViewerReady(true);

    return () => {
      setViewerReady(false);
      handler.destroy();
      clickHandlerRef.current = null;
      pinDataSourceRef.current = null;
      if (!viewer.isDestroyed()) {
        viewer.destroy();
      }
      cesiumViewerRef.current = null;
    };
  }, [tokenReady]);

  // Fetch building coordinates (include rotation for BIM placement)
  useEffect(() => {
    const fetchCoords = async () => {
      const { data } = await supabase
        .from('building_settings')
        .select('fm_guid, latitude, longitude, ivion_site_id, rotation');

      if (!data) return;

      setBuildingCoords(
        data
          .filter(d => d.latitude !== null && d.longitude !== null)
          .map(d => ({
            fm_guid: d.fm_guid,
            latitude: d.latitude!,
            longitude: d.longitude!,
            ivion_site_id: d.ivion_site_id,
            rotation: d.rotation ?? 0,
          })),
      );
    };

    fetchCoords();
  }, []);

  const facilities = useMemo(() => {
    return buildingCoords.map(coord => {
      const treeNode = navigatorTreeData.find(
        n => n.fmGuid.toLowerCase() === coord.fm_guid.toLowerCase(),
      );

      return {
        ...coord,
        displayName: treeNode?.commonName || treeNode?.name || coord.fm_guid.substring(0, 8),
        has360: !!coord.ivion_site_id,
      };
    });
  }, [buildingCoords, navigatorTreeData]);

  const facilitiesByGuid = useMemo(() => {
    const map = new Map<string, (typeof facilities)[number]>();
    facilities.forEach(f => map.set(f.fm_guid, f));
    return map;
  }, [facilities]);

  useEffect(() => {
    facilitiesByGuidRef.current = facilitiesByGuid;
  }, [facilitiesByGuid]);

  useEffect(() => {
    zoomedFmGuidRef.current = zoomedFmGuid;
  }, [zoomedFmGuid]);

  // ── Navigation handlers ──

  const handleNavigateToFacility = useCallback((fmGuid: string) => {
    setSelectedBuilding(null);
    setSelectedFmGuid(null);
    setZoomedFmGuid(null);
    const node = navigatorTreeData.find(n => n.fmGuid.toLowerCase() === fmGuid.toLowerCase());
    if (node) {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(PORTFOLIO_RETURN_APP_KEY, 'globe');
      }
      setSelectedFacility(node);
    }
    setActiveApp('portfolio');
  }, [navigatorTreeData, setSelectedFacility, setActiveApp]);

  const handleOpenViewer = useCallback((fmGuid: string) => {
    setSelectedBuilding(null);
    setSelectedFmGuid(null);
    setZoomedFmGuid(null);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(VIEWER_RETURN_APP_KEY, 'globe');
    }
    // setViewer3dFmGuid automatically switches to native_viewer
    setViewer3dFmGuid(fmGuid);
  }, [setViewer3dFmGuid]);

  const handleShowBim = useCallback(async (fmGuid: string) => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const facility = facilitiesByGuidRef.current.get(fmGuid);
    if (!facility) return;

    // Toggle off if already loaded
    if (bimLoadedFmGuid === fmGuid && bimEntityRef.current) {
      viewer.entities.remove(bimEntityRef.current);
      bimEntityRef.current = null;
      setBimLoadedFmGuid(null);
      toast.info('BIM-modell borttagen');
      return;
    }

    setBimLoading(true);
    setSelectedBuilding(null);

    try {
      // 1. Check for cached GLB
      const { data: checkData, error: checkError } = await supabase.functions.invoke('bim-to-gltf', {
        body: { action: 'check', buildingFmGuid: fmGuid },
      });

      if (checkError) throw new Error(checkError.message);

      let glbUrl: string | null = null;

      if (checkData?.cached && checkData.glbUrl) {
        glbUrl = checkData.glbUrl;
      } else if (checkData?.hasIfc || checkData?.hasXkt) {
        // 2. Convert source model → GLB (IFC primary, XKT/ACC fallback)
        toast.info('Konverterar BIM-modell...', { duration: 12000, id: 'bim-convert' });

        const { data: convertData, error: convertError } = await supabase.functions.invoke('bim-to-gltf', {
          body: { action: 'convert', buildingFmGuid: fmGuid },
        });

        toast.dismiss('bim-convert');

        if (convertError) throw new Error(convertError.message);
        if (!convertData?.glbUrl) throw new Error(convertData?.error || 'No GLB URL returned');

        glbUrl = convertData.glbUrl;
      } else {
        toast.warning('Ingen BIM-källa hittades (IFC/XKT) för denna byggnad');
        setBimLoading(false);
        return;
      }

      // 3. Remove previous BIM entity if any
      if (bimEntityRef.current) {
        viewer.entities.remove(bimEntityRef.current);
        bimEntityRef.current = null;
      }

      // 4. Place GLB model on the globe
      const position = Cesium.Cartesian3.fromDegrees(
        facility.longitude,
        facility.latitude,
        0
      );

      const heading = Cesium.Math.toRadians(facility.rotation || 0);
      const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

      const entity = viewer.entities.add({
        position,
        orientation,
        model: {
          uri: glbUrl!,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          minimumPixelSize: 64,
          maximumScale: 20000,
          color: Cesium.Color.WHITE.withAlpha(0.85),
          silhouetteColor: Cesium.Color.fromCssColorString('hsl(212, 92%, 60%)'),
          silhouetteSize: 1.5,
        },
      });

      bimEntityRef.current = entity;
      setBimLoadedFmGuid(fmGuid);

      // Fly to a good viewing angle
      viewer.camera.flyTo({
        destination: toCartesian(facility.latitude, facility.longitude, 200),
        orientation: {
          heading: Cesium.Math.toRadians(45),
          pitch: Cesium.Math.toRadians(-35),
          roll: 0,
        },
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
    setSelectedBuilding(null);
    setSelectedFmGuid(null);
    setZoomedFmGuid(null);
    const viewer = cesiumViewerRef.current;
    if (viewer && !viewer.isDestroyed() && facilities.length > 0) {
      const lats = facilities.map(f => f.latitude);
      const lngs = facilities.map(f => f.longitude);
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
      viewer.camera.flyTo({
        destination: toCartesian(centerLat, centerLng, 1500000),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 1.5,
      });
    } else {
      viewer?.camera?.flyHome?.(1.5);
    }
  }, [facilities]);

  // Keep pin layer in sync — smaller pins and labels for overview
  useEffect(() => {
    const dataSource = pinDataSourceRef.current;
    if (!dataSource || !viewerReady) return;

    dataSource.entities.removeAll();

    facilities.forEach(facility => {
      const isSelected = selectedFmGuid === facility.fm_guid;

      dataSource.entities.add({
        id: `facility-${facility.fm_guid}`,
        position: toCartesian(facility.latitude, facility.longitude),
        properties: {
          fm_guid: facility.fm_guid,
        },
        point: {
          pixelSize: isSelected ? 18 : 14,
          color: isSelected
            ? Cesium.Color.fromCssColorString('hsl(262, 83%, 58%)')
            : Cesium.Color.fromCssColorString('hsl(212, 92%, 60%)'),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: isSelected ? 2.5 : 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new Cesium.NearFarScalar(500, 1.4, 2000000, 0.8),
        },
        label: {
          text: facility.displayName,
          font: '13px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
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
  }, [facilities, selectedFmGuid, viewerReady]);

  // Fly-in animation
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed() || !viewerReady || facilities.length === 0 || hasFlewInRef.current) return;
    hasFlewInRef.current = true;

    const lats = facilities.map(f => f.latitude);
    const lngs = facilities.map(f => f.longitude);
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

    setTimeout(() => {
      if (viewer.isDestroyed()) return;
      viewer.camera.flyTo({
        destination: toCartesian(centerLat, centerLng, 1500000),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
        duration: 3,
      });
    }, 500);
  }, [facilities, viewerReady]);

  // Toggle OSM 3D buildings
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed() || !viewerReady) return;

    if (show3dBuildings) {
      let cancelled = false;

      Cesium.createOsmBuildingsAsync()
        .then(tileset => {
          if (cancelled) return;
          viewer.scene.primitives.add(tileset);
          osmBuildingsLayerRef.current = tileset;
        })
        .catch(err => {
          console.warn('OSM 3D Buildings requires Cesium token:', err);
        });

      return () => {
        cancelled = true;
      };
    }

    const osmLayer = osmBuildingsLayerRef.current;
    if (osmLayer) {
      viewer.scene.primitives.remove(osmLayer);
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

  // Update popup position when camera moves
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || viewer.isDestroyed() || !viewerReady || !selectedBuilding) return;

    let frameId = 0;
    const updatePopupPosition = () => {
      if (viewer.isDestroyed()) return;
      frameId++;
      if (frameId % 2 !== 0) return;
      if (!selectedBuilding) return;
      const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        toCartesian(selectedBuilding.facility.latitude, selectedBuilding.facility.longitude, 0),
      );
      if (screenPos) {
        setSelectedBuilding(prev => prev ? { ...prev, screenX: screenPos.x, screenY: screenPos.y } : null);
      }
    };

    viewer.scene.postRender.addEventListener(updatePopupPosition);
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.scene.postRender.removeEventListener(updatePopupPosition);
      }
    };
  }, [viewerReady, selectedBuilding?.facility.fm_guid]);

  return (
    <div className="flex-1 flex flex-col h-full relative overflow-hidden">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Compact top-left controls */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 bg-card/80 backdrop-blur-sm rounded-full px-3 py-1.5 shadow border border-border/50">
          <Box size={12} className="text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">3D</span>
          <Switch
            id="toggle-3d"
            checked={show3dBuildings}
            onCheckedChange={setShow3dBuildings}
            className="scale-75 origin-center"
          />
        </div>

        <Badge variant="secondary" className="w-fit text-[11px] bg-card/80 backdrop-blur-sm border-border/50 rounded-full px-2.5 py-0.5">
          <Building2 size={11} className="mr-1" />
          {facilities.length} byggnader
        </Badge>

        {tokenError && (
          <span className="text-[9px] text-muted-foreground bg-card/80 backdrop-blur-sm rounded px-2 py-0.5">
            Begränsat Cesium-token
          </span>
        )}
      </div>

      <Button
        variant="secondary"
        size="icon"
        onClick={handleResetView}
        className="absolute top-3 right-3 z-20 bg-card/80 backdrop-blur-sm shadow border border-border/50 h-8 w-8"
        title="Återställ vy"
      >
        <RotateCcw size={14} />
      </Button>

      {/* BIM loading indicator */}
      {bimLoading && (
        <div className="absolute top-14 right-3 z-20 bg-card/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow border border-border/50 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-primary" />
          <span className="text-[11px] text-muted-foreground">Laddar BIM...</span>
        </div>
      )}

      {/* Building info popup */}
      {selectedBuilding && (
        <div
          className="fixed z-50 pointer-events-auto"
          style={{
            left: Math.min(selectedBuilding.screenX + 20, window.innerWidth - 190),
            top: Math.max(selectedBuilding.screenY - 60, 8),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Card className="w-[170px] sm:w-[190px] bg-card/95 backdrop-blur-md shadow-xl border-border/60 overflow-hidden">
            <CardContent className="p-2">
              <h3 className="text-[11px] sm:text-xs font-semibold text-foreground truncate">
                {selectedBuilding.facility.displayName}
              </h3>
              <div className="flex items-center gap-1 mt-1">
                <Badge variant="outline" className="text-[8px] sm:text-[9px] px-1 py-0 h-3.5">
                  <Building2 size={8} className="mr-0.5" />
                  Fastighet
                </Badge>
                {selectedBuilding.facility.has360 && (
                  <Badge variant="outline" className="text-[8px] sm:text-[9px] px-1 py-0 h-3.5 text-primary border-primary/30">
                    <Globe size={8} className="mr-0.5" />
                    360°
                  </Badge>
                )}
              </div>
              <div className="flex flex-col gap-0.5 mt-1.5">
                <button
                  className="w-full flex items-center justify-between px-1.5 py-1.5 text-[10px] sm:text-[11px] font-medium text-foreground hover:bg-primary/10 rounded transition-colors"
                  onClick={() => handleNavigateToFacility(selectedBuilding.facility.fm_guid)}
                >
                  <span className="flex items-center gap-1.5">
                    <Building2 size={11} className="text-primary" />
                    Visa detaljer
                  </span>
                  <ArrowRight size={10} className="text-muted-foreground" />
                </button>
                <button
                  className="w-full flex items-center justify-between px-1.5 py-1.5 text-[10px] sm:text-[11px] font-medium text-foreground hover:bg-primary/10 rounded transition-colors"
                  onClick={() => handleOpenViewer(selectedBuilding.facility.fm_guid)}
                >
                  <span className="flex items-center gap-1.5">
                    <Eye size={11} className="text-primary" />
                    Öppna 3D-viewer
                  </span>
                  <ArrowRight size={10} className="text-muted-foreground" />
                </button>
                <button
                  className="w-full flex items-center justify-between px-1.5 py-1.5 text-[10px] sm:text-[11px] font-medium text-foreground hover:bg-primary/10 rounded transition-colors"
                  onClick={() => handleShowBim(selectedBuilding.facility.fm_guid)}
                  disabled={bimLoading}
                >
                  <span className="flex items-center gap-1.5">
                    {bimLoading ? (
                      <Loader2 size={11} className="text-primary animate-spin" />
                    ) : (
                      <Boxes size={11} className="text-primary" />
                    )}
                    {bimLoadedFmGuid === selectedBuilding.facility.fm_guid ? 'Dölj BIM' : 'Visa BIM'}
                  </span>
                  <ArrowRight size={10} className="text-muted-foreground" />
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {facilities.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <Card className="bg-card/90 backdrop-blur-sm">
            <CardContent className="p-4 flex flex-col items-center gap-2">
              <Building2 size={24} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground text-center">
                Inga byggnader med koordinater.<br />
                Konfigurera koordinater i Inställningar.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default CesiumGlobeView;
