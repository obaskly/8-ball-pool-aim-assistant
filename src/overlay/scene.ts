import type {
  OverlayCircle,
  OverlayLabel,
  OverlayPolyline,
  OverlayScene,
} from '../../modules/overlay-native/src/OverlayNative.types';
import type {
  PathNode,
  Prediction,
  SegmentRole,
  TableGeometry,
  World,
} from '../physics/types';
import { resolveTheme, type OverlayTheme } from './theme';

export interface SceneOptions {
  theme?: Partial<OverlayTheme>;
  /** Playfield outline and pocket capture circles. Use while calibrating. */
  showTable?: boolean;
  /** Rings where the engine believes the balls are. Use while calibrating. */
  showBalls?: boolean;
  /** Ring at the cue ball's contact position for the first impact. */
  showGhostBall?: boolean;
  /** Dot at every cushion bounce. */
  showCushionMarkers?: boolean;
  /** Cut angle printed next to the ghost ball. */
  showCutAngle?: boolean;
  /**
   * Distance in pixels to trim off the *start* of the cue ball's primary line.
   *
   * This exists because of screen capture: MediaProjection records our own
   * overlay along with the game, and the aim fit looks for a run of bright,
   * washed-out pixels starting at the cue ball. A white primary line is exactly
   * that, and it starts at exactly that point, so it would be fitted in
   * preference to the game's own and the angle would latch on our last frame.
   *
   * The shipped palette keeps its hue and is invisible to the fit, so this is 0
   * in normal use — `primaryGapForCapture` works it out. A custom theme that
   * puts white back on screen needs a gap longer than
   * `CaptureConfig.aimMaxStartRadii` ball radii, which disqualifies our line
   * without the eye noticing anything is missing from it.
   */
  primaryGap?: number;
  /**
   * Global alpha multiplier, 0..1. Used to dim the overlay while it is coasting
   * on a held reading, so a stale prediction looks stale instead of looking
   * confident. 1, the default, changes nothing.
   */
  fade?: number;
}

interface SceneFlags {
  showTable: boolean;
  showBalls: boolean;
  showGhostBall: boolean;
  showCushionMarkers: boolean;
  showCutAngle: boolean;
  primaryGap: number;
  fade: number;
}

// Resolved field by field rather than by spreading, so an explicit `undefined`
// from a caller falls back to the default instead of overwriting it.
function resolveFlags(o: SceneOptions): SceneFlags {
  return {
    showTable: o.showTable ?? false,
    showBalls: o.showBalls ?? false,
    showGhostBall: o.showGhostBall ?? true,
    showCushionMarkers: o.showCushionMarkers ?? true,
    showCutAngle: o.showCutAngle ?? false,
    primaryGap: o.primaryGap ?? 0,
    fade: o.fade ?? 1,
  };
}

/**
 * Convert a prediction into a single overlay frame.
 *
 * Segments are merged into one polyline per contiguous run of the same role, so
 * a cue ball that bounces off three cushions before contact is one stroke rather
 * than four. Each generation of struck ball is drawn fainter than the last.
 */
export function buildScene(
  world: World,
  prediction: Prediction,
  options: SceneOptions = {}
): OverlayScene {
  const theme = resolveTheme(options.theme);
  const opts = resolveFlags(options);

  const polylines: OverlayPolyline[] = [];
  const circles: OverlayCircle[] = [];
  const labels: OverlayLabel[] = [];

  if (opts.showTable) {
    addTable(world.table, theme, polylines, circles);
  }

  if (opts.showBalls) {
    for (const b of world.balls) {
      circles.push({
        x: b.position.x,
        y: b.position.y,
        radius: b.radius,
        color: b.kind === 'cue' ? theme.cueBall : theme.ball,
        width: theme.outlineWidth,
      });
    }
  }

  addPaths(prediction.root, theme, opts, polylines, circles);

  const primary = prediction.primaryContact;
  if (primary && opts.showGhostBall) {
    const radius =
      world.balls.find((b) => b.id === primary.sourceId)?.radius ??
      world.table.ballRadius;

    circles.push({
      x: primary.ghostBall.x,
      y: primary.ghostBall.y,
      radius,
      color: theme.ghost,
      width: theme.ghostWidth,
    });

    if (opts.showCutAngle) {
      const degrees = (primary.cutAngle * 180) / Math.PI;
      labels.push({
        x: primary.ghostBall.x + radius + 8,
        y: primary.ghostBall.y - radius - 8,
        text: `${degrees.toFixed(0)}°`,
        color: theme.text,
        size: theme.textSize,
      });
    }
  }

  for (const pot of prediction.potted) {
    circles.push({
      x: pot.at.x,
      y: pot.at.y,
      radius: world.table.ballRadius * 1.6,
      color: theme.potted,
      width: theme.outlineWidth + 1,
    });
  }

  if (opts.fade < 1) {
    const f = Math.max(0, opts.fade);
    for (const l of polylines) l.alpha = (l.alpha ?? 1) * f;
    for (const c of circles) c.alpha = (c.alpha ?? 1) * f;
    for (const t of labels) t.alpha = (t.alpha ?? 1) * f;
  }

  return { polylines, circles, labels };
}

