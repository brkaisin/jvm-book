// Entry point: renderer, post-processing, camera, picking, and the UI around
// the 3D world.

import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HOTSPOTS, type ActionId, type HotspotId } from './content';
import { KLASSES } from './sim/jvm';
import { byId, button, h } from './ui/dom';
import { Feed, Hud } from './ui/hud';
import { Legend } from './ui/legend';
import { MomentCard } from './ui/momentCard';
import { Story } from './story';
import { MapMenu } from './ui/map';
import { Panel } from './ui/panel';
import { Tour } from './ui/tour';
import { CameraRig } from './view/cameraRig';
import { sanitizePass } from './view/sanitizePass';
import { regionCenter } from './view/layout';
import type { Anchor } from './view/fx';
import { LOADER_COLOR } from './view/loadingView';
import { World } from './world';
import { Sound, type Cue } from './audio/sound';
import { Narrator } from './audio/narrator';
import { NarratorView } from './ui/narratorView';
import { CRASHES, LINES, hotspotLine, momentLine, sampleLine, tourLine } from './narration';
import { loadPref, loadText, savePref, saveText } from './ui/prefs';
import { AREAS } from './content';
import { LabPanel } from './ui/labPanel';
import { Settings, settingRow, settingSwitch } from './ui/settings';
import { declutter, type LabelBox } from './view/declutter';

const EMBED = new URLSearchParams(location.search).has('embed');
/** Automated browsers (the e2e tests) need a camera that stays where they put it. */
const STILL = navigator.webdriver || matchMedia('(prefers-reduced-motion: reduce)').matches;
/** After this long without input, the camera starts drifting slowly around what it looks at. */
const IDLE_SECONDS = 25;
/** "What just happened?" notes wait at least this long after the previous one. */
const MOMENT_GAP_SECONDS = 35;
const HOME: Anchor = { center: new THREE.Vector3(-8, 0, -2), radius: 62, view: new THREE.Vector3(0.3, 0.62, 1) };
const FAR: Anchor = { center: new THREE.Vector3(-10, 0, 0), radius: 150, view: new THREE.Vector3(-0.9, 0.5, 1) };
/** Minor labels only show up within this distance. */
const MINOR_LABEL_DISTANCE = 62;
const isHotspot = (id: string): id is HotspotId => id in HOTSPOTS;

