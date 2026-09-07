import { describe, expect, it } from 'vitest';

import {
  artistOverlap,
  creditSegments,
  featuredArtists,
  normArtist,
  normTitle,
  sameArtist,
  sameTitle,
  trackNormKey,
} from '@/lib/util/normalize';

describe('normTitle', () => {
  it('lowercases and folds diacritics', () => {
    expect(normTitle('Bad Guy')).toBe('bad guy');
    expect(normTitle('bad guy')).toBe('bad guy');
    expect(normTitle('telepatía')).toBe('telepatia');
  });

  it('drops edition markers in brackets', () => {
    expect(normTitle('Golden Brown (2018 Remaster)')).toBe('golden brown');
    expect(normTitle('Hell [Live]')).toBe('hell');
    expect(normTitle('Lone Digger (Mixed)')).toBe('lone digger');
    expect(normTitle('Fever (feat. Someone)')).toBe('fever');
    expect(normTitle('Zoot Suit Riot (Radio Edit)')).toBe('zoot suit riot');
  });

  it('drops a trailing " - <edition marker>"', () => {
    expect(normTitle('Golden Brown - 2018 Remaster')).toBe('golden brown');
    expect(normTitle('Psycho Killer - 2005 Remastered Version')).toBe('psycho killer');
    expect(normTitle('Fever - Single Version - Mono')).toBe('fever');
  });

  it('keeps a dashed segment that is not an edition marker', () => {
    expect(normTitle('Apple Pie Bed - Reprise')).toBe('apple pie bed reprise');
  });

  it('replaces & with and', () => {
    expect(normTitle('Sugar & Spice')).toBe('sugar and spice');
  });

  it('deletes internal apostrophes and turns other punctuation into space', () => {
    expect(normTitle("Don't Stop")).toBe('dont stop');
    expect(normTitle("Jump, Jive an' Wail")).toBe('jump jive an wail');
    expect(normTitle("Jump Jive An' Wail")).toBe('jump jive an wail');
    expect(normTitle('jump jive an wail')).toBe('jump jive an wail');
  });

  it('does not drop a leading "the" — "The Lovecats" is not "The Love Cats"', () => {
    expect(normTitle('The Lovecats')).toBe('the lovecats');
    expect(normTitle('The Love Cats')).toBe('the love cats');
    expect(normTitle('The Lovecats')).not.toBe(normTitle('The Love Cats'));
  });
});

describe('normArtist', () => {
  it('drops a leading "the"', () => {
    expect(normArtist('The Cure')).toBe('cure');
    expect(normArtist('Cure')).toBe('cure');
    expect(normArtist('The Stranglers')).toBe('stranglers');
  });

  it('cuts at an explicit feature marker', () => {
    expect(normArtist('Kali Uchis feat. Tyler, The Creator')).toBe('kali uchis');
    expect(normArtist('Kali Uchis ft. Someone')).toBe('kali uchis');
    expect(normArtist('Kali Uchis featuring Someone')).toBe('kali uchis');
    expect(normArtist('Kali Uchis (feat. Someone')).toBe('kali uchis');
    expect(normArtist('Kali Uchis [feat. Someone')).toBe('kali uchis');
    expect(normArtist('Kali Uchis (feat. Someone)')).toBe('kali uchis');
  });

  it('cuts at a collaborator comma', () => {
    expect(normArtist('Louis Prima, Keely Smith')).toBe('louis prima');
    expect(normArtist('Peggy Lee, Benny Goodman')).toBe('peggy lee');
  });

  it('keeps "and" / "&" / "with" / "x" INSIDE a band name', () => {
    // The three names the old whole-word cut destroyed.
    expect(normArtist('Florence and the Machine')).toBe('florence and the machine');
    expect(normArtist('Sleeping with Sirens')).toBe('sleeping with sirens');
    expect(normArtist('Earth, Wind & Fire')).toBe('earth wind and fire');

    expect(normArtist('Parov Stelar & Lilja Bloom')).toBe('parov stelar and lilja bloom');
    expect(normArtist('Jay-Z x Kanye West')).toBe('jay z x kanye west');
    expect(normArtist('Peggy Lee with the Benny Goodman Orchestra')).toBe(
      'peggy lee with the benny goodman orchestra',
    );
    expect(normArtist('Crosby, Stills & Nash')).toBe('crosby stills and nash');
  });

  it('normalises "&" and "+" to "and"', () => {
    expect(normArtist('Simon & Garfunkel')).toBe(normArtist('Simon and Garfunkel'));
    expect(normArtist('Simon & Garfunkel')).toBe('simon and garfunkel');
    expect(normArtist('Florence + the Machine')).toBe('florence and the machine');
  });

  it('leaves a name whose separator is not whole-word alone', () => {
    expect(normArtist('Charli XCX')).toBe('charli xcx');
    expect(normArtist('Malcolm X')).toBe('malcolm x');
  });

  it('folds diacritics and punctuation like titles do', () => {
    expect(normArtist('Beyoncé')).toBe('beyonce');
    expect(normArtist("Cherry Poppin' Daddies")).toBe('cherry poppin daddies');
  });
});

