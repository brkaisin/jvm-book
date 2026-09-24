// The execution engine: the interpreter reading a ribbon of bytecode, the C1
// and C2 compilers, and the code cache where compiled methods land. Driven by
// the JIT simulation's events: compilations fly between the stations, and a
// failed speculation sends a red spark back to the interpreter.

import * as THREE from 'three';
import type { JvmSim } from '../sim/jvm';
import { SEGMENT_SLOTS, type NMethod, type Segment } from '../sim/jit';
import { C, Flow, Sparks, arc, edged, glowSprite, textTexture, type Part, type Registry } from './fx';
import { LAYOUT } from './layout';

const SEGMENTS: readonly Segment[] = ['nonNmethod', 'profiled', 'nonProfiled'];
const SEGMENT_LABEL: Record<Segment, string> = { nonNmethod: 'JVM stubs', profiled: 'profiled (C1)', nonProfiled: 'optimised (C2)' };
const SEGMENT_COLOR: Record<Segment, THREE.Color> = { nonNmethod: new THREE.Color('#8fa3bf'), profiled: C.c1, nonProfiled: C.c2 };
const CACHE_COLS = 10;
const TOTAL_SLOTS = SEGMENTS.reduce((n, s) => n + SEGMENT_SLOTS[s], 0);

const OPCODES =
  'aload_0  getfield #7  iload_1  iadd  invokevirtual #12  ifeq +14  new #3  dup  invokespecial #9  areturn  ldc "total"  dmul  invokedynamic #0  checkcast #5  ';

export class EngineView implements Part {
  private readonly ribbon: THREE.Mesh;
  private readonly c1: THREE.Group;
  private readonly c2: THREE.Group;
  private readonly c2Rings: THREE.Mesh[] = [];
  private readonly blocks: THREE.InstancedMesh;
  private readonly sparks: Sparks;
  private readonly flows: Flow[] = [];
  private readonly heat = { interp: 0, c1: 0, c2: 0 };
  private readonly installedAt = new Map<string, number>();

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
    this.sparks = new Sparks(scene);
    this.ribbon = this.buildInterpreter();
    this.c1 = this.buildC1();
    this.c2 = this.buildC2();
    this.blocks = this.buildCodeCache(scene);

    const flow = (curve: THREE.Curve<THREE.Vector3>, color: THREE.ColorRepresentation, o = {}) => {
      const f = new Flow(curve, { color, count: 26, speed: 0.12, size: 0.7, ...o });
      scene.add(f.points);
      this.flows.push(f);
    };
    // Compiled code is what the threads end up running.
    flow(arc(LAYOUT.codecache.clone().setY(2), new THREE.Vector3(LAYOUT.carrierX[1], 8, LAYOUT.threadZ), 14), C.c2, { opacity: 0.55 });
    flow(arc(LAYOUT.interpreter, new THREE.Vector3(LAYOUT.platformX[3], 8, LAYOUT.threadZ), 6), C.interp, { opacity: 0.55 });

