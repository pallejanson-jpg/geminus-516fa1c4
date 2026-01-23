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
      name: building.commonName || building.name || 'Okänd byggnad',
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
      <div className="h-full p-6">
        <AssetPlusViewer fmGuid={viewer3dFmGuid} onClose={handleClose} />
      </div>
    );
  }

  // Default view - building selector and placeholder
  return (
    <div className="space-y-6 h-full p-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">3D-visning</h1>
          <p className="text-muted-foreground">
            Utforska fastigheter i 3D med BIM-data
          </p>
        </div>
        <Select 
          value={viewer3dFmGuid || ""} 
          onValueChange={handleBuildingChange}
        >
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Välj byggnad..." />
          </SelectTrigger>
          <SelectContent>
            {buildings.length === 0 ? (
              <SelectItem value="none" disabled>Inga byggnader laddade</SelectItem>
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
      <div className="grid gap-6 lg:grid-cols-4">
        {/* Main Viewer */}
        <Card className="lg:col-span-3">
          <CardContent className="p-0">
            <div className="relative aspect-video w-full bg-muted rounded-lg overflow-hidden">
              {/* Placeholder for 3D Viewer */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
                    <Box className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-medium">Välj en byggnad</p>
                    <p className="text-sm text-muted-foreground">
                      Använd rullgardinsmenyn ovan eller klicka på 3D-ikonen i Navigator
                    </p>
                  </div>
                </div>
              </div>

              {/* Viewer Controls */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/90 backdrop-blur-sm rounded-lg p-2 border">
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <div className="w-px h-6 bg-border" />
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Layer Toggle */}
              <div className="absolute top-4 right-4">
                <Button variant="secondary" size="sm" className="gap-2" disabled>
                  <Layers className="h-4 w-4" />
                  Lager
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Instructions */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Box className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold">Kom igång</h3>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Välj en byggnad från menyn ovan</li>
                <li>Eller klicka på 3D-ikonen (kub) i Navigator</li>
                <li>3D-modellen laddas från Asset+</li>
              </ol>
            </CardContent>
          </Card>

          {/* Available Buildings */}
          <Card>
            <CardContent className="pt-6">
              <h3 className="font-semibold mb-3">Tillgängliga byggnader</h3>
              {buildings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Inga byggnader laddade. Synkronisera data från Asset+ för att visa byggnader.
                </p>
              ) : (
                <div className="space-y-2">
                  {buildings.slice(0, 5).map((building) => (
                    <Button
                      key={building.fmGuid}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-left truncate"
                      onClick={() => handleBuildingChange(building.fmGuid)}
                    >
                      <Box className="h-4 w-4 mr-2 shrink-0 text-primary" />
                      <span className="truncate">{building.name}</span>
                    </Button>
                  ))}
                  {buildings.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center pt-2">
                      +{buildings.length - 5} fler byggnader
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