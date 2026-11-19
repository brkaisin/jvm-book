// Smooth camera flights between hotspots, on top of OrbitControls. The user
// can grab the controls at any time, which cancels the flight.

import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { easeInOut, type Anchor } from './fx';

const DEFAULT_VIEW = new THREE.Vector3(0.35, 0.45, 1);

interface Flight {
  from: THREE.Vector3;
  via: THREE.Vector3;
  to: THREE.Vector3;
  targetFrom: THREE.Vector3;
  targetTo: THREE.Vector3;
  t: number;
  duration: number;
}

export class CameraRig {
  private flight: Flight | null = null;
  /** Slowly circles the target when nobody is steering (intro, embed). */
  autoOrbit = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: OrbitControls,
  ) {
    controls.addEventListener('start', () => {
      this.flight = null;
      this.autoOrbit = 0;
    });
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  /** Where the camera should stand to frame `a`. */
  viewpoint(a: Anchor): THREE.Vector3 {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = Math.min(this.camera.aspect, 1.6);
    const fit = a.radius / Math.sin(fov / 2) / Math.min(1, aspect);
    const dist = Math.max(11, fit * 1.2);
    return (a.view ?? DEFAULT_VIEW).clone().normalize().multiplyScalar(dist).add(a.center);
  }

  /** Flies to frame `a`; without a `duration`, short hops are quick and long journeys take their time. */
  flyTo(a: Anchor, duration?: number): void {
    const to = this.viewpoint(a);
    const from = this.camera.position.clone();
    const span = from.distanceTo(to) + this.controls.target.distanceTo(a.center);
    const via = from.clone().lerp(to, 0.5);
    via.y += from.distanceTo(to) * 0.25;
    duration ??= THREE.MathUtils.clamp(1.1 + span / 70, 1.2, 3);
    this.flight = { from, via, to, targetFrom: this.controls.target.clone(), targetTo: a.center.clone(), t: 0, duration };
  }

  /** Jumps without animation. */
  place(a: Anchor): void {
    this.flight = null;
    this.camera.position.copy(this.viewpoint(a));
    this.controls.target.copy(a.center);
  }

  update(dt: number): void {
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = easeInOut(f.t);
      // Quadratic Bezier through a raised midpoint: a swooping flight.
      const a = f.from.clone().lerp(f.via, k);
      const b = f.via.clone().lerp(f.to, k);
      this.camera.position.copy(a.lerp(b, k));
      // The gaze leads the body a little, the way you look before you walk.
      this.controls.target.copy(f.targetFrom).lerp(f.targetTo, easeInOut(Math.min(1, f.t * 1.25)));
      if (f.t >= 1) this.flight = null;
    } else if (this.autoOrbit) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.autoOrbit * dt);
      this.camera.position.copy(this.controls.target).add(offset);
    }
    this.controls.update();
  }
}
