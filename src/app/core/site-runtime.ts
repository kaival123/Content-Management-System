/**
 * Behaviour for rendered pages: carousels, the mobile menu toggle, entrance
 * animations and forms.
 *
 * Everything lives inside ONE self-contained function (no imports, no outside
 * references) so the static export can ship exactly this code via
 * `siteRuntime.toString()` — the editor, the in-app preview and exported sites all
 * run the same implementation.
 */

export interface CarouselController {
  index(): number;
  goTo(index: number, animate?: boolean): void;
  destroy(): void;
}

export interface SiteRuntime {
  /** Starts every carousel under `root` that isn't running yet. */
  initCarousels(root: ParentNode, opts: { editor: boolean; startIndex?: (el: HTMLElement) => number }): Map<HTMLElement, CarouselController>;
  initCarousel(el: HTMLElement, opts: { editor: boolean; startIndex?: number }): CarouselController;
  /** Mobile menu (☰) toggles, via event delegation on `root`. */
  initNav(root: HTMLElement | Document): void;
  initAnimations(root: ParentNode): void;
  /** Contact/newsletter forms on exported pages (optionally POSTed to `endpoint`). */
  initForms(root: HTMLElement | Document, endpoint?: string): void;
  /**
   * Back to top buttons ([data-back-to-top]) under `root`: shown once the page is scrolled
   * past data-show-after px, scroll to the top when clicked. Returns a cleanup function.
   */
  initBackToTop(root: HTMLElement | Document): () => void;
  /**
   * Smooth open/close for <details data-accordion> (FAQ answers): animates the height,
   * and with data-accordion="single" closes the others in the same list.
   */
  initAccordions(root: HTMLElement | Document): void;
}

