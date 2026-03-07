import { useContext, useEffect, useMemo } from "react";
import { AppContext } from "@/context/AppContext";
import AssetPlusViewer from "@/components/viewer/AssetPlusViewer";
import BuildingSelector from "@/components/viewer/BuildingSelector";
import ViewerErrorBoundary from "@/components/common/ViewerErrorBoundary";

export default function Viewer() {
  const { viewer3dFmGuid, setViewer3dFmGuid, allData, isLoadingData } = useContext(AppContext);

  // Handle close action
  const handleClose = () => {
    setViewer3dFmGuid(null);
  };

  // Resolve building and target entity from viewer3dFmGuid
  // Supports: Buildings (direct), Building Storeys (via buildingFmGuid), Spaces (via buildingFmGuid)
  const { buildingFmGuid, targetFacility } = useMemo(() => {
    if (!viewer3dFmGuid || !allData || allData.length === 0) {
      return { buildingFmGuid: null, targetFacility: null };
    }
    
    // Find the selected entity
    const facility = allData.find((item: any) => item.fmGuid === viewer3dFmGuid);
    if (!facility) return { buildingFmGuid: null, targetFacility: null };
    
    // If it's a Building, use it directly
    if (facility.category === 'Building' || facility.category === 'IfcBuilding') {
      return { buildingFmGuid: facility.fmGuid, targetFacility: facility };
    }
    
    // If it's a Storey or Space, find the parent building
    if (facility.buildingFmGuid) {
      const building = allData.find((item: any) => 
        item.fmGuid === facility.buildingFmGuid && 
        (item.category === 'Building' || item.category === 'IfcBuilding')
      );
      if (building) {
        return { buildingFmGuid: building.fmGuid, targetFacility: facility };
      }
    }
    
    return { buildingFmGuid: null, targetFacility: null };
  }, [viewer3dFmGuid, allData]);

  // Clear invalid GUID via useEffect instead of during render
  useEffect(() => {
    if (viewer3dFmGuid && !isLoadingData && allData.length > 0 && !buildingFmGuid) {
      setViewer3dFmGuid(null);
    }
  }, [viewer3dFmGuid, isLoadingData, allData, buildingFmGuid, setViewer3dFmGuid]);

  // If we have a selected FMGUID but data is still loading, show loading state
  if (viewer3dFmGuid && isLoadingData) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading building data...</div>
      </div>
    );
  }

  // If GUID is set but we couldn't resolve a building, show selector (no state updates here)
  if (viewer3dFmGuid && !isLoadingData && allData.length > 0 && !buildingFmGuid) {
    return (
      <div className="h-full">
        <BuildingSelector />
      </div>
    );
  }

  // If we have a valid building, show the Asset+ viewer
  if (buildingFmGuid && targetFacility) {
    return (
      <div className="h-full">
        <ViewerErrorBoundary onReset={handleClose}>
          <AssetPlusViewer 
            fmGuid={buildingFmGuid} 
            initialFmGuidToFocus={viewer3dFmGuid}
            onClose={handleClose} 
          />
        </ViewerErrorBoundary>
      </div>
    );
  }

  // Show building selector when no model is selected
  return (
    <div className="h-full">
      <BuildingSelector />
    </div>
  );
}
