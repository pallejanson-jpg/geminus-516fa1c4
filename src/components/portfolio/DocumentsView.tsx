import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Download, ExternalLink, FileText, Folder, Loader2, RefreshCw, Search, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { Facility } from '@/lib/types';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

interface Document {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  source_url: string | null;
  source_system: string;
  synced_at: string;
  metadata: Record<string, any>;
}

interface GroupedDocuments {
  folder: string;
  documents: Document[];
}

interface DocumentsViewProps {
  facility: Facility;
  onClose: () => void;
  onSelectDocument?: (doc: Document) => void;
}

const formatFileSize = (bytes: number | null): string => {
  if (!bytes) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (mimeType: string | null): string => {
  if (!mimeType) return '📄';
  if (mimeType.includes('pdf')) return '📕';
  if (mimeType.includes('image')) return '🖼️';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  return '📄';
};

const DocumentsView: React.FC<DocumentsViewProps> = ({ facility, onClose }) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [lastSyncDate, setLastSyncDate] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);

  // Build the correct buildingFmGuid based on facility category
  const buildingFmGuid = facility.category === 'Building' 
    ? facility.fmGuid 
    : facility.buildingFmGuid;

  const fetchDocuments = async () => {
    if (!buildingFmGuid) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('building_fm_guid', buildingFmGuid)
        .order('file_name');

      if (error) throw error;

      // Cast metadata to Record<string, any>
      const docs = (data || []).map(doc => ({
        ...doc,
        metadata: (doc.metadata as Record<string, any>) || {}
      }));

      setDocuments(docs);

      // Get latest sync date
      if (docs.length > 0) {
        const latest = docs.reduce((a, b) => 
          new Date(a.synced_at) > new Date(b.synced_at) ? a : b
        );
        setLastSyncDate(latest.synced_at);
      }

      // Open all folders by default
      const folders = new Set(docs.map(d => d.metadata?.congeria_path || 'Dokument'));
      setOpenFolders(folders);
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [buildingFmGuid]);

  const handleSync = async () => {
    if (!buildingFmGuid) return;
    
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('congeria-sync', {
        body: { buildingFmGuid, action: 'sync' }
      });

      if (error) throw error;

      // Check if the response suggests manual upload
      if (data?.suggestion === 'manual_upload') {
        toast({
          title: 'Automatisk synk misslyckades',
          description: data.error || 'Använd manuell uppladdning istället.',
          variant: 'default',
        });
      } else if (data?.syncedCount > 0) {
        toast({
          title: 'Synkronisering klar',
          description: `${data.syncedCount} dokument synkade.`,
        });
      } else if (data?.documentsFound === 0) {
        toast({
          title: 'Inga dokument hittades',
          description: 'Prova manuell uppladdning.',
        });
      }

      // Refetch documents after sync
      await fetchDocuments();
    } catch (error) {
      console.error('Sync failed:', error);
      toast({
        title: 'Synkronisering misslyckades',
        description: 'Ett oväntat fel uppstod. Prova manuell uppladdning.',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(doc.file_path);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: 'Nedladdning misslyckades',
        description: 'Kunde inte ladda ner dokumentet.',
        variant: 'destructive',
      });
    }
  };

  // Handle manual file upload
  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !buildingFmGuid) return;
    
    setIsUploading(true);
    let uploadedCount = 0;
    let failedCount = 0;

    for (const file of Array.from(files)) {
      try {
        const storagePath = `${buildingFmGuid}/${file.name}`;
        
        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, file, {
            upsert: true,
          });

        if (uploadError) throw uploadError;

        // Insert into documents table
        const { error: dbError } = await supabase
          .from('documents')
          .upsert({
            building_fm_guid: buildingFmGuid,
            file_name: file.name,
            file_path: storagePath,
            file_size: file.size,
            mime_type: file.type || 'application/octet-stream',
            source_system: 'manual',
            synced_at: new Date().toISOString(),
            metadata: {
              congeria_path: 'Manuellt uppladdade',
              uploaded_by: 'user',
            },
          }, {
            onConflict: 'building_fm_guid,file_path',
          });

        if (dbError) throw dbError;
        uploadedCount++;
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
        failedCount++;
      }
    }

    setIsUploading(false);
    
    if (uploadedCount > 0) {
      toast({
        title: 'Uppladdning klar',
        description: `${uploadedCount} dokument uppladdade${failedCount > 0 ? `, ${failedCount} misslyckades` : ''}.`,
      });
      await fetchDocuments();
    } else {
      toast({
        title: 'Uppladdning misslyckades',
        description: 'Inga dokument kunde laddas upp.',
        variant: 'destructive',
      });
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  };

  // Filter and group documents
  const filteredDocs = documents.filter(doc =>
    doc.file_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedDocuments: GroupedDocuments[] = React.useMemo(() => {
    const groups = new Map<string, Document[]>();
    
    filteredDocs.forEach(doc => {
      const folder = doc.metadata?.congeria_path || 'Dokument';
      if (!groups.has(folder)) {
        groups.set(folder, []);
      }
      groups.get(folder)!.push(doc);
    });

    return Array.from(groups.entries())
      .map(([folder, docs]) => ({ folder, documents: docs }))
      .sort((a, b) => a.folder.localeCompare(b.folder));
  }, [filteredDocs]);

  const toggleFolder = (folder: string) => {
    setOpenFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="font-semibold text-lg">Dokument</h2>
            <p className="text-sm text-muted-foreground">
              {facility.commonName || facility.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Ladda upp
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Synka
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sök dokument..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Content */}
      <div 
        className={`flex-1 overflow-y-auto p-4 ${isDragOver ? 'bg-primary/5 border-2 border-dashed border-primary' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
        />
        
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="font-medium mb-2">Inga dokument</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Synka från Congeria eller ladda upp dokument manuellt.
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" onClick={handleSync} disabled={isSyncing}>
                {isSyncing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Synka
              </Button>
              <Button 
                variant="default" 
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Ladda upp
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedDocuments.map(({ folder, documents }) => (
              <Collapsible 
                key={folder} 
                open={openFolders.has(folder)}
                onOpenChange={() => toggleFolder(folder)}
              >
                <CollapsibleTrigger className="flex items-center gap-2 w-full p-2 hover:bg-muted rounded-lg">
                  <Folder className="h-4 w-4 text-primary" />
                  <span className="font-medium text-sm flex-1 text-left">{folder}</span>
                  <Badge variant="secondary" className="text-xs">
                    {documents.length}
                  </Badge>
                </CollapsibleTrigger>
                <CollapsibleContent className="ml-6 space-y-1 mt-1">
                  {documents.map((doc) => (
                    <div 
                      key={doc.id}
                      className="flex items-center gap-3 p-2 hover:bg-muted rounded-lg group"
                    >
                      <span className="text-lg">{getFileIcon(doc.mime_type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(doc.file_size)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDownload(doc)}
                          title="Ladda ner"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {doc.source_url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => window.open(doc.source_url!, '_blank')}
                            title="Öppna original"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {lastSyncDate && (
        <div className="p-3 border-t text-xs text-muted-foreground text-center">
          Senast synkad: {format(new Date(lastSyncDate), 'PPP HH:mm', { locale: sv })} • Källa: Congeria
        </div>
      )}
    </div>
  );
};

export default DocumentsView;
