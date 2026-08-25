import { describe, expect, it } from 'vitest';

import type { FrameAnalysis } from '../../../modules/overlay-native';
import { predictShot } from '../../physics';
import { fromAngle } from '../../physics/vec2';
import { isVisionWorld, worldFromAnalysis } from '../worldFromAnalysis';

/**
 * Two real captures of a shot lined up on a ball, as the analyser reads them.
 *
 * Both are frames the app got wrong: it drew the cue ball straight through the
 * ball being aimed at and off the far cushion, because the ball was not in the
 * list. The game draws its ghost ring and its contact lines over that ball, and
 * a stroke across a ball reads as a stripe of cloth splitting it in two —
 * neither half then lies far enough from felt to register as a ball at all. The
 * ring is the way back: it is drawn one diameter from the centre of the ball
 * standing there, so the analyser sweeps that circle and puts the ball back.
 *
 * The `_WITHOUT_RECOVERY` pair is the same frame with that step switched off,
 * which is what the failure looked like. Keeping both is the point of the test:
 * it pins down that the frames really are ones the ball pass alone cannot read,
 * so the recovery is doing the work rather than the frames being easy.
 */
const FRAME_1_WITHOUT_RECOVERY: FrameAnalysis = {
  frameIndex: 7,
  elapsedMs: 14,
  frameWidth: 1600,
  frameHeight: 738,
  clothFraction: 0.597,
  playfield: { left: 279.0, top: 155.0, right: 1321.0, bottom: 693.0 },
  balls: [
    { x: 466.4388, y: 284.4915, radius: 16.1083, kind: 'stripe', confidence: 0.5133 },
    { x: 316.7303, y: 502.2970, radius: 16.1083, kind: 'stripe', confidence: 0.2321 },
    { x: 325.7989, y: 566.4380, radius: 16.1083, kind: 'solid', confidence: 1.0000 },
    { x: 956.5892, y: 191.1537, radius: 16.1083, kind: 'cue', confidence: 0.7152 },
    { x: 1238.2981, y: 243.5731, radius: 16.1083, kind: 'stripe', confidence: 0.2520 },
    { x: 317.3437, y: 414.2902, radius: 16.1083, kind: 'solid', confidence: 0.7953 },
    { x: 1251.6533, y: 392.6204, radius: 16.1083, kind: 'solid', confidence: 0.8755 },
    { x: 371.1504, y: 547.0893, radius: 16.1083, kind: 'solid', confidence: 0.9562 },
    { x: 626.7383, y: 283.2719, radius: 16.1083, kind: 'eight', confidence: 0.7882 },
    { x: 738.9639, y: 400.7187, radius: 16.1083, kind: 'stripe', confidence: 0.3374 },
  ],
  aimAngle: 1.288,
  aimReach: 350.0,
  contactX: 1046.5,
  contactY: 501.5,
  contactRadius: 14.2758,
  bounceX: null,
  bounceY: null,
  bounceAngle: null,
  powerTipY: null,
  powerSlotTop: null,
  powerSlotBottom: null,
  clothColor: '#325B98',
  note: null,
};

