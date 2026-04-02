/**
 * Geminus z-index scale — single source of truth.
 *
 * Layer cake (low → high):
 *   Content  →  NavCube  →  Header/Sidebar  →  Overlay  →  Modal  →  Floating buttons  →  Dialog/Sheet  →  Toast
 *
 * Usage:  className={`z-[${Z_HEADER}]`}   or   style={{ zIndex: Z_HEADER }}
 */

export const Z_NAVCUBE = 15;
export const Z_HEADER = 30;
export const Z_SIDEBAR = 40;
export const Z_HAMBURGER = 50;
export const Z_OVERLAY = 50;
export const Z_MODAL = 60;
export const Z_FLOATING_BUTTONS = 70;
export const Z_PROPERTIES_DIALOG = 80;
export const Z_TOAST = 90;
