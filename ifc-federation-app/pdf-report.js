/**
 * pdf-report.js
 *
 * A4 PDF companion to the BCF export in server.js's /api/validate-ids/export
 * -- same underlying IDS validation results (session.idsResults), rendered
 * as a readable document instead of a machine-openable BCF bundle. BCF is
 * for "open this in your BIM tool and jump to the object"; this PDF is for
 * "read/print/attach this to an email".
 *
 * Uses `pdfkit` (pure JS, no native dependencies) -- consistent with this
 * app's preference for zero-native-dependency Node code wherever possible
 * (the one deliberate exception being ids-validator.js's Python subprocess).
 *
 * Layout note: every row that needs a check/cross mark next to text
 * captures `doc.y` ONCE into a local variable and passes that same value
 * explicitly to both the mark-drawing helper and the text call. Mixing
 * `doc.moveDown()`-based flow with manually-offset y coordinates (e.g.
 * `doc.y - 12`) caused real, confirmed overlapping text in an earlier
 * version of this file -- verified by rendering and visually inspecting
 * the actual PDF output, not assumed.
 */

import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, 'assets', 'geminus-logo.png');

const GREEN = '#17805F';
const RED = '#B3261E';
const NAVY = '#203B35';
const MUTED = '#666660';

const LEFT = 50;
const RIGHT = 545; // A4 width 595pt - 50pt margin
const CONTENT_WIDTH = RIGHT - LEFT;
// A4 is 841.89pt tall; with a 50pt margin the printable area ends at
// ~791.89pt. Anything drawn past that — even via an explicit y coordinate
// on an already-selected page — makes pdfkit silently auto-paginate,
// confirmed in practice: an earlier version placed the footer at y=810 and
// got a spurious, entirely blank second page as a result.
const PAGE_BOTTOM = 760;
const FOOTER_Y = 775;

/**
 * @param {Record<string, Array<{ ruleId, ruleTitle, report, error? }>>} idsResults
 *   Same shape produced by /api/validate-ids -- modelName -> per-rule results.
 * @returns {Promise<Buffer>}
 */
