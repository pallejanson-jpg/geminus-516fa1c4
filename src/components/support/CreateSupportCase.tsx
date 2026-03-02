import React, { useState, useContext } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { AppContext } from '@/context/AppContext';

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

const CreateSupportCase: React.FC<Props> = ({ open, onClose, onCreated, prefill }) => {
  const { user } = useAuth();
  const { selectedFacility } = useContext(AppContext);

  const [title, setTitle] = useState(prefill?.title || '');
  const [description, setDescription] = useState(prefill?.description || '');
  const [priority, setPriority] = useState('medium');
  const [category, setCategory] = useState('question');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('support_cases').insert({
        title: title.trim(),
        description: description.trim() || null,
        priority,
        category,
        reported_by: user.id,
        building_fm_guid: prefill?.building_fm_guid || selectedFacility?.fm_guid || null,
        building_name: prefill?.building_name || selectedFacility?.name || null,
        bcf_issue_id: prefill?.bcf_issue_id || null,
        screenshot_url: prefill?.screenshot_url || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
      });
      if (error) throw error;
      toast({ title: 'Ärende skapat' });
      onCreated();
    } catch (err) {
      console.error('Failed to create support case:', err);
      toast({ title: 'Kunde inte skapa ärende', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent className="sm:max-w-lg w-full">
        <SheetHeader>
          <SheetTitle>Nytt supportärende</SheetTitle>
          <SheetDescription>Beskriv ditt ärende så kontaktar vi dig</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titel *</Label>
            <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Kort beskrivning av ärendet" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Beskrivning</Label>
            <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Detaljerad beskrivning..." rows={4} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Prioritet</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Låg</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">Hög</SelectItem>
                  <SelectItem value="critical">Kritisk</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Kategori</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="question">Fråga</SelectItem>
                  <SelectItem value="fault">Fel</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                  <SelectItem value="other">Övrigt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Kontakt e-post</Label>
            <Input id="email" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="din@epost.se" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Kontakt telefon</Label>
            <Input id="phone" type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+46..." />
          </div>

          {(prefill?.building_name || selectedFacility?.name) && (
            <div className="text-sm text-muted-foreground">
              Byggnad: <span className="font-medium text-foreground">{prefill?.building_name || selectedFacility?.name}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Avbryt</Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={!title.trim() || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Skapa ärende'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CreateSupportCase;
