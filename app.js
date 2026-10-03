import * as pdfjs from './pdfjs.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs.worker.mjs', import.meta.url).href;
const resources = new URL('.', import.meta.url).href;
const encoder = new TextEncoder();
const magic = encoder.encode('PAPERV1\n');
const gate = document.querySelector('#gate');
const library = document.querySelector('#library');
const title = document.querySelector('#paper-title');
const gateTitle = document.querySelector('#gate-title');
const introduction = document.querySelector('#introduction');
const status = document.querySelector('#status');
const viewport = document.querySelector('#paper-viewport');
const canvas = document.querySelector('#paper-canvas');
const previous = document.querySelector('#previous-page');
const next = document.querySelector('#next-page');
const pageNumber = document.querySelector('#page-number');
const pageCount = document.querySelector('#page-count');
const zoomOut = document.querySelector('#zoom-out');
const zoomIn = document.querySelector('#zoom-in');
const zoomLabel = document.querySelector('#zoom-level');

let generation = 0;
let renderGeneration = 0;
let requests = null;
let loadingTask = null;
let documentPdf = null;
let renderTask = null;
let currentPage = 1;
let zoom = 1;
let rendering = false;

function updateControls() {
  const unavailable = !documentPdf || rendering;
  previous.disabled = unavailable || currentPage <= 1;
  next.disabled = unavailable || currentPage >= documentPdf.numPages;
  pageNumber.disabled = unavailable;
  pageNumber.value = currentPage;
  pageNumber.max = documentPdf?.numPages || 1;
  pageCount.textContent = documentPdf?.numPages || '—';
  zoomOut.disabled = unavailable || zoom <= 0.75;
  zoomIn.disabled = unavailable || zoom >= 2.5;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  viewport.setAttribute('aria-busy', String(rendering));
}

function clearDocument() {
  requests?.abort();
  requests = null;
  renderGeneration++;
  renderTask?.cancel();
  renderTask = null;
  loadingTask?.destroy().catch(() => {});
  loadingTask = null;
  documentPdf = null;
  canvas.width = 0;
  canvas.height = 0;
  canvas.removeAttribute('style');
  currentPage = 1;
  zoom = 1;
  rendering = false;
  updateControls();
}

function fail(message) {
  clearDocument();
  gate.hidden = false;
  library.hidden = true;
  gateTitle.textContent = 'Access link required';
  introduction.textContent = message;
  status.textContent = '';
  status.classList.remove('error');
}

function decodeAccess(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Invalid access link.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='), character => character.charCodeAt(0));
}

async function fetchBytes(path, signal) {
  if (!/^[a-z0-9-]+\.(enc|json)$/.test(path)) throw new Error('Invalid document location.');
  const response = await fetch(new URL(path, window.location.href), { credentials: 'omit', cache: 'no-store', signal });
  if (!response.ok) throw new Error('This document is temporarily unavailable.');
  return new Uint8Array(await response.arrayBuffer());
}

async function renderPage(number, resetScroll = true) {
  if (!documentPdf) return;
  const documentAtStart = documentPdf;
  const revision = ++renderGeneration;
  const previousTask = renderTask;
  previousTask?.cancel();
  rendering = true;
  currentPage = number;
  updateControls();
  status.classList.remove('error');
  status.textContent = `Opening page ${number}…`;
  try {
    if (previousTask) await previousTask.promise.catch(() => {});
    const page = await documentAtStart.getPage(number);
    if (revision !== renderGeneration || documentAtStart !== documentPdf) return;
    const natural = page.getViewport({ scale: 1 });
    const fit = Math.max(240, viewport.clientWidth - 48) / natural.width;
    const pageViewport = page.getViewport({ scale: fit * zoom });
    const density = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(8_000_000 / (pageViewport.width * pageViewport.height)));
    canvas.width = Math.ceil(pageViewport.width * density);
    canvas.height = Math.ceil(pageViewport.height * density);
    canvas.style.width = `${Math.ceil(pageViewport.width)}px`;
    canvas.style.height = `${Math.ceil(pageViewport.height)}px`;
    canvas.setAttribute('aria-label', `Page ${number} of ${documentAtStart.numPages}: ${title.textContent}`);
    if (resetScroll) viewport.scrollTo(0, 0);
    const task = page.render({
      canvas,
      canvasContext: canvas.getContext('2d', { alpha: false }),
      viewport: pageViewport,
      transform: [density, 0, 0, density, 0, 0],
      annotationMode: pdfjs.AnnotationMode.DISABLE,
    });
    renderTask = task;
    await task.promise;
    if (revision !== renderGeneration) return;
    status.textContent = `Page ${number} of ${documentAtStart.numPages}`;
  } catch (error) {
    if (revision !== renderGeneration || error.name === 'RenderingCancelledException') return;
    status.classList.add('error');
    status.textContent = 'Unable to display this page. Please try another page or reopen the link.';
  } finally {
    if (revision === renderGeneration) {
      renderTask = null;
      rendering = false;
      updateControls();
    }
  }
}

