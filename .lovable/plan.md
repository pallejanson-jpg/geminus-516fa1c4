

## Varför A-1 inte syns i Portfolio/Navigator

### Orsak

Jobben för A-1 (ARK.ifc och RIV.ifc) har status **pending** — workern har inte nått dem ännu. Hierarkin (Plan/Rum/Objekt) skapas först av workern via `populate-hierarchy`-anropet **efter** att konverteringen är klar (steg 6 i `processIfcJob`). Det finns 10+ jobb före A-1 i kön.

Det finns **ingen snabbväg** i nuvarande kod: vid IFC-uppladdning via UI:t skapas bara ett conversion_job — ingen hierarki-population görs direkt.

### Plan: Populera hierarkin direkt vid IFC-uppladdning

Lägg till ett omedelbart anrop till `ifc-extract-systems` (edge function, enrich-guids-läge) direkt efter att IFC-filen laddats upp i `CreateBuildingPanel.tsx`. Det ger våningsplan och rum i `assets`-tabellen **innan** workern ens börjat, så att byggnaden syns i Portfolio och Navigator direkt.

#### Ändringar

**`src/components/settings/CreateBuildingPanel.tsx`** — i `handleIfcUpload`, efter att filen laddats upp och conversion_job skapats:

```typescript
// Trigger immediate hierarchy population via edge function
try {
  await supabase.functions.invoke('ifc-extract-systems', {
    body: {
      buildingFmGuid: selectedBuildingFmGuid,
      ifcPath: storagePath,
      mode: 'enrich-guids'
    }
  });
} catch (e) {
  console.warn('Immediate hierarchy population failed (non-fatal):', e);
}
```

Detta anrop:
1. Parsear IFC-filen i edge-funktionen (redan implementerad)
2. Extraherar våningsplan, rum och instanser
3. Skapar deterministiska FMGUIDs (UUID v5)
4. Upserterar hierarkin i `assets`-tabellen

Workern kör sedan sin konvertering separat och uppdaterar XKT-tiles + eventuell ytterligare data.

#### Fördel

- Byggnaden syns **omedelbart** i Navigator och Portfolio efter uppladdning
- Workern hanterar fortfarande XKT-konvertering i bakgrunden
- Ingen ny edge function behövs — `ifc-extract-systems` finns redan

