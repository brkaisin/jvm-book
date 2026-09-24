// Small shared building blocks: palette, textures, particle flows, labels,
// and the registry that turns meshes into clickable hotspots.

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { AREAS, HOTSPOTS, type AreaId, type HotspotId } from '../content';

export const C = {
  eden: new THREE.Color('#3ad0ff'),
  survivor: new THREE.Color('#a3e635'),
  old: new THREE.Color('#ff5d8f'),
  humongous: new THREE.Color('#ffc233'),
  free: new THREE.Color('#141c29'),
  dead: new THREE.Color('#39414d'),
  interp: new THREE.Color('#5b8cff'),
  c1: new THREE.Color('#2ee6a6'),
  c2: new THREE.Color('#ff8a3d'),
  deopt: new THREE.Color('#ff3b3b'),
  thread: new THREE.Color('#b388ff'),
  vthread: new THREE.Color('#d7b8ff'),
  gold: new THREE.Color('#ffd166'),
  app: new THREE.Color('#6ea8ff'),
  ice: new THREE.Color('#dff4ff'),
  native: new THREE.Color('#ff6b9d'),
};

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// --------------------------------------------------------------- textures

let glowTex: THREE.Texture | null = null;
/** A soft radial dot, for sprites and halos. */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export interface TextTexOpts {
  width?: number;
  height?: number;
  bg?: string;
  fg?: string;
  font?: string;
  lineHeight?: number;
  padding?: number;
  border?: string;
  colorize?: (line: string, i: number) => string | undefined;
}

/** Renders lines of text into a canvas texture. */
export function textTexture(lines: string[], o: TextTexOpts = {}): THREE.CanvasTexture {
  const w = o.width ?? 1024;
  const h = o.height ?? 512;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  if (o.bg) {
    g.fillStyle = o.bg;
    g.fillRect(0, 0, w, h);
  }
  if (o.border) {
    g.strokeStyle = o.border;
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
  }
  g.font = o.font ?? '500 34px "JetBrains Mono", monospace';
  g.textBaseline = 'top';
  const lh = o.lineHeight ?? 46;
  const pad = o.padding ?? 36;
  lines.forEach((line, i) => {
    g.fillStyle = o.colorize?.(line, i) ?? o.fg ?? '#e6edf3';
    g.fillText(line, pad, pad + i * lh);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// --------------------------------------------------------------- flows

const flowVert = /* glsl */ `
  attribute float alpha;
  varying float vAlpha;
  uniform float size;
  void main() {
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const flowFrag = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(color * (1.0 + a), a * a * vAlpha * opacity);
  }`;

export interface FlowOpts {
  count?: number;
  color?: THREE.ColorRepresentation;
  size?: number;
  /** Laps per second. */
  speed?: number;
  jitter?: number;
  opacity?: number;
}

/** Glowing particles streaming along a curve: data moving between two places. */
export class Flow {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly seeds: Float32Array;
  private readonly jit: Float32Array;
  private t = 0;
  private readonly tmp = new THREE.Vector3();
  readonly material: THREE.ShaderMaterial;

  constructor(
    readonly curve: THREE.Curve<THREE.Vector3>,
    private readonly o: FlowOpts = {},
  ) {
    const n = o.count ?? 36;
    this.pos = new Float32Array(n * 3);
    this.alpha = new Float32Array(n);
    this.seeds = new Float32Array(n).map(() => Math.random());
    this.jit = new Float32Array(n * 3).map(() => (Math.random() - 0.5) * (o.jitter ?? 0.5));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: flowVert,
      fragmentShader: flowFrag,
      uniforms: {
        color: { value: new THREE.Color(o.color ?? '#ffffff') },
        size: { value: o.size ?? 0.9 },
        opacity: { value: o.opacity ?? 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.update(0);
  }

  set opacity(v: number) {
    this.material.uniforms.opacity.value = v;
  }

  update(dt: number) {
    this.t += dt * (this.o.speed ?? 0.12);
    const n = this.alpha.length;
    for (let i = 0; i < n; i++) {
      const u = (this.seeds[i] + this.t) % 1;
      this.curve.getPointAt(u, this.tmp);
      this.pos[i * 3] = this.tmp.x + this.jit[i * 3];
      this.pos[i * 3 + 1] = this.tmp.y + this.jit[i * 3 + 1];
      this.pos[i * 3 + 2] = this.tmp.z + this.jit[i * 3 + 2];
      this.alpha[i] = Math.sin(u * Math.PI);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.alpha.needsUpdate = true;
  }
}

/** A curve from a to b that bulges upwards by `lift`. */
export function arc(a: THREE.Vector3, b: THREE.Vector3, lift: number): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().lerp(b, 0.5);
  mid.y += lift;
  return new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
}

// --------------------------------------------------------------- registry

export interface Anchor {
  center: THREE.Vector3;
  radius: number;
  /** Direction from the target towards the camera. */
  view?: THREE.Vector3;
}

export interface Label {
  obj: CSS2DObject;
  el: HTMLElement;
  id?: HotspotId;
  /** Minor labels only show up when the camera is close. */
  minor: boolean;
}

/** Maps a hit (instance id for instanced meshes) to a hotspot; `commit` is true on click, false on hover. */
export type PickFn = (instanceId: number | undefined, commit: boolean) => HotspotId | null;

/**
 * Everything that can be clicked or focused. World builders register meshes
 * (possibly instanced) and anchors (where the camera goes) against hotspot ids.
 */
export class Registry {
  readonly pickables: THREE.Object3D[] = [];
  readonly anchors = new Map<HotspotId, () => Anchor>();
  readonly labels: Label[] = [];
  onLabelClick: (id: HotspotId) => void = () => {};

  constructor(private readonly scene: THREE.Scene) {}

  /** Makes `obj` clickable; a function can map instance ids to hotspots for instanced meshes. */
  pick(obj: THREE.Object3D, id: HotspotId | PickFn) {
    const fn: PickFn = typeof id === 'function' ? id : () => id;
    obj.userData.pick = fn;
    this.pickables.push(obj);
  }

  /** Resolves a raycast hit to a hotspot, walking up to the registered ancestor. */
  resolve(hit: THREE.Intersection, commit: boolean): HotspotId | null {
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      const fn = o.userData.pick as PickFn | undefined;
      if (fn) return fn(hit.instanceId, commit);
    }
    return null;
  }

  unpick(obj: THREE.Object3D) {
    const i = this.pickables.indexOf(obj);
    if (i >= 0) this.pickables.splice(i, 1);
  }

  anchor(id: HotspotId, a: Anchor | (() => Anchor)) {
    this.anchors.set(id, typeof a === 'function' ? a : () => a);
  }

  /**
   * Adds `obj` to `parent` (the scene by default), makes it clickable, and
   * anchors the camera on its bounds (computed at focus time, so it follows
   * moving objects).
   */
  add(obj: THREE.Object3D, id: HotspotId, o: { view?: THREE.Vector3; parent?: THREE.Object3D; anchor?: boolean } = {}) {
    (o.parent ?? this.scene).add(obj);
    this.pick(obj, id);
    if (o.anchor !== false && !this.anchors.has(id)) this.anchor(id, () => boundsAnchor(obj, o.view));
    return obj;
  }

  /** A floating HTML label; clicking it opens the hotspot. */
  label(
    text: string,
    pos: THREE.Vector3,
    opts: { area?: AreaId; id?: HotspotId; minor?: boolean; cls?: string; parent?: THREE.Object3D } = {},
  ): Label {
    const el = document.createElement('div');
    el.className = `lbl ${opts.minor ? 'minor' : 'major'} ${opts.cls ?? ''}`;
    const area = opts.area ?? (opts.id ? HOTSPOTS[opts.id].area : undefined);
    if (area) el.style.setProperty('--c', AREAS[area].color);
    el.innerHTML = `<i></i><span>${text}</span>`;
    if (opts.id) {
      const id = opts.id;
      el.classList.add('clickable');
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onLabelClick(id);
      });
    }
    const obj = new CSS2DObject(el);
    obj.position.copy(pos);
    (opts.parent ?? this.scene).add(obj);
    const l: Label = { obj, el, id: opts.id, minor: !!opts.minor };
    this.labels.push(l);
    return l;
  }
}

const box3 = new THREE.Box3();
const sphere = new THREE.Sphere();

export function boundsAnchor(obj: THREE.Object3D, view?: THREE.Vector3): Anchor {
  box3.setFromObject(obj).getBoundingSphere(sphere);
  return { center: sphere.center.clone(), radius: Math.max(sphere.radius, 2), view };
}

/** A standard glowing-edged solid: dark body plus bright wireframe edges. */
export function edged(
  geo: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  opts: { body?: THREE.ColorRepresentation; opacity?: number; edgeOpacity?: number; map?: THREE.Texture } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      map: opts.map ?? null,
      color: opts.map ? '#ffffff' : (opts.body ?? '#0d1422'),
      metalness: 0.6,
      roughness: 0.35,
      transparent: (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.06,
    }),
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 20),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.edgeOpacity ?? 0.9 }),
  );
  mesh.add(edges);
  return mesh;
}