async function generateIdsReportPdf(idsResults) {
  const doc = new PDFDocument({ size: 'A4', margin: LEFT, bufferPages: true });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  let logoBuffer = null;
  try {
    logoBuffer = await readFile(LOGO_PATH);
  } catch {
    // Logo is cosmetic -- report still has value without it.
  }

  const textStartX = logoBuffer ? LEFT + 46 : LEFT;

  // ── Header ──────────────────────────────────────────────────────────────
  if (logoBuffer) doc.image(logoBuffer, LEFT, 45, { width: 36 });
  doc.fontSize(20).fillColor(NAVY).font('Helvetica-Bold').text('Geminus IDS validation-report', textStartX, 50);
  doc.fontSize(9).fillColor(MUTED).font('Helvetica')
    .text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`, textStartX, 76);

  doc.y = 115;
  doc.x = LEFT;

  // ── Overall summary ─────────────────────────────────────────────────────
  let totalSpecs = 0, totalPass = 0;
  for (const results of Object.values(idsResults)) {
    for (const { report } of results) {
      if (!report) continue;
      for (const spec of report.specifications) {
        totalSpecs++;
        if (spec.status) totalPass++;
      }
    }
  }
  row(doc, LEFT, () => {
    doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text(`Summary: ${totalPass} of ${totalSpecs} checks passed`, LEFT, doc.y, { width: CONTENT_WIDTH });
  });
  doc.moveDown(0.8);

  // ── Per model, per rule, per specification ─────────────────────────────
  for (const [modelName, results] of Object.entries(idsResults)) {
    ensureSpace(doc, 40);
    row(doc, LEFT, () => {
      doc.fontSize(14).fillColor(NAVY).font('Helvetica-Bold').text(`Model: ${modelName}`, LEFT, doc.y, { width: CONTENT_WIDTH });
    });
    doc.moveDown(0.4);

    for (const { ruleTitle, report, error } of results) {
      ensureSpace(doc, 30);
      row(doc, LEFT, () => {
        doc.fontSize(11).fillColor(NAVY).font('Helvetica-Bold').text(ruleTitle, LEFT, doc.y, { width: CONTENT_WIDTH });
      });

      if (error) {
        ensureSpace(doc, 20);
        row(doc, LEFT, () => {
          doc.fontSize(9).fillColor(RED).font('Helvetica').text(`Could not run this check: ${error.split('\n')[0]}`, LEFT, doc.y, { width: CONTENT_WIDTH });
        });
        doc.moveDown(0.6);
        continue;
      }

      for (const spec of report.specifications) {
        ensureSpace(doc, 30);
        markedLine(doc, LEFT, spec.status, () => {
          doc.fontSize(10).fillColor(spec.status ? GREEN : RED).font('Helvetica-Bold')
            .text(spec.name, LEFT + 16, doc.y, { width: CONTENT_WIDTH - 16 });
        });
        row(doc, LEFT + 16, () => {
          doc.fontSize(8.5).fillColor(MUTED).font('Helvetica')
            .text(`${spec.total_applicable_pass} of ${spec.total_applicable} applicable objects pass`, LEFT + 16, doc.y, { width: CONTENT_WIDTH - 16 });
        });
        doc.moveDown(0.2);

        for (const requirement of spec.requirements ?? []) {
          if (requirement.description) {
            ensureSpace(doc, 16);
            row(doc, LEFT + 16, () => {
              doc.fontSize(8.5).fillColor(MUTED).font('Helvetica-Oblique')
                .text(requirement.description, LEFT + 16, doc.y, { width: CONTENT_WIDTH - 16 });
            });
          }
          for (const failed of requirement.failed_entities ?? []) {
            ensureSpace(doc, 24);
            markedLine(doc, LEFT + 16, false, () => {
              doc.fontSize(8.5).fillColor(NAVY).font('Helvetica')
                .text(`${failed.class} "${failed.name ?? '(unnamed)'}" - ${failed.global_id}`, LEFT + 32, doc.y, { width: CONTENT_WIDTH - 32 });
            });
            if (failed.reason) {
              row(doc, LEFT + 32, () => {
                doc.fontSize(8).fillColor(MUTED).font('Helvetica-Oblique').text(failed.reason, LEFT + 32, doc.y, { width: CONTENT_WIDTH - 32 });
              });
            }
          }
        }
        doc.moveDown(0.5);
      }
    }
    doc.moveDown(0.6);
  }

  // ── Footer page numbers ──────────────────────────────────────────────────
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor(MUTED)
      .text(`Geminus IDS validation-report - page ${i + 1} of ${pageCount}`, LEFT, FOOTER_Y, { align: 'center', width: CONTENT_WIDTH, lineBreak: false });
  }

  doc.end();
  return done;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > PAGE_BOTTOM) doc.addPage();
}

/** Run `draw` with doc.x/doc.y reset to a known (x, current y) so text calls inside it don't drift. */
function row(doc, x, draw) {
  doc.x = x;
  draw();
}

/**
 * One line consisting of a check/cross mark followed by text drawn by
 * `drawText` — both positioned from the SAME captured y, so they can never
 * drift apart regardless of what drawText's font size/leading is.
 */
function markedLine(doc, x, passed, drawText) {
  const y = doc.y;
  drawStatusMark(doc, passed, x, y);
  doc.x = x;
  doc.y = y;
  drawText();
}

/** Draw a small green check or red cross. (x, y) is the top-left of a ~12x12 box. */
function drawStatusMark(doc, passed, x, y) {
  const cx = x + 5;
  const cy = y + 5;
  doc.save();
  doc.lineWidth(1.4).strokeColor(passed ? GREEN : RED);
  if (passed) {
    doc.moveTo(cx - 4, cy).lineTo(cx - 1, cy + 3).lineTo(cx + 4, cy - 4).stroke();
  } else {
    doc.moveTo(cx - 4, cy - 4).lineTo(cx + 4, cy + 4).moveTo(cx + 4, cy - 4).lineTo(cx - 4, cy + 4).stroke();
  }
  doc.restore();
}

export { generateIdsReportPdf };
