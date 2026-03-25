/**
 * ViewerThemeSettings - Settings page for managing viewer color themes
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Palette, Check, X, Loader2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { useViewerTheme, ViewerTheme, ThemeColorMapping, DEFAULT_VIEWER_THEME_BACKGROUND } from '@/hooks/useViewerTheme';

// IFC categories for color mapping
const IFC_CATEGORIES = [
  { key: 'ifcwall', label: 'Väggar (Fasad)', defaultColor: '#AFAA87' },
  { key: 'ifcwallstandardcase', label: 'Väggar (Invändiga)', defaultColor: '#C2BEA2' },
  { key: 'ifcdoor', label: 'Dörrar', defaultColor: '#5B776B' },
  { key: 'ifcwindow', label: 'Fönster', defaultColor: '#C7C7C2' },
  { key: 'ifcslab', label: 'Golv/Tak', defaultColor: '#999B97' },
  { key: 'ifcroof', label: 'Tak', defaultColor: '#999B97' },
  { key: 'ifcspace', label: 'Rum', defaultColor: '#B8D4E3' },
  { key: 'ifcstair', label: 'Trappor', defaultColor: '#999B97' },
  { key: 'ifcrailing', label: 'Räcken', defaultColor: '#BDBAAB' },
  { key: 'ifcfurnishingelement', label: 'Möbler', defaultColor: '#738B77' },
  { key: 'ifcbuildingelementproxy', label: 'Entourage', defaultColor: '#738B77' },
  { key: 'ifcplate', label: 'Glas', defaultColor: '#B8D4E3' },
  { key: 'ifccurtainwall', label: 'Glasfasad', defaultColor: '#B8D4E3' },
  { key: 'default', label: 'Övrigt', defaultColor: '#EEEEEE' },
];

interface EditingTheme {
  id?: string;
  name: string;
  color_mappings: Record<string, ThemeColorMapping>;
  edge_settings: { enabled: boolean };
  background_color: string;
  space_opacity: number;
}

const ViewerThemeSettings: React.FC = () => {
  const { toast } = useToast();
  const { themes, isLoading, fetchThemes, createTheme, updateTheme, deleteTheme } = useViewerTheme();
  
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [editingTheme, setEditingTheme] = useState<EditingTheme | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Create new theme with default values
  const handleNewTheme = () => {
    const defaultMappings: Record<string, ThemeColorMapping> = {};
    IFC_CATEGORIES.forEach(cat => {
      defaultMappings[cat.key] = {
        color: cat.defaultColor,
        edges: cat.key.includes('wall') || cat.key.includes('door') || cat.key.includes('window'),
        opacity: cat.key === 'ifcspace' ? 0.25 : (cat.key === 'ifcplate' || cat.key === 'ifccurtainwall') ? 0.3 : undefined,
      };
    });

    setEditingTheme({
      name: 'Nytt tema',
      color_mappings: defaultMappings,
      edge_settings: { enabled: true },
      background_color: DEFAULT_VIEWER_THEME_BACKGROUND,
      space_opacity: 0.25,
    });
    setIsCreatingNew(true);
  };

  // Start editing existing theme
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
      background_color: theme.background_color || DEFAULT_VIEWER_THEME_BACKGROUND,
      space_opacity: theme.space_opacity ?? 0.25,
    });
    setEditingThemeId(theme.id);
    setIsCreatingNew(false);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingTheme(null);
    setEditingThemeId(null);
    setIsCreatingNew(false);
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
          background_color: editingTheme.background_color,
          space_opacity: editingTheme.space_opacity,
        });
        toast({ title: 'Theme updated', description: `"${editingTheme.name}" has been saved.` });
      } else {
        await createTheme({
          name: editingTheme.name,
          is_system: false,
          color_mappings: editingTheme.color_mappings,
          edge_settings: editingTheme.edge_settings,
          background_color: editingTheme.background_color,
          space_opacity: editingTheme.space_opacity,
        });
        toast({ title: 'Tema skapat', description: `"${editingTheme.name}" har skapats.` });
      }
      handleCancelEdit();
    } catch (err: any) {
      toast({ 
        variant: 'destructive', 
        title: 'Error', 
        description: err.message || 'Could not save theme' 
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
      if (editingThemeId === id) {
        handleCancelEdit();
      }
    } catch (err: any) {
      toast({ 
        variant: 'destructive', 
        title: 'Error', 
        description: err.message || 'Could not delete theme' 
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
          <h3 className="text-sm font-medium">Viewer Themes</h3>
          <p className="text-xs text-muted-foreground">
            Configure color themes for the 3D viewer
          </p>
        </div>
        <Button size="sm" onClick={handleNewTheme} disabled={isCreatingNew}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Theme
        </Button>
      </div>

      {/* New theme form (when creating) */}
      {isCreatingNew && editingTheme && (
        <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Create New Theme
            </h4>
          </div>
          
          {/* Theme name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={editingTheme.name}
              onChange={(e) => setEditingTheme({ ...editingTheme, name: e.target.value })}
              placeholder="Theme name"
              className="h-8 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Background color</Label>
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 rounded border border-border"
                style={{ background: editingTheme.background_color }}
              />
              <Input
                value={editingTheme.background_color}
                onChange={(e) => setEditingTheme({ ...editingTheme, background_color: e.target.value })}
                placeholder={DEFAULT_VIEWER_THEME_BACKGROUND}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <Separator />

          {/* Color mappings */}
          <div className="space-y-2">
            <Label className="text-xs">Color Mappings</Label>
            <ScrollArea className="h-[200px] pr-3">
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
                          <span className="text-[10px] text-muted-foreground">Edge</span>
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
            <Label className="text-xs">Space Opacity</Label>
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
              onClick={handleCancelEdit}
              disabled={isSaving}
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
               Cancel
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
              Save Theme
            </Button>
          </div>
        </div>
      )}

      {/* Theme list as Accordion */}
      <Accordion type="single" collapsible className="space-y-2">
        {themes.map((theme) => (
          <AccordionItem 
            key={theme.id} 
            value={theme.id} 
            className="border rounded-lg bg-muted/30 overflow-hidden"
          >
            <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50 [&[data-state=open]]:bg-muted/50">
              <div className="flex items-center gap-2 flex-1">
                <Palette className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{theme.name}</span>
                {theme.is_system && (
                  <Badge variant="secondary" className="text-[10px]">System</Badge>
                )}
                {/* Color preview swatches */}
                <div className="flex gap-0.5 ml-2">
                  {Object.entries(theme.color_mappings || {}).slice(0, 6).map(([key, mapping]) => (
                    <div
                      key={key}
                      className="w-3.5 h-3.5 rounded border border-border/50"
                      style={{ backgroundColor: (mapping as ThemeColorMapping).color }}
                    />
                  ))}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2">
              {editingThemeId === theme.id && editingTheme ? (
                // Editing mode
                <div className="space-y-4">
                  {/* Theme name */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={editingTheme.name}
                      onChange={(e) => setEditingTheme({ ...editingTheme, name: e.target.value })}
                      placeholder="Theme name"
                      className="h-8 text-sm"
                    />
                  </div>

                   <div className="space-y-1.5">
                     <Label className="text-xs">Background color</Label>
                     <div className="flex items-center gap-2">
                       <div
                         className="h-8 w-8 rounded border border-border"
                         style={{ background: editingTheme.background_color }}
                       />
                       <Input
                         value={editingTheme.background_color}
                         onChange={(e) => setEditingTheme({ ...editingTheme, background_color: e.target.value })}
                         placeholder={DEFAULT_VIEWER_THEME_BACKGROUND}
                         className="h-8 text-sm"
                       />
                     </div>
                   </div>

                  <Separator />

                  {/* Color mappings */}
                  <div className="space-y-2">
                    <Label className="text-xs">Color Mappings</Label>
                    <ScrollArea className="h-[200px] pr-3">
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
                                  <span className="text-[10px] text-muted-foreground">Edge</span>
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
                    <Label className="text-xs">Space Opacity</Label>
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
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                    >
                      <X className="h-3.5 w-3.5 mr-1.5" />
                      Cancel
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
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                // View mode
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {Object.keys(theme.color_mappings || {}).length} color mappings • 
                    Background: {theme.background_color || DEFAULT_VIEWER_THEME_BACKGROUND} • 
                    Space opacity: {Math.round((theme.space_opacity ?? 0.25) * 100)}%
                  </p>
                  
                  {/* All color swatches */}
                  <div className="flex gap-1 flex-wrap">
                    {Object.entries(theme.color_mappings || {}).map(([key, mapping]) => (
                      <div
                        key={key}
                        className="w-5 h-5 rounded border border-border"
                        style={{ backgroundColor: (mapping as ThemeColorMapping).color }}
                        title={IFC_CATEGORIES.find(c => c.key === key)?.label || key}
                      />
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEditTheme(theme)}
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                    {!theme.is_system && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteConfirmId(theme.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {themes.length === 0 && (
        <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/30">
          <Palette className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No themes configured</p>
          <Button onClick={handleNewTheme} variant="outline" size="sm" className="mt-2">
            Create your first theme
          </Button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Theme?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this theme? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && handleDeleteTheme(deleteConfirmId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ViewerThemeSettings;
