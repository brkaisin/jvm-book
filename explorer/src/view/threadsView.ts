// Threads: one tower per platform thread, made of stack frames that come and
// go, coloured by how their method currently runs (interpreted, C1, C2).
// Carriers carry a mounted virtual thread; the others swarm in the scheduler
// queue or sit parked in the heap as stack chunks. At a safepoint, everything
// freezes over.

import * as THREE from 'three';
import type { JvmSim } from '../sim/jvm';
import type { Tier } from '../sim/jit';
import type { VirtualThread } from '../sim/threads';
import { HUMONGOUS_REGIONS, REGION_COUNT } from '../sim/heap';
import { C, Flow, approach, arc, edged, glowSprite, type Label, type Part, type Registry } from './fx';
import { HEAP_SIZE, LAYOUT, framePosition, regionCenter, towerBase } from './layout';

export const TIER_COLOR: Record<Tier, THREE.Color> = { 0: C.interp, 3: C.c1, 4: C.c2 };

const MAX_FRAMES = 16;
const MAX_VTHREADS = 220;

interface ShownFrame {
  id: number;
  method: number;
  /** 0..1 grow-in; shrinks back to 0 once popped. */
  s: number;
  popped: boolean;
}

export class ThreadsView implements Part {
  private readonly frames: THREE.InstancedMesh;
  private readonly frameOwner: { thread: number; depth: number }[] = [];
  private readonly shown: ShownFrame[][];
  private readonly pcLabels: Label[] = [];
  private readonly orbs: THREE.InstancedMesh;
  private readonly orbPos = new Map<number, THREE.Vector3>();
  private readonly allocFlows: Flow[] = [];
  private readonly frost: THREE.Sprite[] = [];
  private freeze = 0;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly reg: Registry,
    private readonly sim: JvmSim,
  ) {
    const threads = sim.threads.threads;
    this.shown = threads.map(() => []);

    this.frames = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.5, 2.6), new THREE.MeshBasicMaterial(), threads.length * MAX_FRAMES);
    this.frames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.frames.setColorAt(0, C.interp);
    this.frames.frustumCulled = false;
    scene.add(this.frames);
    this.reg.pick(this.frames, (i) => (i !== undefined && this.frameOwner[i] && threads[this.frameOwner[i].thread].kind === 'carrier' ? 'carriers' : 'frame'));

    threads.forEach((t, i) => {
      const base = towerBase(i);
      const carrier = t.kind === 'carrier';
      const nativeStack = edged(new THREE.CylinderGeometry(1.9, 2.2, LAYOUT.towerBase, 6), carrier ? '#d7b8ff' : '#b388ff', { body: '#120d22' });
      nativeStack.position.copy(base).setY(LAYOUT.towerBase / 2);
      this.reg.add(nativeStack, carrier ? 'carriers' : 'nativestack');
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, MAX_FRAMES * LAYOUT.framePitch, 6),
        new THREE.MeshBasicMaterial({ color: C.thread, transparent: true, opacity: 0.35 }),
      );
      rail.position.copy(base).setY(LAYOUT.towerBase + (MAX_FRAMES * LAYOUT.framePitch) / 2);
      rail.position.x -= 1.55;
      scene.add(rail);
      const frost = glowSprite(C.ice, 9, 0);
      frost.position.copy(base).setY(4);
      scene.add(frost);
      this.frost.push(frost);
      this.pcLabels.push(this.reg.label('', base.clone().setY(0), { id: 'pc', minor: true, cls: 'pc' }));
      this.reg.label(t.kind === 'carrier' ? `carrier ${t.name.slice(-1)}` : t.name, base.clone().setY(-0.6), {
        id: carrier ? 'carriers' : 'threads',
        minor: true,
        cls: 'tname',
      });

      // Allocation: every thread keeps creating objects in the heap.
      if (!carrier) {
        const f = new Flow(arc(base.clone().setY(3), new THREE.Vector3(base.x * 0.4, 0.8, LAYOUT.heap.z + HEAP_SIZE.d / 2 - 2), 3), {
          color: C.eden,
          count: 14,
          speed: 0.5,
          size: 0.6,
          jitter: 0.6,
        });
        scene.add(f.points);
        this.allocFlows.push(f);
      }
    });

    this.reg.anchor('threads', {
      center: new THREE.Vector3((LAYOUT.platformX[0] + LAYOUT.platformX[3]) / 2, 5, LAYOUT.threadZ),
      radius: 11,
      view: new THREE.Vector3(0.1, 0.35, 1),
    });
    this.reg.anchor('frame', () => ({ center: framePosition(0, this.sim.threads.threads[0].frames.length - 1), radius: 4, view: new THREE.Vector3(0.5, 0.3, 1) }));
    this.reg.anchor('pc', () => ({ center: framePosition(1, this.sim.threads.threads[1].frames.length), radius: 5, view: new THREE.Vector3(0.3, 0.2, 1) }));
    this.reg.anchor('carriers', {
      center: new THREE.Vector3((LAYOUT.carrierX[0] + LAYOUT.carrierX[1]) / 2, 5, LAYOUT.threadZ),
      radius: 8,
      view: new THREE.Vector3(0.2, 0.35, 1),
    });
    this.reg.anchor('vthreads', { center: LAYOUT.vqueue.clone().setY(7), radius: 13, view: new THREE.Vector3(0.3, 0.45, 1) });
    this.reg.label('Threads & stacks', new THREE.Vector3(LAYOUT.platformX[1] + 2.5, 11, LAYOUT.threadZ), { id: 'threads' });
    this.reg.label('Virtual threads', LAYOUT.vqueue.clone().setY(LAYOUT.vqueue.y + 3.5), { id: 'vthreads' });

    this.orbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.26, 12, 8),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      MAX_VTHREADS,
    );
    this.orbs.setColorAt(0, C.vthread);
    this.orbs.frustumCulled = false;
    scene.add(this.orbs);
    this.reg.pick(this.orbs, 'vthreads');
    const halo = glowSprite(C.thread, 16, 0.18);
    halo.position.copy(LAYOUT.vqueue);
    scene.add(halo);
  }

  update(dt: number, time: number): void {
    const safepoint = this.sim.safepoint;
    this.freeze = THREE.MathUtils.lerp(this.freeze, safepoint ? 1 : 0, 1 - Math.exp(-(safepoint ? 14 : 3) * dt));
    this.updateFrames(dt);
    this.updateOrbs(dt, time);
    for (const f of this.allocFlows) {
      f.opacity = 1 - this.freeze;
      if (!safepoint) f.update(dt);
    }
    for (const f of this.frost) (f.material as THREE.SpriteMaterial).opacity = this.freeze * 0.55;
  }

  private updateFrames(dt: number) {
    const threads = this.sim.threads.threads;
    const methods = this.sim.jit.methods;
    let n = 0;
    threads.forEach((t, ti) => {
      const shown = this.shown[ti];
      // Diff the real stack against what is on screen.
      const live = new Set(t.frames.map((f) => f.id));
      for (const f of shown) if (!live.has(f.id)) f.popped = true;
      const known = new Set(shown.map((f) => f.id));
      for (const f of t.frames) if (!known.has(f.id)) shown.push({ id: f.id, method: f.method, s: 0, popped: false });
      for (const f of shown) f.s = f.popped ? f.s - dt * 6 : Math.min(1, f.s + dt * 5);
      for (let i = shown.length - 1; i >= 0; i--) if (shown[i].popped && shown[i].s <= 0) shown.splice(i, 1);

      const top = shown.length - 1;
      shown.slice(0, MAX_FRAMES).forEach((f, depth) => {
        framePosition(ti, depth, this.p);
        this.p.y += (1 - f.s) * 1.2;
        this.col.copy(TIER_COLOR[methods[f.method].tier]).multiplyScalar(depth === top ? 1.6 : 0.8);
        this.col.lerp(C.ice, this.freeze * 0.75);
        this.m.compose(this.p, this.q, this.s.set(f.s, Math.max(0.01, f.s), f.s));
        this.frames.setMatrixAt(n, this.m);
        this.frames.setColorAt(n, this.col);
        this.frameOwner[n++] = { thread: ti, depth };
      });

      const pcLabel = this.pcLabels[ti];
      pcLabel.obj.position.copy(framePosition(ti, Math.min(shown.length, MAX_FRAMES), this.p)).setY(this.p.y + 0.8);
      const m = t.frames.length ? methods[t.frames[t.frames.length - 1].method] : null;
      pcLabel.el.querySelector('span')!.textContent = m ? `pc ${String(t.pc).padStart(2, '0')} · ${m.name}` : 'idle';
      pcLabel.el.classList.toggle('frozen', this.sim.safepoint);
    });
    this.frames.count = n;
    this.frames.instanceMatrix.needsUpdate = true;
    this.frames.instanceColor!.needsUpdate = true;
  }

  private orbTarget(v: VirtualThread, time: number, out: THREE.Vector3): THREE.Vector3 {
    switch (v.state) {
      case 'mounted': {
        const depth = Math.min(v.frames.length, MAX_FRAMES);
        return framePosition(v.carrier!, depth, out).setY(LAYOUT.towerBase + depth * LAYOUT.framePitch + 1);
      }
      case 'parked': {
        // A parked virtual thread's frames are stack chunks: plain heap objects.
        const free = REGION_COUNT - HUMONGOUS_REGIONS.length;
        let r = (v.id * 7) % free;
        for (const h of HUMONGOUS_REGIONS) if (r >= h) r++;
        regionCenter(r, out);
        return out.setY(1.3 + (v.id % 3) * 0.35);
      }
      default: {
        const a = v.id * 2.399 + time * 0.35;
        const r = 3.2 + (v.id % 5) * 0.55;
        return out.set(LAYOUT.vqueue.x + Math.cos(a) * r, LAYOUT.vqueue.y + Math.sin(time * 1.3 + v.id) * 0.8, LAYOUT.vqueue.z + Math.sin(a) * r);
      }
    }
  }

  private updateOrbs(dt: number, time: number) {
    const vts = this.sim.threads.vthreads;
    const alive = new Set<number>();
    let n = 0;
    for (const v of vts.slice(0, MAX_VTHREADS)) {
      alive.add(v.id);
      const target = this.orbTarget(v, time, this.p);
      let pos = this.orbPos.get(v.id);
      if (!pos) this.orbPos.set(v.id, (pos = LAYOUT.vqueue.clone()));
      if (!this.sim.safepoint) approach(pos, target, v.state === 'queued' ? 3 : 4.5, dt);
      const scale = v.state === 'mounted' ? 1.8 : v.state === 'parked' ? 0.8 : 1;
      this.m.compose(pos, this.q, this.s.setScalar(scale));
      this.orbs.setMatrixAt(n, this.m);
      this.col.copy(C.vthread).multiplyScalar(v.state === 'mounted' ? 1.8 : v.state === 'parked' ? 0.35 : 0.7);
      this.orbs.setColorAt(n++, this.col.lerp(C.ice, this.freeze * 0.6));
    }
    for (const id of this.orbPos.keys()) if (!alive.has(id)) this.orbPos.delete(id);
    this.orbs.count = n;
    this.orbs.instanceMatrix.needsUpdate = true;
    this.orbs.instanceColor!.needsUpdate = true;
  }
}
