import React, { useState, useEffect, useCallback } from "react";
import { Wrench, GripHorizontal, X, Camera, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const CATEGORIES = [
  { value: "corrective", label: "Corrective" },
  { value: "preventive", label: "Preventive" },
  { value: "inspection", label: "Inspection" },
  { value: "other", label: "Other" },
];

const PRIORITY_OPTIONS = [
  { value: "low", label: "Low", color: "bg-slate-400" },
  { value: "medium", label: "Medium", color: "bg-amber-500" },
  { value: "high", label: "High", color: "bg-orange-500" },
  { value: "critical", label: "Critical", color: "bg-destructive" },
];

interface CreateWorkOrderDialogProps {
  open: boolean;
  onClose: () => void;
  buildingName?: string;
  buildingFmGuid?: string;
  objectName?: string;
  objectFmGuid?: string;
  /** Enhanced hierarchy context */
  levelName?: string;
  levelFmGuid?: string;
  roomName?: string;
  roomFmGuid?: string;
  assetName?: string;
  assetFmGuid?: string;
  /** BCF viewpoint data */
  screenshotUrl?: string;
  viewpointJson?: any;
  selectedObjectIds?: string[];
}

const CreateWorkOrderDialog: React.FC<CreateWorkOrderDialogProps> = ({
  open,
  onClose,
  buildingName,
  buildingFmGuid,
  objectName,
  objectFmGuid,
  levelName,
  levelFmGuid,
  roomName,
  roomFmGuid,
  assetName,
  assetFmGuid,
  screenshotUrl,
  viewpointJson,
  selectedObjectIds,
}) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("corrective");
  const [priority, setPriority] = useState("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attachBcf, setAttachBcf] = useState(false);

  // Drag state
  const panelWidth = 440;
  const [position, setPosition] = useState({ x: 200, y: 100 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (open) {
      setPosition({
        x: Math.max(20, (window.innerWidth - panelWidth) / 2),
        y: Math.max(20, (window.innerHeight - 500) / 2),
      });
      setTitle("");
      setDescription("");
      setCategory("corrective");
      setPriority("medium");
      setAttachBcf(!!viewpointJson);
    }
  }, [open]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select, textarea, label")) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - panelWidth, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y)),
      });
    };
    const handleUp = () => setIsDragging(false);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isDragging, dragOffset]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setIsSubmitting(true);

    try {
      const externalId = `FR-${Date.now()}`;
      
      // Build attributes with optional BCF data
      const attributes: Record<string, any> = {
        source: "geminus_3d_viewer",
        created_from_context_menu: true,
      };

      // Add hierarchy context
      if (levelFmGuid) attributes.level_fm_guid = levelFmGuid;
      if (levelName) attributes.level_name = levelName;
      if (roomFmGuid) attributes.room_fm_guid = roomFmGuid;
      if (roomName) attributes.room_name = roomName;
      if (assetFmGuid) attributes.asset_fm_guid = assetFmGuid;
      if (assetName) attributes.asset_name = assetName;

      // Attach BCF viewpoint if enabled
      if (attachBcf && viewpointJson) {
        attributes.bcf_viewpoint = viewpointJson;
        if (screenshotUrl) attributes.bcf_screenshot = screenshotUrl;
        if (selectedObjectIds?.length) attributes.bcf_selected_objects = selectedObjectIds;
      }

      // Use the most specific space context available
      const spaceFmGuid = roomFmGuid || objectFmGuid || null;
      const spaceName = roomName || objectName || null;

      const { error } = await supabase.from("work_orders").insert({
        external_id: externalId,
        title: title.trim(),
        description: description.trim() || null,
        category,
        priority,
        status: "open",
        building_fm_guid: buildingFmGuid || null,
        building_name: buildingName || null,
        space_fm_guid: spaceFmGuid,
        space_name: spaceName,
        attributes,
      });

      if (error) throw error;
      toast.success("Work order created!", { description: `"${title.trim()}"` });
      onClose();
    } catch (err: any) {
      console.error("Failed to create work order:", err);
      toast.error("Failed to create work order", { description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/20" onClick={onClose} />
      <div
        className={cn(
          "fixed z-[71] border rounded-lg shadow-xl bg-card",
          "w-[440px] max-w-[calc(100vw-40px)]",
          "animate-in fade-in-0 zoom-in-95 duration-200",
          isDragging && "cursor-grabbing"
        )}
        style={{ left: position.x, top: position.y }}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-3 border-b cursor-grab select-none",
            isDragging && "cursor-grabbing"
          )}
          onMouseDown={handleDragStart}
        >
          <GripHorizontal className="h-4 w-4 text-muted-foreground" />
          <Wrench className="h-5 w-5 text-primary" />
          <span className="font-semibold flex-1">Create Work Order</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} disabled={isSubmitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form id="wo-form" onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Hierarchy context */}
          <div className="text-sm text-muted-foreground space-y-0.5">
            {buildingName && (
              <div><span className="font-medium">Building:</span> {buildingName}</div>
            )}
            {levelName && (
              <div><span className="font-medium">Floor:</span> {levelName}</div>
            )}
            {roomName && (
              <div><span className="font-medium">Room:</span> {roomName}</div>
            )}
            {(assetName || objectName) && (
              <div><span className="font-medium">Object:</span> {assetName || objectName}</div>
            )}
          </div>

          {/* BCF attachment */}
          {viewpointJson && (
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Attach BCF viewpoint</span>
              </div>
              <Switch checked={attachBcf} onCheckedChange={setAttachBcf} />
            </div>
          )}

          {/* BCF screenshot preview */}
          {attachBcf && screenshotUrl && (
            <div className="rounded-lg overflow-hidden border">
              <img src={screenshotUrl} alt="Viewpoint" className="w-full h-28 object-cover" />
              <div className="bg-muted/80 p-1.5 text-xs text-center flex items-center justify-center gap-1">
                <Camera className="h-3 w-3" />
                BCF viewpoint attached
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Priority</Label>
            <RadioGroup value={priority} onValueChange={setPriority} className="flex flex-wrap gap-2">
              {PRIORITY_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center">
                  <RadioGroupItem value={opt.value} id={`wo-pri-${opt.value}`} className="sr-only peer" />
                  <Label
                    htmlFor={`wo-pri-${opt.value}`}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border-2 transition-all",
                      priority === opt.value ? "border-primary bg-primary/10" : "border-transparent bg-muted hover:bg-muted/80"
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={cn("w-2 h-2 rounded-full", opt.color)} />
                      {opt.label}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wo-title">Title *</Label>
            <Input id="wo-title" placeholder="Describe the work" value={title} onChange={(e) => setTitle(e.target.value)} required disabled={isSubmitting} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="wo-desc">Description</Label>
            <Textarea id="wo-desc" placeholder="Additional information..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={isSubmitting} />
          </div>
        </form>

        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="wo-form" disabled={!title.trim() || isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Work Order"}
          </Button>
        </div>
      </div>
    </>
  );
};

export default CreateWorkOrderDialog;
