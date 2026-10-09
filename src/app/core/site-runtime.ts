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
  initImageFallback(root: HTMLElement | Document): void;
  initAnimations(root: ParentNode): void;
  /** Contact/newsletter forms on exported pages (optionally POSTed to `endpoint`). */
  initForms(root: HTMLElement | Document, endpoint?: string): void;
  /**
   * Back to top buttons ([data-back-to-top]) under `root`: shown once the page is scrolled
   * past data-show-after px, scroll to the top when clicked. Returns a cleanup function.
   */
  initBackToTop(root: HTMLElement | Document): () => void;
  /**
   * Mini header (top bar) tools under `root`: text size − A + ([data-mh-font]), colour theme dots
   * ([data-mh-theme]), the language dropdown ([data-mh-lang]), and links to #main (skip to content) and
   * #screen-reader (accessibility mode). Choices are remembered in localStorage (not while editing).
   */
  initMiniHeader(root: HTMLElement | Document): void;
  /**
   * Accessibility tools panel ([data-a11y], UX4G Accessibility 3.0 style): bigger text, spacing, line height, link
   * highlight, screen reader, cursor, pause animation, colour filters, dark mode, dyslexia font, hide images, focus mode,
   * reading guide, text magnify and voice commands. Choices are applied as classes on the page and remembered.
   */
  initAccessibility(root: HTMLElement | Document): void;
  /**
   * Smooth open/close for <details data-accordion> (FAQ answers): animates the height,
   * and with data-accordion="single" closes the others in the same list.
   */
  initAccordions(root: HTMLElement | Document): void;
  /**
   * Tabs sections ([data-tabs]): clicking a [data-tab] shows the [data-tab-panel] at the same
   * position; arrow keys move between tabs. Works for horizontal and vertical tab lists.
   */
  initTabs(root: HTMLElement | Document): void;
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
    transition: string;
    pauseOnHover: boolean;
    playButton?: boolean;
    capsulePlay?: boolean;
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
    const fade = !!cfg.transition && cfg.transition !== 'slide';
    const auto = cfg.transition === 'auto';
    const mask = auto || (!!cfg.transition && cfg.transition.startsWith('mask-'));
    const AUTO_EFFECTS = ['mask-ink', 'mask-circle', 'mask-wipe', 'mask-clock', 'mask-blinds', 'mask-corner', 'mask-rise', 'mask-dots', 'mask-rows', 'mask-split', 'mask-diamond', 'mask-sweep', 'mask-box', 'mask-fan', 'mask-tiles', 'mask-fall', 'mask-arc', 'mask-cross', 'mask-bars', 'mask-diagonal', 'mask-slats', 'mask-open', 'mask-zoom'];
    let autoStep = 0;
    // In the editor, sliding by itself or dragging would fight with selecting and typing.
    const autoplay = !!cfg.autoplay && !opts.editor;
    const drag = !opts.editor && (cfg.drag || cfg.touch);
    const speed = Math.max(0, Number(cfg.speed) || 0);
    const gap = Math.max(0, Number(cfg.gap) || 0);

    /** The easing picked in the slider settings (set as --car-ease), or the browser's "ease". */
    const ease = () => getComputedStyle(el).getPropertyValue('--car-ease').trim() || 'ease';

    let per = 1;
    let clones = 0;
    let index = Math.min(Math.max(opts.startIndex ?? 0, 0), n - 1);
    let pos = 0;
    let slideW = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let paused = false;
    /** Switched off by the visitor with the play/pause button. */
    let stopped = false;
    const cleanup: (() => void)[] = [];
    const listen = (target: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, o);
      cleanup.push(() => target.removeEventListener(type, fn, o));
    };

    // A picture that can't load (offline, removed) is replaced by the default one.
    const fallbackSrc = el.getAttribute('data-car-fallback');
    if (fallbackSrc) {
      listen(
        el,
        'error',
        (e) => {
          const img = e.target as HTMLImageElement;
          if (img?.tagName === 'IMG' && img.getAttribute('src') !== fallbackSrc) img.src = fallbackSrc;
        },
        { capture: true },
      );
    }

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
    /** The play / pause button when it lives inside the capsule pagination. */
    let playBtn: HTMLButtonElement | null = null;
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
    // "Navigation bar": arrows, pagination and play/pause together in one bar over the slides.
    const barMode = (arrowPos === 'pill' || dotsPos === 'bar') && (hasArrows || !!dotsEl);
    let navBar: HTMLElement | null = null;
    if (barMode) {
      navBar = document.createElement('div');
      navBar.className = 'lp-car-pill';
      if (hasArrows) navBar.append(prev!);
      if (dotsEl) navBar.append(dotsEl);
      if (hasArrows) navBar.append(next!);
      stage.append(navBar);
    }
    const dotsBelow = !barMode && !!dotsEl && dotsPos !== 'overlay';
    if (dotsEl && !barMode && !dotsBelow) stage.append(dotsEl);
    if (!barMode && hasArrows && (arrowPos === 'sides' || arrowPos === 'outside')) stage.append(prev!, next!);
    if (!barMode && hasArrows && (arrowPos === 'left' || arrowPos === 'right')) stage.append(arrowGroup());
    if (!barMode && hasArrows && arrowPos.startsWith('top-')) {
      const top = bar('top');
      top.append(arrowGroup());
      stage.before(top);
    }
    if ((!barMode && hasArrows && arrowPos.startsWith('bottom-')) || dotsBelow) {
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
      // The pagination was rebuilt: put the capsule's play / pause button back.
      if (playBtn) dotsEl.append(playBtn);
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
        // Mask transitions: the outgoing slide stays visible underneath while the new one is revealed on top.
        const leaving = mask && animate ? originals.find((s) => s.classList.contains('is-active') && s !== originals[index]) : undefined;
        originals.forEach((s, i) => {
          s.classList.toggle('is-active', i === index);
          if (i !== index) s.classList.remove('is-entering');
        });
        if (mask && animate) {
          if (auto && leaving) {
            // A different effect for each change, in turn.
            AUTO_EFFECTS.forEach((e) => el.classList.remove(`lp-car-${e}`));
            el.classList.add(`lp-car-${AUTO_EFFECTS[autoStep++ % AUTO_EFFECTS.length]}`);
          }
          originals.forEach((s) => s.classList.remove('is-leaving'));
          const entering = originals[index];
          entering.classList.remove('is-entering');
          if (leaving) {
            leaving.classList.add('is-leaving');
            void entering.offsetWidth; // restart the CSS animation
            entering.classList.add('is-entering');
            setTimeout(() => {
              leaving.classList.remove('is-leaving');
              entering.classList.remove('is-entering');
            }, speed + 50);
          }
        }
      } else {
        pos = index + clones;
        track!.style.transition = animate ? `transform ${speed}ms ${ease()}` : 'none';
        track!.style.transform = `translate3d(${offsetFor(pos)}px, 0, 0)`;
        const all = Array.from(track!.children);
        all.forEach((s, i) => s.classList.toggle('is-active', i === pos));
      }
      markDots(index);
      // Stacked transitions (fade, flip, masks) loop by wrapping around, so the arrows never run out.
      if (prev && next && !looping()) {
        const wraps = fade && !!cfg.loop && n > 1;
        prev.disabled = !wraps && index <= 0;
        next.disabled = !wraps && index >= maxIndex();
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
        track!.style.transition = `transform ${speed}ms ${ease()}`;
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
          if (!paused && !stopped && !document.hidden) step(1);
        }, Math.max(800, Number(cfg.autoplaySpeed) || 4000));
      };
      start();
      // The capsule has its own switch; other styles use the general play / pause button setting.
      if (dotsStyle === 'capsule' && dotsEl ? cfg.capsulePlay !== false : cfg.playButton) {
        const PLAY = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
        const PAUSE = '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lp-car-play';
        const sync = () => {
          btn.innerHTML = stopped ? PLAY : PAUSE;
          btn.setAttribute('aria-label', stopped ? 'Start automatic slide show' : 'Stop automatic slide show');
          btn.setAttribute('aria-pressed', String(!stopped));
        };
        sync();
        listen(btn, 'click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          stopped = !stopped;
          if (!stopped) start(); // a full interval before the next change
          sync();
        });
        if (dotsStyle === 'capsule' && dotsEl) {
          playBtn = btn;
          dotsEl.append(btn);
        } else {
          (navBar ?? stage).append(btn);
        }
        added.push(btn);
      }
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

  /** A content picture that can't load is replaced by the section's default picture (logos and avatars are left alone). */
  function initImageFallback(root: HTMLElement | Document) {
    root.addEventListener(
      'error',
      (e) => {
        const img = e.target as HTMLImageElement;
        if (img?.tagName !== 'IMG' || img.closest('.lp-nav, .lp-logos, .lp-avatar')) return;
        const fallback = img.closest<HTMLElement>('[data-img-fallback]')?.getAttribute('data-img-fallback');
        if (fallback && img.getAttribute('src') !== fallback) img.src = fallback;
      },
      true,
    );
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
          const repeat = e.target.classList.contains('lp-anim-repeat');
          if (e.isIntersecting) {
            e.target.classList.add('lp-in');
            if (!repeat) io.unobserve(e.target);
          } else if (repeat) {
            e.target.classList.remove('lp-in'); // plays again when it scrolls back into view
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

  function initTabs(root: HTMLElement | Document) {
    function select(tab: HTMLElement) {
      const box = tab.closest<HTMLElement>('[data-tabs]');
      if (!box) return;
      const tabs = [...box.querySelectorAll<HTMLElement>('[data-tab]')];
      const panels = [...box.querySelectorAll<HTMLElement>('[data-tab-panel]')];
      const at = tabs.indexOf(tab);
      tabs.forEach((t, i) => {
        t.classList.toggle('is-active', i === at);
        t.setAttribute('aria-selected', String(i === at));
        t.tabIndex = i === at ? 0 : -1;
      });
      panels.forEach((p, i) => p.classList.toggle('is-active', i === at));
    }

    root.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest?.<HTMLElement>('[data-tab]');
      if (tab) select(tab);
    });
    root.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      const tab = (ev.target as HTMLElement).closest?.<HTMLElement>('[data-tab]');
      const box = tab?.closest<HTMLElement>('[data-tabs]');
      if (!tab || !box) return;
      const tabs = [...box.querySelectorAll<HTMLElement>('[data-tab]')];
      const i = tabs.indexOf(tab);
      let next = -1;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') next = (i + 1) % tabs.length;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      ev.preventDefault();
      tabs[next].focus();
      select(tabs[next]);
    });
  }

  function initMiniHeader(root: HTMLElement | Document) {
    const store = {
      get(k: string): string | null {
        try {
          return localStorage.getItem('cms-mh-' + k);
        } catch {
          return null;
        }
      },
      set(k: string, v: string) {
        try {
          localStorage.setItem('cms-mh-' + k, v);
        } catch {
          /* storage blocked: the choice just isn't remembered */
        }
      },
    };
    const scopeOf = (el: Element) => el.closest<HTMLElement>('[data-lp]') ?? document.documentElement;
    const editing = (el: Element) => !!el.closest('[data-mh-editing]');
    const setSize = (scope: HTMLElement, level: number) => {
      scope.dataset['mhLevel'] = String(level);
      scope.style.setProperty('zoom', level ? String(1 + level * 0.1) : '');
    };
    // Keeps the custom language menu (label, selected option) in step with its <select>.
    const syncLang = (sel: HTMLSelectElement) => {
      const box = sel.closest<HTMLElement>('.lp-mh-langbox');
      if (!box) return;
      const label = box.querySelector('[data-mh-lang-label]');
      if (label) label.textContent = sel.selectedOptions[0]?.textContent ?? '';
      box.querySelectorAll<HTMLElement>('[data-mh-lang-opt]').forEach((o) => {
        const on = o.dataset['value'] === sel.value;
        o.setAttribute('aria-selected', String(on));
        o.tabIndex = on ? 0 : -1;
      });
    };
    // A theme dot carries the accent (data-mh-theme) and optional page background / surface / text colours.
    const applyTheme = (scope: HTMLElement, dots: HTMLElement[], dot: HTMLElement) => {
      const vars: [string, string | undefined][] = [
        ['--lp-primary', dot.dataset['mhTheme']],
        ['--lp-bg', dot.dataset['mhBg']],
        ['--lp-surface', dot.dataset['mhSurface']],
        ['--lp-text', dot.dataset['mhText']],
      ];
      // The "site colours" dot: remove every override so the page looks exactly as designed.
      if (dot.hasAttribute('data-mh-reset')) {
        scope.querySelector(':scope > style[data-mh-theme-css]')?.remove();
        scope.classList.remove('lp-themed', 'lp-themed-dark');
        dots.forEach((d) => {
          d.classList.toggle('is-active', d === dot);
          d.setAttribute('aria-pressed', String(d === dot));
        });
        return;
      }
      // A stylesheet rule with !important (not inline style): the page host re-applies its own theme variables inline
      // and would otherwise win the race.
      if (!scope.dataset['mhScope']) scope.dataset['mhScope'] = 's' + Math.random().toString(36).slice(2, 8);
      let sheet = scope.querySelector<HTMLStyleElement>(':scope > style[data-mh-theme-css]');
      if (!sheet) {
        sheet = document.createElement('style');
        sheet.setAttribute('data-mh-theme-css', '');
        scope.appendChild(sheet);
      }
      const rules = vars.filter(([, v]) => v).map(([n, v]) => n + ': ' + String(v).replace(/[;{}<]/g, '') + ' !important;');
      const sel = '[data-mh-scope="' + scope.dataset['mhScope'] + '"]';
      sheet.textContent = sel + ' { ' + rules.join(' ') + ' }';
      // With a page background set, sections follow the theme (see .lp-themed in the mini header CSS).
      scope.classList.toggle('lp-themed', !!dot.dataset['mhBg']);
      const bg = dot.dataset['mhBg'] ?? '';
      scope.classList.toggle('lp-themed-dark', /^#?[0-9a-f]{6}$/i.test(bg) && hsl(bg)[2] < 30);
      dots.forEach((d) => {
        d.classList.toggle('is-active', d === dot);
        d.setAttribute('aria-pressed', String(d === dot));
      });
    };
    const hsl = (colour: string): [number, number, number] => {
      const m = /^#?([0-9a-f]{6})$/i.exec(colour.trim());
      if (!m) return [220, 70, 50];
      const n = parseInt(m[1], 16);
      const r = ((n >> 16) & 255) / 255;
      const g = ((n >> 8) & 255) / 255;
      const b = (n & 255) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      const d = max - min;
      let h = 0;
      if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return [Math.round((h * 60 + 360) % 360), Math.round((d ? d / (1 - Math.abs(2 * l - 1)) : 0) * 100), Math.round(l * 100)];
    };
    // First dot = the website's own colours (its template theme): selected by default, it leaves the page untouched,
    // and choosing it again undoes any other theme.
    const addSiteDot = (bar: HTMLElement, dots: HTMLElement[]) => {
      if (bar.hasAttribute('data-mh-nosite')) return;
      const scope = scopeOf(bar);
      if (!scope.dataset['mhSiteVars']) {
        const cs = getComputedStyle(scope);
        const v = (n: string) => cs.getPropertyValue(n).trim();
        scope.dataset['mhSiteVars'] = JSON.stringify([v('--lp-primary'), v('--lp-bg'), v('--lp-surface'), v('--lp-text')]);
      }
      if (bar.querySelector('[data-mh-reset]')) return;
      const [primary, bg, surface, text] = JSON.parse(scope.dataset['mhSiteVars']) as string[];
      const dot = dots[0].cloneNode(false) as HTMLElement;
      dot.className = 'lp-mh-dot';
      dot.setAttribute('aria-pressed', 'false');
      dot.setAttribute('aria-label', 'Site colours');
      dot.title = 'Site colours';
      dot.style.background = primary || '#2563eb';
      dot.style.boxShadow = 'inset 0 0 0 4px ' + (bg || '#ffffff');
      dot.dataset['mhTheme'] = primary;
      dot.dataset['mhBg'] = bg;
      dot.dataset['mhSurface'] = surface;
      dot.dataset['mhText'] = text;
      dot.setAttribute('data-mh-reset', '');
      dots[0].before(dot);
    };
    // Dots added before themes had page colours only carry an accent: derive a matching palette from it and add a Dark theme.
    const ensureThemes = (bar: HTMLElement) => {
      const dots = Array.from(bar.querySelectorAll<HTMLElement>('[data-mh-theme]:not([data-mh-reset])'));
      if (!dots.length) return;
      addSiteDot(bar, dots);
      if (dots.some((d) => d.dataset['mhBg'])) return;
      for (const d of dots) {
        const [h] = hsl(d.dataset['mhTheme'] ?? '');
        d.dataset['mhBg'] = 'hsl(' + h + ', 70%, 91%)';
        d.dataset['mhSurface'] = 'hsl(' + h + ', 70%, 97%)';
        d.dataset['mhText'] = 'hsl(' + h + ', 45%, 14%)';
      }
      const last = dots[dots.length - 1];
      const dark = last.cloneNode(false) as HTMLElement;
      dark.className = 'lp-mh-dot';
      dark.setAttribute('aria-pressed', 'false');
      dark.setAttribute('aria-label', 'Dark theme');
      dark.title = 'Dark';
      dark.style.background = '#111111';
      dark.dataset['mhTheme'] = '#f59e0b';
      dark.dataset['mhBg'] = '#0b0b0f';
      dark.dataset['mhSurface'] = '#17171f';
      dark.dataset['mhText'] = '#f3f4f6';
      last.after(dark);
    };
    const setReader = (scope: HTMLElement, on: boolean) => {
      scope.classList.toggle('lp-sr-mode', on);
      let live = scope.querySelector<HTMLElement>('[data-mh-live]');
      if (!live) {
        live = document.createElement('div');
        live.setAttribute('data-mh-live', '');
        live.setAttribute('role', 'status');
        live.setAttribute('aria-live', 'polite');
        live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
        scope.prepend(live);
      }
      live.textContent = on ? 'Screen reader access mode is on. Links are underlined and focus is highlighted.' : 'Screen reader access mode is off.';
      scope.querySelectorAll('[data-mh-reader]').forEach((l) => l.setAttribute('aria-pressed', String(on)));
    };
    const skipToMain = (scope: HTMLElement) => {
      const target =
        scope.querySelector<HTMLElement>('#main, [role="main"], main') ??
        // Skip the bars and the banner (header, navigation, hero / slider) and land on the first real content section.
        Array.from(scope.querySelectorAll<HTMLElement>('.lp-section')).find((x) => !/lp-sec-(mini-header|portal-header|navbar|page-header|hero|carousel)/.test(x.className)) ??
        Array.from(scope.querySelectorAll<HTMLElement>('.lp-section')).find((x) => !/lp-sec-(mini-header|portal-header|navbar)/.test(x.className));
      if (!target) return;
      // Leave room for a sticky / fixed bar (the navigation) so it doesn't cover the top of the content.
      let offset = 0;
      for (const sec of Array.from(scope.querySelectorAll<HTMLElement>('.lp-section'))) {
        const pos = getComputedStyle(sec).position;
        if ((pos === 'sticky' || pos === 'fixed') && sec !== target && !sec.contains(target)) offset += sec.offsetHeight;
      }
      target.style.scrollMarginTop = offset + 'px';
      target.setAttribute('tabindex', '-1');
      target.style.outline = 'none';
      target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
    };

    // Applies the remembered choices to the bars on the page, or the first theme by default (unless the bar says
    // data-mh-keep). Sections can render after init and re-render later, so this also runs whenever the DOM under
    // `root` changes; it only touches a bar once per state, so it never fights the visitor's own clicks.
    const themed = new Set<HTMLElement>();
    const restore = () => {
      const bars = Array.from(root.querySelectorAll<HTMLElement>('[data-mini-header]'));
      for (const bar of bars) {
        const scope = scopeOf(bar);
        const persist = !editing(bar);
        ensureThemes(bar);
        if (persist) {
          const level = Number(store.get('font') ?? 0);
          if (level !== Number(scope.dataset['mhLevel'] ?? 0)) setSize(scope, level);
        }
        const dots = Array.from(bar.querySelectorAll<HTMLElement>('[data-mh-theme]'));
        if (!dots.length) continue;
        if (bar.hasAttribute('data-mh-keep') && (!persist || store.get('themeIdx') === null)) {
          dots.forEach((d, i) => d.classList.toggle('is-active', i === (Number(bar.dataset['mhDefault'] ?? 0) || 0)));
          continue;
        }
        const saved = persist ? store.get('themeIdx') : null;
        const dot = saved !== null && dots[Number(saved)] ? dots[Number(saved)] : (dots[Number(bar.dataset['mhDefault'] ?? 0)] ?? dots[0]);
        // Re-render of the bar (new dot elements) or first time: apply; otherwise leave the visitor's choice alone.
        if (!themed.has(scope) || !dots.some((d) => d.classList.contains('is-active')) || scope.dataset['mhDots'] !== String(dots.length)) {
          applyTheme(scope, dots, dot);
          scope.dataset['mhDots'] = String(dots.length);
          themed.add(scope);
        }
      }
      // Language dropdown: show the remembered choice (and translate) once per dropdown.
      for (const sel of Array.from(root.querySelectorAll<HTMLSelectElement>('select[data-mh-lang]'))) {
        if (sel.dataset['mhLangInit']) continue;
        sel.dataset['mhLangInit'] = '1';
        const saved = store.get('lang');
        if (!editing(sel) && saved && Array.from(sel.options).some((o) => o.value === '#lang:' + saved)) {
          sel.value = '#lang:' + saved;
          if (saved !== (sel.options[0]?.value ?? '').replace('#lang:', '')) chooseLanguage(sel, false);
        }
        syncLang(sel);
        // Load the translator in the background once the page is idle, so choosing a language is instant.
        if (!editing(sel)) {
          const warmUp = () => void loadTranslator((sel.options[0]?.value ?? '#lang:en').replace('#lang:', '') || 'en', codesOf(sel));
          const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => void) | undefined;
          if (ric) ric(warmUp, { timeout: 2500 });
          else setTimeout(warmUp, 1200);
        }
      }
      // The bar was removed: drop the theme again.
      for (const scope of Array.from(themed)) {
        if (scope.querySelector('[data-mini-header]')) continue;
        scope.querySelector(':scope > style[data-mh-theme-css]')?.remove();
        scope.classList.remove('lp-themed', 'lp-themed-dark');
        delete scope.dataset['mhDots'];
        themed.delete(scope);
      }
    };

    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const bar = t.closest?.<HTMLElement>('[data-mini-header]');
      if (!bar) return;
      const scope = scopeOf(bar);
      const persist = !editing(bar);
      const menuBtn = t.closest<HTMLElement>('.lp-ph-toggle');
      if (menuBtn) {
        const open = bar.classList.toggle('is-menu-open');
        menuBtn.setAttribute('aria-expanded', String(open));
        return;
      }
      const font = t.closest<HTMLElement>('[data-mh-font]');
      if (font) {
        const step = Number(font.dataset['mhFont']);
        const level = step === 0 ? 0 : Math.max(-3, Math.min(5, Number(scope.dataset['mhLevel'] ?? 0) + step));
        setSize(scope, level);
        if (persist) store.set('font', String(level));
        return;
      }
      const theme = t.closest<HTMLElement>('[data-mh-theme]');
      if (theme) {
        ensureThemes(bar);
        const dots = Array.from(bar.querySelectorAll<HTMLElement>('[data-mh-theme]'));
        applyTheme(scope, dots, theme);
        if (persist) store.set('themeIdx', String(dots.indexOf(theme)));
        return;
      }
      const link = t.closest<HTMLAnchorElement>('a[href]');
      const href = link?.getAttribute('href') ?? '';
      if (href === '#main') {
        e.preventDefault();
        skipToMain(scope);
      } else if (href === '#screen-reader') {
        e.preventDefault();
        const on = !scope.classList.contains('lp-sr-mode');
        setReader(scope, on);
      }
    });
    // Page translation through Google's translate element. The script is loaded ahead of time (as soon as the language
    // menu is pointed at or focused, or right away when a language was chosen earlier) so picking a language is quick, and
    // the googtrans cookie is set first so the widget translates by itself when it finishes loading.
    const gt = window as any;
    let translator: Promise<void> | null = null;
    const loadTranslator = (pageLang: string, codes: string) => {
      translator ??= new Promise<void>((resolve) => {
        for (const href of ['https://translate.google.com', 'https://translate.googleapis.com', 'https://www.gstatic.com']) {
          if (document.head.querySelector('link[rel="preconnect"][href="' + href + '"]')) continue;
          const l = document.createElement('link');
          l.rel = 'preconnect';
          l.href = href;
          l.crossOrigin = '';
          document.head.appendChild(l);
        }
        const holder = document.createElement('div');
        holder.id = 'google_translate_element';
        holder.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden';
        document.body.appendChild(holder);
        gt.cmsGoogleTranslateInit = () => {
          new gt.google.translate.TranslateElement({ pageLanguage: pageLang, includedLanguages: codes, autoDisplay: false }, 'google_translate_element');
          resolve();
        };
        const script = document.createElement('script');
        script.src = 'https://translate.google.com/translate_a/element.js?cb=cmsGoogleTranslateInit';
        script.async = true;
        script.onerror = () => {
          translator = null;
          script.remove();
          holder.remove();
          resolve();
        };
        document.head.appendChild(script);
      });
      return translator;
    };
    const setTransCookie = (pageLang: string, code: string) => {
      const on = !!code && code !== pageLang;
      const value = 'googtrans=' + (on ? '/' + pageLang + '/' + code : '') + '; path=/' + (on ? '' : '; expires=Thu, 01 Jan 1970 00:00:00 GMT');
      document.cookie = value;
      const host = window.location.hostname;
      if (host.includes('.')) document.cookie = value + '; domain=' + host;
    };
    const isTranslated = () => /translated-(ltr|rtl)/.test(document.documentElement.className);
    const setBusy = (on: boolean) => {
      root.querySelectorAll('.lp-mh-langbox').forEach((x) => x.classList.toggle('is-translating', on));
    };
    const codesOf = (sel: HTMLSelectElement) =>
      Array.from(sel.options)
        .map((o) => o.value.replace('#lang:', ''))
        .filter((c) => c && !c.startsWith('/') && !c.startsWith('http') && !c.startsWith('#'))
        .join(',');
    const translate = (code: string, pageLang: string, codes: string) => {
      const toOriginal = code === pageLang;
      setTransCookie(pageLang, code);
      setBusy(true);
      void loadTranslator(pageLang, codes).then(() => {
        const waitFor = (tries: number) => {
          const combo = document.querySelector<HTMLSelectElement>('select.goog-te-combo');
          if (!combo) {
            if (tries < 160) setTimeout(() => waitFor(tries + 1), 50);
            else setBusy(false);
            return;
          }
          const run = () => {
            combo.value = toOriginal ? '' : code;
            combo.dispatchEvent(new Event('change'));
          };
          run();
          // Wait until the page really is (or is no longer) translated; nudge it once, and as a last resort for going back
          // to the original text reload the page without the cookie.
          let waited = 0;
          const timer = setInterval(() => {
            waited += 100;
            const done = toOriginal ? !isTranslated() : isTranslated();
            if (done) {
              clearInterval(timer);
              setBusy(false);
            } else if (waited === 2500) run();
            else if (waited >= 9000) {
              clearInterval(timer);
              setBusy(false);
              if (toOriginal) window.location.reload();
            }
          }, 100);
        };
        waitFor(0);
      });
    };
    const chooseLanguage = (sel: HTMLSelectElement, persist: boolean) => {
      const v = sel.value;
      if (v.startsWith('#lang:')) {
        const lang = v.slice(6);
        const pageLang = (sel.options[0]?.value ?? '#lang:en').replace('#lang:', '') || 'en';
        if (persist) store.set('lang', lang);
        translate(lang, pageLang, codesOf(sel));
      } else if (v) window.location.href = v;
    };
    // Warm the translator up before a language is picked.
    const warm = (e: Event) => {
      const sel = (e.target as HTMLElement).closest?.('.lp-mh-langbox')?.querySelector<HTMLSelectElement>('select[data-mh-lang]');
      if (sel && !editing(sel)) void loadTranslator((sel.options[0]?.value ?? '#lang:en').replace('#lang:', '') || 'en', codesOf(sel));
    };
    root.addEventListener('pointerover', warm);
    root.addEventListener('focusin', warm);
    root.addEventListener('change', (e) => {
      const sel = (e.target as HTMLElement).closest?.<HTMLSelectElement>('[data-mh-lang]');
      if (!sel || editing(sel)) return;
      chooseLanguage(sel, true);
    });

    // Custom language menu (a button + list instead of the browser's own dropdown); the hidden <select> stays the source of truth.
    const closeMenus = (except?: Element | null) => {
      for (const w of Array.from(root.querySelectorAll<HTMLElement>('.lp-mh-langbox.is-open'))) {
        if (w === except) continue;
        w.classList.remove('is-open');
        w.querySelector('[data-mh-lang-btn]')?.setAttribute('aria-expanded', 'false');
      }
    };
    // A click anywhere outside the page area (or outside the menu) closes it too.
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest?.('.lp-mh-langbox')) closeMenus();
    });
    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const box = t.closest?.<HTMLElement>('.lp-mh-langbox');
      if (!box) {
        closeMenus();
        return;
      }
      const sel = box.querySelector<HTMLSelectElement>('select[data-mh-lang]');
      if (t.closest('[data-mh-lang-btn]')) {
        closeMenus(box);
        const open = box.classList.toggle('is-open');
        box.querySelector('[data-mh-lang-btn]')?.setAttribute('aria-expanded', String(open));
        if (open) box.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
        return;
      }
      const opt = t.closest<HTMLElement>('[data-mh-lang-opt]');
      if (opt && sel) {
        sel.value = opt.dataset['value'] ?? '';
        syncLang(sel);
        closeMenus();
        box.querySelector<HTMLElement>('[data-mh-lang-btn]')?.focus();
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    root.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      const t = ev.target as HTMLElement;
      const box = t.closest?.<HTMLElement>('.lp-mh-langbox');
      if (!box) return;
      if (ev.key === 'Escape') {
        closeMenus();
        box.querySelector<HTMLElement>('[data-mh-lang-btn]')?.focus();
        return;
      }
      const opts = Array.from(box.querySelectorAll<HTMLElement>('[data-mh-lang-opt]'));
      if (t.closest('[data-mh-lang-btn]') && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        ev.preventDefault();
        box.classList.add('is-open');
        box.querySelector('[data-mh-lang-btn]')?.setAttribute('aria-expanded', 'true');
        (box.querySelector<HTMLElement>('[aria-selected="true"]') ?? opts[0])?.focus();
      } else if (t.matches('[data-mh-lang-opt]')) {
        const i = opts.indexOf(t);
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          opts[(i + 1) % opts.length].focus();
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          opts[(i - 1 + opts.length) % opts.length].focus();
        } else if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          t.click();
        }
      }
    });

    restore();
    if (typeof MutationObserver !== 'undefined') new MutationObserver(restore).observe(root instanceof Document ? root.documentElement : root, { childList: true, subtree: true });
  }

  function initAccessibility(root: HTMLElement | Document) {
    const KEY = 'cms-a11y3';
    type State = {
      size: number;
      spacing: number;
      line: number;
      links: boolean;
      reader: boolean;
      cursor: boolean;
      pause: boolean;
      filter: '' | 'mono' | 'sathigh' | 'satlow' | 'invert';
      dark: boolean;
      dyslexia: boolean;
      images: boolean;
      focus: boolean;
      guide: boolean;
      magnify: boolean;
      voice: boolean;
      profile: string;
    };
    const blank = (): State => ({ size: 0, spacing: 0, line: 0, links: false, reader: false, cursor: false, pause: false, filter: '', dark: false, dyslexia: false, images: false, focus: false, guide: false, magnify: false, voice: false, profile: '' });
    const load = (): State => {
      try {
        return { ...blank(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
      } catch {
        return blank();
      }
    };
    const save = (st: State) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(st));
      } catch {
        /* storage blocked: the choice just isn't remembered */
      }
    };
    let state = load();
    const scopeOf = (el: Element) => el.closest<HTMLElement>('[data-lp]') ?? document.documentElement;
    const editing = (el: Element) => !!el.closest('[data-a11y-editing]');
    const statusOf = (el: Element) => el.closest('[data-a11y]')?.querySelector<HTMLElement>('[data-a11y-status]');
    const ZOOM = [1, 1.1, 1.25, 1.4];
    const SPACING = [
      ['0.12em', '0.2em'],
      ['0.2em', '0.35em'],
    ];
    const LINE = [1.9, 2.3];
    const names: Record<string, string> = { size: 'Bigger text', spacing: 'Text spacing', line: 'Line height', links: 'Highlight links', reader: 'Screen reader', cursor: 'Cursor size', pause: 'Pause animation', mono: 'Monochrome', sathigh: 'High saturate', satlow: 'Low saturate', invert: 'Invert color', dark: 'Dark mode', dyslexia: 'Dyslexia friendly', images: 'Hide images', focus: 'Focus mode', guide: 'Reading guide', magnify: 'Text magnify', voice: 'Voice support' };
    const MAX = { size: ZOOM.length - 1, spacing: SPACING.length, line: LINE.length };
    // Profiles switch on a ready-made combination of tools (everything else is reset).
    const PROFILES: Record<string, Partial<State>> = {
      seizure: { pause: true, filter: 'satlow', links: true, size: 1, line: 1 },
      colorblind: { filter: 'mono', links: true },
      lowvision: { size: 2, line: 1, magnify: true, links: true },
      senior: { size: 2, line: 1, spacing: 1, cursor: true },
      blind: { reader: true, size: 3, links: true, dark: true },
      motion: { pause: true, focus: true, cursor: true },
      dyslexia: { dyslexia: true, spacing: 1, line: 1, guide: true },
      adhd: { focus: true, guide: true, pause: true, line: 1 },
    };
    const profileNames: Record<string, string> = { seizure: 'Seizure Safe', colorblind: 'Color Blindness', lowvision: 'Low Vision', senior: 'Senior Citizens', blind: 'Visually Impaired', motion: 'Motion Impairment', dyslexia: 'Dyslexia', adhd: 'Cognitive & ADHD' };

    // ----- helpers that create or remove page-level pieces -----
    let guideBar: HTMLElement | null = null;
    let magBox: HTMLElement | null = null;
    let recognition: any = null;
    let speakTimer: ReturnType<typeof setTimeout> | undefined;
    let voiceFailed = false;

    const speak = (text: string) => {
      const synth = (window as any).speechSynthesis as SpeechSynthesis | undefined;
      if (!synth || !text.trim()) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text.trim().slice(0, 400));
      u.lang = document.documentElement.lang || navigator.language || 'en';
      synth.speak(u);
    };
    const textOf = (el: Element | null) => {
      const t = el?.closest<HTMLElement>('h1,h2,h3,h4,h5,h6,p,li,a,button,label,td,th,figcaption,blockquote,dd,dt,summary,input,textarea,select');
      if (!t || t.closest('[data-a11y-panel-skip]')) return '';
      return (t.getAttribute('aria-label') || t.innerText || (t as HTMLInputElement).placeholder || '').replace(/\s+/g, ' ').trim();
    };
    const onReaderOver = (e: Event) => {
      if (!state.reader) return;
      const text = textOf(e.target as Element);
      clearTimeout(speakTimer);
      if (text) speakTimer = setTimeout(() => speak(text), 250);
    };
    const onGuideMove = (e: MouseEvent) => {
      if (guideBar) guideBar.style.top = e.clientY + 'px';
    };
    const onMagnifyMove = (e: MouseEvent) => {
      if (!magBox) return;
      const text = textOf(e.target as Element).slice(0, 220);
      magBox.style.display = text ? 'block' : 'none';
      if (!text) return;
      magBox.textContent = text;
      const x = Math.min(e.clientX + 18, window.innerWidth - magBox.offsetWidth - 12);
      const y = e.clientY + 24 + magBox.offsetHeight > window.innerHeight ? e.clientY - magBox.offsetHeight - 18 : e.clientY + 24;
      magBox.style.left = Math.max(8, x) + 'px';
      magBox.style.top = Math.max(8, y) + 'px';
    };
    const scrollBy = (dy: number) => window.scrollBy({ top: dy, behavior: state.pause ? 'auto' : 'smooth' });
    const sections = () => Array.from(document.querySelectorAll<HTMLElement>('.lp-section:not(.lp-sec-accessibility)'));
    const voiceCommand = (said: string) => {
      const t = said.toLowerCase().trim();
      if (/(scroll )?down/.test(t)) scrollBy(window.innerHeight * 0.8);
      else if (/(scroll )?up/.test(t)) scrollBy(-window.innerHeight * 0.8);
      else if (/top|beginning/.test(t)) window.scrollTo({ top: 0, behavior: 'smooth' });
      else if (/bottom|end/.test(t)) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      else if (/next/.test(t) || /previous|back/.test(t)) {
        const list = sections();
        const here = list.findIndex((x) => x.getBoundingClientRect().bottom > 80);
        const to = list[Math.max(0, Math.min(list.length - 1, here + (/next/.test(t) ? 1 : -1)))];
        to?.scrollIntoView({ behavior: 'smooth' });
      } else if (/stop|off/.test(t)) {
        state.voice = false;
        apply();
      }
    };
    const startVoice = (): boolean => {
      const Rec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!Rec) return false;
      recognition = new Rec();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = document.documentElement.lang || navigator.language || 'en-IN';
      recognition.onresult = (ev: any) => voiceCommand(String(ev.results[ev.results.length - 1][0].transcript));
      recognition.onend = () => {
        if (state.voice && recognition) {
          try {
            recognition.start();
          } catch {
            /* already running */
          }
        }
      };
      try {
        recognition.start();
      } catch {
        return false;
      }
      return true;
    };

    // ----- apply the state to every page on screen -----
    const bound = new WeakSet<Element>();
    function apply() {
      if (root.querySelector('[data-a11y]') && !document.getElementById('cms-a11y-font')) {
        const l = document.createElement('link');
        l.id = 'cms-a11y-font';
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans:wght@200;400;500;600;700&display=swap';
        document.head.appendChild(l);
      }
      const scopes = new Set<HTMLElement>();
      for (const w of Array.from(root.querySelectorAll<HTMLElement>('[data-a11y]'))) scopes.add(scopeOf(w));
      const live = Array.from(root.querySelectorAll<HTMLElement>('[data-a11y]')).filter((w) => !editing(w));
      for (const scope of scopes) {
        const on = live.some((w) => scopeOf(w) === scope);
        const c = scope.classList;
        c.toggle('lp-a11y-size', on && state.size > 0);
        scope.style.setProperty('--a11y-zoom', on && state.size > 0 ? String(ZOOM[state.size]) : '');
        c.toggle('lp-a11y-spacing', on && state.spacing > 0);
        if (on && state.spacing > 0) {
          scope.style.setProperty('--a11y-ls', SPACING[state.spacing - 1][0]);
          scope.style.setProperty('--a11y-ws', SPACING[state.spacing - 1][1]);
        }
        c.toggle('lp-a11y-line', on && state.line > 0);
        if (on && state.line > 0) scope.style.setProperty('--a11y-lh', String(LINE[state.line - 1]));
        c.toggle('lp-a11y-links', on && state.links);
        c.toggle('lp-a11y-cursor', on && state.cursor);
        c.toggle('lp-a11y-pause', on && state.pause);
        c.toggle('lp-a11y-dark', on && state.dark);
        c.toggle('lp-a11y-dyslexia', on && state.dyslexia);
        c.toggle('lp-a11y-images', on && state.images);
        c.toggle('lp-a11y-focus', on && state.focus);
        for (const f of ['mono', 'sathigh', 'satlow', 'invert']) c.toggle('lp-a11y-f-' + f, on && state.filter === f);
      }
      // Switches (aria-checked), levels and the active profile. Text is only written when it changed: this runs from a
      // MutationObserver, and a write is itself a mutation.
      for (const w of Array.from(root.querySelectorAll<HTMLElement>('[data-a11y]'))) {
        for (const b of Array.from(w.querySelectorAll<HTMLElement>('[data-a11y-tool]'))) {
          const k = b.dataset['a11yTool'] ?? '';
          const on = k === 'size' || k === 'spacing' || k === 'line' ? (state as any)[k] > 0 : ['mono', 'sathigh', 'satlow', 'invert'].includes(k) ? state.filter === k : !!(state as any)[k];
          b.setAttribute('aria-checked', String(on));
          b.setAttribute('aria-pressed', String(on));
        }
        for (const el of Array.from(w.querySelectorAll<HTMLElement>('[data-a11y-level]'))) {
          const label = String(Math.max(1, (state as any)[el.dataset['a11yLevel'] ?? ''] ?? 1));
          if (el.textContent !== label) el.textContent = label;
        }
        for (const pr of Array.from(w.querySelectorAll<HTMLElement>('[data-a11y-profile]'))) pr.setAttribute('aria-pressed', String(state.profile === pr.dataset['a11yProfile']));
      }
      // Page-level helpers
      if (state.guide && !guideBar) {
        guideBar = document.createElement('div');
        guideBar.className = 'lp-a11y-guide-bar';
        guideBar.style.top = '40%';
        document.body.appendChild(guideBar);
        document.addEventListener('mousemove', onGuideMove);
      } else if (!state.guide && guideBar) {
        guideBar.remove();
        guideBar = null;
        document.removeEventListener('mousemove', onGuideMove);
      }
      if (state.magnify && !magBox) {
        magBox = document.createElement('div');
        magBox.className = 'lp-a11y-mag';
        magBox.style.display = 'none';
        magBox.setAttribute('aria-hidden', 'true');
        document.body.appendChild(magBox);
        document.addEventListener('mousemove', onMagnifyMove);
      } else if (!state.magnify && magBox) {
        magBox.remove();
        magBox = null;
        document.removeEventListener('mousemove', onMagnifyMove);
      }
      if (!state.reader) (window as any).speechSynthesis?.cancel();
      if (state.voice && !recognition) {
        voiceFailed = false;
        if (!startVoice()) {
          state.voice = false;
          voiceFailed = true;
          for (const w of live) {
            const st = statusOf(w);
            if (st) st.textContent = 'Voice support is not available in this browser.';
          }
        }
      } else if (!state.voice && recognition) {
        const r = recognition;
        recognition = null;
        try {
          r.stop();
        } catch {
          /* not running */
        }
      }
      for (const w of Array.from(root.querySelectorAll<HTMLElement>('[data-a11y]'))) {
        const v = w.querySelector<HTMLElement>('[data-a11y-tool="voice"]');
        if (v) {
          v.setAttribute('aria-pressed', String(state.voice));
          v.setAttribute('aria-checked', String(state.voice));
        }
      }
      // Re-bind the reader events once (they are cheap and idempotent per document)
      if (!bound.has(document.documentElement)) {
        bound.add(document.documentElement);
        document.addEventListener('mouseover', onReaderOver);
        document.addEventListener('focusin', onReaderOver);
      }
    }

    const say = (el: Element, msg: string) => {
      const st = statusOf(el);
      if (st) st.textContent = msg;
    };

    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const widget = t.closest?.<HTMLElement>('[data-a11y]');
      if (!widget || editing(widget)) return;
      if (t.closest('[data-a11y-toggle]')) {
        const open = widget.classList.toggle('is-open');
        widget.querySelector('.lp-a11y-launch')?.setAttribute('aria-expanded', String(open));
        if (open) widget.querySelector<HTMLElement>('.lp-a11y-close')?.focus();
        else widget.querySelector<HTMLElement>('.lp-a11y-launch')?.focus();
        return;
      }
      if (t.closest('[data-a11y-reset]')) {
        state = blank();
        save(state);
        apply();
        say(widget, 'All accessibility settings were reset.');
        return;
      }
      const groupBtn = t.closest<HTMLElement>('[data-a11y-group-toggle]');
      if (groupBtn) {
        const collapsed = groupBtn.closest('[data-a11y-group]')?.classList.toggle('is-collapsed');
        groupBtn.setAttribute('aria-expanded', String(!collapsed));
        return;
      }
      const viewBtn = t.closest<HTMLElement>('[data-a11y-view]');
      if (viewBtn) {
        const grid = viewBtn.dataset['a11yView'] === 'grid';
        widget.classList.toggle('is-grid', grid);
        widget.querySelectorAll<HTMLElement>('[data-a11y-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === viewBtn)));
        const lab = widget.querySelector('[data-a11y-view-label]');
        if (lab) lab.textContent = grid ? 'Grid View' : 'List View';
        return;
      }
      const step = t.closest<HTMLElement>('[data-a11y-step]');
      if (step) {
        const key = step.dataset['a11yStep'] as 'size' | 'spacing' | 'line';
        state[key] = Math.max(1, Math.min(MAX[key], state[key] + Number(step.dataset['dir'] ?? 0)));
        state.profile = '';
        save(state);
        apply();
        say(widget, names[key] + ': level ' + state[key]);
        return;
      }
      const prof = t.closest<HTMLElement>('[data-a11y-profile]');
      if (prof) {
        const key = prof.dataset['a11yProfile'] ?? '';
        const turningOff = state.profile === key;
        state = turningOff ? blank() : { ...blank(), ...PROFILES[key], profile: key };
        save(state);
        apply();
        say(widget, (profileNames[key] ?? key) + ' profile: ' + (turningOff ? 'off' : 'on'));
        return;
      }
      const tool = t.closest<HTMLElement>('[data-a11y-tool]');
      if (!tool) return;
      const k = tool.dataset['a11yTool'] ?? '';
      state.profile = '';
      if (k === 'size' || k === 'spacing' || k === 'line') state[k] = state[k] > 0 ? 0 : 1;
      else if (k === 'mono' || k === 'sathigh' || k === 'satlow' || k === 'invert') state.filter = state.filter === k ? '' : k;
      else if (k in state) (state as any)[k] = !(state as any)[k];
      save(state);
      apply();
      const level = k === 'size' ? state.size : k === 'spacing' ? state.spacing : k === 'line' ? state.line : null;
      const on = tool.getAttribute('aria-pressed') === 'true';
      if (k === 'voice' && voiceFailed) return;
      say(widget, names[k] + (level !== null ? (level ? ': level ' + level : ': off') : on ? ': on' : ': off'));
      if (k === 'reader' && state.reader) speak('Screen reader is on. Point at or tab to any text to hear it.');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'F2' || !e.ctrlKey) return;
      const w = Array.from(root.querySelectorAll<HTMLElement>('[data-a11y]')).find((x) => !editing(x));
      if (!w) return;
      e.preventDefault();
      const open = w.classList.toggle('is-open');
      w.querySelector('.lp-a11y-launch')?.setAttribute('aria-expanded', String(open));
      (open ? w.querySelector<HTMLElement>('.lp-a11y-close') : w.querySelector<HTMLElement>('.lp-a11y-launch'))?.focus();
    });
    root.addEventListener('keydown', (e) => {
      const ev = e as KeyboardEvent;
      const widget = (ev.target as HTMLElement).closest?.<HTMLElement>('[data-a11y]');
      if (ev.key === 'Escape') {
        for (const w of Array.from(root.querySelectorAll<HTMLElement>('[data-a11y].is-open'))) {
          if (editing(w)) continue;
          w.classList.remove('is-open');
          w.querySelector('.lp-a11y-launch')?.setAttribute('aria-expanded', 'false');
          if (widget === w) w.querySelector<HTMLElement>('.lp-a11y-launch')?.focus();
        }
      }
    });
    // A click outside the open panel closes it.
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest?.('[data-a11y]')) return;
      for (const w of Array.from(root.querySelectorAll<HTMLElement>('[data-a11y].is-open'))) {
        if (editing(w)) continue;
        w.classList.remove('is-open');
        w.querySelector('.lp-a11y-launch')?.setAttribute('aria-expanded', 'false');
      }
    });

    // The section can be drawn after init and redrawn later: apply again whenever the page content changes.
    apply();
    if (typeof MutationObserver !== 'undefined') {
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          apply();
        });
      }).observe(root instanceof Document ? root.documentElement : root, { childList: true, subtree: true });
    }
  }

  return { initCarousels, initCarousel, initNav, initImageFallback, initAnimations, initForms, initBackToTop, initAccordions, initTabs, initMiniHeader, initAccessibility };
}
