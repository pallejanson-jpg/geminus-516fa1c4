import React, { useContext, useState } from 'react';
import { AppContext } from '@/context/AppContext';
import type { Facility } from '@/lib/types';
import { useRagSearch } from '@/hooks/useRagSearch';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, FileText, BookOpen, Sparkles, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function RagSearchTab({ facility }: { facility?: Facility }) {
  const { selectedFacility } = useContext(AppContext);
  const effectiveFacility = facility || selectedFacility;
  const { data, isLoading, error, search } = useRagSearch();
  const [query, setQuery] = useState('');

  const handleSearch = () => {
    if (!query.trim()) return;
    search(query, { buildingFmGuid: effectiveFacility?.fmGuid });
  };

  return (
    <div className="space-y-4">
      <div>
         <h3 className="text-sm font-semibold text-foreground">Smart Document Search</h3>
         <p className="text-xs text-muted-foreground">AI-powered semantic search in building documentation</p>
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search e.g. 'fire safety documentation floor 3'..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="pl-9"
          />
        </div>
        <Button onClick={handleSearch} disabled={isLoading || !query.trim()} size="sm">
           <Sparkles className="h-3.5 w-3.5 mr-1.5" />
           Search
        </Button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {/* Error */}
      {error && (
        <Card className="border-destructive/30">
          <CardContent className="p-4 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* Results */}
      {data && (
        <>
          {/* AI Answer */}
          {data.answer && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium text-foreground mb-1">AI Answer</h4>
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{data.answer}</p>
                  </div>
                </div>
                {data.sources?.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">Sources:</span>
                    {data.sources.map((s, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        <FileText className="h-3 w-3 mr-1" />
                        {s}
                      </Badge>
                    ))}
                  </div>
                )}
                {data.confidence > 0 && (
                  <span className="text-[10px] text-muted-foreground mt-1 block">
                    Konfidens: {Math.round(data.confidence * 100)}%
                  </span>
                )}
              </CardContent>
            </Card>
          )}

          {/* Keywords */}
          {data.keywords?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">Sökord:</span>
              {data.keywords.map((kw, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">{kw}</Badge>
              ))}
            </div>
          )}

          {/* Document chunks */}
          <div className="space-y-2">
            {data.results.map((result) => (
              <Card key={result.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <div className="p-1.5 rounded bg-muted shrink-0">
                      {result.sourceType === 'help_doc' ? (
                        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-foreground truncate">
                          {result.fileName}
                        </span>
                        <Badge variant="outline" className="text-[9px] shrink-0">
                          {result.sourceType === 'help_doc' ? 'Hjälpdok' : 'Dokument'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-3">
                        {result.content}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {data.results.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Inga resultat hittades</p>
              <p className="text-xs">Prova andra söktermer</p>
            </div>
          )}
        </>
      )}

      {!data && !isLoading && (
        <div className="text-center py-8 text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Sök i byggnads- och hjälpdokumentation</p>
          <p className="text-xs">AI analyserar och rankar relevanta dokument</p>
        </div>
      )}
    </div>
  );
}
