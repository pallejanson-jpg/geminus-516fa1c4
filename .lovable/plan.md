

# Plan: Ta bort skanningar och utöka mallhantering

## Översikt

Denna plan implementerar tre funktioner:
1. Möjlighet att ta bort gamla skanningsjobb från listan
2. Lägga till nya detektionsmallar för fler objekttyper
3. Utöka mallformulär med kategori och symbolval

---

## Del 1: Ta bort skanningsjobb

### Fil: `src/components/ai-scan/ScanProgressPanel.tsx`

Lägg till en borttagningsknapp för varje jobb i listan "Tidigare skanningar".

**Ändringar:**
- Importera `Trash2` och `AlertDialog`-komponenter
- Lägg till `deleteScanJob()` funktion som anropar edge function
- Ny `delete-scan-job` action med bekräftelsedialog
- Endast avslutade jobb kan raderas (completed, cancelled, failed)

**Layout:**
```text
┌─────────────────────────────────────────────────────────┐
│ [Badge: Klar] Brandsläckare                    [🗑] │
│ 2026-01-31 10:30               45 hittade, 120 bilder │
└─────────────────────────────────────────────────────────┘
```

### Fil: `supabase/functions/ai-asset-detection/index.ts`

Ny action `delete-scan-job`:
- Ta bort alla pending_detections kopplade till jobbet
- Ta bort scan_job-raden
- Returnera bekräftelse

---

## Del 2: Nya detektionsmallar

### Databasinlägg

Följande 8 nya mallar ska skapas:

| Namn | Object Type | Kategori | Symbol | AI-prompt |
|------|-------------|----------|--------|-----------|
| Larmknapp | alarm_button | Fire | Brandlarmsknapp | Look for red fire alarm pull stations or manual call points mounted on walls... |
| Brandslang | fire_hose | Fire | Brandslang | Look for fire hose cabinets, fire hose reels, or wall-mounted fire hose compartments... |
| Röklucka | smoke_vent | Fire | null | Look for smoke ventilation hatches on ceilings or walls, roof smoke vents... |
| Hiss | elevator | Byggnadsdel | null | Look for elevator doors, lift entrances. They are tall rectangular metal doors... |
| Rulltrappa | escalator | Byggnadsdel | null | Look for escalators, moving stairs. They have steps, handrails... |
| Dörr | door | Byggnadsdel | null | Look for doors including fire doors, emergency exits, security doors... |
| Elskåp | electrical_cabinet | Installation | null | Look for electrical distribution cabinets, fuse boxes, power panels... |
| Trappa | staircase | Byggnadsdel | null | Look for staircases, stairwells, emergency stairways... |

---

## Del 3: Utöka mallformulär med symbol

### Fil: `src/components/ai-scan/TemplateManagement.tsx`

Uppdatera formuläret för att inkludera en dropdown för symbolval:

**Ändringar:**
- Hämta alla tillgängliga symboler från `annotation_symbols`
- Lägg till `Select`-komponent för symbolval
- Visa symbol-ikon om tillgänglig
- Skicka `default_symbol_id` vid sparning

**Uppdaterat formulär:**
```text
┌─────────────────────────────────────────────────────┐
│ Namn *              │ Objekttyp *                   │
│ [Brandsläckare    ] │ [fire_extinguisher          ] │
├─────────────────────────────────────────────────────┤
│ Beskrivning                                         │
│ [Röda brandsläckare monterade på väggar           ] │
├─────────────────────────────────────────────────────┤
│ Kategori            │ Symbol                        │
│ [Brandredskap     ] │ [🔴 Brandsläckare CO2 ▼    ] │  ← NY
├─────────────────────────────────────────────────────┤
│ AI-prompt *                                         │
│ [Look for red fire extinguishers...               ] │
└─────────────────────────────────────────────────────┘
```

### Fil: `supabase/functions/ai-asset-detection/index.ts`

Uppdatera `update-template` och `create-template` för att hantera `default_symbol_id`.

---

## Teknisk sammanfattning

### Filer som ändras

| Fil | Åtgärd | Beskrivning |
|-----|--------|-------------|
| `src/components/ai-scan/ScanProgressPanel.tsx` | Ändra | Lägg till borttagningsfunktion för skanningsjobb |
| `src/components/ai-scan/TemplateManagement.tsx` | Ändra | Lägg till symbolväljare i formuläret |
| `supabase/functions/ai-asset-detection/index.ts` | Ändra | Ny action `delete-scan-job` |
| Databas | Insert | 8 nya detektionsmallar |

### Nya detektionsmallar - SQL

