import { h } from '../dom';

let sequence = 0;

/**
 * A "?" button and the explanation it reveals. Longer background text stays out of the way
 * until someone asks for it.
 */
export function helpToggle(label: string, ...content: (HTMLElement | string)[]): { button: HTMLButtonElement; content: HTMLElement } {
  const id = `help-${++sequence}`;
  const panel = h('div', { class: 'help-content', id, hidden: true }, ...content);
  const button = h(
    'button',
    {
      class: 'help-button',
      type: 'button',
      'aria-label': label,
      'aria-expanded': 'false',
      'aria-controls': id,
      title: label,
      onclick: (event: Event) => {
        event.stopPropagation();
        panel.hidden = !panel.hidden;
        button.setAttribute('aria-expanded', String(!panel.hidden));
      },
    },
    '?',
  );
  return { button, content: panel };
}
