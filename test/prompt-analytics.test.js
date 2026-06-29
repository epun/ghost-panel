import { PromptAnalytics } from '../prompt-analytics.js';

describe('PromptAnalytics', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records normalized prompts, aggregates counts, persists, and derives intents', () => {
    const analytics = new PromptAnalytics({ telemetry: false });
    const intent = { intents: [{ id: 'add.object' }, { id: 'set.color' }] };

    analytics.record('  Add  CUBE ', intent, true);
    analytics.record('add cube', { intents: [{ id: 'ignored' }] }, false);

    const top = analytics.getTop(1);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({
      prompt: 'add cube',
      intents: ['add.object', 'set.color'],
      count: 2,
      successes: 1,
      failures: 1,
    });
    expect(top[0].firstSeen).toBeTruthy();
    expect(top[0].lastSeen).toBeTruthy();
    expect(localStorage.getItem('ghost-panel:prompt-analytics')).toContain('add cube');

    const loaded = new PromptAnalytics({ telemetry: false });
    expect(loaded.getTop(1)[0]).toMatchObject({
      prompt: 'add cube',
      count: 2,
      successes: 1,
      failures: 1,
    });
  });

  it('sorts top prompts and identifies unhandled prompts by count and success rate', () => {
    const analytics = new PromptAnalytics({ telemetry: false });

    analytics.record('alpha', null, false);
    analytics.record('alpha', null, false);
    analytics.record('beta', null, false);
    analytics.record('beta', null, true);
    analytics.record('beta', null, false);
    analytics.record('gamma', null, true);
    analytics.record('gamma', null, true);

    expect(analytics.getTop(2).map(e => e.prompt)).toEqual(['beta', 'alpha']);
    expect(analytics.getUnhandled(10, 2).map(e => e.prompt)).toEqual(['beta', 'alpha']);
    expect(analytics.getUnhandled(10, 3)).toHaveLength(1);
    expect(analytics.getUnhandled(10, 3)[0]).toMatchObject({
      prompt: 'beta',
      intents: [],
      count: 3,
      successes: 1,
      failures: 2,
    });
  });

  it('summarizes totals, unique entries, top prompts, and unhandled prompts', () => {
    const analytics = new PromptAnalytics({ telemetry: false });
    analytics.record('a', null, false);
    analytics.record('a', null, false);
    analytics.record('b', null, true);
    analytics.record('c', null, false);

    const summary = analytics.getSummary();
    expect(summary.total).toBe(4);
    expect(summary.unique).toBe(3);
    expect(summary.top).toHaveLength(3);
    expect(summary.unhandled.map(e => e.prompt)).toEqual(['a']);
  });

  it('clears memory and localStorage, and falls back to empty state on malformed JSON', () => {
    localStorage.setItem('ghost-panel:prompt-analytics', 'not json');
    const analytics = new PromptAnalytics({ telemetry: false });
    expect(analytics.getSummary()).toEqual({
      total: 0,
      unique: 0,
      top: [],
      unhandled: [],
    });

    analytics.record('x', null, true);
    expect(localStorage.getItem('ghost-panel:prompt-analytics')).toContain('x');

    analytics.clear();
    expect(localStorage.getItem('ghost-panel:prompt-analytics')).toBeNull();
    expect(analytics.getSummary()).toEqual({
      total: 0,
      unique: 0,
      top: [],
      unhandled: [],
    });
  });
});
