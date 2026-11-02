export interface State<C> {
  enter?(ctx: C, prev: string | null, data?: unknown): void;
  update?(ctx: C, dt: number): void;
  exit?(ctx: C, next: string): void;
}

/** Small finite state machine. `ctx` is passed to every state hook. */
export class StateMachine<C> {
  private states = new Map<string, State<C>>();
  private _current: string | null = null;
  private _timeInState = 0;

  constructor(private ctx: C) {}

  add(name: string, state: State<C>): this {
    this.states.set(name, state);
    return this;
  }

  get current(): string | null {
    return this._current;
  }

  /** Milliseconds spent in the current state. */
  get time(): number {
    return this._timeInState;
  }

  is(...names: string[]): boolean {
    return this._current !== null && names.includes(this._current);
  }

  set(name: string, data?: unknown): void {
    const next = this.states.get(name);
    if (!next) throw new Error(`Unknown state: ${name}`);
    const prev = this._current;
    if (prev) this.states.get(prev)?.exit?.(this.ctx, name);
    this._current = name;
    this._timeInState = 0;
    next.enter?.(this.ctx, prev, data);
  }

  update(dt: number): void {
    if (!this._current) return;
    this._timeInState += dt;
    this.states.get(this._current)?.update?.(this.ctx, dt);
  }
}
