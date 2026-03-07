import { useContext, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppContext } from "@/context/AppContext";
import BuildingSelector from "@/components/viewer/BuildingSelector";

/**
 * NativeViewerPage — resolves a building from context and redirects to
 * UnifiedViewer (/viewer) which has the mode switcher and all overlays.
 */
export default function NativeViewerPage() {
  const { viewer3dFmGuid, setViewer3dFmGuid, allData, isLoadingData } = useContext(AppContext);
  const navigate = useNavigate();

  const { buildingFmGuid, entityFmGuid } = useMemo(() => {
    if (!viewer3dFmGuid || !allData || allData.length === 0) return { buildingFmGuid: null, entityFmGuid: null };
    const facility = allData.find((item: any) => item.fmGuid === viewer3dFmGuid);
    if (!facility) return { buildingFmGuid: null, entityFmGuid: null };

    if (facility.category === 'Building' || facility.category === 'IfcBuilding') {
      return { buildingFmGuid: facility.fmGuid, entityFmGuid: null };
    }
    if (facility.buildingFmGuid) {
      const building = allData.find((item: any) =>
        item.fmGuid === facility.buildingFmGuid &&
        (item.category === 'Building' || item.category === 'IfcBuilding')
      );
      if (building) return { buildingFmGuid: building.fmGuid, entityFmGuid: facility.fmGuid };
    }
    return { buildingFmGuid: null, entityFmGuid: null };
  }, [viewer3dFmGuid, allData]);

  // Redirect to /viewer (UnifiedViewer) with building param
  useEffect(() => {
    if (buildingFmGuid) {
      const entityParam = entityFmGuid ? `&entity=${entityFmGuid}` : '';
      navigate(`/viewer?building=${buildingFmGuid}&mode=3d${entityParam}`, { replace: true });
    }
  }, [buildingFmGuid, entityFmGuid, navigate]);

  // Clear invalid guid
  useEffect(() => {
    if (viewer3dFmGuid && !isLoadingData && allData.length > 0 && !buildingFmGuid) {
      setViewer3dFmGuid(null);
    }
  }, [viewer3dFmGuid, isLoadingData, allData, buildingFmGuid, setViewer3dFmGuid]);

  if (viewer3dFmGuid && isLoadingData) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading building data...</div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <BuildingSelector />
    </div>
  );
}
