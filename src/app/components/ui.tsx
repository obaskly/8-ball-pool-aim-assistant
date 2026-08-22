import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { palette } from '../palette';

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  disabled,
  tone = 'default',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
}) {
  const toneStyle =
    tone === 'primary'
      ? styles.primary
      : tone === 'danger'
        ? styles.danger
        : styles.neutral;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        toneStyle,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          tone === 'primary' && { color: palette.onAccent },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text
              style={[styles.segmentText, active && styles.segmentTextActive]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggle}>
      <Text style={[styles.toggleLabel, disabled && { color: palette.border }]}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: palette.border, true: palette.accent }}
        thumbColor={palette.text}
      />
    </View>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function Note({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'warn' | 'danger';
}) {
  const color =
    tone === 'danger'
      ? palette.danger
      : tone === 'warn'
        ? palette.warn
        : palette.muted;
  return <Text style={[styles.note, { color }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: palette.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    flexBasis: 0,
  },
  neutral: { backgroundColor: palette.panelAlt },
  primary: { backgroundColor: palette.accent },
  danger: { backgroundColor: palette.danger },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  buttonText: { color: palette.text, fontSize: 13, fontWeight: '600' },
  segmented: {
    flexDirection: 'row',
    backgroundColor: palette.panelAlt,
    borderRadius: 8,
    padding: 3,
  },
  segment: {
    flexGrow: 1,
    flexBasis: 0,
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: palette.accent },
  segmentText: { color: palette.muted, fontSize: 12, fontWeight: '600' },
  segmentTextActive: { color: palette.onAccent },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  toggleLabel: { color: palette.text, fontSize: 13 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  stat: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  statLabel: { color: palette.muted, fontSize: 12 },
  statValue: {
    color: palette.text,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  note: { fontSize: 11, lineHeight: 16, marginTop: 6 },
});
