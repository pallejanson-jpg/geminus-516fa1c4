import React, { useState, useCallback } from 'react';
import { Plus, X, Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { NavigatorNode } from './TreeNode';

/**
 * Generate a 128-bit UUID/GUID for fmGuid
 */
function generateFmGuid(): string {
  return crypto.randomUUID();
}

/**
 * Property data types for Asset+ API
 */
const DataType = {
  String: 0,
  Int32: 1,
  Int64: 2,
  Decimal: 3,
  DateTime: 4,
  Bool: 5,
} as const;

type DataTypeKey = keyof typeof DataType;

const DATA_TYPE_OPTIONS: { value: DataTypeKey; label: string }[] = [
  { value: 'String', label: 'Text' },
  { value: 'Int32', label: 'Integer (32-bit)' },
  { value: 'Int64', label: 'Integer (64-bit)' },
  { value: 'Decimal', label: 'Decimal' },
  { value: 'DateTime', label: 'Date/Time' },
  { value: 'Bool', label: 'Yes/No' },
];

interface AssetProperty {
  id: string;
  name: string;
  value: string;
  dataType: DataTypeKey;
}

interface Coordinates {
  x: string;
  y: string;
  z: string;
}

interface AddAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentNode: NavigatorNode | null;
  onAssetCreated?: () => void;
  /** Pre-filled coordinates from 3D picker */
  initialCoordinates?: { x: number; y: number; z: number };
}

