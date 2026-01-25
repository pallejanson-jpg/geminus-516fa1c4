import React, { useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AppContext, AssetRegistrationContext } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { X, Loader2, MapPin, Check, ChevronDown } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';

// Asset type options for dropdown
const ASSET_TYPES = [
  { value: 'fire_extinguisher', label: 'Brandsläckare' },
  { value: 'chair', label: 'Stol' },
  { value: 'table', label: 'Bord' },
  { value: 'hvac', label: 'Luftbehandlingsaggregat' },
  { value: 'sprinkler', label: 'Sprinkler' },
  { value: 'sensor', label: 'Sensor' },
  { value: 'lamp', label: 'Lampa' },
  { value: 'cabinet', label: 'Skåp' },
  { value: 'other', label: 'Övrigt' },
];

// Object category options (from IFC)
const OBJECT_CATEGORIES = [
  { value: 'IfcFurniture', label: 'Furniture' },
  { value: 'IfcBuildingElementProxy', label: 'All (Generellt)' },
  { value: 'IfcDoor', label: 'Door' },
  { value: 'IfcWindow', label: 'Window' },
  { value: 'IfcFlowTerminal', label: 'Flow Terminal' },
  { value: 'IfcFireSuppressionTerminal', label: 'Fire Suppression' },
  { value: 'IfcSensor', label: 'Sensor' },
];

// Generate UUID
function generateFmGuid(): string {
  return crypto.randomUUID();
}

