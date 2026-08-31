/**
 * deterministic-guid.js
 *
 * Generates FMGUIDs deterministically from an object's own IFC GlobalId
 * (IfcGuid), instead of a random UUID, whenever a new FMGUID needs to be
 * minted (missing property, or — see federation-guid-validator.js's
 * repairFederation — resolving certain duplicates).
 *
 * Why: if the same model comes back later (re-exported/redrawn from the
 * same source model) with the same IfcGuid on an object, downstream
 * systems must see the SAME FMGUID again — otherwise they treat it as a
 * brand-new object instead of recognizing the one they already track. A
 * random UUID can never guarantee that on a second, independent run; a
 * value *derived* from the IfcGuid always can, with no database, lookup
 * table, or persisted state required — which matters here specifically
 * because the standalone ifc-federation-app has no database at all
 * (in-memory sessions only, per its README).
 *
 * Implementation: UUID v5 (RFC 4122) — a SHA-1 hash of a fixed namespace
 * plus the IfcGuid, with the version/variant bits set per spec. Same
 * algorithm `uuid`-the-npm-package implements; done by hand here so this
 * stays a zero-dependency module like the rest of ifc-federation/*.js.
 *
 * CRITICAL: NAMESPACE below must never change once this has run against
 * real data. Changing it would silently change every derived FMGUID for
 * every object across every future re-upload, defeating the entire point
 * (stable identity across re-exports) without any error or warning.
 */

import { createHash } from 'node:crypto';

// Fixed, arbitrary namespace UUID for "Geminus FMGUID derived from IfcGuid".
// Generated once, must stay constant forever — see the warning above.
const NAMESPACE = 'b4e39a9a-2b7b-4f0e-9e6a-2f2b7a6f1c3d';

function uuidStringToBytes(uuid) {
  const hex = uuid.replace(/-/g, '');
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function bytesToUuidString(bytes) {
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

/**
 * Deterministically derive a UUID (v5) from `name`, namespaced so this
 * module's outputs never collide with UUIDs generated for an unrelated
 * purpose even if the same `name` string were reused elsewhere.
 */
function uuidV5(name) {
  const namespaceBytes = uuidStringToBytes(NAMESPACE);
  const hash = createHash('sha1').update(Buffer.concat([namespaceBytes, Buffer.from(name, 'utf8')])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuidString(bytes);
}

/**
 * Derive the FMGUID to assign to an object whose IFC GlobalId is `ifcGuid`.
 * Same `ifcGuid` in -> same FMGUID out, always, forever (as long as
 * NAMESPACE above never changes) — no state needed.
 */
function deriveFmGuidFromIfcGuid(ifcGuid) {
  if (!ifcGuid) throw new Error('deriveFmGuidFromIfcGuid requires a non-empty IfcGuid.');
  return uuidV5(ifcGuid);
}

export { deriveFmGuidFromIfcGuid };
