import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Loader2,
  Circle,
  Image as ImageIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface AnnotationSymbol {
  id: string;
  symbol_id: number | null;
  name: string;
  category: string;
  color: string;
  icon_url: string | null;
  marker_html: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

// Predefined color palette
const COLOR_PALETTE = [
  '#EF4444', // Red
  '#F97316', // Orange
  '#F59E0B', // Amber
  '#EAB308', // Yellow
  '#84CC16', // Lime
  '#22C55E', // Green
  '#10B981', // Emerald
  '#14B8A6', // Teal
  '#06B6D4', // Cyan
  '#0EA5E9', // Sky
  '#3B82F6', // Blue
  '#6366F1', // Indigo
  '#8B5CF6', // Violet
  '#A855F7', // Purple
  '#D946EF', // Fuchsia
  '#EC4899', // Pink
  '#F43F5E', // Rose
  '#6B7280', // Gray
];

const SymbolSettings: React.FC = () => {
  const { toast } = useToast();
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingSymbol, setEditingSymbol] = useState<AnnotationSymbol | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    color: '#3B82F6',
    icon_url: '',
    marker_html: '',
    is_default: false,
  });

  const fetchSymbols = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('annotation_symbols')
        .select('*')
        .order('name');

      if (error) throw error;
      setSymbols((data || []) as AnnotationSymbol[]);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Fel vid hämtning',
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSymbols();
  }, []);

  const handleOpenCreate = () => {
    setEditingSymbol(null);
    setFormData({
      name: '',
      category: '',
      color: '#3B82F6',
      icon_url: '',
      marker_html: '',
      is_default: false,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (symbol: AnnotationSymbol) => {
    setEditingSymbol(symbol);
    setFormData({
      name: symbol.name,
      category: symbol.category,
      color: symbol.color,
      icon_url: symbol.icon_url || '',
      marker_html: symbol.marker_html || '',
      is_default: symbol.is_default,
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.category) {
      toast({
        variant: 'destructive',
        title: 'Validering',
        description: 'Namn och kategori krävs',
      });
      return;
    }

    setIsSaving(true);
    try {
      const symbolData = {
        name: formData.name,
        category: formData.category,
        color: formData.color,
        icon_url: formData.icon_url || null,
        marker_html: formData.marker_html || null,
        is_default: formData.is_default,
      };

      if (editingSymbol) {
        // Update existing
        const { error } = await supabase
          .from('annotation_symbols')
          .update(symbolData)
          .eq('id', editingSymbol.id);

        if (error) throw error;

        toast({
          title: 'Symbol uppdaterad',
          description: `${formData.name} har uppdaterats`,
        });
      } else {
        // Create new
        const { error } = await supabase
          .from('annotation_symbols')
          .insert(symbolData);

        if (error) throw error;

        toast({
          title: 'Symbol skapad',
          description: `${formData.name} har lagts till`,
        });
      }

      setIsDialogOpen(false);
      fetchSymbols();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Fel',
        description: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (symbol: AnnotationSymbol) => {
    if (!confirm(`Ta bort "${symbol.name}"?`)) return;

    try {
      const { error } = await supabase
        .from('annotation_symbols')
        .delete()
        .eq('id', symbol.id);

      if (error) throw error;

      toast({
        title: 'Symbol borttagen',
        description: `${symbol.name} har tagits bort`,
      });
      fetchSymbols();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Fel',
        description: error.message,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Konfigurera hur olika typer av assets visas som annotationer i 3D-viewern.
        </p>
        <Button onClick={handleOpenCreate} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Ny symbol
        </Button>
      </div>

      <ScrollArea className="h-[350px]">
        {symbols.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Circle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Inga symboler konfigurerade</p>
            <p className="text-xs mt-1">Klicka "Ny symbol" för att skapa en</p>
          </div>
        ) : (
          <Accordion type="single" collapsible className="space-y-2">
            {symbols.map((symbol) => (
              <AccordionItem 
                key={symbol.id} 
                value={symbol.id}
                className="border rounded-lg bg-muted/30 overflow-hidden"
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                  <div className="flex items-center gap-3 flex-1">
                    {/* Color indicator or icon */}
                    {symbol.icon_url ? (
                      <img
                        src={symbol.icon_url}
                        alt={symbol.name}
                        className="w-6 h-6 rounded"
                      />
                    ) : (
                      <div
                        className="w-6 h-6 rounded-full border-2"
                        style={{ backgroundColor: symbol.color, borderColor: symbol.color }}
                      />
                    )}
                    <div className="text-left">
                      <span className="font-medium text-sm">{symbol.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {symbol.symbol_id && (
                          <Badge variant="outline" className="text-[10px] font-mono">
                            #{symbol.symbol_id}
                          </Badge>
                        )}
                        {symbol.is_default && (
                          <Badge variant="secondary" className="text-[10px]">
                            Standard
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 pt-2">
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium">Kategori:</span> {symbol.category}
                    </div>
                    
                    {symbol.icon_url && (
                      <div className="flex items-center gap-2">
                        <img
                          src={symbol.icon_url}
                          alt={symbol.name}
                          className="w-10 h-10 object-contain rounded border"
                        />
                        <span className="text-xs text-muted-foreground truncate flex-1">
                          {symbol.icon_url.split('/').pop()}
                        </span>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEdit(symbol)}
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        Redigera
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(symbol)}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Ta bort
                      </Button>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </ScrollArea>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingSymbol ? 'Edit Symbol' : 'New Annotation Symbol'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="symbol-name">Name</Label>
              <Input
                id="symbol-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Fire Symbols"
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="symbol-category">Category</Label>
              <Input
                id="symbol-category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="e.g. Fire, Sensor, Sprinkler"
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">
                Used to match assets based on category or name
              </p>
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${
                      formData.color === color
                        ? 'ring-2 ring-primary ring-offset-2'
                        : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData({ ...formData, color })}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Label htmlFor="custom-color" className="text-xs text-muted-foreground">
                  Custom color:
                </Label>
                <input
                  id="custom-color"
                  type="color"
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-10 h-8 rounded cursor-pointer"
                />
                <Input
                  value={formData.color}
                  onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  className="w-24 h-8 text-xs"
                  maxLength={7}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor="symbol-icon">Icon (optional)</Label>
              </div>
              
              {/* Preview */}
              {formData.icon_url && (
                <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
                  <img
                    src={formData.icon_url}
                    alt="Symbol preview"
                    className="w-10 h-10 object-contain rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    {formData.icon_url.split('/').pop()}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFormData({ ...formData, icon_url: '' })}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
              
              {/* File upload */}
              <div className="flex gap-2">
                <Input
                  id="symbol-icon"
                  value={formData.icon_url}
                  onChange={(e) => setFormData({ ...formData, icon_url: e.target.value })}
                  placeholder="URL or upload..."
                  className="h-11 flex-1"
                />
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      
                      try {
                        const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
                        const { data, error } = await supabase.storage
                          .from('symbol-icons')
                          .upload(fileName, file);
                        
                        if (error) throw error;
                        
                        const { data: { publicUrl } } = supabase.storage
                          .from('symbol-icons')
                          .getPublicUrl(data.path);
                        
                        setFormData({ ...formData, icon_url: publicUrl });
                        toast({
                          title: 'Icon uploaded',
                          description: 'The image has been uploaded',
                        });
                      } catch (error: any) {
                        toast({
                          variant: 'destructive',
                          title: 'Upload failed',
                          description: error.message,
                        });
                      }
                    }}
                  />
                  <Button type="button" variant="outline" className="h-11" asChild>
                    <span>
                      <ImageIcon className="h-4 w-4" />
                    </span>
                  </Button>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload an image or enter a URL
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="marker-html">Anpassad HTML (valfritt)</Label>
              <textarea
                id="marker-html"
                value={formData.marker_html}
                onChange={(e) => setFormData({ ...formData, marker_html: e.target.value })}
                placeholder="<div class='custom-marker'>...</div>"
                className="w-full h-20 px-3 py-2 text-sm border rounded-md resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Egen HTML för avancerade markörer
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is-default"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="rounded"
              />
              <Label htmlFor="is-default" className="text-sm font-normal">
                Använd som standard om ingen kategori matchar
              </Label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              disabled={isSaving}
            >
              <X className="h-4 w-4 mr-2" />
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {editingSymbol ? 'Uppdatera' : 'Skapa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SymbolSettings;
