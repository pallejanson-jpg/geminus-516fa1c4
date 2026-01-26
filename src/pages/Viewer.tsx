import { useContext } from "react";
import { AppContext } from "@/context/AppContext";
import AssetPlusViewer from "@/components/viewer/AssetPlusViewer";
import BuildingSelector from "@/components/viewer/BuildingSelector";

export default function Viewer() {
  const { viewer3dFmGuid, setViewer3dFmGuid } = useContext(AppContext);

  // Handle close action
  const handleClose = () => {
    setViewer3dFmGuid(null);
  };

  // If we have a selected FMGUID, show the Asset+ viewer
  if (viewer3dFmGuid) {
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
