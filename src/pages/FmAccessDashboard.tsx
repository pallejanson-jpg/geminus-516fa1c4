/**
 * FM Access Dashboard — Lists drawings and documents from FM Access.
 * Route: /fm-access?building=<fmGuid>
 */
import React, { useState, useEffect, useContext } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileText, Image, Loader2, AlertCircle, RefreshCw,
  ExternalLink, Download, Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { AppContext } from '@/context/AppContext';

interface DrawingItem {
  id: string;
  name: string;
  description?: string;
  [key: string]: any;
}

interface DocumentItem {
  id: string;
  name: string;
  fileName?: string;
  [key: string]: any;
}

const FmAccessDashboard: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const buildingFmGuid = searchParams.get('building');
  const { setActiveApp } = useContext(AppContext);

  const [drawings, setDrawings] = useState<DrawingItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loadingDrawings, setLoadingDrawings] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [errorDrawings, setErrorDrawings] = useState<string | null>(null);
  const [errorDocs, setErrorDocs] = useState<string | null>(null);

  useEffect(() => {
    setActiveApp('fm_access');
    return () => setActiveApp('');
  }, [setActiveApp]);

  const fetchDrawings = async () => {
    if (!buildingFmGuid) return;
    setLoadingDrawings(true);
    setErrorDrawings(null);
    try {
      const { data, error } = await supabase.functions.invoke('fm-access-query', {
        body: { action: 'get-drawings', buildingId: buildingFmGuid },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not fetch drawings');
      setDrawings(Array.isArray(data.data) ? data.data : []);
    } catch (err: any) {
      setErrorDrawings(err.message);
    } finally {
      setLoadingDrawings(false);
    }
  };

  const fetchDocuments = async () => {
    if (!buildingFmGuid) return;
    setLoadingDocs(true);
    setErrorDocs(null);
    try {
      const { data, error } = await supabase.functions.invoke('fm-access-query', {
        body: { action: 'get-documents', buildingId: buildingFmGuid },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not fetch documents');
      setDocuments(Array.isArray(data.data) ? data.data : []);
    } catch (err: any) {
      setErrorDocs(err.message);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchDrawings();
    fetchDocuments();
  }, [buildingFmGuid]);

  if (!buildingFmGuid) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center">
          <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No building selected. Go to a building and open FM Access from there.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>
            To Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Square className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">FM Access</h1>
            <p className="text-xs text-muted-foreground">Drawings and documents</p>
          </div>
        </div>
      </div>

      {/* Open 2D Viewer button */}
      <Button
        variant="outline"
        onClick={() => navigate(`/split-viewer?building=${buildingFmGuid}&mode=2d`)}
        className="gap-2"
      >
        <Square className="h-4 w-4" />
        Öppna 2D-ritning i viewer
      </Button>

      {/* Drawings section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Image className="h-4 w-4 text-primary" />
              Ritningar
            </CardTitle>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchDrawings}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingDrawings ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : errorDrawings ? (
            <div className="text-center py-4">
              <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{errorDrawings}</p>
            </div>
          ) : drawings.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">Inga ritningar hittades</p>
          ) : (
            <div className="space-y-1">
              {drawings.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Image className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{d.name || d.id}</span>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Documents section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Dokument
            </CardTitle>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchDocuments}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingDocs ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : errorDocs ? (
            <div className="text-center py-4">
              <AlertCircle className="h-6 w-6 text-destructive mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{errorDocs}</p>
            </div>
          ) : documents.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">Inga dokument hittades</p>
          ) : (
            <div className="space-y-1">
              {documents.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">{d.name || d.fileName || d.id}</span>
                  </div>
                  <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FmAccessDashboard;
