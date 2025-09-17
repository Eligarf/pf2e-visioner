/**
 * FeatsHandler
 *
 * Purpose:
 * - Inspect an actor for specific PF2e feats that can influence outcome levels
 *   of supported actions (initial focus: Sneak/Hide).
 * - Provide adjustment hooks returning a delta to apply to the computed outcome.
 *
 * Conventions:
 * - Outcome levels ordered: critical-failure < failure < success < critical-success
 * - Adjustment returns an integer shift in this order: e.g., +1 means one step up.
 * - Unknown feats or actions result in a 0 shift.
 */


const OUTCOME_ORDER = ['critical-failure', 'failure', 'success', 'critical-success'];

/**
 * Resolve an Actor from a token or actor reference.
 * @param {Token|Actor} tokenOrActor
 * @returns {Actor|null}
 */
class FeatsHandlerInternal {
  static resolveActor(tokenOrActor) {
    if (!tokenOrActor) return null;
    if (tokenOrActor.actor) return tokenOrActor.actor;
    if (tokenOrActor.document?.actor) return tokenOrActor.document.actor;
    if (tokenOrActor.system?.attributes) return tokenOrActor;
    return null;
  }
}

/**
 * Extract feat slugs present on the actor.
 * Supports PF2e system item structure: item.type === 'feat' and item.system.slug
 * @param {Actor} actor
 * @returns {Set<string>}
 */
function getActorFeatSlugs(actor) {
  try {
    const items = actor?.items ?? [];
    const slugs = new Set();
    for (const item of items) {
      if (item?.type !== 'feat') continue;
      const raw = item.system?.slug ?? item.slug ?? item.name?.toLowerCase()?.replace(/\s+/g, '-');
      const slug = normalizeSlug(raw);
      if (slug) slugs.add(slug);
    }
    return slugs;
  } catch (e) {
    console.warn('PF2E Visioner | Failed to read actor feats:', e);
    return new Set();
  }
}

/**
 * Mapping of supported feats to adjustment logic.
 * Keys are feat slugs. Values are functions returning integer outcome shift for given context.
 */
// Simple outcome shift adjusters per action
const SNEAK_FEAT_ADJUSTERS = {
  // Examples: These are conservative interpretations meant to be refined.
  'terrain-stalker': (ctx) => (ctx.terrainMatches ? +1 : 0),
  'foil-senses': () => +1,
  'vanish-into-the-land': (ctx) => (ctx.inNaturalTerrain ? +1 : 0),
  'legendary-sneak': () => +1,
  'very-sneaky': () => +1,
  'very-very-sneaky': () => +1,
  'distracting-shadows': (ctx) => (ctx.inDimOrDarker ? +1 : 0),
  'ceaseless-shadows': (ctx) => (ctx.inShadowyMovement ? +1 : 0),
  'shadow-self': (ctx) => (ctx.inDimOrDarker ? +1 : 0),
  'forest-stealth': (ctx) => (ctx.terrainTag === 'forest' ? +1 : 0),
  'swamp-stealth': (ctx) => (ctx.terrainTag === 'swamp' ? +1 : 0),
};

const HIDE_FEAT_ADJUSTERS = {
  'terrain-stalker': (ctx) => (ctx.terrainMatches ? +1 : 0),
  'foil-senses': () => +1,
  'vanish-into-the-land': (ctx) => (ctx.inNaturalTerrain ? +1 : 0),
  'legendary-sneak': () => +1,
  'forest-stealth': (ctx) => (ctx.terrainTag === 'forest' ? +1 : 0),
  'swamp-stealth': (ctx) => (ctx.terrainTag === 'swamp' ? +1 : 0),
};

const SEEK_FEAT_ADJUSTERS = {
  // These mostly post-process visibility, but small shift can represent stronger detection
  'thats-odd': (ctx) => (ctx.isHiddenWall || ctx.subjectType === 'hazard' || ctx.subjectType === 'loot' ? +1 : 0),
  'keen-eyes': () => 0, // handled in visibility post-processing
};

const DIVERSION_FEAT_ADJUSTERS = {
  'cunning-distraction': () => +1,
  'distracting-shadows': (ctx) => (ctx.inDimOrDarker ? +1 : 0),
  'shadow-self': (ctx) => (ctx.inDimOrDarker ? +1 : 0),
};

