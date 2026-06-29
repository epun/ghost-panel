import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PromptAnalytics } from '../prompt-analytics.js';

describe('PromptAnalytics', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('normalizes prompts, counts success and failure, tracks first and last seen, and captures intents', () => {
    const analytics = new PromptAnalytics({ telemetry: false });

    analytics.record('Add  CUBE ', { intents: [{ id: 'create' }, { id: '3d.object' }] }, true);
    vi.setSystemTime(new Date('2024-01-01T00:05:00.000Z'));
    analytics.record('add cube', { intents: [{ id: 'ignored' }] }, false);

    const [entry] = analytics.getTop(1);
    expect(entry.prompt).toBe('add cube');
    expect(entry.count).toBe(2);
    expect(entry.successes).toBe(1);
    expect(entry.failures).toBe(1);
    expect(entry.firstSeen).toBe('2024-01-01T00:00:00.000Z');
    expect(entry.lastSeen).toBe('2024-01-01T00:05:00.000Z');
    expect(entry.intents).toEqual(['create', '3d.object']);
  });

  it('sorts top prompts by count and slices the requested size', () => {
    const analytics = new PromptAnalytics({ telemetry: false });
    analytics.record('a', {}, true);
    analytics.record('b', {}, true);
    analytics.record('b', {}, true);
    analytics.record('c', {}, true);
    analytics.record('c', {}, true);
    analytics.record('c', {}, true);

    expect(analytics.getTop(2).map(e => e.prompt)).toEqual(['c', 'b']);
  });

  it('filters unhandled prompts by count and success rate', () => {
    const analytics = new PromptAnalytics({ telemetry: false });
    analytics.record('a', {}, false);
    analytics.record('a', {}, false);
    analytics.record('b', {}, true);
    analytics.record('b', {}, false);
    analytics.record('b', {}, false);
    analytics.record('c', {}, false);

    expect(analytics.getUnhandled(5, 2).map(e => e.prompt)).toEqual(['b', 'a']);
  });

  it('returns a summary shape and clears localStorage', () => {
    const analytics = new PromptAnalytics({ telemetry: false });
    analytics.record('a', {}, true);
    analytics.record('b', {}, false);
    analytics.record('b', {}, false);

    const summary = analytics.getSummary();
    expect(summary.total).toBe(3);
    expect(summary.unique).toBe(2);
    expect(summary.top).toHaveLength(2);
    expect(summary.unhandled).toHaveLength(1);

    analytics.clear();
    expect(analytics.getSummary()).toEqual({ total: 0, unique: 0, top: [], unhandled: [] });
    expect(localStorage.getItem('ghost-panel:prompt-analytics')).toBeNull();
  });

  it('persists and reloads data via localStorage', () => {
    const first = new PromptAnalytics({ telemetry: false });
    first.record('save me', {}, true);

    const second = new PromptAnalytics({ telemetry: false });
    expect(second.getTop(1)[0].prompt).toBe('save me');
    expect(second.getTop(1)[0].count).toBe(1);
  });

  it('falls back to an empty store when localStorage is corrupt', () => {
    localStorage.setItem('ghost-panel:prompt-analytics', '{not-json');
    const analytics = new PromptAnalytics({ telemetry: false });
    expect(analytics.getSummary()).toEqual({ total: 0, unique: 0, top: [], unhandled: [] });
  });
});
