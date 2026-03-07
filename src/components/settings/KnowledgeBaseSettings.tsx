import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, RefreshCw, Globe } from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface HelpDocSource {
  id: string;
  app_name: string;
  url: string;
  last_indexed_at: string | null;
  chunk_count: number;
  created_at: string;
}

export default function KnowledgeBaseSettings() {
  const { toast } = useToast();
  const [sources, setSources] = useState<HelpDocSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newAppName, setNewAppName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [isIndexingAll, setIsIndexingAll] = useState(false);

  const fetchSources = async () => {
    const { data, error } = await supabase
      .from('help_doc_sources')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setSources(data as HelpDocSource[]);
    setIsLoading(false);
  };

  useEffect(() => { fetchSources(); }, []);

  const handleAdd = async () => {
    if (!newAppName.trim() || !newUrl.trim()) return;
    setIsAdding(true);
    const { error } = await supabase.from('help_doc_sources').insert({
      app_name: newAppName.trim(),
      url: newUrl.trim(),
    });
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } else {
      setNewAppName('');
      setNewUrl('');
      await fetchSources();
      toast({ title: 'Added', description: 'Help doc source added. Click Index to scrape content.' });
    }
    setIsAdding(false);
  };

  const handleDelete = async (id: string) => {
    await supabase.from('help_doc_sources').delete().eq('id', id);
    await supabase.from('document_chunks').delete().eq('source_type', 'help_doc').eq('source_id', id);
    await fetchSources();
    toast({ title: 'Deleted', description: 'Source and indexed content removed.' });
  };

  const handleIndexSingle = async (source: HelpDocSource) => {
    setIndexingId(source.id);
    try {
      const { data, error } = await supabase.functions.invoke('index-documents', {
        body: { action: 'index-single-url', url: source.url, source_id: source.id, app_name: source.app_name },
      });
      if (error) throw error;
      toast({ title: 'Indexed', description: `${data?.chunks || 0} chunks created from ${source.app_name}` });
      await fetchSources();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Index failed', description: e.message });
    }
    setIndexingId(null);
  };

  const handleIndexAll = async () => {
    setIsIndexingAll(true);
    try {
      const { data, error } = await supabase.functions.invoke('index-documents', {
        body: { action: 'index-help-docs' },
      });
      if (error) throw error;
      toast({ title: 'Indexing complete', description: `${data?.indexed || 0} of ${data?.totalSources || 0} sources indexed.` });
      await fetchSources();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Index failed', description: e.message });
    }
    setIsIndexingAll(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add URLs to help pages for apps and integrations. Gunnar will use these to answer platform usage questions.
      </p>

      {/* Add form */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="App name (e.g. FM Access)"
          value={newAppName}
          onChange={(e) => setNewAppName(e.target.value)}
          className="flex-1"
        />
        <Input
          placeholder="https://help.example.com/docs"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          className="flex-[2]"
        />
        <Button onClick={handleAdd} disabled={isAdding || !newAppName.trim() || !newUrl.trim()} size="sm" className="gap-1">
          {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Add
        </Button>
      </div>

      {/* Sources list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : sources.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-4">No help doc sources configured yet.</p>
      ) : (
        <div className="space-y-2">
          {sources.map((source) => (
            <div key={source.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{source.app_name}</p>
                  <p className="text-xs text-muted-foreground truncate">{source.url}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {source.chunk_count > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {source.chunk_count} chunks
                  </Badge>
                )}
                {source.last_indexed_at && (
                  <Badge variant="outline" className="text-[10px]">
                    {new Date(source.last_indexed_at).toLocaleDateString()}
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs"
                  onClick={() => handleIndexSingle(source)}
                  disabled={indexingId === source.id}
                >
                  {indexingId === source.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Index
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                  onClick={() => handleDelete(source.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Index All button */}
      {sources.length > 0 && (
        <Button onClick={handleIndexAll} disabled={isIndexingAll} variant="outline" size="sm" className="gap-1.5">
          {isIndexingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Index All Sources
        </Button>
      )}
    </div>
  );
}