export function siteRuntime(): SiteRuntime {
  type Config = {
    perViewDesktop: number;
    perViewTablet: number;
    perViewMobile: number;
    gap: number;
    autoplay: boolean;
    autoplaySpeed: number;
    speed: number;
    loop: boolean;
    arrows: boolean;
    dots: boolean;
    drag: boolean;
    touch: boolean;
    keyboard: boolean;
    center: boolean;
    transition: 'slide' | 'fade' | 'flip';
    pauseOnHover: boolean;
    arrowPosition?: string;
    dotsPosition?: string;
    dotsStyle?: string;
  };

  const CHEVRON = (d: string) =>
    `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

  const MAX_PER_VIEW = 12;

  function initCarousel(el: HTMLElement, opts: { editor: boolean; startIndex?: number }) {
    let cfg: Config;
    try {
      cfg = JSON.parse(el.getAttribute('data-carousel') || '{}');
    } catch {
      cfg = {} as Config;
    }
    const viewport = el.querySelector<HTMLElement>('.lp-car-viewport');
    const track = el.querySelector<HTMLElement>('.lp-car-track');
    const noop = { index: () => 0, goTo: () => {}, destroy: () => {} };
    if (!viewport || !track) return noop;
    const originals = Array.from(track.children).filter((c) => c.classList.contains('lp-car-slide')) as HTMLElement[];
    const n = originals.length;
    if (!n) return noop;

    // Fade and flip stack the slides and show one at a time.
    const fade = cfg.transition === 'fade' || cfg.transition === 'flip';
    // In the editor, sliding by itself or dragging would fight with selecting and typing.
    const autoplay = !!cfg.autoplay && !opts.editor;
    const drag = !opts.editor && (cfg.drag || cfg.touch);
    const speed = Math.max(0, Number(cfg.speed) || 0);
    const gap = Math.max(0, Number(cfg.gap) || 0);

    let per = 1;
    let clones = 0;
    let index = Math.min(Math.max(opts.startIndex ?? 0, 0), n - 1);
    let pos = 0;
    let slideW = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let paused = false;
    const cleanup: (() => void)[] = [];
    const listen = (target: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, o);
      cleanup.push(() => target.removeEventListener(type, fn, o));
    };

    el.setAttribute('role', 'region');
    el.setAttribute('aria-roledescription', 'carousel');
    el.setAttribute('data-drag', String(drag && !fade));
    if (cfg.keyboard && !el.hasAttribute('tabindex')) el.tabIndex = 0;
    originals.forEach((s, i) => {
      s.setAttribute('role', 'group');
      s.setAttribute('aria-roledescription', 'slide');
      s.setAttribute('aria-label', `${i + 1} of ${n}`);
    });

    // Controls. Layout comes from the settings:
    //   stage       wraps the viewport; side arrows and overlay pagination sit on it
    //   top bar     arrows at top-left / top-right
    //   bottom bar  pagination below the slides and/or arrows at the bottom
    const arrowPos = cfg.arrowPosition || 'sides';
    const dotsPos = cfg.dotsPosition || 'below';
    const dotsStyle = cfg.dotsStyle || 'pills';
    const added: HTMLElement[] = [];
    const stage = document.createElement('div');
    stage.className = 'lp-car-stage';
    viewport.before(stage);
    stage.append(viewport);

    let prev: HTMLButtonElement | null = null;
    let next: HTMLButtonElement | null = null;
    let dotsEl: HTMLElement | null = null;
    const arrow = (dir: 'prev' | 'next') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lp-car-arrow lp-car-${dir}`;
      b.setAttribute('aria-label', dir === 'prev' ? 'Previous slide' : 'Next slide');
      b.innerHTML = CHEVRON(dir === 'prev' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6');
      listen(b, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        step(dir === 'prev' ? -1 : 1);
      });
      return b;
    };
    if (cfg.arrows && n > 1) {
      prev = arrow('prev');
      next = arrow('next');
    }
    if (cfg.dots && n > 1) {
      dotsEl = document.createElement('div');
      dotsEl.className = 'lp-car-dots';
    }
    const bar = (where: 'top' | 'bottom') => {
      const b = document.createElement('div');
      b.className = `lp-car-bar lp-car-bar-${where}`;
      added.push(b);
      return b;
    };
    const arrowGroup = () => {
      const g = document.createElement('div');
      g.className = 'lp-car-arrow-group';
      g.append(prev!, next!);
      return g;
    };
    const hasArrows = !!(prev && next);
    const dotsBelow = !!dotsEl && dotsPos !== 'overlay';
    if (dotsEl && !dotsBelow) stage.append(dotsEl);
    if (hasArrows && (arrowPos === 'sides' || arrowPos === 'outside')) stage.append(prev!, next!);
    if (hasArrows && (arrowPos === 'left' || arrowPos === 'right')) stage.append(arrowGroup());
    if (hasArrows && arrowPos.startsWith('top-')) {
      const top = bar('top');
      top.append(arrowGroup());
      stage.before(top);
    }
    if ((hasArrows && arrowPos.startsWith('bottom-')) || dotsBelow) {
      const bottom = bar('bottom');
      if (hasArrows && arrowPos === 'bottom-center') {
        bottom.append(prev!);
        if (dotsBelow) bottom.append(dotsEl!);
        bottom.append(next!);
      } else {
        if (dotsBelow) bottom.append(dotsEl!);
        if (hasArrows && arrowPos === 'bottom-left') bottom.prepend(arrowGroup());
        if (hasArrows && arrowPos === 'bottom-right') bottom.append(arrowGroup());
      }
      stage.after(bottom);
    }

    function perViewFor(width: number) {
      const v = width > 900 ? cfg.perViewDesktop : width > 600 ? cfg.perViewTablet : cfg.perViewMobile;
      return fade ? 1 : Math.max(1, Math.min(Math.round(Number(v)) || 1, MAX_PER_VIEW));
    }

    const looping = () => !!cfg.loop && !fade && n > per;
    const maxIndex = () => (looping() || cfg.center ? n - 1 : Math.max(0, n - per));

    function build() {
      track!.querySelectorAll('.lp-car-clone').forEach((c) => c.remove());
      clones = 0;
      if (looping()) {
        // Copies of the last/first slides on either side make the loop seamless.
        clones = per + (cfg.center ? 1 : 0);
        const make = (s: HTMLElement) => {
          const c = s.cloneNode(true) as HTMLElement;
          c.classList.add('lp-car-clone');
          c.setAttribute('aria-hidden', 'true');
          c.removeAttribute('aria-label');
          c.querySelectorAll('[contenteditable]').forEach((x) => x.removeAttribute('contenteditable'));
          c.querySelectorAll('a, button, input, iframe').forEach((x) => x.setAttribute('tabindex', '-1'));
          return c;
        };
        const tail = originals.slice(-clones).map(make);
        const head = originals.slice(0, clones).map(make);
        track!.prepend(...tail);
        track!.append(...head);
      }
      // All slides fit: nothing to move to, so hide the arrows and dots.
      el.classList.toggle('lp-car-static', !looping() && !cfg.center && maxIndex() === 0);
      renderDots();
    }

    /** Picture for a thumbnail: the slide's first image or background image. */
    function thumbOf(slide: HTMLElement): string {
      const img = slide.querySelector('img');
      if (img?.getAttribute('src')) return img.getAttribute('src')!;
      for (const x of [slide, ...Array.from(slide.querySelectorAll<HTMLElement>('[style*="background-image"]'))]) {
        const m = /url\((['"]?)(.*?)\1\)/.exec(x.style.backgroundImage || '');
        if (m) return m[2];
      }
      return '';
    }

    function renderDots() {
      if (!dotsEl) return;
      const count = maxIndex() + 1;
      dotsEl.innerHTML = '';
      if (dotsStyle === 'fraction') {
        dotsEl.innerHTML = '<span class="lp-car-fraction" aria-live="polite"><b></b> / <span></span></span>';
        dotsEl.querySelector('.lp-car-fraction span')!.textContent = String(count);
        return;
      }
      if (dotsStyle === 'progress') {
        dotsEl.innerHTML = '<span class="lp-car-progress" role="progressbar" aria-label="Slide" aria-valuemin="1"><span></span></span>';
        dotsEl.firstElementChild!.setAttribute('aria-valuemax', String(count));
        return;
      }
      for (let i = 0; i < count; i++) {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = 'lp-car-dot';
        d.setAttribute('aria-label', `Go to slide ${i + 1}`);
        if (dotsStyle === 'numbers') d.textContent = String(i + 1).padStart(2, '0');
        if (dotsStyle === 'thumbs') {
          const src = thumbOf(originals[i]);
          if (src) d.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
          else d.textContent = String(i + 1);
        }
        d.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          goTo(i);
        });
        dotsEl.append(d);
      }
    }

    /** Highlights the current page in the pagination, whatever its style. */
    function markDots(i: number) {
      if (!dotsEl) return;
      const count = maxIndex() + 1;
      const cur = Math.min(i, count - 1);
      dotsEl.querySelectorAll('.lp-car-dot').forEach((d, k) => d.classList.toggle('is-active', k === cur));
      const frac = dotsEl.querySelector('.lp-car-fraction b');
      if (frac) frac.textContent = String(cur + 1);
      const progress = dotsEl.querySelector<HTMLElement>('.lp-car-progress');
      if (progress) {
        progress.setAttribute('aria-valuenow', String(cur + 1));
        (progress.firstElementChild as HTMLElement).style.width = `${((cur + 1) / count) * 100}%`;
      }
    }

    function layout() {
      const width = viewport!.clientWidth;
      const nextPer = perViewFor(el.clientWidth || width);
      if (nextPer !== per || (looping() && !clones) || (!looping() && clones)) {
        per = nextPer;
        build();
      }
      if (fade) {
        track!.style.transform = '';
        update(false);
        return;
      }
      slideW = (width - gap * (per - 1)) / per;
      if (cfg.center && per > 1) slideW = (width - gap * (per - 1)) / (per - 0.5);
      track!.style.gap = `${gap}px`;
      for (const s of Array.from(track!.children) as HTMLElement[]) {
        s.style.flex = `0 0 ${slideW}px`;
        s.style.width = `${slideW}px`;
      }
      update(false);
    }

    function offsetFor(p: number) {
      const width = viewport!.clientWidth;
      let x = -p * (slideW + gap);
      if (cfg.center) x += (width - slideW) / 2;
      return x;
    }

    function update(animate: boolean) {
      if (fade) {
        originals.forEach((s, i) => s.classList.toggle('is-active', i === index));
      } else {
        pos = index + clones;
        track!.style.transition = animate ? `transform ${speed}ms ease` : 'none';
        track!.style.transform = `translate3d(${offsetFor(pos)}px, 0, 0)`;
        const all = Array.from(track!.children);
        all.forEach((s, i) => s.classList.toggle('is-active', i === pos));
      }
      markDots(index);
      if (prev && next && !looping()) {
        prev.disabled = index <= 0;
        next.disabled = index >= maxIndex();
      }
    }

    function goTo(i: number, animate = true) {
      index = Math.min(Math.max(i, 0), maxIndex());
      update(animate);
    }

    function step(dir: number) {
      if (looping()) {
        // Still inside the clones from a previous (unfinished) step: jump to the matching
        // real slide first, then animate from there.
        if (pos < clones || pos >= clones + n) {
          update(false);
          void track!.offsetWidth;
        }
        // Slide into the clones, then jump back to the real slide without animation.
        dir = Math.max(-clones, Math.min(clones, dir));
        pos += dir;
        index = (((pos - clones) % n) + n) % n;
        track!.style.transition = `transform ${speed}ms ease`;
        track!.style.transform = `translate3d(${offsetFor(pos)}px, 0, 0)`;
        Array.from(track!.children).forEach((s, k) => s.classList.toggle('is-active', k === pos));
        markDots(index);
        return;
      }
      let target = index + dir;
      // Without looping, autoplay and "next" on the last slide rewind to the start.
      if (target > maxIndex()) target = 0;
      if (target < 0) target = maxIndex();
      goTo(target);
    }

    listen(track, 'transitionend', (e) => {
      if (e.target !== track || !looping()) return;
      if (pos < clones || pos >= clones + n) update(false);
    });

    // Mouse drag and touch swipe
    if (drag && !fade) {
      let startX = 0;
      let startY = 0;
      let dx = 0;
      let active = false;
      let moved = false;
      listen(viewport, 'pointerdown', (ev) => {
        const e = ev as PointerEvent;
        if (e.pointerType === 'mouse' ? !cfg.drag || e.button !== 0 : !cfg.touch) return;
        active = true;
        moved = false;
        startX = e.clientX;
        startY = e.clientY;
        dx = 0;
        track!.style.transition = 'none';
      });
      listen(window, 'pointermove', (ev) => {
        const e = ev as PointerEvent;
        if (!active) return;
        dx = e.clientX - startX;
        if (!moved && Math.abs(e.clientY - startY) > Math.abs(dx)) {
          active = false; // vertical scroll wins
          return;
        }
        if (Math.abs(dx) > 5) {
          moved = true;
          el.classList.add('is-dragging');
        }
        track!.style.transform = `translate3d(${offsetFor(pos) + dx}px, 0, 0)`;
      });
      const end = () => {
        if (!active) return;
        active = false;
        el.classList.remove('is-dragging');
        const count = Math.max(-per, Math.min(per, Math.round(-dx / (slideW + gap))));
        const threshold = Math.abs(dx) > slideW * 0.18;
        if (threshold) step(count || (dx < 0 ? 1 : -1));
        else update(true);
      };
      listen(window, 'pointerup', end);
      listen(window, 'pointercancel', end);
      // A drag shouldn't also count as a click on a link inside the slide.
      listen(
        viewport,
        'click',
        (e) => {
          if (moved) {
            e.preventDefault();
            e.stopPropagation();
            moved = false;
          }
        },
        { capture: true },
      );
      listen(viewport, 'dragstart', (e) => e.preventDefault());
    }

    if (cfg.keyboard) {
      listen(el, 'keydown', (ev) => {
        const e = ev as KeyboardEvent;
        if ((e.target as HTMLElement).isContentEditable || /INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName)) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          step(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          step(1);
        }
      });
    }

    if (autoplay) {
      const start = () => {
        clearInterval(timer);
        timer = setInterval(() => {
          if (!paused && !document.hidden) step(1);
        }, Math.max(800, Number(cfg.autoplaySpeed) || 4000));
      };
      start();
      if (cfg.pauseOnHover) {
        listen(el, 'mouseenter', () => (paused = true));
        listen(el, 'mouseleave', () => (paused = false));
        listen(el, 'focusin', () => (paused = true));
        listen(el, 'focusout', () => (paused = false));
      }
      cleanup.push(() => clearInterval(timer));
    }

    const ro = new ResizeObserver(() => layout());
    ro.observe(el);
    cleanup.push(() => ro.disconnect());
    per = perViewFor(el.clientWidth || viewport.clientWidth);
    build();
    layout();
    el.setAttribute('data-carousel-ready', '');

    return {
      index: () => index,
      goTo,
      destroy() {
        cleanup.forEach((fn) => fn());
        prev?.remove();
        next?.remove();
        dotsEl?.remove();
        added.forEach((x) => x.remove());
        stage.replaceWith(viewport);
        el.classList.remove('lp-car-static');
        track!.querySelectorAll('.lp-car-clone').forEach((c) => c.remove());
        track!.style.transform = '';
        track!.style.transition = '';
        el.removeAttribute('data-carousel-ready');
      },
    };
  }

  function initCarousels(root: ParentNode, opts: { editor: boolean; startIndex?: (el: HTMLElement) => number }) {
    const out = new Map<HTMLElement, ReturnType<typeof initCarousel>>();
    root.querySelectorAll<HTMLElement>('[data-carousel]:not([data-carousel-ready])').forEach((el) => {
      out.set(el, initCarousel(el, { editor: opts.editor, startIndex: opts.startIndex?.(el) }));
    });
    return out;
  }

  function initNav(root: HTMLElement | Document) {
    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest?.('.lp-nav-toggle');
      if (!btn) return;
      const nav = btn.closest('.lp-nav');
      const open = !nav?.classList.contains('lp-nav-open');
      nav?.classList.toggle('lp-nav-open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  function initAnimations(root: ParentNode) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('lp-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    root.querySelectorAll('.lp-anim:not(.lp-in)').forEach((el) => io.observe(el));
  }

  function initForms(root: HTMLElement | Document, endpoint?: string) {
    root.addEventListener('submit', async (event) => {
      const form = event.target as HTMLFormElement;
      if (form.dataset['form'] !== 'contact') return;
      event.preventDefault();
      if (endpoint) {
        await fetch(endpoint, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } }).catch(() => {});
      }
      form.reset();
      form.querySelector('.lp-success')?.remove();
      const msg = document.createElement('p');
      msg.className = 'lp-success';
      msg.textContent = form.dataset['success'] || 'Thanks!';
      form.prepend(msg);
    });
  }

  function initBackToTop(root: HTMLElement | Document) {
    const buttons = () => Array.from(root.querySelectorAll<HTMLElement>('[data-back-to-top]'));
    // Cheap enough to run on every scroll event (browsers fire those at most once a frame).
    const update = () => {
      const y = window.scrollY || document.documentElement.scrollTop;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      for (const b of buttons()) {
        const after = Number(b.getAttribute('data-show-after') ?? 300) || 0;
        b.classList.toggle('is-visible', y > after);
        b.style.setProperty('--btt-p', String(Math.min(1, y / max)));
      }
    };
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest?.<HTMLElement>('[data-back-to-top]');
      if (!b) return;
      e.preventDefault();
      const smooth = b.getAttribute('data-smooth') !== 'false' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
      // Move keyboard focus to the top of the page as well.
      const first = document.querySelector<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])');
      first?.focus({ preventScroll: true });
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    root.addEventListener('click', onClick);
    update();
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      root.removeEventListener('click', onClick);
    };
  }

  function initAccordions(root: HTMLElement | Document) {
    const running = new WeakMap<HTMLDetailsElement, Animation>();
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function toggle(d: HTMLDetailsElement, open: boolean) {
      const speed = Math.max(0, Number(d.getAttribute('data-speed') ?? 320) || 0);
      d.style.setProperty('--faq-speed', `${speed}ms`);
      running.get(d)?.cancel();
      if (reduced() || !speed || typeof d.animate !== 'function') {
        d.open = open;
        d.classList.remove('is-closing');
        return;
      }
      // Measure the start and end heights, then animate between them. While closing the
      // element stays [open] (so the answer is visible) until the animation ends.
      const start = d.offsetHeight;
      d.open = open;
      const end = d.offsetHeight;
      if (!open) d.open = true;
      d.classList.toggle('is-closing', !open);
      d.style.overflow = 'hidden';
      const anim = d.animate({ height: [`${start}px`, `${end}px`] }, { duration: speed, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
      running.set(d, anim);
      const done = () => {
        if (running.get(d) !== anim) return;
        running.delete(d);
        // If it hasn't played to the end (fallback timer), drop it so the final height applies.
        if (anim.playState !== 'finished') anim.cancel();
        d.style.overflow = '';
        d.classList.remove('is-closing');
        if (!open) d.open = false;
      };
      anim.onfinish = done;
      // Fallback in case the finish event never comes (e.g. a background tab): done() only acts once.
      setTimeout(done, speed + 80);
      anim.oncancel = () => {
        if (running.get(d) === anim) running.delete(d);
        d.style.overflow = '';
      };
    }

    root.addEventListener('click', (e) => {
      const summary = (e.target as HTMLElement).closest?.('summary');
      const d = summary?.parentElement as HTMLDetailsElement | null;
      if (!d || d.tagName !== 'DETAILS' || !d.hasAttribute('data-accordion')) return;
      e.preventDefault();
      // "Opening" also when it is mid-close (still [open] with .is-closing).
      const opening = !d.open || d.classList.contains('is-closing');
      if (opening && d.getAttribute('data-accordion') === 'single') {
        const list = d.parentElement;
        list?.querySelectorAll<HTMLDetailsElement>(':scope > details[data-accordion][open]').forEach((o) => {
          if (o !== d && !o.classList.contains('is-closing')) toggle(o, false);
        });
      }
      toggle(d, opening);
    });
  }

  return { initCarousels, initCarousel, initNav, initAnimations, initForms, initBackToTop, initAccordions };
}
