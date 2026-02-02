import { useContext, useEffect, useMemo } from "react";
import { AppContext } from "@/context/AppContext";
import AssetPlusViewer from "@/components/viewer/AssetPlusViewer";
import BuildingSelector from "@/components/viewer/BuildingSelector";

export default function Viewer() {
  const { viewer3dFmGuid, setViewer3dFmGuid, allData, isLoadingData } = useContext(AppContext);

  // Handle close action
  const handleClose = () => {
    setViewer3dFmGuid(null);
  };

  // Validate that selected building actually exists in data
  const validBuilding = useMemo(() => {
    if (!viewer3dFmGuid || !allData || allData.length === 0) return null;
    return allData.find(
      (item: any) => item.fmGuid === viewer3dFmGuid && 
        (item.category === 'Building' || item.category === 'IfcBuilding')
    );
  }, [viewer3dFmGuid, allData]);

  // Clear invalid GUID on unmount to ensure clean state
  useEffect(() => {
    return () => {
      // Only clear if navigating away, not on initial mount
    };
  }, []);

  // If we have a selected FMGUID but data is still loading, show loading state
  if (viewer3dFmGuid && isLoadingData) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Laddar byggnadsdata...</div>
      </div>
    );
  }

  // If GUID is set but building doesn't exist in data, show selector
  if (viewer3dFmGuid && !isLoadingData && allData.length > 0 && !validBuilding) {
    // Clear invalid GUID and show selector
    setViewer3dFmGuid(null);
    return (
      <div className="h-full">
        <BuildingSelector />
      </div>
    );
  }

  // If we have a valid FMGUID, show the Asset+ viewer
  if (viewer3dFmGuid && validBuilding) {
    return (
      <div className="h-full">
        <AssetPlusViewer fmGuid={viewer3dFmGuid} onClose={handleClose} />
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
