import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle, Loader2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

interface FeedbackCreateFormProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface SimilarResult {
  type: 'thread' | 'doc';
  title: string;
  description?: string;
  id: string;
}

const FeedbackCreateForm: React.FC<FeedbackCreateFormProps> = ({ open, onClose, onCreated }) => {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('suggestion');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [similarResults, setSimilarResults] = useState<SimilarResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Debounced duplicate detection
  const searchSimilar = useCallback(async (searchText: string) => {
    if (searchText.length < 4) {
      setSimilarResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const searchTerms = searchText.split(' ').filter(w => w.length > 2).slice(0, 3);
      const likePattern = `%${searchTerms.join('%')}%`;

      // Search existing feedback threads
      const { data: threads } = await supabase
        .from('feedback_threads')
        .select('id, title, description, status')
        .or(`title.ilike.${likePattern},description.ilike.${likePattern}`)
        .limit(5);

      // Search document chunks for existing features
      const { data: docs } = await supabase
        .from('document_chunks')
        .select('id, content, file_name, source_type')
        .ilike('content', likePattern)
        .limit(3);

      const results: SimilarResult[] = [
        ...(threads || []).map(t => ({
          type: 'thread' as const,
          title: t.title,
          description: t.status === 'done' ? 'Already implemented' : `Status: ${t.status}`,
          id: t.id,
        })),
        ...(docs || []).map(d => ({
          type: 'doc' as const,
          title: d.file_name || 'Help documentation',
          description: d.content?.substring(0, 100) + '…',
          id: d.id,
        })),
      ];

      setSimilarResults(results);
    } catch (err) {
      console.error('Similar search failed:', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchSimilar(title);
    }, 500);
    return () => clearTimeout(timer);
  }, [title, searchSimilar]);

  const handleSubmit = async () => {
    if (!title.trim() || !user) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('feedback_threads').insert({
        user_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        category,
      });

      if (error) throw error;

      // Notify admins via edge function
      try {
        await supabase.functions.invoke('feedback-notify', {
          body: { title: title.trim(), description: description.trim(), category },
        });
      } catch (notifyErr) {
        console.warn('Failed to send notification:', notifyErr);
      }

      toast({ title: 'Thanks for your feedback!', description: 'Your suggestion has been submitted.' });
      onCreated();
    } catch (err) {
      console.error('Failed to create feedback:', err);
      toast({ title: 'Could not send', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New idea / feedback</DialogTitle>
          <DialogDescription>
            Share your thoughts on how Geminus can be improved
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="fb-title">Title</Label>
            <Input
              id="fb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Describe your idea briefly…"
            />
          </div>

          {/* Duplicate detection panel */}
          {(similarResults.length > 0 || isSearching) && (
            <div className="rounded-md border bg-muted/50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {isSearching ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Searching similar…</>
                ) : (
                  <><Search className="h-3 w-3" /> Similar items found</>
                )}
              </div>
              {similarResults.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {r.type === 'thread' ? (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-medium text-foreground">{r.title}</span>
                    {r.description && (
                      <p className="text-muted-foreground line-clamp-1">{r.description}</p>
                    )}
                    <Badge variant="outline" className="text-[9px] mt-0.5">
                      {r.type === 'thread' ? 'Existing case' : 'Existing feature'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="fb-desc">Description</Label>
            <Textarea
              id="fb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe in detail what you wish…"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="suggestion">Förslag</SelectItem>
                <SelectItem value="ux_issue">UX-problem</SelectItem>
                <SelectItem value="bug">Bugg</SelectItem>
                <SelectItem value="question">Fråga</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Avbryt</Button>
            <Button onClick={handleSubmit} disabled={!title.trim() || isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Skicka
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackCreateForm;
