import { useContext, useMemo } from "react";
import { Box, Maximize2, RotateCcw, ZoomIn, ZoomOut, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppContext } from "@/context/AppContext";
import AssetPlusViewer from "@/components/viewer/AssetPlusViewer";

export default function Viewer() {
  const { viewer3dFmGuid, setViewer3dFmGuid, navigatorTreeData } = useContext(AppContext);

  // Get list of all buildings for the selector
  const buildings = useMemo(() => {
    return navigatorTreeData.map(building => ({
      fmGuid: building.fmGuid,
      name: building.commonName || building.name || 'Unknown building',
    }));
  }, [navigatorTreeData]);

  // Handle building selection change
  const handleBuildingChange = (fmGuid: string) => {
    setViewer3dFmGuid(fmGuid);
  };

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

  // Default view - building selector and placeholder
  return (
    <div className="space-y-4 sm:space-y-6 h-full p-3 sm:p-4 md:p-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-foreground">3D Viewer</h1>
          <p className="text-sm text-muted-foreground">
            Explore properties in 3D with BIM data
          </p>
        </div>
        <Select 
          value={viewer3dFmGuid || ""} 
          onValueChange={handleBuildingChange}
        >
          <SelectTrigger className="w-full sm:w-[240px]">
            <SelectValue placeholder="Select building..." />
          </SelectTrigger>
          <SelectContent>
            {buildings.length === 0 ? (
              <SelectItem value="none" disabled>No buildings loaded</SelectItem>
            ) : (
              buildings.map((building) => (
                <SelectItem key={building.fmGuid} value={building.fmGuid}>
                  {building.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      {/* 3D Viewer Area */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-4">
        {/* Main Viewer */}
        <Card className="lg:col-span-3">
          <CardContent className="p-0">
            <div className="relative aspect-video w-full bg-muted rounded-lg overflow-hidden">
              {/* Placeholder for 3D Viewer */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-3 sm:space-y-4 p-4">
                  <div className="flex h-12 w-12 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
                    <Box className="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-base sm:text-lg font-medium">Select a building</p>
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      Use the dropdown above or click the 3D icon in Navigator
                    </p>
                  </div>
                </div>
              </div>

              {/* Viewer Controls */}
              <div className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 sm:gap-2 bg-background/90 backdrop-blur-sm rounded-lg p-1.5 sm:p-2 border">
                <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" disabled>
                  <ZoomIn className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" disabled>
                  <ZoomOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
                <div className="w-px h-5 sm:h-6 bg-border" />
                <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" disabled>
                  <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" disabled>
                  <Maximize2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              </div>

              {/* Layer Toggle */}
              <div className="absolute top-3 sm:top-4 right-3 sm:right-4">
                <Button variant="secondary" size="sm" className="gap-2 text-xs sm:text-sm" disabled>
                  <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Layers</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Instructions */}
          <Card>
            <CardContent className="pt-4 sm:pt-6 space-y-2 sm:space-y-3">
              <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full bg-primary/10 mb-3 sm:mb-4">
                <Box className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-sm sm:text-base">Get Started</h3>
              <ol className="text-xs sm:text-sm text-muted-foreground space-y-1.5 sm:space-y-2 list-decimal list-inside">
                <li>Select a building from the menu above</li>
                <li>Or click the 3D icon (cube) in Navigator</li>
                <li>The 3D model loads from Asset+</li>
              </ol>
            </CardContent>
          </Card>

          {/* Available Buildings */}
          <Card>
            <CardContent className="pt-4 sm:pt-6">
              <h3 className="font-semibold text-sm sm:text-base mb-2 sm:mb-3">Available Buildings</h3>
              {buildings.length === 0 ? (
                <p className="text-xs sm:text-sm text-muted-foreground">
                  No buildings loaded. Sync data from Asset+ to display buildings.
                </p>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {buildings.slice(0, 5).map((building) => (
                    <Button
                      key={building.fmGuid}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-left truncate text-xs sm:text-sm"
                      onClick={() => handleBuildingChange(building.fmGuid)}
                    >
                      <Box className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-2 shrink-0 text-primary" />
                      <span className="truncate">{building.name}</span>
                    </Button>
                  ))}
                  {buildings.length > 5 && (
                    <p className="text-[10px] sm:text-xs text-muted-foreground text-center pt-2">
                      +{buildings.length - 5} more buildings
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
