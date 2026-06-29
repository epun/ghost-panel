import { downloadBlob, getAllExporters, getAvailableExporters, registerExporter } from '../exports.js';

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
