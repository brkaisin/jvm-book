// Short-lived feedback in the world: a ripple where you clicked, and bursts
// of sparks that show something travelling (a call, an allocation...).

import * as THREE from 'three';
import { Sparks, type Part } from './fx';

let ringTex: THREE.Texture | null = null;
function ringTexture(): THREE.Texture {
  if (ringTex) return ringTex;
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.lineWidth = 7;
  g.shadowColor = '#fff';
  g.shadowBlur = 12;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 14, 0, Math.PI * 2);
  g.stroke();
  ringTex = new THREE.CanvasTexture(cv);
  return ringTex;
}

interface Ripple {
  sprite: THREE.Sprite;
  t: number;
  size: number;
}

export class Effects implements Part {
  private readonly sparks: Sparks;
  private readonly ripples: Ripple[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.sparks = new Sparks(scene);
  }

  /** An expanding ring at `at`: "you touched this". */
  ripple(at: THREE.Vector3, color: THREE.ColorRepresentation, size = 5): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    sprite.position.copy(at);
    this.scene.add(sprite);
    this.ripples.push({ sprite, t: 0, size });
  }

  /** `n` sparks from `from` to `to`, slightly staggered and spread. */
  burst(from: THREE.Vector3, to: THREE.Vector3, color: THREE.ColorRepresentation, n = 5, o: { lift?: number; spread?: number; duration?: number } = {}): void {
    for (let i = 0; i < n; i++) {
      const jitter = new THREE.Vector3().randomDirection().multiplyScalar(o.spread ?? 1.5);
      window.setTimeout(
        () => this.sparks.launch(from, to.clone().add(jitter), { color, lift: o.lift ?? 5, duration: o.duration ?? 0.9, size: 1.8 }),
        i * 70,
      );
    }
  }

  /** A chain of hops, each leg starting when the previous one lands. */
  chain(points: THREE.Vector3[], color: THREE.ColorRepresentation, legSeconds = 0.6): void {
    const leg = (i: number) => {
      if (i >= points.length - 1) return;
      this.sparks.launch(points[i], points[i + 1], { color, lift: 3, duration: legSeconds, size: 2.4, onDone: () => leg(i + 1) });
    };
    leg(0);
  }

  update(dt: number): void {
    this.sparks.update(dt);
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += dt / 0.7;
      r.sprite.scale.setScalar(r.size * (0.3 + r.t * 1.4));
      (r.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - r.t);
      if (r.t >= 1) {
        this.scene.remove(r.sprite);
        r.sprite.material.dispose();
        this.ripples.splice(i, 1);
      }
    }
  }
}
