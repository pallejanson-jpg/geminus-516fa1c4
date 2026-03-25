import React, { useState, useEffect } from 'react';
import { Settings2, Plus, Pencil, Trash2, Save, X, RefreshCw, AlertCircle, ImageIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import ExampleImagesUpload from './ExampleImagesUpload';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface DetectionTemplate {
  id: string;
  name: string;
  object_type: string;
  description: string | null;
  ai_prompt: string;
  default_category: string | null;
  default_symbol_id: string | null;
  is_active: boolean;
  example_images: string[] | null;
  created_at: string;
  updated_at: string;
}

interface AnnotationSymbol {
  id: string;
  name: string;
  icon_url: string | null;
  category: string;
  color: string;
}

interface TemplateManagementProps {
  onTemplatesChanged?: () => void;
}

const TemplateManagement: React.FC<TemplateManagementProps> = ({ onTemplatesChanged }) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [templates, setTemplates] = useState<DetectionTemplate[]>([]);
  const [symbols, setSymbols] = useState<AnnotationSymbol[]>([]);
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
    default_symbol_id: '',
    is_active: true,
    example_images: [] as string[],
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load templates and symbols in parallel
      const [templatesResult, symbolsResult] = await Promise.all([
        supabase
          .from('detection_templates')
          .select('*')
          .order('name'),
        supabase
          .from('annotation_symbols')
          .select('id, name, icon_url, category, color')
          .order('name'),
      ]);

      if (templatesResult.error) throw templatesResult.error;
      if (symbolsResult.error) throw symbolsResult.error;
      
      setTemplates(templatesResult.data || []);
      setSymbols(symbolsResult.data || []);
    } catch (error: any) {
      toast({
        title: 'Loading error',
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
      default_symbol_id: '',
      is_active: true,
      example_images: [],
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
      default_symbol_id: template.default_symbol_id || '',
      is_active: template.is_active,
      example_images: template.example_images || [],
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.object_type.trim() || !formData.ai_prompt.trim()) {
      toast({
        title: 'Fill in required fields',
        description: 'Name, object type and AI prompt are required.',
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
            default_symbol_id: formData.default_symbol_id || null,
            is_active: formData.is_active,
            example_images: formData.example_images,
          }
        });

        if (error) throw error;

        toast({
          title: 'Template updated',
          description: `"${formData.name}" has been saved.`,
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
            default_symbol_id: formData.default_symbol_id || null,
            is_active: formData.is_active,
            example_images: formData.example_images,
          }
        });

        if (error) throw error;

        toast({
          title: 'Template created',
          description: `"${formData.name}" has been added.`,
        });
      }

      setIsDialogOpen(false);
      loadData();
      onTemplatesChanged?.();
    } catch (error: any) {
      toast({
        title: 'Error saving',
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
        title: 'Template deleted',
        description: 'The template has been removed.',
      });

      loadData();
      onTemplatesChanged?.();
    } catch (error: any) {
      toast({
        title: 'Error deleting',
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
        title: template.is_active ? 'Template deactivated' : 'Template activated',
        description: `"${template.name}" is now ${template.is_active ? 'inactive' : 'active'}.`,
      });

      onTemplatesChanged?.();
    } catch (error: any) {
      toast({
        title: 'Error updating',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const getSymbolName = (symbolId: string | null) => {
    if (!symbolId) return null;
    const symbol = symbols.find(s => s.id === symbolId);
    return symbol?.name || null;
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
                Detection Templates
              </CardTitle>
              <CardDescription>
                Configure which objects the AI should look for and how
              </CardDescription>
            </div>
            <Button onClick={openNewTemplateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Templates control what the AI looks for in 360° images. A good AI prompt clearly 
              describes what the object looks like, where it's typically found and what distinguishes 
              it from similar objects.
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
              <h3 className="text-lg font-medium mb-2">No templates</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first detection template to start scanning
              </p>
              <Button onClick={openNewTemplateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </Button>
            </CardContent>
          </Card>
        ) : (
          templates.map(template => (
            <Card key={template.id} className={!template.is_active ? 'opacity-60' : ''}>
              <CardContent className="pt-6">
                <div className={isMobile ? 'space-y-3' : 'flex items-start justify-between gap-4'}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium">{template.name}</h3>
                      <Badge variant={template.is_active ? 'default' : 'secondary'}>
                        {template.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    {template.description && (
                      <p className="text-sm text-muted-foreground mb-2">
                        {template.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 md:gap-3 text-xs text-muted-foreground">
                      <span>Type: <code className="bg-muted px-1 rounded">{template.object_type}</code></span>
                      {template.default_category && (
                        <span>Category: <code className="bg-muted px-1 rounded">{template.default_category}</code></span>
                      )}
                      {getSymbolName(template.default_symbol_id) && (
                        <span>Symbol: <code className="bg-muted px-1 rounded">{getSymbolName(template.default_symbol_id)}</code></span>
                      )}
                      {template.example_images && template.example_images.length > 0 && (
                        <span className="flex items-center gap-1">
                          <ImageIcon className="h-3 w-3" />
                          {template.example_images.length} example images
                        </span>
                      )}
                    </div>
                    <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">AI-prompt:</p>
                      <p className="text-sm font-mono text-foreground/80 line-clamp-3">
                        {template.ai_prompt}
                      </p>
                    </div>
                  </div>
                  {/* Controls: stacked on mobile, inline on desktop */}
                  <div className={`flex items-center gap-2 ${isMobile ? 'pt-2 border-t mt-2' : 'shrink-0'}`}>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={template.is_active}
                        onCheckedChange={() => toggleActive(template)}
                      />
                      {isMobile && <span className="text-xs text-muted-foreground">{template.is_active ? 'On' : 'Off'}</span>}
                    </div>
                    <div className="flex items-center gap-1 ml-auto">
                      <Button 
                        variant="outline" 
                        size={isMobile ? 'sm' : 'icon'} 
                        onClick={() => openEditTemplateDialog(template)}
                        className={isMobile ? 'h-8 px-2' : ''}
                      >
                        <Pencil className="h-4 w-4" />
                        {isMobile && <span className="ml-1 text-xs">Edit</span>}
                      </Button>
                      <Button 
                        variant="outline" 
                        size={isMobile ? 'sm' : 'icon'}
                        onClick={() => setDeleteConfirmId(template.id)}
                        className={isMobile ? 'h-8 px-2' : ''}
                      >
                        <Trash2 className="h-4 w-4" />
                        {isMobile && <span className="ml-1 text-xs">Delete</span>}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Edit/Create Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto text-foreground">
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'New Detection Template'}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate 
                ? 'Update the settings for this detection template.'
                : 'Create a new template to teach the AI to find a new type of object.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-foreground">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Fire Extinguisher"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="object_type" className="text-foreground">Object Type *</Label>
                <Input
                  id="object_type"
                  value={formData.object_type}
                  onChange={e => setFormData({ ...formData, object_type: e.target.value })}
                  placeholder="fire_extinguisher"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-foreground">Description</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Red fire extinguishers mounted on walls"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="default_category" className="text-foreground">Default Category</Label>
                <Input
                  id="default_category"
                  value={formData.default_category}
                  onChange={e => setFormData({ ...formData, default_category: e.target.value })}
                  placeholder="Fire Safety"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="default_symbol_id" className="text-foreground">Symbol</Label>
                <Select
                  value={formData.default_symbol_id}
                  onValueChange={value => setFormData({ ...formData, default_symbol_id: value === '_none' ? '' : value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select symbol..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">
                      <span className="text-muted-foreground">No symbol</span>
                    </SelectItem>
                    {symbols.map(symbol => (
                      <SelectItem key={symbol.id} value={symbol.id}>
                        <div className="flex items-center gap-2">
                          {symbol.icon_url ? (
                            <img 
                              src={symbol.icon_url} 
                              alt="" 
                              className="h-4 w-4 object-contain"
                            />
                          ) : (
                            <div 
                              className="h-4 w-4 rounded-full" 
                              style={{ backgroundColor: symbol.color }}
                            />
                          )}
                          <span>{symbol.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai_prompt" className="text-foreground">AI-prompt *</Label>
              <Textarea
                id="ai_prompt"
                value={formData.ai_prompt}
                onChange={e => setFormData({ ...formData, ai_prompt: e.target.value })}
                placeholder="Look for red fire extinguishers mounted on walls. They are typically cylindrical, about 50-60cm tall, with a handle at the top and a hose attached. They often have a sign above them."
                rows={5}
              />
              <p className="text-xs text-muted-foreground">
                Describe in English what the object looks like, where it's typically found and what 
                distinguishes it from similar objects.
              </p>
            </div>

            {/* Example Images Upload */}
            <ExampleImagesUpload
              templateId={editingTemplate?.id}
              value={formData.example_images}
              onChange={(urls) => setFormData({ ...formData, example_images: urls })}
              disabled={isSaving}
            />

            <div className="flex items-center gap-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={checked => setFormData({ ...formData, is_active: checked })}
              />
              <Label htmlFor="is_active" className="text-foreground">Active (included in scans)</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save
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
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The template will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TemplateManagement;