# Plan: VisualizationToolbar struktur

## Status: ✅ Implementerad

Reorganiserade VisualizationToolbar enligt önskad struktur:
1. ✅ "Visa"-sektion först med 2D/3D, Visa rum, Visa annotationer, Rumsvisualisering
2. ✅ "Viewer settings" (kollapsbar) med Viewer-tema, Bakgrundsfärg, Belysning & Solstudie
3. ✅ "Åtgärder"-sektion sist
4. ✅ Borttagen Arkitektvy-switch (funktionaliteten finns i Viewer-tema dropdown)

## Slutlig struktur

```text
VisualizationToolbar
├── BIM-modeller (submeny)
├── Våningsplan (submeny)  
├── Klipphöjd (endast i 2D)
├── Separator
├── "Visa"-sektion
│   ├── 2D/3D (switch)
│   ├── Visa rum (switch)
│   ├── Visa annotationer (switch)
│   └── Rumsvisualisering (switch)
├── Separator
├── "Viewer settings" (kollapsbar, stängd som standard)
│   ├── Viewer-tema (dropdown)
│   ├── Bakgrundsfärg (färgpalett)
│   └── Belysning & Solstudie (LightingControlsPanel)
├── Separator
└── "Åtgärder"-sektion
    ├── Skapa vy
    └── Registrera tillgång
```
