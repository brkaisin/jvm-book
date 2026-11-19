// A small menu above the control bar for the things you set once and forget:
// labels, sound, narrator, voice, and which collector runs. Keeping them out
// of the bar leaves it with the few buttons people actually reach for.

import { h } from './dom';

export class Settings {
  constructor(
    private readonly root: HTMLElement,
    /** The control bar: the menu sits above its right end, and clicks in it are not "outside". */
    private readonly bar: HTMLElement,
  ) {
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Settings');
    addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (this.open && !root.contains(t) && !bar.contains(t)) this.close();
    }, true); // capture: 3D labels stop their pointerdown from bubbling
  }

  get open(): boolean {
    return this.root.classList.contains('open');
  }

  mount(rows: HTMLElement[]): void {
    this.root.replaceChildren(h('div', { class: 'settings-title' }, 'Settings'), ...rows);
  }

  toggle(open = !this.open): void {
    if (open) {
      const r = this.bar.getBoundingClientRect();
      this.root.style.left = `${Math.max(8, r.right - this.root.offsetWidth)}px`;
      this.root.style.bottom = `${innerHeight - r.top + 8}px`;
    }
    this.root.classList.toggle('open', open);
    document.getElementById('c-settings')?.classList.toggle('on', open);
  }

  close(): void {
    this.toggle(false);
  }
}

/** A labelled row holding any control. */
export function settingRow(label: string, key: string | null, control: HTMLElement): HTMLElement {
  return h('div', { class: 'setting' }, h('span', {}, label, key ? h('kbd', {}, key) : null), control);
}

/** An on/off row: the whole row is the switch, and `.on` says its state. */
export function settingSwitch(label: string, key: string, id: string, onToggle: () => void): HTMLElement {
  const b = h(
    'button',
    { type: 'button', id, class: 'setting switch', role: 'switch', title: `${label} (${key})` },
    h('span', {}, label, h('kbd', {}, key)),
    h('i', { class: 'knob', 'aria-hidden': 'true' }),
  );
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggle();
  });
  return b;
}
