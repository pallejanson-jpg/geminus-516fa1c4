

## Analys: Dölja enskild OSM-byggnad vid BIM-placering

### Nuläge
Idag används `Cesium.createOsmBuildingsAsync()` som laddar OSM 3D Buildings som ett **Cesium3DTileset**. Den nuvarande 3D-toggeln (`show3dBuildings`) släcker/tänder **alla** OSM-byggnader på en gång — det finns ingen per-byggnads-filtrering.

### Svar på frågan
**Ja, det går att dölja enskilda byggnader.** Cesium 3D Tiles stöder "style-baserad" filtrering där man kan dölja specifika features baserat på deras egenskaper. OSM Buildings-tilesetet har egenskaper som `cesium#estimatedHeight`, `cesium#longitude`, `cesium#latitude` m.fl.

### Tillvägagångssätt

**Steg 1 — Spatial hide via `Cesium3DTileStyle`**

När en BIM-modell placeras, applicera en style-condition på OSM-tilesetet som döljer alla features inom en radie runt byggnadens koordinat:

```javascript
osmTileset.style = new Cesium.Cesium3DTileStyle({
  show: {
    conditions: [
      // Dölj byggnader inom ~50m radie från BIM-positionen
      [`\${feature['cesium#longitude']} > ${lng - delta} && \${feature['cesium#longitude']} < ${lng + delta} && \${feature['cesium#latitude']} > ${lat - delta} && \${feature['cesium#latitude']} < ${lat + delta}`, 'false'],
      ['true', 'true']
    ]
  }
});
```

**Steg 2 — Automatisk koppling till `handleShowBim`**

När BIM-modellen laddas i `handleShowBim`:
1. Beräkna en bounding-box runt byggnaden (baserat på `facility.area` eller en fast radie ~40-80m)
2. Applicera style-condition som döljer OSM-features i den zonen
3. När BIM-modellen tas bort → återställ style till `show: true` för alla

**Steg 3 — Valfri förbättring: building footprint**

Om `building_settings` har area-data kan vi uppskatta en mer exakt bounding box. Alternativt kan vi i framtiden lagra byggnadens footprint-polygon för precis maskning.

### Begränsning
OSM-data har inte alltid exakta `osmId`-attribut exponerade i Cesium Ion-tilesetet, så vi kan inte garantera att vi döljer *exakt* rätt byggnad — men en spatial radie-approach fungerar bra i praktiken och kan finjusteras per byggnad.

### Implementation
- **1 fil ändras**: `CesiumGlobeView.tsx`
- **Inom `handleShowBim`**: lägg till style-condition vid BIM-laddning, rensa vid BIM-borttagning
- **Ny hjälpfunktion**: `hideOsmBuildingsNear(tileset, lat, lng, radiusMeters)` + `resetOsmStyle(tileset)`

