

# Plan: Automatisk 360° POI-skapare i inventeringsflödet

## Problem
1. **3D-picker**: Visar felmeddelande om ingen modell finns — bör visa tydligt meddelande istället
2. **360°-flödet**: Navigerar bort till Ivion och användaren fastnar — ingen väg tillbaka med data
3. **POI skapas inte automatiskt**: Användaren måste manuellt skapa POI i Ivion. AI-data från tidigare steg förloras
4. **FMGUID synkas inte** till Ivion

## Lösning
Geminus tar full kontroll: ingen manuell POI-skapning i Ivion. Användaren pekar i 360°-vyn, Geminus skapar POI automatiskt med AI-data och genererad FMGUID via `ivion-poi` edge function.

## Implementation

### 1. Ny komponent: `Ivion360PositionPicker.tsx`
**Fil:** `src/components/inventory/mobile/Ivion360PositionPicker.tsx` (ny)

Fullskärms-dialog med inline Ivion SDK:
- Laddar Ivion SDK via `useIvionSdk` hook i en container
- Användaren navigerar och tappar på en punkt
- Fångar position via SDK click-event (`mainView` click → image position)
- Visar bekräftelse-bar: "Skapa position här? [Bekräfta] [Välj om]"
- Vid bekräftelse:
  1. Genererar `fmGuid = crypto.randomUUID()`
  2. Anropar `ivion-poi` edge function med `action: 'create-poi'` — skickar namn, kategori, AI-properties från `formData` som `customData` med `fm_guid`
  3. Returnerar `{ coordinates, ivionPoiId, fmGuid }` till parent
- Stänger dialog, flödet fortsätter i wizard

### 2. Uppdatera `PositionPickerStep.tsx`
**Fil:** `src/components/inventory/mobile/PositionPickerStep.tsx`

- Byt "Starta inventering i 360°" (som navigerar bort) mot inline `Ivion360PositionPicker` dialog
- Ta bort "Öppna 360° i ny flik"-knappen
- Hantera 3D-knapp: om ingen modell finns i databasen för byggnaden, visa disabled knapp med text "Ingen 3D-modell tillgänglig" istället för att öppna tom dialog

### 3. Utöka `WizardFormData`
**Fil:** `src/components/inventory/mobile/MobileInventoryWizard.tsx`

- Lägg till `ivionPoiId?: number` i `WizardFormData`

### 4. Spara `ivion_poi_id` vid registrering
**Fil:** `src/components/inventory/mobile/QuickRegistrationStep.tsx`

- Vid insert: inkludera `ivion_poi_id: formData.ivionPoiId ?? null` och `ivion_site_id` i `assetData`
- Använd `formData.fmGuid` (från 360°-flödet) som `fm_guid` om det finns, annars generera nytt

### 5. Utöka `ivion-poi` edge function
**Fil:** `supabase/functions/ivion-poi/index.ts`

- Säkerställ att `create-poi` action accepterar `formData`-kontext (namn, kategori, AI-properties) och inkluderar dem i POI:ens `titles`, `descriptions` och `customData.fm_guid`
- Redan fungerande `createPoi()`-funktion — behöver bara korrekt routing i request handler

## Filer att skapa
1. `src/components/inventory/mobile/Ivion360PositionPicker.tsx`

## Filer att ändra
1. `src/components/inventory/mobile/PositionPickerStep.tsx`
2. `src/components/inventory/mobile/MobileInventoryWizard.tsx`
3. `src/components/inventory/mobile/QuickRegistrationStep.tsx`
4. `supabase/functions/ivion-poi/index.ts` (mindre justering)

