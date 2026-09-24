// The Code Lab: write (or pick) a small Java program, then run it on the JVM
// and watch it execute: the bytecode listing follows the program counter, the
// current frame shows its locals and operand stack, and the 3D world shows the
// rest (its thread tower, its objects in the heap, the JIT compiling it).

import { SAMPLES, formatValue, type MethodInfo, type Sample } from '../lang';
import { TIER_SPEEDUP, methodLabel, type LabRunner, type LabState } from '../lab/labRunner';
import { escapeHtml, highlightJava } from '../lab/highlight';
import { button, h } from './dom';

const TIER_LABEL = { 0: 'interpreted', 3: 'C1 code', 4: 'C2 code' } as const;
const TIER_CLASS = { 0: 'interp', 3: 'c1', 4: 'c2' } as const;

/** Speeds the slider can pick, in bytecode instructions per second (interpreted). */
const SPEEDS = [2, 5, 10, 30, 100, 300, 1000, 3000, 10000];

/** Suggested speed per sample: slow enough to follow, fast enough not to bore. */
const SAMPLE_SPEED: Record<string, number> = { stack: 5, fib: 100, hot: 300, garbage: 3000, survivors: 3000, sort: 1000, overflow: 30, oops: 30 };

export interface LabPanelHandlers {
  /** A sample (or the user's code) starts running: e.g. narrate what to watch. */
  started(sample: Sample | null): void;
  close(): void;
}