describe('sameArtist', () => {
  it('matches across "the", featured artists and case', () => {
    expect(sameArtist('The Cure', 'Cure')).toBe(true);
    expect(sameArtist('the cure', 'The Cure')).toBe(true);
    expect(sameArtist('The Cure', 'The Cure feat. Somebody')).toBe(true);
    expect(sameArtist('Billie Eilish', 'Billie Eilish')).toBe(true);
  });

  it('does not match different artists', () => {
    expect(sameArtist('The Cure', 'The Smiths')).toBe(false);
    expect(sameArtist('', 'The Cure')).toBe(false);
  });
});

describe('artistOverlap', () => {
  it('matches when one credit contains the other as whole tokens', () => {
    expect(artistOverlap('The Cure', 'The Cure & Siouxsie')).toBe(true);
    expect(artistOverlap('The Cure & Siouxsie', 'Cure')).toBe(true);
    expect(artistOverlap('Florence and the Machine', 'Florence + The Machine')).toBe(true);
    expect(artistOverlap('Louis Prima', 'Louis Prima, Keely Smith')).toBe(true);
  });

  it('does not match unrelated or merely prefix-shaped names', () => {
    expect(artistOverlap('The Cure', 'The Smiths')).toBe(false);
    expect(artistOverlap('Cure', 'Curer')).toBe(false);
    expect(artistOverlap('Sleeping with Sirens', 'Sleeping at Last')).toBe(false);
    expect(artistOverlap('', 'The Cure')).toBe(false);
  });

  it('only relates "Florence" to "Florence and the Machine" because it is a whole token', () => {
    // The old normArtist truncated the band to "florence" and collided by accident.
    expect(normArtist('Florence and the Machine')).not.toBe(normArtist('Florence'));
    expect(sameArtist('Florence and the Machine', 'Florence')).toBe(false);
    expect(artistOverlap('Florence and the Machine', 'Florence')).toBe(true);
  });
});

describe('sameTitle', () => {
  it('matches through remasters, case and diacritics', () => {
    expect(sameTitle('Golden Brown - 2018 Remaster', 'Golden Brown')).toBe(true);
    expect(sameTitle('bad guy', 'Bad Guy')).toBe(true);
    expect(sameTitle('telepatía', 'telepatia')).toBe(true);
    expect(sameTitle("Jump, Jive an' Wail", "Jump Jive An' Wail")).toBe(true);
    expect(sameTitle("Jump, Jive an' Wail", 'jump jive an wail')).toBe(true);
  });

  it('does NOT collapse "The Lovecats" and "The Love Cats"', () => {
    expect(sameTitle('The Lovecats', 'The Love Cats')).toBe(false);
  });

  it('rejects a different song that merely starts the same', () => {
    expect(sameTitle('Close to Me', 'Close to Me but Longer')).toBe(false);
    expect(sameTitle('Hell', 'Hello')).toBe(false);
  });

  it('tolerates a short trailing remainder of separator debris', () => {
    expect(sameTitle('Fever', 'Fever ...')).toBe(true);
  });
});

