import React, { useState, useEffect } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, Loader2, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import type { FeedbackThread } from './FeedbackView';

interface FeedbackComment {
  id: string;
  user_id: string;
  comment: string;
  created_at: string;
  profile?: { display_name: string | null };
}

interface FeedbackThreadDetailProps {
  thread: FeedbackThread;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Öppen' },
  { value: 'planned', label: 'Planerad' },
  { value: 'in_progress', label: 'Pågår' },
  { value: 'done', label: 'Klar' },
  { value: 'declined', label: 'Avböjd' },
];

const FeedbackThreadDetail: React.FC<FeedbackThreadDetailProps> = ({
  thread, open, onClose, onUpdated,
}) => {
  const { user, isAdmin } = useAuth();
  const [comments, setComments] = useState<FeedbackComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(thread.status);

  useEffect(() => {
    if (thread?.id) {
      setCurrentStatus(thread.status);
      fetchComments();
    }
  }, [thread?.id]);

  const fetchComments = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('feedback_comments')
        .select('id, user_id, comment, created_at')
        .eq('thread_id', thread.id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const userIds = [...new Set((data || []).map(c => c.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      setComments((data || []).map(c => ({
        ...c,
        profile: profileMap.get(c.user_id),
      })));
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !user) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('feedback_comments').insert({
        thread_id: thread.id,
        user_id: user.id,
        comment: newComment.trim(),
      });
      if (error) throw error;
      setNewComment('');
      fetchComments();
    } catch (err) {
      console.error('Failed to post comment:', err);
      toast({ title: 'Could not send comment', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      const { error } = await supabase
        .from('feedback_threads')
        .update({ status: newStatus })
        .eq('id', thread.id);
      if (error) throw error;
      setCurrentStatus(newStatus);
      onUpdated();
      toast({ title: 'Status uppdaterad' });
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleVote = async () => {
    if (!user) return;
    try {
      if (thread.user_voted) {
        await supabase.from('feedback_votes').delete().eq('thread_id', thread.id).eq('user_id', user.id);
        await supabase.from('feedback_threads').update({ vote_count: Math.max(0, thread.vote_count - 1) }).eq('id', thread.id);
      } else {
        await supabase.from('feedback_votes').insert({ thread_id: thread.id, user_id: user.id });
        await supabase.from('feedback_threads').update({ vote_count: thread.vote_count + 1 }).eq('id', thread.id);
      }
      onUpdated();
    } catch (err) {
      console.error('Vote failed:', err);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 pb-3 border-b">
          <SheetTitle className="text-base text-foreground pr-6">{thread.title}</SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            {thread.profile?.display_name || 'Okänd'} · {formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}
          </SheetDescription>
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant={thread.user_voted ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={handleVote}
            >
              <TrendingUp className="h-3 w-3" />
              {thread.vote_count}
            </Button>
            <Badge variant="outline" className="text-xs">{currentStatus}</Badge>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4">
          <div className="space-y-4 py-4">
            {/* Description */}
            {thread.description && (
              <p className="text-sm text-foreground whitespace-pre-wrap">{thread.description}</p>
            )}

            {/* Admin status control */}
            {isAdmin && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Status (admin)</label>
                <Select value={currentStatus} onValueChange={handleStatusChange}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Comments */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground">
                Kommentarer ({comments.length})
              </h4>
              {isLoading ? (
                <div className="text-xs text-muted-foreground">Laddar…</div>
              ) : comments.length === 0 ? (
                <div className="text-xs text-muted-foreground">Inga kommentarer ännu</div>
              ) : (
                comments.map(c => (
                  <div key={c.id} className="rounded-md border bg-muted/30 p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {c.profile?.display_name || 'Okänd'}
                      </span>
                      <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{c.comment}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Comment input */}
        <div className="border-t p-3 flex gap-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Skriv en kommentar…"
            rows={2}
            className="text-sm"
          />
          <Button
            size="sm"
            onClick={handleSubmitComment}
            disabled={!newComment.trim() || isSubmitting}
            className="self-end"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default FeedbackThreadDetail;