const FRAME_1: FrameAnalysis = {
  frameIndex: 7,
  elapsedMs: 13,
  frameWidth: 1600,
  frameHeight: 738,
  clothFraction: 0.597,
  playfield: { left: 279.0, top: 155.0, right: 1321.0, bottom: 693.0 },
  balls: [
    { x: 466.4388, y: 284.4915, radius: 16.1083, kind: 'stripe', confidence: 0.5133 },
    { x: 316.7303, y: 502.2970, radius: 16.1083, kind: 'stripe', confidence: 0.2321 },
    { x: 325.7989, y: 566.4380, radius: 16.1083, kind: 'solid', confidence: 1.0000 },
    { x: 956.5892, y: 191.1537, radius: 16.1083, kind: 'cue', confidence: 0.7152 },
    { x: 1238.2981, y: 243.5731, radius: 16.1083, kind: 'stripe', confidence: 0.2520 },
    { x: 317.3437, y: 414.2902, radius: 16.1083, kind: 'solid', confidence: 0.7953 },
    { x: 1251.6533, y: 392.6204, radius: 16.1083, kind: 'solid', confidence: 0.8755 },
    { x: 371.1504, y: 547.0893, radius: 16.1083, kind: 'solid', confidence: 0.9562 },
    { x: 626.7383, y: 283.2719, radius: 16.1083, kind: 'eight', confidence: 0.7882 },
    { x: 738.9639, y: 400.7187, radius: 16.1083, kind: 'stripe', confidence: 0.3374 },
    { x: 1039.0422, y: 531.0370, radius: 16.1083, kind: 'solid', confidence: 0.7980 },
  ],
  aimAngle: 1.288,
  aimReach: 350.0,
  contactX: 1046.5,
  contactY: 501.5,
  contactRadius: 14.2758,
  bounceX: null,
  bounceY: null,
  bounceAngle: null,
  powerTipY: null,
  powerSlotTop: null,
  powerSlotBottom: null,
  clothColor: '#325B98',
  note: null,
};

const FRAME_2_WITHOUT_RECOVERY: FrameAnalysis = {
  frameIndex: 7,
  elapsedMs: 12,
  frameWidth: 1600,
  frameHeight: 738,
  clothFraction: 0.591,
  playfield: { left: 279.0, top: 155.0, right: 1321.0, bottom: 693.0 },
  balls: [
    { x: 466.4516, y: 284.5028, radius: 16.1083, kind: 'stripe', confidence: 0.5115 },
    { x: 317.0341, y: 502.4728, radius: 16.1083, kind: 'stripe', confidence: 0.2321 },
    { x: 325.6447, y: 566.5492, radius: 16.1083, kind: 'solid', confidence: 1.0000 },
    { x: 317.4449, y: 414.2159, radius: 16.1083, kind: 'solid', confidence: 0.7908 },
    { x: 842.0180, y: 294.6894, radius: 16.1083, kind: 'solid', confidence: 0.7845 },
    { x: 334.2351, y: 379.4893, radius: 16.1083, kind: 'cue', confidence: 0.6378 },
    { x: 371.1383, y: 547.0652, radius: 16.1083, kind: 'solid', confidence: 0.9579 },
    { x: 626.7500, y: 283.2874, radius: 16.1083, kind: 'eight', confidence: 0.7882 },
    { x: 1039.7152, y: 529.7745, radius: 16.1083, kind: 'solid', confidence: 0.8418 },
  ],
  aimAngle: 0.0659,
  aimReach: 420.0,
  contactX: 711.0,
  contactY: 408.5,
  contactRadius: 13.7758,
  bounceX: null,
  bounceY: null,
  bounceAngle: null,
  powerTipY: null,
  powerSlotTop: null,
  powerSlotBottom: null,
  clothColor: '#315A98',
  note: null,
};

const FRAME_2: FrameAnalysis = {
  frameIndex: 7,
  elapsedMs: 13,
  frameWidth: 1600,
  frameHeight: 738,
  clothFraction: 0.591,
  playfield: { left: 279.0, top: 155.0, right: 1321.0, bottom: 693.0 },
  balls: [
    { x: 466.4516, y: 284.5028, radius: 16.1083, kind: 'stripe', confidence: 0.5115 },
    { x: 317.0341, y: 502.4728, radius: 16.1083, kind: 'stripe', confidence: 0.2321 },
    { x: 325.6447, y: 566.5492, radius: 16.1083, kind: 'solid', confidence: 1.0000 },
    { x: 317.4449, y: 414.2159, radius: 16.1083, kind: 'solid', confidence: 0.7908 },
    { x: 842.0180, y: 294.6894, radius: 16.1083, kind: 'solid', confidence: 0.7845 },
    { x: 334.2351, y: 379.4893, radius: 16.1083, kind: 'cue', confidence: 0.6378 },
    { x: 371.1383, y: 547.0652, radius: 16.1083, kind: 'solid', confidence: 0.9579 },
    { x: 626.7500, y: 283.2874, radius: 16.1083, kind: 'eight', confidence: 0.7882 },
    { x: 1039.7152, y: 529.7745, radius: 16.1083, kind: 'solid', confidence: 0.8418 },
    { x: 742.2463, y: 400.6532, radius: 16.1083, kind: 'stripe', confidence: 0.3078 },
  ],
  aimAngle: 0.0659,
  aimReach: 420.0,
  contactX: 711.0,
  contactY: 408.5,
  contactRadius: 13.7758,
  bounceX: null,
  bounceY: null,
  bounceAngle: null,
  powerTipY: null,
  powerSlotTop: null,
  powerSlotBottom: null,
  clothColor: '#315A98',
  note: null,
};

