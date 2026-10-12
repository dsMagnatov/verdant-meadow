/** Native modal focus handling, animated dismissal and the existing scroll journey. */
export function createMenu({ readViewportHeight = () => window.innerHeight } = {}) {
  const dialog = document.querySelector('#site-menu');
  const toggle = document.querySelector('#menu-toggle');
  const closeButton = dialog.querySelector('.menu-close');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let closing = false, closeTimer = null, pendingProgress = null, previousOverflow = '';
  // Real fragment targets also support opening a destination in a new tab.
  for (const link of dialog.querySelectorAll('.menu-link')) {
    const anchor = document.querySelector(link.getAttribute('href'));
    anchor.style.top = `calc(${Number(link.dataset.scroll)} * var(--scroll-viewport, 100vh))`;
  }

  function open() {
    if (dialog.open) return;
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.classList.add('menu-open');
    toggle.setAttribute('aria-expanded', 'true');
    dialog.showModal();
    // Give the freshly opened top layer an initial painted state to animate from.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (dialog.open && !closing) dialog.classList.add('is-visible');
    }));
  }

  function finishClose() {
    closeTimer = null;
    dialog.close();
    closing = false;
    document.documentElement.style.overflow = previousOverflow;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus({ preventScroll: true });
    if (pendingProgress !== null) {
      const progress = pendingProgress;
      pendingProgress = null;
      window.scrollTo({ top: progress * readViewportHeight(),
        behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    }
  }

  function close(progress = null) {
    if (!dialog.open || closing) return;
    closing = true;
    pendingProgress = progress;
    dialog.classList.remove('is-visible');
    document.body.classList.remove('menu-open');
    if (reducedMotion.matches) finishClose();
    else closeTimer = window.setTimeout(finishClose, 500);
  }

  toggle.addEventListener('click', open);
  closeButton.addEventListener('click', () => close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => {
    const link = event.target.closest('.menu-link');
    if (link) {
      event.preventDefault();
      close(Number(link.dataset.scroll));
    } else if (event.target === dialog) close();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && closing) {
      window.clearTimeout(closeTimer);
      finishClose();
    }
  });

  return { get isOpen() { return dialog.open; } };
}
