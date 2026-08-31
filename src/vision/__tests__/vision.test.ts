import { describe, expect, it } from 'vitest';

import type {
  DetectedBall,
  FrameAnalysis,
} from '../../../modules/overlay-native';
import {
  BALL_RADIUS_TO_TABLE_WIDTH,
  REFERENCE_BALL_RADIUS,
  REFERENCE_SURFACE_SIZE,
  REFERENCE_PLAYFIELD,
  playingSurface,
} from '../../calibration/tableProfile';
import { DEFAULT_THEME } from '../../overlay/theme';
import { TABLE_HEIGHT_CM, TABLE_WIDTH_CM } from '../../physics/gamePhysics';
import { mappingFor, toSim } from '../../physics/table8bp';
import { VisionLatch } from '../latch';
import { FrameSmoother, normalizeAngle } from '../smoothing';
import {
  maxChannel,
  minChannel,
  primaryGapForCapture,
  readableByAimDetector,
} from '../feedback';
import { isVisionWorld, worldFromAnalysis } from '../worldFromAnalysis';

const PF = REFERENCE_PLAYFIELD;

function ball(
  x: number,
  y: number,
  kind: DetectedBall['kind'] = 'solid',
  confidence = 0.9
): DetectedBall {
  return { x, y, radius: REFERENCE_BALL_RADIUS, kind, confidence };
}

function frame(overrides: Partial<FrameAnalysis> = {}): FrameAnalysis {
  return {
    frameIndex: 0,
    elapsedMs: 8,
    frameWidth: 1170,
    frameHeight: 540,
    clothFraction: 0.42,
    playfield: { ...PF },
    balls: [ball(700, 620, 'cue', 0.95), ball(1400, 620), ball(1500, 700)],
    aimAngle: 0,
    aimReach: 400,
    contactX: null,
    contactY: null,
    contactRadius: null,
    bounceX: null,
    bounceY: null,
    bounceAngle: null,
    powerTipY: null,
    powerSlotTop: null,
    powerSlotBottom: null,
    clothColor: '#3E9BBD',
    note: null,
    ...overrides,
  };
}

