import React, { useState, useContext, useEffect } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, CalendarIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { AppContext } from '@/context/AppContext';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  prefill?: {
    title?: string;
    description?: string;
    screenshot_url?: string;
    bcf_issue_id?: string;
    building_fm_guid?: string;
    building_name?: string;
  };
}

// SWG portal category types (from screenshot)
const CATEGORY_OPTIONS = [
  { value: 'Drawing files - delivery', label: 'Drawing files - delivery' },
  { value: 'Drawing files - delivery - Revit A', label: 'Drawing files - delivery - Revit A' },
  { value: 'Drawing files - delivery - Model, CAD', label: 'Drawing files - delivery - Model, CAD' },
  { value: 'Drawing files - printing', label: 'Drawing files - printing' },
  { value: 'Drawing files - distribution', label: 'Drawing files - distribution' },
  { value: 'Area changes', label: 'Area changes' },
  { value: 'Visualization', label: 'Visualization' },
  { value: 'Laser scanning', label: 'Laser scanning' },
  { value: 'Outdoor', label: 'Outdoor' },
  { value: 'Asset+', label: 'Asset+' },
  { value: 'Interaxo', label: 'Interaxo' },
  { value: 'Supportärende', label: 'Supportärende' },
  { value: 'Annat ärende', label: 'Annat ärende' },
];

interface BuildingOption {
  fm_guid: string;
  name: string;
}

const CreateSupportCase: React.FC<Props> = ({ open, onClose, onCreated, prefill }) => {
  const { user } = useAuth();
  const { selectedFacility } = useContext(AppContext);

  const [title, setTitle] = useState(prefill?.title || '');
  const [description, setDescription] = useState(prefill?.description || '');
  const [priority, setPriority] = useState('medium');
  const [category, setCategory] = useState('Supportärende');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [locationDescription, setLocationDescription] = useState('');
  const [installationNumber, setInstallationNumber] = useState('');
  const [desiredDate, setDesiredDate] = useState<Date | undefined>(undefined);
  const [buildingGuid, setBuildingGuid] = useState(prefill?.building_fm_guid || selectedFacility?.fm_guid || '');
  const [buildingName, setBuildingName] = useState(prefill?.building_name || selectedFacility?.name || '');
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      supabase.from('assets').select('building_fm_guid, common_name')
        .eq('category', 'Building')
        .then(({ data }) => {
          if (data) {
            const unique = new Map<string, string>();
            data.forEach(d => {
              if (d.building_fm_guid && !unique.has(d.building_fm_guid)) {
                unique.set(d.building_fm_guid, d.common_name || d.building_fm_guid);
              }
            });
            setBuildings(Array.from(unique, ([fm_guid, name]) => ({ fm_guid, name })));
          }
        });
    }
  }, [open]);

  const handleBuildingChange = (guid: string) => {
    setBuildingGuid(guid);
    const b = buildings.find(b => b.fm_guid === guid);
    setBuildingName(b?.name || guid);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !user) return;
    setSubmitting(true);
    try {
      // Send to SWG via proxy
      const { data: proxyResult, error: proxyError } = await supabase.functions.invoke('support-proxy', {
        body: {
          action: 'create-request',
          payload: {
            name: title.trim(),
            description: description.trim() || null,
            productName: category,
            area: buildingName || null,
            location: locationDescription.trim() || null,
            installationNumber: installationNumber.trim() || null,
            contactEmail: contactEmail.trim() || null,
            contactPhone: contactPhone.trim() || null,
            startDate: desiredDate ? desiredDate.toISOString() : null,
          },
        },
      });

      if (proxyError) {
        console.error('SWG proxy error:', proxyError);
      } else {
        console.log('SWG create-request response:', proxyResult);
      }

      // Also save local backup
      await supabase.from('support_cases').insert({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        category,
        reported_by: user.id,
        building_fm_guid: buildingGuid || null,
        building_name: buildingName || null,
        bcf_issue_id: prefill?.bcf_issue_id || null,
        screenshot_url: prefill?.screenshot_url || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        location_description: locationDescription.trim() || null,
        installation_number: installationNumber.trim() || null,
        desired_date: desiredDate ? desiredDate.toISOString() : null,
        external_reference: proxyResult?.data?.id ? String(proxyResult.data.id) : null,
      }).then(({ error }) => {
        if (error) console.warn('Local backup save failed:', error);
      });

      toast({ title: 'Case created' });
      onCreated();
    } catch (err) {
      console.error('Failed to create support case:', err);
      toast({ title: 'Could not create case', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New support case</SheetTitle>
          <SheetDescription>Describe your case and we will get back to you</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Brief description of the case" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Case type</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Detailed description..." rows={4} />
          </div>

          {/* Building selector */}
          <div className="space-y-2">
            <Label>Building</Label>
            {buildings.length > 0 ? (
              <Select value={buildingGuid} onValueChange={handleBuildingChange}>
                <SelectTrigger><SelectValue placeholder="Select building..." /></SelectTrigger>
                <SelectContent>
                  {buildings.map(b => (
                    <SelectItem key={b.fm_guid} value={b.fm_guid}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={buildingName} onChange={e => setBuildingName(e.target.value)} placeholder="Building name" />
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="location">Location / Space</Label>
              <Input id="location" value={locationDescription} onChange={e => setLocationDescription(e.target.value)} placeholder="E.g. Floor 3, room 301" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="installation">Installation number</Label>
              <Input id="installation" value={installationNumber} onChange={e => setInstallationNumber(e.target.value)} placeholder="E.g. HVAC-001" />
            </div>
          </div>

          {/* Desired date */}
          <div className="space-y-2">
            <Label>Desired resolution date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !desiredDate && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {desiredDate ? format(desiredDate, 'PPP') : 'Select date...'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={desiredDate}
                  onSelect={setDesiredDate}
                  disabled={(date) => date < new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Contact email</Label>
              <Input id="email" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="your@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Contact phone</Label>
              <Input id="phone" type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+46..." />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={!title.trim() || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit case'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CreateSupportCase;
