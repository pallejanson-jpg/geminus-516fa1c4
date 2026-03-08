

## Verifiering: IFC → Tekniska system vid efterhandsinläsning

### Nuläge
**Backend: ✅ Fungerar redan korrekt.** `ifc-to-xkt` edge-funktionen extraherar och sparar tekniska system automatiskt vid varje IFC-konvertering — oavsett om byggnaden är ny eller redan finns (synkad via ACC, Asset+, etc). Stegen:
1. `extractSystemsAndConnections()` — hittar IfcSystem, SystemName-grupper, IfcRelConnects
2. `persistSystemsAndConnections()` — sparar till `systems`, `asset_system`, `asset_connections`, `asset_external_ids`

**Frontend: Saknar bekräftelse.** Resultatet (`systemsCount`, `connectionsCount`) returneras från edge-funktionen men visas aldrig för användaren i `CreateBuildingPanel`.

### Ändringar

**`src/components/settings/CreateBuildingPanel.tsx`** — Efter lyckad konvertering (rad ~270), lägg till loggmeddelande som bekräftar systemextraktion:

```text
// After line 271 (hierarchy log)
addLog(`Systems: ${convResult.systemsCount || 0} systems, ${convResult.connectionsCount || 0} connections extracted`);
```

Detta ger användaren synlig bekräftelse att tekniska system lästes in utan att behöva en separat knapp eller UI.

### Sammanfattning
Ingen funktionell ändring behövs — systemextraktion sker redan automatiskt. Enda ändringen är att visa resultatet i konverteringsloggen.