export function glowSprite(color: THREE.ColorRepresentation, scale: number, opacity = 0.8): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  s.scale.setScalar(scale);
  return s;
}

interface Spark {
  sprite: THREE.Sprite;
  curve: THREE.Curve<THREE.Vector3>;
  t: number;
  duration: number;
  onDone?: () => void;
}

/** One-off glowing orbs flying along an arc: a compilation, a deopt, a mount. */
export class Sparks {
  private readonly live: Spark[] = [];
  private readonly pool: THREE.Sprite[] = [];

  constructor(private readonly parent: THREE.Object3D) {}

  launch(
    from: THREE.Vector3,
    to: THREE.Vector3,
    o: { color: THREE.ColorRepresentation; duration?: number; lift?: number; size?: number; onDone?: () => void },
  ): void {
    const sprite = this.pool.pop() ?? glowSprite('#fff', 1, 1);
    (sprite.material as THREE.SpriteMaterial).color.set(o.color);
    sprite.scale.setScalar(o.size ?? 2.2);
    this.parent.add(sprite);
    this.live.push({ sprite, curve: arc(from, to, o.lift ?? 4), t: 0, duration: o.duration ?? 1, onDone: o.onDone });
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.t += dt / s.duration;
      if (s.t >= 1) {
        this.live.splice(i, 1);
        this.parent.remove(s.sprite);
        this.pool.push(s.sprite);
        s.onDone?.();
        continue;
      }
      s.curve.getPointAt(easeInOut(s.t), s.sprite.position);
    }
  }
}

/** Exponential smoothing towards a target: frame-rate independent. */
export function approach(current: THREE.Vector3, target: THREE.Vector3, rate: number, dt: number): THREE.Vector3 {
  return current.lerp(target, 1 - Math.exp(-rate * dt));
}

/** Common interface of every part of the world that animates. */
export interface Part {
  update(dt: number, time: number): void;
}
