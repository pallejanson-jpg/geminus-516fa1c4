import React, { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PhotoData {
  fileName: string;
  mimeType: string;
  data: string; // base64 without prefix
}

interface PhotoCaptureProps {
  photos: string[];
  onPhotosChange: (photos: string[]) => void;
  onPhotoDataChange?: (photoData: PhotoData[]) => void;
  maxPhotos?: number;
  workOrderId: string;
}

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const PhotoCapture: React.FC<PhotoCaptureProps> = ({
  photos,
  onPhotosChange,
  onPhotoDataChange,
  maxPhotos = 3,
  workOrderId,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [photoDataList, setPhotoDataList] = useState<PhotoData[]>([]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const remainingSlots = maxPhotos - photos.length;
    const filesToUpload = Array.from(files).slice(0, remainingSlots);

    setIsUploading(true);
    try {
      const uploadedUrls: string[] = [];
      const newPhotoData: PhotoData[] = [];

      for (const file of filesToUpload) {
        if (!file.type.startsWith('image/')) {
          toast.error('Endast bilder tillåtna');
          continue;
        }
        if (file.size > 5 * 1024 * 1024) {
          toast.error('Bilden får max vara 5 MB');
          continue;
        }

        // Read base64
        const dataUrl = await readFileAsBase64(file);
        const base64Raw = dataUrl.split(',')[1] || '';
        newPhotoData.push({
          fileName: file.name,
          mimeType: file.type,
          data: base64Raw,
        });

        // Upload to storage
        const fileExt = file.name.split('.').pop();
        const fileName = `fault-reports/${workOrderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('inventory-images')
          .upload(fileName, file);

        if (uploadError) {
          console.error('Upload error:', uploadError);
          toast.error('Could not upload image');
          continue;
        }

        const { data: urlData } = supabase.storage
          .from('inventory-images')
          .getPublicUrl(fileName);

        uploadedUrls.push(urlData.publicUrl);
      }

      if (uploadedUrls.length > 0 || newPhotoData.length > 0) {
        const updatedPhotos = [...photos, ...uploadedUrls];
        const updatedData = [...photoDataList, ...newPhotoData];
        onPhotosChange(updatedPhotos);
        setPhotoDataList(updatedData);
        onPhotoDataChange?.(updatedData);
      }
    } catch (error) {
      console.error('Photo upload error:', error);
      toast.error('Upload error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removePhoto = (index: number) => {
    onPhotosChange(photos.filter((_, i) => i !== index));
    const updatedData = photoDataList.filter((_, i) => i !== index);
    setPhotoDataList(updatedData);
    onPhotoDataChange?.(updatedData);
  };

  const canAddMore = photos.length < maxPhotos;

  return (
    <div className="space-y-3">
      {canAddMore && (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? (
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          Ta Bild / Bläddra...
        </Button>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((url, index) => (
            <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted">
              <img src={url} alt={`Foto ${index + 1}`} className="w-full h-full object-cover" />
              <Button
                variant="destructive"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6 rounded-full"
                onClick={() => removePhoto(index)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );
};

export default PhotoCapture;
