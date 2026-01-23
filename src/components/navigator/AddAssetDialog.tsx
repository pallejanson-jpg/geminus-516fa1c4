import React, { useState, useCallback } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
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
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { NavigatorNode } from './TreeNode';

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
  { value: 'Int32', label: 'Heltal (32-bit)' },
  { value: 'Int64', label: 'Heltal (64-bit)' },
  { value: 'Decimal', label: 'Decimaltal' },
  { value: 'DateTime', label: 'Datum/Tid' },
  { value: 'Bool', label: 'Ja/Nej' },
];

interface AssetProperty {
  id: string;
  name: string;
  value: string;
  dataType: DataTypeKey;
}

interface AddAssetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentNode: NavigatorNode | null;
  onAssetCreated?: () => void;
}

export function AddAssetDialog({ open, onOpenChange, parentNode, onAssetCreated }: AddAssetDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [designation, setDesignation] = useState('');
  const [commonName, setCommonName] = useState('');
  const [description, setDescription] = useState('');
  const [properties, setProperties] = useState<AssetProperty[]>([]);

  const resetForm = useCallback(() => {
    setDesignation('');
    setCommonName('');
    setDescription('');
    setProperties([]);
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
      toast.error('Inget föräldrarum valt');
      return;
    }

    if (!designation.trim()) {
      toast.error('Beteckning/nummer krävs');
      return;
    }

    setIsLoading(true);

    try {
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

      const payload = {
        parentSpaceFmGuid: parentNode.fmGuid,
        designation: designation.trim(),
        commonName: commonName.trim() || undefined,
        properties: formattedProperties.length > 0 ? formattedProperties : undefined,
      };

      console.log('Creating asset with payload:', payload);

      const { data, error } = await supabase.functions.invoke('asset-plus-create', {
        body: payload,
      });

      if (error) {
        throw new Error(error.message || 'Kunde inte skapa objekt');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Okänt fel vid skapande');
      }

      toast.success('Objekt skapat!', {
        description: `${designation} har lagts till i ${parentNode.commonName || parentNode.name}`,
      });

      handleClose();
      onAssetCreated?.();

    } catch (error) {
      console.error('Failed to create asset:', error);
      toast.error('Kunde inte skapa objekt', {
        description: error instanceof Error ? error.message : 'Ett oväntat fel uppstod',
      });
    } finally {
      setIsLoading(false);
    }
  }, [parentNode, designation, commonName, description, properties, handleClose, onAssetCreated]);

  if (!parentNode) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lägg till nytt objekt</DialogTitle>
          <DialogDescription>
            Skapa ett nytt objekt (ObjectType 4) i rummet <strong>{parentNode.commonName || parentNode.name}</strong>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="designation">Beteckning / Nummer *</Label>
              <Input
                id="designation"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="t.ex. DOE-001, Fläkt-A1"
                required
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Primär identifierare för objektet
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="commonName">Namn (frivilligt)</Label>
              <Input
                id="commonName"
                value={commonName}
                onChange={(e) => setCommonName(e.target.value)}
                placeholder="t.ex. Ventilationsfläkt"
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Beskrivning (frivilligt)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Fritext beskrivning av objektet..."
                rows={2}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Extended Properties */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Utökade egenskaper</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addProperty}
                disabled={isLoading}
                className="gap-1"
              >
                <Plus className="h-3 w-3" />
                Lägg till
              </Button>
            </div>

            {properties.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md">
                Inga utökade egenskaper. Klicka "Lägg till" för att lägga till.
              </p>
            ) : (
              <div className="space-y-3">
                {properties.map((prop) => (
                  <div key={prop.id} className="flex gap-2 items-start p-3 border rounded-md bg-muted/30">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="Egenskapsnamn"
                        value={prop.name}
                        onChange={(e) => updateProperty(prop.id, 'name', e.target.value)}
                        disabled={isLoading}
                        className="text-sm"
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="Värde"
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

          {/* Parent Info */}
          <div className="text-xs text-muted-foreground p-3 bg-muted/50 rounded-md">
            <p><strong>Föräldrarum:</strong> {parentNode.commonName || parentNode.name}</p>
            <p className="font-mono mt-1">FMGUID: {parentNode.fmGuid}</p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Avbryt
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Skapar...
                </>
              ) : (
                'Skapa objekt'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
