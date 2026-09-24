// Glues the simulation to its views, and answers the UI's questions:
// "what is live about this hotspot right now?" and "do this action".

import * as THREE from 'three';
import type { ActionId, HotspotId } from './content';
import { formatBytes } from './format';
import { KLASSES, JvmSim } from './sim/jvm';
import { EngineView } from './view/engineView';
import { Registry, type Part } from './view/fx';
import { HeapView } from './view/heapView';
import { LoadingView } from './view/loadingView';
import { Scenery } from './view/scenery';
import { ThreadsView } from './view/threadsView';

const TIER_NAME = { 0: 'interpreted', 3: 'C1 (tier 3)', 4: 'C2 (tier 4)' } as const;

export class World {
  readonly sim: JvmSim;
  readonly reg: Registry;
  private readonly parts: Part[];
  private readonly heapView: HeapView;

  constructor(readonly scene: THREE.Scene) {
    this.sim = new JvmSim();
    this.reg = new Registry(scene);
    const loading = new LoadingView(scene, this.reg, this.sim);
    this.heapView = new HeapView(scene, this.reg, this.sim, (k) => loading.crystalPosition(k));
    this.parts = [
      new Scenery(scene, this.reg),
      loading,
      this.heapView,
      new ThreadsView(scene, this.reg, this.sim),
      new EngineView(scene, this.reg, this.sim),
    ];
  }

  update(dt: number, time: number): void {
    // Big frame gaps (a background tab) should not fast-forward the JVM.
    this.sim.step(Math.min(dt, 0.1));
    for (const p of this.parts) p.update(dt, time);
  }

  run(action: ActionId): void {
    const s = this.sim;
    switch (action) {
      case 'gcNow':
        s.heap.requestGc();
        break;
      case 'toggleGc':
        s.collector = s.collector === 'G1' ? 'ZGC' : 'G1';
        break;
      case 'spawnVthreads':
        s.threads.spawn(64);
        break;
      case 'hotMethod':
        s.jit.heatUp();
        break;
      case 'deopt':
        if (!s.jit.deoptimize()) s.jit.heatUp();
        break;
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
        const o = this.heapView.selectedObject;
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
