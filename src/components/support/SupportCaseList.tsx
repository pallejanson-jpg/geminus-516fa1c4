import React, { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Clock, AlertCircle, CheckCircle, XCircle, Search, Mail, Phone } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatDistanceToNow } from 'date-fns';
import SupportCaseDetail from './SupportCaseDetail';

export interface SupportCase {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string;
  building_name: string | null;
  building_fm_guid: string | null;
  reported_by: string;
  bcf_issue_id: string | null;
  screenshot_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  external_reference: string | null;
  location_description: string | null;
  installation_number: string | null;
  desired_date: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const STATUS_FILTERS = [
  { value: 'all', label: 'Alla' },
  { value: 'new', label: 'Nytt' },
  { value: 'in_progress', label: 'Pågående' },
  { value: 'resolved', label: 'Löst' },
  { value: 'closed', label: 'Stängt' },
];

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  new: { icon: AlertCircle, color: 'text-blue-500', label: 'Nytt' },
  in_progress: { icon: Clock, color: 'text-amber-500', label: 'Pågående' },
  resolved: { icon: CheckCircle, color: 'text-green-500', label: 'Löst' },
  closed: { icon: XCircle, color: 'text-muted-foreground', label: 'Stängt' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-primary/10 text-primary',
  high: 'bg-amber-500/10 text-amber-600',
  critical: 'bg-destructive/10 text-destructive',
};

const CATEGORY_LABELS: Record<string, string> = {
  question: 'Fråga',
  fault: 'Felanmälan',
  service: 'Service',
  warranty: 'Garanti',
  inspection: 'Besiktning',
  consultation: 'Rådgivning',
  other: 'Övrigt',
};

const SupportCaseList: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCase, setSelectedCase] = useState<SupportCase | null>(null);

  const fetchCases = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('support_cases')
        .select('*')
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setCases((data as SupportCase[]) || []);
    } catch (err) {
      console.error('Failed to fetch support cases:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
  }, [filter]);

  useEffect(() => {
    const channel = supabase
      .channel('support-cases-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_cases' }, () => {
        fetchCases();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [filter]);

  const filteredCases = searchQuery.trim()
    ? cases.filter(c =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        c.id.slice(0, 8).includes(searchQuery.toLowerCase())
      )
    : cases;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Sök ärenden..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map(f => (
          <Badge
            key={f.value}
            variant={filter === f.value ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Badge>
        ))}
      </div>

      {/* Case list */}
      {filteredCases.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {searchQuery ? 'Inga ärenden matchar sökningen' : 'Inga ärenden att visa'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredCases.map(c => {
            const statusCfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.new;
            const StatusIcon = statusCfg.icon;
            const caseNumber = `#${c.id.slice(0, 8).toUpperCase()}`;
            const categoryLabel = CATEGORY_LABELS[c.category] || c.category;
            return (
              <Card
                key={c.id}
                className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setSelectedCase(c)}
              >
                <div className="flex items-start gap-3">
                  <StatusIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${statusCfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground font-mono">{caseNumber}</span>
                      <span className="font-medium text-sm text-foreground truncate">{c.title}</span>
                    </div>
                    {c.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant="secondary" className="text-xs">{categoryLabel}</Badge>
                      <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[c.priority] || ''}`}>
                        {c.priority}
                      </Badge>
                      {c.bcf_issue_id && (
                        <Badge variant="secondary" className="text-xs">BCF</Badge>
                      )}
                      {(c.contact_email || c.contact_phone) && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          {c.contact_email && <Mail className="h-3 w-3" />}
                          {c.contact_phone && <Phone className="h-3 w-3" />}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      {c.building_name && <span>{c.building_name}</span>}
                      {c.building_name && <span>•</span>}
                      <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs flex-shrink-0">
                    {statusCfg.label}
                  </Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <SupportCaseDetail
        supportCase={selectedCase}
        open={!!selectedCase}
        onClose={() => setSelectedCase(null)}
        onUpdated={fetchCases}
      />
    </div>
  );
};

export default SupportCaseList;
