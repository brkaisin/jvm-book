// The heap as G1 sees it: a grid of regions whose roles change as the program
// runs, thousands of small objects, and a garbage-collector drone that sweeps
// the collection set, reclaims the dead and flies the survivors out.

import * as THREE from 'three';
import type { HotspotId } from '../content';
import { HUMONGOUS_REGIONS, REGION_COUNT, REGION_SLOTS, type HeapObject, type RegionRole } from '../sim/heap';
import type { JvmSim } from '../sim/jvm';
import { C, commitInstances, edged, easeInOut, glowSprite, type Anchor, type Part, type Registry } from './fx';
import { HEAP_SIZE, LAYOUT, regionCenter, slotPosition } from './layout';

export const ROLE_COLOR: Record<RegionRole, THREE.Color> = {
  free: C.free,
  eden: C.eden,
  survivor: C.survivor,
  old: C.old,
  humongous: C.humongous,
};

export const ROLE_HOTSPOT: Record<RegionRole, HotspotId> = {
  free: 'heap',
  eden: 'eden',
  survivor: 'survivor',
  old: 'old',
  humongous: 'humongous',
};

const MAX_OBJECTS = REGION_COUNT * REGION_SLOTS;
const GC_COLOR = new THREE.Color('#c8f7ff');

export class HeapView implements Part {
  private readonly tiles: THREE.InstancedMesh;
  private readonly objects: THREE.InstancedMesh;
  /** Instance index -> heap object, rebuilt every frame. */
  private readonly instanceObj: (HeapObject | null)[] = new Array(MAX_OBJECTS).fill(null);
  private readonly drone = new THREE.Group();
  private readonly droneRing: THREE.Mesh;
  private readonly sweep: THREE.Mesh;
  private readonly beam: THREE.Line;
  private readonly marker: THREE.Sprite;
  private selected: HeapObject | null = null;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly reg: Registry,
    private readonly sim: JvmSim,
    /** Where class `k`'s metadata lives, to draw the klass pointer. */
    private readonly klassPosition: (k: number) => THREE.Vector3,
  ) {
    const base = edged(new THREE.BoxGeometry(HEAP_SIZE.w + 1.6, 0.5, HEAP_SIZE.d + 1.6), '#4cc9f0', { body: '#070c16', edgeOpacity: 0.5 });
    base.position.copy(LAYOUT.heap).setY(-0.2);
    scene.add(base);

    const t = LAYOUT.regionTile;
    this.tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(t, 0.18, t), new THREE.MeshBasicMaterial(), REGION_COUNT);
    for (let i = 0; i < REGION_COUNT; i++) {
      this.m.makeTranslation(regionCenter(i, this.p).setY(0.1));
      this.tiles.setMatrixAt(i, this.m);
      this.tiles.setColorAt(i, C.free);
    }
    scene.add(this.tiles);
    this.reg.pick(this.tiles, (i) => (i === undefined ? 'heap' : ROLE_HOTSPOT[this.sim.heap.regions[i].role]));

    this.objects = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.4, 0.46), new THREE.MeshBasicMaterial(), MAX_OBJECTS);
    this.objects.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.objects.setColorAt(0, C.eden);
    this.objects.frustumCulled = false;
    scene.add(this.objects);
    this.reg.pick(this.objects, (i, commit) => {
      const o = i === undefined ? null : this.instanceObj[i];
      if (!o) return 'heap';
      if (commit) this.select(o);
      return 'object';
    });

    scene.add(this.buildHumongous());
    this.droneRing = this.buildDrone();
    this.sweep = this.buildSweep(scene);

    this.beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 }),
    );
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.marker = glowSprite('#ffffff', 2.2, 0.95);
    this.marker.visible = false;
    scene.add(this.beam, this.marker);

    this.registerAnchors();
    this.reg.label('Heap', new THREE.Vector3(LAYOUT.heap.x, 5, LAYOUT.heap.z - HEAP_SIZE.d / 2), { id: 'heap' });
    const legend = this.reg.label('', new THREE.Vector3(LAYOUT.heap.x, 0.4, LAYOUT.heap.z + HEAP_SIZE.d / 2 + 1.6), {
      area: 'memory',
      cls: 'legend',
    });
    legend.el.innerHTML = (['eden', 'survivor', 'old', 'humongous'] as const)
      .map((r) => `<button data-id="${r}" style="--c:#${ROLE_COLOR[r].getHexString()}">${r[0].toUpperCase() + r.slice(1)}</button>`)
      .join('');
    legend.el.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.reg.onLabelClick(b.dataset.id as HotspotId);
      }),
    );
  }

  get selectedObject(): HeapObject | null {
    return this.selected;
  }

  select(o: HeapObject | null) {
    this.selected = o;
  }

  /** Picks some live young object to show off (used by the tour). */
  selectAny(): HeapObject | null {
    const h = this.sim.heap;
    let best: HeapObject | null = null;
    for (const o of h.objects()) {
      if (h.isDead(o) || h.cset.has(o.region)) continue;
      if (!best || o.bornAt > best.bornAt) best = o;
    }
    this.select(best);
    return best;
  }

  update(dt: number, time: number): void {
    const h = this.sim.heap;
    const collecting = h.isCollecting;
    const marking = h.phase === 'mark';
    const sweepX = LAYOUT.heap.x - HEAP_SIZE.w / 2 + h.phaseProgress * HEAP_SIZE.w;
    const pulse = 0.5 + 0.5 * Math.sin(time * 8);

    // Region tiles
    h.regions.forEach((r, i) => {
      const inCset = h.cset.has(i);
      this.col.copy(ROLE_COLOR[r.role]).multiplyScalar(r.role === 'free' ? 1 : 0.32);
      if (inCset) this.col.lerp(GC_COLOR, 0.25 + 0.2 * pulse);
      this.tiles.setColorAt(i, this.col);
    });
    this.tiles.instanceColor!.needsUpdate = true;

    // Objects
    let n = 0;
    const evac = easeInOut(h.phase === 'evacuate' ? h.phaseProgress : 0);
    for (const o of h.objects()) {
      const dead = h.isDead(o);
      const role = h.regions[o.region].role;
      let scale = Math.min(1, (h.now - o.bornAt) / 0.25);
      slotPosition(o.region, o.slot, this.p);
      if (o.movedFrom && h.phase === 'evacuate') {
        slotPosition(o.movedFrom.region, o.movedFrom.slot, this.p2);
        this.p2.lerp(this.p, evac);
        this.p2.y += Math.sin(evac * Math.PI) * 5;
        this.p.copy(this.p2);
      }
      this.col.copy(dead ? C.dead : ROLE_COLOR[o.movedFrom && evac < 0.5 ? h.regions[o.movedFrom.region].role : role]);
      if (!dead) this.col.multiplyScalar(0.95);
      if (marking && h.cset.has(o.region) && this.p.x < sweepX) {
        if (dead) scale *= Math.max(0, 1 - (sweepX - this.p.x) / 4);
        else this.col.lerp(GC_COLOR, 0.6).multiplyScalar(1.2);
      }
      if (o === this.selected) this.col.set('#ffffff').multiplyScalar(1.6);
      this.m.compose(this.p, this.q, this.s.setScalar(scale));
      this.objects.setMatrixAt(n, this.m);
      this.objects.setColorAt(n, this.col);
      this.instanceObj[n++] = o;
    }
    commitInstances(this.objects, n);

    this.updateDrone(dt, time, collecting, marking, sweepX);
    this.updateSelection(time);
  }

  private updateDrone(dt: number, time: number, collecting: boolean, marking: boolean, sweepX: number) {
    const target = this.p2;
    if (!collecting) target.copy(LAYOUT.gcHome).setY(LAYOUT.gcHome.y + Math.sin(time) * 0.6);
    else if (marking) target.set(sweepX, 7, LAYOUT.heap.z);
    else target.set(LAYOUT.heap.x, 8, LAYOUT.heap.z);
    this.drone.position.lerp(target, 1 - Math.exp(-5 * dt));
    this.droneRing.rotation.z += dt * (collecting ? 6 : 0.8);
    this.sweep.visible = marking;
    this.sweep.position.set(sweepX, 2.2, LAYOUT.heap.z);
    const zgc = this.sim.collector === 'ZGC';
    const color = zgc ? '#ff7ae0' : '#c8f7ff';
    (this.droneRing.material as THREE.MeshStandardMaterial).emissive.set(color);
    (this.sweep.material as THREE.MeshBasicMaterial).color.set(color);
  }

  private updateSelection(time: number) {
    const o = this.selected;
    const alive = o && this.sim.heap.objectAt(o.region, o.slot) === o;
    if (!alive) this.selected = null;
    this.beam.visible = this.marker.visible = !!this.selected;
    if (!this.selected) return;
    const from = slotPosition(this.selected.region, this.selected.slot, this.p);
    const to = this.klassPosition(this.selected.klass);
    const pos = this.beam.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    this.marker.position.copy(from);
    this.marker.scale.setScalar(2 + Math.sin(time * 6) * 0.4);
  }

  // ------------------------------------------------------------- build

  private registerAnchors() {
    const heapAnchor = (): Anchor => ({
      center: LAYOUT.heap.clone(),
      radius: HEAP_SIZE.w / 2,
      view: new THREE.Vector3(0, 1, 0.9),
    });
    this.reg.anchor('heap', heapAnchor);
    this.reg.anchor('gc', heapAnchor);
    for (const role of ['eden', 'survivor', 'old', 'humongous'] as const)
      this.reg.anchor(ROLE_HOTSPOT[role], () => this.roleAnchor(role) ?? heapAnchor());
    this.reg.anchor('object', () => {
      const o = this.selected ?? this.selectAny();
      if (!o) return heapAnchor();
      return { center: slotPosition(o.region, o.slot), radius: 4, view: new THREE.Vector3(0.4, 0.8, 1) };
    });
  }

  /** The camera frames all regions currently playing `role`. */
  private roleAnchor(role: RegionRole): Anchor | null {
    const idx = this.sim.heap.regions.filter((r) => r.role === role).map((r) => r.index);
    if (idx.length === 0) return null;
    const box = new THREE.Box3();
    for (const i of idx) box.expandByPoint(regionCenter(i));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    return { center: sphere.center, radius: Math.max(5, sphere.radius + 2), view: new THREE.Vector3(0.1, 1, 0.8) };
  }

  private buildHumongous(): THREE.Object3D {
    const [a, b] = HUMONGOUS_REGIONS;
    const pa = regionCenter(a);
    const pb = regionCenter(b);
    const w = Math.abs(pb.x - pa.x) + LAYOUT.regionTile - 0.4;
    const big = edged(new THREE.BoxGeometry(w, 2.4, LAYOUT.regionTile - 0.4), C.humongous, { body: '#2b2006' });
    (big.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
    big.position.copy(pa).lerp(pb, 0.5).setY(1.5);
    this.reg.pick(big, 'humongous');
    return big;
  }

  private buildDrone(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.8, 0.22, 12, 48),
      new THREE.MeshStandardMaterial({ color: '#0d1422', emissive: GC_COLOR, emissiveIntensity: 2, metalness: 0.5, roughness: 0.3 }),
    );
    ring.rotation.x = Math.PI / 2;
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true }));
    this.drone.add(ring, core, glowSprite(GC_COLOR, 6, 0.6));
    this.drone.position.copy(LAYOUT.gcHome);
    this.reg.add(this.drone, 'gc', { anchor: false });
    this.reg.label('Garbage collector', new THREE.Vector3(0, 2.4, 0), { id: 'gc', parent: this.drone });
    return ring;
  }

  private buildSweep(scene: THREE.Scene): THREE.Mesh {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(HEAP_SIZE.d + 1, 4.4),
      new THREE.MeshBasicMaterial({
        color: GC_COLOR,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    plane.rotation.y = Math.PI / 2;
    plane.visible = false;
    scene.add(plane);
    return plane;
  }
}