async function openAuthorizedDocument() {
  const revision = ++generation;
  clearDocument();
  library.hidden = true;
  gate.hidden = false;
  gateTitle.textContent = 'Opening your paper';
  introduction.textContent = 'Verifying access…';
  const paperId = document.body.dataset.paper;
  const access = new URLSearchParams(window.location.hash.slice(1)).get('access');
  if (!paperId || !access) {
    fail('Please open the complete paper link shared by the author.');
    return;
  }
  const controller = new AbortController();
  requests = controller;
  try {
    if (!window.isSecureContext || !crypto.subtle) throw new Error('Please open the link over HTTPS in a modern browser.');
    const keyBytes = decodeAccess(access);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    keyBytes.fill(0);
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('vault.json', controller.signal)));
    if (manifest.version !== 2 || !Array.isArray(manifest.documents)) throw new Error('Invalid document configuration.');
    const paper = manifest.documents.find(item => item.id === paperId);
    if (!paper || paper.file !== `${paperId}.enc` || paper.aad !== `paper-vault/pdf/${paperId}/v1`) throw new Error('The requested paper is unavailable.');
    const envelope = await fetchBytes(paper.file, controller.signal);
    if (envelope.length < 36 || !magic.every((byte, i) => envelope[i] === byte)) throw new Error('Invalid encrypted document.');
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envelope.slice(8, 20), additionalData: encoder.encode(paper.aad), tagLength: 128 }, key, envelope.slice(20));
    const plaintext = new Uint8Array(bytes);
    if (plaintext.length !== paper.bytes || !encoder.encode('%PDF-').every((byte, i) => plaintext[i] === byte)) throw new Error('Invalid PDF.');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    if ([...hash].map(byte => byte.toString(16).padStart(2, '0')).join('') !== paper.sha256) throw new Error('The document could not be verified.');
    if (revision !== generation) { plaintext.fill(0); return; }
    title.textContent = paper.title;
    loadingTask = pdfjs.getDocument({ data: plaintext, standardFontDataUrl: resources, wasmUrl: resources, useWorkerFetch: true, enableXfa: false });
    const loaded = await loadingTask.promise;
    if (revision !== generation) { loaded.destroy().catch(() => {}); return; }
    documentPdf = loaded;
    gate.hidden = true;
    library.hidden = false;
    updateControls();
    await renderPage(1);
  } catch (error) {
    if (revision !== generation || error.name === 'AbortError') return;
    fail(error.name === 'OperationError' ? 'This access link is invalid. Please use the complete link shared by the author.' : (error.message || 'Unable to open the paper.'));
  }
}

previous.addEventListener('click', () => renderPage(currentPage - 1));
next.addEventListener('click', () => renderPage(currentPage + 1));
function openSelectedPage() {
  const page = Number(pageNumber.value);
  if (documentPdf && Number.isInteger(page) && page >= 1 && page <= documentPdf.numPages) renderPage(page);
  else pageNumber.value = currentPage;
}
pageNumber.addEventListener('change', openSelectedPage);
pageNumber.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); openSelectedPage(); }
});
zoomOut.addEventListener('click', () => { zoom = Math.max(0.75, zoom - 0.25); renderPage(currentPage, false); });
zoomIn.addEventListener('click', () => { zoom = Math.min(2.5, zoom + 0.25); renderPage(currentPage, false); });
viewport.addEventListener('contextmenu', event => event.preventDefault());
viewport.addEventListener('dragstart', event => event.preventDefault());
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && ['s', 'p'].includes(event.key.toLowerCase()) && !library.hidden) {
    event.preventDefault();
    status.textContent = 'This shared manuscript is available for on-screen reading.';
    return;
  }
  if (!documentPdf || rendering || !event.target.closest('#viewer') || event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowLeft' && currentPage > 1) { event.preventDefault(); renderPage(currentPage - 1); }
  if (event.key === 'ArrowRight' && currentPage < documentPdf.numPages) { event.preventDefault(); renderPage(currentPage + 1); }
});
let resizeTimer;
let previousWidth = 0;
new ResizeObserver(() => {
  const width = viewport.clientWidth;
  if (!documentPdf || width <= 0 || Math.abs(width - previousWidth) < 2) return;
  previousWidth = width;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderPage(currentPage, false), 150);
}).observe(viewport);
window.addEventListener('pagehide', () => { generation++; clearTimeout(resizeTimer); clearDocument(); });
window.addEventListener('pageshow', event => { if (event.persisted) openAuthorizedDocument(); });
window.addEventListener('hashchange', openAuthorizedDocument);
openAuthorizedDocument();
