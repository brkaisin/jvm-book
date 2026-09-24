// The static-ish world: space, floor and dome, what lies outside the JVM
// (source, compiler, class file, native code), the hardware below the floor,
// and a few exhibits (modules, AOT cache, direct memory, Valhalla, JFR).

import * as THREE from 'three';
import { C, Flow, arc, edged, glowSprite, textTexture, type Part, type Registry } from './fx';
import { LAYOUT, coreCenter, towerBase } from './layout';

const THREAD_COUNT = LAYOUT.platformX.length + LAYOUT.carrierX.length;

export class Scenery implements Part {
  private readonly spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[] = [];
  private readonly flows: Flow[] = [];
  private readonly shaders: THREE.ShaderMaterial[] = [];
  private readonly jfr = new THREE.Group();
  private readonly jfrLight: THREE.Sprite;
  private readonly vortex: THREE.Points;
  private readonly classfile: THREE.Mesh;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly reg: Registry,
  ) {
    this.buildSpace();
    this.buildDome();
    this.buildOutside();
    this.classfile = this.buildClassFile();
    this.buildModules();
    this.buildAotCache();
    this.vortex = this.buildNative();
    this.buildDirectMemory();
    this.buildValhalla();
    this.buildHardware();
    this.jfrLight = this.buildJfr();
  }

  update(dt: number, time: number): void {
    for (const s of this.spinners) s.obj.rotation[s.axis] += s.speed * dt;
    for (const f of this.flows) f.update(dt);
    for (const m of this.shaders) m.uniforms.time.value = time;
    this.classfile.position.y = LAYOUT.classfile.y + Math.sin(time * 1.3) * 0.4;
    this.vortex.rotation.x -= dt * 1.4;

    const { radius, y } = LAYOUT.jfrOrbit;
    const a = time * 0.07;
    this.jfr.position.set(Math.cos(a) * radius, y + Math.sin(time * 0.5) * 1.5, Math.sin(a) * radius * 0.75);
    this.jfr.rotation.y = -a;
    (this.jfrLight.material as THREE.SpriteMaterial).opacity = Math.sin(time * 5) > 0.3 ? 1 : 0.15;
  }

  private spin(obj: THREE.Object3D, speed: number, axis: 'x' | 'y' | 'z' = 'y') {
    this.spinners.push({ obj, axis, speed });
    return obj;
  }

  private flow(curve: THREE.Curve<THREE.Vector3>, o: ConstructorParameters<typeof Flow>[1]) {
    const f = new Flow(curve, o);
    this.scene.add(f.points);
    this.flows.push(f);
    return f;
  }

  // ------------------------------------------------------------- environment

  private buildSpace() {
    const n = 2600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(320 + Math.random() * 280);
      v.y = Math.abs(v.y) * 0.9 - 60;
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: '#9fb6ff', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false }),
    );
    this.scene.add(stars);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(170, 96).rotateX(-Math.PI / 2),
      this.shader(FLOOR_VERT, FLOOR_FRAG, {
        color: { value: new THREE.Color('#3f7cff') },
        domeC: { value: new THREE.Vector2(LAYOUT.dome.center.x, LAYOUT.dome.center.z) },
        domeR: { value: new THREE.Vector2(LAYOUT.dome.radii.x, LAYOUT.dome.radii.z) },
      }),
    );
    floor.renderOrder = -1;
    this.scene.add(floor);
  }

  private shader(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, additive = false) {
    const m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { time: { value: 0 }, ...uniforms },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.shaders.push(m);
    return m;
  }

  private buildDome() {
    const { center, radii } = LAYOUT.dome;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 48, 0, Math.PI * 2, 0, Math.PI / 2),
      this.shader(DOME_VERT, DOME_FRAG, { color: { value: new THREE.Color('#5aa9ff') } }, true),
    );
    dome.position.copy(center);
    dome.scale.copy(radii);
    this.scene.add(dome);
    this.reg.anchor('jvm', { center: new THREE.Vector3(0, 6, 0), radius: 60, view: new THREE.Vector3(0.35, 0.6, 1) });
    this.reg.label('The JVM', new THREE.Vector3(center.x, radii.y + 1.5, center.z), { id: 'jvm', cls: 'title' });
  }

  // ------------------------------------------------------------- outside

  private buildOutside() {
    const code = [
      '// Shop.scala',
      'case class Order(id: Long, total: Money)',
      '',
      'object Shop:',
      '  def checkout(o: Order): Money =',
      '    o.total * 1.21',
      '',
      '  @main def run() =',
      '    println(checkout(Order(42, Money(9.99))))',
    ];
    const KEYWORDS = /^\s*(case|object|def|@main|val)/;
    const tex = textTexture(code, {
      width: 1400,
      height: 760,
      bg: 'rgba(8,12,22,0.92)',
      border: '#56c2ff',
      font: '500 44px "JetBrains Mono", monospace',
      lineHeight: 72,
      padding: 60,
      colorize: (l) => (l.startsWith('//') ? '#7d8da3' : KEYWORDS.test(l) ? '#ffcf6e' : '#dfe7f1'),
    });
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 7.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
    );
    panel.position.copy(LAYOUT.source);
    panel.rotation.y = 0.55;
    this.reg.add(panel, 'source', { view: new THREE.Vector3(0.45, 0.15, 1) });
    this.reg.label('Source code', LAYOUT.source.clone().add(new THREE.Vector3(0, 5, 0)), { id: 'source' });

    const prism = edged(new THREE.CylinderGeometry(2.6, 2.6, 5.2, 3), '#bfe3ff', { body: '#16233a', opacity: 0.85 });
    prism.position.copy(LAYOUT.compiler);
    prism.rotation.z = Math.PI / 2;
    const wrap = new THREE.Group();
    wrap.add(prism);
    const halo = glowSprite('#9fd4ff', 7, 0.7);
    halo.position.copy(LAYOUT.compiler);
    wrap.add(halo);
    this.spin(prism, 0.6, 'x');
    this.reg.add(wrap, 'compiler');
    this.reg.label('javac · scalac', LAYOUT.compiler.clone().add(new THREE.Vector3(0, 4.2, 0)), { id: 'compiler' });

    const toCompiler = arc(LAYOUT.source.clone().add(new THREE.Vector3(6, 0, -2)), LAYOUT.compiler, 2);
    this.flow(toCompiler, { color: '#cfe8ff', count: 28, speed: 0.35, size: 0.8 });
    this.reg.flowLabel(toCompiler, 'source → compiler', 'compiler');
  }

  private buildClassFile(): THREE.Mesh {
    const tex = textTexture(['CA FE', 'BA BE'], {
      width: 256,
      height: 256,
      bg: '#1a1406',
      border: '#ffd166',
      fg: '#ffd166',
      font: '700 60px "JetBrains Mono", monospace',
      lineHeight: 80,
      padding: 48,
    });
    const cube = edged(new THREE.BoxGeometry(2.6, 2.6, 2.6), '#ffd166', { map: tex });
    cube.position.copy(LAYOUT.classfile);
    this.spin(cube, 0.5);
    this.reg.add(cube, 'classfile');
    this.reg.label('.class', LAYOUT.classfile.clone().add(new THREE.Vector3(0, 3.2, 0)), { id: 'classfile' });
    this.flow(arc(LAYOUT.compiler, LAYOUT.classfile, 1), { color: C.gold, count: 16, speed: 0.4, size: 0.9 });
    this.reg.flowLabel(new THREE.LineCurve3(LAYOUT.classfile, LAYOUT.loaders), 'class files → loaders', 'classfile', 0.45);
    return cube;
  }

  // ------------------------------------------------------------- exhibits

  private buildModules() {
    const names: [string, string, number][] = [
      ['java.base', '#ffd166', 2.4],
      ['java.sql', '#4fd1c5', 1.6],
      ['java.net.http', '#4fd1c5', 1.6],
      ['java.logging', '#4fd1c5', 1.6],
      ['shop.core', '#6ea8ff', 1.6],
      ['shop.web', '#6ea8ff', 1.6],
      ['java.xml', '#4fd1c5', 1.6],
    ];
    const group = new THREE.Group();
    names.forEach(([name, color, r], i) => {
      const top = new THREE.MeshBasicMaterial({
        map: textTexture([name], {
          width: 512,
          height: 512,
          bg: '#0c1320',
          fg: color,
          font: `600 ${i === 0 ? 66 : 58}px "JetBrains Mono", monospace`,
          padding: 0,
        }),
      });
      // Centre the text on the hexagon's top face.
      top.map!.offset.set(-0.12, -0.46);
      const side = new THREE.MeshStandardMaterial({ color: '#0d1422', emissive: color, emissiveIntensity: 0.25, metalness: 0.5, roughness: 0.4 });
      const hex = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.8 + (i === 0 ? 0.6 : 0), 6), [side, top, side]);
      const a = ((i - 1) / 6) * Math.PI * 2;
      const d = i === 0 ? 0 : 4.3;
      hex.position.set(LAYOUT.modules.x + Math.cos(a) * d, 0.4 + (i === 0 ? 0.3 : 0), LAYOUT.modules.z + Math.sin(a) * d);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(hex.geometry), new THREE.LineBasicMaterial({ color }));
      hex.add(edges);
      group.add(hex);
    });
    this.reg.add(group, 'modules', { view: new THREE.Vector3(0.2, 1, 0.7) });
    this.reg.label('Modules', LAYOUT.modules.clone().add(new THREE.Vector3(0, 3, 0)), { id: 'modules', minor: true });
  }

  private buildAotCache() {
    const tex = textTexture(['app.aot', '', 'classes ✓', 'profiles ✓', 'code (28)'], {
      width: 512,
      height: 512,
      bg: '#1d1604',
      border: '#ffd166',
      fg: '#ffe29a',
      font: '600 52px "JetBrains Mono", monospace',
      lineHeight: 70,
      padding: 50,
    });
    const crate = edged(new THREE.BoxGeometry(4.4, 4.4, 4.4), '#ffd166', { map: tex });
    crate.position.copy(LAYOUT.aot);
    crate.rotation.y = 0.5;
    this.reg.add(crate, 'aotcache');
    this.reg.label('AOT cache', LAYOUT.aot.clone().add(new THREE.Vector3(0, 3.8, 0)), { id: 'aotcache', minor: true });
    const opts = { color: '#ffd166', count: 18, speed: 0.08, size: 0.7, opacity: 0.7 };
    const toMeta = arc(LAYOUT.aot, LAYOUT.metaspace, 8);
    this.flow(toMeta, opts);
    this.flow(arc(LAYOUT.aot, LAYOUT.codecache.clone().add(new THREE.Vector3(-6, 2, 0)), 22), opts);
    this.reg.flowLabel(toMeta, 'cached classes & profiles', 'aotcache');
  }

  private buildNative(): THREE.Points {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.5, 0.32, 16, 96),
      new THREE.MeshStandardMaterial({ color: '#2a0f1f', emissive: C.native, emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.3 }),
    );
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(6.4, 0.08, 8, 96),
      new THREE.MeshBasicMaterial({ color: C.native, transparent: true, opacity: 0.6 }),
    );
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(Math.random()) * 5.2;
      const a = Math.random() * Math.PI * 2 + r * 0.9;
      pos.set([(Math.random() - 0.5) * 0.4, Math.cos(a) * r, Math.sin(a) * r], i * 3);
    }
    const vg = new THREE.BufferGeometry();
    vg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const vortex = new THREE.Points(
      vg,
      new THREE.PointsMaterial({
        color: '#ff9cc2',
        size: 0.22,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const portal = new THREE.Group();
    ring.rotation.y = Math.PI / 2;
    ring2.rotation.y = Math.PI / 2;
    portal.add(ring, ring2, vortex, glowSprite(C.native, 12, 0.45));
    portal.position.copy(LAYOUT.portal);
    this.spin(ring2, 0.4, 'x');
    this.reg.add(portal, 'native', { view: new THREE.Vector3(-0.9, 0.3, 0.8) });
    this.reg.label('Native code · JNI / FFM', LAYOUT.portal.clone().add(new THREE.Vector3(0, 7.5, 0)), { id: 'native' });

    const libs = ['libc.so.6', 'libssl.so.3', 'libcuda.so', 'kernel'];
    const world = new THREE.Group();
    libs.forEach((name, i) => {
      const tex = textTexture([name], { width: 512, height: 128, bg: '#1b0a14', fg: '#ffb3cf', border: '#ff6b9d', font: '600 52px "JetBrains Mono", monospace', padding: 30 });
      const box = edged(new THREE.BoxGeometry(6, 1.5, 1.5), '#ff6b9d', { map: tex });
      box.position.set(LAYOUT.nativeWorld.x + (i % 2) * 3, LAYOUT.nativeWorld.y + (i - 1.5) * 3, LAYOUT.nativeWorld.z + (i % 2 ? 3 : -3));
      box.rotation.y = -0.4;
      world.add(box);
    });
    this.reg.add(world, 'native', { anchor: false });
    this.flow(arc(LAYOUT.portal, LAYOUT.nativeWorld, 2), { color: C.native, count: 30, speed: 0.3, jitter: 3 });
    const toPortal = arc(LAYOUT.interpreter.clone().add(new THREE.Vector3(3, 0, 3)), LAYOUT.portal, 6);
    this.flow(toPortal, { color: '#ffc2d8', count: 30, speed: 0.15, size: 0.7, opacity: 0.6 });
    this.reg.flowLabel(toPortal, 'native calls', 'native', 0.6);
    return vortex;
  }

  private buildDirectMemory() {
    const group = new THREE.Group();
    const labels = ['ByteBuffer.allocateDirect', 'MappedByteBuffer', 'Arena.ofConfined()'];
    labels.forEach((l, i) => {
      const tex = textTexture([l], { width: 1024, height: 128, fg: '#aeeaff', font: '600 56px "JetBrains Mono", monospace', padding: 34 });
      const slab = edged(new THREE.BoxGeometry(8, 0.9, 3.2), C.eden, { body: '#08202b', opacity: 0.85 });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(8, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      face.position.z = 1.62;
      slab.add(face);
      slab.position.set(LAYOUT.direct.x, 0.6 + i * 1.2, LAYOUT.direct.z);
      group.add(slab);
    });
    this.reg.add(group, 'directmem');
    this.reg.label('Direct memory (off-heap)', LAYOUT.direct.clone().add(new THREE.Vector3(0, 4.8, 0)), { id: 'directmem', minor: true });
  }

  private buildValhalla() {
    const g = new THREE.Group();
    const { x, z } = LAYOUT.valhalla;
    const refMat = new THREE.MeshBasicMaterial({ color: '#8fa3bf' });
    const lineMat = new THREE.LineBasicMaterial({ color: '#8fa3bf', transparent: true, opacity: 0.7 });
    // Today: an array of references to scattered objects, each with a header.
    for (let i = 0; i < 5; i++) {
      const ref = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), refMat);
      ref.position.set(x - 6 + i, 0.5, z - 2.2);
      const obj = edged(new THREE.BoxGeometry(1.2, 0.8, 1.2), C.eden, { body: '#0b2230' });
      const header = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.24, 1.22), new THREE.MeshBasicMaterial({ color: '#ff5d8f' }));
      header.position.y = 0.3;
      obj.add(header);
      obj.position.set(x - 7 + i * 1.3 + Math.sin(i * 7) * 1.5, 2.8 + (i % 3) * 1.1, z - 5 - (i % 2) * 2);
      g.add(ref, obj, new THREE.Line(new THREE.BufferGeometry().setFromPoints([ref.position, obj.position]), lineMat));
    }
    // Valhalla: the same data, flat and contiguous, no headers.
    for (let i = 0; i < 10; i++) {
      const cell = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.9),
        new THREE.MeshBasicMaterial({ color: i % 2 ? '#3ad0ff' : '#8ce4ff' }),
      );
      cell.position.set(x - 6 + i * 0.5 - 0.25, 0.5, z + 2);
      g.add(cell);
    }
    const tag = (text: string, zz: number) => {
      const tex = textTexture([text], { width: 1024, height: 128, fg: '#dfe7f1', font: '600 60px "JetBrains Mono", monospace', padding: 24 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(8, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      p.rotation.x = -Math.PI / 2;
      p.position.set(x + 3.2, 0.05, zz);
      g.add(p);
    };
    tag('Point[] today', z - 2.2);
    tag('value Point[]', z + 2);
    this.reg.add(g, 'valhalla', { view: new THREE.Vector3(0.2, 0.9, 1) });
    this.reg.label('Valhalla', new THREE.Vector3(x - 2, 6.5, z - 1), { id: 'valhalla', minor: true });
  }

  // ------------------------------------------------------------- hardware

  private buildHardware() {
    const y = LAYOUT.hardwareY;
    const die = edged(new THREE.BoxGeometry(46, 0.8, 11), '#8a7dff', { body: '#0c0f1e', edgeOpacity: 0.6 });
    die.position.set(LAYOUT.cpu.x, y - 0.4, LAYOUT.cpu.z);
    const cpu = new THREE.Group();
    cpu.add(die);
    const beamMat = new THREE.LineDashedMaterial({ color: C.thread, dashSize: 0.6, gapSize: 0.5, transparent: true, opacity: 0.55 });
    for (let i = 0; i < THREAD_COUNT; i++) {
      const c = coreCenter(i);
      const core = edged(new THREE.BoxGeometry(3.6, 1.2, 3.6), '#c7b8ff', { body: '#191433' });
      core.position.copy(c);
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 1.2), new THREE.MeshBasicMaterial({ color: '#8a7dff' }));
      l1.position.set(0, 0.75, 0);
      core.add(l1);
      cpu.add(core);
      // A platform thread is an OS thread, scheduled on a core.
      const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([towerBase(i), c.clone().setY(c.y + 0.6)]), beamMat);
      beam.computeLineDistances();
      this.scene.add(beam);
    }
    const l3 = edged(new THREE.BoxGeometry(40, 0.6, 2), '#8a7dff', { body: '#141032' });
    l3.position.set(LAYOUT.cpu.x, y + 0.3, LAYOUT.cpu.z + 4);
    cpu.add(l3);
    this.reg.add(cpu, 'cpu', { view: new THREE.Vector3(0.15, 0.22, 1) });
    this.reg.label('CPU cores & caches', LAYOUT.cpu.clone().add(new THREE.Vector3(-24, 2, 4)), { id: 'cpu' });
    const bus = LAYOUT.cpu.clone().setY(y + 0.8).add(new THREE.Vector3(0, 0, 4));
    this.flow(new THREE.LineCurve3(bus.clone().setX(bus.x - 19), bus.clone().setX(bus.x + 19)), {
      color: '#b7a8ff',
      count: 20,
      speed: 0.25,
      jitter: 0.3,
    });

    const ram = new THREE.Group();
    const board = edged(new THREE.BoxGeometry(56, 0.5, 5), '#4cc9f0', { body: '#081820', edgeOpacity: 0.6 });
    ram.add(board);
    for (let i = 0; i < 12; i++) {
      const chip = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 3), new THREE.MeshStandardMaterial({ color: '#0f2733', emissive: '#4cc9f0', emissiveIntensity: 0.35 }));
      chip.position.set(-24 + i * 4.4, 0.5, 0);
      ram.add(chip);
    }
    ram.position.copy(LAYOUT.ram);
    this.reg.add(ram, 'ram', { view: new THREE.Vector3(0.1, 0.25, 1) });
    this.reg.label('Main memory', LAYOUT.ram.clone().add(new THREE.Vector3(31, 1.5, 0)), { id: 'ram' });
    const toCpu = arc(LAYOUT.ram.clone().setY(y + 0.8), bus, 3);
    this.flow(toCpu, { color: '#6fd8ff', count: 24, speed: 0.2, jitter: 1.5 });
    this.reg.flowLabel(toCpu, 'memory ↔ caches', 'cpu');
  }

  private buildJfr(): THREE.Sprite {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.8, 2, 8, 16),
      new THREE.MeshStandardMaterial({ color: '#1c2230', metalness: 0.9, roughness: 0.25, emissive: '#ff4d4d', emissiveIntensity: 0.08 }),
    );
    body.rotation.z = Math.PI / 2;
    const rotor = (x: number) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 32), new THREE.MeshBasicMaterial({ color: '#ff8080' }));
      r.rotation.x = Math.PI / 2;
      r.position.set(x, 0.6, 0);
      return r;
    };
    const light = glowSprite('#ff3b3b', 3, 1);
    light.position.set(0, 0.2, 0.9);
    this.jfr.add(body, rotor(-1.6), rotor(1.6), light);
    this.reg.add(this.jfr, 'jfr', { view: new THREE.Vector3(0.3, 0.3, 1) });
    this.reg.label('JFR', new THREE.Vector3(0, 2.2, 0), { id: 'jfr', parent: this.jfr, minor: false });
    return light;
  }
}

