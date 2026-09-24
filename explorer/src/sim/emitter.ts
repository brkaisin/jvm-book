/** A minimal typed event emitter shared by the simulations. */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly handlers: { [K in keyof Events]?: ((e: Events[K]) => void)[] } = {};

  on<K extends keyof Events>(type: K, fn: (e: Events[K]) => void): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(fn);
    return () => {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  protected emit<K extends keyof Events>(type: K, e: Events[K]): void {
    for (const fn of this.handlers[type] ?? []) fn(e);
  }
}
