/**
 * xkt-convert-worker.js
 *
 * Runs one IFC->XKT conversion in a separate worker thread. Necessary
 * because @xeokit/xeokit-convert's actual parsing/tessellation work is
 * synchronous CPU-bound JS -- confirmed by direct testing that running it
 * inline in the main server process blocked the event loop for the entire
 * ~18s conversion, making even a simple job-status poll unresponsive
 * during that window. A worker thread keeps the main process (and every
 * other concurrent request) responsive while conversion runs.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { convertIfcToXkt } from './xkt-converter.js';

const { ifcText } = workerData;

try {
  const buffer = await convertIfcToXkt(ifcText, (msg) => {
    parentPort.postMessage({ type: 'progress', message: msg });
  });
  parentPort.postMessage({ type: 'done', buffer }, [buffer.buffer]);
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message });
}
