// Glues the simulation to its views, and answers the UI's questions:
// "what is live about this hotspot right now?" and "do this action".

import * as THREE from 'three';
import type { ActionId, HotspotId } from './content';
import { formatBytes } from './format';
import { KLASSES, JvmSim } from './sim/jvm';
import type { Cue } from './audio/sound';
import { Effects } from './view/effects';
import { LabRunner } from './lab/labRunner';
import { C } from './view/fx';
import { LAYOUT, framePosition, towerBase } from './view/layout';
import { EngineView } from './view/engineView';
import { Registry, type Part } from './view/fx';
import { HeapView } from './view/heapView';
import { LoadingView } from './view/loadingView';
import { Scenery } from './view/scenery';
import { ThreadsView } from './view/threadsView';

const TIER_NAME = { 0: 'interpreted', 3: 'C1 (tier 3)', 4: 'C2 (tier 4)' } as const;

/** What an action did, for the event feed and the sound. */
export interface Feedback {
  text: string;
  color: string;
  id: HotspotId;
  cue: Cue;
}

const hex = (c: THREE.Color) => `#${c.getHexString()}`;

export class World {
  readonly sim: JvmSim;
  readonly reg: Registry;
  private readonly parts: Part[];
  private readonly heapView: HeapView;
  private readonly scenery: Scenery;
  readonly effects: Effects;
  readonly lab: LabRunner;

  constructor(readonly scene: THREE.Scene) {
    this.sim = new JvmSim();
    this.reg = new Registry(scene);
    this.lab = new LabRunner(this.sim);
    const loading = new LoadingView(scene, this.reg, this.sim);
    this.heapView = new HeapView(scene, this.reg, this.sim, (k) => loading.crystalPosition(k));
    this.scenery = new Scenery(scene, this.reg);
    this.effects = new Effects(scene);
    this.parts = [
      this.scenery,
      this.effects,
      loading,
      this.heapView,
      new ThreadsView(scene, this.reg, this.sim),
      new EngineView(scene, this.reg, this.sim),
    ];
  }

  update(dt: number, time: number): void {
    // Big frame gaps (a background tab) should not fast-forward the JVM.
    this.sim.step(Math.min(dt, 0.1));
    this.lab.update(Math.min(dt, 0.1));
    for (const p of this.parts) p.update(dt, time);
  }

  /** Top of thread `i`'s stack, where calls come from. */
  private threadTop(i: number): THREE.Vector3 {
    return framePosition(i, this.sim.threads.threads[i].frames.length).setY(LAYOUT.towerBase + this.sim.threads.threads[i].frames.length * LAYOUT.framePitch + 1);
  }

  /** Does `action` in the world, and says what happened. */
  run(action: ActionId): Feedback | null {
    const s = this.sim;
    switch (action) {
      case 'gcNow':
        s.heap.requestGc();
        return null; // the collection reports itself when it ends
      case 'toggleGc':
        s.collector = s.collector === 'G1' ? 'ZGC' : 'G1';
        return { text: `Collector switched to <b>${s.collector}</b>`, color: '#c8f7ff', id: 'gc', cue: 'toggle' };
      case 'spawnVthreads': {
        const n = s.threads.spawn(64);
        this.effects.burst(LAYOUT.vqueue.clone().setY(18), LAYOUT.vqueue, C.vthread, 8, { spread: 4 });
        return n
          ? { text: `Started <b>${n}</b> virtual threads`, color: hex(C.vthread), id: 'vthreads', cue: 'spawn' }
          : { text: 'Enough virtual threads for this little JVM!', color: hex(C.vthread), id: 'vthreads', cue: 'none' };
      }
      case 'hotMethod': {
        const m = s.jit.heatUp();
        return m
          ? { text: `<code>${m.name}</code> is hot: queued for ${m.compiling === 4 ? 'C2' : 'C1'}`, color: hex(C.c1), id: m.compiling === 4 ? 'c2' : 'c1', cue: 'call' }
          : { text: 'Every method is already compiled by C2', color: hex(C.c2), id: 'c2', cue: 'none' };
      }
      case 'deopt': {
        const m = s.jit.deoptimize() ?? null;
        if (m) return null; // the deopt reports itself
        s.jit.heatUp();
        return { text: 'No C2 code to break yet: heating a method up first', color: hex(C.c2), id: 'c2', cue: 'call' };
      }
      case 'allocBurst': {
        const n = s.allocateNow(150);
        for (const i of [0, 1, 2, 3]) this.effects.burst(this.threadTop(i), LAYOUT.heap, C.eden, 3, { spread: 6 });
        return { text: `Allocated <b>${n}</b> objects in Eden${n < 150 ? ' (heap full: allocation stall!)' : ''}`, color: hex(C.eden), id: 'eden', cue: 'alloc' };
      }
      case 'loadClass': {
        const k = s.loadClass();
        if (k === null) return { text: 'Every class of this program is loaded', color: hex(C.gold), id: 'metaspace', cue: 'none' };
        this.effects.chain([LAYOUT.source, LAYOUT.compiler, LAYOUT.classfile], '#cfe8ff', 0.4);
        return { text: `Loading <code>${KLASSES[k].name}</code>…`, color: hex(C.gold), id: 'classloaders', cue: 'load' };
      }
      case 'callDeeper': {
        s.threads.callDeeper(0, 6);
        this.effects.ripple(this.threadTop(0), C.thread, 6);
        return { text: 'Thread <code>main</code> calls 6 methods deeper', color: hex(C.thread), id: 'threads', cue: 'call' };
      }
      case 'nativeCall': {
        const lib = LAYOUT.nativeWorld.clone().add(new THREE.Vector3(0, 1.5, -3));
        this.effects.chain([this.threadTop(1), LAYOUT.portal, lib, LAYOUT.portal, this.threadTop(1)], C.native, 0.55);
        window.setTimeout(() => this.scenery.pulsePortal(), 550);
        return { text: 'Thread <code>http-nio-1</code> calls <code>SSL_read()</code> in libssl through FFM', color: hex(C.native), id: 'native', cue: 'native' };
      }
      case 'openLab':
        return null; // the UI opens the lab
      case 'jfrDump': {
        this.scenery.pulseJfr();
        const events = s.allocated + s.heap.gcCount * 120 + s.jit.methods.reduce((n, m) => n + (m.tier ? 3 : 0), 0);
        this.effects.burst(this.scenery.jfrPosition, towerBase(0).setY(12), '#ff6b6b', 4, { lift: 6, spread: 3 });
        return { text: `JFR.dump → <code>app.jfr</code>, ${events.toLocaleString('en')} events`, color: '#ff6b6b', id: 'jfr', cue: 'jfr' };
      }
    }
  }

