// Class loading: three nested loader rings, the verifier's scanning gate, and
// Metaspace, where one crystal lights up per loaded class. Class files fly in
// from outside, driven by the simulation's loading jobs.

import * as THREE from 'three';
import { KLASSES, type JvmSim, type Loader } from '../sim/jvm';
import { C, Flow, arc, easeInOut, edged, glowSprite, textTexture, type Part, type Registry } from './fx';
import { LAYOUT } from './layout';

export const LOADER_COLOR: Record<Loader, THREE.Color> = {
  bootstrap: C.gold,
  platform: new THREE.Color('#4fd1c5'),
  app: C.app,
};

const RING_RADIUS: Record<Loader, number> = { app: 6.4, platform: 4.9, bootstrap: 3.4 };

export class LoadingView implements Part {
  private readonly rings = new Map<Loader, { mesh: THREE.Mesh; flash: number }>();
  private readonly crystals: { mesh: THREE.Mesh; halo: THREE.Sprite; flash: number }[] = [];
  private readonly cubes = new Map<number, THREE.Mesh>();
  private readonly cubeGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  private readonly cubeTex = textTexture(['CAFE', 'BABE'], {
    width: 128,
    height: 128,
    bg: '#241a05',
    fg: '#ffd166',
    font: '700 34px "JetBrains Mono", monospace',
    lineHeight: 40,
    padding: 22,
  });
  private readonly scanner: THREE.Mesh;
  private readonly metaRing: THREE.Mesh;
  private readonly bytecodeFlow: Flow;
  private readonly path: THREE.CurvePath<THREE.Vector3>;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly reg: Registry,
    private readonly sim: JvmSim,
  ) {
    this.buildLoaders();
    this.scanner = this.buildVerifier();
    this.metaRing = this.buildMetaspace();
    this.path = new THREE.CurvePath<THREE.Vector3>();
    this.path.add(new THREE.LineCurve3(LAYOUT.classfile.clone().add(new THREE.Vector3(2.5, 0, 0)), LAYOUT.loaders));
    this.path.add(new THREE.LineCurve3(LAYOUT.loaders, LAYOUT.verifier));
    this.bytecodeFlow = new Flow(arc(LAYOUT.metaspace, LAYOUT.interpreter, 10), { color: C.interp, count: 60, speed: 0.09, jitter: 0.8 });
    scene.add(this.bytecodeFlow.points);
    sim.on('classLoaded', ({ klass }) => {
      this.crystals[klass].flash = 1;
    });
  }

  /** World position of the crystal for class `k` (for the klass-pointer beam). */
  crystalPosition(k: number): THREE.Vector3 {
    return this.crystals[k].mesh.getWorldPosition(new THREE.Vector3());
  }

  update(dt: number, time: number): void {
    const ringSpeed: Record<Loader, number> = { app: 0.35, platform: -0.55, bootstrap: 0.8 };
    for (const [loader, r] of this.rings) {
      r.mesh.rotation.z += ringSpeed[loader] * dt;
      r.flash = Math.max(0, r.flash - dt * 1.5);
      (r.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 + r.flash * 3;
    }
    (this.scanner.material as THREE.ShaderMaterial).uniforms.time.value = time;
    this.metaRing.rotation.y += dt * 0.15;
    this.bytecodeFlow.update(dt);

    this.crystals.forEach((c, k) => {
      const state = this.sim.klassState[k];
      const loaded = state === 'loaded';
      c.flash = Math.max(0, c.flash - dt * 0.8);
      const target = loaded ? 1 + c.flash * 0.8 : 0.35;
      c.mesh.scale.setScalar(THREE.MathUtils.lerp(c.mesh.scale.x, target, 1 - Math.exp(-6 * dt)));
      c.mesh.rotation.y += dt * (0.4 + (k % 3) * 0.2);
      const m = c.mesh.material as THREE.MeshStandardMaterial;
      m.opacity = loaded ? 0.95 : 0.18;
      m.emissiveIntensity = loaded ? 0.7 + c.flash * 3 : 0.1;
      (c.halo.material as THREE.SpriteMaterial).opacity = loaded ? 0.35 + c.flash : 0;
    });

    this.updateCubes();
  }

  private updateCubes() {
    const active = new Set<number>();
    for (const job of this.sim.loading) {
      active.add(job.klass);
      let cube = this.cubes.get(job.klass);
      if (!cube) {
        cube = edged(this.cubeGeo, LOADER_COLOR[KLASSES[job.klass].loader], { map: this.cubeTex });
        this.reg.pick(cube, 'classfile');
        this.scene.add(cube);
        this.cubes.set(job.klass, cube);
      }
      const p = Math.min(1, (this.sim.now - job.startedAt) / this.sim.loadSeconds);
      // First half: through the loaders and the verifier. Second half: up into Metaspace.
      if (p < 0.5) {
        this.path.getPointAt(easeInOut(p / 0.5), cube.position);
        if (p > 0.18 && p < 0.22) this.flashDelegation(KLASSES[job.klass].loader);
      } else {
        arc(LAYOUT.verifier, this.crystalPosition(job.klass), 6).getPointAt(easeInOut((p - 0.5) / 0.5), cube.position);
      }
      cube.scale.setScalar(p > 0.85 ? (1 - p) / 0.15 : 1);
      cube.rotation.set(p * 6, p * 9, 0);
    }
    for (const [k, cube] of this.cubes)
      if (!active.has(k)) {
        this.scene.remove(cube);
        this.reg.unpick(cube);
        this.cubes.delete(k);
      }
  }

  /** Parent delegation: the request goes up to the bootstrap loader first. */
  private flashDelegation(loader: Loader) {
    this.rings.get('bootstrap')!.flash = 1;
    if (loader !== 'bootstrap') this.rings.get('platform')!.flash = 1;
    if (loader === 'app') this.rings.get('app')!.flash = 1;
  }

  // ------------------------------------------------------------- build

  private buildLoaders() {
    const group = new THREE.Group();
    group.position.copy(LAYOUT.loaders);
    group.rotation.y = Math.PI / 2;
    for (const loader of ['app', 'platform', 'bootstrap'] as const) {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(RING_RADIUS[loader], loader === 'bootstrap' ? 0.34 : 0.26, 16, 120, Math.PI * 1.75),
        new THREE.MeshStandardMaterial({
          color: '#101521',
          emissive: LOADER_COLOR[loader],
          emissiveIntensity: 1,
          metalness: 0.7,
          roughness: 0.3,
        }),
      );
      group.add(mesh);
      this.rings.set(loader, { mesh, flash: 0 });
    }
    group.add(glowSprite(C.gold, 5, 0.5));
    this.reg.add(group, 'classloaders', { view: new THREE.Vector3(-0.6, 0.25, 1) });
    this.reg.label('Class loaders', LAYOUT.loaders.clone().add(new THREE.Vector3(0, 8, 0)), { id: 'classloaders' });
    const tag = (text: string, loader: Loader, dy: number) =>
      this.reg.label(text, LAYOUT.loaders.clone().add(new THREE.Vector3(0, dy, 1.5)), { minor: true, id: 'classloaders', cls: `tag-${loader}` });
    tag('Application', 'app', -RING_RADIUS.app - 0.9);
    tag('Platform', 'platform', -RING_RADIUS.platform - 0.6);
    tag('Bootstrap', 'bootstrap', -RING_RADIUS.bootstrap - 0.5);
  }

  private buildVerifier(): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: new THREE.Color('#7cf5d1') } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform vec3 color;
        varying vec2 vUv;
        void main() {
          float scan = smoothstep(0.035, 0.0, abs(vUv.y - fract(time * 0.45)));
          float grid = step(0.94, fract(vUv.x * 14.0)) + step(0.94, fract(vUv.y * 20.0));
          float edge = step(0.97, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0);
          float a = scan * 0.9 + grid * 0.08 + edge * 0.8 + 0.03;
          gl_FragColor = vec4(color * (1.0 + scan * 2.0), a);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(10, 13), mat);
    gate.position.copy(LAYOUT.verifier);
    gate.rotation.y = Math.PI / 2;
    this.reg.add(gate, 'verifier', { view: new THREE.Vector3(0.9, 0.2, 1) });
    this.reg.label('Verifier', LAYOUT.verifier.clone().add(new THREE.Vector3(0, 7.3, 0)), { id: 'verifier', minor: true });
    return gate;
  }

  private buildMetaspace(): THREE.Mesh {
    const center = LAYOUT.metaspace;
    const group = new THREE.Group();
    const platform = new THREE.Mesh(
      new THREE.TorusGeometry(8.5, 0.12, 8, 160),
      new THREE.MeshBasicMaterial({ color: '#7fb4ff', transparent: true, opacity: 0.6 }),
    );
    platform.rotation.x = Math.PI / 2;
    platform.position.copy(center).setY(center.y - 3.2);
    group.add(platform);

    const geo = new THREE.OctahedronGeometry(0.9, 0).scale(1, 1.6, 1);
    KLASSES.forEach((k, i) => {
      // Golden-angle spiral: evenly spread, no two crystals overlap.
      const a = i * 2.39996;
      const r = 1.6 + Math.sqrt(i) * 1.55;
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: '#0d1422',
          emissive: LOADER_COLOR[k.loader],
          emissiveIntensity: 0.7,
          metalness: 0.3,
          roughness: 0.15,
          transparent: true,
          flatShading: true,
        }),
      );
      mesh.position.set(center.x + Math.cos(a) * r, center.y + Math.sin(i * 1.7) * 1.8, center.z + Math.sin(a) * r);
      const halo = glowSprite(LOADER_COLOR[k.loader], 3.5, 0.3);
      mesh.add(halo);
      group.add(mesh);
      this.crystals.push({ mesh, halo, flash: 0 });
    });
    this.reg.add(group, 'metaspace', { view: new THREE.Vector3(-0.2, 0.5, 1) });
    this.reg.label('Metaspace', center.clone().add(new THREE.Vector3(0, 6.5, 0)), { id: 'metaspace' });
    return platform;
  }
}
