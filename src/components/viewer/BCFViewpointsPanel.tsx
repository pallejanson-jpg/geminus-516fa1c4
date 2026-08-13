/**
 * BCFViewpointsPanel — Save and restore xeokit BCF viewpoints.
 *
 * Uses window.__xeokitBCF (BCFViewpointsPlugin) to capture/restore full
 * viewer state (camera, section planes, object visibility & colors).
 * Viewpoints are persisted in Supabase saved_views.bcf_viewpoint (JSONB).
 */

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Bookmark, BookmarkPlus, Trash2, Camera, X, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

interface SavedBCFView {
  id: string;
  name: string;
  description: string | null;
  bcf_viewpoint: any;
  screenshot_url: string | null;
  created_at: string;
}

interface Props {
  buildingFmGuid: string;
  buildingName: string;
}

export function BCFViewpointsPanel({ buildingFmGuid, buildingName }: Props) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedBCFView[]>([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchViews = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('saved_views')
      .select('id, name, description, bcf_viewpoint, screenshot_url, created_at')
      .eq('building_fm_guid', buildingFmGuid)
      .not('bcf_viewpoint', 'is', null)
      .order('created_at', { ascending: false });
    setViews((data as SavedBCFView[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open) fetchViews();
  }, [open, buildingFmGuid]);

  const captureScreenshot = (): string | null => {
    try {
      const viewer = (window as any).__nativeXeokitViewer;
      if (!viewer?.getSnapshot) return null;
      return viewer.getSnapshot({ format: 'png', width: 400, height: 250 });
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    const bcf = (window as any).__xeokitBCF;
    const viewer = (window as any).__nativeXeokitViewer;
    if (!bcf) { toast.error('BCF plugin not ready'); return; }

    const name = newName.trim() || `View ${new Date().toLocaleString('sv-SE').slice(0, 16)}`;
    setSaving(true);

    try {
      const viewpoint = bcf.getViewpoint({
        spacesVisible: true,
        spacesTranslucent: true,
        openingsVisible: false,
      });

      // Capture camera for classic fields too
      const cam = viewer?.camera;
      const screenshot = captureScreenshot();

      // Upload screenshot to storage if captured
      let screenshotUrl: string | null = null;
      if (screenshot) {
        const base64 = screenshot.split(',')[1];
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const filename = `${buildingFmGuid}/${Date.now()}.png`;
        const { error: upErr } = await supabase.storage
          .from('saved-view-screenshots')
          .upload(filename, bytes, { contentType: 'image/png', upsert: true });
        if (!upErr) {
          const { data: urlData } = supabase.storage.from('saved-view-screenshots').getPublicUrl(filename);
          screenshotUrl = urlData?.publicUrl || null;
        }
      }

      const { error } = await supabase.from('saved_views').insert({
        name,
        building_fm_guid: buildingFmGuid,
        building_name: buildingName,
        bcf_viewpoint: viewpoint,
        screenshot_url: screenshotUrl,
        camera_eye: cam?.eye ? [...cam.eye] : null,
        camera_look: cam?.look ? [...cam.look] : null,
        camera_up: cam?.up ? [...cam.up] : null,
        camera_projection: cam?.projection || 'perspective',
        view_mode: '3d',
      });

      if (error) throw error;
      setNewName('');
      toast.success(`Viewpoint "${name}" saved`);
      fetchViews();
    } catch (e: any) {
      toast.error('Failed to save viewpoint: ' + (e?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = (view: SavedBCFView) => {
    const bcf = (window as any).__xeokitBCF;
    if (!bcf) { toast.error('BCF plugin not ready'); return; }
    try {
      bcf.setViewpoint(view.bcf_viewpoint);
      toast.success(`Loaded "${view.name}"`);
    } catch (e: any) {
      toast.error('Failed to restore viewpoint: ' + (e?.message || 'unknown error'));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const { error } = await supabase.from('saved_views').delete().eq('id', id);
    if (error) { toast.error('Delete failed'); return; }
    toast.success(`Deleted "${name}"`);
    setViews(v => v.filter(x => x.id !== id));
  };

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost" size="sm"
            onClick={() => setOpen(v => !v)}
            className={`gap-1.5 px-3 h-8 text-xs ${open ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Views</span>
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Saved BCF viewpoints</TooltipContent>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 bg-black/90 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-xs font-semibold text-white">Saved Viewpoints</span>
            <Button variant="ghost" size="icon" className="h-6 w-6 text-white/60 hover:text-white" onClick={() => setOpen(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Save new */}
          <div className="flex gap-1.5 p-2 border-b border-white/10">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Viewpoint name…"
              className="h-7 text-xs bg-white/10 border-white/20 text-white placeholder:text-white/40"
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 shrink-0 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={handleSave} disabled={saving}
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save current viewpoint</TooltipContent>
            </Tooltip>
          </div>

          {/* List */}
          <ScrollArea className="max-h-72">
            {loading && (
              <p className="text-xs text-white/40 text-center py-4">Loading…</p>
            )}
            {!loading && views.length === 0 && (
              <p className="text-xs text-white/40 text-center py-4">No saved viewpoints yet</p>
            )}
            {views.map(view => (
              <div
                key={view.id}
                className="group flex items-center gap-2 px-3 py-2 hover:bg-white/5 border-b border-white/5 last:border-0"
              >
                {/* Thumbnail */}
                {view.screenshot_url ? (
                  <img
                    src={view.screenshot_url}
                    alt={view.name}
                    className="h-10 w-16 rounded object-cover shrink-0 opacity-80 group-hover:opacity-100"
                  />
                ) : (
                  <div className="h-10 w-16 rounded bg-white/10 flex items-center justify-center shrink-0">
                    <Camera className="h-4 w-4 text-white/30" />
                  </div>
                )}

                {/* Name + date */}
                <button
                  className="flex-1 text-left min-w-0"
                  onClick={() => handleLoad(view)}
                >
                  <p className="text-xs font-medium text-white truncate">{view.name}</p>
                  <p className="text-[10px] text-white/40">
                    {new Date(view.created_at).toLocaleString('sv-SE').slice(0, 16)}
                  </p>
                </button>

                {/* Delete */}
                <Button
                  variant="ghost" size="icon"
                  className="h-6 w-6 text-white/0 group-hover:text-white/50 hover:text-red-400 hover:bg-white/10 shrink-0"
                  onClick={() => handleDelete(view.id, view.name)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
