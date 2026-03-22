import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThumbsUp, Plus, Lightbulb, Bug, HelpCircle, MessageSquare, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import FeedbackCreateForm from './FeedbackCreateForm';
import FeedbackThreadDetail from './FeedbackThreadDetail';

export interface FeedbackThread {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  vote_count: number;
  created_at: string;
  updated_at: string;
  profile?: { display_name: string | null };
  user_voted?: boolean;
  comment_count?: number;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  suggestion: { label: 'Suggestion', icon: Lightbulb, color: 'text-amber-500' },
  ux_issue: { label: 'UX issue', icon: Bug, color: 'text-destructive' },
  bug: { label: 'Bug', icon: Bug, color: 'text-destructive' },
  question: { label: 'Question', icon: HelpCircle, color: 'text-primary' },
};

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  open: { label: 'Open', variant: 'outline' },
  planned: { label: 'Planned', variant: 'secondary' },
  in_progress: { label: 'In progress', variant: 'default' },
  done: { label: 'Done', variant: 'default' },
  declined: { label: 'Declined', variant: 'destructive' },
};

const FeedbackView: React.FC = () => {
  const { user } = useAuth();
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedThread, setSelectedThread] = useState<FeedbackThread | null>(null);

  const fetchThreads = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('feedback_threads')
        .select('*')
        .order('vote_count', { ascending: false });

      if (categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Get profiles for display names
      const userIds = [...new Set((data || []).map(t => t.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      // Get user votes
      let votedIds: Set<string> = new Set();
      if (user) {
        const { data: votes } = await supabase
          .from('feedback_votes')
          .select('thread_id')
          .eq('user_id', user.id);
        votedIds = new Set(votes?.map(v => v.thread_id) || []);
      }

      // Get comment counts
      const threadIds = (data || []).map(t => t.id);
      const { data: comments } = await supabase
        .from('feedback_comments')
        .select('thread_id')
        .in('thread_id', threadIds);
      const commentCounts = new Map<string, number>();
      comments?.forEach(c => {
        commentCounts.set(c.thread_id, (commentCounts.get(c.thread_id) || 0) + 1);
      });

      setThreads((data || []).map(t => ({
        ...t,
        profile: profileMap.get(t.user_id),
        user_voted: votedIds.has(t.id),
        comment_count: commentCounts.get(t.id) || 0,
      })));
    } catch (err) {
      console.error('Failed to fetch feedback threads:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchThreads();
  }, [categoryFilter, user?.id]);

  const handleVote = async (thread: FeedbackThread, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;

    try {
      if (thread.user_voted) {
        await supabase.from('feedback_votes').delete().eq('thread_id', thread.id).eq('user_id', user.id);
        await supabase.from('feedback_threads').update({ vote_count: Math.max(0, thread.vote_count - 1) }).eq('id', thread.id);
      } else {
        await supabase.from('feedback_votes').insert({ thread_id: thread.id, user_id: user.id });
        await supabase.from('feedback_threads').update({ vote_count: thread.vote_count + 1 }).eq('id', thread.id);
      }
      fetchThreads();
    } catch (err) {
      console.error('Vote failed:', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          New idea
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Laddar…</div>
      ) : threads.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Inga förslag ännu. Var först med att lämna feedback!
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map(thread => {
            const cat = CATEGORY_CONFIG[thread.category] || CATEGORY_CONFIG.suggestion;
            const status = STATUS_CONFIG[thread.status] || STATUS_CONFIG.open;
            const CatIcon = cat.icon;

            return (
              <Card
                key={thread.id}
                className="p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setSelectedThread(thread)}
              >
                <div className="flex gap-3">
                  {/* Vote button */}
                  <button
                    onClick={(e) => handleVote(thread, e)}
                    className={cn(
                      "flex flex-col items-center justify-center min-w-[44px] rounded-md border px-2 py-1 text-xs transition-colors",
                      thread.user_voted
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-muted border-border text-muted-foreground hover:bg-accent"
                    )}
                  >
                    <TrendingUp className="h-4 w-4" />
                    <span className="font-semibold">{thread.vote_count}</span>
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <CatIcon className={cn("h-3.5 w-3.5 shrink-0", cat.color)} />
                      <span className="text-sm font-medium text-foreground truncate">{thread.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={status.variant} className="text-[10px] px-1.5 py-0">
                        {status.label}
                      </Badge>
                      <span>{thread.profile?.display_name || 'Okänd'}</span>
                      <span>·</span>
                      <span>{formatDistanceToNow(new Date(thread.created_at), { addSuffix: true })}</span>
                      {(thread.comment_count || 0) > 0 && (
                        <span className="flex items-center gap-0.5">
                          <MessageSquare className="h-3 w-3" />
                          {thread.comment_count}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showCreate && (
        <FeedbackCreateForm
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchThreads(); }}
        />
      )}

      {selectedThread && (
        <FeedbackThreadDetail
          thread={selectedThread}
          open={!!selectedThread}
          onClose={() => setSelectedThread(null)}
          onUpdated={fetchThreads}
        />
      )}
    </div>
  );
};

export default FeedbackView;