    const jit = sim.jit;
    jit.on('compileStart', ({ tier }) => {
      const [from, to] = tier === 3 ? [LAYOUT.interpreter, LAYOUT.c1] : [LAYOUT.c1, LAYOUT.c2];
      this.heat[tier === 3 ? 'interp' : 'c1'] = 1;
      this.sparks.launch(from, to, {
        color: tier === 3 ? C.c1 : C.c2,
        duration: tier === 3 ? 0.9 : 1.4,
        lift: 5,
        onDone: () => (this.heat[tier === 3 ? 'c1' : 'c2'] = 1),
      });
    });
    jit.on('installed', (nm) => {
      this.sparks.launch(nm.tier === 3 ? LAYOUT.c1 : LAYOUT.c2, this.slotPosition(nm), { color: nm.tier === 3 ? C.c1 : C.c2, duration: 0.9, lift: 6, size: 1.6 });
      this.installedAt.set(`${nm.segment}:${nm.slot}`, performance.now() / 1000 + 0.9);
    });
    jit.on('deopt', () => {
      this.heat.c2 = -1;
      this.sparks.launch(LAYOUT.c2, LAYOUT.interpreter, { color: C.deopt, duration: 1.3, lift: 9, size: 3 });
    });
  }

  update(dt: number, time: number): void {
    const tex = (this.ribbon.material as THREE.MeshBasicMaterial).map!;
    tex.offset.x = (tex.offset.x + dt * 0.06) % 1;
    this.ribbon.rotation.y += dt * 0.25;

    for (const k of ['interp', 'c1', 'c2'] as const) this.heat[k] = THREE.MathUtils.lerp(this.heat[k], 0, 1 - Math.exp(-1.6 * dt));
    this.c1.rotation.y += dt * (0.4 + this.heat.c1 * 3);
    this.c1.rotation.x += dt * 0.2;
    this.c2.rotation.y -= dt * 0.15;
    this.c2Rings.forEach((r, i) => (r.rotation.z += dt * (0.5 + i * 0.3 + Math.abs(this.heat.c2) * 3) * (i % 2 ? -1 : 1)));
    const c2core = this.c2.userData.core as THREE.MeshStandardMaterial;
    c2core.emissive.copy(this.heat.c2 < -0.05 ? C.deopt : C.c2);
    c2core.emissiveIntensity = 1.2 + Math.abs(this.heat.c2) * 3 + Math.sin(time * 3) * 0.2;
    (this.c1.userData.core as THREE.MeshStandardMaterial).emissiveIntensity = 1 + this.heat.c1 * 3;

    this.sparks.update(dt);
    for (const f of this.flows) f.update(dt);
    this.updateBlocks(time);
  }

  // ------------------------------------------------------------- code cache

  private slotIndex(seg: Segment, slot: number): number {
    let base = 0;
    for (const s of SEGMENTS) {
      if (s === seg) return base + slot;
      base += SEGMENT_SLOTS[s];
    }
    throw new Error(`unknown segment ${seg}`);
  }

  private slotPosition(nm: Pick<NMethod, 'segment' | 'slot'>, out = new THREE.Vector3()): THREE.Vector3 {
    const i = this.slotIndex(nm.segment, nm.slot);
    const col = i % CACHE_COLS;
    const row = Math.floor(i / CACHE_COLS);
    return out.set(LAYOUT.codecache.x + (col - (CACHE_COLS - 1) / 2) * 1.3, 0.9, LAYOUT.codecache.z + (row - 2) * 1.5);
  }

  private updateBlocks(time: number) {
    const now = performance.now() / 1000;
    let n = 0;
    for (const seg of SEGMENTS)
      this.sim.jit.codeCache[seg].forEach((nm) => {
        if (!nm) return;
        this.slotPosition(nm, this.p);
        const landed = this.installedAt.get(`${seg}:${nm.slot}`) ?? 0;
        const age = now - landed;
        if (age < 0) return; // still flying in
        const pop = Math.min(1, age * 4);
        const height = seg === 'nonNmethod' ? 0.5 : 0.9 + (nm.tier === 4 ? 0.5 : 0);
        this.p.y = 0.3 + (height * pop) / 2;
        this.m.compose(this.p, this.q, this.s.set(1, Math.max(0.01, height * pop), 1));
        this.blocks.setMatrixAt(n, this.m);
        this.col.copy(SEGMENT_COLOR[seg]).multiplyScalar(seg === 'nonNmethod' ? 0.45 : 1.3 + Math.max(0, 1 - age) * 2);
        if (nm.notEntrant) this.col.lerp(C.deopt, 0.6).multiplyScalar(0.4 + 0.3 * Math.sin(time * 10));
        this.blocks.setColorAt(n++, this.col);
      });
    this.blocks.count = n;
    this.blocks.instanceMatrix.needsUpdate = true;
    this.blocks.instanceColor!.needsUpdate = true;
  }

  // ------------------------------------------------------------- build

  private buildInterpreter(): THREE.Mesh {
    const g = new THREE.Group();
    g.position.copy(LAYOUT.interpreter);
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.6, 2),
      new THREE.MeshStandardMaterial({ color: '#0b1430', emissive: C.interp, emissiveIntensity: 1.3, roughness: 0.3, flatShading: true }),
    );
    const tex = textTexture([OPCODES], { width: 4096, height: 96, fg: '#cfe0ff', font: '600 54px "JetBrains Mono", monospace', padding: 20, lineHeight: 60 });
    tex.wrapS = THREE.RepeatWrapping;
    const ribbon = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.6, 0.9, 96, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, color: '#9fc0ff' }),
    );
    const torus = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.07, 8, 96), new THREE.MeshBasicMaterial({ color: C.interp }));
    torus.rotation.x = Math.PI / 2;
    const torus2 = torus.clone();
    torus.position.y = 0.5;
    torus2.position.y = -0.5;
    g.add(core, ribbon, torus, torus2, glowSprite(C.interp, 8, 0.5));
    this.reg.add(g, 'interpreter', { view: new THREE.Vector3(0.2, 0.4, 1) });
    this.reg.label('Interpreter', LAYOUT.interpreter.clone().add(new THREE.Vector3(0, 3.4, 0)), { id: 'interpreter' });
    return ribbon;
  }

  private buildC1(): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(LAYOUT.c1);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 0), new THREE.MeshBasicMaterial({ color: C.c1, wireframe: true }));
    const coreMat = new THREE.MeshStandardMaterial({ color: '#06201a', emissive: C.c1, emissiveIntensity: 1, flatShading: true });
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), coreMat);
    g.add(shell, core, glowSprite(C.c1, 7, 0.45));
    g.userData.core = coreMat;
    this.reg.add(g, 'c1');
    this.reg.label('C1 · quick JIT', LAYOUT.c1.clone().add(new THREE.Vector3(0, 3.6, 0)), { id: 'c1' });
    return g;
  }

  private buildC2(): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(LAYOUT.c2);
    const coreMat = new THREE.MeshStandardMaterial({ color: '#2a1206', emissive: C.c2, emissiveIntensity: 1.4, flatShading: true, roughness: 0.2 });
    const core = new THREE.Mesh(new THREE.DodecahedronGeometry(2, 0), coreMat);
    g.add(core, glowSprite(C.c2, 11, 0.5));
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.3 + i * 0.7, 0.07, 8, 96), new THREE.MeshBasicMaterial({ color: C.c2, transparent: true, opacity: 0.8 }));
      ring.rotation.set(Math.PI / 2 + i * 0.7, i * 0.9, 0);
      g.add(ring);
      this.c2Rings.push(ring);
    }
    g.userData.core = coreMat;
    this.reg.add(g, 'c2');
    this.reg.label('C2 · optimising JIT', LAYOUT.c2.clone().add(new THREE.Vector3(0, 5.2, 0)), { id: 'c2' });
    // Deoptimisation has no station of its own: it is the way back from C2.
    this.reg.anchor('deopt', {
      center: LAYOUT.c2.clone().lerp(LAYOUT.interpreter, 0.5).setY(12),
      radius: 17,
      view: new THREE.Vector3(0.1, 0.5, 1),
    });
    this.reg.label('↩ Deoptimisation', LAYOUT.c2.clone().lerp(LAYOUT.interpreter, 0.5).setY(15), { id: 'deopt', minor: true });
    return g;
  }

  private buildCodeCache(scene: THREE.Scene): THREE.InstancedMesh {
    const rows = Math.ceil(TOTAL_SLOTS / CACHE_COLS);
    const vault = edged(new THREE.BoxGeometry(CACHE_COLS * 1.3 + 1.4, 0.5, rows * 1.5 + 1.2), '#ff8a3d', { body: '#110c08', edgeOpacity: 0.6 });
    vault.position.copy(LAYOUT.codecache).setY(0.05).add(new THREE.Vector3(0, 0, 0.75 * (rows - 5)));
    this.reg.add(vault, 'codecache', { view: new THREE.Vector3(0.1, 1, 0.8) });
    SEGMENTS.forEach((seg) => {
      const first = this.slotPosition({ segment: seg, slot: 0 });
      this.reg.label(SEGMENT_LABEL[seg], first.clone().add(new THREE.Vector3(-1.9, 0.2, 0)), { id: 'codecache', minor: true, cls: 'seg' });
    });
    this.reg.label('Code cache', LAYOUT.codecache.clone().add(new THREE.Vector3(0, 3.5, -4)), { id: 'codecache' });

    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 1, 1.2), new THREE.MeshBasicMaterial(), TOTAL_SLOTS);
    blocks.setColorAt(0, C.c1);
    blocks.frustumCulled = false;
    scene.add(blocks);
    this.reg.pick(blocks, 'codecache');
    return blocks;
  }
}
