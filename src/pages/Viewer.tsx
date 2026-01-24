import { useContext } from "react";
import { Box } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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

  // Default view - simple placeholder
  return (
    <div className="h-full p-3 sm:p-4 md:p-6 flex items-center justify-center">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
            <Box className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-2">3D Viewer</h2>
            <p className="text-sm text-muted-foreground">
              Select a building, floor, or room from the <strong>Navigator</strong> or <strong>Portfolio</strong> view to open its 3D model.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
