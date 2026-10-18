/** Shared, presentation-only photo controls. Capture and analysis stay unchanged. */
const upload = document.getElementById('upload-button');
const label = document.getElementById('upload-label');
const remove = document.getElementById('delete-session-photo');
if (upload && label) {
  upload.classList.add('file-picker-button');
  upload.querySelector('[aria-hidden="true"]')?.remove();
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.7');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(icon.namespaceURI, 'path');
  path.setAttribute('d', 'M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z');
  path.setAttribute('stroke-linejoin', 'round');
  icon.append(path);
  upload.prepend(icon);
  function syncLabel() {
    const replacement = /replace/i.test(label.textContent);
    const text = replacement ? 'Replace photo file' : 'Choose photo file';
    if (label.textContent !== text) label.textContent = text;
    upload.setAttribute('aria-label', replacement ? 'Replace photo from files' : 'Choose photo from files');
    upload.title = 'Choose a JPEG, PNG or WebP photo from your files';
  }
  new MutationObserver(syncLabel).observe(label, { childList: true, characterData: true, subtree: true });
  syncLabel();
}
if (remove) {
  remove.classList.add('photo-delete-button');
  remove.textContent = '×';
  remove.setAttribute('aria-label', 'Delete selected photo');
  remove.title = 'Delete selected photo';
}
if (location.pathname.startsWith('/demo/')) {
  const exit = document.createElement('a');
  exit.href = '/';
  exit.className = 'demo-exit-link';
  exit.textContent = '← Back to sign in';
  exit.id = 'exit-demo';
  document.querySelector('.header')?.after(exit);
}