describe('worldFromAnalysis', () => {
  it('builds the table from the detected rectangle, not the screen fractions', () => {
    // Shift the whole table 40 px right of where the profile would predict it.
    const shifted = {
      left: PF.left + 40,
      top: PF.top,
      right: PF.right + 40,
      bottom: PF.bottom,
    };
    const result = worldFromAnalysis(frame({ playfield: shifted }));

    expect(isVisionWorld(result)).toBe(true);
    if (!isVisionWorld(result)) return;
    const surface = playingSurface(shifted);
    expect(result.world.table.playfield.left).toBeCloseTo(surface.left, 6);
    expect(result.world.table.playfield.right).toBeCloseTo(surface.right, 6);
  });

  it('takes the cushion slopes off the detected cloth rectangle', () => {
    const result = worldFromAnalysis(frame());

    expect(isVisionWorld(result)).toBe(true);
    if (!isVisionWorld(result)) return;
    const pf = result.world.table.playfield;
    const width = pf.right - pf.left;
    const height = pf.bottom - pf.top;
    // The cloth measures 1514 x 786; the bed inside it is exactly 2:1.
    expect(width / height).toBeCloseTo(2, 6);
    expect(width).toBeCloseTo(1456, 6);
    // Concentric with the cloth, so the inset is the same on all four sides.
    expect(pf.left - PF.left).toBeCloseTo(PF.right - pf.right, 6);
    expect(pf.top - PF.top).toBeCloseTo(PF.bottom - pf.bottom, 6);
    expect(pf.left - PF.left).toBeCloseTo(29, 6);
  });

  it('puts the simulation cushions on the table rectangle it reports', () => {
    const result = worldFromAnalysis(frame());

    expect(isVisionWorld(result)).toBe(true);
    if (!isVisionWorld(result)) return;
    // What the sim actually steps against is TABLE_SHAPE_CM through this
    // mapping, so the two only agree if the rectangle handed over is the
    // playing surface. Taking the cloth rectangle for it put every cushion
    // 11 px (long rails) to 23 px (short rails) outside the rail that produced
    // the bounce, and made every distance in the simulation run 4.2% long.
    const pf = result.world.table.playfield;
    const m = mappingFor(pf);
    expect(toSim({ x: pf.left, y: pf.top }, m).x).toBeCloseTo(-TABLE_WIDTH_CM / 2, 6);
    expect(toSim({ x: pf.right, y: pf.top }, m).x).toBeCloseTo(TABLE_WIDTH_CM / 2, 6);
    expect(toSim({ x: pf.left, y: pf.top }, m).y).toBeCloseTo(TABLE_HEIGHT_CM / 2, 6);
    expect(toSim({ x: pf.left, y: pf.bottom }, m).y).toBeCloseTo(-TABLE_HEIGHT_CM / 2, 6);
  });

  it('derives the ball radius from table width rather than the measured blob', () => {
    const result = worldFromAnalysis(
      // A wildly wrong blob radius must not reach the physics.
      frame({ balls: [ball(700, 620, 'cue'), ball(1400, 620)].map((b) => ({ ...b, radius: 3 })) })
    );

    expect(isVisionWorld(result)).toBe(true);
    if (!isVisionWorld(result)) return;
    // The game's exact ratio against the playing surface: 1456 * 0.0149625.
    const exact = REFERENCE_SURFACE_SIZE.width * BALL_RADIUS_TO_TABLE_WIDTH;
    expect(result.world.table.ballRadius).toBeCloseTo(exact, 1);
    for (const b of result.world.balls) {
      expect(b.radius).toBeCloseTo(exact, 1);
    }
  });

  it('rejects a rectangle that is not a 2:1 table', () => {
    const square = { left: 400, top: 200, right: 1200, bottom: 900 };
    const result = worldFromAnalysis(frame({ playfield: square }));

    expect(isVisionWorld(result)).toBe(false);
    if (isVisionWorld(result)) return;
    expect(result.reason).toContain('aspect');
  });

  it('rejects a frame with no cue ball', () => {
    const result = worldFromAnalysis(
      frame({ balls: [ball(700, 620), ball(1400, 620)] })
    );

    expect(isVisionWorld(result)).toBe(false);
    if (isVisionWorld(result)) return;
    expect(result.reason).toBe('no cue ball');
  });

  it('rejects a frame with no table', () => {
    const result = worldFromAnalysis(
      frame({ playfield: null, note: 'table not visible' })
    );
    expect(isVisionWorld(result)).toBe(false);
  });

  it('names the cue ball "cue" and keeps tracker ids for the rest', () => {
    const tracked = new FrameSmoother().push(frame());
    const result = worldFromAnalysis(tracked);

    expect(isVisionWorld(result)).toBe(true);
    if (!isVisionWorld(result)) return;
    expect(result.cueBall.id).toBe('cue');

    const ids = result.world.balls.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('passes the measured reach through, but only while the guideline is live', () => {
    const live = worldFromAnalysis(frame({ aimReach: 620 }));
    expect(isVisionWorld(live) && live.aimReach).toBe(620);

    // A held direction with no line on screen carries no usable distance.
    const held = worldFromAnalysis({
      ...frame({ aimReach: 620 }),
      aimIsLive: false,
    });
    expect(isVisionWorld(held) && held.aimReach).toBeNull();
  });

  it('passes the drawn contact through, but only while the guideline is live', () => {
    const live = worldFromAnalysis(frame({ contactX: 1180, contactY: 615 }));
    expect(isVisionWorld(live) && live.contact).toEqual({ x: 1180, y: 615 });

    // Same reasoning as the reach: a contact that has not happened yet stops
    // being a fact about this table as soon as the game stops drawing it.
    const held = worldFromAnalysis({
      ...frame({ contactX: 1180, contactY: 615 }),
      aimIsLive: false,
    });
    expect(isVisionWorld(held) && held.contact).toBeNull();
  });

  it('reports no contact when the frame carried none', () => {
    const none = worldFromAnalysis(frame());
    expect(isVisionWorld(none) && none.contact).toBeNull();
  });
});

describe('FrameSmoother', () => {
  it('keeps a ball id stable while the ball moves', () => {
    const smoother = new FrameSmoother();
    const first = smoother.push(frame());
    const cueId = first.balls.find((b) => b.kind === 'cue')!.id;

    // Move the cue ball a little each frame, as a rolling ball would.
    let x = 700;
    for (let i = 0; i < 10; i++) {
      x += 8;
      const next = smoother.push(
        frame({ balls: [ball(x, 620, 'cue', 0.95), ball(1400, 620), ball(1500, 700)] })
      );
      expect(next.balls.find((b) => b.kind === 'cue')!.id).toBe(cueId);
    }
  });

  it('lags a jump rather than following it in one frame', () => {
    const smoother = new FrameSmoother({ ballAlpha: 0.4 });
    smoother.push(frame());
    const next = smoother.push(
      frame({ balls: [ball(710, 620, 'cue', 0.95), ball(1400, 620), ball(1500, 700)] })
    );

    const cue = next.balls.find((b) => b.kind === 'cue')!;
    expect(cue.x).toBeCloseTo(704, 0);
  });

  it('coasts a ball that disappears, then drops it', () => {
    const smoother = new FrameSmoother({ missTolerance: 2 });
    smoother.push(frame());

    const without = frame({ balls: [ball(700, 620, 'cue', 0.95), ball(1400, 620)] });
    expect(smoother.push(without).balls).toHaveLength(3); // coasted
    expect(smoother.push(without).balls).toHaveLength(3); // still coasted
    expect(smoother.push(without).balls).toHaveLength(2); // dropped
  });

  it('takes the short way round when the aim line crosses due west', () => {
    const smoother = new FrameSmoother({ aimAlpha: 0.5 });
    // Under the snap threshold, so this exercises the EMA and not the jump.
    smoother.push(frame({ aimAngle: Math.PI - 0.05 }));
    const next = smoother.push(frame({ aimAngle: -Math.PI + 0.05 }));

    // Halfway between the two is +/-pi, not 0.
    expect(Math.abs(next.aimAngle!)).toBeCloseTo(Math.PI, 5);
  });

  it('eases a small aim change but jumps to a large one', () => {
    const eased = new FrameSmoother({ aimAlpha: 0.5, aimSnapRadians: 0.2 });
    eased.push(frame({ aimAngle: 0 }));
    expect(eased.push(frame({ aimAngle: 0.1 })).aimAngle).toBeCloseTo(0.05, 6);

    // A guideline fitted to the wrong end of its own axis reads 180 degrees out.
    // Easing into that sweeps the drawn prediction right across the table, so
    // the reading is taken as it stands instead.
    const snapped = new FrameSmoother({ aimAlpha: 0.5, aimSnapRadians: 0.2 });
    snapped.push(frame({ aimAngle: 0 }));
    expect(snapped.push(frame({ aimAngle: Math.PI })).aimAngle).toBeCloseTo(
      Math.PI,
      6
    );
  });

  it('smooths the playfield harder than the balls', () => {
    const smoother = new FrameSmoother();
    smoother.push(frame());
    const next = smoother.push(
      frame({ playfield: { ...PF, left: PF.left + 100 } })
    );

    // 15% of the way, per DEFAULT_SMOOTHING.playfieldAlpha.
    expect(next.playfield!.left).toBeCloseTo(PF.left + 15, 5);
  });

  it('starts clean after a reset', () => {
    const smoother = new FrameSmoother();
    smoother.push(frame());
    smoother.reset();

    const next = smoother.push(frame({ playfield: { ...PF, left: PF.left + 100 } }));
    expect(next.playfield!.left).toBeCloseTo(PF.left + 100, 5);
  });

  it('holds the aim direction but drops the reach with the guideline', () => {
    const smoother = new FrameSmoother();
    smoother.push(frame({ aimAngle: 0.4, aimReach: 400 }));

    const gone = smoother.push(frame({ aimAngle: null, aimReach: null }));
    // The direction is still a fair guess at where the player is aiming.
    expect(gone.aimAngle).toBeCloseTo(0.4, 5);
    // The distance to the first obstruction is not: the balls are rolling.
    expect(gone.aimReach).toBeNull();

    // And it does not come back stale when the guideline does.
    const back = smoother.push(frame({ aimAngle: 0.4, aimReach: 900 }));
    expect(back.aimReach).toBeCloseTo(900, 5);
  });

  it('smooths the reach while the guideline stays up', () => {
    const smoother = new FrameSmoother({ aimAlpha: 0.5 });
    smoother.push(frame({ aimReach: 400 }));
    expect(smoother.push(frame({ aimReach: 500 })).aimReach).toBeCloseTo(450, 5);
  });

  it('smooths the contact point, and drops it with the guideline', () => {
    const smoother = new FrameSmoother({ aimAlpha: 0.5 });
    smoother.push(frame({ contactX: 1000, contactY: 600 }));
    const next = smoother.push(frame({ contactX: 1100, contactY: 700 }));
    expect(next.contactX).toBeCloseTo(1050, 5);
    expect(next.contactY).toBeCloseTo(650, 5);

    const gone = smoother.push(frame({ aimAngle: null, contactX: null, contactY: null }));
    expect(gone.contactX).toBeNull();
    expect(gone.contactY).toBeNull();

    // Not carried back stale when the guideline returns somewhere else.
    const back = smoother.push(frame({ contactX: 200, contactY: 300 }));
    expect(back.contactX).toBeCloseTo(200, 5);
  });
});

describe('self-capture feedback', () => {
  it('reads the lowest channel from every colour form', () => {
    expect(minChannel('#FFFFFF')).toBe(255);
    expect(minChannel('#FFFFFFFF')).toBe(255); // #AARRGGBB
    expect(minChannel('#6FE3FF')).toBe(0x6f);
    expect(minChannel('#CC6FE3FF')).toBe(0x6f); // alpha ignored
    expect(minChannel('#FFF')).toBe(255);
    expect(minChannel('nonsense')).toBe(255);
  });

  it('reads the highest channel from every colour form', () => {
    expect(maxChannel('#6FE3FF')).toBe(255);
    expect(maxChannel('#CC6FE3FF')).toBe(255); // alpha ignored
    expect(maxChannel('#606060')).toBe(0x60);
    expect(maxChannel('nonsense')).toBe(255);
  });

  it('demands a gap for a white aim line', () => {
    // White is what the fit is looking for, so our own line has to start beyond
    // the distance at which it will accept a run as starting at the cue ball.
    const gap = primaryGapForCapture('#FFFFFFFF', 20, { aimMaxStartRadii: 12 });
    expect(gap).toBeGreaterThan(20 * 12);
  });

  it('needs no gap for an aim line the detector cannot see', () => {
    expect(primaryGapForCapture('#CC6FE3FF', 20)).toBe(0);
    expect(primaryGapForCapture('#FFFFD54F', 20)).toBe(0);
  });

  it('takes both gates, not just brightness', () => {
    // Bright but saturated: invisible to the fit however bright it gets.
    expect(readableByAimDetector('#6FE3FF')).toBe(false);
    expect(readableByAimDetector('#6FE3FF', { guideMinValue: 10 })).toBe(false);
    // Neutral but dim: also invisible, until the value gate is dropped under it.
    expect(readableByAimDetector('#606060')).toBe(false);
    expect(readableByAimDetector('#606060', { guideMinValue: 80 })).toBe(true);
  });

  it('respects a raised saturation threshold', () => {
    // Cyan sits at 0.565 saturation. Open the gate past that and the detector
    // starts reading it, so the gap is needed again.
    expect(readableByAimDetector('#6FE3FF', { guideMaxSaturation: 0.6 })).toBe(true);
    expect(
      primaryGapForCapture('#6FE3FF', 20, { guideMaxSaturation: 0.6 })
    ).toBeGreaterThan(0);
  });

  it('draws the shipped theme with no gap at all', () => {
    // Every role, not just the ones along the aim direction: the fit gathers
    // lit pixels from the whole playfield, so a ghost ring or a cushion marker
    // sitting on the line would vote for it just as a line would.
    for (const [role, color] of Object.entries(DEFAULT_THEME)) {
      if (typeof color !== 'string') continue;
      expect(
        readableByAimDetector(color),
        `${role} (${color}) is readable by our own aim detector`
      ).toBe(false);
    }

    expect(primaryGapForCapture(DEFAULT_THEME.primary, 20)).toBe(0);
    expect(minChannel(DEFAULT_THEME.primary)).toBeLessThan(200);
    expect(minChannel(DEFAULT_THEME.tangent)).toBeLessThan(200);
  });
});

describe('normalizeAngle', () => {
  it('folds any angle into [-pi, pi]', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI, 6);
    expect(normalizeAngle(0.5)).toBeCloseTo(0.5, 6);
    expect(normalizeAngle(2 * Math.PI + 0.25)).toBeCloseTo(0.25, 6);
  });
});

