import React, { useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Ball, PathSegment, Prediction, World } from '../../physics/types';
import type { Vec2 } from '../../physics/vec2';
import { palette } from '../palette';

interface TablePreviewProps {
  world: World;
  prediction: Prediction;
  /** Screen size the world coordinates are expressed in. */
  screen: { width: number; height: number };
  /** Fires with a point in screen coordinates while dragging. */
  onPoint: (point: Vec2) => void;
}

/**
 * RN colours are `#RRGGBBAA`, the overlay's are `#AARRGGBB`, so the preview keeps
 * its own set rather than reusing the overlay theme.
 */
const COLORS = {
  primary: '#ffffff',
  tangent: '#6fe3ff',
  object: '#ffd54f',
  ghost: 'rgba(255,255,255,0.85)',
  cushion: '#ff8a65',
  potted: '#7cff8a',
  pocket: '#050b12',
};

const DASH_LENGTH = 14;

export function TablePreview({
  world,
  prediction,
  screen,
  onPoint,
}: TablePreviewProps) {
  const [boxWidth, setBoxWidth] = useState(0);
  const scale = boxWidth > 0 ? boxWidth / screen.width : 0;

  const handle = useRef<(x: number, y: number) => void>(() => {});
  handle.current = (x, y) => {
    if (scale <= 0) return;
    onPoint({ x: x / scale, y: y / scale });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) =>
          handle.current(e.nativeEvent.locationX, e.nativeEvent.locationY),
        onPanResponderMove: (e) =>
          handle.current(e.nativeEvent.locationX, e.nativeEvent.locationY),
      }),
    []
  );

  const onLayout = (e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width);

  const { playfield: pf, ballRadius } = world.table;
  const r = ballRadius * scale;

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.box,
          { aspectRatio: screen.width / screen.height },
        ]}
        onLayout={onLayout}
        {...responder.panHandlers}
      >
        {scale > 0 && (
          <>
            <View
              style={[
                styles.cloth,
                {
                  left: pf.left * scale,
                  top: pf.top * scale,
                  width: (pf.right - pf.left) * scale,
                  height: (pf.bottom - pf.top) * scale,
                },
              ]}
            />

            {world.table.pockets.map((p) => (
              <View
                key={p.id}
                style={[
                  styles.pocket,
                  {
                    left: (p.center.x - p.captureRadius) * scale,
                    top: (p.center.y - p.captureRadius) * scale,
                    width: p.captureRadius * 2 * scale,
                    height: p.captureRadius * 2 * scale,
                    borderRadius: p.captureRadius * scale,
                  },
                ]}
              />
            ))}

            {world.balls.map((b) => (
              <BallDot key={b.id} ball={b} scale={scale} />
            ))}

            {prediction.segments.map((s, i) => (
              <Segment key={i} segment={s} scale={scale} />
            ))}

            {prediction.primaryContact && (
              <View
                style={[
                  styles.ghost,
                  {
                    left: prediction.primaryContact.ghostBall.x * scale - r,
                    top: prediction.primaryContact.ghostBall.y * scale - r,
                    width: r * 2,
                    height: r * 2,
                    borderRadius: r,
                  },
                ]}
              />
            )}

            {prediction.cushionContacts.map((c, i) => (
              <View
                key={`c${i}`}
                style={[
                  styles.marker,
                  {
                    left: c.at.x * scale - 3,
                    top: c.at.y * scale - 3,
                  },
                ]}
              />
            ))}

            {prediction.potted.map((p, i) => (
              <View
                key={`p${i}`}
                style={[
                  styles.potted,
                  {
                    left: p.at.x * scale - r * 1.6,
                    top: p.at.y * scale - r * 1.6,
                    width: r * 3.2,
                    height: r * 3.2,
                    borderRadius: r * 1.6,
                  },
                ]}
              />
            ))}
          </>
        )}
      </View>

      <Text style={styles.hint}>
        Drag anywhere to aim the cue ball at that point, which switches to
        manual aim.
      </Text>
    </View>
  );
}

function BallDot({ ball, scale }: { ball: Ball; scale: number }) {
  const r = ball.radius * scale;
  const fill =
    ball.kind === 'cue'
      ? '#f5f5f5'
      : ball.kind === 'eight'
        ? '#101418'
        : ball.kind === 'stripe'
          ? '#7fd4ff'
          : '#ffc247';

  return (
    <View
      style={[
        styles.ball,
        {
          left: ball.position.x * scale - r,
          top: ball.position.y * scale - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: fill,
        },
      ]}
    />
  );
}

function Segment({ segment, scale }: { segment: PathSegment; scale: number }) {
  const color =
    segment.role === 'primary'
      ? COLORS.primary
      : segment.role === 'tangent'
        ? COLORS.tangent
        : COLORS.object;

  const from = { x: segment.from.x * scale, y: segment.from.y * scale };
  const to = { x: segment.to.x * scale, y: segment.to.y * scale };
  const width = segment.role === 'tangent' ? 1.5 : 2;

  // RN has no dashed line primitive, so the tangent line is chopped into pieces.
  if (segment.role !== 'tangent') {
    return <Bar from={from} to={to} color={color} width={width} />;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.min(60, Math.floor(length / DASH_LENGTH));
  if (steps < 1) return <Bar from={from} to={to} color={color} width={width} />;

  const pieces = [];
  for (let i = 0; i < steps; i += 2) {
    const t0 = i / steps;
    const t1 = Math.min(1, (i + 1) / steps);
    pieces.push(
      <Bar
        key={i}
        from={{ x: from.x + dx * t0, y: from.y + dy * t0 }}
        to={{ x: from.x + dx * t1, y: from.y + dy * t1 }}
        color={color}
        width={width}
      />
    );
  }
  return <>{pieces}</>;
}

function Bar({
  from,
  to,
  color,
  width,
}: {
  from: Vec2;
  to: Vec2;
  color: string;
  width: number;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return null;

  // Views rotate about their centre, so the bar is placed centred on the
  // segment's midpoint and then turned.
  return (
    <View
      style={{
        position: 'absolute',
        left: (from.x + to.x) / 2 - length / 2,
        top: (from.y + to.y) / 2 - width / 2,
        width: length,
        height: width,
        backgroundColor: color,
        transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
      }}
    />
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  box: {
    width: '100%',
    backgroundColor: '#060d16',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  cloth: {
    position: 'absolute',
    backgroundColor: palette.cloth,
    borderWidth: 2,
    borderColor: palette.clothEdge,
  },
  pocket: { position: 'absolute', backgroundColor: COLORS.pocket },
  ball: { position: 'absolute' },
  ghost: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: COLORS.ghost,
  },
  marker: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.cushion,
  },
  potted: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: COLORS.potted,
  },
  hint: { color: palette.muted, fontSize: 11, marginTop: 6 },
});
