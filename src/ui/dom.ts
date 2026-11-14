type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

/** Tiny hyperscript helper: h('button', { class: 'x', onclick: fn }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key in el && !key.startsWith('aria')) Reflect.set(el, key, value);
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

/**
 * Keyed list reconciliation. Existing elements are updated in place instead of being
 * rebuilt, so a button never disappears between mouse-down and mouse-up while data streams in.
 */
export function syncList<T>(
  container: HTMLElement,
  items: T[],
  key: (item: T) => string,
  create: (item: T) => HTMLElement,
  update: (el: HTMLElement, item: T) => void,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (child.dataset.key !== undefined) existing.set(child.dataset.key, child);
  }
  let cursor: Element | null = container.firstElementChild;
  for (const item of items) {
    const k = key(item);
    let el = existing.get(k);
    if (el) existing.delete(k);
    else {
      el = create(item);
      el.dataset.key = k;
    }
    update(el, item);
    if (el === cursor) cursor = cursor.nextElementSibling;
    else container.insertBefore(el, cursor);
  }
  existing.forEach((el) => el.remove());
}

/** Sets text only when it changed, to avoid needless DOM writes on every tick. */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