describe('holding the aim direction', () => {
  it('bridges a flickering guideline but lets go once the shot is played', () => {
    const s = new FrameSmoother({ aimAlpha: 1 });

    const aiming = s.push(frame({ aimAngle: 0.4 }));
    expect(aiming.aimAngle).toBeCloseTo(0.4, 6);
    expect(aiming.aimIsLive).toBe(true);
    expect(aiming.aimAge).toBe(0);

    // A few missed frames are a flicker — behind the cue stick, under a HUD
    // panel — and the direction rides through them.
    for (let i = 1; i <= 4; i++) {
      const coasting = s.push(frame({ aimAngle: null }));
      expect(coasting.aimAngle).toBeCloseTo(0.4, 6);
      expect(coasting.aimIsLive).toBe(false);
      expect(coasting.aimAge).toBe(i);
    }

    // Past that the shot really has been played, and holding on would leave the
    // overlay predicting a dead aim over balls that are already rolling.
    expect(s.push(frame({ aimAngle: null })).aimAngle).toBeNull();

    // Aiming again takes over immediately.
    expect(s.push(frame({ aimAngle: -1.2 })).aimAngle).toBeCloseTo(-1.2, 6);
  });

  it('gives up after aimHoldFrames', () => {
    const s = new FrameSmoother({ aimHoldFrames: 2 });
    s.push(frame({ aimAngle: 0.4 }));

    expect(s.push(frame({ aimAngle: null })).aimAngle).toBeCloseTo(0.4, 6);
    expect(s.push(frame({ aimAngle: null })).aimAngle).toBeCloseTo(0.4, 6);
    expect(s.push(frame({ aimAngle: null })).aimAngle).toBeNull();
  });

  it('starts with nothing to hold', () => {
    const s = new FrameSmoother();
    const first = s.push(frame({ aimAngle: null }));
    expect(first.aimAngle).toBeNull();
    expect(first.aimIsLive).toBe(false);
  });

  it('drops the aim the moment the balls start rolling', () => {
    const s = new FrameSmoother({ aimAlpha: 1 });
    s.push(frame({ aimAngle: 0.4 }));

    // The guideline goes and the cue ball is off: that is the shot, not a
    // flicker, so the hold is abandoned instead of counted down. Holding here
    // is what left lines tracking the balls after they had been hit.
    const struck = s.push(
      frame({
        aimAngle: null,
        balls: [ball(760, 620, 'cue', 0.95), ball(1400, 620), ball(1500, 700)],
      })
    );
    expect(struck.ballsMoving).toBe(true);
    expect(struck.aimAngle).toBeNull();
  });

  it('ignores blobs that flicker in and out of a cluster', () => {
    const s = new FrameSmoother({ aimAlpha: 1 });
    s.push(frame({ aimAngle: 0.4 }));

    // A racked cluster the detector cannot resolve produces different blobs on
    // every frame. None of that is the table moving — the cue ball has not —
    // and treating it as motion is what made the overlay strobe while the
    // player was doing nothing at all.
    const flickering = s.push(
      frame({
        aimAngle: null,
        balls: [
          ball(700, 620, 'cue', 0.95),
          ball(1400, 620),
          ball(1500, 700),
          ball(1620, 540, 'stripe', 0.25),
        ],
      })
    );
    expect(flickering.ballsMoving).toBe(false);
    expect(flickering.aimAngle).toBeCloseTo(0.4, 6);
  });

  it('does not mistake detection jitter for a shot', () => {
    const s = new FrameSmoother({ aimAlpha: 1 });
    s.push(frame({ aimAngle: 0.4 }));

    const jittering = s.push(
      frame({
        aimAngle: null,
        balls: [ball(702, 621, 'cue', 0.95), ball(1399, 620), ball(1500, 701)],
      })
    );
    expect(jittering.ballsMoving).toBe(false);
    expect(jittering.aimAngle).toBeCloseTo(0.4, 6);
  });
});