function addTable(
  table: TableGeometry,
  theme: OverlayTheme,
  polylines: OverlayPolyline[],
  circles: OverlayCircle[]
): void {
  const { left, top, right, bottom } = table.playfield;
  polylines.push({
    points: [left, top, right, top, right, bottom, left, bottom, left, top],
    color: theme.table,
    width: theme.outlineWidth,
  });

  for (const p of table.pockets) {
    circles.push({
      x: p.center.x,
      y: p.center.y,
      radius: p.captureRadius,
      color: theme.pocket,
      width: theme.outlineWidth,
    });
  }
}

function colorForRole(role: SegmentRole, theme: OverlayTheme): string {
  if (role === 'primary') return theme.primary;
  if (role === 'tangent') return theme.tangent;
  return theme.object;
}

function widthForRole(role: SegmentRole, theme: OverlayTheme): number {
  if (role === 'primary') return theme.primaryWidth;
  if (role === 'tangent') return theme.tangentWidth;
  return theme.objectWidth;
}

function addPaths(
  node: PathNode,
  theme: OverlayTheme,
  opts: SceneFlags,
  polylines: OverlayPolyline[],
  circles: OverlayCircle[]
): void {
  const alpha = Math.pow(theme.depthFalloff, node.depth);

  // Only the cue ball's own path is ever 'primary', and only its first run
  // starts at the cue ball, so one trim per node is enough.
  let gapApplied = false;

  let run: { role: SegmentRole; points: number[] } | null = null;
  const flush = () => {
    if (!run || run.points.length < 4) {
      run = null;
      return;
    }

    let points = run.points;
    if (opts.primaryGap > 0 && run.role === 'primary' && !gapApplied) {
      gapApplied = true;
      const trimmed = trimStart(points, opts.primaryGap);
      if (!trimmed) {
        // The whole aim line is shorter than the gap — the cue ball is nearly
        // touching its target. Drawing nothing is right: the ghost ball and the
        // tangent line already say everything at that range.
        run = null;
        return;
      }
      points = trimmed;
    }

    polylines.push({
      points,
      color: colorForRole(run.role, theme),
      width: widthForRole(run.role, theme),
      // The tangent line is a consequence of the shot, not the aim itself;
      // dashing it keeps the two visually distinct at a glance.
      dash: run.role === 'tangent' ? theme.dash : 0,
      alpha,
    });
    run = null;
  };

  for (const s of node.segments) {
    if (!run || run.role !== s.role) {
      flush();
      run = { role: s.role, points: [s.from.x, s.from.y] };
    }
    run.points.push(s.to.x, s.to.y);
  }
  flush();

  if (opts.showCushionMarkers) {
    for (const c of node.cushions) {
      circles.push({
        x: c.at.x,
        y: c.at.y,
        radius: theme.markerRadius,
        color: theme.cushion,
        filled: true,
        alpha,
      });
    }
  }

  for (const child of node.children) {
    addPaths(child, theme, opts, polylines, circles);
  }
}

/**
 * Drop `gap` pixels of arc length from the head of a polyline, splitting the
 * segment the gap ends inside. Returns null when the polyline is shorter than
 * the gap.
 */
function trimStart(points: number[], gap: number): number[] | null {
  let remaining = gap;

  for (let i = 0; i + 3 < points.length; i += 2) {
    const x0 = points[i];
    const y0 = points[i + 1];
    const x1 = points[i + 2];
    const y1 = points[i + 3];
    const length = Math.hypot(x1 - x0, y1 - y0);

    if (length >= remaining) {
      const t = length === 0 ? 0 : remaining / length;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, ...points.slice(i + 2)];
    }
    remaining -= length;
  }

  return null;
}

/** Nothing drawn. Cheaper and clearer than pushing an empty scene by hand. */
export const EMPTY_SCENE: OverlayScene = {
  polylines: [],
  circles: [],
  labels: [],
};
