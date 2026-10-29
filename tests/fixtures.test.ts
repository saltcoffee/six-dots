import { describe, expect, it } from 'vitest';
import { benchmarkFixtures } from '../scripts/fixtures.mjs';
import { parseSnapshot } from '../src/editor/markdown';
import { moveBy } from '../src/domain/move';
import { applyEdits } from '../src/domain/block';

describe('repeatable benchmark documents', () => {
  it('builds a 10,000-line mixed note with the expected protected families', () => {
    const fixture = benchmarkFixtures().find(item => item.id === 'P14-MIX')!;
    expect(fixture.text.split('\n')).toHaveLength(10_000);
    expect(Buffer.byteLength(fixture.text)).toBeGreaterThan(900_000);
    const snapshot = parseSnapshot(fixture.text);
    expect(new Set(snapshot.roots.map(block => block.kind))).toEqual(new Set(['heading', 'paragraph', 'list', 'callout', 'quote', 'code', 'protected']));
    expect(snapshot.tableRanges).toHaveLength(200);
  });

  it.each(['paragraph', 'code'])('keeps the complete giant %s intact through an actual move', kind => {
    const fixtures = benchmarkFixtures();
    const solo = fixtures.find(item => item.id === `P14-LARGE-SOLO-${kind}`)!;
    const movable = fixtures.find(item => item.id === `P14-LARGE-MOVE-${kind}`)!;
    const alone = parseSnapshot(solo.text), snapshot = parseSnapshot(movable.text);
    expect(alone.roots).toHaveLength(1);
    expect(moveBy(alone, alone.roots[0]!, -1)).toBeNull();
    const plan = moveBy(snapshot, snapshot.roots[1]!, -1)!;
    expect(plan).not.toBeNull();
    expect(applyEdits(movable.text, plan.edits)).toBe(`${solo.text}\n\nFixed sibling target.`);
  });
});
