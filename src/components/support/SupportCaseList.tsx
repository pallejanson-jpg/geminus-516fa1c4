import React, { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, Clock, AlertCircle, CheckCircle, XCircle, Search, FileText, Eye, Package, PlayCircle, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import SupportCaseDetail from './SupportCaseDetail';

// SWG request mapped to our interface
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
  // SWG-specific fields
  swg_id?: number;
  swg_status?: string;
  swg_product?: string;
}

const STATUS_FILTERS = [
  { value: 'all', label: 'Alla' },
  { value: 'New', label: 'Nytt' },
  { value: 'UnderReview', label: 'Granskas' },
  { value: 'AwaitingResponse', label: 'Väntar svar' },
  { value: 'InProgress', label: 'Pågående' },
  { value: 'Planned', label: 'Planerat' },
  { value: 'Done', label: 'Klart' },
  { value: 'Completed', label: 'Avslutat' },
  { value: 'Closed', label: 'Stängt' },
];

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  New: { icon: AlertCircle, color: 'text-blue-500', label: 'Nytt' },
  UnderReview: { icon: Eye, color: 'text-purple-500', label: 'Granskas' },
  AwaitingResponse: { icon: MessageSquare, color: 'text-amber-500', label: 'Väntar svar' },
  AwaitingOrder: { icon: Package, color: 'text-orange-500', label: 'Väntar order' },
  Planned: { icon: FileText, color: 'text-indigo-500', label: 'Planerat' },
  InProgress: { icon: PlayCircle, color: 'text-cyan-500', label: 'Pågående' },
  Done: { icon: CheckCircle, color: 'text-green-500', label: 'Klart' },
  Completed: { icon: CheckCircle, color: 'text-emerald-600', label: 'Avslutat' },
  Closed: { icon: XCircle, color: 'text-muted-foreground', label: 'Stängt' },
  // Fallbacks for local cases
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

// Map SWG API response to our SupportCase interface
function mapSwgRequest(r: Record<string, unknown>): SupportCase {
  return {
    id: String(r.id || r.Id || ''),
    title: String(r.name || r.Name || r.title || r.Title || r.subject || r.Subject || ''),
    description: (r.description || r.Description || null) as string | null,
    status: String(r.status || r.Status || r.statusName || r.StatusName || 'New'),
    priority: String(r.priority || r.Priority || 'medium'),
    category: String(r.productName || r.ProductName || r.product || r.Product || r.category || r.Category || ''),
    building_name: (r.buildingName || r.BuildingName || r.area || r.Area || null) as string | null,
    building_fm_guid: null,
    reported_by: String(r.createdBy || r.CreatedBy || r.reportedBy || ''),
    bcf_issue_id: null,
    screenshot_url: null,
    contact_email: (r.contactEmail || r.ContactEmail || null) as string | null,
    contact_phone: (r.contactPhone || r.ContactPhone || null) as string | null,
    external_reference: (r.referenceNumber || r.ReferenceNumber || r.externalReference || null) as string | null,
    location_description: (r.location || r.Location || null) as string | null,
    installation_number: (r.installationNumber || r.InstallationNumber || null) as string | null,
    desired_date: (r.desiredDate || r.DesiredDate || r.startDate || r.StartDate || null) as string | null,
    created_at: String(r.created || r.Created || r.createdAt || r.CreatedAt || new Date().toISOString()),
    updated_at: String(r.updated || r.Updated || r.updatedAt || r.UpdatedAt || new Date().toISOString()),
    resolved_at: (r.resolvedAt || r.ResolvedAt || r.completedAt || r.CompletedAt || null) as string | null,
    swg_id: typeof r.id === 'number' ? r.id : undefined,
    swg_status: String(r.statusName || r.StatusName || r.status || r.Status || ''),
    swg_product: String(r.productName || r.ProductName || ''),
  };
}

const SupportCaseList: React.FC = () => {
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCase, setSelectedCase] = useState<SupportCase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build SWG filter based on selected status
      const searchShow: Record<string, boolean> = {
        showNew: filter === 'all' || filter === 'New',
        showUnderReview: filter === 'all' || filter === 'UnderReview',
        showAwaitingResponse: filter === 'all' || filter === 'AwaitingResponse',
        showAwaitingOrder: filter === 'all' || filter === 'AwaitingOrder',
        showPlanned: filter === 'all' || filter === 'Planned',
        showInProgress: filter === 'all' || filter === 'InProgress',
        showDone: filter === 'all' || filter === 'Done',
        showCompleted: filter === 'all' || filter === 'Completed',
        showClosed: filter === 'all' || filter === 'Closed',
      };

      const { data, error: fnError } = await supabase.functions.invoke('support-proxy', {
        body: {
          action: 'list-requests',
          filter: {
            excludeDetails: false,
            includeDescription: true,
            searchShow,
          },
        },
      });

      if (fnError) throw fnError;

      console.log('SWG list-requests response:', data);

      // The proxy wraps the response as { status, data }
      const responseData = data?.data;
      
      if (Array.isArray(responseData)) {
        setCases(responseData.map(mapSwgRequest));
      } else if (responseData && typeof responseData === 'object') {
        // Maybe data is wrapped in another property
        const items = (responseData as Record<string, unknown>).requests || 
                      (responseData as Record<string, unknown>).items || 
                      (responseData as Record<string, unknown>).data ||
                      (responseData as Record<string, unknown>).result;
        if (Array.isArray(items)) {
          setCases(items.map(mapSwgRequest));
        } else {
          console.warn('Unexpected SWG response shape:', responseData);
          setCases([]);
        }
      } else {
        setCases([]);
      }
    } catch (err) {
      console.error('Failed to fetch support cases:', err);
      setError('Kunde inte hämta ärenden från SWG');
      setCases([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  const filteredCases = searchQuery.trim()
    ? cases.filter(c =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.description && c.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        String(c.id).includes(searchQuery)
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
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md p-3">
          {error}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search cases..."
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
            const statusCfg = STATUS_CONFIG[c.status] || STATUS_CONFIG[c.swg_status || ''] || STATUS_CONFIG.New;
            const StatusIcon = statusCfg.icon;
            const caseNumber = c.swg_id ? `#${c.swg_id}` : `#${String(c.id).slice(0, 8).toUpperCase()}`;
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
                      {c.category && (
                        <Badge variant="secondary" className="text-xs">{c.category}</Badge>
                      )}
                      {c.swg_product && c.swg_product !== c.category && (
                        <Badge variant="outline" className="text-xs">{c.swg_product}</Badge>
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
