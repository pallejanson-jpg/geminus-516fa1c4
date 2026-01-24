import { useContext } from "react";
import { AppContext } from "@/context/AppContext";
import AssetPlusViewer from "@/components/viewer/AssetPlusViewer";

export default function Viewer() {
  const { viewer3dFmGuid, setViewer3dFmGuid } = useContext(AppContext);

  // Handle close action
  const handleClose = () => {
    setViewer3dFmGuid(null);
  };

  // If we have a selected FMGUID, show the Asset+ viewer
  if (viewer3dFmGuid) {
    return (
      <div className="h-full p-2 sm:p-4 md:p-6">
        <AssetPlusViewer fmGuid={viewer3dFmGuid} onClose={handleClose} />
      </div>
    );
  }

  // Empty state - user should navigate from Navigator or Portfolio
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-muted-foreground">
        <p className="text-sm">No model selected</p>
      </div>
    </div>
  );
}
