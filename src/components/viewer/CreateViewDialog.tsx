import React, { useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface ViewState {
  buildingFmGuid: string;
  buildingName: string;
  screenshotDataUrl: string;
  cameraEye: number[];
  cameraLook: number[];
  cameraUp: number[];
  cameraProjection: string;
  viewMode: '2d' | '3d';
  clipHeight: number;
  visibleModelIds: string[];
  visibleFloorIds: string[];
  showSpaces: boolean;
  showAnnotations: boolean;
  visualizationType: string;
  visualizationMockData: boolean;
}

interface CreateViewDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
  viewState: ViewState | null;
  isSaving?: boolean;
}

/**
 * Dialog for creating a saved view with name and description.
 * Shows a preview of the screenshot and allows user to input metadata.
 */
const CreateViewDialog: React.FC<CreateViewDialogProps> = ({
  open,
  onClose,
  onSave,
  viewState,
  isSaving = false,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    
    setError(null);
    try {
      await onSave(name.trim(), description.trim());
      setName('');
      setDescription('');
    } catch (e) {
      setError('Could not save the view');
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-primary" />
            Create Saved View
          </DialogTitle>
          <DialogDescription>
            Save the current view with all settings for quick access later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Screenshot preview */}
          {viewState?.screenshotDataUrl && (
            <div className="rounded-lg overflow-hidden border bg-muted">
              <img
                src={viewState.screenshotDataUrl}
                alt="View preview"
                className="w-full h-40 object-cover"
              />
            </div>
          )}

          {/* Building info */}
          {viewState?.buildingName && (
            <p className="text-sm text-muted-foreground">
              Byggnad: <span className="font-medium text-foreground">{viewState.buildingName}</span>
            </p>
          )}

          {/* Name input */}
          <div className="space-y-2">
            <Label htmlFor="view-name">Namn *</Label>
            <Input
              id="view-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="T.ex. Plan 3 - Brandskydd"
              disabled={isSaving}
            />
          </div>

          {/* Description input */}
          <div className="space-y-2">
            <Label htmlFor="view-description">Beskrivning (valfritt)</Label>
            <Textarea
              id="view-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Beskriv vyn..."
              rows={2}
              disabled={isSaving}
            />
          </div>

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isSaving}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sparar...
              </>
            ) : (
              'Spara vy'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateViewDialog;