function normalizeSlug(nameOrSlug = '') {
  try {
    const lower = String(nameOrSlug).toLowerCase();
    // unify curly apostrophes to straight and then remove all apostrophes
    const noApos = lower.replace(/\u2019/g, "'").replace(/'+/g, '');
    // replace any remaining non-alphanumeric with single hyphens
    const dashed = noApos.replace(/[^a-z0-9]+/g, '-');
    // trim leading/trailing hyphens
    return dashed.replace(/^-+|-+$/g, '');
  } catch {
    return nameOrSlug;
  }
}


function getAdjusterMapForAction(action) {
  switch (action) {
    case 'sneak':
      return SNEAK_FEAT_ADJUSTERS;
    case 'hide':
      return HIDE_FEAT_ADJUSTERS;
    case 'seek':
      return SEEK_FEAT_ADJUSTERS;
    case 'create-a-diversion':
      return DIVERSION_FEAT_ADJUSTERS;
    default:
      return null;
  }
}

/**
 * Compute the total outcome adjustment for the given action.
 * @param {Token|Actor} tokenOrActor - Acting creature
 * @param {string} action - e.g., 'sneak', 'hide'
 * @param {object} context - environment context (lighting, terrain, observer senses)
 * @returns {{ shift: number, notes: string[] }} - Net shift and contributing notes
 */
export class FeatsHandler {
  /**
   * Compute the total outcome adjustment for the given action.
   * @param {Token|Actor} tokenOrActor - Acting creature
   * @param {string} action - e.g., 'sneak', 'hide'
   * @param {object} context - environment context (lighting, terrain, observer senses)
   * @returns {{ shift: number, notes: string[] }} - Net shift and contributing notes
   */
  static getOutcomeAdjustment(tokenOrActor, action, context = {}) {
    const actor = FeatsHandlerInternal.resolveActor(tokenOrActor);
    if (!actor) return { shift: 0, notes: [] };

    const featSlugs = getActorFeatSlugs(actor);
    let shift = 0;
    const notes = [];

    const map = getAdjusterMapForAction(action);
    if (!map || featSlugs.size === 0) return { shift, notes };

    for (const [slug, adjust] of Object.entries(map)) {
      if (!featSlugs.has(slug)) continue;
      try {
        const delta = Number(adjust(context) || 0);
        if (!Number.isFinite(delta) || delta === 0) continue;
        shift += delta;
        notes.push(`Feat '${slug}' adjusted outcome by ${delta > 0 ? '+' : ''}${delta}`);
      } catch (e) {
        console.warn(`PF2E Visioner | Error evaluating feat '${slug}':`, e);
      }
    }

    // Clamp shift between -2 and +2 (avoid extreme leaps); tuning knob
    shift = Math.max(-2, Math.min(2, shift));
    return { shift, notes };
  }

  /**
   * Apply an outcome shift to a base outcome string.
   * @param {('critical-failure'|'failure'|'success'|'critical-success')} base
   * @param {number} shift
   */
  static applyOutcomeShift(base, shift) {
    const idx = OUTCOME_ORDER.indexOf(base);
    if (idx < 0 || !Number.isFinite(shift) || shift === 0) return base;
    const newIdx = Math.max(0, Math.min(OUTCOME_ORDER.length - 1, idx + shift));
    return OUTCOME_ORDER[newIdx];
  }

  /**
   * Check if the actor has a feat by slug (or any of slugs)
   */
  static hasFeat(tokenOrActor, slugOrSlugs) {
    const actor = FeatsHandlerInternal.resolveActor(tokenOrActor);
    if (!actor) return false;
    const featSlugs = getActorFeatSlugs(actor);
    if (Array.isArray(slugOrSlugs)) {
      return slugOrSlugs.some((s) => featSlugs.has(normalizeSlug(s)));
    }
    return featSlugs.has(normalizeSlug(slugOrSlugs));
  }

  /**
   * Post-process visibility result for feat effects that target visibility directly.
   * Returns possibly adjusted visibility string.
   */
  static adjustVisibility(action, tokenOrActor, current, newVisibility, context = {}) {
    const actor = FeatsHandlerInternal.resolveActor(tokenOrActor);
    if (!actor) return newVisibility;
    const feats = getActorFeatSlugs(actor);

    // Helper ladders
    const towardsObserved = ['undetected', 'hidden', 'observed'];
    const towardsConcealment = ['observed', 'concealed', 'hidden', 'undetected'];
    const step = (value, ladder, dir = +1) => {
      const i = ladder.indexOf(value);
      if (i < 0) return value;
      const ni = Math.max(0, Math.min(ladder.length - 1, i + dir));
      return ladder[ni];
    };

    // Seek-specific post adjustments
    if (action === 'seek') {
      // Keen Eyes: treat Undetected as Hidden; Hidden as Observed on Seek
      if (feats.has('keen-eyes')) {
        newVisibility = step(newVisibility, towardsObserved, +1);
      }
      // That's Odd: anomalies (hazards/loot/hidden walls) are easier to notice
      if (feats.has("thats-odd") || feats.has("that's-odd")) {
        const isAnomaly = !!(context?.isHiddenWall || context?.subjectType === 'hazard' || context?.subjectType === 'loot');
        if (isAnomaly) newVisibility = step(newVisibility, towardsObserved, +1);
      }
      return newVisibility;
    }

    // Hide/Sneak: Vanish into the Land improves concealment on success in natural terrain
    if ((action === 'hide' || action === 'sneak') && feats.has('vanish-into-the-land')) {
      if (context?.inNaturalTerrain && (context?.outcome === 'success' || context?.outcome === 'critical-success')) {
        newVisibility = step(newVisibility, towardsConcealment, +1);
      }
      return newVisibility;
    }

    // Diversion: Distracting Shadows could make observers more distracted in dim light
    if (action === 'create-a-diversion' && feats.has('distracting-shadows') && context?.inDimOrDarker) {
      newVisibility = step(newVisibility, towardsObserved, +1);
      return newVisibility;
    }

    return newVisibility;
  }

  /**
   * Sneak speed multiplier helper.
   * Returns the multiplier to apply to walk speed while Sneaking.
   * Defaults to 0.5 (half speed). Certain feats allow full speed.
   * @param {Token|Actor} tokenOrActor
   * @param {object} context
   * @returns {number} e.g., 1.0 means full speed, 0.5 means half
   */
  static getSneakSpeedMultiplier(tokenOrActor) {
    const actor = FeatsHandlerInternal.resolveActor(tokenOrActor);
    if (!actor) return 0.5;
    const feats = getActorFeatSlugs(actor);
    // Full-speed Sneak feats
    if (feats.has('swift-sneak') || feats.has('legendary-sneak') || feats.has('very-very-sneaky')) return 1.0;
    // Future: partial reductions could be handled here (e.g., 0.75)
    return 0.5;
  }

  /**
   * Returns a flat distance bonus (in feet) to add to a single Sneak action's distance.
   * Example: very-sneaky -> +5 ft.
   */
  static getSneakDistanceBonusFeet(tokenOrActor) {
    const actor = FeatsHandlerInternal.resolveActor(tokenOrActor);
    if (!actor) return 0;
    const feats = getActorFeatSlugs(actor);
    let bonus = 0;
    if (feats.has('very-sneaky')) bonus += 5;
    // Room for other feats that extend Sneak distance (stack carefully)
    return bonus;
  }

  /**
   * Override Sneak prerequisites based on feats.
   * Accepts base qualification booleans and optionally extra context info.
   * Returns a new object with possibly adjusted booleans and reason.
   * @param {Token|Actor} tokenOrActor
   * @param {{ startQualifies: boolean, endQualifies: boolean, bothQualify: boolean, reason?: string }} base
   * @param {{ startVisibility?: string, endVisibility?: string, endCoverState?: string }} [extra]
   */
  static overrideSneakPrerequisites(tokenOrActor, base, extra = {}) {
    const actor = FeatsHandlerInternal.resolveActor(tokenOrActor);
    if (!actor) return base;
    const feats = getActorFeatSlugs(actor);

    let { startQualifies, endQualifies } = base;
    let reason = base.reason || '';

    // Legendary Sneak: You can Sneak even without cover/concealment at the start,
    // as long as you end in cover or concealment (we still require endQualifies).
    if (!startQualifies && endQualifies && feats.has('legendary-sneak')) {
      startQualifies = true;
      reason = 'Legendary Sneak allows starting without cover or concealment';
    }

    // Very, Very Sneaky: Can Hide or Sneak without cover or concealment
    if (!startQualifies && feats.has('very-very-sneaky')) {
      startQualifies = true;
      if (!reason) reason = 'Very, Very Sneaky removes start cover/concealment requirement';
    }

    // Very, Very Sneaky: End position does not require cover or concealment either
    if (!endQualifies && feats.has('very-very-sneaky')) {
      endQualifies = true;
      if (!reason) reason = 'Very, Very Sneaky removes end cover/concealment requirement';
    }

    // Vanish into the Land: Hide or Sneak without cover or concealment in natural terrain
    if (!startQualifies && feats.has('vanish-into-the-land')) {
      const natural = extra?.startTerrainTag === 'natural' || extra?.endTerrainTag === 'natural' || extra?.inNaturalTerrain;
      if (natural) {
        startQualifies = true;
        if (!reason) reason = 'Vanish into the Land (natural terrain)';
      }
    }

    // Terrain Stalker: Can Hide or Sneak while observed in chosen terrain
    if (!startQualifies && feats.has('terrain-stalker')) {
      if (extra?.startTerrainTag || extra?.endTerrainTag) {
        startQualifies = true;
        if (!reason) reason = 'Terrain Stalker (chosen terrain)';
      }
    }

    // Foil Senses: Can Hide or Sneak against observers with only imprecise senses
    // We approximate via a context hint impreciseOnly
    if (!startQualifies && feats.has('foil-senses') && extra?.impreciseOnly) {
      startQualifies = true;
      if (!reason) reason = 'Foil Senses vs. imprecise senses';
    }

    const bothQualify = !!(startQualifies && endQualifies);
    return { ...base, startQualifies, endQualifies, bothQualify, reason };
  }
}

export default FeatsHandler;
