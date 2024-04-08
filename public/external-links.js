(makeExternalLinks = () => {
  const allLinks = document.querySelectorAll('a');
  allLinks.forEach(link => {
    if (link.hostname !== location.hostname) {
      link.rel = 'noopener';
      link.target = '_blank';
    }
  });
})();