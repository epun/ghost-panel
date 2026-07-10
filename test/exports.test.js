import { describe, expect, it, vi } from 'vitest';
import { downloadBlob, getAllExporters, getAvailableExporters, registerExporter, runExport } from '../exports.js';

// A minimal graph-editor stand-in exposing the same surface the exporters
// read: getSettings() (duration / fps / loop) plus track accessors.
function fakeEditor({ settings = {}, tracks = [] } = {}) {
  return {
    getSettings: () => settings,
    getTime: () => 0,
    getDuration: () => settings.duration,
    getTracks: () => tracks.map(t => ({ name: t.name, color: t.color, keys: t.keys })),
    getTracksFull: () => tracks,
  };
}

// A web-bound track (adapter object with _el + x/y) so the CSS / WAAPI
// exporters treat the group as a DOM target and emit real rules.
function webTrack(name, keys) {
  const obj = { _el: {}, name: name.split('.')[0], x: 0, y: 0 };
  return { name, color: '#fff', keys, binding: { object: obj, path: name.split('.')[1] || name } };
}

function blobText(blob) {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsText(blob);
  });
}

async function runToText(ui, id) {
  const { blob } = await runExport(ui, id, { skipDownload: true });
  return blobText(blob);
}

describe('exports registry', () => {
  it('returns a copy of all exporters and includes the built-ins', () => {
    const all = getAllExporters();
    const ids = all.map(e => e.id);

    expect(all.length).toBeGreaterThan(0);
    expect(ids).toEqual(expect.arrayContaining(['json', 'png', 'webm', 'glb', 'obj', 'svg', 'html-snippet']));

    all.push({ id: 'mutated' });
    expect(getAllExporters().some(e => e.id === 'mutated')).toBe(false);
  });

  it('returns all exporters for an empty workflow list', () => {
    const all = getAllExporters();
    const available = getAvailableExporters([]);

    expect(available).toEqual(all);
    expect(available).not.toBe(all);
  });

  it('filters exporters by workflow and keeps universal and workflow-less exporters', () => {
    const suffix = Math.random().toString(36).slice(2);
    const workflowlessId = `workflowless-${suffix}`;
    const universalId = `universal-${suffix}`;
    const excludedId = `excluded-${suffix}`;

    registerExporter({ id: workflowlessId, label: 'Workflowless', workflows: undefined, run: async () => ({ blob: new Blob(['x']), filename: 'x.txt' }) });
    registerExporter({ id: universalId, label: 'Universal', workflows: ['*'], run: async () => ({ blob: new Blob(['x']), filename: 'x.txt' }) });
    registerExporter({ id: excludedId, label: 'Excluded', workflows: ['web'], run: async () => ({ blob: new Blob(['x']), filename: 'x.txt' }) });

    const available = getAvailableExporters(['3d']).map(e => e.id);
    expect(available).toEqual(expect.arrayContaining(['json', 'png', 'webm', 'glb', 'obj', 'html-snippet', workflowlessId, universalId]));
    expect(available).not.toContain('svg');
    expect(available).not.toContain(excludedId);
  });

  it('registers custom exporters and makes them available for matching workflows', () => {
    const id = `custom-${Math.random().toString(36).slice(2)}`;
    const exporter = { id, label: 'Custom', workflows: ['test-workflow'], run: async () => ({ blob: new Blob(['ok'], { type: 'text/plain' }), filename: 'custom.txt' }) };

    expect(registerExporter(exporter)).toBe(exporter);
    expect(getAvailableExporters(['test-workflow']).some(e => e.id === id)).toBe(true);
  });

  it('animation-json export carries the panel duration / fps / loop settings', async () => {
    const ui = { _graphEditor: fakeEditor({
      settings: { duration: 3.5, fps: 24, loop: 2 },
      tracks: [{ name: 'position.x', color: '#f00', keys: [{ time: 0, value: 0 }, { time: 3.5, value: 5 }] }],
    }) };

    const data = JSON.parse(await runToText(ui, 'animation-json'));
    expect(data.duration).toBe(3.5);
    expect(data.fps).toBe(24);
    expect(data.loop).toBe(2);
    expect(data.tracks).toHaveLength(1);
    // Regression: duration used to always serialize as undefined and drop out.
    expect('duration' in data).toBe(true);
  });

  it('CSS @keyframes export uses the panel duration and loop count', async () => {
    const ui = { _graphEditor: fakeEditor({
      settings: { duration: 4, fps: 30, loop: 3 },
      tracks: [webTrack('box.x', [{ time: 0, value: 0 }, { time: 2, value: 100 }])],
    }) };

    const css = await runToText(ui, 'css-keyframes');
    // 4s panel timeline wins over the 2s max keyframe time.
    expect(css).toContain('4.000s');
    // Finite loop → explicit iteration count, not `infinite`.
    expect(css).toMatch(/linear 3;/);
    expect(css).not.toContain('infinite');
  });

  it('CSS @keyframes export loops forever when loop is true', async () => {
    const ui = { _graphEditor: fakeEditor({
      settings: { duration: 2, loop: true },
      tracks: [webTrack('box.x', [{ time: 0, value: 0 }, { time: 2, value: 100 }])],
    }) };

    const css = await runToText(ui, 'css-keyframes');
    expect(css).toContain('infinite');
  });

  it('WAAPI export mirrors the panel duration and finite iteration count', async () => {
    const ui = { _graphEditor: fakeEditor({
      settings: { duration: 5, loop: 4 },
      tracks: [webTrack('box.x', [{ time: 0, value: 0 }, { time: 2, value: 100 }])],
    }) };

    const js = await runToText(ui, 'waapi');
    expect(js).toContain('duration: 5000');
    expect(js).toContain('iterations: 4');
    expect(js).not.toContain('Infinity');
  });

  it('WAAPI export falls back to infinite iterations when loop is unset', async () => {
    const ui = { _graphEditor: fakeEditor({
      settings: { duration: 1 },
      tracks: [webTrack('box.x', [{ time: 0, value: 0 }, { time: 1, value: 100 }])],
    }) };

    const js = await runToText(ui, 'waapi');
    expect(js).toContain('iterations: Infinity');
  });

  it('downloads blobs and strings through a temporary anchor and revokes the URL', () => {
    vi.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock-url'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const removeSpy = vi.spyOn(HTMLAnchorElement.prototype, 'remove');

    downloadBlob('hello', 'hello.txt', 'text/plain');

    expect(createSpy).toHaveBeenCalledTimes(1);
    const blob = createSpy.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');
    expect(appendSpy).toHaveBeenCalledTimes(1);
    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.tagName).toBe('A');
    expect(anchor.download).toBe('hello.txt');
    expect(anchor.href).toBe('blob:mock-url');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);

    expect(revokeSpy).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeSpy).toHaveBeenCalledWith('blob:mock-url');

    vi.useRealTimers();
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    appendSpy.mockRestore();
    clickSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
