import React, { useRef, useState } from 'react';
import { Upload, X, Loader2, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ExampleImagesUploadProps {
  templateId?: string;
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
  maxImages?: number;
}

const ExampleImagesUpload: React.FC<ExampleImagesUploadProps> = ({ 
  templateId,
  value, 
  onChange, 
  disabled,
  maxImages = 5
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadImage = async (file: File) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Endast bilder tillåtna');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Bilden får max vara 5 MB');
      return;
    }

    setIsUploading(true);

    try {
      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const prefix = templateId || 'new';
      const fileName = `${prefix}/${crypto.randomUUID()}.${fileExt}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('template-examples')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('template-examples')
        .getPublicUrl(fileName);

      onChange([...value, urlData.publicUrl]);
      toast.success('Exempelbild uppladdad!');
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
    const files = e.target.files;
    if (files) {
      // Upload all selected files
      Array.from(files).slice(0, maxImages - value.length).forEach(uploadImage);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleRemove = (urlToRemove: string) => {
    onChange(value.filter(url => url !== urlToRemove));
    // Note: We don't delete from storage to avoid issues with concurrent edits
  };

  const canAddMore = value.length < maxImages;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          Exempelbilder ({value.length}/{maxImages})
        </Label>
        {value.length > 0 && (
          <span className="text-xs text-muted-foreground">
            Förbättrar AI-precision
          </span>
        )}
      </div>
      
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {/* Existing images */}
        {value.map((url, index) => (
          <div key={url} className="relative aspect-square group">
            <img 
              src={url} 
              alt={`Exempel ${index + 1}`} 
              className="w-full h-full object-cover rounded-lg border border-border"
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => handleRemove(url)}
              disabled={disabled || isUploading}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        
        {/* Add button */}
        {canAddMore && (
          <Button
            type="button"
            variant="outline"
            className="aspect-square h-auto flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Upload className="h-5 w-5" />
                <span className="text-[10px]">Add</span>
              </>
            )}
          </Button>
        )}
      </div>
      
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground bg-muted/50 p-2 rounded-lg flex items-start gap-2">
          <ImageIcon className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Ladda upp 2-4 exempelbilder för bättre precision. AI:n lär sig känna igen 
            objektet baserat på dessa bilder (few-shot learning).
          </span>
        </p>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
};

export default ExampleImagesUpload;

