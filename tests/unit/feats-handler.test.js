import '../setup.js';

// Helpers to create mock actors/tokens with feats
function createActorWithFeats(slugs = []) {
  const items = slugs.map((slug) => ({ type: 'feat', system: { slug } }));
  return {
    items,
    system: { attributes: {} },
  };
}

function createTokenWithActorFeats(slugs = []) {
  return { actor: createActorWithFeats(slugs) };
}

describe('FeatsHandler - all feats coverage', () => {
  let FeatsHandler;

  beforeAll(() => {
    // Use CJS require pattern; the module exports both named and default
    const mod = require('../../scripts/chat/services/feats-handler.js');
    FeatsHandler = mod.FeatsHandler || mod.default || mod;
  });

  describe('core utilities', () => {
    test('applyOutcomeShift respects ordering and clamps to bounds', () => {
      expect(FeatsHandler.applyOutcomeShift('failure', +1)).toBe('success');
      expect(FeatsHandler.applyOutcomeShift('success', -1)).toBe('failure');
      expect(FeatsHandler.applyOutcomeShift('critical-failure', -1)).toBe('critical-failure');
      expect(FeatsHandler.applyOutcomeShift('critical-success', +1)).toBe('critical-success');
    });

    test('hasFeat normalizes various slug variants', () => {
      const actor = createActorWithFeats(["that's-odd", 'keen-eyes']);
      expect(FeatsHandler.hasFeat(actor, "thats-odd")).toBe(true);
      expect(FeatsHandler.hasFeat(actor, "That’s Odd")).toBe(true);
      expect(FeatsHandler.hasFeat(actor, 'keen-eyes')).toBe(true);
      expect(FeatsHandler.hasFeat(actor, ['not-a-feat', 'keen-eyes'])).toBe(true);
      expect(FeatsHandler.hasFeat(actor, 'missing')).toBe(false);
    });
  });

  describe('sneak feat adjusters', () => {
    test('terrain-stalker shifts in matching terrain', () => {
      const actor = createActorWithFeats(['terrain-stalker']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'sneak', { terrainMatches: true });
      expect(shift).toBe(1);
    });

    test('foil-senses grants +1', () => {
      const actor = createActorWithFeats(['foil-senses']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'sneak', {});
      expect(shift).toBe(1);
    });

    test('vanish-into-the-land grants +1 in natural terrain and improves concealment on success', () => {
      const actor = createActorWithFeats(['vanish-into-the-land']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'sneak', { inNaturalTerrain: true });
      expect(shift).toBe(1);

      // adjustVisibility one step toward higher concealment on success
      const adjusted = FeatsHandler.adjustVisibility(
        'sneak',
        actor,
        'observed',
        'hidden',
        { inNaturalTerrain: true, outcome: 'success' },
      );
      expect(adjusted).toBe('undetected');
    });

    test('legendary-sneak / very-sneaky / very-very-sneaky each add +1 and clamp total shift', () => {
      const actor = createActorWithFeats(['legendary-sneak', 'very-sneaky', 'very-very-sneaky']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'sneak', {});
      // would be +3 unbounded; handler clamps overall to +2
      expect(shift).toBe(2);
    });

    test('distracting-shadows grants +1 in dim or darker', () => {
      const actor = createActorWithFeats(['distracting-shadows']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'sneak', { inDimOrDarker: true });
      expect(shift).toBe(1);
    });

    test('ceaseless-shadows grants +1 when moving through shadowy areas', () => {
      const actor = createActorWithFeats(['ceaseless-shadows']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'sneak', { inShadowyMovement: true });
      expect(shift).toBe(1);
    });

    test('shadow-self grants +1 in dim or darker', () => {
      const actor = createActorWithFeats(['shadow-self']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'sneak', { inDimOrDarker: true });
      expect(shift).toBe(1);
    });

    test('forest-stealth and swamp-stealth grant +1 in matching terrain tags', () => {
      const forestActor = createActorWithFeats(['forest-stealth']);
      const swampActor = createActorWithFeats(['swamp-stealth']);
      expect(FeatsHandler.getOutcomeAdjustment(forestActor, 'sneak', { terrainTag: 'forest' }).shift).toBe(1);
      expect(FeatsHandler.getOutcomeAdjustment(swampActor, 'sneak', { terrainTag: 'swamp' }).shift).toBe(1);
      // non-matching
      expect(FeatsHandler.getOutcomeAdjustment(forestActor, 'sneak', { terrainTag: 'swamp' }).shift).toBe(0);
    });
  });

  describe('hide feat adjusters', () => {
    test('terrain-stalker, foil-senses, vanish-into-the-land apply on hide', () => {
      const actor = createActorWithFeats(['terrain-stalker', 'foil-senses', 'vanish-into-the-land']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'hide', {
        terrainMatches: true,
        inNaturalTerrain: true,
      });
      // +1 +1 +1 = 3 but clamped to 2
      expect(shift).toBe(2);
    });

    test('vanish-into-the-land improves concealment ladder on hide success', () => {
      const actor = createActorWithFeats(['vanish-into-the-land']);
      const adjusted = FeatsHandler.adjustVisibility('hide', actor, 'observed', 'concealed', {
        inNaturalTerrain: true,
        outcome: 'success',
      });
      expect(adjusted).toBe('hidden');
    });
  });

  describe('seek feat adjusters and visibility', () => {
    test("that's-odd increases shift against anomalies and improves visibility one step", () => {
      const actor = createActorWithFeats(["that's-odd"]);
      const ctx = { subjectType: 'hazard' };
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'seek', ctx);
      expect(shift).toBe(1);

      // Adjust visibility: from hidden -> observed one step (hidden -> observed ladder)
      const adjusted1 = FeatsHandler.adjustVisibility('seek', actor, 'hidden', 'hidden', ctx);
      expect(adjusted1).toBe('observed');

      // Also when undetected -> hidden
      const adjusted2 = FeatsHandler.adjustVisibility('seek', actor, 'undetected', 'undetected', ctx);
      expect(adjusted2).toBe('hidden');
    });

    test('keen-eyes has no shift but improves visibility on seek', () => {
      const actor = createActorWithFeats(['keen-eyes']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'seek', {});
      expect(shift).toBe(0);

      const adjusted1 = FeatsHandler.adjustVisibility('seek', actor, 'hidden', 'hidden', {});
      expect(adjusted1).toBe('observed');

      const adjusted2 = FeatsHandler.adjustVisibility('seek', actor, 'undetected', 'undetected', {});
      expect(adjusted2).toBe('hidden');
    });
  });

  describe('create-a-diversion feat adjusters and visibility', () => {
    test('cunning-distraction adds +1 shift', () => {
      const actor = createActorWithFeats(['cunning-distraction']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'create-a-diversion', {});
      expect(shift).toBe(1);
    });

    test('distracting-shadows and shadow-self add +1 in dim and step one toward observed on visibility', () => {
      const actor = createActorWithFeats(['distracting-shadows', 'shadow-self']);
      const ctx = { inDimOrDarker: true };
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'create-a-diversion', ctx);
      // +1 +1 = 2 but clamp to +2 (still 2)
      expect(shift).toBe(2);

      // adjustVisibility: e.g., hidden -> observed ladder step (hidden -> observed)
      const adjusted = FeatsHandler.adjustVisibility('create-a-diversion', actor, 'hidden', 'hidden', ctx);
      expect(adjusted).toBe('observed');
    });
  });

  describe('multi-feat accumulation and clamp', () => {
    test('multiple sneak feats accumulate but clamp to +2', () => {
      const actor = createActorWithFeats([
        'terrain-stalker',
        'foil-senses',
        'legendary-sneak',
        'very-sneaky',
        'very-very-sneaky',
      ]);
      const { shift } = FeatsHandler.getOutcomeAdjustment(actor, 'sneak', { terrainMatches: true });
      expect(shift).toBe(2);

      const base = 'failure';
      const outcome = FeatsHandler.applyOutcomeShift(base, shift);
      // failure shifted by +2 -> critical-success per ordered list
      expect(outcome).toBe('critical-success');
    });
  });

  describe('token vs actor input', () => {
    test('resolve actor from token works', () => {
      const token = createTokenWithActorFeats(['foil-senses']);
      const { shift } = FeatsHandler.getOutcomeAdjustment(token, 'sneak', {});
      expect(shift).toBe(1);
    });
  });
});
