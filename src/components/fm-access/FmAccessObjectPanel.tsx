import React, { useState, useEffect } from 'react';
import { FmAccessNode, CLASS_LABELS, useFmAccessApi } from '@/hooks/useFmAccessApi';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Pencil, Save, X, Trash2, Plus, RefreshCw, Building2, Layers, DoorOpen, Box, Copy } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

interface FmAccessObjectPanelProps {
  selectedNode: FmAccessNode | null;
  onRefresh: () => void;
  onCreateChild?: (parentGuid: string) => void;
}

const FmAccessObjectPanel: React.FC<FmAccessObjectPanelProps> = ({ selectedNode, onRefresh, onCreateChild }) => {
  const { getObject, updateObject, deleteObject, loading } = useFmAccessApi();
  const { toast } = useToast();
  const [detail, setDetail] = useState<FmAccessNode | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editProps, setEditProps] = useState<Record<string, string>>({});

  const guid = selectedNode?.guid || selectedNode?.systemGuid;

  useEffect(() => {
    if (!guid) { setDetail(null); return; }
    setDetailLoading(true);
    getObject(guid).then(d => {
      setDetail(d);
      setDetailLoading(false);
    });
  }, [guid]);

  const displayNode = detail || selectedNode;
  if (!displayNode) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-8">
        Select an object in the tree to view details.
      </div>
    );
  }

  const nodeGuid = displayNode.guid || displayNode.systemGuid || '';
  const name = displayNode.objectName || displayNode.name || 'Unnamed';
  const classLabel = displayNode.classId ? CLASS_LABELS[displayNode.classId] || displayNode.className : displayNode.className;
  const props = displayNode.properties || {};
  const propEntries = Object.entries(props).filter(([k]) => !k.startsWith('_'));

  const handleEdit = () => {
    setEditing(true);
    setEditName(name);
    const ep: Record<string, string> = {};
    propEntries.forEach(([k, v]) => { ep[k] = String(v ?? ''); });
    setEditProps(ep);
  };

  const handleSave = async () => {
    if (!nodeGuid) return;
    const changedProps: Record<string, any> = {};
    propEntries.forEach(([k]) => {
      if (editProps[k] !== String(props[k] ?? '')) changedProps[k] = editProps[k];
    });
    await updateObject(nodeGuid, editName !== name ? editName : undefined, Object.keys(changedProps).length ? changedProps : undefined);
    setEditing(false);
    onRefresh();
  };

  const handleDelete = async () => {
    if (!nodeGuid) return;
    await deleteObject(nodeGuid);
    onRefresh();
  };

  const copyGuid = () => {
    navigator.clipboard.writeText(nodeGuid);
    toast({ title: 'GUID copied' });
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            {editing ? (
              <Input value={editName} onChange={e => setEditName(e.target.value)} className="text-lg font-semibold" />
            ) : (
              <h3 className="text-lg font-semibold text-foreground leading-tight">{name}</h3>
            )}
            {detailLoading && <Loader2 size={16} className="animate-spin text-muted-foreground flex-shrink-0 mt-1" />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {classLabel && <Badge variant="secondary">{classLabel}</Badge>}
            {displayNode.classId && <Badge variant="outline">Class {displayNode.classId}</Badge>}
            {displayNode.objectId && <Badge variant="outline">ID {displayNode.objectId}</Badge>}
          </div>
          {nodeGuid && (
            <button onClick={copyGuid} className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              <Copy size={10} /> {nodeGuid}
            </button>
          )}
        </div>

        <Separator />

        {/* Properties */}
        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase mb-2">Properties</h4>
          {propEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No properties.</p>
          ) : (
            <div className="space-y-1.5">
              {propEntries.map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground truncate">{key}</span>
                  {editing ? (
                    <Input
                      value={editProps[key] || ''}
                      onChange={e => setEditProps(p => ({ ...p, [key]: e.target.value }))}
                      className="h-7 text-sm max-w-[200px]"
                    />
                  ) : (
                    <span className="text-foreground truncate text-right max-w-[200px]">{String(value ?? '—')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={handleSave} disabled={loading}>
                <Save size={14} className="mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X size={14} className="mr-1" /> Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={handleEdit}>
                <Pencil size={14} className="mr-1" /> Redigera
              </Button>
              <Button size="sm" variant="outline" onClick={() => onRefresh()}>
                <RefreshCw size={14} className="mr-1" /> Uppdatera
              </Button>
              {onCreateChild && nodeGuid && (
                <Button size="sm" variant="outline" onClick={() => onCreateChild(nodeGuid)}>
                  <Plus size={14} className="mr-1" /> Skapa underobj.
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive">
                    <Trash2 size={14} className="mr-1" /> Radera
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Radera objekt?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Objektet "{name}" raderas permanent från FM Access. Denna åtgärd kan inte ångras.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Avbryt</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Radera</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>

        {/* Children summary */}
        {displayNode.children && displayNode.children.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase mb-1">
                Underordnade ({displayNode.children.length})
              </h4>
              <div className="text-sm text-muted-foreground">
                {Object.entries(
                  displayNode.children.reduce((acc, c) => {
                    const label = c.classId ? CLASS_LABELS[c.classId] || `Klass ${c.classId}` : 'Okänd';
                    acc[label] = (acc[label] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>)
                ).map(([label, count]) => (
                  <span key={label} className="mr-3">{count} {label}</span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
};

export default FmAccessObjectPanel;
