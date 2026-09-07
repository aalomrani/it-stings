import { describe, expect, it } from 'vitest';

import { newPlaylistId, newRunId, sha1, stableHash, stableStringify } from '@/lib/util/ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('ids', () => {
  it('prefixes playlist and run ids with a uuid', () => {
    const pl = newPlaylistId();
    const run = newRunId();
    expect(pl.startsWith('pl_')).toBe(true);
    expect(run.startsWith('run_')).toBe(true);
    expect(pl.slice(3)).toMatch(UUID);
    expect(run.slice(4)).toMatch(UUID);
    expect(newPlaylistId()).not.toBe(pl);
  });
});

describe('sha1 / stableHash', () => {
  it('hashes deterministically', () => {
    expect(sha1('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1('abc')).toBe(sha1('abc'));
    expect(sha1('abd')).not.toBe(sha1('abc'));
  });

  it('ignores object key order and undefined values', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(stableHash({ a: 1, b: [1, 2] })).toBe(stableHash({ b: [1, 2], a: 1 }));
    expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it('keeps array order significant', () => {
    expect(stableHash([1, 2])).not.toBe(stableHash([2, 1]));
  });
});
