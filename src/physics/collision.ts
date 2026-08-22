import { Vec2, add, dot, normalize, reject, scale, sub } from './vec2';
import type { BallContact } from './types';

/** Below this tangential speed the striking ball is treated as stopping dead. */
export const STUN_EPSILON = 1e-6;

/**
 * Elastic impact between two equal-mass balls, followed by the striker settling
 * back into a natural roll.
 *
 * At contact the two centres define the *line of centres* `n`. The struck ball
 * can only be pushed along that line, so the incoming velocity splits into:
 *
 *   target  : n * (v . n)          speed = v * cos(theta)
 *   striker : v - n * (v . n)      speed = v * sin(theta)
 *
 * Those two are perpendicular by construction, which is the 90-degree tangent
 * rule, and it is where the impact itself ends. But the tangent is only where
 * the striker sets off, not where it goes. A ball that was rolling still carries
 * its topspin through the hit — the blow is along the line of centres and barely
 * touches the spin — so the cloth then drags it forward off the tangent until it
 * rolls again. Conserving angular momentum about the cloth contact, a sphere
 * leaving with velocity `u` and carrying surface speed `w` from its spin settles
 * at
 *
 *   v_final = (5/7) * u + (2/7) * w
 *
 * With `rollFraction` 0 the striker was sliding, `w` is zero, and this collapses
 * to the pure tangent the game draws — 5/7 of the tangential speed, because even
 * a stunned ball has to spin up before it rolls. With `rollFraction` 1 it was
 * rolling, `w` is the full incoming speed along the original heading, and the
 * result reproduces the published 30-degree rule: a half-ball hit sends the cue
 * ball 33.7 degrees off its aim line, not the 60 the tangent alone would claim.
 *
 * A dead-straight stun hit still stops dead. A dead-straight *rolling* hit does
 * not — it follows through at 2/7 speed, which is the whole reason players
 * scratch on shots the guideline says are safe.
 *
 * @param ghostCenter Centre of the striking ball at the moment of contact.
 * @param targetCenter Centre of the ball being struck.
 * @param direction Unit travel direction of the striking ball.
 * @param speed Speed of the striking ball entering the impact.
 * @param rollFraction How much of a natural roll the striker carries in, 0..1.
 */
export function resolveBallImpact(
  sourceId: string,
  targetId: string,
  ghostCenter: Vec2,
  targetCenter: Vec2,
  direction: Vec2,
  speed: number,
  rollFraction = 0
): BallContact {
  const impactNormal = normalize(sub(targetCenter, ghostCenter));

  const along = dot(direction, impactNormal);
  // Numerically, `along` is the cosine of the cut angle.
  const cutAngle = Math.acos(Math.min(1, Math.max(-1, along)));

  const targetSpeed = Math.max(0, speed * along);

  const tangentVec = reject(direction, impactNormal);
  const tangentMag = Math.hypot(tangentVec.x, tangentVec.y);
  const tangentSpeed = speed * tangentMag;

  const tangentDirection =
    tangentMag < STUN_EPSILON ? { x: 0, y: 0 } : scale(tangentVec, 1 / tangentMag);

  // Where it actually ends up: 5/7 of what the impact left it with, plus 2/7 of
  // the roll it brought in, still pointing along the original heading.
  const roll = Math.min(1, Math.max(0, rollFraction));
  const departVec = add(
    scale(tangentDirection, (5 / 7) * tangentSpeed),
    scale(direction, (2 / 7) * roll * speed)
  );
  const departSpeed = Math.hypot(departVec.x, departVec.y);
  const departDirection =
    departSpeed < STUN_EPSILON ? { x: 0, y: 0 } : scale(departVec, 1 / departSpeed);

  return {
    sourceId,
    targetId,
    ghostBall: ghostCenter,
    impactNormal,
    cutAngle,
    targetDirection: impactNormal,
    tangentDirection,
    targetSpeed,
    tangentSpeed,
    rollFraction: roll,
    departDirection,
    departSpeed,
  };
}
