/**
 * PF2e Visioner Region Behavior
 *
 * A custom region behavior that manages visibility states for tokens
 * entering and exiting regions.
 */

import { VISIBILITY_STATES } from '../constants.js';
import { segmentsIntersect } from '../helpers/geometry-utils.js';
import { getVisibility, setVisibilityBetween } from '../stores/visibility-map.js';
import AvsOverrideManager from '../chat/services/infra/avs-override-manager.js';
import { isValidToken } from '../utils.js';

const RegionBehaviorBase =
  typeof foundry !== 'undefined' &&
  foundry.data &&
  foundry.data.regionBehaviors &&
  foundry.data.regionBehaviors.RegionBehaviorType
    ? foundry.data.regionBehaviors.RegionBehaviorType
    : class {};

const DEFAULT_DEBOUNCE_MS = 50;

export class VisibilityRegionBehavior extends RegionBehaviorBase {
  static LOCALIZATION_PREFIXES = ['PF2E_VISIONER.REGION_BEHAVIOR'];

  static get label() {
    return 'PF2e Visioner Visibility';
  }

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      events: this._createEventsField({
        events: [
          CONST.REGION_EVENTS.BEHAVIOR_ACTIVATED,
          CONST.REGION_EVENTS.BEHAVIOR_DEACTIVATED,
          CONST.REGION_EVENTS.TOKEN_ENTER,
          CONST.REGION_EVENTS.TOKEN_EXIT,
          CONST.REGION_EVENTS.TOKEN_ANIMATE_IN,
          CONST.REGION_EVENTS.TOKEN_ANIMATE_OUT,
          CONST.REGION_EVENTS.TOKEN_MOVE_IN,
          CONST.REGION_EVENTS.TOKEN_MOVE_OUT,
          CONST.REGION_EVENTS.TOKEN_TURN_START,
          CONST.REGION_EVENTS.TOKEN_TURN_END,
          CONST.REGION_EVENTS.TOKEN_ROUND_START,
          CONST.REGION_EVENTS.TOKEN_ROUND_END,
          'regionClicked',
        ],
      }),

      visibilityState: new fields.StringField({
        required: true,
        choices: Object.fromEntries(
          Object.keys(VISIBILITY_STATES).map((k) => [k, `PF2E_VISIONER.VISIBILITY_STATES.${k}`]),
        ),
        initial: 'hidden',
        label: 'PF2E_VISIONER.REGION_BEHAVIOR.VISIBILITY_STATE.label',
        hint: 'PF2E_VISIONER.REGION_BEHAVIOR.VISIBILITY_STATE.hint',
      }),

      applyToInsideTokens: new fields.BooleanField({
        required: false,
        initial: true,
        label: 'PF2E_VISIONER.REGION_BEHAVIOR.APPLY_TO_INSIDE_TOKENS.label',
        hint: 'PF2E_VISIONER.REGION_BEHAVIOR.APPLY_TO_INSIDE_TOKENS.hint',
      }),

