import type { RecordedStep } from './recorded-step.types';

/** In-page script: forwards clicks, input, and scroll to the Node binding. */
export const RECORD_INIT_SCRIPT = `
(() => {
  if (window.__socmintRecorderInstalled) return;
  window.__socmintRecorderInstalled = true;

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
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

  function push(payload) {
    if (typeof window.socmintRecord === 'function') {
      window.socmintRecord(payload);
    }
  }

  document.addEventListener(
    'click',
    (e) => {
      const el = e.target && e.target.closest
        ? e.target.closest('a, button, input, textarea, select, [role="button"], [role="link"]')
        : null;
      if (!el) return;
      push({
        type: 'click',
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 200),
        href: el.tagName === 'A' ? el.href : null,
        selector: cssPath(el),
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

    const wirePage = (page: PlaywrightPage) => {
      page.on('framenavigated', (frame) => {
        if (frame.parentFrame() !== null) return;
        const url = frame.url();
        if (isInternalUrl(url)) return;
        if (url === this.lastNavigateUrl) return;
        this.lastNavigateUrl = url;
        this.push({ type: 'navigate', url, at: new Date().toISOString() });
      });
    };

    for (const page of context.pages()) wirePage(page);
    context.on('page', wirePage);
  }

  private push(step: RecordedStep): void {
    if (step.type === 'navigate' && step.url === this.lastNavigateUrl) return;
    if (step.type === 'scroll' && this.steps.length > 0) {
      const prev = this.steps[this.steps.length - 1];
      if (prev.type === 'scroll' && prev.direction === step.direction) return;
    }
    this.steps.push(step);
  }
}
