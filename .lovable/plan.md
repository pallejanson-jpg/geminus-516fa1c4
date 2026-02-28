

# Plan: Native XEO överallt + Automatiska detekteringsmallar

## Ändringar

### 1. Byt PositionPickerDialog till Native Xeokit
**Fil:** `src/components/inventory/PositionPickerDialog.tsx`
- Ersätt `AssetPlusViewer` med `NativeXeokitViewer` med `onViewerReady` callback
- Implementera pick-logik: long-press (500ms) → `scene.pick({canvasPos, pickSurface: true})` → visa bekräftelsedialog
- Instruktionsbanner i övre vänstra hörnet (inte mitt på skärmen)
- Bekräftelsedialog på svenska: "Bekräfta" / "Välj om"
- Vid bekräftelse: anropa `onPositionPicked(coords)` och stäng

### 2. Byt Inline3dPositionPicker till Native Xeokit
**Fil:** `src/components/inventory/Inline3dPositionPicker.tsx`
- Samma byte: ersätt `AssetPlusViewer` med `NativeXeokitViewer` + pick-logik
- Behåll befintlig toolbar och instruktionsrad

### 3. Byt AssetRegistration viewer till Native Xeokit
**Fil:** `src/pages/AssetRegistration.tsx`
- Ersätt lazy-laddad `AssetPlusViewer` med `NativeXeokitViewer`
- Anpassa pick-callback till samma mönster

### 4. Ta bort manuell mallväljare i PhotoScanStep
**Fil:** `src/components/inventory/mobile/PhotoScanStep.tsx`
- Ta bort hela template-selector UI (profilknappen + grid med mallar)
- Ta bort `selectedTemplateId` state
- Skicka inte `templateId` till edge function — alla mallar används automatiskt
- Lägg till "Analysera igen"-knapp som visas när bild finns + resultat/error finns

### 5. Uppdatera mobile-ai-scan att alltid använda alla mallar
**Fil:** `supabase/functions/mobile-ai-scan/index.ts`
- Ta bort `templateId`-parameter och single-template-logik
- Bygg alltid `templateContext` från ALLA aktiva mallar (redan fungerande fallback på rad 58-60)
- Om inga mallar finns: ge ändå ett AI-svar utan mallkontext (redan hanterat)

### 6. Lägg till "Analysera igen"-knapp
**Fil:** `src/components/inventory/mobile/PhotoScanStep.tsx`
- Visa knapp bredvid "Nytt foto" när bild + (resultat eller error) finns
- Knappen anropar `analyzeImage(imageBase64)` direkt

## Filer att ändra
1. `src/components/inventory/PositionPickerDialog.tsx` — Native Xeokit + pick
2. `src/components/inventory/Inline3dPositionPicker.tsx` — Native Xeokit + pick
3. `src/pages/AssetRegistration.tsx` — Native Xeokit
4. `src/components/inventory/mobile/PhotoScanStep.tsx` — Ta bort mallväljare, lägg till "Analysera igen"
5. `supabase/functions/mobile-ai-scan/index.ts` — Ta bort templateId, använd alla mallar alltid

