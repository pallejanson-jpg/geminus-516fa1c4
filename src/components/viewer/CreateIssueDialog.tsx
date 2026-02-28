import React, { useState, useEffect, useCallback } from "react";
import { MessageSquarePlus, AlertCircle, Lightbulb, HelpCircle, Eye, Box, GripHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

const ISSUE_TYPES = [
  { value: 'fault', label: 'Fault / Problem', icon: AlertCircle, color: 'text-destructive' },
  { value: 'improvement', label: 'Improvement', icon: Lightbulb, color: 'text-amber-500' },
  { value: 'question', label: 'Question', icon: HelpCircle, color: 'text-blue-500' },
  { value: 'observation', label: 'Observation', icon: Eye, color: 'text-muted-foreground' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low', color: 'bg-slate-400' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-500' },
  { value: 'high', label: 'High', color: 'bg-orange-500' },
  { value: 'critical', label: 'Critical', color: 'bg-destructive' },
] as const;

interface CreateIssueDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    issueType: string;
    priority: string;
  }) => Promise<void>;
  screenshotUrl?: string;
  buildingName?: string;
  isSubmitting?: boolean;
  /** IDs of currently selected objects in the 3D viewer */
  selectedObjectIds?: string[];
}

/**
 * Draggable floating panel for creating BCF issues.
 * Can be repositioned by dragging the header to allow viewing the 3D model behind.
 */
const CreateIssueDialog: React.FC<CreateIssueDialogProps> = ({
  open,
  onClose,
  onSubmit,
  screenshotUrl,
  buildingName,
  isSubmitting = false,
  selectedObjectIds = [],
}) => {
  const isMobile = useIsMobile();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<string>("fault");
  const [priority, setPriority] = useState<string>("medium");

  // Drag state
  const panelWidth = 480;
  const [position, setPosition] = useState({ 
    x: typeof window !== 'undefined' ? Math.max(20, (window.innerWidth - panelWidth) / 2) : 200, 
    y: typeof window !== 'undefined' ? Math.max(20, (window.innerHeight - 600) / 2) : 100
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Reset position and form when dialog opens
  useEffect(() => {
    if (open) {
      setPosition({
        x: Math.max(20, (window.innerWidth - panelWidth) / 2),
        y: Math.max(20, (window.innerHeight - 600) / 2),
      });
      // Don't reset form here - let handleClose do it
    }
  }, [open]);

  // Drag start handler
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Don't start drag if clicking interactive elements
    if ((e.target as HTMLElement).closest('button, input, select, textarea, [role="radiogroup"]')) return;
    setIsDragging(true);
    setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  // Drag move/end handlers
  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (e: MouseEvent) => {
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - panelWidth, e.clientX - dragOffset.x)),
        y: Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.y)),
      });
    };

    const handleUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDragging, dragOffset]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      issueType,
      priority,
    });

    // Reset form on success
    setTitle("");
    setDescription("");
    setIssueType("fault");
    setPriority("medium");
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setTitle("");
      setDescription("");
      setIssueType("fault");
      setPriority("medium");
      onClose();
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Semi-transparent backdrop */}
      <div 
        className="fixed inset-0 z-[70] bg-black/20" 
        onClick={handleClose}
      />
      
      {/* Panel — bottom-sheet on mobile, draggable on desktop */}
      <div
        className={cn(
          "fixed z-[71] border shadow-xl bg-card",
          "animate-in fade-in-0 duration-200",
          isMobile
            ? "inset-x-0 bottom-0 rounded-t-2xl max-h-[90dvh] w-full slide-in-from-bottom-10"
            : cn(
                "rounded-lg w-[480px] max-w-[calc(100vw-40px)] zoom-in-95",
                isDragging && "cursor-grabbing"
              )
        )}
        style={isMobile ? undefined : { left: position.x, top: position.y }}
      >
        {/* Draggable header */}
        <div
          className={cn(
            "flex items-center gap-2 px-4 py-3 border-b",
            !isMobile && "cursor-grab select-none",
            isDragging && "cursor-grabbing"
          )}
          onMouseDown={isMobile ? undefined : handleDragStart}
        >
          {isMobile && <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-muted-foreground/30 rounded-full" />}
          {!isMobile && <GripHorizontal className="h-4 w-4 text-muted-foreground" />}
          <MessageSquarePlus className="h-5 w-5 text-primary" />
          <span className="font-semibold flex-1">Create issue</span>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground px-4 pt-3">
          Report a problem or suggestion related to the model.
        </p>

        {/* Form content */}
        <form id="issue-form" onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Screenshot preview */}
          {screenshotUrl && (
            <div className="rounded-md overflow-hidden border bg-muted/50">
              <img
                src={screenshotUrl}
                alt="Screenshot"
                className="w-full h-32 object-cover"
              />
            </div>
          )}

          {/* Building info */}
          {buildingName && (
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">Building:</span> {buildingName}
            </div>
          )}

          {/* Selected objects indicator */}
          {selectedObjectIds.length > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 text-sm">
              <Box className="h-4 w-4 text-primary" />
              <span>
                {selectedObjectIds.length} {selectedObjectIds.length === 1 ? 'object selected' : 'objects selected'}
              </span>
            </div>
          )}

          {/* Issue Type */}
          <div className="space-y-2">
            <Label>Type *</Label>
            <Select value={issueType} onValueChange={setIssueType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_TYPES.map((type) => {
                  const Icon = type.icon;
                  return (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        <Icon className={cn("h-4 w-4", type.color)} />
                        {type.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <Label>Priority</Label>
            <RadioGroup
              value={priority}
              onValueChange={setPriority}
              className="flex flex-wrap gap-2"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center">
                  <RadioGroupItem
                    value={opt.value}
                    id={`priority-${opt.value}`}
                    className="sr-only peer"
                  />
                  <Label
                    htmlFor={`priority-${opt.value}`}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer",
                      "border-2 transition-all",
                      priority === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-transparent bg-muted hover:bg-muted/80"
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

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="issue-title">Title *</Label>
            <Input
              id="issue-title"
              placeholder="Describe the issue briefly"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="issue-description">Description</Label>
            <Textarea
              id="issue-description"
              placeholder="Add more information about the issue..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={isSubmitting}
            />
          </div>
        </form>

        {/* Footer buttons */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button 
            type="submit" 
            form="issue-form"
            disabled={!title.trim() || isSubmitting}
          >
            {isSubmitting ? "Submitting..." : "Submit issue"}
          </Button>
        </div>
      </div>
    </>
  );
};

export default CreateIssueDialog;
