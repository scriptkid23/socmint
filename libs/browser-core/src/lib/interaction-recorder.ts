import type { RecordedStep } from './recorded-step.types';

/** In-page script: forwards clicks, input, and scroll to the Node binding. */
export const RECORD_INIT_SCRIPT = `
(() => {
  if (window.__socmintRecorderInstalled) return;
  window.__socmintRecorderInstalled = true;

  function isStableId(id) {
    if (!id) return false;
    if (/^radix-/i.test(id)) return false;
    if (/^:r[0-9a-z]+:$/i.test(id)) return false;
    if (/-_r_[a-z0-9]+-/i.test(id)) return false;
    return true;
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id && isStableId(el.id)) return '#' + CSS.escape(el.id);
    const testId = el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
    const aria = el.getAttribute('aria-label');
    if (aria) return '[aria-label="' + CSS.escape(aria) + '"]';
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && isStableId(cur.id)) {
        parts.unshift('#' + CSS.escape(cur.id));
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function radixTriggerSuffix(id) {
    if (!id) return null;
    const m = id.match(/-trigger-(.+)$/i);
    return m ? m[1] : null;
  }

  function stableRadixTriggerSelector(el, suffix) {
    const role = el.getAttribute('role');
    if (role === 'tab') return '[role="tab"][id$="-trigger-' + suffix + '"]';
    const tag = el.tagName.toLowerCase() || 'button';
    return tag + '[id$="-trigger-' + suffix + '"]';
  }

  function buildClickSelector(el) {
    const suffix = radixTriggerSuffix(el.id);
    if (suffix) return stableRadixTriggerSelector(el, suffix);
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 200);
    const path = cssPath(el);
    if (text && el.id && !isStableId(el.id)) return 'text=' + text;
    if (text && /^#radix-/i.test(path)) return 'text=' + text;
    return path || (text ? 'text=' + text : '');
  }

  function push(payload) {
    if (typeof window.socmintRecord === 'function') {
      window.socmintRecord(payload);
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      const el = e.target && e.target.closest
        ? e.target.closest(
            'a, button, input, textarea, select, [role="button"], [role="link"], [role="tab"]',
          )
        : null;
      if (!el) return;
      push({
        type: 'click',
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 200),
        href: el.tagName === 'A' ? el.href : null,
        selector: buildClickSelector(el),
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT')) return;
      push({
        type: 'type',
        tag: el.tagName.toLowerCase(),
        text: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 120),
        selector: cssPath(el),
        value: String('value' in el ? el.value : '').slice(0, 500),
      });
    },
    true,
  );

  let lastScrollY = window.scrollY;
  window.addEventListener(
    'scroll',
    () => {
      const y = window.scrollY;
      const direction = y > lastScrollY ? 'down' : 'up';
      lastScrollY = y;
      push({ type: 'scroll', direction });
    },
    { passive: true },
  );
})();
`;

type PlaywrightContext = {
  exposeBinding(name: string, fn: (source: unknown, payload: Omit<RecordedStep, 'at'>) => void): Promise<void>;
  addInitScript(opts: { content: string }): Promise<void>;
  pages(): PlaywrightPage[];
  on(event: 'page', listener: (page: PlaywrightPage) => void): void;
};

type PlaywrightPage = {
  url(): string;
  evaluate(script: string): Promise<unknown>;
  mainFrame(): { url(): string };
  on(event: 'framenavigated', listener: (frame: { url(): string; parentFrame(): unknown }) => void): void;
};

function isInternalUrl(url: string): boolean {
  return url === 'about:blank' || url.startsWith('chrome://') || url.startsWith('devtools://');
}

export class InteractionRecorder {
  private readonly steps: RecordedStep[] = [];
  private lastNavigateUrl: string | null = null;

  getSteps(): RecordedStep[] {
    return [...this.steps];
  }

  async attach(rawContext: unknown): Promise<void> {
    const context = rawContext as PlaywrightContext;

    await context.exposeBinding('socmintRecord', (_source, payload) => {
      this.push({ ...payload, at: new Date().toISOString() } as RecordedStep);
    });
    await context.addInitScript({ content: RECORD_INIT_SCRIPT });

    const seedNavigate = (url: string) => {
      if (isInternalUrl(url)) return;
      this.push({ type: 'navigate', url, at: new Date().toISOString() });
    };

    const wirePage = (page: PlaywrightPage) => {
      page.on('framenavigated', (frame) => {
        if (frame.parentFrame() !== null) return;
        seedNavigate(frame.url());
      });
    };

    const activatePage = async (page: PlaywrightPage) => {
      wirePage(page);
      try {
        await page.evaluate(RECORD_INIT_SCRIPT);
      } catch {
        /* page may still be loading */
      }
      try {
        seedNavigate(page.url());
      } catch {
        /* ignore */
      }
    };

    for (const page of context.pages()) await activatePage(page);
    context.on('page', (page: PlaywrightPage) => {
      void activatePage(page);
    });
  }

  private push(step: RecordedStep): void {
    if (step.type === 'navigate') {
      if (step.url === this.lastNavigateUrl) return;
      this.lastNavigateUrl = step.url;
    }
    if (step.type === 'scroll' && this.steps.length > 0) {
      const prev = this.steps[this.steps.length - 1];
      if (prev.type === 'scroll' && prev.direction === step.direction) return;
    }
    this.steps.push(step);
  }
}
