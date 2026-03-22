import React, { useContext, useState, useCallback, useEffect } from 'react';
import { AppContext, AssetRegistrationContext } from '@/context/AppContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { X, Loader2, MapPin, Check } from 'lucide-react';
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
import NativeXeokitViewer from '@/components/viewer/NativeXeokitViewer';

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

interface AssetRegistrationFormProps {
  registrationContext: AssetRegistrationContext;
  coordinates: { x: number; y: number; z: number } | null;
  isPickingCoordinates: boolean;
  onPickCoordinates: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

/**
 * Asset Registration Form - shown below the 3D viewer
 * Receives picked coordinates via callback from parent
 */
function AssetRegistrationForm({ 
  registrationContext, 
  coordinates,
  isPickingCoordinates,
  onPickCoordinates,
  onComplete, 
  onCancel 
}: AssetRegistrationFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  
  // Form fields
  const [designation, setDesignation] = useState('');
  const [assetType, setAssetType] = useState('');
  const [objectCategory, setObjectCategory] = useState('IfcBuildingElementProxy');
  const [description, setDescription] = useState('');

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!designation.trim()) {
      toast.error('Designation/number is required');
      return;
    }

    if (!coordinates) {
      toast.error('Select a position in the 3D view first');
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
      if (!data?.success) throw new Error(data?.error || 'Unknown error during creation');

      toast.success('Asset registered!', {
        description: `${designation} has been added to ${registrationContext.parentNode.commonName || registrationContext.parentNode.name}`,
      });

      onComplete();
    } catch (error) {
      console.error('Failed to create asset:', error);
      toast.error('Could not register asset', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    } finally {
      setIsLoading(false);
    }
  }, [designation, assetType, objectCategory, description, coordinates, registrationContext, onComplete]);

  return (
    <Card className="border-t rounded-t-none">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Register Asset</CardTitle>
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
            <Label>Position in 3D view *</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={isPickingCoordinates ? "default" : coordinates ? "secondary" : "outline"}
                className="flex-1 gap-2"
                onClick={onPickCoordinates}
                disabled={isLoading}
              >
                <MapPin className="h-4 w-4" />
                {isPickingCoordinates ? 'Waiting for click...' : coordinates ? 'Change position' : 'Select position'}
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
            <Label htmlFor="assetType">Asset Type</Label>
            <Select value={assetType} onValueChange={setAssetType} disabled={isLoading}>
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
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
            <Label htmlFor="designation">Designation / Number *</Label>
            <Input
              id="designation"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="e.g. FE-001, Chair-A1"
              required
              disabled={isLoading}
            />
          </div>

          {/* Object category dropdown */}
          <div className="space-y-2">
            <Label htmlFor="objectCategory">Object Category (IFC)</Label>
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
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Free-text description..."
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
 * Uses callback-based coordinate picking from viewer
 */
export default function AssetRegistration() {
  const { assetRegistrationContext, cancelAssetRegistration, refreshInitialData } = useContext(AppContext);
  const isMobile = useIsMobile();
  
  // Coordinate picking state - managed at this level and passed to viewer via props
  const [coordinates, setCoordinates] = useState<{ x: number; y: number; z: number } | null>(null);
  const [isPickingCoordinates, setIsPickingCoordinates] = useState(false);

  const handleComplete = useCallback(() => {
    refreshInitialData?.();
    cancelAssetRegistration();
  }, [refreshInitialData, cancelAssetRegistration]);

  // Toggle pick mode - tell the viewer to start picking
  const handlePickCoordinates = useCallback(() => {
    if (isPickingCoordinates) {
      setIsPickingCoordinates(false);
    } else {
      setIsPickingCoordinates(true);
    }
  }, [isPickingCoordinates]);

  // Viewer ready — attach pick listeners
  const handleViewerReady = useCallback((viewer: any) => {
    const canvas = viewer.scene.canvas.canvas;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let touchStart: { x: number; y: number } | null = null;

    const doPick = (cx: number, cy: number) => {
      const hit = viewer.scene.pick({ canvasPos: [cx, cy], pickSurface: true });
      if (hit?.worldPos) {
        setCoordinates({ x: hit.worldPos[0], y: hit.worldPos[1], z: hit.worldPos[2] });
        setIsPickingCoordinates(false);
      }
    };

    canvas.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0]; const r = canvas.getBoundingClientRect();
      touchStart = { x: t.clientX - r.left, y: t.clientY - r.top };
      longPressTimer = setTimeout(() => { if (touchStart) doPick(touchStart.x, touchStart.y); }, 500);
    }, { passive: true });
    canvas.addEventListener('touchmove', (e: TouchEvent) => {
      if (longPressTimer && touchStart) {
        const t = e.touches[0]; const r = canvas.getBoundingClientRect();
        if (Math.hypot(t.clientX - r.left - touchStart.x, t.clientY - r.top - touchStart.y) > 10) {
          clearTimeout(longPressTimer); longPressTimer = null;
        }
      }
    }, { passive: true });
    canvas.addEventListener('touchend', () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } });
    canvas.addEventListener('dblclick', (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      doPick(e.clientX - r.left, e.clientY - r.top);
    });
  }, []);

  if (!assetRegistrationContext) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Ingen registreringskontext aktiv</p>
      </div>
    );
  }

  const viewerFmGuid = assetRegistrationContext.parentNode?.fmGuid || assetRegistrationContext.buildingFmGuid;

  return (
    <div className="h-full flex flex-col">
      {/* 3D Viewer with Native Xeokit */}
      <div className={`min-h-0 relative ${isMobile ? 'h-[55vh] min-h-[300px]' : 'h-[65vh] min-h-[400px]'}`}>
        <NativeXeokitViewer
          buildingFmGuid={viewerFmGuid}
          onClose={cancelAssetRegistration}
          onViewerReady={handleViewerReady}
        />
        {isPickingCoordinates && (
          <div className="absolute top-3 left-3 z-20 bg-primary/90 text-primary-foreground text-xs px-3 py-1.5 rounded-md shadow-md">
            Håll nedtryckt / dubbelklicka för att välja position
          </div>
        )}
      </div>
      
      {/* Registration Form - bottom section */}
      <div className={`${isMobile ? 'max-h-[50vh]' : 'max-h-[40vh]'} overflow-y-auto`}>
        <AssetRegistrationForm
          registrationContext={assetRegistrationContext}
          coordinates={coordinates}
          isPickingCoordinates={isPickingCoordinates}
          onPickCoordinates={handlePickCoordinates}
          onComplete={handleComplete}
          onCancel={cancelAssetRegistration}
        />
      </div>
    </div>
  );
}