import React, { useState, useEffect } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Send, Loader2, User, Clock, MapPin, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';
import type { SupportCase } from './SupportCaseList';

interface CaseComment {
  id: string;
  user_id: string;
  comment: string;
  created_at: string;
  profile?: { display_name: string | null; avatar_url: string | null };
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'Nytt' },
  { value: 'in_progress', label: 'Pågående' },
  { value: 'resolved', label: 'Löst' },
  { value: 'closed', label: 'Stängt' },
];

interface Props {
  supportCase: SupportCase | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const SupportCaseDetail: React.FC<Props> = ({ supportCase, open, onClose, onUpdated }) => {
  const { user, isAdmin } = useAuth();
  const [comments, setComments] = useState<CaseComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(supportCase?.status || 'new');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    if (supportCase) {
      setCurrentStatus(supportCase.status);
      fetchComments(supportCase.id);
    }
  }, [supportCase?.id]);

  const fetchComments = async (caseId: string) => {
    setLoadingComments(true);
    try {
      const { data, error } = await supabase
        .from('support_case_comments')
        .select('id, user_id, comment, created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const userIds = [...new Set((data || []).map(c => c.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', userIds);
      const pMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      setComments((data || []).map(c => ({ ...c, profile: pMap.get(c.user_id) })));
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    } finally {
      setLoadingComments(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !supportCase || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('support_case_comments').insert({
        case_id: supportCase.id,
        user_id: user.id,
        comment: newComment.trim(),
      });
      if (error) throw error;
      setNewComment('');
      await fetchComments(supportCase.id);
      toast({ title: 'Kommentar skickad' });
    } catch {
      toast({ title: 'Kunde inte skicka kommentar', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!supportCase || !isAdmin) return;
    setUpdatingStatus(true);
    try {
      const updateData: Record<string, unknown> = { status: newStatus };
      if (newStatus === 'resolved') updateData.resolved_at = new Date().toISOString();
      const { error } = await supabase
        .from('support_cases')
        .update(updateData)
        .eq('id', supportCase.id);
      if (error) throw error;
      setCurrentStatus(newStatus);
      onUpdated?.();
      toast({ title: 'Status uppdaterad' });
    } catch {
      toast({ title: 'Kunde inte uppdatera status', variant: 'destructive' });
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (!supportCase) return null;

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent className="sm:max-w-lg w-full flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <SheetTitle className="text-left">{supportCase.title}</SheetTitle>
          <SheetDescription className="text-left flex items-center gap-2 mt-1">
            <Badge variant="outline">{supportCase.category}</Badge>
            <span className="text-xs text-muted-foreground">
              {format(new Date(supportCase.created_at), 'PPP')}
            </span>
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-4 py-4">
            {supportCase.screenshot_url && (
              <div className="rounded-lg overflow-hidden border">
                <img src={supportCase.screenshot_url} alt="Screenshot" className="w-full h-40 object-cover" />
              </div>
            )}

            {supportCase.description && (
              <div>
                <h4 className="text-sm font-medium mb-1">Beskrivning</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{supportCase.description}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              {supportCase.building_name && (
                <div>
                  <span className="text-muted-foreground">Byggnad</span>
                  <p className="font-medium text-foreground">{supportCase.building_name}</p>
                </div>
              )}
              {supportCase.contact_email && (
                <div>
                  <span className="text-muted-foreground">E-post</span>
                  <p className="font-medium text-foreground">{supportCase.contact_email}</p>
                </div>
              )}
              {supportCase.contact_phone && (
                <div>
                  <span className="text-muted-foreground">Telefon</span>
                  <p className="font-medium text-foreground">{supportCase.contact_phone}</p>
                </div>
              )}
            </div>

            {supportCase.bcf_issue_id && (
              <div className="flex items-center gap-2 text-sm">
                <Link2 className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">Länkad till BCF-issue</span>
              </div>
            )}

            {/* Admin status */}
            {isAdmin && (
              <div>
                <h4 className="text-sm font-medium mb-2">Status</h4>
                <Select value={currentStatus} onValueChange={handleStatusChange} disabled={updatingStatus}>
                  <SelectTrigger className="w-full">
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

            <Separator />

            {/* Comments */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                Kommentarer
                {comments.length > 0 && <Badge variant="secondary" className="text-xs">{comments.length}</Badge>}
              </h4>
              {loadingComments ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : comments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Inga kommentarer ännu</p>
              ) : (
                <div className="space-y-3">
                  {comments.map(c => (
                    <div key={c.id} className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        {c.profile?.avatar_url ? (
                          <img src={c.profile.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                        ) : (
                          <User className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{c.profile?.display_name || 'Användare'}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">{c.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* Comment input */}
        <div className="flex-shrink-0 pt-4 border-t space-y-2">
          <Textarea
            placeholder="Skriv en kommentar..."
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            rows={2}
            disabled={submitting}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSubmitComment} disabled={!newComment.trim() || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <><Send className="h-4 w-4 mr-1" />Skicka</>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default SupportCaseDetail;