interface AssetRegistrationViewProps {
  viewerRef: React.MutableRefObject<any>;
  registrationContext: AssetRegistrationContext;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Asset Registration Form - shown below the 3D viewer
 * Allows picking coordinates from the 3D view
 */
export function AssetRegistrationForm({ 
  viewerRef, 
  registrationContext, 
  onComplete, 
  onCancel 
}: AssetRegistrationViewProps) {
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(false);
  const [isPickingCoordinates, setIsPickingCoordinates] = useState(false);
  const [coordinates, setCoordinates] = useState<{ x: number; y: number; z: number } | null>(null);
  
  // Form fields
  const [designation, setDesignation] = useState('');
  const [assetType, setAssetType] = useState('');
  const [objectCategory, setObjectCategory] = useState('IfcBuildingElementProxy');
  const [description, setDescription] = useState('');
  
  const pickListenerRef = useRef<(() => void) | null>(null);

  // Cleanup pick listener on unmount
  useEffect(() => {
    return () => {
      if (pickListenerRef.current) {
        pickListenerRef.current();
        pickListenerRef.current = null;
      }
    };
  }, []);

  // Handle coordinate picking from 3D view
  const handlePickCoordinates = useCallback(() => {
    if (isPickingCoordinates) {
      // Cancel picking
      setIsPickingCoordinates(false);
      if (pickListenerRef.current) {
        pickListenerRef.current();
        pickListenerRef.current = null;
      }
      return;
    }

    setIsPickingCoordinates(true);
    toast.info('Klicka på en yta i 3D-vyn för att välja position', { duration: 5000 });

    const xeokitViewer = viewerRef.current?.$refs?.AssetViewer?.$refs?.assetView?.viewer;
    if (!xeokitViewer?.scene) {
      toast.error('Kunde inte ansluta till 3D-vyn');
      setIsPickingCoordinates(false);
      return;
    }

    const canvas = xeokitViewer.scene.canvas.canvas;
    
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const canvasPos = [e.clientX - rect.left, e.clientY - rect.top];
      
      const pickResult = xeokitViewer.scene.pick({
        canvasPos,
        pickSurface: true,
      });
      
      if (pickResult?.worldPos) {
        const [x, y, z] = pickResult.worldPos;
        setCoordinates({ x, y, z });
        toast.success(`Position vald: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
      } else {
        toast.error('Ingen yta hittades. Klicka på ett synligt objekt.');
      }
      
      setIsPickingCoordinates(false);
    };

    canvas.addEventListener('click', handleClick, { once: true });
    pickListenerRef.current = () => canvas.removeEventListener('click', handleClick);
  }, [isPickingCoordinates, viewerRef]);

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!designation.trim()) {
      toast.error('Benämning/nummer är obligatoriskt');
      return;
    }

    if (!coordinates) {
      toast.error('Välj en position i 3D-vyn först');
      return;
    }

    setIsLoading(true);

    try {
      const newFmGuid = generateFmGuid();
      const assetTypeLabel = ASSET_TYPES.find(t => t.value === assetType)?.label || assetType;

      const payload = {
        fmGuid: newFmGuid,
        parentSpaceFmGuid: registrationContext.parentNode.fmGuid,
        designation: designation.trim(),
        commonName: assetTypeLabel || undefined,
        properties: [
          ...(assetType ? [{ name: 'AssetType', value: assetType, dataType: 0 }] : []),
          ...(objectCategory ? [{ name: 'ObjectCategory', value: objectCategory, dataType: 0 }] : []),
          ...(description.trim() ? [{ name: 'Description', value: description.trim(), dataType: 0 }] : []),
        ],
        coordinates: {
          x: coordinates.x,
          y: coordinates.y,
          z: coordinates.z,
        },
      };

      const { data, error } = await supabase.functions.invoke('asset-plus-create', {
        body: payload,
      });

      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Okänt fel vid skapande');

      toast.success('Tillgång registrerad!', {
        description: `${designation} har lagts till i ${registrationContext.parentNode.commonName || registrationContext.parentNode.name}`,
      });

      onComplete();
    } catch (error) {
      console.error('Failed to create asset:', error);
      toast.error('Kunde inte registrera tillgång', {
        description: error instanceof Error ? error.message : 'Ett oväntat fel inträffade',
      });
    } finally {
      setIsLoading(false);
    }
  }, [designation, assetType, objectCategory, description, coordinates, registrationContext, onComplete]);

  return (
    <Card className="border-t rounded-t-none">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Registrera tillgång</CardTitle>
          <Button variant="ghost" size="icon" onClick={onCancel} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          i <span className="font-medium">{registrationContext.parentNode.commonName || registrationContext.parentNode.name}</span>
        </p>
      </CardHeader>
      
      <CardContent className="px-4 pb-4 pt-0">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Coordinate picker */}
          <div className="space-y-2">
            <Label>Position i 3D-vy *</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={isPickingCoordinates ? "default" : coordinates ? "secondary" : "outline"}
                className="flex-1 gap-2"
                onClick={handlePickCoordinates}
                disabled={isLoading}
              >
                <MapPin className="h-4 w-4" />
                {isPickingCoordinates ? 'Väntar på klick...' : coordinates ? 'Ändra position' : 'Välj position'}
              </Button>
              {coordinates && (
                <div className="flex items-center gap-1 px-3 bg-muted rounded-md text-sm">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="font-mono text-xs">
                    {coordinates.x.toFixed(1)}, {coordinates.y.toFixed(1)}, {coordinates.z.toFixed(1)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Asset type dropdown */}
          <div className="space-y-2">
            <Label htmlFor="assetType">Typ av tillgång</Label>
            <Select value={assetType} onValueChange={setAssetType} disabled={isLoading}>
              <SelectTrigger>
                <SelectValue placeholder="Välj typ..." />
              </SelectTrigger>
              <SelectContent>
                {ASSET_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Designation */}
          <div className="space-y-2">
            <Label htmlFor="designation">Benämning / Nummer *</Label>
            <Input
              id="designation"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="t.ex. BS-001, Stol-A1"
              required
              disabled={isLoading}
            />
          </div>

          {/* Object category dropdown */}
          <div className="space-y-2">
            <Label htmlFor="objectCategory">Objektkategori (IFC)</Label>
            <Select value={objectCategory} onValueChange={setObjectCategory} disabled={isLoading}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBJECT_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Beskrivning (valfritt)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Fritext beskrivning..."
              disabled={isLoading}
            />
          </div>

          {/* Submit */}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1"
            >
              Avbryt
            </Button>
            <Button 
              type="submit" 
              disabled={isLoading || !coordinates}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Registrerar...
                </>
              ) : (
                'Registrera'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Full Asset Registration Page
 * Shows 3D viewer at top, registration form at bottom
 */
export default function AssetRegistration() {
  const { assetRegistrationContext, cancelAssetRegistration, refreshInitialData } = useContext(AppContext);
  const isMobile = useIsMobile();
  const viewerRef = useRef<any>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const [isViewerReady, setIsViewerReady] = useState(false);

  // Initialize viewer when component mounts
  useEffect(() => {
    if (!assetRegistrationContext) return;

    // Load Asset+ viewer script if not already loaded
    const initViewer = async () => {
      // Wait for DOM
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if AssetPlusViewer component exists
      const AssetPlusViewer = (window as any).assetplusviewer?.AssetPlusViewer;
      if (!AssetPlusViewer) {
        console.error('AssetPlusViewer not loaded');
        return;
      }

      // Create viewer instance (simplified - full logic in AssetPlusViewer component)
      setIsViewerReady(true);
    };

    initViewer();
  }, [assetRegistrationContext]);

  const handleComplete = useCallback(() => {
    refreshInitialData?.();
    cancelAssetRegistration();
  }, [refreshInitialData, cancelAssetRegistration]);

  if (!assetRegistrationContext) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Ingen registreringskontext aktiv</p>
      </div>
    );
  }

  // Import the actual viewer component
  const AssetPlusViewerComponent = React.lazy(() => import('@/components/viewer/AssetPlusViewer'));

  // Determine correct fmGuid for viewer - use space if available for room context
  const viewerFmGuid = assetRegistrationContext.parentNode?.fmGuid || assetRegistrationContext.buildingFmGuid;

  return (
    <div className="h-full flex flex-col">
      {/* 3D Viewer - takes more space for better picking */}
      <div className={`min-h-0 ${isMobile ? 'h-[55vh] min-h-[300px]' : 'h-[65vh] min-h-[400px]'}`}>
        <React.Suspense fallback={
          <div className="h-full flex items-center justify-center bg-muted">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }>
          <AssetPlusViewerComponent 
            fmGuid={viewerFmGuid} 
            onClose={cancelAssetRegistration}
          />
        </React.Suspense>
      </div>
      
      {/* Registration Form - bottom section */}
      <div className={`${isMobile ? 'max-h-[50vh]' : 'max-h-[40vh]'} overflow-y-auto`}>
        <AssetRegistrationForm
          viewerRef={viewerRef}
          registrationContext={assetRegistrationContext}
          onComplete={handleComplete}
          onCancel={cancelAssetRegistration}
        />
      </div>
    </div>
  );
}
