import { Vec2, dot, mirror, normalize, scale, sub } from './vec2';

export interface ReflectionResult {
  direction: Vec2;
  speed: number;
  incidentAngle: number;
  reflectionAngle: number;
}

/**
 * Reflect a ball off a cushion.
 *
 * Two models, selected by `preserveAngle`:
 *
 *  - preserveAngle = true (default, and what the spec asks for): the direction is
 *    mirrored exactly, so theta_incident === theta_reflection, and the whole speed
 *    is scaled by the restitution `e`. Energy is lost without bending the path.
 *
 *  - preserveAngle = false: only the normal component is damped,
 *      v' = v - (1 + e)(v . n) n
 *    This is the textbook impulse model. Note that with e < 1 the outgoing angle
 *    is necessarily shallower than the incoming one, so the two requirements
 *    "theta_i = theta_r" and "e = 0.9" cannot both hold in this mode.
 *
 * `normal` must be the unit inward normal of the cushion.
 */
export function reflectOffCushion(
  direction: Vec2,
  speed: number,
  normal: Vec2,
  restitution: number,
  preserveAngle: boolean
): ReflectionResult {
  const vn = dot(direction, normal);
  // Angle measured from the cushion normal.
  const incidentAngle = Math.acos(Math.min(1, Math.max(-1, Math.abs(vn))));

  if (preserveAngle) {
    const outDir = normalize(mirror(direction, normal));
    return {
      direction: outDir,
      speed: speed * restitution,
      incidentAngle,
      reflectionAngle: incidentAngle,
    };
  }

  // Damp only the normal component.
  const v = scale(direction, speed);
  const outVel = sub(v, scale(normal, (1 + restitution) * dot(v, normal)));
  const outSpeed = Math.hypot(outVel.x, outVel.y);
  const outDir = normalize(outVel);
  const reflectionAngle = Math.acos(
    Math.min(1, Math.max(-1, Math.abs(dot(outDir, normal))))
  );

  return { direction: outDir, speed: outSpeed, incidentAngle, reflectionAngle };
}
