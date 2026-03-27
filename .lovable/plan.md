

## Plan: Add Geminus AI icon to Viewer toolbar

### Overview
Add a "Geminus AI" tool button to the ViewerToolbar that opens a floating GunnarChat panel directly in the viewer, without leaving the 3D canvas.

### Steps

1. **Add `geminus-ai` tool to `ALL_TOOLS` array** in `ViewerToolbar.tsx`
   - New entry: `{ id: 'geminiAi', label: 'Geminus AI', icon: <Bot />, group: 'extra' }`
   - Add `'geminiAi'` to `DEFAULT_ENABLED` so it shows by default

2. **Add state and handler in `ViewerToolbar`**
   - Add `isGunnarOpen` state
   - When the `geminiAi` tool button is clicked, toggle `isGunnarOpen`
   - Build a `GunnarContext` from viewer state (building, floor, room from existing toolbar state)

3. **Render floating GunnarChat panel**
   - When `isGunnarOpen` is true, render `GunnarChat` in a floating panel (similar to the pattern in `GeminusPluginMenu.tsx`)
   - Position: bottom-right of the viewer, above the toolbar
   - Include close button in header
   - Use `embedded` mode for GunnarChat

4. **Import additions**
   - Import `Bot` from lucide-react
   - Import `GunnarChat` from `@/components/chat/GunnarChat`

### Technical details
- The toolbar already has a pattern for toggle-state tools (xray, crosshair) — follow the same pattern
- The floating panel will use the same styling as in `GeminusPluginMenu.tsx` (backdrop-blur, border, shadow)
- Context will be derived from the toolbar's existing `viewer` prop and window events for selected building/floor