      twoWayRegion: new fields.BooleanField({
        required: false,
        initial: true,
        label: 'PF2E_VISIONER.REGION_BEHAVIOR.TWO_WAY_REGION.label',
        hint: 'PF2E_VISIONER.REGION_BEHAVIOR.TWO_WAY_REGION.hint',
      }),
    };
  }

  async _handleRegionEvent(event) {
    const name = event?.name ?? event?.type;
    if (!name) return;

    let token = null;
    try {
      if (event.token) token = event.token;
      else if (event.item && event.item.token) token = event.item.token;
      else if (event.target && typeof event.target === 'object' && event.target?.id)
        token = event.target;
      else if (event && typeof event === 'object' && event?.id && event?.center) token = event;
      else if (event?.data?.token)
        token = canvas.tokens.get(event.data.token?.id ?? event.data.token);

      // Additional common shapes for combat/turn/round events
      if (!token && event?.tokenId) token = canvas.tokens.get(event.tokenId);
      if (!token && event?.token && typeof event.token === 'string')
        token = canvas.tokens.get(event.token);
      if (!token && event?.actor && event.actor?.token) token = event.actor.token;
      if (!token && event?.actor && event.actor?.tokenId)
        token = canvas.tokens.get(event.actor.tokenId);
      // tokenUuid is sometimes provided; resolve only if canvas lookup available synchronously
      if (!token && event?.tokenUuid && typeof event.tokenUuid === 'string') {
        try {
          // tokenUuid may look like 'Scene.<id>.Token.<id>', attempt to parse the trailing id
          const parts = event.tokenUuid.split('.');
          const last = parts[parts.length - 1];
          if (last) token = canvas.tokens.get(last);
        } catch (_) {}
      }
    } catch (err) {
      console.error('PF2e Visioner | Error resolving token from event:', err, event);
    }

    // Classify events: IN/START are entering, OUT/END/EXIT are exiting
    const enteringEvents = new Set([
      CONST.REGION_EVENTS.TOKEN_ENTER,
      CONST.REGION_EVENTS.TOKEN_ANIMATE_IN,
      CONST.REGION_EVENTS.TOKEN_MOVE_IN,
      CONST.REGION_EVENTS.TOKEN_TURN_START,
      CONST.REGION_EVENTS.TOKEN_ROUND_START,
      CONST.REGION_EVENTS.BEHAVIOR_ACTIVATED,
    ]);
    const exitingEvents = new Set([
      CONST.REGION_EVENTS.TOKEN_EXIT,
      CONST.REGION_EVENTS.TOKEN_ANIMATE_OUT,
      CONST.REGION_EVENTS.TOKEN_MOVE_OUT,
      CONST.REGION_EVENTS.TOKEN_TURN_END,
      CONST.REGION_EVENTS.TOKEN_ROUND_END,
      CONST.REGION_EVENTS.BEHAVIOR_DEACTIVATED,
    ]);

    let isEntering = false;
    if (enteringEvents.has(name)) isEntering = true;
    else if (exitingEvents.has(name)) isEntering = false;
    else if (typeof name === 'string' && name.toUpperCase().endsWith('_START')) isEntering = true;
    else if (typeof name === 'string' && name.toUpperCase().endsWith('_END')) isEntering = false;
    else
      isEntering = [
        CONST.REGION_EVENTS.TOKEN_ENTER,
        CONST.REGION_EVENTS.TOKEN_ANIMATE_IN,
        CONST.REGION_EVENTS.TOKEN_MOVE_IN,
      ].includes(name);
    // exiting is handled by scheduling with isEntering=false; no immediate use here

    try {
      if (token) this._scheduleTokenEvent(token, isEntering, name);
    } catch (error) {
      console.error('PF2e Visioner | Error scheduling visibility update for token:', error);
    }
  }

  // Debounce/batch quick sequences of enter/exit events to reduce workload and perceived lag
  _ensurePending() {
    if (!this._pendingTokenEvents) this._pendingTokenEvents = new Map();
  }

  _scheduleTokenEvent(token, isEntering, eventName) {
    this._ensurePending();
    try {
      this._pendingTokenEvents.set(token.id, { id: token.id, isEntering, eventName });
      if (this._pendingTimer) clearTimeout(this._pendingTimer);
      this._pendingTimer = setTimeout(() => this._processPendingEvents(), DEFAULT_DEBOUNCE_MS);
    } catch (err) {
      console.warn('PF2e Visioner | Failed to schedule token event:', err);
    }
  }

  _prepareWallCache() {
    return (canvas?.walls?.placeables || [])
      .map((w) => {
        const d = w.document;
        let wx1 = d?.x,
          wy1 = d?.y,
          wx2 = d?.x2,
          wy2 = d?.y2;
        if (
          (wx1 === undefined || wy1 === undefined || wx2 === undefined || wy2 === undefined) &&
          Array.isArray(d?.c) &&
          d.c.length >= 4
        ) {
          wx1 = d.c[0];
          wy1 = d.c[1];
          wx2 = d.c[2];
          wy2 = d.c[3];
        }
        const isDoor = Number(d?.door) > 0;
        const doorState = Number(d?.ds ?? d?.doorState ?? 0);
        const valid = [wx1, wy1, wx2, wy2].every((v) => typeof v === 'number' && isFinite(v));
        const xmin = valid ? Math.min(wx1, wx2) : Infinity;
        const xmax = valid ? Math.max(wx1, wx2) : -Infinity;
        const ymin = valid ? Math.min(wy1, wy2) : Infinity;
        const ymax = valid ? Math.max(wy1, wy2) : -Infinity;
        return { wx1, wy1, wx2, wy2, isDoor, doorState, valid, xmin, xmax, ymin, ymax };
      })
      .filter((w) => w.valid);
  }

  _gatherUpdatesForToken(tokenId, isEntering, tokensInRegion) {
    // Resolve token from canvas to ensure fresh object
    const token = canvas.tokens.get(tokenId);
    if (!token) return [];

    // Helper: determine actor type for a token (robust resolution)
    const getTokenActorType = (t) => {
      try {
        return t?.actor?.type ?? t?.document?.actor?.type ?? null;
      } catch (_) {
        return null;
      }
    };

    const ignoredActorTypes = new Set(['loot', 'hazard']);

    // If the token itself is a loot or hazard, skip all updates for it
    try {
      const thisType = getTokenActorType(token);
      if (thisType && ignoredActorTypes.has(thisType)) return [];
    } catch (_) {}

    const visibilityState = this.visibilityState;
    const applyToInsideTokens = this.applyToInsideTokens;
    const twoWayRegion = this.twoWayRegion;

    // Use provided tokensInRegion list when available
    const snapshotRegion = tokensInRegion ?? this._getTokensInRegion();
    // Work with a shallow copy so we don't mutate a shared snapshot
    const inRegion = Array.isArray(snapshotRegion) ? Array.from(snapshotRegion) : [];
    // Ensure entering token is included for applyToInsideTokens; exclude exiting token when exiting
    if (isEntering) {
      if (!inRegion.find((t) => t.id === token.id)) {
        inRegion.push(token);
      }
    } else {
      // Exiting: ensure token is not treated as inside
      for (let i = inRegion.length - 1; i >= 0; --i)
        if (inRegion[i].id === token.id) inRegion.splice(i, 1);
    }
    const allTokens = canvas.tokens.placeables.filter(
      (t) => isValidToken(t) && !ignoredActorTypes.has(getTokenActorType(t)),
    );
    const tokensOutsideRegion = allTokens.filter((t) => !inRegion.includes(t));

    const updates = [];
    if (isEntering) {
      for (const otherToken of tokensOutsideRegion) {
        if (otherToken.id === token.id) continue;
        updates.push({ source: otherToken.id, target: token.id, state: visibilityState });
      }
      if (twoWayRegion) {
        for (const otherToken of tokensOutsideRegion) {
          if (otherToken.id === token.id) continue;
          updates.push({ source: token.id, target: otherToken.id, state: visibilityState });
        }
      }
      if (applyToInsideTokens) {
        for (const insideA of inRegion) {
          for (const insideB of inRegion) {
            if (insideA.id === insideB.id) continue;
            updates.push({ source: insideA.id, target: insideB.id, state: visibilityState });
          }
        }
      }
    } else {
      // Exiting: reset to observed
      // If this is a turn/round change event, and the current combatant is
      // still inside the region, don't remove visibility (avoid removing on turn change)
      let skipResetDueToCombat = false;
      try {
        if (game && game.combat && game.combat.combatant) {
          const currentCombatant =
            game.combat.combatant?.token?.id ?? game.combat.combatant?.tokenId ?? null;
          if (currentCombatant) {
            // If the current combatant is inside the region and matches the exiting token,
            // we should not reset visibility due to turn-change artifacts.
            if (tokensInRegion && tokensInRegion.find((t) => t.id === currentCombatant))
              skipResetDueToCombat = true;
          }
        }
      } catch (_) {}

      if (!skipResetDueToCombat) {
        const tokensToReset = [
          ...inRegion.filter((t) => t.id !== token.id),
          ...allTokens.filter((t) => !inRegion.includes(t) && t.id !== token.id),
        ];
        for (const otherToken of tokensToReset) {
          updates.push({ source: token.id, target: otherToken.id, state: 'observed' });
          updates.push({ source: otherToken.id, target: token.id, state: 'observed' });
        }
      }
    }
    return updates;
  }

  async _processPendingEvents() {
    this._ensurePending();

    if (!this._pendingTokenEvents.size) return;

    // Snapshot and clear pending
    const entries = Array.from(this._pendingTokenEvents.values());
    this._pendingTokenEvents.clear();
    if (this._pendingTimer) {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = null;
    }

    try {
      // Compute tokensInRegion once per batch
      const tokensInRegion = this._getTokensInRegion();

      // Gather updates for all pending tokens
      let allUpdates = [];
      for (const e of entries) {
        allUpdates = allUpdates.concat(
          this._gatherUpdatesForToken(e.id, e.isEntering, tokensInRegion),
        );
      }

      // Deduplicate
      const seen = new Set();
      const uniqueUpdates = [];
      for (const u of allUpdates) {
        const key = `${u.source}::${u.target}::${u.state}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueUpdates.push(u);
        }
      }

      if (uniqueUpdates.length === 0) return;

      // Prepare wall cache once and do LOS filtering
      const walls = this._prepareWallCache();
      const segBBox = (p1, p2) => ({
        minX: Math.min(p1.x, p2.x),
        maxX: Math.max(p1.x, p2.x),
        minY: Math.min(p1.y, p2.y),
        maxY: Math.max(p1.y, p2.y),
      });
      const isLineOfSightClear = (p1, p2) => {
        try {
          const { minX: segMinX, maxX: segMaxX, minY: segMinY, maxY: segMaxY } = segBBox(p1, p2);
          for (const w of walls) {
            try {
              if (w.isDoor && w.doorState === 1) continue;
              if (w.xmax < segMinX || w.xmin > segMaxX || w.ymax < segMinY || w.ymin > segMaxY)
                continue;
              if (segmentsIntersect(p1, p2, { x: w.wx1, y: w.wy1 }, { x: w.wx2, y: w.wy2 }))
                return false;
            } catch (_) {
              continue;
            }
          }
        } catch (_) {
          /* ignore */
        }
        return true;
      };

      // Cache token centers
      const centerCache = new Map();
      const getCenter = (id) => {
        if (centerCache.has(id)) return centerCache.get(id);
        const t = canvas.tokens.get(id);
        const c = t?.center ?? null;
        centerCache.set(id, c);
        return c;
      };

      const filtered = [];
      for (const u of uniqueUpdates) {
        try {
          const p1 = getCenter(u.source);
          const p2 = getCenter(u.target);
          if (!p1 || !p2) continue;
          if (isLineOfSightClear(p1, p2)) filtered.push(u);
        } catch (err) {
          filtered.push(u);
        }
      }

      if (filtered.length === 0) return;

      await this._applyVisibilityUpdates(filtered);
    } catch (err) {
      console.error('PF2e Visioner | Error processing pending region events:', err);
    }
  }

  _getTokensInRegion() {
    const region = this.parent;
    if (!region) return [];

    const pointInRegion = (x, y) => {
      try {
        if (typeof region.testPoint === 'function') return region.testPoint(x, y);
        if (typeof region.containsPoint === 'function') {
          try {
            if (region.containsPoint({ x, y })) return true;
          } catch (__) {}
          try {
            if (region.containsPoint(x, y)) return true;
          } catch (__) {}
        }
        if (region.shape && typeof region.shape.containsPoint === 'function') {
          try {
            if (region.shape.containsPoint(new PIXI.Point(x, y))) return true;
          } catch (__) {}
        }

        const pts = region.points ?? region.geometry?.points ?? region.boundary ?? null;
        if (Array.isArray(pts) && pts.length) {
          const poly = pts.map((p) => (Array.isArray(p) ? p : [p.x ?? p[0], p.y ?? p[1]]));
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i][0],
              yi = poly[i][1];
            const xj = poly[j][0],
              yj = poly[j][1];
            const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
            if (intersect) inside = !inside;
          }
          return inside;
        }
      } catch (err) {
        console.warn('PF2e Visioner | pointInRegion fallback error:', err);
      }
      return false;
    };

    // Compute a bounding box for the region (if available) to prefilter tokens
    let regionBBox = null;
    try {
      if (region.bounds) regionBBox = region.bounds;
      else if (region._bounds) regionBBox = region._bounds;
      else if (Array.isArray(region.points) && region.points.length) {
        const xs = region.points.map((p) => (Array.isArray(p) ? p[0] : (p.x ?? p[0])));
        const ys = region.points.map((p) => (Array.isArray(p) ? p[1] : (p.y ?? p[1])));
        regionBBox = {
          left: Math.min(...xs),
          right: Math.max(...xs),
          top: Math.min(...ys),
          bottom: Math.max(...ys),
        };
      }
    } catch (_) {
      regionBBox = null;
    }

    return canvas.tokens.placeables.filter((token) => {
      if (!isValidToken(token)) return false;
      const center = token.center;
      if (regionBBox) {
        const x = center.x,
          y = center.y;
        if (
          x < (regionBBox.left ?? -Infinity) ||
          x > (regionBBox.right ?? Infinity) ||
          y < (regionBBox.top ?? -Infinity) ||
          y > (regionBBox.bottom ?? Infinity)
        )
          return false;
      }
      return pointInRegion(center.x, center.y);
    });
  }

  async _applyVisibilityUpdates(updates) {
    if (!updates || updates.length === 0) return;
    try {
      const batchSize = 10;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        let resolved = 0;
        const promises = [];
        for (const update of batch) {
          let { source, target, state } = update;
          try {
            const sourceToken = typeof source === 'string' ? canvas.tokens.get(source) : source;
            const targetToken = typeof target === 'string' ? canvas.tokens.get(target) : target;
            if (!sourceToken || !targetToken) {
              console.warn(
                'PF2e Visioner | Could not resolve source/target tokens for update',
                update,
              );
              continue;
            }
            // Skip redundant updates when the desired state already matches current visibility
            try {
              const current = getVisibility(sourceToken, targetToken, 'observer_to_target');
              if (current === state) {
                // already in desired state
                continue;
              }
            } catch (_) {}

            resolved += 1;
            promises.push((async () => {
              try {
                // Create or remove AVS overrides for region-driven changes
                if (state && state !== 'observed') {
                  // one-way override for this specific direction
                  await AvsOverrideManager.onAVSOverride({
                    observer: sourceToken,
                    target: targetToken,
                    state,
                    source: 'region_override',
                  });
                } else if (state === 'observed') {
                  // Clearing: remove any prior override for this direction to restore AVS control
                  try { await AvsOverrideManager.removeOverride(sourceToken.document.id, targetToken.document.id); } catch (__) {}
                }
              } catch (overrideErr) {
                console.warn('PF2E Visioner | Region override operation failed:', overrideErr);
              }

              return setVisibilityBetween(sourceToken, targetToken, state).catch((err) => ({
                err,
                update,
              }));
            })());
          } catch (err) {
            console.error('PF2e Visioner | Error resolving update:', err, update);
          }
        }

        if (promises.length) {
          const results = await Promise.allSettled(promises);
          for (const r of results)
            if (r.status === 'rejected' || (r.status === 'fulfilled' && r.value && r.value.err))
              console.error('PF2e Visioner | Error applying visibility update:', r);
        }
        if (resolved === 0)
          console.warn(
            'PF2e Visioner | No updates in this batch were resolved to canvas tokens',
            batch,
          );
        if (i + batchSize < updates.length) await new Promise((resolve) => setTimeout(resolve, 10));
      }

      try {
        if (typeof canvas !== 'undefined' && canvas?.perception?.update)
          canvas.perception.update({ refreshVision: true });
      } catch (err) {
        console.error('PF2e Visioner | Error requesting canvas perception refresh:', err);
      }
    } catch (error) {
      console.error('PF2e Visioner | Error applying visibility updates:', error);
    }
  }
}
