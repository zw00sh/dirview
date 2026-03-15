// Typed hyperscript helper for webview DOM construction.
// Standard DOM APIs only — no Node.js, no virtual DOM.

type Child = Node | string | number | null | undefined | false | Child[];

export interface HProps {
  className?: string;
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  innerHTML?: string;
  textContent?: string;
  title?: string;
  type?: string;
  placeholder?: string;
  value?: string;
  min?: string;
  max?: string;
  attr?: Record<string, string>;
  on?: { [E in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[E]) => void };
}

function isProps(x: unknown): x is HProps {
  return typeof x === 'object' && x !== null && !Array.isArray(x) && !(x instanceof Node);
}

function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue;
    if (Array.isArray(child)) { appendChildren(el, child); continue; }
    if (typeof child === 'string') { el.appendChild(document.createTextNode(child)); continue; }
    if (typeof child === 'number') { el.appendChild(document.createTextNode(String(child))); continue; }
    el.appendChild(child);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  propsOrChild?: HProps | Child,
  ...rest: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  let children: Child[];
  if (isProps(propsOrChild)) {
    const p = propsOrChild;
    if (p.className) el.className = p.className;
    if (p.innerHTML !== undefined) el.innerHTML = p.innerHTML;
    if (p.textContent !== undefined) el.textContent = p.textContent;
    if (p.title) el.title = p.title;
    if (p.dataset) for (const k in p.dataset) el.dataset[k] = p.dataset[k];
    if (p.style) for (const k in p.style) (el.style as any)[k] = p.style[k as keyof CSSStyleDeclaration];
    if (p.attr) for (const k in p.attr) el.setAttribute(k, p.attr[k]);
    if (p.type) (el as any).type = p.type;
    if (p.placeholder) (el as any).placeholder = p.placeholder;
    if (p.value !== undefined) (el as any).value = p.value;
    if (p.min) (el as any).min = p.min;
    if (p.max) (el as any).max = p.max;
    if (p.on) for (const ev in p.on) el.addEventListener(ev, (p.on as any)[ev]);
    children = rest;
  } else {
    children = propsOrChild !== undefined ? [propsOrChild, ...rest] : rest;
  }

  appendChildren(el, children);
  return el;
}
