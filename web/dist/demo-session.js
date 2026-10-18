/** Demo is entered explicitly for this visit, never remembered as a login. */
(() => {
  const url = new URL(location.href);
  if (url.searchParams.get('entry') !== '1') {
    document.documentElement.style.visibility = 'hidden';
    location.replace('/');
    return;
  }
  url.searchParams.delete('entry');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  window.addEventListener('pageshow', event => {
    if (event.persisted) location.replace('/');
  });
})();