// ------------------------------------------------------------- shaders

const FLOOR_VERT = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FLOOR_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  uniform vec2 domeC;
  uniform vec2 domeR;
  varying vec3 vW;
  float grid(vec2 p, float s) {
    vec2 q = p / s;
    vec2 g = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    float r = length(vW.xz);
    float major = grid(vW.xz, 8.0);
    float minor = grid(vW.xz, 2.0);
    float e = length((vW.xz - domeC) / domeR);
    float inside = 1.0 - smoothstep(0.96, 1.0, e);
    float rim = smoothstep(0.9, 1.0, e) * (1.0 - smoothstep(1.0, 1.04, e));
    float fade = 1.0 - smoothstep(50.0, 165.0, r);
    float wave = pow(clamp(0.5 + 0.5 * sin(r * 0.12 - time * 1.2), 0.0, 1.0), 8.0) * inside;
    float a = (major * 0.45 + minor * 0.12) * (0.35 + 0.65 * inside) + rim * 0.35 + wave * 0.08 + inside * 0.05;
    gl_FragColor = vec4(color * (0.6 + rim * 0.5 + wave), a * fade);
  }`;

const DOME_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  void main() {
    vP = position;
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const DOME_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vP;
  float line(float x, float w) {
    float d = abs(fract(x) - 0.5);
    return smoothstep(0.5 - w, 0.5, d);
  }
  void main() {
    float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2);
    float lon = atan(vP.z, vP.x) * 24.0 / 6.2831;
    float lat = asin(clamp(vP.y, -1.0, 1.0)) * 10.0 / 1.5708;
    float g = max(line(lon, 0.03), line(lat, 0.03));
    float scan = 1.0 - smoothstep(0.0, 0.04, abs(vP.y - fract(time * 0.05)));
    float base = 1.0 - smoothstep(0.0, 0.05, vP.y);
    float a = f * 0.32 + g * 0.08 + scan * 0.2 + base * 0.12;
    gl_FragColor = vec4(color * (0.6 + scan + base * 0.4), a);
  }`;
