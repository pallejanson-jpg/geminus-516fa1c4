
# Åtgärda mobilproblem: AI Skanning-knapp och listuppdatering

## Problem som ska åtgärdas

### Problem 1: AI Skanning-knappen saknas på mobil
Knappen finns bara i desktop-layouten men inte i `MobileInventoryWizard`.

### Problem 2: Inventarielistan uppdateras inte efter redigering
När en redigerad asset sparas verkar listan inte uppdateras korrekt.

---

## Lösning

### 1. Lägg till AI Skanning-knapp i mobilwizarden

Lägga till en navigeringsknapp i headern på `MobileInventoryWizard.tsx`:

```text
┌───────────────────────────────────────────────────┐
│ [←] 📋 Inventering          [🤖] [+] [≡]         │
│                              ↑                    │
│                         AI Skanning-knapp         │
└───────────────────────────────────────────────────┘
```

**Ändringar i `MobileInventoryWizard.tsx`:**
- Importera `useNavigate` från react-router-dom
- Importera `Scan`-ikonen från lucide-react
- Lägga till en knapp i headern som navigerar till `/inventory/ai-scan`

### 2. Fixa listuppdatering efter redigering

Undersöka och säkerställa att:
- `QuickRegistrationStep` hanterar både nya och redigerade assets
- Efter sparande triggas `loadSavedItems()` korrekt
- Eventuellt skicka med `editItem` till `QuickRegistrationStep` så att den vet om det är en uppdatering

**Ändringar i `MobileInventoryWizard.tsx`:**
- Lägg till state för att hålla reda på om vi redigerar (`editingItem`)
- Skicka `editingItem` till `QuickRegistrationStep`
- Efter sparande, rensa `editingItem` och ladda om listan

---

## Tekniska detaljer

### Fil 1: `src/components/inventory/mobile/MobileInventoryWizard.tsx`

**Ändringar:**
1. Lägg till imports:
   ```typescript
   import { useNavigate } from 'react-router-dom';
   import { Scan } from 'lucide-react';
   ```

2. I komponenten, lägg till:
   ```typescript
   const navigate = useNavigate();
   const [editingItem, setEditingItem] = useState<SavedItem | null>(null);
   ```

3. Uppdatera header-sektionen (rad 302-344) för att inkludera AI Skanning-knappen:
   ```typescript
   <Button
     variant="ghost"
     size="icon"
     onClick={() => navigate('/inventory/ai-scan')}
     className="h-9 w-9"
   >
     <Scan className="h-5 w-5" />
   </Button>
   ```

4. Uppdatera `handleEditItem` för att sätta `editingItem`:
   ```typescript
   const handleEditItem = useCallback((item: SavedItem) => {
     setEditingItem(item);  // Spara referens till originalet
     // ... existing logic
   }, []);
   ```

5. Uppdatera `handleRegistrationComplete` för att rensa `editingItem` och säkerställa omladdning:
   ```typescript
   const handleRegistrationComplete = useCallback((registerAnother: boolean) => {
     setEditingItem(null);  // Rensa redigeringsläget
     setSavedCount((prev) => prev + 1);
     onItemSaved();
     // ... existing logic
   }, [...]);
   ```

6. Skicka `editingItem` till `QuickRegistrationStep`:
   ```typescript
   <QuickRegistrationStep
     formData={formData}
     updateFormData={updateFormData}
     onComplete={handleRegistrationComplete}
     quickLoopEnabled={quickLoopEnabled}
     editingItem={editingItem}  // Ny prop
   />
   ```

### Fil 2: `src/components/inventory/mobile/QuickRegistrationStep.tsx`

**Ändringar:**
1. Lägg till ny prop `editingItem`
2. Om `editingItem` finns, använd UPDATE istället för INSERT vid sparande
3. Uppdatera rubriktext baserat på om det är redigering eller ny registrering

---

## Sammanfattning av filändringar

| Fil | Ändringar |
|-----|-----------|
| `src/components/inventory/mobile/MobileInventoryWizard.tsx` | Lägg till AI Skanning-knapp, hantera editingItem state |
| `src/components/inventory/mobile/QuickRegistrationStep.tsx` | Stöd för uppdatering av befintlig asset (UPDATE vs INSERT) |

---

## Förväntade resultat

1. **AI Skanning-knappen** syns nu i mobilvyn bredvid de andra knapparna i headern
2. **Listan uppdateras korrekt** när man redigerar och sparar en befintlig asset
3. Befintliga assets uppdateras (UPDATE) istället för att nya skapas (INSERT) vid redigering