describe('cue ball uniqueness', () => {
  it('keeps only the most confident cue ball', () => {
    const s = new FrameSmoother();
    const out = s.push(
      frame({
        balls: [
          ball(700, 620, 'cue', 0.6),
          ball(900, 620, 'cue', 0.95),
          ball(1100, 620, 'solid'),
        ],
      })
    );

    const cues = out.balls.filter((b) => b.kind === 'cue');
    expect(cues).toHaveLength(1);
    expect(cues[0].x).toBeCloseTo(900, 6);
    // The loser is a mostly white ball, which is what a stripe is.
    expect(out.balls.find((b) => b.x === 700)!.kind).toBe('stripe');
  });
});

describe('VisionLatch', () => {
  const good = () => worldFromAnalysis(frame());
  const bad = () => worldFromAnalysis(frame({ playfield: null }));

  it('has nothing to show before the first good reading', () => {
    const latch = new VisionLatch();
    expect(latch.push(bad())).toBeNull();
  });

  it('holds the last reading across a rejected frame', () => {
    const latch = new VisionLatch();
    const first = latch.push(good())!;
    expect(first.age).toBe(0);
    expect(first.fade).toBe(1);
    expect(first.rejection).toBeNull();

    const held = latch.push(bad())!;
    expect(held.age).toBe(1);
    expect(held.rejection).toBe('no table');
    expect(held.world.balls).toEqual(first.world.balls);
  });

  it('fades as the reading gets older and clears once the hold expires', () => {
    const latch = new VisionLatch({
      holdFrames: 4,
      fadeAfterFrames: 1,
      minFade: 0.25,
    });
    latch.push(good());

    expect(latch.push(bad())!.fade).toBe(1);
    const fades = [2, 3, 4].map(() => latch.push(bad())!.fade);
    expect(fades[0]).toBeLessThan(1);
    expect(fades[1]).toBeLessThan(fades[0]);
    expect(fades[2]).toBeCloseTo(0.25, 6);

    expect(latch.push(bad())).toBeNull();
    // And it stays cleared rather than resurrecting the stale reading.
    expect(latch.push(bad())).toBeNull();
  });

  it('resets the age as soon as a good frame arrives', () => {
    const latch = new VisionLatch();
    latch.push(good());
    latch.push(bad());
    latch.push(bad());
    expect(latch.push(good())!.age).toBe(0);
  });

  it('lets go of a held reading once the balls are rolling', () => {
    const latch = new VisionLatch();
    latch.push(good());

    // A held reading is a snapshot of a table that has since changed. While the
    // player is aiming that costs nothing; once the balls are moving it draws
    // the shot that has just been played over the balls playing it out.
    expect(latch.push(bad(), true)).toBeNull();
    expect(latch.push(bad())).toBeNull();
  });
});

describe('sparse tables', () => {
  it('accepts a table with only the cue ball left on it', () => {
    const result = worldFromAnalysis(
      frame({ balls: [ball(700, 620, 'cue', 0.95)] })
    );
    expect(isVisionWorld(result)).toBe(true);
  });
});
