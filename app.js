const encoder = new TextEncoder();
const magic = encoder.encode('PAPERV1\n');
const gate = document.querySelector('#gate');
const library = document.querySelector('#library');
const title = document.querySelector('#paper-title');
const gateTitle = document.querySelector('#gate-title');
const introduction = document.querySelector('#introduction');
const status = document.querySelector('#status');
const frame = document.querySelector('#paper-frame');
const download = document.querySelector('#download');
const openPdf = document.querySelector('#open-pdf');
let activeUrl = null;

function clearDocument() {
  frame.removeAttribute('src');
  download.removeAttribute('href');
  openPdf.removeAttribute('href');
  if (activeUrl) URL.revokeObjectURL(activeUrl);
  activeUrl = null;
}

function fail(message) {
  clearDocument();
  gate.hidden = false;
  library.hidden = true;
  gateTitle.textContent = 'Access link required';
  introduction.textContent = message;
  status.textContent = '';
}

function decodeAccess(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Invalid access link.');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='), character => character.charCodeAt(0));
}

async function fetchBytes(path) {
  if (!/^[a-z0-9-]+\.(enc|json)$/.test(path)) throw new Error('Invalid document location.');
  const response = await fetch(new URL(path, window.location.href), { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error('This document is temporarily unavailable.');
  return new Uint8Array(await response.arrayBuffer());
}

async function openAuthorizedDocument() {
  const paperId = document.body.dataset.paper;
  const access = new URLSearchParams(window.location.hash.slice(1)).get('access');
  if (!paperId || !access) {
    fail('Please open the complete paper link shared by the author.');
    return;
  }
  try {
    if (!window.isSecureContext || !crypto.subtle) throw new Error('Please open the link over HTTPS in a modern browser.');
    const keyBytes = decodeAccess(access);
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    keyBytes.fill(0);
    const manifest = JSON.parse(new TextDecoder().decode(await fetchBytes('vault.json')));
    if (manifest.version !== 2 || !Array.isArray(manifest.documents)) throw new Error('Invalid document configuration.');
    const paper = manifest.documents.find(item => item.id === paperId);
    if (!paper || paper.file !== `${paperId}.enc` || paper.aad !== `paper-vault/pdf/${paperId}/v1`) throw new Error('The requested paper is unavailable.');
    const envelope = await fetchBytes(paper.file);
    if (envelope.length < 36 || !magic.every((byte, i) => envelope[i] === byte)) throw new Error('Invalid encrypted document.');
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envelope.slice(8, 20), additionalData: encoder.encode(paper.aad), tagLength: 128 }, key, envelope.slice(20));
    const plaintext = new Uint8Array(bytes);
    if (!encoder.encode('%PDF-').every((byte, i) => plaintext[i] === byte)) throw new Error('Invalid PDF.');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    if ([...hash].map(byte => byte.toString(16).padStart(2, '0')).join('') !== paper.sha256) throw new Error('The document could not be verified.');
    clearDocument();
    activeUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    plaintext.fill(0);
    title.textContent = paper.title;
    frame.title = paper.title;
    frame.src = activeUrl;
    download.href = activeUrl;
    download.download = paper.filename;
    openPdf.href = activeUrl;
    gate.hidden = true;
    library.hidden = false;
    status.textContent = '';
  } catch (error) {
    fail(error.name === 'OperationError' ? 'This access link is invalid. Please use the complete link shared by the author.' : (error.message || 'Unable to open the paper.'));
  }
}

window.addEventListener('pagehide', clearDocument);
window.addEventListener('hashchange', () => { clearDocument(); library.hidden = true; gate.hidden = false; gateTitle.textContent = 'Opening your paper'; introduction.textContent = 'Verifying access...'; openAuthorizedDocument(); });
openAuthorizedDocument();
