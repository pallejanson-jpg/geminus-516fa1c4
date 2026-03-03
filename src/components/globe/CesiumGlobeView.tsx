import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

// CRITICAL: Set base URL before importing Cesium so it can find Workers/Assets
(window as any).CESIUM_BASE_URL = '/cesiumStatic';

import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Building2, Eye, Globe, Box, RotateCcw, ArrowRight } from 'lucide-react';
import { AppContext } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

interface BuildingCoord {
  fm_guid: string;
  latitude: number;
  longitude: number;
  name?: string;
  ivion_site_id?: string | null;
}

interface SelectedBuilding {
  facility: BuildingCoord & { displayName: string; has360: boolean };
  screenX: number;
  screenY: number;
}

function toCartesian(lat: number, lng: number, height = 0) {
  return Cesium.Cartesian3.fromDegrees(lng, lat, height);
}

const CesiumGlobeView: React.FC = () => {
  const { navigatorTreeData, setActiveApp, setSelectedFacility, open360WithContext, appConfigs } = useContext(AppContext);
  const navigate = useNavigate();

  const containerRef = useRef<HTMLDivElement>(null);
  const cesiumViewerRef = useRef<Cesium.Viewer | null>(null);
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const pinDataSourceRef = useRef<Cesium.CustomDataSource | null>(null);
  const facilitiesByGuidRef = useRef<Map<string, BuildingCoord & { displayName: string; has360: boolean }>>(new Map());
  const osmBuildingsLayerRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const hasFlewInRef = useRef(false);

  const [tokenError, setTokenError] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);
  const [buildingCoords, setBuildingCoords] = useState<BuildingCoord[]>([]);
  const [show3dBuildings, setShow3dBuildings] = useState(true);
  const [selectedBuilding, setSelectedBuilding] = useState<SelectedBuilding | null>(null);
  const [selectedFmGuid, setSelectedFmGuid] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

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
    viewer.scene.globe.depthTestAgainstTerrain = false;

    // Pin data source
    const pinDataSource = new Cesium.CustomDataSource('facility-pins');
    pinDataSourceRef.current = pinDataSource;
    viewer.dataSources.add(pinDataSource);

    // Click handlers
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clickHandlerRef.current = handler;

    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position);
      const entity = picked?.id as Cesium.Entity | undefined;
      const fmGuid = entity?.properties?.fm_guid?.getValue?.() as string | undefined;

      // If clicked empty space, close popup
      if (!fmGuid) {
        setSelectedBuilding(null);
        setSelectedFmGuid(null);
        return;
      }

      const facility = facilitiesByGuidRef.current.get(fmGuid);
      if (!facility) return;

      setSelectedFmGuid(facility.fm_guid);
      setSelectedBuilding(null);

      // Fly to ~2km altitude with slight perspective to see the area
      viewer.camera.flyTo({
        destination: toCartesian(facility.latitude, facility.longitude, 2000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-50),
          roll: 0,
        },
        duration: 1.5,
        complete: () => {
          // After fly-to completes, show the popup
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
        },
      });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    setViewerReady(true);

    return () => {
      handler.destroy();
      clickHandlerRef.current = null;
      pinDataSourceRef.current = null;
      cesiumViewerRef.current = null;
      viewer.destroy();
    };
  }, [tokenReady]);

  // Fetch building coordinates
  useEffect(() => {
    const fetchCoords = async () => {
      const { data } = await supabase
        .from('building_settings')
        .select('fm_guid, latitude, longitude, ivion_site_id');

      if (!data) return;

      setBuildingCoords(
        data
          .filter(d => d.latitude !== null && d.longitude !== null)
          .map(d => ({
            fm_guid: d.fm_guid,
            latitude: d.latitude!,
            longitude: d.longitude!,
            ivion_site_id: d.ivion_site_id,
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

  const handleNavigateToFacility = useCallback((fmGuid: string) => {
    setSelectedBuilding(null);
    const node = navigatorTreeData.find(n => n.fmGuid.toLowerCase() === fmGuid.toLowerCase());
    if (node) {
      setSelectedFacility(node);
      setActiveApp('portfolio');
    }
  }, [navigatorTreeData, setSelectedFacility, setActiveApp]);

  const handleOpenViewer = useCallback((fmGuid: string) => {
    setSelectedBuilding(null);
    const node = navigatorTreeData.find(n => n.fmGuid.toLowerCase() === fmGuid.toLowerCase());
    if (node) setSelectedFacility(node);
    navigate(`/split-viewer?building=${fmGuid}&mode=3d`);
  }, [navigatorTreeData, setSelectedFacility, navigate]);

  const handleOpen360 = useCallback((facility: SelectedBuilding['facility']) => {
    setSelectedBuilding(null);
    const radarConfig = appConfigs?.radar || {};
    const ivionUrl = radarConfig.url || 'https://swg.iv.navvis.com';

    open360WithContext({
      buildingFmGuid: facility.fm_guid,
      buildingName: facility.displayName,
      ivionSiteId: facility.ivion_site_id || '',
      ivionUrl,
    });
  }, [appConfigs, open360WithContext]);

  const handleResetView = useCallback(() => {
    setSelectedBuilding(null);
    setSelectedFmGuid(null);
    cesiumViewerRef.current?.camera?.flyHome?.(1.5);
  }, []);

  // Keep pin layer in sync
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
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: facility.displayName,
          font: '13px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -28),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(0,0,0,0.4)'),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
        },
      });
    });
  }, [facilities, selectedFmGuid, viewerReady]);

  // Fly-in animation: zoom from global view to bounding region of all buildings
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || !viewerReady || facilities.length === 0 || hasFlewInRef.current) return;
    hasFlewInRef.current = true;

    // Compute bounding rectangle of all buildings with padding
    const lats = facilities.map(f => f.latitude);
    const lngs = facilities.map(f => f.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const padLat = Math.max((maxLat - minLat) * 0.3, 0.5);
    const padLng = Math.max((maxLng - minLng) * 0.3, 0.5);

    const rect = Cesium.Rectangle.fromDegrees(
      minLng - padLng,
      minLat - padLat,
      maxLng + padLng,
      maxLat + padLat,
    );

    // Delay slightly so the globe renders first
    setTimeout(() => {
      viewer.camera.flyTo({
        destination: rect,
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-35),
          roll: 0,
        },
        duration: 3,
      });
    }, 500);
  }, [facilities, viewerReady]);

  // Toggle OSM 3D buildings
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || !viewerReady) return;

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

  // Close popup on outside click (but not on the popup itself)
  useEffect(() => {
    const close = () => setSelectedBuilding(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // Update popup position when camera moves
  useEffect(() => {
    const viewer = cesiumViewerRef.current;
    if (!viewer || !viewerReady || !selectedBuilding) return;

    const updatePopupPosition = () => {
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
      viewer.scene.postRender.removeEventListener(updatePopupPosition);
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

      {/* Building info popup */}
      {selectedBuilding && (
        <div
          className="fixed z-50 pointer-events-auto"
          style={{
            left: Math.min(selectedBuilding.screenX - 120, window.innerWidth - 260),
            top: Math.max(selectedBuilding.screenY - 160, 8),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Card className="w-[240px] bg-card/95 backdrop-blur-md shadow-xl border-border/60 overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="px-3 py-2.5 border-b border-border/40">
                <h3 className="text-sm font-semibold text-foreground truncate">
                  {selectedBuilding.facility.displayName}
                </h3>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                    <Building2 size={9} className="mr-0.5" />
                    Fastighet
                  </Badge>
                  {selectedBuilding.facility.has360 && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-primary border-primary/30">
                      <Globe size={9} className="mr-0.5" />
                      360°
                    </Badge>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="p-1.5 flex flex-col gap-0.5">
                <button
                  className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-foreground hover:bg-primary/10 rounded-md transition-colors"
                  onClick={() => handleNavigateToFacility(selectedBuilding.facility.fm_guid)}
                >
                  <span className="flex items-center gap-2">
                    <Building2 size={13} className="text-primary" />
                    Visa detaljer
                  </span>
                  <ArrowRight size={12} className="text-muted-foreground" />
                </button>
                <button
                  className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-foreground hover:bg-primary/10 rounded-md transition-colors"
                  onClick={() => handleOpenViewer(selectedBuilding.facility.fm_guid)}
                >
                  <span className="flex items-center gap-2">
                    <Eye size={13} className="text-primary" />
                    Öppna 3D-viewer
                  </span>
                  <ArrowRight size={12} className="text-muted-foreground" />
                </button>
                {selectedBuilding.facility.has360 && (
                  <button
                    className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-medium text-foreground hover:bg-primary/10 rounded-md transition-colors"
                    onClick={() => handleOpen360(selectedBuilding.facility)}
                  >
                    <span className="flex items-center gap-2">
                      <Globe size={13} className="text-primary" />
                      Visa 360°
                    </span>
                    <ArrowRight size={12} className="text-muted-foreground" />
                  </button>
                )}
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
