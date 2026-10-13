/**
 * Tiny animation toolkit: eased tweens (promise based, interruptible per
 * target/property) and critically-damped-ish springs for interactive motion.
 */

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack:
    (s = 1.70158) =>
    (t: number) => {
      const c3 = s + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
    },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3.2;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

export interface TweenOptions {
  duration: number; // seconds
  delay?: number;
  ease?: Ease;
  onUpdate: (k: number, t: number) => void;
  onComplete?: () => void;
  /** Tweens sharing a key cancel each other (the newest wins). */
  key?: unknown;
}

interface Running {
  opts: TweenOptions;
  elapsed: number;
  resolve: (finished: boolean) => void;
  done: boolean;
}

export interface TweenHandle {
  promise: Promise<boolean>;
  cancel(): void;
}

class Animator {
  private running = new Set<Running>();
  private keyed = new Map<unknown, Running>();

  tween(opts: TweenOptions): TweenHandle {
    let resolve!: (b: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    const run: Running = { opts, elapsed: 0, resolve, done: false };
    if (opts.key !== undefined) {
      const prev = this.keyed.get(opts.key);
      if (prev) this.finish(prev, false);
      this.keyed.set(opts.key, run);
    }
    this.running.add(run);
    if (opts.duration <= 0 && !opts.delay) {
      opts.onUpdate(1, 1);
      this.finish(run, true);
    }
    return { promise, cancel: () => this.finish(run, false) };
  }

  cancel(key: unknown) {
    const prev = this.keyed.get(key);
    if (prev) this.finish(prev, false);
  }

  isRunning(key: unknown) {
    return this.keyed.has(key);
  }

  private finish(run: Running, completed: boolean) {
    if (run.done) return;
    run.done = true;
    this.running.delete(run);
    if (run.opts.key !== undefined && this.keyed.get(run.opts.key) === run) {
      this.keyed.delete(run.opts.key);
    }
    if (completed) run.opts.onComplete?.();
    run.resolve(completed);
  }

  update(dt: number) {
    for (const run of [...this.running]) {
      if (run.done) continue;
      run.elapsed += dt;
      const { delay = 0, duration } = run.opts;
      const local = run.elapsed - delay;
      if (local < 0) continue;
      const t = duration <= 0 ? 1 : Math.min(1, local / duration);
      const k = (run.opts.ease ?? ease.outCubic)(t);
      run.opts.onUpdate(k, t);
      if (t >= 1) this.finish(run, true);
    }
  }
}

export const animator = new Animator();

/** Tween numeric properties of an object; each (object, prop) pair is keyed. */
export function tweenProps<T extends object>(
  target: T,
  to: Partial<Record<keyof T, number>>,
  opts: Omit<TweenOptions, 'onUpdate' | 'key'> & { onUpdate?: () => void },
): Promise<boolean> {
  const keys = Object.keys(to) as (keyof T)[];
  const from = keys.map((k) => target[k] as unknown as number);
  const handle = animator.tween({
    ...opts,
    key: keyFor(target, keys.join(',')),
    onUpdate: (k) => {
      keys.forEach((key, i) => {
        (target as Record<keyof T, number>)[key] = from[i] + ((to[key] as number) - from[i]) * k;
      });
      opts.onUpdate?.();
    },
  });
  return handle.promise;
}

const keyStore = new WeakMap<object, Map<string, object>>();
/** Stable identity for (object, name), usable as a tween key. */
export function keyFor(obj: object, name: string): object {
  let m = keyStore.get(obj);
  if (!m) keyStore.set(obj, (m = new Map()));
  let k = m.get(name);
  if (!k) m.set(name, (k = {}));
  return k;
}

export const wait = (seconds: number) =>
  animator.tween({ duration: seconds, onUpdate: () => {} }).promise;

/** Damped spring for a single value. */
export class Spring {
  value: number;
  target: number;
  velocity = 0;
  constructor(
    value = 0,
    public stiffness = 170,
    public damping = 22,
  ) {
    this.value = value;
    this.target = value;
  }
  update(dt: number) {
    // Sub-step for stability with stiff springs / long frames.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = -this.stiffness * (this.value - this.target) - this.damping * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  snap(v: number) {
    this.value = this.target = v;
    this.velocity = 0;
  }
  get settled() {
    return Math.abs(this.value - this.target) < 1e-4 && Math.abs(this.velocity) < 1e-3;
  }
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (current: number, target: number, lambda: number, dt: number) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