export class LabPanel {
  private readonly editor: HTMLTextAreaElement;
  private readonly overlay = h('pre', { class: 'hl', 'aria-hidden': 'true' });
  private readonly gutter = h('div', { class: 'gutter', 'aria-hidden': 'true' });
  private readonly lineMark = h('div', { class: 'line-mark' });
  private readonly errorsEl = h('ul', { class: 'errors' });
  private readonly status = h('div', { class: 'lab-status' });
  private readonly bytecode = h('ol', { class: 'bytecode' });
  private readonly frameEl = h('div', { class: 'frame' });
  private readonly consoleEl = h('pre', { class: 'console' });
  private readonly watch = h('p', { class: 'watch' });
  private readonly runBtn: HTMLButtonElement;
  private readonly speedLabel = h('span', { class: 'speed-label' });
  private shownMethod: MethodInfo | null = null;
  private sample: Sample | null = null;
  private dirty = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly runner: LabRunner,
    private readonly on: LabPanelHandlers,
  ) {
    this.editor = h('textarea', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Java source code' });
    this.editor.addEventListener('input', () => {
      this.dirty = true;
      this.sample = null;
      this.renderSource();
    });
    this.editor.addEventListener('scroll', () => this.syncScroll());
    this.editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.run();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.editor.setRangeText('  ', this.editor.selectionStart, this.editor.selectionEnd, 'end');
        this.editor.dispatchEvent(new Event('input'));
      }
    });

    this.runBtn = button('▶ Run', () => (runner.state === 'running' ? runner.pause() : this.run()), { class: 'act primary', title: 'Run (Ctrl+Enter)' });
    const speed = h('input', { type: 'range', min: 0, max: SPEEDS.length - 1, step: 1, 'aria-label': 'Speed' });
    speed.addEventListener('input', () => this.setSpeed(SPEEDS[Number(speed.value)]));

    root.replaceChildren(
      h(
        'header',
        { class: 'lab-head' },
        h('div', {}, h('h2', {}, 'Code Lab'), h('p', {}, 'Write Java, compile it to bytecode, and watch it run on this JVM.')),
        button('✕', () => this.on.close(), { class: 'close', 'aria-label': 'Close the Code Lab' }),
      ),
      h('div', { class: 'samples' }, ...SAMPLES.map((s) => button(s.title, () => this.loadSample(s), { class: 'chip-btn', 'data-id': s.id }))),
      this.watch,
      h('div', { class: 'editor' }, this.gutter, h('div', { class: 'code' }, this.lineMark, this.overlay, this.editor)),
      this.errorsEl,
      h(
        'div',
        { class: 'toolbar' },
        this.runBtn,
        button(
          'Step',
          () => {
            runner.step();
            this.refresh();
          },
          { class: 'act', title: 'Run one bytecode instruction' },
        ),
        button('⟲ Reset', () => this.reset(), { class: 'act', title: 'Back to the start' }),
        h('label', { class: 'speed' }, speed, this.speedLabel),
      ),
      this.status,
      h(
        'div',
        { class: 'lab-grid' },
        h('section', {}, h('h3', {}, 'Bytecode'), this.bytecode),
        h('section', {}, h('h3', {}, 'Current frame'), this.frameEl),
      ),
      h('section', { class: 'out' }, h('h3', {}, 'Console'), this.consoleEl),
    );

    runner.on('print', (text) => {
      this.consoleEl.textContent += text;
      this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
    });
    runner.on('crashed', (e) => {
      this.consoleEl.innerHTML += `<span class="exc">Exception in thread "main" java.lang.${escapeHtml(e.name)}${e.message ? ': ' + escapeHtml(e.message) : ''}\n    at line ${e.line}</span>\n`;
    });
    runner.on('state', (s) => this.onState(s));

    this.loadSample(SAMPLES[0]);
    speed.value = String(SPEEDS.indexOf(this.runner.speed) >= 0 ? SPEEDS.indexOf(this.runner.speed) : 3);
  }

  get open(): boolean {
    return this.root.classList.contains('open');
  }

  toggle(force?: boolean): void {
    this.root.classList.toggle('open', force);
    if (this.open) this.editor.focus({ preventScroll: true });
  }

  loadSample(s: Sample): void {
    this.sample = s;
    this.editor.value = s.code;
    this.dirty = true;
    this.renderSource();
    this.watch.innerHTML = `<b>${escapeHtml(s.title)}.</b> ${escapeHtml(s.blurb)} <i>Watch: ${escapeHtml(s.watch)}</i>`;
    this.root.querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === s.id));
    const speed = SAMPLE_SPEED[s.id];
    if (speed) this.setSpeed(speed);
    this.compile();
  }

  /** Called a few times per second (and after each step) to follow the program. */
  refresh(): void {
    const vm = this.runner.vm;
    const cur = vm?.current ?? null;
    const tier = this.runner.currentTier();
    const effective = Math.round(this.runner.speed * TIER_SPEEDUP[tier]);
    const s = this.runner.state;
    this.status.innerHTML = [
      `<span class="state ${s}">${s}</span>`,
      cur ? `<b>${escapeHtml(methodLabel(cur.frame.method))}</b> <span class="k ${TIER_CLASS[tier]}">${TIER_LABEL[tier]}</span>` : '',
      vm ? `${vm.executed.toLocaleString('en')} instructions` : '',
      s === 'running' ? `${effective.toLocaleString('en')} /s` : '',
      `${this.runner.liveObjects} live objects`,
    ]
      .filter(Boolean)
      .join(' · ');

    if (cur && cur.frame.method !== this.shownMethod) this.renderBytecode(cur.frame.method);
    this.bytecode.querySelectorAll('.cur').forEach((e) => e.classList.remove('cur'));
    if (cur) {
      const row = this.bytecode.children[cur.frame.pc] as HTMLElement | undefined;
      row?.classList.add('cur');
      if (row) this.bytecode.scrollTop = row.offsetTop - this.bytecode.clientHeight / 2;
      this.markLine(cur.instr.line);
    } else this.markLine(0);
    this.renderFrame();
  }

  private run(): void {
    if (this.dirty && !this.compile()) return;
    if (this.runner.state === 'ready') this.on.started(this.sample);
    this.runner.run();
  }

  private reset(): void {
    this.consoleEl.textContent = '';
    this.runner.reset();
    this.refresh();
  }

  private compile(): boolean {
    this.dirty = false;
    this.consoleEl.textContent = '';
    const ok = this.runner.load(this.editor.value);
    this.errorsEl.replaceChildren(
      ...this.runner.errors.map((e) => {
        const li = h('li', {}, h('b', {}, `Line ${e.line}:`), ` ${e.message}`);
        li.addEventListener('click', () => this.goTo(e.line, e.col));
        return li;
      }),
    );
    this.shownMethod = null;
    this.bytecode.replaceChildren();
    if (ok && this.runner.program) this.renderBytecode(this.runner.program.methods[this.runner.program.main]);
    this.refresh();
    return ok;
  }

  private setSpeed(v: number): void {
    this.runner.speed = v;
    this.speedLabel.textContent = `${v.toLocaleString('en')} instr/s`;
    const input = this.root.querySelector<HTMLInputElement>('.speed input');
    const i = SPEEDS.indexOf(v);
    if (input && i >= 0) input.value = String(i);
  }

  private onState(s: LabState): void {
    this.runBtn.textContent = s === 'running' ? '❚❚ Pause' : s === 'paused' ? '▶ Resume' : '▶ Run';
    this.root.dataset.state = s;
    this.refresh();
  }

  // ------------------------------------------------------------- rendering

  private renderSource(): void {
    const src = this.editor.value;
    // The trailing newline keeps the overlay as tall as the textarea.
    this.overlay.innerHTML = highlightJava(src) + '\n';
    const lines = src.split('\n').length;
    this.gutter.innerHTML = Array.from({ length: lines }, (_, i) => `<span>${i + 1}</span>`).join('');
  }

  private syncScroll(): void {
    this.overlay.scrollTop = this.editor.scrollTop;
    this.overlay.scrollLeft = this.editor.scrollLeft;
    this.gutter.scrollTop = this.editor.scrollTop;
    this.lineMark.style.transform = `translateY(${-this.editor.scrollTop}px)`;
  }

  private markLine(line: number): void {
    this.lineMark.hidden = line <= 0;
    this.lineMark.style.top = `calc(${line - 1} * var(--lh) + var(--pad))`;
  }

  private goTo(line: number, col: number): void {
    const lines = this.editor.value.split('\n');
    const pos = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + Math.max(0, col - 1);
    this.editor.focus();
    this.editor.setSelectionRange(pos, pos);
  }

  private renderBytecode(m: MethodInfo): void {
    this.shownMethod = m;
    this.bytecode.replaceChildren(
      ...m.code.map((ins) => h('li', {}, h('span', { class: 'off' }, `${ins.offset}:`), h('span', { class: 'ins', html: escapeHtml(ins.text) }))),
    );
    this.bytecode.dataset.method = `${methodLabel(m)}${m.descriptor}`;
  }

  private renderFrame(): void {
    const frame = this.runner.vm?.current?.frame;
    if (!frame) {
      this.frameEl.innerHTML = '<p class="muted">No frame: run or step the program.</p>';
      return;
    }
    const locals = frame.locals.map(
      (v, i) => `<tr><td>${i}</td><td>${escapeHtml(frame.method.localNames[i] ?? '')}</td><td>${escapeHtml(v === undefined ? '·' : formatValue(v))}</td></tr>`,
    );
    const stack = [...frame.stack].reverse().map((v) => `<li>${escapeHtml(formatValue(v))}</li>`);
    this.frameEl.innerHTML = `
      <table class="locals"><thead><tr><th>#</th><th>local</th><th>value</th></tr></thead><tbody>${locals.join('')}</tbody></table>
      <div class="opstack"><div class="caption">operand stack</div><ol>${stack.join('') || '<li class="empty">empty</li>'}</ol></div>
      <div class="depth">${this.runner.vm!.frames.length} frame${this.runner.vm!.frames.length > 1 ? 's' : ''} deep</div>`;
  }
}
