import { Box, Maximize2, RotateCcw, ZoomIn, ZoomOut, Layers } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Viewer() {
  return (
    <div className="space-y-6 h-full">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">3D-visning</h1>
          <p className="text-muted-foreground">
            Utforska fastigheter i 3D med BIM-data
          </p>
        </div>
        <Select defaultValue="property-1">
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="Välj fastighet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="property-1">Kontorshus Centrum</SelectItem>
            <SelectItem value="property-2">Lagerlokaler Syd</SelectItem>
            <SelectItem value="property-3">Kv. Björken</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 3D Viewer Area */}
      <div className="grid gap-6 lg:grid-cols-4">
        {/* Main Viewer */}
        <Card className="lg:col-span-3">
          <CardContent className="p-0">
            <div className="relative aspect-video w-full bg-muted rounded-lg overflow-hidden">
              {/* Placeholder for 3D Viewer (xeokit integration point) */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center space-y-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mx-auto">
                    <Box className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <p className="text-lg font-medium">3D-visare</p>
                    <p className="text-sm text-muted-foreground">
                      xeokit BIM-visare integreras här
                    </p>
                  </div>
                </div>
              </div>

              {/* Viewer Controls */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/90 backdrop-blur-sm rounded-lg p-2 border">
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <div className="w-px h-6 bg-border" />
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Layer Toggle */}
              <div className="absolute top-4 right-4">
                <Button variant="secondary" size="sm" className="gap-2">
                  <Layers className="h-4 w-4" />
                  Lager
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Model Info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Modellinformation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Fastighet</p>
                <p className="text-sm font-medium">Kontorshus Centrum</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Modelltyp</p>
                <p className="text-sm font-medium">IFC 4.0</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Senast uppdaterad</p>
                <p className="text-sm font-medium">2024-01-15</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Antal objekt</p>
                <p className="text-sm font-medium">12,847</p>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Åtgärder</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" size="sm">
                Exportera vy
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                Mät avstånd
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                Lägg till anteckning
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                Dela länk
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
