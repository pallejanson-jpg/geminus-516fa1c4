

# Plan: Three Items

## 1. ParticleBackground not visible

The `ParticleBackground` canvas uses `absolute inset-0` positioning, but the parent `div` at line 166 uses `relative min-h-full` — which means the parent has no explicit height until content renders. The canvas likely renders with 0 height initially. 

**Fix:** Add `min-h-screen` to the parent wrapper so the absolute-positioned canvas has a height to fill. Also ensure the canvas has `z-0` so it sits behind the overlay and content.

**File:** `src/components/home/HomeLanding.tsx` — line 166, change to `min-h-screen`.

---

## 2. Rename "Gunnar" → "Geminus AI"

This is a broad rename across the codebase. All user-visible labels change; internal variable names and the database table (`gunnar_conversations`) stay as-is to avoid breaking changes.

**Files with user-facing "Gunnar" text to update:**

| File | What changes |
|------|-------------|
| `src/components/home/HomeLanding.tsx` | Assistant title "Gunnar" → "Geminus AI" |
| `src/components/chat/GunnarButton.tsx` | Tooltip "Fråga Gunnar", panel header "Gunnar AI", minimized bubble "Gunnar" |
| `src/components/chat/GunnarChat.tsx` | Greeting text, system prompt references |
| `src/components/viewer/GeminusPluginMenu.tsx` | Menu label "Fråga Gunnar" → "Fråga Geminus AI", panel header |
| `src/components/settings/GunnarSettings.tsx` | Label "Show Gunnar button" → "Show Geminus AI button" |
| `src/components/settings/KnowledgeBaseSettings.tsx` | Description text |
| `src/components/settings/ApiSettingsModal.tsx` | Accordion label |
| `src/components/layout/AppLayout.tsx` | Comment only |
| `src/pages/Presentation.tsx` | Label "AI Assistants (Gunnar)" |
| `supabase/functions/gunnar-chat/index.ts` | System prompt persona name |

File names (`GunnarChat.tsx`, `GunnarButton.tsx`, `GunnarSettings.tsx`) and the edge function folder (`gunnar-chat`) keep their current names to minimize refactoring risk. The database table `gunnar_conversations` stays unchanged.

---

## 3. RealEstateCore — what does it actually mean?

This is a research/explanation question, not an implementation task:

Adopting RealEstateCore (REC) goes beyond just renaming properties. Here is what it involves:

**A. Property/type mapping (the naming part)**
- Asset categories and types get mapped to REC classes (e.g. "Rum" → `rec:Room`, "Brandslackare" → `rec:FireExtinguisher`). This is the most visible change — a mapping layer translates Geminus internal names to REC URIs.

**B. Ontology structure**
- REC uses a class hierarchy (Building → BuildingComponent → Space → Room). Geminus already has a similar tree but the relationships need formal `@type` annotations in exports.

**C. Data export format**
- REC mandates **JSON-LD** (linked data) format for interoperability. A new export function would produce standard JSON-LD documents with `@context` pointing to the REC ontology.

**D. IoT/Point modeling**
- Senslinc sensor data would be typed using REC's `Point` hierarchy (e.g. `rec:TemperatureSensor`, `rec:CO2Sensor`). This enables ProptechOS and other platforms to understand the sensor data.

**E. Relationship semantics**
- REC defines relationships like `isPartOf`, `hasSpace`, `servedBy`. Currently Geminus uses parent-child in the tree; REC compliance means these relationships get formal predicates.

**What does NOT change:** The database schema, the UI workflows, or how users interact with Geminus day-to-day. REC compliance is primarily about how data is **classified, exported, and described** to external systems.

---

## Summary of code changes

1. **Fix ParticleBackground visibility** — 1 line in `HomeLanding.tsx`
2. **Rename Gunnar → Geminus AI** — ~10 files, user-facing strings only
3. **REC question** — no code changes, answered above

