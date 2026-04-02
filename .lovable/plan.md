

# Fix API Profiles Form — Focus Loss and Scroll Issues

## Two bugs identified

### Bug 1: Input loses focus after one keystroke
**Root cause**: `SecretInput` is defined as a **nested component inside** `ApiProfilesManager`. Every keystroke updates `form` state, which re-renders the parent. React sees `SecretInput` as a *new* component on each render (different function reference), so it unmounts and remounts the input — destroying focus.

**Fix**: Extract `SecretInput` out of `ApiProfilesManager` as a standalone component at module level. It needs `form`, `set`, `showSecrets`, and `toggleSecret` passed as props.

### Bug 2: Unnecessary scrollbars
The form content is constrained by the dialog/tab container. The accordion sections create vertical overflow and the inputs are narrow causing horizontal overflow.

**Fix**: Ensure the editing form uses `overflow-y-auto` properly and the inputs/accordion take full width without horizontal overflow.

## Changes — single file

**`src/components/settings/ApiProfilesManager.tsx`**:

1. Move `SecretInput` outside the component as a module-level `React.FC` that receives `value`, `onChange`, `isSecret`, `shown`, `onToggleSecret`, `label`, `placeholder` as props
2. Remove the nested function definition from inside `ApiProfilesManager`
3. Update all `<SecretInput>` usages to pass the required props explicitly
4. Add `overflow-hidden` to the editing form container to prevent horizontal scroll

