import React, { useState } from "react";
import { MessageSquarePlus, AlertCircle, Lightbulb, HelpCircle, Eye, Box } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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

const ISSUE_TYPES = [
  { value: 'fault', label: 'Fel/Problem', icon: AlertCircle, color: 'text-destructive' },
  { value: 'improvement', label: 'Förbättring', icon: Lightbulb, color: 'text-amber-500' },
  { value: 'question', label: 'Fråga', icon: HelpCircle, color: 'text-blue-500' },
  { value: 'observation', label: 'Observation', icon: Eye, color: 'text-muted-foreground' },
] as const;

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Låg', color: 'bg-slate-400' },
  { value: 'medium', label: 'Medel', color: 'bg-amber-500' },
  { value: 'high', label: 'Hög', color: 'bg-orange-500' },
  { value: 'critical', label: 'Kritisk', color: 'bg-destructive' },
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

const CreateIssueDialog: React.FC<CreateIssueDialogProps> = ({
  open,
  onClose,
  onSubmit,
  screenshotUrl,
  buildingName,
  isSubmitting = false,
  selectedObjectIds = [],
}) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [issueType, setIssueType] = useState<string>("fault");
  const [priority, setPriority] = useState<string>("medium");

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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-primary" />
            Skapa ärende
          </DialogTitle>
          <DialogDescription>
            Rapportera ett problem eller förslag koppat till modellen.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Screenshot preview */}
          {screenshotUrl && (
            <div className="rounded-md overflow-hidden border bg-muted/50">
              <img
                src={screenshotUrl}
                alt="Skärmdump"
                className="w-full h-32 object-cover"
              />
            </div>
          )}

          {/* Building info */}
          {buildingName && (
            <div className="text-sm text-muted-foreground">
              <span className="font-medium">Byggnad:</span> {buildingName}
            </div>
          )}

          {/* Selected objects indicator */}
          {selectedObjectIds.length > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 text-sm">
              <Box className="h-4 w-4 text-primary" />
              <span>
                {selectedObjectIds.length} {selectedObjectIds.length === 1 ? 'objekt valt' : 'objekt valda'}
              </span>
            </div>
          )}

          {/* Issue Type */}
          <div className="space-y-2">
            <Label>Typ *</Label>
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
            <Label>Prioritet</Label>
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
            <Label htmlFor="issue-title">Rubrik *</Label>
            <Input
              id="issue-title"
              placeholder="Beskriv problemet kortfattat"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="issue-description">Beskrivning</Label>
            <Textarea
              id="issue-description"
              placeholder="Lägg till mer information om ärendet..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Avbryt
            </Button>
            <Button type="submit" disabled={!title.trim() || isSubmitting}>
              {isSubmitting ? "Skickar..." : "Skicka ärende"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateIssueDialog;