```sql
INSERT INTO detection_templates (name, object_type, description, default_category, default_symbol_id, ai_prompt, is_active)
VALUES 
  ('Larmknapp', 'alarm_button', 'Manuella brandlarmsknappar på väggar', 'Fire', 
   '8bdb82e0-92ba-4dd5-a3a7-0e355a5fd8a1',
   'Look for red fire alarm pull stations or manual call points mounted on walls. They are typically small red boxes with a handle or button, often with a glass panel that needs to be broken. They may have text like "FIRE" or "BRAND" and an alarm symbol.', true),
  
  ('Brandslang', 'fire_hose', 'Brandslangsskåp och slangrullar', 'Fire',
   '14c4b20b-3a4a-4647-aa75-a406fa5846e9',
   'Look for fire hose cabinets, fire hose reels, or wall-mounted fire hose compartments. They are typically red or white cabinets with glass doors, containing a rolled-up hose. Look for labels saying "FIRE HOSE" or fire hose symbols.', true),
  
  ('Röklucka', 'smoke_vent', 'Rökluckor i tak eller väggar', 'Fire', NULL,
   'Look for smoke ventilation hatches on ceilings or walls, roof smoke vents, or AOV (Automatic Opening Vent) panels. They may have control buttons nearby or be integrated into the ceiling. Look for smoke ventilation signs or labels.', true),
  
  ('Hiss', 'elevator', 'Hissdörrar och hissentréer', 'Byggnadsdel', NULL,
   'Look for elevator doors, lift entrances, or service lifts. They are typically tall rectangular metal doors (often stainless steel or painted) with call buttons nearby. Look for floor indicators above the doors and accessibility signs.', true),
  
  ('Rulltrappa', 'escalator', 'Rulltrappor', 'Byggnadsdel', NULL,
   'Look for escalators or moving stairs. They have metal steps, rubber handrails on both sides, and typically connect different floor levels. Look for the characteristic diagonal slope and the comb plates at entry/exit points.', true),
  
  ('Dörr', 'door', 'Dörrar inklusive branddörrar', 'Byggnadsdel', NULL,
   'Look for doors including fire doors, emergency exits, security doors, and access-controlled doors. Focus on doors with signage (fire door, keep closed, emergency exit), door closers, card readers, or special markings. Skip normal office or room doors.', true),
  
  ('Elskåp', 'electrical_cabinet', 'Elcentraler och ställverk', 'Installation', NULL,
   'Look for electrical distribution cabinets, fuse boxes, power panels, or electrical switchboards. They are typically grey or beige metal cabinets with warning signs (lightning bolt symbol, "DANGER HIGH VOLTAGE"). They may have meters or indicators visible.', true),
  
  ('Trappa', 'staircase', 'Trappor och trapphus', 'Byggnadsdel', NULL,
   'Look for staircases, stairwells, emergency stairways, or fire escape stairs. Focus on main access points and entrances to stairwells. Look for stairway signs, handrails, and emergency lighting. Include both interior and exterior staircases.', true);
```

### Edge function-ändringar

**Ny action: `delete-scan-job`**
```typescript
async function deleteScanJob(scanJobId: string): Promise<{ success: boolean }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Verify job exists and is not running
  const { data: job, error: jobError } = await supabase
    .from('scan_jobs')
    .select('status')
    .eq('id', scanJobId)
    .single();
  
  if (jobError || !job) {
    throw new Error('Scan job not found');
  }
  
  if (job.status === 'running' || job.status === 'queued') {
    throw new Error('Cannot delete a running or queued scan job');
  }
  
  // Delete related pending_detections first
  await supabase
    .from('pending_detections')
    .delete()
    .eq('scan_job_id', scanJobId);
  
  // Delete the scan job
  const { error: deleteError } = await supabase
    .from('scan_jobs')
    .delete()
    .eq('id', scanJobId);
  
  if (deleteError) throw new Error(`Failed to delete: ${deleteError.message}`);
  
  return { success: true };
}
```

---

## Befintliga symboler som kan kopplas

| Symbol | ID | Förslag för mall |
|--------|-----|-----------------|
| Brandlarmsknapp | 8bdb82e0-92ba-4dd5-a3a7-0e355a5fd8a1 | Larmknapp |
| Brandslang | 14c4b20b-3a4a-4647-aa75-a406fa5846e9 | Brandslang |
| Brandsläckare CO2 | 22e0c759-1c47-4b74-917c-9e090351a6cc | Fire Extinguisher |
| Branddörr | e165e79d-5da8-4ec7-88a1-563cef18f0b0 | Dörr (branddörrar) |

---

## Databas-migration för DELETE-behörighet

RLS-policy för att tillåta delete på `scan_jobs`:

```sql
-- Allow deletion of non-active scan jobs
ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scan_jobs_delete" ON scan_jobs
FOR DELETE
USING (
  auth.uid() IS NOT NULL 
  AND status NOT IN ('running', 'queued')
);

-- Allow deletion of pending_detections by authenticated users
CREATE POLICY "pending_detections_delete" ON pending_detections
FOR DELETE
USING (auth.uid() IS NOT NULL);
```

---

## Testplan

1. **Ta bort skanning**
   - Gå till Skanning-fliken
   - Klicka på papperskorgen på en avslutad skanning
   - Bekräfta i dialogen
   - Verifiera att skanningen försvinner från listan

2. **Nya mallar**
   - Gå till Mallar-fliken
   - Verifiera att de 8 nya mallarna visas
   - Kontrollera att symboler visas för de som har koppling

3. **Symbolval i formulär**
   - Redigera en befintlig mall
   - Välj en symbol från dropdown
   - Spara och verifiera att symbolen sparas

