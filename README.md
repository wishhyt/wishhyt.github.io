# Shared research manuscripts

Automatically authorized paper links for Yutong Huang.

The new paper reader loads encrypted `.enc` document copies. Each paper uses a separate private access link. Access information stays in the URL fragment, and is never sent in the document request. The browser opens a valid link without asking the reader to enter anything. Pages are drawn into a canvas preview with page navigation and zoom; no original-PDF URL, download link, native PDF toolbar, or print action is provided.

Owner passwords, private salts, access links, plaintext manuscripts, and keys must not be committed. Anyone holding a complete access link can read its paper. Previously downloaded manuscript copies cannot be recalled.

Legacy plaintext PDFs from the previous website remain public in this repository and its history until the approved repository migration. These old copies are not protected by the new reader links. EVGT is uploaded only as ciphertext.

The preview removes ordinary download and print controls; it is not DRM. An authorized reader can still capture the screen or recover data received by their browser. PDF.js 6.3.289 is vendored from the official npm package; licensing notices are included as PDFJS_LICENSE* files.
