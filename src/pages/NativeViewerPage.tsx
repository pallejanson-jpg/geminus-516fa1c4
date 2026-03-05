import { useContext, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppContext } from "@/context/AppContext";
import BuildingSelector from "@/components/viewer/BuildingSelector";

/**
 * NativeViewerPage — resolves a building from context and redirects to
 * UnifiedViewer (which has the mode switcher and all overlays).
 */
export default function NativeViewerPage() {
  const { viewer3dFmGuid, setViewer3dFmGuid, allData, isLoadingData } = useContext(AppContext);
  const navigate = useNavigate();

  const buildingFmGuid = useMemo(() => {
    if (!viewer3dFmGuid || !allData || allData.length === 0) return null;
    const facility = allData.find((item: any) => item.fmGuid === viewer3dFmGuid);
    if (!facility) return null;

    if (facility.category === 'Building' || facility.category === 'IfcBuilding') {
      return facility.fmGuid;
    }
    if (facility.buildingFmGuid) {
      const building = allData.find((item: any) =>
        item.fmGuid === facility.buildingFmGuid &&
        (item.category === 'Building' || item.category === 'IfcBuilding')
      );
      if (building) return building.fmGuid;
    }
    return null;
  }, [viewer3dFmGuid, allData]);

  // Redirect to UnifiedViewer with building param
  useEffect(() => {
    if (buildingFmGuid) {
      navigate(`/viewer?building=${buildingFmGuid}&mode=3d`, { replace: true });
    }
  }, [buildingFmGuid, navigate]);

  // Clear invalid guid
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

  return (
    <div className="h-full">
      <BuildingSelector />
    </div>
  );
}
