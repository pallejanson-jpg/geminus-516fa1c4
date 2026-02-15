

## Fix: X-ray ghosting och Insights-infargning

### Rotorsak

Tva problem beror pa samma grundorsak: **opacity-baserad ghosting ger inte xray-effekt, och nar xray anvands overskriver det farger**.

**Rumsvisualisering**: Farger fungerar (via `entity.colorize` + `entity.opacity`), men INGEN xray-effekt pa bakgrundsobjekt -- byggnaden ser bara matt ut, inte genomskinlig som i xeokits bild.

**Manuell X-ray**: Satter `entity.xrayed = true` pa allt utom fargade rum -- men Asset+-bibliotekets interna `xrayMaterial` ar fortfarande for ogenomskinligt, sa effekten ar darlig.

**Insights-farglaggning**: Anvander `entity.opacity = 0.1` (ingen xray) och satter `entity.colorize = rgb`. Rummen syns men i bla (standardfarg for IfcSpace) istallet for diagramfarger -- troligen for att Asset+-viewern aterstaller `colorize` internt nar `opacity` andras, eller fargerna appliceras i fel ordning.

### Losning: Kombinerad strategi

Anvand **riktig xray** (fran issue #175) for bakgrundsobjekt, och satt `entity.xrayed = false` pa fargade objekt sa de renderas som solida objekt FRAMFOR den genomskinliga xray-geometrin. Detta ar exakt det som xeokit-utvecklaren rekommenderar.

Nyckelinsikt: `entity.colorize` fungerar BARA pa objekt som INTE ar xray:ade. Xray:ade objekt renderas alltid med `xrayMaterial`. Sa strategin ar:
1. Xray:a ALLA objekt
2. Stang av xray pa de specifika objekt som ska fargas
3. Applicera `entity.colorize` pa de icke-xray:ade objekten

---

### Fil 1: `src/components/viewer/AssetPlusViewer.tsx`

**1a. Insights-effekten (rad 337-342) -- byt opacity till riktig xray**

Byt fran:
```
allIds.forEach(id => {
  const e = scene.objects?.[id];
  if (e) e.opacity = 0.1;
});
```

Till:
```
// Ensure xray material is transparent (issue #175)
ensureXrayConfig(scene);
// Xray ALL objects first
scene.setObjectsXRayed(allIds, true);
```

**1b. Fargade entiteter (rad 367-374, 393-399, 429-434) -- stang av xray FORE colorize**

For varje fargad entity, lagg till `entity.xrayed = false` FORE `entity.colorize`:
```
entity.xrayed = false;  // <-- Lagg till denna rad
entity.visible = true;
entity.colorize = rgb;
entity.opacity = 0.85;
```

**1c. Cleanup nar insightsColorMode avaktiveras**

I effektens cleanup/guard, aterstaell xray pa alla objekt:
```
scene.setObjectsXRayed(allIds, false);
```

---

### Fil 2: `src/components/viewer/XrayToggle.tsx`

**2a. Anvand `ensureXrayConfig` inline (redan delvis pa plats)**

Koden ar redan korrekt -- den hoppar over fargade entiteter. Men lagg till en extra saker: aterstaell ALLA objekts xray nar toggle stangs av, och aterstaell `opacity` och `colorize` som kanske andrats:

```
} else {
  scene.setObjectsXRayed(objectIds, false);
  // Restore any opacity changes from legend clicks
  objectIds.forEach(id => {
    const entity = scene.objects?.[id];
    if (entity && entity.opacity < 1.0) entity.opacity = 1.0;
  });
}
```

---

### Fil 3: `src/components/viewer/RoomVisualizationPanel.tsx`

**3a. Legend-klick (rad 530-551) -- byt opacity till xray**

Byt fran opacity-strategi till xray-strategi for legend-klick (precis som insights):

```
// Ensure xray config
ensureXrayConfig(scene);  // inline
// Xray ALL objects
scene.setObjectsXRayed(allIds, true);
// Un-xray matching rooms so their colors show
idsToSelect.forEach(id => {
  const e = scene.objects?.[id];
  if (e) e.xrayed = false;
});
```

For toggle-off:
```
scene.setObjectsXRayed(allIds, false);
// Re-apply room colors
```

---

### Sammanfattning

| Fil | Andring |
|-----|---------|
| `AssetPlusViewer.tsx` | Insights: byt `entity.opacity = 0.1` till `scene.setObjectsXRayed + ensureXrayConfig`, lagg till `entity.xrayed = false` fore colorize |
| `XrayToggle.tsx` | Smarre: aterstaell opacity vid toggle-off |
| `RoomVisualizationPanel.tsx` | Legend-klick: byt opacity till xray-strategi |

### Varfor det fungerar

Xeokit renderar xray:ade objekt med `xrayMaterial` (transparent ghosting). Objekt som INTE ar xray:ade renderas normalt med sin `colorize`-farg. Med `alphaDepthMask = false` renderas solida objekt FRAMFOR xray-geometrin. Sa:

- Bakgrunden: xray = genomskinlig gratt (fillAlpha 0.1)
- Fargade rum: xray AV, colorize = diagramfarg, opacity 0.85 -- renderas som solida fargade ytor framfor den ghostade byggnaden

Det ar exakt det resultat som visas i xeokits screenshot pa issue #175.
