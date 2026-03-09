/**
 * Browser-compatible shim for Node.js `node:util` module.
 * Used by @xeokit/xeokit-convert which references TextEncoder/TextDecoder from node:util.
 */
export const TextEncoder = globalThis.TextEncoder;
export const TextDecoder = globalThis.TextDecoder;
export default { TextEncoder, TextDecoder };
