import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Tag, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useRoomLabelConfigs, RoomLabelConfig, AVAILABLE_LABEL_FIELDS } from '@/hooks/useRoomLabelConfigs';
import { useLanguage } from '@/context/LanguageContext';

const RoomLabelSettings: React.FC = () => {
  const { t } = useLanguage();
  const {
    configs,
    loading,
    createConfig,
    updateConfig,
    deleteConfig,
  } = useRoomLabelConfigs();

  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editForm, setEditForm] = useState<Partial<RoomLabelConfig>>({});

  // Create new config
  const handleCreate = async () => {
    if (!editForm.name) return;

    await createConfig({
      name: editForm.name,
      fields: editForm.fields || ['commonName'],
      height_offset: editForm.height_offset ?? 0.05,
      font_size: editForm.font_size || 10,
      scale_with_distance: editForm.scale_with_distance ?? true,
      click_action: editForm.click_action || 'none',
      is_default: false,
      occlusion_enabled: editForm.occlusion_enabled ?? true,
      flat_on_floor: editForm.flat_on_floor ?? false,
    });

    setShowCreateDialog(false);
    setEditForm({});
  };

  // Update existing config
  const handleUpdate = async (id: string) => {
    await updateConfig(id, editForm);
    setIsEditing(null);
    setEditForm({});
  };

  // Start editing
  const startEdit = (config: RoomLabelConfig) => {
    setIsEditing(config.id);
    setEditForm({ ...config });
  };

  // Cancel editing
  const cancelEdit = () => {
    setIsEditing(null);
    setEditForm({});
  };

  // Toggle field selection
  const toggleField = (field: string) => {
    const currentFields = editForm.fields || [];
    if (currentFields.includes(field)) {
      setEditForm({ ...editForm, fields: currentFields.filter(f => f !== field) });
    } else {
      setEditForm({ ...editForm, fields: [...currentFields, field] });
    }
  };

  // Get click action label
  const getClickActionLabel = (action: string) => {
    switch (action) {
      case 'flyto': return 'Fly to room';
      case 'roomcard': return 'Show room card';
      default: return 'None';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">{t('Laddar…', 'Loading…')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">{t('Rumsetiketter', 'Room Labels')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('Konfigurera hur etiketter visas på rum i 3D-visaren', 'Configure how labels are displayed on rooms in the 3D viewer')}
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          {t('Ny konfiguration', 'New configuration')}
        </Button>
      </div>

      {/* Config list as Accordion */}
      {configs.length > 0 ? (
        <Accordion type="single" collapsible className="space-y-2">
          {configs.map((config) => (
            <AccordionItem 
              key={config.id} 
              value={config.id}
              className="border rounded-lg bg-muted/30 overflow-hidden"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50 [&[data-state=open]]:bg-muted/50">
                <div className="flex items-center gap-2 flex-1">
                  <Tag className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">{config.name}</span>
                  {config.is_default && (
                    <Badge variant="secondary" className="text-xs">Default</Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2">
                {isEditing === config.id ? (
                  // Editing mode
                  <div className="space-y-4">
                    {/* Name input */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">{t('Namn', 'Name')}</Label>
                      <Input
                        value={editForm.name || ''}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        className="h-8"
                      />
                    </div>

                    {/* Fields selection */}
                    <div className="space-y-2">
                      <Label className="text-xs">{t('Fält att visa', 'Fields to display')}</Label>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_LABEL_FIELDS.map((field) => (
                          <Badge
                            key={field.key}
                            variant={(editForm.fields || []).includes(field.key) ? 'default' : 'outline'}
                            className="cursor-pointer"
                            onClick={() => toggleField(field.key)}
                          >
                            {field.label}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Height slider */}
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label className="text-xs">{t('Höjd ovanför golv', 'Height above floor')}</Label>
                        <span className="text-xs text-muted-foreground">{(editForm.height_offset ?? 0.05).toFixed(2)}m</span>
                      </div>
                      <Slider
                        value={[editForm.height_offset ?? 0.05]}
                        onValueChange={([v]) => setEditForm({ ...editForm, height_offset: v })}
                        min={0}
                        max={2.5}
                        step={0.05}
                      />
                    </div>

                    {/* Scale with distance */}
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">{t('Skala med avstånd', 'Scale with distance')}</Label>
                      <Switch
                        checked={editForm.scale_with_distance ?? true}
                        onCheckedChange={(v) => setEditForm({ ...editForm, scale_with_distance: v })}
                      />
                    </div>

                    {/* Occlusion toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs">{t('Ocklusion', 'Occlusion')}</Label>
                        <p className="text-[10px] text-muted-foreground">{t('Dölj etiketter bakom väggar/tak', 'Hide labels behind walls/ceilings')}</p>
                      </div>
                      <Switch
                        checked={editForm.occlusion_enabled ?? true}
                        onCheckedChange={(v) => setEditForm({ ...editForm, occlusion_enabled: v })}
                      />
                    </div>

                    {/* Flat on floor toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs">{t('Platt läge', 'Flat mode')}</Label>
                        <p className="text-[10px] text-muted-foreground">{t('Lägg etiketter plant på golvet', 'Lay labels flat on the floor')}</p>
                      </div>
                      <Switch
                        checked={editForm.flat_on_floor ?? false}
                        onCheckedChange={(v) => setEditForm({ ...editForm, flat_on_floor: v })}
                      />
                    </div>

                    {/* Click action */}
                    <div className="space-y-2">
                      <Label className="text-xs">{t('Klickåtgärd', 'Click action')}</Label>
                      <Select
                        value={editForm.click_action || 'none'}
                        onValueChange={(v) => setEditForm({ ...editForm, click_action: v as any })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('Ingen', 'None')}</SelectItem>
                          <SelectItem value="flyto">{t('Flyg kameran till rum', 'Fly camera to room')}</SelectItem>
                          <SelectItem value="roomcard">{t('Visa rumskort', 'Show room card')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-2">
                      <Button size="sm" variant="ghost" onClick={cancelEdit}>
                        <X className="h-4 w-4 mr-1" />
                         {t('Avbryt', 'Cancel')}
                       </Button>
                       <Button size="sm" onClick={() => handleUpdate(config.id)}>
                         <Check className="h-4 w-4 mr-1" />
                         {t('Spara', 'Save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                       {t('Fält', 'Fields')}: {config.fields.map(f =>
                         AVAILABLE_LABEL_FIELDS.find(af => af.key === f)?.label || f
                       ).join(', ')} •
                       {t('Höjd', 'Height')}: {config.height_offset}m •
                       {t('Klick', 'Click')}: {getClickActionLabel(config.click_action)}
                    </p>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => startEdit(config)}>
                        <Edit2 className="h-4 w-4 mr-1" />
                         {t('Redigera', 'Edit')}
                       </Button>
                       <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteConfig(config.id)}>
                         <Trash2 className="h-4 w-4 mr-1" />
                         {t('Ta bort', 'Delete')}
                      </Button>
                    </div>
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : (
        <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/30">
          <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
           <p>{t('Inga etikettkonfigurationer ännu', 'No label configurations yet')}</p>
           <Button onClick={() => setShowCreateDialog(true)} variant="outline" size="sm" className="mt-2">
             {t('Skapa din första', 'Create your first')}
           </Button>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Ny etikettkonfiguration', 'New Label Configuration')}</DialogTitle>
            <DialogDescription>
              {t('Skapa en ny konfiguration för hur rumsetiketter visas i 3D-visaren.', 'Create a new configuration for how room labels appear in the 3D viewer.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('Namn', 'Name')}</Label>
              <Input
                placeholder={t("t.ex. 'Namn och area'", "e.g. 'Name and area'")}

                value={editForm.name || ''}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('Fält att visa', 'Fields to display')}</Label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_LABEL_FIELDS.map((field) => (
                  <Badge
                    key={field.key}
                    variant={(editForm.fields || []).includes(field.key) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleField(field.key)}
                  >
                    {field.label}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>{t('Höjd ovanför golv', 'Height above floor')}</Label>
                <span className="text-sm text-muted-foreground">{(editForm.height_offset ?? 0.05).toFixed(2)}m</span>
              </div>
              <Slider
                value={[editForm.height_offset ?? 0.05]}
                onValueChange={([v]) => setEditForm({ ...editForm, height_offset: v })}
                min={0}
                max={2.5}
                step={0.05}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>{t('Skala med avstånd', 'Scale with distance')}</Label>
              <Switch
                checked={editForm.scale_with_distance ?? true}
                onCheckedChange={(v) => setEditForm({ ...editForm, scale_with_distance: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>{t('Ocklusion', 'Occlusion')}</Label>
                <p className="text-xs text-muted-foreground">{t('Dölj etiketter bakom väggar/tak', 'Hide labels behind walls/ceilings')}</p>
              </div>
              <Switch
                checked={editForm.occlusion_enabled ?? true}
                onCheckedChange={(v) => setEditForm({ ...editForm, occlusion_enabled: v })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>{t('Platt läge', 'Flat mode')}</Label>
                <p className="text-xs text-muted-foreground">{t('Lägg etiketter plant på golvet', 'Lay labels flat on the floor')}</p>
              </div>
              <Switch
                checked={editForm.flat_on_floor ?? false}
                onCheckedChange={(v) => setEditForm({ ...editForm, flat_on_floor: v })}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('Klickåtgärd', 'Click action')}</Label>
              <Select
                value={editForm.click_action || 'none'}
                onValueChange={(v) => setEditForm({ ...editForm, click_action: v as any })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('Ingen', 'None')}</SelectItem>
                  <SelectItem value="flyto">{t('Flyg kameran till rum', 'Fly camera to room')}</SelectItem>
                  <SelectItem value="roomcard">{t('Visa rumskort', 'Show room card')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateDialog(false); setEditForm({}); }}>
               {t('Avbryt', 'Cancel')}
             </Button>
             <Button onClick={handleCreate} disabled={!editForm.name}>
               {t('Skapa', 'Create')}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RoomLabelSettings;
