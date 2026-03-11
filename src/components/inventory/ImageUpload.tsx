import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';

interface ImageUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ value, onChange, disabled }) => {
  const isMobile = useIsMobile();
  const [isUploading, setIsUploading] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Check if device has a camera
  useEffect(() => {
    if (isMobile) {
      // On mobile, assume camera is available
      setHasCamera(true);
    } else {
      // On desktop, check for camera devices
      navigator.mediaDevices?.enumerateDevices?.()
        .then(devices => {
          setHasCamera(devices.some(d => d.kind === 'videoinput'));
        })
        .catch(() => setHasCamera(false));
    }
  }, [isMobile]);

  const uploadImage = async (file: File) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Only images allowed');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5 MB or less');
      return;
    }

    setIsUploading(true);

    try {
      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const filePath = `inventory/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('inventory-images')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('inventory-images')
        .getPublicUrl(filePath);

      onChange(urlData.publicUrl);
      toast.success('Image uploaded!');
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error('Could not upload image', {
        description: error.message,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadImage(file);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleRemove = () => {
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <Label className="text-base">Image (optional)</Label>
      
      {value ? (
        <div className="relative rounded-lg overflow-hidden border border-border">
          <img 
            src={value} 
            alt="Uploaded" 
            className="w-full h-48 object-cover"
          />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8"
            onClick={handleRemove}
            disabled={disabled || isUploading}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {/* Camera button - only show on mobile or if device has camera */}
          {(isMobile || hasCamera) && (
            <Button
              type="button"
              variant="outline"
              className="flex-1 h-20 flex-col gap-2"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Camera button clicked, ref:', cameraInputRef.current);
                cameraInputRef.current?.click();
              }}
              disabled={disabled || isUploading}
            >
              {isUploading ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : (
                <>
                  <Camera className="h-6 w-6" />
                  <span className="text-xs">Ta foto</span>
                </>
              )}
            </Button>
          )}
          
          {/* Upload button */}
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-20 flex-col gap-2"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('Upload button clicked, ref:', fileInputRef.current);
              fileInputRef.current?.click();
            }}
            disabled={disabled || isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <Upload className="h-6 w-6" />
                <span className="text-xs">{isMobile ? 'Ladda upp' : 'Välj bild'}</span>
              </>
            )}
          </Button>
        </div>
      )}

      {/* Hidden file input for gallery */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      
      {/* Hidden camera input - only with capture on mobile */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture={isMobile ? "environment" : undefined}
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
};

export default ImageUpload;
