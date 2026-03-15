

# Space Offset för Pick-prioritet — Analys & Plan

## Din idé fungerar utmärkt

xeokit har `entity.offset` — en per-entity 3D-förskjutning som redan används i kodbasen (se `useObjectMoveMode.ts` för drag-flytt av möbler). Vi kan använda exakt samma mekanism för att sänka IfcSpace-objekt i 2D-läge.

### Hur det fungerar tekniskt

I 2D-läge (ortografisk kamera, topp-ner):
- Raycasting träffar det objekt som är **närmast kameran** (högst Y-värde efter klipplan)
- Om vi sätter `entity.offset = [0, -0.3, 0]` på alla IfcSpace → deras övre yta hamnar ~30cm under möbler/utrustning
- Klick på tom golvyta → träffar det sänkta rumsobjektet ✓
- Klick på stol/kylskåp/diskbänk → träffar möbeln (den sticker upp) ✓
- Ingen toggle behövs — det "bara fungerar"

### Vad som behöver byggas

**En enda plats**: I `ViewerToolbar.tsx` där 2D-läget aktiveras (runt rad 745–790), efter att IfcSpace sätts till `visible = true` och `pickable = true`:

```
// Sänk alla IfcSpace-objekt så möbler vinner pick-prioritet
Object.values(metaObjects).forEach(mo => {
  if (mo.type?.toLowerCase() === 'ifcspace') {
    const entity = viewer.scene.objects?.[mo.id];
    if (entity) entity.offset = [0, -0.3, 0];
  }
});
```

Och vid byte tillbaka till 3D: återställ `entity.offset = [0, 0, 0]` (eller det sparade originalet från `useObjectMoveMode`).

**Konflikt med useObjectMoveMode**: Objekt som användaren har dragit har redan ett offset sparat i DB. Lösningen: vid 2D-aktivering, kombinera befintligt offset med space-sänkningen (`originalOffset[1] - 0.3`). Vid 3D-återgång, återställ till original.

### Fördelar
- Ingen ny UI-toggle behövs
- Användaren behöver aldrig tänka på "Show spaces on/off"
- Samma beteende i ren 2D och i split 2D/3D (2D-panelen)
- ~15 rader kod totalt

### Fil att ändra
| Fil | Ändring |
|-----|---------|
| `src/components/viewer/ViewerToolbar.tsx` | Applicera Y-offset -0.3 på IfcSpace vid 2D-aktivering, återställ vid 3D |

