/**
 * The `profiles` and `feedback` repos (migration `006_profiles_feedback.sql`), against the
 * throwaway in-memory database. No network, no model.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { getDb } from '@/lib/db';
import * as feedback from '@/lib/db/repos/feedback';
import * as profiles from '@/lib/db/repos/profiles';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  getDb().exec('DELETE FROM feedback');
  getDb().exec('DELETE FROM profiles');
});

describe('profiles repo', () => {
  it('returns null for an unknown profile and does not create a row', () => {
    expect(profiles.get(A)).toBeNull();
    expect(profiles.count()).toBe(0);
  });

  it('upsert creates a row with null weights and a zero count, then is idempotent', () => {
    const created = profiles.upsert(A, 1000);
    expect(created).toMatchObject({ id: A, displayName: null, weights: null, feedbackCount: 0 });
    expect(created.createdAt).toBe(1000);

    // A second upsert leaves the row untouched (and does not reset createdAt).
    const again = profiles.upsert(A, 2000);
    expect(again.createdAt).toBe(1000);
    expect(profiles.count()).toBe(1);
  });

  it('setWeights persists the map and count, creating the row if needed', () => {
    profiles.setWeights(A, { rhythmic_character: 9, era: 0 }, 4, 5000);
    const row = profiles.get(A);
    expect(row?.weights).toEqual({ rhythmic_character: 9, era: 0 });
    expect(row?.feedbackCount).toBe(4);
    expect(row?.updatedAt).toBe(5000);
  });

  it('setName sets and clears the display name', () => {
    profiles.setName(A, 'Ada', 1000);
    expect(profiles.get(A)?.displayName).toBe('Ada');
    profiles.setName(A, null, 2000);
    expect(profiles.get(A)?.displayName).toBeNull();
  });

  it('a weights write and a name write on the same profile do not clobber each other', () => {
    profiles.setName(A, 'Ada', 1000);
    profiles.setWeights(A, { rhythmic_character: 7 }, 2, 2000);
    const row = profiles.get(A);
    expect(row?.displayName).toBe('Ada');
    expect(row?.weights).toEqual({ rhythmic_character: 7 });
  });

  it('tolerates unparseable stored weights by reporting null', () => {
    profiles.upsert(A, 1000);
    getDb().prepare('UPDATE profiles SET weights_json = ? WHERE id = ?').run('{not json', A);
    expect(profiles.get(A)?.weights).toBeNull();
  });
});

describe('feedback repo', () => {
  it('records a vote and reads it back', () => {
    const row = feedback.record(
      { profileId: A, seedKey: 's', candidateKey: 'c', label: 'match', source: 'card' },
      1000,
    );
    expect(row).toMatchObject({ profileId: A, seedKey: 's', candidateKey: 'c', label: 'match' });
    expect(feedback.listForProfile(A)).toHaveLength(1);
    expect(feedback.countForProfile(A)).toBe(1);
  });

  it('upserts on (profile, seed, candidate): a later vote REPLACES the earlier one', () => {
    feedback.record({ profileId: A, seedKey: 's', candidateKey: 'c', label: 'match', source: 'card' }, 1000);
    feedback.record({ profileId: A, seedKey: 's', candidateKey: 'c', label: 'not', source: 'card' }, 2000);
    const rows = feedback.listForProfile(A);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('not');
    expect(rows[0].createdAt).toBe(2000);
    expect(feedback.countForProfile(A)).toBe(1);
  });

  it('keeps a different candidate as a separate row', () => {
    feedback.record({ profileId: A, seedKey: 's', candidateKey: 'c1', label: 'match', source: 'card' }, 1000);
    feedback.record({ profileId: A, seedKey: 's', candidateKey: 'c2', label: 'match', source: 'added' }, 1000);
    expect(feedback.countForProfile(A)).toBe(2);
  });

  it('scopes votes to their profile — one browser never reads another', () => {
    feedback.record({ profileId: A, seedKey: 's', candidateKey: 'c', label: 'match', source: 'card' }, 1000);
    feedback.record({ profileId: B, seedKey: 's', candidateKey: 'c', label: 'not', source: 'card' }, 1000);
    expect(feedback.countForProfile(A)).toBe(1);
    expect(feedback.countForProfile(B)).toBe(1);
    expect(feedback.listForProfile(A)[0].label).toBe('match');
    expect(feedback.listForProfile(B)[0].label).toBe('not');
  });

  it('rejects an out-of-range label at the database CHECK', () => {
    expect(() =>
      feedback.record(
        // @ts-expect-error — deliberately invalid label to prove the CHECK guards it
        { profileId: A, seedKey: 's', candidateKey: 'c', label: 'maybe', source: 'card' },
        1000,
      ),
    ).toThrow();
  });
});
