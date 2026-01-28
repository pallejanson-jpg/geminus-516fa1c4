/**
 * ViewerThemeSettings - Settings page for managing viewer color themes
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Palette, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useViewerTheme, ViewerTheme, ThemeColorMapping } from '@/hooks/useViewerTheme';

// IFC categories for color mapping
const IFC_CATEGORIES = [
  { key: 'ifcwall', label: 'Väggar (Fasad)', defaultColor: '#AFAA87' },
  { key: 'ifcwallstandardcase', label: 'Väggar (Invändiga)', defaultColor: '#C2BEA2' },
  { key: 'ifcdoor', label: 'Dörrar', defaultColor: '#5B776B' },
  { key: 'ifcwindow', label: 'Fönster', defaultColor: '#647D8A' },
  { key: 'ifcslab', label: 'Golv/Tak', defaultColor: '#999B97' },
  { key: 'ifcroof', label: 'Tak', defaultColor: '#999B97' },
  { key: 'ifcspace', label: 'Rum', defaultColor: '#E5E4E3' },
  { key: 'ifcstair', label: 'Trappor', defaultColor: '#999B97' },
  { key: 'ifcrailing', label: 'Räcken', defaultColor: '#647D8A' },
  { key: 'ifcfurnishingelement', label: 'Möbler', defaultColor: '#738B77' },
  { key: 'ifcbuildingelementproxy', label: 'Entourage', defaultColor: '#738B77' },
  { key: 'default', label: 'Övrigt', defaultColor: '#EEEEEE' },
];

interface EditingTheme {
  id?: string;
  name: string;
  color_mappings: Record<string, ThemeColorMapping>;
  edge_settings: { enabled: boolean };
  space_opacity: number;
}

const ViewerThemeSettings: React.FC = () => {
  const { toast } = useToast();
  const { themes, isLoading, fetchThemes, createTheme, updateTheme, deleteTheme } = useViewerTheme();
  
  const [editingTheme, setEditingTheme] = useState<EditingTheme | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Create new theme with default values
  const handleNewTheme = () => {
    const defaultMappings: Record<string, ThemeColorMapping> = {};
    IFC_CATEGORIES.forEach(cat => {
      defaultMappings[cat.key] = {
        color: cat.defaultColor,
        edges: cat.key.includes('wall') || cat.key.includes('door') || cat.key.includes('window'),
        opacity: cat.key === 'ifcspace' ? 0.25 : undefined,
      };
    });

    setEditingTheme({
      name: 'Nytt tema',
      color_mappings: defaultMappings,
      edge_settings: { enabled: true },
      space_opacity: 0.25,
    });
  };

  // Edit existing theme
  const handleEditTheme = (theme: ViewerTheme) => {
    // Fill in missing categories with defaults
    const mappings = { ...theme.color_mappings };
    IFC_CATEGORIES.forEach(cat => {
      if (!mappings[cat.key]) {
        mappings[cat.key] = {
          color: cat.defaultColor,
          edges: cat.key.includes('wall') || cat.key.includes('door') || cat.key.includes('window'),
        };
      }
    });

    setEditingTheme({
      id: theme.id,
      name: theme.name,
      color_mappings: mappings as Record<string, ThemeColorMapping>,
      edge_settings: (theme.edge_settings as { enabled: boolean }) || { enabled: true },
      space_opacity: theme.space_opacity ?? 0.25,
    });
  };

  // Save theme
  const handleSaveTheme = async () => {
    if (!editingTheme) return;

    setIsSaving(true);
    try {
      if (editingTheme.id) {
        await updateTheme(editingTheme.id, {
          name: editingTheme.name,
          color_mappings: editingTheme.color_mappings,
          edge_settings: editingTheme.edge_settings,
          space_opacity: editingTheme.space_opacity,
        });
        toast({ title: 'Tema uppdaterat', description: `"${editingTheme.name}" har sparats.` });
      } else {
        await createTheme({
          name: editingTheme.name,
          is_system: false,
          color_mappings: editingTheme.color_mappings,
          edge_settings: editingTheme.edge_settings,
          space_opacity: editingTheme.space_opacity,
        });
        toast({ title: 'Tema skapat', description: `"${editingTheme.name}" har skapats.` });
      }
      setEditingTheme(null);
    } catch (err: any) {
      toast({ 
        variant: 'destructive', 
        title: 'Fel', 
        description: err.message || 'Kunde inte spara temat' 
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete theme
  const handleDeleteTheme = async (id: string) => {
    try {
      await deleteTheme(id);
      toast({ title: 'Tema borttaget' });
      setDeleteConfirmId(null);
    } catch (err: any) {
      toast({ 
        variant: 'destructive', 
        title: 'Fel', 
        description: err.message || 'Kunde inte ta bort temat' 
      });
    }
  };

  // Update color in editing theme
  const updateColor = (key: string, color: string) => {
    if (!editingTheme) return;
    setEditingTheme({
      ...editingTheme,
      color_mappings: {
        ...editingTheme.color_mappings,
        [key]: {
          ...editingTheme.color_mappings[key],
          color,
        },
      },
    });
  };

  // Update edges setting
  const updateEdges = (key: string, edges: boolean) => {
    if (!editingTheme) return;
    setEditingTheme({
      ...editingTheme,
      color_mappings: {
        ...editingTheme.color_mappings,
        [key]: {
          ...editingTheme.color_mappings[key],
          edges,
        },
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Viewer-teman</h3>
          <p className="text-xs text-muted-foreground">
            Konfigurera färgteman för 3D-viewern
          </p>
        </div>
        {!editingTheme && (
          <Button size="sm" onClick={handleNewTheme}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nytt tema
          </Button>
        )}
      </div>

      {/* Theme list */}
      {!editingTheme && (
        <div className="space-y-2">
          {themes.map((theme) => (
            <Card key={theme.id} className="bg-muted/30">
              <CardHeader className="p-3 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">{theme.name}</CardTitle>
                    {theme.is_system && (
                      <Badge variant="secondary" className="text-[10px]">System</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleEditTheme(theme)}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    {!theme.is_system && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmId(theme.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <CardDescription className="text-xs">
                  {Object.keys(theme.color_mappings || {}).length} färgmappningar
                </CardDescription>
              </CardHeader>
              
              {/* Color preview swatches */}
              <CardContent className="p-3 pt-0">
                <div className="flex gap-1 flex-wrap">
                  {Object.entries(theme.color_mappings || {}).slice(0, 8).map(([key, mapping]) => (
                    <div
                      key={key}
                      className="w-5 h-5 rounded border border-border"
                      style={{ backgroundColor: (mapping as ThemeColorMapping).color }}
                      title={IFC_CATEGORIES.find(c => c.key === key)?.label || key}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit form */}
      {editingTheme && (
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Palette className="h-4 w-4" />
              {editingTheme.id ? 'Redigera tema' : 'Skapa nytt tema'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2 space-y-4">
            {/* Theme name */}
            <div className="space-y-1.5">
              <Label className="text-xs">Namn</Label>
              <Input
                value={editingTheme.name}
                onChange={(e) => setEditingTheme({ ...editingTheme, name: e.target.value })}
                placeholder="Temanamn"
                className="h-8 text-sm"
              />
            </div>

            <Separator />

            {/* Color mappings */}
            <div className="space-y-2">
              <Label className="text-xs">Färgmappningar</Label>
              <ScrollArea className="h-[280px] pr-3">
                <div className="space-y-2">
                  {IFC_CATEGORIES.map((cat) => {
                    const mapping = editingTheme.color_mappings[cat.key];
                    return (
                      <div key={cat.key} className="flex items-center gap-2 py-1">
                        <div className="flex-1 min-w-0">
                          <span className="text-xs truncate">{cat.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={mapping?.color || cat.defaultColor}
                            onChange={(e) => updateColor(cat.key, e.target.value)}
                            className="w-7 h-7 rounded border border-border cursor-pointer"
                          />
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">Kant</span>
                            <Switch
                              checked={mapping?.edges ?? false}
                              onCheckedChange={(checked) => updateEdges(cat.key, checked)}
                              className="scale-75"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <Separator />

            {/* Space opacity */}
            <div className="space-y-2">
              <Label className="text-xs">Rum-transparens</Label>
              <div className="flex items-center gap-3">
                <Slider
                  value={[editingTheme.space_opacity * 100]}
                  onValueChange={(v) => setEditingTheme({ 
                    ...editingTheme, 
                    space_opacity: v[0] / 100 
                  })}
                  min={0}
                  max={100}
                  step={5}
                  className="flex-1"
                />
                <span className="text-xs w-10 text-right">
                  {Math.round(editingTheme.space_opacity * 100)}%
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditingTheme(null)}
                disabled={isSaving}
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Avbryt
              </Button>
              <Button
                size="sm"
                onClick={handleSaveTheme}
                disabled={isSaving || !editingTheme.name.trim()}
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                )}
                Spara tema
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort tema?</AlertDialogTitle>
            <AlertDialogDescription>
              Är du säker på att du vill ta bort detta tema? Åtgärden kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && handleDeleteTheme(deleteConfirmId)}
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ViewerThemeSettings;