export function AddAssetDialog({ open, onOpenChange, parentNode, onAssetCreated, initialCoordinates }: AddAssetDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [designation, setDesignation] = useState('');
  const [commonName, setCommonName] = useState('');
  const [description, setDescription] = useState('');
  const [properties, setProperties] = useState<AssetProperty[]>([]);
  const [showCoordinates, setShowCoordinates] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates>({
    x: initialCoordinates?.x?.toString() || '',
    y: initialCoordinates?.y?.toString() || '',
    z: initialCoordinates?.z?.toString() || '',
  });

  // Update coordinates when initialCoordinates changes (from 3D picker)
  React.useEffect(() => {
    if (initialCoordinates) {
      setCoordinates({
        x: initialCoordinates.x.toString(),
        y: initialCoordinates.y.toString(),
        z: initialCoordinates.z.toString(),
      });
      setShowCoordinates(true);
    }
  }, [initialCoordinates]);

  const resetForm = useCallback(() => {
    setDesignation('');
    setCommonName('');
    setDescription('');
    setProperties([]);
    setCoordinates({ x: '', y: '', z: '' });
    setShowCoordinates(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onOpenChange(false);
  }, [resetForm, onOpenChange]);

  const addProperty = useCallback(() => {
    setProperties(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: '',
        value: '',
        dataType: 'String',
      }
    ]);
  }, []);

  const removeProperty = useCallback((id: string) => {
    setProperties(prev => prev.filter(p => p.id !== id));
  }, []);

  const updateProperty = useCallback((id: string, field: keyof AssetProperty, value: string) => {
    setProperties(prev => 
      prev.map(p => p.id === id ? { ...p, [field]: value } : p)
    );
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!parentNode?.fmGuid) {
      toast.error('No parent room selected');
      return;
    }

    if (!designation.trim()) {
      toast.error('Designation/number is required');
      return;
    }

    setIsLoading(true);

    try {
      // Generate a new fmGuid for this asset
      const newFmGuid = generateFmGuid();

      // Build properties array with proper data types
      const formattedProperties = properties
        .filter(p => p.name.trim() && p.value.trim())
        .map(p => ({
          name: p.name.trim(),
          value: p.value.trim(),
          dataType: DataType[p.dataType],
        }));

      // Add description as a property if provided
      if (description.trim()) {
        formattedProperties.push({
          name: 'Description',
          value: description.trim(),
          dataType: DataType.String,
        });
      }

      // Parse coordinates if provided
      const coordX = coordinates.x ? parseFloat(coordinates.x) : null;
      const coordY = coordinates.y ? parseFloat(coordinates.y) : null;
      const coordZ = coordinates.z ? parseFloat(coordinates.z) : null;

      const payload = {
        fmGuid: newFmGuid,
        parentSpaceFmGuid: parentNode.fmGuid,
        designation: designation.trim(),
        commonName: commonName.trim() || undefined,
        properties: formattedProperties.length > 0 ? formattedProperties : undefined,
        coordinates: (coordX !== null || coordY !== null || coordZ !== null) 
          ? { x: coordX, y: coordY, z: coordZ } 
          : undefined,
      };

      console.log('Creating asset with payload:', payload);

      const { data, error } = await supabase.functions.invoke('asset-plus-create', {
        body: payload,
      });

      if (error) {
        throw new Error(error.message || 'Could not create object');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Unknown error during creation');
      }

      toast.success('Object created!', {
        description: `${designation} has been added to ${parentNode.commonName || parentNode.name}`,
      });

      handleClose();
      onAssetCreated?.();

    } catch (error) {
      console.error('Failed to create asset:', error);
      toast.error('Could not create object', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    } finally {
      setIsLoading(false);
    }
  }, [parentNode, designation, commonName, description, properties, coordinates, handleClose, onAssetCreated]);

  if (!parentNode) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Object</DialogTitle>
          <DialogDescription>
            Create a new object (ObjectType 4) in the room <strong>{parentNode.commonName || parentNode.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="designation">Designation / Number *</Label>
              <Input
                id="designation"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. DOE-001, Fan-A1"
                required
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Primary identifier for the object
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="commonName">Name (optional)</Label>
              <Input
                id="commonName"
                value={commonName}
                onChange={(e) => setCommonName(e.target.value)}
                placeholder="e.g. Ventilation Fan"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Free text description of the object..."
                rows={2}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Extended Properties */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Extended Properties</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addProperty}
                disabled={isLoading}
                className="gap-1"
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>

            {properties.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md">
                No extended properties. Click "Add" to add some.
              </p>
            ) : (
              <div className="space-y-3">
                {properties.map((prop) => (
                  <div key={prop.id} className="flex gap-2 items-start p-3 border rounded-md bg-muted/30">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Property name"
                        value={prop.name}
                        onChange={(e) => updateProperty(prop.id, 'name', e.target.value)}
                        disabled={isLoading}
                        className="text-sm"
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="Value"
                          value={prop.value}
                          onChange={(e) => updateProperty(prop.id, 'value', e.target.value)}
                          disabled={isLoading}
                          className="flex-1 text-sm"
                        />
                        <Select
                          value={prop.dataType}
                          onValueChange={(value) => updateProperty(prop.id, 'dataType', value)}
                          disabled={isLoading}
                        >
                          <SelectTrigger className="w-[140px] text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DATA_TYPE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeProperty(prop.id)}
                      disabled={isLoading}
                      className="h-8 w-8 shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Coordinates Section (collapsible, for future 3D picker) */}
          <Collapsible open={showCoordinates} onOpenChange={setShowCoordinates}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-between"
                disabled={isLoading}
              >
                <span className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  3D Coordinates
                </span>
                <span className="text-xs text-muted-foreground">
                  {showCoordinates ? 'Hide' : 'Show'}
                </span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Set the 3D position for this asset. In the future, you can pick coordinates directly from the 3D viewer.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="coord-x" className="text-xs">X</Label>
                  <Input
                    id="coord-x"
                    type="number"
                    step="0.001"
                    value={coordinates.x}
                    onChange={(e) => setCoordinates(prev => ({ ...prev, x: e.target.value }))}
                    placeholder="0.000"
                    disabled={isLoading}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="coord-y" className="text-xs">Y</Label>
                  <Input
                    id="coord-y"
                    type="number"
                    step="0.001"
                    value={coordinates.y}
                    onChange={(e) => setCoordinates(prev => ({ ...prev, y: e.target.value }))}
                    placeholder="0.000"
                    disabled={isLoading}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="coord-z" className="text-xs">Z</Label>
                  <Input
                    id="coord-z"
                    type="number"
                    step="0.001"
                    value={coordinates.z}
                    onChange={(e) => setCoordinates(prev => ({ ...prev, z: e.target.value }))}
                    placeholder="0.000"
                    disabled={isLoading}
                    className="text-sm"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Parent Info */}
          <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-md">
            <p><strong>Parent Room:</strong> {parentNode.commonName || parentNode.name}</p>
            <p className="font-mono mt-1">FMGUID: {parentNode.fmGuid}</p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Object'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
