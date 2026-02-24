import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  getContextMenuSettings,
  saveContextMenuSettings,
  type ContextMenuItemConfig,
} from '@/components/viewer/ContextMenuSettings';

const ContextMenuSettingsPanel: React.FC = () => {
  const [items, setItems] = useState<ContextMenuItemConfig[]>(getContextMenuSettings);

  const toggle = (id: string) => {
    const updated = items.map((i) =>
      i.id === id ? { ...i, visible: !i.visible } : i,
    );
    setItems(updated);
    saveContextMenuSettings(updated);
  };

  const geminusItems = items.filter((i) => i.group === 'geminus');
  const viewerItems = items.filter((i) => i.group === 'viewer');

  const renderGroup = (title: string, group: ContextMenuItemConfig[]) => (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      {group.map((item) => (
        <div key={item.id} className="flex items-center justify-between">
          <Label htmlFor={`ctx-${item.id}`} className="text-sm">
            {item.label}
          </Label>
          <Switch
            id={`ctx-${item.id}`}
            checked={item.visible}
            onCheckedChange={() => toggle(item.id)}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Choose which commands appear in the 3D viewer right-click menu.
      </p>
      {renderGroup('Geminus', geminusItems)}
      {renderGroup('Viewer', viewerItems)}
    </div>
  );
};

export default ContextMenuSettingsPanel;
