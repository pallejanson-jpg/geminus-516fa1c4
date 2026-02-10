

# Modern mobil layout for Felanmalan

## Vad vi gor

Bygger om `MobileFaultReport.tsx` till en modern, fullskarms mobil-layout med bakgrundsbild (samma `chicago-skyline-hero.jpg` som anvands pa startsidan). Formularet far ett modernt utseende med glasmorfism-effekt (frostat glas-kort), rundade inputfalt, och en sticky submit-knapp langst ner.

## Design

- **Bakgrund**: Fullskarms bakgrundsbild (`chicago-skyline-hero.jpg`) med mork overlay-gradient for lasbarhet
- **Header**: Transparent header med vit text och tillbaka-knapp, overlappar bakgrunden
- **Installationsinfo**: Kompakt badge/chip langst upp i kortet
- **Formularkort**: Frostat glas-effekt (`bg-white/90 backdrop-blur-xl`) med rundade horn, scrollbart
- **Inputfalt**: Rundade (`rounded-xl`), latt bakgrund, stora touch-targets
- **Submit-knapp**: Fast langst ner (sticky), gradient-fargad, med safe-area-inset for iOS
- **Fotoknapp**: Stor, rund ikon-knapp for kamera

## Filer att andra

| Fil | Andring |
|---|---|
| `src/components/fault-report/MobileFaultReport.tsx` | Fullstandig omdesign av layouten med bakgrundsbild, glasmorfism-kort, modern typografi och sticky submit |
| `src/pages/FaultReport.tsx` | Ta bort yttre `bg-background`-wrapper pa mobil (lat MobileFaultReport styra hela skermen) |

## Tekniska detaljer

**MobileFaultReport.tsx:**
- Importera `chicagoHero` fran `@/assets/chicago-skyline-hero.jpg`
- Yttre container: `min-h-[100dvh]` med bakgrundsbild via inline style (`backgroundImage`, `backgroundSize: cover`, `backgroundPosition: center`)
- Gradient overlay: `bg-gradient-to-b from-black/40 via-black/20 to-black/60`
- Header: Absolut positionerad ovanpa bilden med vit text, ArrowLeft-knapp i vitt
- Formular-kort: `bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl rounded-t-3xl` som overlappar bilden
- Inputfalt: Okar storlek med `h-12 rounded-xl` for touch-vanlig interaktion
- Textarea: `rounded-xl` med lite storre padding
- Submit-knapp: `sticky bottom-0` med `pb-[env(safe-area-inset-bottom)]` for iOS
- Fotogalleri: Storre previews med rundade horn

**FaultReport.tsx:**
- Mobil-wrappern andras fran `<div className="h-screen bg-background">` till bara `<MobileFaultReport ... />` (komponenten hanterar sin egen bakgrund)

