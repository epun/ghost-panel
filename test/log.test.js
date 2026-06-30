import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../log.js';

describe('log', () => {
  beforeEach(() => {
    log.setLevel('info');
    log.setOnError(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    log.setLevel('info');
    log.setOnError(null);
  });

  it('filters by level and reports the current level', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    log.debug('suppressed');
    expect(debugSpy).not.toHaveBeenCalled();

    log.info('visible');
    log.warn('visible');
    log.error('visible');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    log.setLevel('debug');
    expect(log.getLevel()).toBe('debug');
    log.debug('visible too');
    expect(debugSpy).toHaveBeenCalledTimes(1);

    log.setLevel('silent');
    expect(log.getLevel()).toBe('silent');
    log.error('hidden');
    log.warn('hidden');
    log.info('hidden');
    log.debug('hidden');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('prefixes output and supports scoped logging', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    log.scope('undo').warn('failed:', 'boom');
    expect(warnSpy).toHaveBeenCalledWith('[Ghost Panel][undo]', 'failed:', 'boom');

    log.warn('context-menu', 'action failed:', 'boom');
    expect(warnSpy).toHaveBeenCalledWith('[Ghost Panel][context-menu]', 'action failed:', 'boom');
  });

  it('invokes onError only for error-level logs', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    log.setOnError(onError);

    log.debug('skip');
    log.warn('skip');
    log.info('skip');
    expect(onError).not.toHaveBeenCalled();

    const err = new Error('boom');
    log.error('index', 'failed:', err);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('index', 'failed:', err);
    expect(errorSpy).toHaveBeenCalledWith('[Ghost Panel][index]', 'failed:', err);
  });

  it('invokes onError even at silent level, with console suppressed', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    log.setLevel('silent');
    log.setOnError(onError);

    const err = new Error('boom');
    log.error('index', 'failed:', err);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('index', 'failed:', err);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('swallows throwing onError hooks', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.setOnError(() => {
      throw new Error('hook failed');
    });

    expect(() => log.error('index', 'boom')).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('[Ghost Panel][index]', 'boom');
  });

  it('falls back when a console method is missing', () => {
    const originalDebug = console.debug;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    console.debug = undefined;
    log.setLevel('debug');

    try {
      log.debug('fallback');
    } finally {
      console.debug = originalDebug;
    }

    expect(logSpy).toHaveBeenCalledWith('[Ghost Panel]', 'fallback');
  });
});