class App {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 2500);
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly world: World;
  private readonly rig: CameraRig;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly timer = new THREE.Timer();
  private readonly tmp = new THREE.Vector3();

  private readonly panel = new Panel(byId('panel'), {
    action: (a) => this.action(a),
    close: () => this.closePanel(),
    live: (id) => this.world.live(id),
  });
  private readonly tour = new Tour(
    byId('tour'),
    (step) => {
      this.select(step.id, true);
      this.narrator.say(tourLine(step), `Tour · ${HOTSPOTS[step.id].title}`);
      if (step.action) this.action(step.action);
    },
    () => document.body.classList.remove('touring'),
  );
  private readonly map = new MapMenu(byId('map'), (id) => this.select(id));
  private readonly settings = new Settings(byId('settings'), byId('controls'));
  private readonly hud: Hud;
  private readonly feed = new Feed(byId('feed'), (id) => this.select(id));
  private readonly legend = new Legend(byId('legend'), (id) => {
    this.legend.close();
    this.select(id);
  });
  private story!: Story;
  private lab!: LabPanel;
  private readonly sound = new Sound(loadPref('sound', true));
  private readonly narratorView = new NarratorView(byId('narrator'));
  private readonly narrator = new Narrator(this.narratorView, loadPref('narrator', true), loadText('voice'));
  private readonly moments = new MomentCard(
    byId('moment'),
    (id) => this.select(id),
    (m) => {
      this.sound.play('moment');
      this.narrator.say(momentLine(m), `What just happened? ${m.title}`, 'background');
    },
  );

  /** Horizontal shift of the image, so the focus stays visible beside the panel. */
  private viewShift = 0;
  private time = 0;
  private uiTimer = 0;
  private labTimer = 0;
  private labelsOn = true;
  private hovered: HotspotId | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  /** Last time the visitor touched anything (performance.now() milliseconds). */
  private lastInput = performance.now();
  /** Measured label sizes; cleared now and then, as some labels change text. */
  private labelSize = new WeakMap<HTMLElement, { w: number; h: number }>();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, EMBED ? 1.5 : 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    byId('stage').append(this.renderer.domElement);
    // A soft vignette over the image (under the labels) draws the eye to the centre, at no GPU cost.
    byId('stage').append(h('div', { class: 'vignette', 'aria-hidden': 'true' }));

    this.labels.setSize(innerWidth, innerHeight);
    this.labels.domElement.className = 'labels';
    byId('stage').append(this.labels.domElement);

    this.scene.background = new THREE.Color('#03050b');
    this.scene.fog = new THREE.FogExp2('#03050b', 0.0038);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.scene.add(new THREE.HemisphereLight('#9ec1ff', '#07090f', 0.8));
    const sun = new THREE.DirectionalLight('#ffffff', 1.1);
    sun.position.set(40, 80, 30);
    this.scene.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxDistance = 320;
    this.controls.minDistance = 3;
    this.controls.zoomToCursor = true;
    this.rig = new CameraRig(this.camera, this.controls);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(sanitizePass());
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.world = new World(this.scene);
    this.world.reg.onLabelClick = (id) => this.select(id);
    this.hud = new Hud(byId('hud'), () => this.select('jfr'));
    this.wireFeed();
    // One explanation at a time: a note only shows up when nothing else is
    // being explained (no panel, tour or lab), and not right after another.
    this.story = new Story(
      this.world.sim,
      (moment) => this.moments.show(moment),
      () =>
        !EMBED &&
        document.body.classList.contains('entered') &&
        !this.tour.active &&
        !this.panel.current &&
        !this.lab.open &&
        !this.moments.busy &&
        this.moments.quietSeconds > MOMENT_GAP_SECONDS,
    );
    this.narratorView.bind({
      skip: () => this.narrator.skip(),
      stop: () => this.narrator.stop(),
      setVoice: (id) => {
        this.narrator.setVoice(id);
        saveText('voice', id);
        this.narrator.say(LINES.voiceSample, 'Voice');
      },
    });
    this.lab = new LabPanel(byId('lab'), this.world.lab, {
      started: (s) => this.narrator.say(s ? sampleLine(s) : LINES.labRunning, `Code Lab · ${s?.title ?? 'your code'}`),
      close: () => this.toggleLab(false),
    });
    this.wireLab();
    this.wireInput();
    this.wireControls();

    this.rig.place(FAR);
    this.start();
    this.renderer.setAnimationLoop(() => this.frame());
    // `?debug` exposes internals to automated tests (see test-e2e/).
    if (new URLSearchParams(location.search).has('debug'))
      Object.assign(window, {
        __jvm: {
          THREE,
          renderer: this.renderer,
          scene: this.scene,
          camera: this.camera,
          world: this.world,
          app: this,
          regionCenter,
          /** Screen pixel of a world point, for tests that click on things. */
          screenOf: (p: THREE.Vector3) => {
            const v = p.clone().project(this.camera);
            return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
          },
        },
      });
  }

  // ------------------------------------------------------------- flow

  private start() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (EMBED) {
      document.body.classList.add('embed');
      this.rig.place(HOME);
      this.rig.autoOrbit = 0.06;
      return;
    }
    if (isHotspot(hash)) {
      this.enter();
      this.select(hash);
      return;
    }
    this.rig.autoOrbit = 0.04;
    byId('enter').addEventListener('click', () => this.enter());
    byId('enter-tour').addEventListener('click', () => {
      this.enter(false);
      this.startTour();
    });
  }

  private enter(flyHome = true) {
    document.body.classList.add('entered');
    this.sound.unlock();
    this.rig.autoOrbit = 0;
    if (flyHome) this.rig.flyTo(HOME, 3.2);
    // After the tour has started (if any), so the welcome stays out of its way.
    queueMicrotask(() => this.story.tell('welcome'));
  }

  private startTour() {
    this.moments.dismiss();
    this.settings.close();
    document.body.classList.add('touring');
    this.tour.start();
  }

  select(id: HotspotId, fromTour = false) {
    if (!fromTour && this.tour.active) this.tour.interrupt();
    if (!fromTour && id !== this.panel.current) this.narrator.say(hotspotLine(id), HOTSPOTS[id].title);
    this.moments.dismiss();
    this.world.onFocus(id);
    const anchor = this.world.reg.anchors.get(id)?.();
    if (anchor) this.rig.flyTo(anchor);
    this.panel.show(id);
    for (const l of this.world.reg.labels) l.el.classList.toggle('active', l.id === id);
    history.replaceState(null, '', `#${id}`);
  }

  private toggleLab(open = !this.lab.open) {
    this.lab.toggle(open);
    document.body.classList.toggle('lab-open', open);
    if (!open) return;
    this.closePanel();
    this.map.close();
    this.moments.dismiss();
    if (this.tour.active) this.tour.stop();
    const anchor = this.world.reg.anchors.get('lab')?.();
    if (anchor) this.rig.flyTo(anchor);
  }

  private wireLab() {
    const lab = this.world.lab;
    const said = new Set<string>();
    lab.on('compiled', ({ method, tier }) => {
      const key = `${method}@${tier}`;
      if (said.has(key)) return;
      said.add(key);
      this.narrator.say(tier === 3 ? LINES.labWarm : LINES.labHot, `Code Lab · the JIT · ${method}`, 'background');
    });
    lab.on('crashed', (e) => {
      this.sound.play('deopt');
      this.feed.push(`<b>${e.name}</b> at line ${e.line} in your code`, '#ff3b3b', 'lab');
      this.narrator.say(CRASHES[e.name] ?? `${e.name}! ${e.message}`, 'Code Lab · your program crashed', 'background');
    });
    lab.on('state', (s) => {
      if (s !== 'finished') return;
      this.sound.play('gcDone');
      const vm = lab.vm;
      this.narrator.say(LINES.labFinished, 'Code Lab · finished', 'background');
      this.feed.push(`Your program finished: ${vm?.executed.toLocaleString('en')} instructions`, '#ffd166', 'lab');
    });
  }

  private closePanel() {
    this.panel.hide();
    for (const l of this.world.reg.labels) l.el.classList.remove('active');
    history.replaceState(null, '', location.pathname + location.search);
  }

  private action(a: ActionId) {
    if (a === 'openLab') return this.toggleLab(true);
    const fb = this.world.run(a);
    if (fb) {
      this.feed.push(fb.text, fb.color, fb.id);
      this.sound.play(fb.cue);
    }
    this.panel.refresh();
    this.syncControls();
  }

  /** Clicking a thing in the world: open it, and make it do its thing. */
  private poke(id: HotspotId, at: THREE.Vector3 | null) {
    const hs = HOTSPOTS[id];
    if (id !== this.panel.current) this.select(id);
    if (at) this.world.effects.ripple(at, AREAS[hs.area].color);
    this.sound.play('click');
    if (hs.poke) this.action(hs.poke.action);
  }

  // ------------------------------------------------------------- wiring

  private wireFeed() {
    const s = this.world.sim;
    const play = (cue: Cue) => () => this.sound.play(cue);
    s.jit.on('installed', (nm) => this.sound.play(nm.tier === 3 ? 'c1' : 'c2'));
    s.jit.on('deopt', play('deopt'));
    s.heap.on('gcStart', (e) => this.sound.play(e.collector === 'G1' ? 'gcFreeze' : 'gcConcurrent'));
    s.heap.on('gcEnd', play('gcDone'));
    s.on('classLoaded', play('load'));
    s.threads.on('mount', play('mount'));
    s.jit.on('installed', (nm) => {
      const m = s.jit.methods[nm.method];
      this.feed.push(`${nm.tier === 4 ? '<b>C2</b>' : 'C1'} compiled <code>${m.name}</code>`, nm.tier === 4 ? '#ff8a3d' : '#2ee6a6', nm.tier === 4 ? 'c2' : 'c1');
    });
    s.jit.on('deopt', ({ method }) => this.feed.push(`Deoptimized <code>${s.jit.methods[method].name}</code>`, '#ff3b3b', 'deopt'));
    s.heap.on('gcEnd', (e) => {
      const n = s.heap.gcCount - 1;
      const text =
        e.collector === 'G1'
          ? `GC(${n}) Pause ${e.kind === 'young' ? 'Young' : 'Young (Mixed)'} <b>${e.pauseMs} ms</b> · ${e.reclaimed} dead`
          : `GC(${n}) ${e.kind === 'young' ? 'Minor' : 'Major'} Collection (ZGC) · pauses <b>${e.pauseMs} ms</b>`;
      this.feed.push(text, '#c8f7ff', 'gc');
    });
    s.on('classLoaded', ({ klass }) => {
      const k = KLASSES[klass];
      this.feed.push(`Loaded <code>${k.name}</code> · ${k.loader}`, `#${LOADER_COLOR[k.loader].getHexString()}`, 'classloaders');
    });
  }

  private wireInput() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'])
      addEventListener(type, () => (this.lastInput = performance.now()), { passive: true });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const hit = this.pickAt(e, true);
      if (hit) this.poke(hit.id, hit.point);
    });
    el.addEventListener('pointermove', (e) => {
      if (EMBED || e.buttons || e.pointerType !== 'mouse') return;
      this.hover(this.pickAt(e, false)?.id ?? null, e);
    });
    el.addEventListener('pointerleave', () => this.hover(null));
    // Browsers only allow audio after a gesture (deep links skip the Enter button).
    addEventListener('pointerdown', () => this.sound.unlock(), { once: true });

    addEventListener('hashchange', () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!isHotspot(id) || id === this.panel.current) return;
      if (!document.body.classList.contains('entered')) this.enter(false);
      this.select(id);
    });

    // A lost GPU context (driver reset, too many tabs) would leave only the HTML
    // labels on screen: say so, and let three.js rebuild when it comes back.
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      document.body.classList.add('context-lost');
    });
    el.addEventListener('webglcontextrestored', () => document.body.classList.remove('context-lost'));

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
      this.labels.setSize(innerWidth, innerHeight);
    });

    addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const keys: Record<string, () => void> = {
        ArrowRight: () => this.tour.active && this.tour.next(),
        ArrowLeft: () => this.tour.active && this.tour.prev(),
        Escape: () => {
          this.legend.close();
          if (this.settings.open) return this.settings.close();
          if (this.lab.open) return this.toggleLab(false);
          if (this.tour.active) this.tour.stop();
          else this.closePanel();
        },
        ' ': () => this.togglePause(),
        g: () => this.action('gcNow'),
        z: () => this.action('toggleGc'),
        l: () => this.toggleLabels(),
        h: () => this.rig.flyTo(HOME),
        m: () => this.map.toggle(),
        k: () => this.legend.toggle(),
        s: () => this.toggleSound(),
        c: () => this.toggleLab(),
        n: () => this.toggleNarrator(),
        '?': () => this.legend.toggle(),
        t: () => (this.tour.active ? this.tour.stop() : this.startTour()),
      };
      const fn = keys[e.key];
      if (!fn || !document.body.classList.contains('entered')) return;
      e.preventDefault();
      fn();
    });
  }

  private wireControls() {
    const bar = byId('controls');
    const sep = () => h('span', { class: 'sep', 'aria-hidden': 'true' });
    // The essentials stay in the bar; preferences go in the settings menu.
    bar.replaceChildren(
      button('<b>☰</b> Map', () => this.map.toggle(), { title: 'All hotspots (M)', id: 'c-map' }),
      button('<b>↝</b> Tour', () => (this.tour.active ? this.tour.stop() : this.startTour()), { title: 'Guided tour (T)' }),
      button('<b>&lt;/&gt;</b> Code', () => this.toggleLab(), { title: 'Code Lab: run your own Java (C)', id: 'c-lab' }),
      sep(),
      button('<b>❚❚</b>', () => this.togglePause(), { title: 'Pause the JVM (Space)', id: 'c-pause', 'aria-label': 'Pause' }),
      button('<b>♻</b> GC', () => this.action('gcNow'), { title: 'Collect garbage now (G)' }),
      sep(),
      button('<b>⌂</b>', () => this.rig.flyTo(HOME), { title: 'Overview (H)', 'aria-label': 'Overview' }),
      button('<b>?</b>', () => this.legend.toggle(), { title: 'What the colours mean (K)', 'aria-label': 'Legend' }),
      button('<b>⚙</b>', () => this.settings.toggle(), { title: 'Settings', id: 'c-settings', 'aria-label': 'Settings' }),
    );
    this.settings.mount([
      settingRow('Garbage collector', 'Z', button('G1', () => this.action('toggleGc'), { id: 'c-gc', class: 'pill', title: 'Switch between G1 and ZGC (Z)' })),
      settingSwitch('Labels', 'L', 'c-labels', () => this.toggleLabels()),
      settingSwitch('Sound effects', 'S', 'c-sound', () => this.toggleSound()),
      settingSwitch('Narrator', 'N', 'c-narrator', () => this.toggleNarrator()),
      settingRow('Voice', null, this.narratorView.voicePicker),
    ]);
    this.syncControls();
  }

  private toggleSound() {
    this.sound.unlock();
    this.sound.setEnabled(!this.sound.enabled);
    savePref('sound', this.sound.enabled);
    this.syncControls();
  }

  private toggleNarrator() {
    this.narrator.setEnabled(!this.narrator.enabled);
    savePref('narrator', this.narrator.enabled);
    this.syncControls();
  }

  private syncControls() {
    byId('c-gc').textContent = this.world.sim.collector;
    byId('c-pause').innerHTML = this.world.sim.paused ? '<b>▶</b>' : '<b>❚❚</b>';
    byId('c-labels').classList.toggle('on', this.labelsOn);
    byId('c-sound').classList.toggle('on', this.sound.enabled);
    byId('c-narrator').classList.toggle('on', this.narrator.enabled);
    this.narratorView.voicePicker.disabled = !this.narrator.enabled;
    for (const id of ['c-labels', 'c-sound', 'c-narrator']) byId(id).setAttribute('aria-checked', String(byId(id).classList.contains('on')));
  }

  private togglePause() {
    this.world.sim.paused = !this.world.sim.paused;
    document.body.classList.toggle('paused', this.world.sim.paused);
    this.syncControls();
  }

  private toggleLabels() {
    this.labelsOn = !this.labelsOn;
    this.syncControls();
  }

  // ------------------------------------------------------------- picking

  private pickAt(e: PointerEvent, commit: boolean): { id: HotspotId; point: THREE.Vector3 } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.world.reg.pickables, true)) {
      if (!hit.object.visible) continue;
      const id = this.world.reg.resolve(hit, commit);
      if (id) return { id, point: hit.point };
    }
    return null;
  }

  private hover(id: HotspotId | null, e?: PointerEvent) {
    const tip = byId('tip');
    this.hovered = id;
    document.body.style.cursor = id ? 'pointer' : '';
    tip.hidden = !id;
    if (!id || !e) return;
    const hs = HOTSPOTS[id];
    const hint = hs.poke ? `Click: ${hs.poke.label.toLowerCase()}` : 'click to learn more';
    tip.replaceChildren(h('b', {}, hs.title), h('span', {}, hs.see), h('i', {}, hint));
    tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
  }

  // ------------------------------------------------------------- frame

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    this.world.update(dt, this.time);
    this.sound.setFrozen(this.world.sim.safepoint);
    this.updateDrift();
    this.rig.update(dt);
    this.updateViewShift(dt);

    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.3;
      this.hud.update(this.world.sim.stats());
      this.panel.refresh();
      this.updateLabels();
      this.labelSize = new WeakMap();
    }
    if (this.lab.open && (this.labTimer -= dt) <= 0) {
      this.labTimer = 0.1;
      this.lab.refresh();
    }
    this.updateBanner();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
    this.declutterLabels();
  }

  /** Once the visitor has been still for a while, slowly circle what the camera looks at. */
  private updateDrift() {
    if (EMBED || STILL || !document.body.classList.contains('entered')) return;
    const idle = (performance.now() - this.lastInput) / 1000;
    const busy = this.lab.open || this.rig.flying;
    this.rig.autoOrbit = busy ? 0 : 0.03 * THREE.MathUtils.smoothstep(idle, IDLE_SECONDS, IDLE_SECONDS + 6);
  }

  /** Fades out the labels that would overlap a more important one. */
  private declutterLabels() {
    const shown: { el: HTMLElement; box: LabelBox }[] = [];
    const cam = this.camera.position;
    for (const l of this.world.reg.labels) {
      if (!l.obj.visible || l.el.style.display === 'none') continue;
      let size = this.labelSize.get(l.el);
      if (!size) {
        size = { w: l.el.offsetWidth, h: l.el.offsetHeight };
        if (!size.w) continue;
        this.labelSize.set(l.el, size);
      }
      l.obj.getWorldPosition(this.tmp);
      const dist = this.tmp.distanceTo(cam);
      this.tmp.project(this.camera);
      const focus = l.id !== undefined && (l.id === this.panel.current || l.id === this.hovered);
      const rank = focus ? 1000 : l.el.classList.contains('title') ? 300 : l.minor ? 10 : 100;
      // A label already on screen gets a small edge, so neighbours do not flicker.
      const priority = rank + (l.el.classList.contains('hush') ? 0 : 25) - dist * 0.1;
      shown.push({
        el: l.el,
        box: { x: ((this.tmp.x + 1) / 2) * innerWidth, y: ((1 - this.tmp.y) / 2) * innerHeight, ...size, priority },
      });
    }
    const keep = declutter(shown.map((s) => s.box));
    shown.forEach((s, i) => s.el.classList.toggle('hush', !keep[i]));
  }

  /** Slides the image left (or up, on phones) so the focus is not hidden by the panel. */
  private updateViewShift(dt: number) {
    const panel = byId('panel');
    const open = !!this.panel.current;
    const wide = innerWidth > 800;
    const lab = this.lab.open && wide ? -(byId('lab').offsetWidth + 16) / 2 : 0;
    const target = lab || (open ? (wide ? (panel.offsetWidth + 16) / 2 : (panel.offsetHeight + 16) / 2) : 0);
    const next = THREE.MathUtils.lerp(this.viewShift, target, 1 - Math.exp(-6 * dt));
    if (Math.abs(next - this.viewShift) < 0.01 && Math.abs(next - target) < 0.5) return;
    this.viewShift = next;
    if (Math.abs(next) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(innerWidth, innerHeight, wide ? next : 0, wide ? 0 : next, innerWidth, innerHeight);
  }

  private updateLabels() {
    const cam = this.camera.position;
    for (const l of this.world.reg.labels) {
      l.obj.getWorldPosition(this.tmp);
      const d = this.tmp.distanceTo(cam);
      const show = this.labelsOn && (l.minor ? d < MINOR_LABEL_DISTANCE : d < 260);
      l.obj.visible = show || l.id === this.panel.current || l.id === this.hovered;
      l.el.style.opacity = l.minor ? String(Math.min(1, (MINOR_LABEL_DISTANCE - d) / 15 + 0.2)) : '';
    }
  }

  private updateBanner() {
    const s = this.world.sim;
    const banner = byId('banner');
    const stw = s.safepoint;
    const concurrent = s.heap.isCollecting && !stw;
    banner.className = stw ? 'stw' : concurrent ? 'concurrent' : s.paused ? 'paused' : '';
    banner.textContent = stw
      ? `⏸ Safepoint: stop-the-world ${s.collector === 'G1' ? 'young collection' : 'pause (tiny!)'}`
      : concurrent
        ? `↻ ${s.collector} collecting concurrently, threads keep running`
        : s.paused
          ? '❚❚ JVM paused'
          : '';
  }
}

function boot() {
  try {
    const probe = document.createElement('canvas');
    if (!probe.getContext('webgl2')) throw new Error('WebGL 2 is not available');
    new App();
  } catch (err) {
    console.error(err);
    document.body.classList.add('no-webgl');
  }
}

boot();