  /** Focus hooks: some hotspots prepare the scene before the camera arrives. */
  onFocus(id: HotspotId): void {
    if (id !== 'object') this.heapView.select(null);
  }

  /** A few live numbers for the panel of hotspot `id`, as HTML rows. */
  live(id: HotspotId): [string, string][] | null {
    const s = this.sim;
    const st = s.stats();
    switch (id) {
      case 'heap':
      case 'eden':
      case 'survivor':
      case 'old':
      case 'humongous':
        return [
          ['Used', formatBytes(st.heapUsedBytes)],
          ['Regions', `${st.regions.eden} E · ${st.regions.survivor} S · ${st.regions.old} O · ${st.regions.humongous} H · ${st.regions.free} free`],
        ];
      case 'object': {
        // Opened before any object existed (a deep link): pick one as soon as we can.
        const o = this.heapView.selectedObject ?? this.heapView.selectAny();
        if (!o) return [['Tip', 'Click any small cube in the heap']];
        const k = KLASSES[o.klass];
        return [
          ['Class', k.name],
          ['Size', `${o.size} bytes (8-byte header)`],
          ['GC age', `${o.age}`],
          ['Region', `#${o.region} (${s.heap.regions[o.region].role})`],
          ['Reachable', s.heap.isDead(o) ? 'no: garbage' : 'yes'],
        ];
      }
      case 'gc':
        return [
          ['Collector', s.collector === 'G1' ? 'G1 (stop-the-world young GCs)' : 'ZGC (concurrent)'],
          ['Collections', `${st.gcCount}`],
          ['Last pause', st.lastPauseMs === null ? '–' : `${st.lastPauseMs} ms`],
          ['Now', s.heap.isCollecting ? `${s.heap.phase}${s.safepoint ? ' · world stopped' : ''}` : 'idle'],
        ];
      case 'metaspace':
      case 'classloaders':
        return [['Classes loaded', `${st.classesLoaded} / ${KLASSES.length}`]];
      case 'interpreter':
      case 'c1':
      case 'c2':
      case 'codecache':
      case 'deopt':
        return [
          ['Interpreted', `${s.jit.countTier(0)} methods`],
          ['C1 / C2', `${st.c1} / ${st.c2}`],
          ['Deopts', `${st.deopts}`],
          ['Hottest', s.jit.methods.reduce((a, b) => (b.invocations > a.invocations ? b : a)).name],
        ];
      case 'threads':
      case 'frame':
      case 'pc':
      case 'nativestack': {
        const t = s.threads.threads[0];
        const top = t.frames[t.frames.length - 1];
        const m = top ? s.jit.methods[top.method] : null;
        return [
          [`Thread "${t.name}"`, `${t.frames.length} frames deep`],
          ['Running', m ? `${m.name}, ${TIER_NAME[m.tier]}` : '–'],
        ];
      }
      case 'lab': {
        const vm = this.lab.vm;
        return [
          ['Program', this.lab.state],
          ['Frames', vm ? `${vm.frames.length}` : '–'],
          ['Objects alive', `${this.lab.liveObjects}`],
        ];
      }
      case 'vthreads':
      case 'carriers':
        return [
          ['Virtual threads', `${st.vthreads}`],
          ['Mounted / parked', `${st.vMounted} / ${st.vParked}`],
          ['Carriers', `${s.threads.carriers.length}`],
        ];
      default:
        return null;
    }
  }
}