describe('trackNormKey', () => {
  it('joins the normalised primary artist and title', () => {
    expect(trackNormKey('The Cure', 'The Lovecats')).toBe('cure|the lovecats');
    expect(trackNormKey('The Cure feat. X', 'The Lovecats (2006 Remaster)')).toBe(
      'cure|the lovecats',
    );
  });
});

/* ------------------------------------------------------------------------------------ *
 * Credit segmentation — the fix for the Stage-4 impersonation class
 * ------------------------------------------------------------------------------------ */

describe('creditSegments', () => {
  it('splits a credit at explicit joiners only', () => {
    expect(creditSegments('The Avener & Waldeck')).toEqual(['avener', 'waldeck']);
    expect(creditSegments('Florence + the Machine')).toEqual(['florence', 'machine']);
    expect(creditSegments('Jay-Z x Kanye West')).toEqual(['jay z', 'kanye west']);
    expect(creditSegments('Haley Reinhart, Wheeling High School Jazz Combo & Brian Logan'))
      .toEqual(['haley reinhart', 'wheeling high school jazz combo', 'brian logan']);
  });

  it('leaves a name with no joiner whole — the point of the whole exercise', () => {
    expect(creditSegments('Sia Momo')).toEqual(['sia momo']);
    expect(creditSegments('Prince Buster')).toEqual(['prince buster']);
    expect(creditSegments('Various Artists')).toEqual(['various artists']);
    // "AC/DC" and "Malcolm X" must survive: a slash is not a joiner, and `x` needs
    // whitespace on both sides.
    expect(creditSegments('AC/DC')).toEqual(['ac dc']);
    expect(creditSegments('Malcolm X')).toEqual(['malcolm x']);
  });
});

describe('featuredArtists', () => {
  it('names the guests a title credits', () => {
    expect(featuredArtists('Creep (feat. Haley Reinhart)')).toEqual(['haley reinhart']);
    expect(featuredArtists('How Deep Is the Ocean feat. Peggy Lee')).toEqual(['peggy lee']);
    expect(featuredArtists('Titanium ft. Sia & David Guetta')).toEqual(['sia', 'david guetta']);
  });

  it('is empty when nothing is credited', () => {
    expect(featuredArtists('The Lovecats')).toEqual([]);
    expect(featuredArtists('Lone Digger (Mixed)')).toEqual([]);
  });
});

describe('artistOverlap does NOT admit an impersonation', () => {
  // Every one of these was TRUE under the old whole-token-run test, and each is a way for
  // Stage 4 to certify a different artist. Single-token acts are the common case.
  it.each([
    ['Sia Momo', 'Sia'],
    ['Prince Buster', 'Prince'],
    ['Air Supply', 'Air'],
    ['Cream Soda', 'Cream'],
    ['Kiss The Anus Of A Black Cat', 'Kiss'],
    ['Various Artists', 'Artists'],
    ['Hell on Wheels', 'Hell'],
    ['Peggy Lee', 'Lee'],
    ['Parov Stelar Trio', 'Parov Stelar'],
  ])('rejects %s vs %s', (a, b) => {
    expect(artistOverlap(a, b)).toBe(false);
    expect(artistOverlap(b, a)).toBe(false);
  });

  it('still accepts a name carrying EXTRA credited acts', () => {
    expect(artistOverlap('The Avener & Waldeck', 'Waldeck')).toBe(true);
    expect(artistOverlap('Caravan Palace & Charles X', 'Caravan Palace')).toBe(true);
    expect(artistOverlap('Louis Prima, Keely Smith', 'Louis Prima')).toBe(true);
  });
});

describe('the serial-comma guard only protects a short band name', () => {
  it('keeps the real ones whole', () => {
    expect(normArtist('Earth, Wind & Fire')).toBe('earth wind and fire');
    expect(normArtist('Crosby, Stills & Nash')).toBe('crosby stills and nash');
    expect(normArtist('Blood, Sweat & Tears')).toBe('blood sweat and tears');
    expect(normArtist('Emerson, Lake and Palmer')).toBe('emerson lake and palmer');
  });

  it('cuts a long list of collaborators that happens to contain "and"', () => {
    expect(normArtist('Haley Reinhart, Wheeling High School Jazz Combo & Brian Logan'))
      .toBe('haley reinhart');
  });
});
