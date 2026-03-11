import React, { useState, useEffect } from 'react';
import { FileText, Image, Download, Loader2, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useFmAccessApi, FmAccessDrawing, FmAccessDocument } from '@/hooks/useFmAccessApi';

interface FmAccessDocumentsProps {
  buildingId: string | null;
  buildingName?: string;
}

const FmAccessDocuments: React.FC<FmAccessDocumentsProps> = ({ buildingId, buildingName }) => {
  const { getDrawings, getDocuments, getDrawingPdf, loading } = useFmAccessApi();
  const [drawings, setDrawings] = useState<FmAccessDrawing[]>([]);
  const [documents, setDocuments] = useState<FmAccessDocument[]>([]);
  const [loadedDrawings, setLoadedDrawings] = useState(false);
  const [loadedDocs, setLoadedDocs] = useState(false);

  useEffect(() => {
    if (!buildingId) return;
    setLoadedDrawings(false);
    setLoadedDocs(false);
    getDrawings(buildingId).then(d => { setDrawings(d || []); setLoadedDrawings(true); });
    getDocuments(buildingId).then(d => { setDocuments(d || []); setLoadedDocs(true); });
  }, [buildingId]);

  const handleDownloadPdf = async (drawingId: string | number) => {
    const res = await getDrawingPdf(String(drawingId));
    if (res?.url) {
      window.open(res.url, '_blank');
    }
  };

  if (!buildingId) {
    return (
       <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-8">
         Select a building to view drawings and documents.
       </div>
    );
  }

  return (
    <Tabs defaultValue="drawings" className="h-full flex flex-col">
      <div className="px-3 pt-3">
        <TabsList className="w-full">
          <TabsTrigger value="drawings" className="flex-1 text-xs">
            <Image size={12} className="mr-1" /> Drawings ({drawings.length})
          </TabsTrigger>
          <TabsTrigger value="documents" className="flex-1 text-xs">
            <FileText size={12} className="mr-1" /> Documents ({documents.length})
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="drawings" className="flex-1 mt-0">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-2">
            {!loadedDrawings && (
              <div className="flex items-center justify-center p-4 text-muted-foreground">
                <Loader2 size={16} className="animate-spin mr-2" /> Loading drawings...
              </div>
            )}
            {loadedDrawings && drawings.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No drawings found.</p>
            )}
            {drawings.map((d, i) => (
              <Card key={d.drawingId || d.objectId || i} className="overflow-hidden">
                <CardContent className="p-3 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{d.objectName || d.name || `Drawing ${i + 1}`}</div>
                    {d.className && <div className="text-[11px] text-muted-foreground">{d.className}</div>}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadPdf(d.drawingId || d.objectId || '')}
                    className="flex-shrink-0"
                  >
                    <Download size={12} className="mr-1" /> PDF
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="documents" className="flex-1 mt-0">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-2">
            {!loadedDocs && (
              <div className="flex items-center justify-center p-4 text-muted-foreground">
                <Loader2 size={16} className="animate-spin mr-2" /> Laddar dokument...
              </div>
            )}
            {loadedDocs && documents.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Inga dokument hittade.</p>
            )}
            {documents.map((d, i) => (
              <Card key={d.documentId || d.objectId || i} className="overflow-hidden">
                <CardContent className="p-3">
                  <div className="text-sm font-medium truncate">{d.objectName || d.name || d.fileName || `Dokument ${i + 1}`}</div>
                  {d.fileName && <div className="text-[11px] text-muted-foreground">{d.fileName}</div>}
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
};

export default FmAccessDocuments;
