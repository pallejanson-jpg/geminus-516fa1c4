import React, { useState, useEffect } from 'react';
import { Settings2, Plus, Pencil, Trash2, Save, X, RefreshCw, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

interface DetectionTemplate {
  id: string;
  name: string;
  object_type: string;
  description: string | null;
  ai_prompt: string;
  default_category: string | null;
  default_symbol_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TemplateManagementProps {
  onTemplatesChanged?: () => void;
}

const TemplateManagement: React.FC<TemplateManagementProps> = ({ onTemplatesChanged }) => {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<DetectionTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<DetectionTemplate | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    object_type: '',
    description: '',
    ai_prompt: '',
    default_category: '',
    is_active: true,
  });

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('detection_templates')
        .select('*')
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error: any) {
      toast({
        title: 'Fel vid laddning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openNewTemplateDialog = () => {
    setEditingTemplate(null);
    setFormData({
      name: '',
      object_type: '',
      description: '',
      ai_prompt: '',
      default_category: '',
      is_active: true,
    });
    setIsDialogOpen(true);
  };

  const openEditTemplateDialog = (template: DetectionTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      object_type: template.object_type,
      description: template.description || '',
      ai_prompt: template.ai_prompt,
      default_category: template.default_category || '',
      is_active: template.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.object_type.trim() || !formData.ai_prompt.trim()) {
      toast({
        title: 'Fyll i obligatoriska fält',
        description: 'Namn, objekttyp och AI-prompt krävs.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      if (editingTemplate) {
        // Update existing template via edge function
        const { error } = await supabase.functions.invoke('ai-asset-detection', {
          body: {
            action: 'update-template',
            templateId: editingTemplate.id,
            name: formData.name,
            object_type: formData.object_type,
            description: formData.description || null,
            ai_prompt: formData.ai_prompt,
            default_category: formData.default_category || null,
            is_active: formData.is_active,
          }
        });

        if (error) throw error;

        toast({
          title: 'Mall uppdaterad',
          description: `"${formData.name}" har sparats.`,
        });
      } else {
        // Create new template via edge function
        const { error } = await supabase.functions.invoke('ai-asset-detection', {
          body: {
            action: 'create-template',
            name: formData.name,
            object_type: formData.object_type,
            description: formData.description || null,
            ai_prompt: formData.ai_prompt,
            default_category: formData.default_category || null,
            is_active: formData.is_active,
          }
        });

        if (error) throw error;

        toast({
          title: 'Mall skapad',
          description: `"${formData.name}" har lagts till.`,
        });
      }

      setIsDialogOpen(false);
      loadTemplates();
      onTemplatesChanged?.();
    } catch (error: any) {
      toast({
        title: 'Fel vid sparning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.functions.invoke('ai-asset-detection', {
        body: { action: 'delete-template', templateId: id }
      });

      if (error) throw error;

      toast({
        title: 'Mall borttagen',
        description: 'Mallen har tagits bort.',
      });

      loadTemplates();
      onTemplatesChanged?.();
    } catch (error: any) {
      toast({
        title: 'Fel vid borttagning',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const toggleActive = async (template: DetectionTemplate) => {
    try {
      const { error } = await supabase.functions.invoke('ai-asset-detection', {
        body: {
          action: 'update-template',
          templateId: template.id,
          is_active: !template.is_active,
        }
      });

      if (error) throw error;

      setTemplates(prev => prev.map(t => 
        t.id === template.id ? { ...t, is_active: !t.is_active } : t
      ));

      toast({
        title: template.is_active ? 'Mall inaktiverad' : 'Mall aktiverad',
        description: `"${template.name}" är nu ${template.is_active ? 'inaktiv' : 'aktiv'}.`,
      });

      onTemplatesChanged?.();
    } catch (error: any) {
      toast({
        title: 'Fel vid uppdatering',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-5 w-5" />
                Detektionsmallar
              </CardTitle>
              <CardDescription>
                Konfigurera vilka objekt AI:n ska leta efter och hur
              </CardDescription>
            </div>
            <Button onClick={openNewTemplateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Ny mall
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Mallarna styr vad AI:n letar efter i 360°-bilderna. En bra AI-prompt beskriver 
              tydligt vad objektet ser ut som, var det brukar finnas och vad som skiljer det 
              från liknande objekt.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Template List */}
      <div className="space-y-4">
        {templates.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Settings2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-medium mb-2">Inga mallar</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Skapa din första detektionsmall för att börja skanna
              </p>
              <Button onClick={openNewTemplateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Skapa mall
              </Button>
            </CardContent>
          </Card>
        ) : (
          templates.map(template => (
            <Card key={template.id} className={!template.is_active ? 'opacity-60' : ''}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium">{template.name}</h3>
                      <Badge variant={template.is_active ? 'default' : 'secondary'}>
                        {template.is_active ? 'Aktiv' : 'Inaktiv'}
                      </Badge>
                    </div>
                    {template.description && (
                      <p className="text-sm text-muted-foreground mb-2">
                        {template.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Typ: <code className="bg-muted px-1 rounded">{template.object_type}</code></span>
                      {template.default_category && (
                        <span>Kategori: <code className="bg-muted px-1 rounded">{template.default_category}</code></span>
                      )}
                    </div>
                    <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">AI-prompt:</p>
                      <p className="text-sm font-mono text-foreground/80 line-clamp-3">
                        {template.ai_prompt}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={template.is_active}
                      onCheckedChange={() => toggleActive(template)}
                    />
                    <Button variant="outline" size="icon" onClick={() => openEditTemplateDialog(template)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="outline" 
                      size="icon"
                      onClick={() => setDeleteConfirmId(template.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Redigera mall' : 'Ny detektionsmall'}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate 
                ? 'Uppdatera inställningarna för denna detektionsmall.'
                : 'Skapa en ny mall för att lära AI:n att hitta en ny typ av objekt.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Namn *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Brandsläckare"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="object_type">Objekttyp *</Label>
                <Input
                  id="object_type"
                  value={formData.object_type}
                  onChange={e => setFormData({ ...formData, object_type: e.target.value })}
                  placeholder="fire_extinguisher"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Beskrivning</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Röda brandsläckare monterade på väggar"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="default_category">Standardkategori</Label>
              <Input
                id="default_category"
                value={formData.default_category}
                onChange={e => setFormData({ ...formData, default_category: e.target.value })}
                placeholder="Brandredskap"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai_prompt">AI-prompt *</Label>
              <Textarea
                id="ai_prompt"
                value={formData.ai_prompt}
                onChange={e => setFormData({ ...formData, ai_prompt: e.target.value })}
                placeholder="Look for red fire extinguishers mounted on walls. They are typically cylindrical, about 50-60cm tall, with a handle at the top and a hose attached. They often have a sign above them."
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                Beskriv på engelska hur objektet ser ut, var det brukar finnas och vad som 
                skiljer det från liknande objekt.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={checked => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active">Aktiv (inkluderas i skanningar)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Sparar...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Spara
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort mall?</AlertDialogTitle>
            <AlertDialogDescription>
              Denna åtgärd kan inte ångras. Mallen kommer att tas bort permanent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TemplateManagement;
