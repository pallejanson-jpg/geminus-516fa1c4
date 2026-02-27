

# Plan: Settings Restructure & FastNav Toggle in Viewer Tab

## Changes

### 1. Move FastNav toggle to Viewer tab in ApiSettingsModal
Add a third accordion item "Performance" under the Viewer tab (alongside Themes and Room Labels) containing the FastNav blur toggle. Remove the "3D Viewer-prestanda" section from VoiceSettings.

### 2. Merge Voice & Gunnar tabs into "AI Assistants" tab
- Remove the separate "Röst" and "Gunnar" tabs from ApiSettingsModal
- Rename "Gunnar" tab to "AI Assistants" with Bot icon
- Content: Accordion with 3 collapsed sections — Gunnar, Ilean, Voice
- Import IleanSettings from ProfileModal pattern

### 3. Wrap Sync tab content in Accordions (collapsed by default)
Convert the Sync tab's flat sections into collapsible Accordion items (all collapsed by default):
- Asset+ Sync (Structure, Assets, XKT cards)
- FM Access
- Senslinc
- Ivion
- Congeria Documents

### 4. Translate all Swedish text in ApiSettingsModal to English
All labels, descriptions, toasts, and button text in the settings modal will be translated to English, matching the app's UI standardization policy.

### Files to modify
- `src/components/settings/ApiSettingsModal.tsx` — All structural changes (tabs, accordions, translations, FastNav in Viewer)
- `src/components/settings/VoiceSettings.tsx` — Remove the "3D Viewer-prestanda" accordion section, translate remaining Swedish text to English
- `src/components/settings/GunnarSettings.tsx` — Translate Swedish text to English
- `src/components/settings/IleanSettings.tsx` — Translate Swedish text to English

### Implementation details
- Viewer tab accordion `defaultValue` changes from `['themes', 'labels']` to `[]` (all collapsed)
- New accordion item `performance` with Eye icon, containing FastNav toggle
- Sync tab wraps each section in `AccordionItem` with no `defaultValue` (collapsed)
- AI Assistants tab: single Accordion with items for gunnar, ilean, voice — all collapsed by default

