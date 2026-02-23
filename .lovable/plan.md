

## Tillagg: Responsiv mobilverktygsfalt i 3D

### Problem

Verktygsfaltets knappar (`h-9 w-9` = 36px) plus 4 separatorer gor att det blir bredare an mobilskarmen. Oselekterade knappar syns daligt — de ar `ghost`-varianten utan tydlig farg pa mork bakgrund.

### Losning

**A. Mindre knappar pa mobil**

I `ToolButton`-komponenten: anvand `h-7 w-7` pa mobil istallet for `h-9 w-9`:
```text
className: 'h-7 w-7 sm:h-9 sm:w-9'
```

Ikoner i render-sektionen andras fran `h-4 w-4` till `h-3.5 w-3.5 sm:h-4 sm:w-4`.

Toolbarens container far ocksa tatare padding pa mobil:
```text
'gap-0 px-1 py-1 sm:gap-0.5 sm:px-2 sm:py-1.5'
```

Separatorerna gors kortare pa mobil:
```text
'h-4 sm:h-6 mx-0.5 sm:mx-1'
```

**B. Tydligare kontrast — vita ikoner**

Oselekterade knappar far `text-white/90` (inte `text-white` som kan blandas med aktiv). Aktiva knappar behallar `text-primary` (lila) men far ocksa en tydligare bakgrund:

```text
Ej aktiv:  'text-white/90 hover:text-white hover:bg-white/10'
Aktiv:     'ring-2 ring-primary bg-white/15 text-primary'
```

Detta ger tydlig visuell skillnad: vita ikoner i normalst, lila med ljusare bakgrund nar aktiv.

### Teknisk detaljplan

**Fil: `src/components/viewer/ViewerToolbar.tsx`**

1. `ToolButton` (rad 74-78) — andra className:
   - `compact ? 'h-8 w-8' : 'h-7 w-7 sm:h-9 sm:w-9'`
   - `'text-white/90 hover:text-white hover:bg-white/10'`
   - Active: `'ring-2 ring-primary bg-white/15 text-primary'`

2. Toolbar-container (rad 593-596) — andra gap/padding:
   - `'flex items-center gap-0 px-1 py-1 sm:gap-0.5 sm:px-2 sm:py-1.5 rounded-xl'`

3. Alla `Separator` (rad 617, 639, 676, 687) — responsiv hojd:
   - `'h-4 sm:h-6 mx-0.5 sm:mx-1 bg-white/20'`

4. Alla ikon-storlekar i render-sektionen (rad 601-696) — responsiva ikoner:
   - `className="h-3.5 w-3.5 sm:h-4 sm:w-4"` pa alla `<Icon>`-komponenter

Dessa andringar gor verktygsfalt kompakt pa mobil (ca 280px brett istallet for 400px+) och ger tydlig kontrast mellan aktiva (lila) och inaktiva (vita) verktyg.

