/* DMRC Cinematic Motion Layer — optional libraries, graceful fallback, no app-logic hooks. */
(()=> {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const load = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve(true);
    script.onerror = () => { script.remove(); reject(new Error('Optional motion library unavailable')); };
    document.head.appendChild(script);
  });

  const safe = (fn) => { try { fn(); } catch (_) {} };
  const visiblePage = () => document.querySelector('.page.active');
  let gsapReady = false;
  let lastPage = null;
  let observer = null;

  function animatePage(page) {
    if (!page || !gsapReady || !window.gsap || page === lastPage) return;
    lastPage = page;
    safe(() => {
      const gsap = window.gsap;
      const items = page.querySelectorAll('.search-panel, .creator-intro, .creator-admin-card, .ai-card, .profile-card, .form-card, .composer, .post');
      const visible = Array.from(items).filter(el => el.getClientRects().length && !el.hasAttribute('data-dmrc-motion-skip'));
      if (!visible.length) return;
      gsap.killTweensOf(visible);
      gsap.fromTo(visible,
        { autoAlpha: 0, y: 14, scale: 0.992 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.58, stagger: 0.055, ease: 'power3.out', overwrite: true, clearProps: 'transform' }
      );
    });
  }

  function initGsap() {
    const gsap = window.gsap;
    if (!gsap) return;
    gsapReady = true;
    if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
    gsap.defaults({ ease: 'power3.out' });

    // Animate only content surfaces; authentication and its background are intentionally excluded.
    animatePage(visiblePage());

    const onPageChange = () => {
      const page = visiblePage();
      if (page && page !== lastPage) animatePage(page);
    };
    observer = new MutationObserver(() => requestAnimationFrame(onPageChange));
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

    // Animate dynamically inserted feed items without touching login or navigation behavior.
    const feedObserver = new MutationObserver(records => {
      if (!gsapReady) return;
      const added = [];
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.('.post, .search-result, .profile-search-result')) added.push(node);
        node.querySelectorAll?.('.post, .search-result, .profile-search-result').forEach(el => added.push(el));
      }
      const unique = [...new Set(added)].filter(el => el.getClientRects().length && !el.dataset.dmrcAnimated);
      unique.forEach(el => { el.dataset.dmrcAnimated = '1'; });
      if (unique.length) safe(() => gsap.fromTo(unique, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.42, stagger: 0.035, clearProps: 'transform', overwrite: true }));
    });
    feedObserver.observe(document.body, { childList: true, subtree: true });

    // Subtle pointer response is desktop-only and excludes forms, nav and authentication.
    if (finePointer) {
      document.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse') return;
        const card = event.target.closest('.post, .profile-card, .search-panel, .creator-intro, .ai-card, .composer');
        if (!card || card.matches('.auth-card')) return;
        const rect = card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / Math.max(rect.width, 1) - 0.5;
        const y = (event.clientY - rect.top) / Math.max(rect.height, 1) - 0.5;
        card.style.setProperty('--dmrc-light-x', (50 + x * 70) + '%');
        card.style.setProperty('--dmrc-light-y', (50 + y * 70) + '%');
      }, { passive: true });
    }
  }

  // Optional Lenis: desktop pointer devices only. Touch scrolling stays native for responsiveness.
  async function initLenis() {
    if (!finePointer || navigator.connection?.saveData) return;
    try {
      await load('https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js');
      if (!window.Lenis || !window.gsap) return;
      const lenis = new window.Lenis({ duration: 1.05, smoothWheel: true, syncTouch: false, wheelMultiplier: 0.9 });
      window.dmrcLenis = lenis;
      lenis.on('scroll', () => window.ScrollTrigger?.update());
      window.gsap.ticker.add(time => lenis.raf(time * 1000));
      window.gsap.ticker.lagSmoothing(0);
      document.documentElement.classList.add('lenis', 'lenis-smooth');
    } catch (_) { /* Native scrolling remains available. */ }
  }

  async function boot() {
    try {
      await load('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js');
      try { await load('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js'); } catch (_) {}
      initGsap();
      initLenis();
    } catch (_) {
      // Existing CSS transitions are the reliable offline/CDN-failure fallback.
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .post,.profile-card,.search-panel,.creator-intro,.ai-card,.composer{position:relative}
    .post:after,.profile-card:after,.search-panel:after,.creator-intro:after,.ai-card:after,.composer:after{
      content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;
      background:radial-gradient(260px circle at var(--dmrc-light-x,50%) var(--dmrc-light-y,0%),rgba(255,255,255,.085),transparent 70%);
      transition:opacity .28s ease;
    }
    @media(hover:hover) and (pointer:fine){
      .post:hover:after,.profile-card:hover:after,.search-panel:hover:after,.creator-intro:hover:after,.ai-card:hover:after,.composer:hover:after{opacity:1}
      .post,.profile-card,.search-panel,.creator-intro,.ai-card,.composer{transition:border-color .28s ease,box-shadow .28s ease}
    }
    html.lenis,html.lenis body{height:auto}
    @media(prefers-reduced-motion:reduce){.post:after,.profile-card:after,.search-panel:after,.creator-intro:after,.ai-card:after,.composer:after{display:none}}
  `;
  document.head.appendChild(style);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();