import { describe, expect, it, vi } from 'vitest';
import { runExtraction } from '../src/application/extraction';

describe('copy-first extraction protocol', () => {
  const steps = () => ({ create: vi.fn(async () => undefined), creationState: vi.fn(async () => 'absent' as const), valid: vi.fn(() => true), verifyTarget: vi.fn(async () => true), commit: vi.fn(() => 'applied' as const) });
  it('creates before replacing the source', async () => {
    const value = steps(); expect(await runExtraction(value)).toBe('success');
    expect(value.create.mock.invocationCallOrder[0]).toBeLessThan(value.commit.mock.invocationCallOrder[0]!);
  });
  it('keeps the source on creation failure', async () => {
    const value = steps(); value.create.mockRejectedValue(new Error('Disk full'));
    expect(await runExtraction(value)).toBe('create-failed'); expect(value.commit).not.toHaveBeenCalled();
  });
  it('does not retry an uncertain creation', async () => {
    const value = { ...steps(), creationState: async () => 'unknown' as const, create: vi.fn(async () => { throw new Error('Unknown result'); }) };
    expect(await runExtraction(value)).toBe('creation-unknown'); expect(value.create).toHaveBeenCalledTimes(1); expect(value.commit).not.toHaveBeenCalled();
  });
  it('treats a failed creation-state check as unknown instead of assuming absence', async () => {
    const value = steps();
    value.create.mockRejectedValue(new Error('Unknown creation result'));
    value.creationState.mockRejectedValue(new Error('Unavailable adapter'));
    expect(await runExtraction(value)).toBe('creation-unknown'); expect(value.commit).not.toHaveBeenCalled();
  });
  it('does not replace a changed or closed source after creation', async () => {
    const value = steps(); value.valid.mockReturnValue(false);
    expect(await runExtraction(value)).toBe('partial'); expect(value.commit).not.toHaveBeenCalled();
  });
  it('rechecks validity after asynchronous target verification', async () => {
    const value = steps(); value.valid.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(await runExtraction(value)).toBe('partial'); expect(value.commit).not.toHaveBeenCalled();
  });
  it('keeps the source if the new note was modified', async () => {
    const value = steps(); value.verifyTarget.mockResolvedValue(false);
    expect(await runExtraction(value)).toBe('target-changed'); expect(value.commit).not.toHaveBeenCalled();
  });
  it('reports divergence without compensating deletes or source overwrites', async () => {
    const value = { ...steps(), commit: vi.fn(() => 'diverged' as const) };
    expect(await runExtraction(value)).toBe('diverged'); expect(value.commit).toHaveBeenCalledTimes(1);
  });
  it('contains failures after successful creation', async () => {
    const value = steps(); value.verifyTarget.mockRejectedValue(new Error('Read failed'));
    expect(await runExtraction(value)).toBe('partial'); expect(value.commit).not.toHaveBeenCalled();
  });
  it('contains errors while inspecting a closed source after creation', async () => {
    const value = steps(); value.valid.mockImplementation(() => { throw new Error('Closed source'); });
    expect(await runExtraction(value)).toBe('partial'); expect(value.commit).not.toHaveBeenCalled();
  });
});
