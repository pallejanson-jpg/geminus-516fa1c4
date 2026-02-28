import { useContext, useEffect, useMemo } from "react";
import { AppContext } from "@/context/AppContext";
import NativeViewerShell from "@/components/viewer/NativeViewerShell";
import BuildingSelector from "@/components/viewer/BuildingSelector";
import ViewerErrorBoundary from "@/components/common/ViewerErrorBoundary";

export default function NativeViewerPage() {
  const { viewer3dFmGuid, setViewer3dFmGuid, allData, isLoadingData } = useContext(AppContext);

  const handleClose = () => {
    setViewer3dFmGuid(null);
  };

  const { buildingFmGuid } = useMemo(() => {
    if (!viewer3dFmGuid || !allData || allData.length === 0) {
      console.log('[NativeViewerPage] No viewer3dFmGuid or allData empty', { viewer3dFmGuid, dataLen: allData?.length });
      return { buildingFmGuid: null };
    }
    const facility = allData.find((item: any) => item.fmGuid === viewer3dFmGuid);
    if (!facility) {
      console.warn('[NativeViewerPage] facility not found in allData for guid:', viewer3dFmGuid);
      return { buildingFmGuid: null };
    }

    console.log('[NativeViewerPage] Found facility:', { fmGuid: facility.fmGuid, category: facility.category, name: facility.name || facility.commonName });

    if (facility.category === 'Building' || facility.category === 'IfcBuilding') {
      return { buildingFmGuid: facility.fmGuid };
    }
    if (facility.buildingFmGuid) {
      const building = allData.find((item: any) =>
        item.fmGuid === facility.buildingFmGuid &&
        (item.category === 'Building' || item.category === 'IfcBuilding')
      );
      if (building) return { buildingFmGuid: building.fmGuid };
      console.warn('[NativeViewerPage] Parent building not found:', facility.buildingFmGuid);
    }
    console.warn('[NativeViewerPage] Could not resolve building for:', viewer3dFmGuid);
    return { buildingFmGuid: null };
  }, [viewer3dFmGuid, allData]);

  useEffect(() => {
    if (viewer3dFmGuid && !isLoadingData && allData.length > 0 && !buildingFmGuid) {
      setViewer3dFmGuid(null);
    }
  }, [viewer3dFmGuid, isLoadingData, allData, buildingFmGuid, setViewer3dFmGuid]);

  if (viewer3dFmGuid && isLoadingData) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Laddar byggnadsdata...</div>
      </div>
    );
  }

  if (buildingFmGuid) {
    return (
      <div className="h-full">
        <ViewerErrorBoundary onReset={handleClose}>
          <NativeViewerShell buildingFmGuid={buildingFmGuid} onClose={handleClose} />
        </ViewerErrorBoundary>
      </div>
    );
  }

  return (
    <div className="h-full">
      <BuildingSelector />
    </div>
  );
}
