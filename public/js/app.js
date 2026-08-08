(() => {
  const cfg = window.LNX || { links: {}, latestRelease: {} };
  document.querySelectorAll('[data-link]').forEach(el => {
    const key = el.dataset.link;
    const href = cfg.links?.[key] || '#';
    el.href = href;
    if (href.startsWith('#A_REMPLACER')) {
      el.classList.add('link-pending');
      el.title = 'Lien à renseigner avant mise en ligne';
      el.addEventListener('click', e => e.preventDefault());
    }
  });
  document.querySelectorAll('[data-latest-eyebrow]').forEach(el => el.textContent = cfg.latestRelease?.eyebrow || 'À LA UNE');
  document.querySelectorAll('[data-latest-title]').forEach(el => el.textContent = cfg.latestRelease?.title || 'À découvrir');
  document.querySelectorAll('[data-latest-description]').forEach(el => el.textContent = cfg.latestRelease?.description || 'Découvrir LNX Beats.');
  document.querySelectorAll('[data-latest-link]').forEach(el => el.href = cfg.latestRelease?.url || cfg.latestRelease?.youtube || cfg.latestRelease?.spotify || cfg.links?.spotify || '#');

  const menuBtn = document.querySelector('[data-menu-button]');
  const nav = document.querySelector('[data-mobile-nav]');
  if (menuBtn && nav) menuBtn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });

  const year = new Date().getFullYear();
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = year);

  const contact = document.querySelector('#contact-form');
  if (contact) contact.addEventListener('submit', async e => {
    e.preventDefault();
    const status = contact.querySelector('.form-status');
    const data = Object.fromEntries(new FormData(contact));
    status.textContent = 'Envoi…';
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(data) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Erreur');
      contact.reset(); status.textContent = 'Message envoyé. Merci !'; status.classList.add('success');
    } catch (err) { status.textContent = err.message; status.classList.remove('success'); }
  });
})();
