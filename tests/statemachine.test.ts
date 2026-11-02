import { describe, it, expect } from 'vitest';
import { StateMachine } from '../src/core/StateMachine';

describe('StateMachine', () => {
  it('calls enter/exit/update and tracks time', () => {
    const log: string[] = [];
    const fsm = new StateMachine({ n: 0 });
    fsm
      .add('a', { enter: () => log.push('enter a'), exit: (_c, next) => log.push(`exit a->${next}`), update: (c) => c.n++ })
      .add('b', { enter: (_c, prev) => log.push(`enter b from ${prev}`) });
    fsm.set('a');
    fsm.update(16);
    fsm.update(16);
    expect(fsm.time).toBe(32);
    fsm.set('b');
    expect(fsm.time).toBe(0);
    expect(fsm.is('b')).toBe(true);
    expect(log).toEqual(['enter a', 'exit a->b', 'enter b from a']);
  });
  it('throws on unknown state', () => {
    expect(() => new StateMachine({}).set('nope')).toThrow();
  });
});
