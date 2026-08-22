import React, { useMemo, useRef, useState } from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { palette } from '../palette';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Quantisation. Omit for continuous. */
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

const TRACK_HEIGHT = 6;
const THUMB = 22;

/**
 * Minimal slider built on PanResponder.
 *
 * Written by hand rather than pulled in as a dependency: the project has no
 * community-slider dependency and this is the only control that needs dragging.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: SliderProps) {
  const [width, setWidth] = useState(0);

  // PanResponder is created once, so its handlers would capture the first
  // render's props. The ref keeps them pointed at the current ones.
  const commit = useRef<(x: number) => void>(() => {});
  commit.current = (x: number) => {
    if (width <= 0) return;
    const t = Math.min(1, Math.max(0, x / width));
    const raw = min + t * (max - min);
    const next = step ? Math.round(raw / step) * step : raw;
    onChange(Math.min(max, Math.max(min, next)));
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => commit.current(e.nativeEvent.locationX),
        onPanResponderMove: (e) => commit.current(e.nativeEvent.locationX),
      }),
    []
  );

  const onLayout = (e: LayoutChangeEvent) =>
    setWidth(e.nativeEvent.layout.width);

  const fraction = max === min ? 0 : (value - min) / (max - min);
  const clamped = Math.min(1, Math.max(0, fraction));

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>
          {format ? format(value) : value.toFixed(2)}
        </Text>
      </View>

      <View
        style={styles.hitArea}
        onLayout={onLayout}
        {...responder.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            { left: Math.max(0, clamped * width - THUMB / 2) },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: 10 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  label: { color: palette.muted, fontSize: 12 },
  value: {
    color: palette.text,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  hitArea: { height: THUMB + 8, justifyContent: 'center' },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: palette.border,
    overflow: 'hidden',
  },
  fill: { height: TRACK_HEIGHT, backgroundColor: palette.accent },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: palette.accent,
    borderWidth: 2,
    borderColor: palette.bg,
  },
});