/** The ball the guideline is aimed at, measured off each frame by a rim fit. */
const AIMED_AT = [
  { frame: FRAME_1, without: FRAME_1_WITHOUT_RECOVERY, x: 1039.1, y: 531.1 },
  { frame: FRAME_2, without: FRAME_2_WITHOUT_RECOVERY, x: 742.6, y: 402.0 },
];

function predictFrom(analysis: FrameAnalysis) {
  const vision = worldFromAnalysis(analysis);
  if (!isVisionWorld(vision)) throw new Error(`rejected: ${vision.reason}`);
  return {
    vision,
    prediction: predictShot(vision.world, {
      direction: fromAngle(vision.aimAngle!),
      power: 0.5,
      firstContact: vision.aimReach ?? undefined,
      contactPoint: vision.contact ?? undefined,
    }),
  };
}

describe('a shot lined up on a ball', () => {
  it.each(AIMED_AT)('has the aimed-at ball in the world', ({ frame, x, y }) => {
    const { vision } = predictFrom(frame);
    const near = vision.world.balls.filter(
      (b) => Math.hypot(b.position.x - x, b.position.y - y) < vision.world.table.ballRadius
    );
    expect(near).toHaveLength(1);
  });

  it.each(AIMED_AT)('strikes it rather than running past to a cushion', ({ frame, x, y }) => {
    const { vision, prediction } = predictFrom(frame);
    const contact = prediction.primaryContact;
    expect(contact).toBeTruthy();
    // The cue ball's first event is hitting that ball, not a rail.
    const target = vision.world.balls.find((b) => b.id === contact!.targetId)!;
    expect(Math.hypot(target.position.x - x, target.position.y - y)).toBeLessThan(
      vision.world.table.ballRadius
    );
    // And it happens where the game said it would, not somewhere down the table.
    expect(
      Math.hypot(contact!.ghostBall.x - vision.contact!.x, contact!.ghostBall.y - vision.contact!.y)
    ).toBeLessThan(vision.world.table.ballRadius);
  });

  it.each(AIMED_AT)('is what the ball pass alone gets wrong', ({ without, x, y }) => {
    const { vision, prediction } = predictFrom(without);
    // The ball really is missing from this reading...
    expect(
      vision.world.balls.some(
        (b) => Math.hypot(b.position.x - x, b.position.y - y) < vision.world.table.ballRadius
      )
    ).toBe(false);
    // ...so the cue ball sails through where it stood, reaches a rail, and only
    // meets a ball much later somewhere else entirely. Nothing about the shot
    // happens where the game itself drew the contact, which is the bug as the
    // player sees it: an aim at a ball drawn as an aim at a cushion.
    expect(prediction.root.cushions.length).toBeGreaterThan(0);
    const missed = Math.hypot(
      (prediction.primaryContact?.ghostBall.x ?? Infinity) - vision.contact!.x,
      (prediction.primaryContact?.ghostBall.y ?? Infinity) - vision.contact!.y
    );
    expect(missed).toBeGreaterThan(4 * vision.world.table.ballRadius);
  });
});
