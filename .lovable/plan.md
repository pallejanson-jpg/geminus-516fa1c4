

# Save Plan & Execution Order

## What I will do now

Save the two pending plans to `.lovable/plan.md` as named sections so you can reference them:

1. **"Mobile Viewer Startup Hardening"** — the plan you want to run first (touch tuning, deferred SplitPlanView mount, retry improvements, viewFit suppress, debounced floor events)
2. **"SplitPlanView Navigation + Alignment UX"** — the plan to run after (fix 2D→3D click navigation, improve 3D/360° alignment accuracy)

## Plan name to start in 20 minutes

**"SplitPlanView Navigation + Alignment UX"**

## What runs now (when you approve)

**"Mobile Viewer Startup Hardening"** — covers:

| Fix | File |
|-----|------|
| Mobile touch tuning (dragRotationRate 30→70, touchPanRate 0.06→0.14, etc.) | `NativeXeokitViewer.tsx` |
| Defer SplitPlanView mount until viewerReady | `UnifiedViewer.tsx` |
| Increase SplitPlanView retry to 30×200ms + instant retry on VIEWER_MODELS_LOADED | `SplitPlanView.tsx` |
| Suppress viewFit in split2d3d mode | `NativeXeokitViewer.tsx` |
| Debounce FLOOR_SELECTION_CHANGED (500ms guard) | `UnifiedViewer.tsx` |
| Document unified startup architecture | `.lovable/plan.md` |

I will save both plans to `.lovable/plan.md` and then immediately implement the "Mobile Viewer Startup Hardening" plan.

