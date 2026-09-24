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
import { byId, button } from './ui/dom';
import { Feed, Hud } from './ui/hud';
import { MapMenu } from './ui/map';
import { Panel } from './ui/panel';
import { Tour } from './ui/tour';
import { CameraRig } from './view/cameraRig';
import type { Anchor } from './view/fx';
import { LOADER_COLOR } from './view/loadingView';
import { World } from './world';

const EMBED = new URLSearchParams(location.search).has('embed');
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
      if (step.action) this.action(step.action);
    },
    () => document.body.classList.remove('touring'),
  );
  private readonly map = new MapMenu(byId('map'), (id) => this.select(id));
  private readonly hud: Hud;
  private readonly feed = new Feed(byId('feed'), (id) => this.select(id));

  /** Horizontal shift of the image, so the focus stays visible beside the panel. */
  private viewShift = 0;
  private time = 0;
  private uiTimer = 0;
  private labelsOn = true;
  private hovered: HotspotId | null = null;
  private down: { x: number; y: number; t: number } | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, EMBED ? 1.5 : 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    byId('stage').append(this.renderer.domElement);

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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.45, 0.78);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.world = new World(this.scene);
    this.world.reg.onLabelClick = (id) => this.select(id);
    this.hud = new Hud(byId('hud'), () => this.select('jfr'));
    this.wireFeed();
    this.wireInput();
    this.wireControls();

    this.rig.place(FAR);
    this.start();
    this.renderer.setAnimationLoop(() => this.frame());
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
    this.rig.autoOrbit = 0;
    if (flyHome) this.rig.flyTo(HOME, 3.2);
  }

  private startTour() {
    document.body.classList.add('touring');
    this.tour.start();
  }

  select(id: HotspotId, fromTour = false) {
    if (!fromTour && this.tour.active) this.tour.interrupt();
    this.world.onFocus(id);
    const anchor = this.world.reg.anchors.get(id)?.();
    if (anchor) this.rig.flyTo(anchor);
    this.panel.show(id);
    for (const l of this.world.reg.labels) l.el.classList.toggle('active', l.id === id);
    history.replaceState(null, '', `#${id}`);
  }

  private closePanel() {
    this.panel.hide();
    for (const l of this.world.reg.labels) l.el.classList.remove('active');
    history.replaceState(null, '', location.pathname + location.search);
  }

  private action(a: ActionId) {
    this.world.run(a);
    if (a === 'toggleGc') this.feed.push(`Collector switched to <b>${this.world.sim.collector}</b>`, '#c8f7ff', 'gc');
    if (a === 'spawnVthreads') this.feed.push(`Started <b>64</b> virtual threads`, '#d7b8ff', 'vthreads');
    this.panel.refresh();
    this.syncControls();
  }

  // ------------------------------------------------------------- wiring

  private wireFeed() {
    const s = this.world.sim;
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
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const id = this.pickAt(e, true);
      if (id) this.select(id);
    });
    el.addEventListener('pointermove', (e) => {
      if (EMBED || e.buttons || e.pointerType !== 'mouse') return;
      this.hover(this.pickAt(e, false), e);
    });
    el.addEventListener('pointerleave', () => this.hover(null));

    addEventListener('hashchange', () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!isHotspot(id) || id === this.panel.current) return;
      if (!document.body.classList.contains('entered')) this.enter(false);
      this.select(id);
    });

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
      this.labels.setSize(innerWidth, innerHeight);
    });

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const keys: Record<string, () => void> = {
        ArrowRight: () => this.tour.active && this.tour.next(),
        ArrowLeft: () => this.tour.active && this.tour.prev(),
        Escape: () => (this.tour.active ? this.tour.stop() : this.closePanel()),
        ' ': () => this.togglePause(),
        g: () => this.action('gcNow'),
        z: () => this.action('toggleGc'),
        l: () => this.toggleLabels(),
        h: () => this.rig.flyTo(HOME),
        m: () => this.map.toggle(),
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
    bar.replaceChildren(
      button('<b>☰</b> Map', () => this.map.toggle(), { title: 'All hotspots (M)', id: 'c-map' }),
      button('<b>✦</b> Tour', () => (this.tour.active ? this.tour.stop() : this.startTour()), { title: 'Guided tour (T)' }),
      button('<b>⌂</b>', () => this.rig.flyTo(HOME), { title: 'Overview (H)' }),
      button('<b>❚❚</b>', () => this.togglePause(), { title: 'Pause the JVM (Space)', id: 'c-pause' }),
      button('<b>♻</b> GC', () => this.action('gcNow'), { title: 'Collect garbage now (G)' }),
      button('G1', () => this.action('toggleGc'), { title: 'Switch between G1 and ZGC (Z)', id: 'c-gc' }),
      button('<b>Aa</b>', () => this.toggleLabels(), { title: 'Labels (L)', id: 'c-labels', class: 'on' }),
    );
  }

  private syncControls() {
    byId('c-gc').textContent = this.world.sim.collector;
    byId('c-pause').innerHTML = this.world.sim.paused ? '<b>▶</b>' : '<b>❚❚</b>';
    byId('c-labels').classList.toggle('on', this.labelsOn);
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

  private pickAt(e: PointerEvent, commit: boolean): HotspotId | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.world.reg.pickables, true)) {
      if (!hit.object.visible) continue;
      const id = this.world.reg.resolve(hit, commit);
      if (id) return id;
    }
    return null;
  }

  private hover(id: HotspotId | null, e?: PointerEvent) {
    const tip = byId('tip');
    this.hovered = id;
    document.body.style.cursor = id ? 'pointer' : '';
    tip.hidden = !id;
    if (!id || !e) return;
    tip.textContent = HOTSPOTS[id].title;
    tip.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 14}px)`;
  }

  // ------------------------------------------------------------- frame

  private frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.time += dt;
    this.world.update(dt, this.time);
    this.rig.update(dt);
    this.updateViewShift(dt);

    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.3;
      this.hud.update(this.world.sim.stats());
      this.panel.refresh();
      this.updateLabels();
    }
    this.updateBanner();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  /** Slides the image left (or up, on phones) so the focus is not hidden by the panel. */
  private updateViewShift(dt: number) {
    const panel = byId('panel');
    const open = !!this.panel.current;
    const wide = innerWidth > 800;
    const target = open ? (wide ? (panel.offsetWidth + 16) / 2 : (panel.offsetHeight + 16) / 2) : 0;
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
