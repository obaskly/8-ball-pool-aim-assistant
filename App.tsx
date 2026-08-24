import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  OverlayNative,
  type CaptureConfig,
  type OverlayPanelState,
} from './modules/overlay-native';
import {
  IDENTITY_ADJUSTMENT,
  buildTable,
  type CalibrationAdjustment,
} from './src/calibration/tableProfile';
import { buildScene, type SceneOptions } from './src/overlay/scene';
import { DEFAULT_THEME } from './src/overlay/theme';
import { predictShot } from './src/physics/engine';
import { CUE_POWER_CM_S } from './src/physics/gamePhysics';
import type { EngineOptions, World } from './src/physics/types';
import { fromAngle, vec, type Vec2 } from './src/physics/vec2';
import {
  estimatePower,
  primaryGapForCapture,
  type LatchedVision,
  type PowerCalibration,
} from './src/vision';
import { Slider } from './src/app/components/Slider';
import {
  Button,
  Note,
  Row,
  Section,
  SegmentedControl,
  Stat,
  Toggle,
} from './src/app/components/ui';
import { palette } from './src/app/palette';
import { useCapture, type CaptureApi } from './src/app/useCapture';
import { useOverlay } from './src/app/useOverlay';

const DEG = 180 / Math.PI;

/** Where the aim direction comes from. */
type AimSource = 'auto' | 'manual';
/**
 * Where shot power comes from. 'auto' reads the meter on the left of the game
 * screen and falls back to the slider whenever it is not showing, which is
 * whenever it is not your shot.
 */
type PowerSource = 'auto' | 'manual';

export default function App() {
  const overlay = useOverlay();

  const [aimSource, setAimSource] = useState<AimSource>('auto');
  const [aimAngle, setAimAngle] = useState(0);
  const [power, setPower] = useState(0.85);
  const [powerSource, setPowerSource] = useState<PowerSource>('auto');
  /** Last power read off the meter, for the panel to show. */
  const [readPower, setReadPower] = useState<number | null>(null);
  /** True once a full pull-back has taught the meter its bottom end. */
  const [powerSettled, setPowerSettled] = useState(false);

  const [maxDepth, setMaxDepth] = useState(1);
  const [maxCushions, setMaxCushions] = useState(3);
  const [restitution, setRestitution] = useState(0.9);
  const [preserveAngle, setPreserveAngle] = useState(true);
  const [cueBallSpin, setCueBallSpin] =
    useState<EngineOptions['cueBallSpin']>('auto');
  /**
   * Which cue is equipped, as an index into the game's own tier table. The
   * strongest by default, which is what the engine assumed before this existed.
   */
  const [cueTier, setCueTier] = useState(CUE_POWER_CM_S.length - 1);

  // Accuracy is set by how many pixels wide a ball is, not by the frame size:
  // the aim fit holds to a quarter of a degree at a ~16 px radius and starts
  // losing thin guidelines below about 10. On a 2340 px display this lands at
  // 18 px, with room to spare.
  const [captureScale, setCaptureScale] = useState(0.75);
  const [captureFps, setCaptureFps] = useState(15);

  const [adjust, setAdjust] = useState<CalibrationAdjustment>(IDENTITY_ADJUSTMENT);
  const [showTable, setShowTable] = useState(false);
  const [showBalls, setShowBalls] = useState(false);
  const [showCutAngle, setShowCutAngle] = useState(true);
  const [interactive, setInteractive] = useState(false);

  const screen = overlay.metrics;

  const engine = useMemo<Partial<EngineOptions>>(
    () => ({
      maxDepth,
      maxCushions,
      restitution,
      preserveReflectionAngle: preserveAngle,
      cueBallSpin,
      cuePower: CUE_POWER_CM_S[cueTier],
    }),
    [maxDepth, maxCushions, restitution, preserveAngle, cueBallSpin, cueTier]
  );

  const captureConfig = useMemo<CaptureConfig>(
    () => ({ scale: captureScale, fps: captureFps, detectAim: true }),
    [captureScale, captureFps]
  );

  // -- Live path -------------------------------------------------------------

  // Everything the per-frame handler needs, in a ref: it is registered once and
  // would otherwise capture the values from the render that created it.
  /**
   * The meter's calibration, and the power last shown in the panel. Refs, not
   * state: these are touched on every analysed frame and only the panel value
   * is ever rendered, so keeping them out of state avoids a re-render at the
   * capture rate.
   */
  const powerCalRef = useRef<PowerCalibration | null>(null);
  /** Whether the overlay is already blank, so we clear on the edge only. */
  const clearedRef = useRef(false);
  const shownPowerRef = useRef<number | null>(null);
  /**
   * What the last scene pushed to the overlay was built from. PoolPredictor's
   * `determineShotResult` returns early when angle, power and spin all match
   * the previous call, and this is the same guard for the same reason: the
   * inputs jitter by fractions of a pixel and a fraction of a degree every
   * frame, and re-predicting and re-pushing on each one repaints lines that
   * have not meaningfully moved fifteen times a second. Skipping the repaint
   * is what makes the drawn lines sit still while you line a shot up.
   */
  const pushedRef = useRef<{
    angle: number;
    power: number;
    cueX: number;
    cueY: number;
    ballSig: number;
  } | null>(null);

  const liveRef = useRef({
    aimSource,
    aimAngle,
    power,
    powerSource,
    engine,
    captureConfig,
    scene: { showTable, showBalls, showCutAngle } as SceneOptions,
  });
  liveRef.current = {
    aimSource,
    aimAngle,
    power,
    powerSource,
    engine,
    captureConfig,
    scene: { showTable, showBalls, showCutAngle },
  };

  /**
   * Runs on every captured frame that has something to draw. Predict and push
   * straight to the overlay, without going through React: at 15 fps a state
   * round-trip would add a frame of latency to something that is tracking a
   * moving cue ball.
   *
   * The prediction is rebuilt here from the frame's own ball positions rather
   * than reused, so even while the reading is being held the lines follow the
   * table instead of freezing.
   */
  const onVision = useCallback((vision: LatchedVision) => {
    const s = liveRef.current;

    // The game draws its guideline only while you are aiming, and takes it away
    // the instant you shoot. Past that point anything we draw describes a shot
    // that has already been played — and because the balls are moving it
    // tracks them and looks live, which is worse than drawing nothing. So when
    // there is no aim to follow, clear and wait for the next one rather than
    // quietly falling back to the manual angle.
    if (s.aimSource === 'auto' && vision.aimAngle === null) {
      if (!clearedRef.current) {
        clearedRef.current = true;
        pushedRef.current = null;
        try {
          OverlayNative.clearScene();
        } catch {
          // Nothing to clear if the module is not there.
        }
      }
      return;
    }
    clearedRef.current = false;

    const auto = s.aimSource === 'auto' && vision.aimAngle !== null;
    const angle = auto ? vision.aimAngle! : s.aimAngle;

    // The meter is only on screen while it is our shot, and sits at the top of
    // its travel for as long as the player is still aiming. Both mean no power
    // has been chosen, so fall back to the slider rather than predict a shot of
    // no power — which would draw a path of no length and blank the overlay.
    const read = estimatePower(vision.power, powerCalRef.current);
    const chosen = read.power !== null && !read.atRest ? read.power : null;
    const wasSettled = powerCalRef.current?.settled ?? false;
    powerCalRef.current = read.calibration;
    if ((read.calibration?.settled ?? false) !== wasSettled) {
      setPowerSettled(read.calibration?.settled ?? false);
    }
    if (chosen !== shownPowerRef.current) {
      const moved =
        shownPowerRef.current === null ||
        chosen === null ||
        Math.abs(chosen - shownPowerRef.current) > 0.02;
      if (moved) {
        shownPowerRef.current = chosen;
        setReadPower(chosen);
      }
    }
    const shotPower =
      s.powerSource === 'auto' && chosen !== null ? chosen : s.power;

    // Skip the repaint when nothing that shapes the shot has really changed —
    // see pushedRef. Everything here is smoothed upstream, so "really changed"
    // has honest thresholds: a fifth of a degree of aim, a per-mille of power,
    // a pixel of any ball. A fading (held) reading always repaints, because the
    // fade itself is the change.
    const cueBall = vision.world.balls.find((b) => b.kind === 'cue');
    let ballSig = vision.world.balls.length * 0x100000;
    for (const b of vision.world.balls) {
      ballSig += Math.round(b.position.x / 2) + Math.round(b.position.y / 2);
    }
    const last = pushedRef.current;
    if (
      last !== null &&
      vision.fade >= 1 &&
      cueBall !== undefined &&
      Math.abs(last.angle - angle) < 0.0035 &&
      Math.abs(last.power - shotPower) < 0.01 &&
      Math.abs(last.cueX - cueBall.position.x) < 1 &&
      Math.abs(last.cueY - cueBall.position.y) < 1 &&
      last.ballSig === ballSig
    ) {
      return;
    }

    const prediction = predictShot(
      vision.world,
      {
        direction: fromAngle(angle),
        power: shotPower,
        // Only when we are following the game's own line: the measurement
        // describes where *that* line ends, and it says nothing about where a
        // hand-aimed one would.
        firstContact: auto ? vision.aimReach ?? undefined : undefined,
        contactPoint: auto ? vision.contact ?? undefined : undefined,
      },
      s.engine
    );

    OverlayNative.setScene(
      buildScene(vision.world, prediction, {
        ...s.scene,
        fade: vision.fade,
        primaryGap: primaryGapForCapture(
          DEFAULT_THEME.primary,
          vision.world.table.ballRadius,
          s.captureConfig
        ),
      })
    );
    pushedRef.current =
      vision.fade >= 1 && cueBall !== undefined
        ? {
            angle,
            power: shotPower,
            cueX: cueBall.position.x,
            cueY: cueBall.position.y,
            ballSig,
          }
        : null;
  }, []);

  /** The hold finally ran out: nothing on screen is a table any more. */
  const onLost = useCallback(() => {
    pushedRef.current = null;
    try {
      OverlayNative.clearScene();
    } catch {
      // Nothing to clear if the module is not there.
    }
  }, []);

  const capture = useCapture(captureConfig, adjust, onVision, onLost);

  // The panel listener is registered once and would otherwise hold the first
  // render's capture api forever.
  const captureRef = useRef(capture);
  captureRef.current = capture;

  // -- Preview ---------------------------------------------------------------

  /**
   * What the panel draws before the first reading arrives: the measured table
   * with nothing on it. It keeps the calibration sliders meaningful while the
   * game is not running, and it is the only table geometry that does not come
   * from the screen.
   */
  const idleWorld = useMemo<World>(
    () => ({ table: buildTable(screen.width, screen.height, adjust), balls: [] }),
    [screen.width, screen.height, adjust]
  );

  // The preview lags the overlay by up to a quarter second, which is deliberate
  // — see useCapture.
  const world = capture.vision ? capture.vision.world : idleWorld;
  const table = world.table;

  const autoAim = aimSource === 'auto' && capture.vision?.aimAngle != null;
  const effectiveAim = autoAim ? capture.vision!.aimAngle! : aimAngle;
  const effectivePower =
    powerSource === 'auto' && readPower !== null ? readPower : power;
  const firstContact = autoAim ? capture.vision?.aimReach ?? undefined : undefined;
  const contactPoint = autoAim ? capture.vision?.contact ?? undefined : undefined;

  const cuePosition =
    world.balls.find((b) => b.kind === 'cue')?.position ?? vec(0, 0);

  const prediction = useMemo(
    () =>
      predictShot(
        world,
        {
          direction: fromAngle(effectiveAim),
          power: effectivePower,
          firstContact,
          contactPoint,
        },
        engine
      ),
    [world, effectiveAim, effectivePower, firstContact, contactPoint, engine]
  );

  const scene = useMemo(
    () => buildScene(world, prediction, { showTable, showBalls, showCutAngle }),
    [world, prediction, showTable, showBalls, showCutAngle]
  );

  // While capture is running `onVision` owns the overlay, and pushing here as
  // well would fight it at a lower frame rate. Before it starts, this is what
  // puts the manual-aim preview on screen.
  useEffect(() => {
    if (overlay.running && !capture.running) overlay.push(scene);
  }, [overlay.running, overlay.push, scene, capture.running]);

  // Touches on the overlay itself aim, same as dragging the preview. The cue
  // position lives in a ref so a drag does not resubscribe on every frame.
  const cueRef = useRef(cuePosition);
  cueRef.current = cuePosition;

  useEffect(() => {
    if (!interactive || !overlay.running) return;
    try {
      const sub = OverlayNative.addListener('onOverlayTouch', (e) => {
        const c = cueRef.current;
        setAimAngle(Math.atan2(e.y - c.y, e.x - c.x));
      });
      return () => sub.remove();
    } catch {
      return;
    }
  }, [interactive, overlay.running]);

  useEffect(() => {
    if (overlay.running) overlay.setInteractive(interactive);
  }, [interactive, overlay.running, overlay.setInteractive]);

  // -- Floating panel --------------------------------------------------------

  /**
   * What the panel over the game shows. It has no state of its own: it reports
   * taps and is told the result, so the two copies of these settings cannot
   * drift apart.
   */
  const panelState = useMemo<OverlayPanelState>(
    () => ({
      status: readingStatus(capture.running, capture.vision, capture.stats),
      detail: capture.stats.fps
        ? `${capture.stats.fps.toFixed(1)} fps · ${capture.stats.analysisMs} ms · ` +
          `${capture.stats.ballCount} balls`
        : capture.running
          ? 'starting'
          : 'stopped',
      clothColor: capture.stats.clothColor,
      powerSource,
      power,
      cueBallSpin: cueBallSpin ?? 'auto',
      maxDepth,
      maxCushions,
      showTable,
      showBalls,
      showCutAngle,
      interactive,
    }),
    [
      // The specific readings rather than the capture object, which is a new
      // object every render: this crosses the bridge, so it should fire when
      // something on the panel actually changed.
      capture.running,
      capture.vision,
      capture.stats,
      powerSource,
      power,
      cueBallSpin,
      maxDepth,
      maxCushions,
      showTable,
      showBalls,
      showCutAngle,
      interactive,
    ]
  );

  useEffect(() => {
    try {
      OverlayNative.setPanelState(panelState);
    } catch {
      // No native module; nothing is showing the panel either.
    }
  }, [panelState]);

  useEffect(() => {
    try {
      const sub = OverlayNative.addListener('onPanelChange', (event) => {
        switch (event.key) {
          case 'powerSource':
            setPowerSource(event.value as PowerSource);
            break;
          case 'power':
            setPower(Number(event.value));
            break;
          case 'cueBallSpin':
            setCueBallSpin(event.value as EngineOptions['cueBallSpin']);
            break;
          case 'maxDepth':
            setMaxDepth(Math.round(Number(event.value)));
            break;
          case 'maxCushions':
            setMaxCushions(Math.round(Number(event.value)));
            break;
          case 'showTable':
            setShowTable(Boolean(event.value));
            break;
          case 'showBalls':
            setShowBalls(Boolean(event.value));
            break;
          case 'showCutAngle':
            setShowCutAngle(Boolean(event.value));
            break;
          case 'interactive':
            setInteractive(Boolean(event.value));
            break;
          case 'relearnCloth':
            captureRef.current.relearnCloth();
            break;
          case 'stopCapture':
            void captureRef.current.stop();
            break;
        }
      });
      return () => sub.remove();
    } catch {
      return;
    }
  }, []);

  const patch = (next: Partial<CalibrationAdjustment>) =>
    setAdjust((a) => ({ ...a, ...next }));

  /**
   * The whole start-up sequence behind one button: draw-over permission, then
   * the overlay window, then the capture consent dialog. Each step is a system
   * prompt, so they have to happen in order and cannot be batched.
   */
  const startLive = async () => {
    if (!overlay.permission) {
      await overlay.requestPermission();
      // The permission screen is a separate activity; the user comes back here
      // and taps again. Nothing else can be done in this pass.
      return;
    }
    if (!overlay.running) await overlay.start(interactive);
    if (!capture.running) await capture.start();
  };

  const stopLive = async () => {
    await capture.stop();
    await overlay.stop();
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden />

      <ScrollView
        style={styles.left}
        contentContainerStyle={styles.columnContent}
      >
        <Text style={styles.title}>Aim Assistant</Text>
        <Text style={styles.subtitle}>
          {screen.width}x{screen.height} px · {screen.density.toFixed(2)}x
        </Text>

        <View style={styles.stats}>
          <Stat
            label="Playfield"
            value={`${Math.round(table.playfield.left)},${Math.round(
              table.playfield.top
            )} → ${Math.round(table.playfield.right)},${Math.round(
              table.playfield.bottom
            )}`}
          />
          <Stat label="Ball radius" value={`${table.ballRadius.toFixed(1)} px`} />
          <Stat label="Ball contacts" value={`${prediction.ballContacts.length}`} />
          <Stat label="Cushions" value={`${prediction.cushionContacts.length}`} />
          <Stat
            label="Potted"
            value={
              prediction.potted.length
                ? prediction.potted.map((p) => p.ballId).join(', ')
                : '—'
            }
          />
          <Stat
            label="Cut angle"
            value={
              prediction.primaryContact
                ? `${(prediction.primaryContact.cutAngle * DEG).toFixed(1)}°`
                : '—'
            }
          />
        </View>

        <Section title="Live game">
          <Row>
            <Button
              title={
                !overlay.permission
                  ? 'Grant draw-over permission'
                  : capture.running
                    ? 'Reading the table'
                    : 'Start reading the table'
              }
              tone="primary"
              disabled={capture.running}
              onPress={startLive}
            />
            <Button
              title="Stop"
              tone="danger"
              disabled={!capture.running && !overlay.running}
              onPress={stopLive}
            />
          </Row>

          <Note>
            Open the pool game first, then come back and start. Android will ask
            to record the screen — that consent is what lets the app see the
            table. Nothing leaves the device. Once it is running, the floating
            chip opens the settings on top of the game, so you never have to
            come back here.
          </Note>

          <View style={{ height: 8 }} />

          <Stat label="Capture" value={capture.running ? 'running' : 'stopped'} />
          <Stat
            label="Rate"
            value={
              capture.stats.fps
                ? `${capture.stats.fps.toFixed(1)} fps · ${capture.stats.analysisMs} ms/frame`
                : '—'
            }
          />
          <Stat
            label="Balls seen"
            value={
              capture.stats.frames
                ? `${capture.stats.ballCount} · cloth ${(
                    capture.stats.clothFraction * 100
                  ).toFixed(0)}%`
                : '—'
            }
          />
          <Stat
            label="Reading"
            value={readingStatus(capture.running, capture.vision, capture.stats)}
          />
          <Stat label="Table colour" value={capture.stats.clothColor ?? '—'} />

          {capture.error ? <Note tone="danger">{capture.error}</Note> : null}

          <Row>
            <Button
              title="Re-read table colour"
              disabled={!capture.running}
              onPress={capture.relearnCloth}
            />
          </Row>
          <Note>
            The detector works out the cloth colour from the table itself, so
            any skin works. It notices a change on its own after a second or
            two; this is for when you would rather not wait.
          </Note>

          <View style={{ height: 8 }} />

          <SegmentedControl<AimSource>
            options={[
              { value: 'auto', label: "Game's aim line" },
              { value: 'manual', label: 'Manual aim' },
            ]}
            value={aimSource}
            onChange={setAimSource}
          />
          <Note>
            {aimSource === 'manual'
              ? 'Using the aim slider below, and the preview, instead of the guideline.'
              : capture.stats.aimIsLive
                ? `Following the game's guideline at ${(effectiveAim * DEG).toFixed(1)}°.`
                : capture.vision?.aimAngle != null
                  ? `Holding the last guideline at ${(effectiveAim * DEG).toFixed(
                      1
                    )}° — the game only draws its line while you are aiming.`
                  : 'No guideline seen yet — pull the cue back in the game.'}
          </Note>
        </Section>
      </ScrollView>

      <ScrollView
        style={styles.right}
        contentContainerStyle={styles.columnContent}
      >
        <Section title="Overlay">
          <Stat
            label="Permission"
            value={overlay.permission ? 'granted' : 'not granted'}
          />
          <Stat label="Service" value={overlay.running ? 'running' : 'stopped'} />

          <View style={{ height: 8 }} />

          {!overlay.permission && (
            <Row>
              <Button
                title="Grant draw-over permission"
                tone="primary"
                onPress={overlay.requestPermission}
              />
            </Row>
          )}

          <Row>
            <Button
              title="Start overlay"
              tone="primary"
              disabled={!overlay.permission || overlay.running}
              onPress={() => overlay.start(interactive)}
            />
            <Button
              title="Stop"
              tone="danger"
              disabled={!overlay.running}
              onPress={overlay.stop}
            />
          </Row>

          <Toggle
            label="Floating chip"
            value={overlay.bubble}
            onChange={overlay.setBubble}
          />
          <Note>
            A draggable button that sits on top of the game. Its ring turns green
            while the table is being read. Drag it anywhere; tap it to open the
            settings over the game.
          </Note>

          <Toggle
            label="Settings over the game"
            value={overlay.panel}
            onChange={overlay.setPanel}
          />
          <Note>
            The settings worth changing between shots, as a window on top of the
            game: what the detector is reading, power, cue-ball roll, what the
            overlay draws. Drag it by its title bar, and minimise it when you are
            done. Everything else stays here.
          </Note>

          <Toggle
            label="Overlay receives touches"
            value={interactive}
            onChange={setInteractive}
          />
          <Note>
            {interactive
              ? 'Touches land on the overlay and aim the shot. The app underneath gets nothing.'
              : 'Touches pass straight through to whatever is underneath. The floating chip still works either way.'}
          </Note>

          {overlay.error ? <Note tone="danger">{overlay.error}</Note> : null}
        </Section>

        <Section title="Capture tuning">
          <Slider
            label="Capture scale"
            value={captureScale}
            min={0.3}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={setCaptureScale}
          />
          <Slider
            label="Frame rate"
            value={captureFps}
            min={5}
            max={30}
            step={1}
            format={(v) => `${v} fps`}
            onChange={setCaptureFps}
          />
          <Note>
            Scale trades detection accuracy for CPU and only applies on the next
            start. Everything else takes effect on the next frame.
          </Note>
        </Section>

        <Section title="Shot">
          <Slider
            label="Aim"
            value={aimAngle * DEG}
            min={-180}
            max={180}
            step={0.5}
            format={(v) => `${v.toFixed(1)}°`}
            onChange={(v) => setAimAngle(v / DEG)}
          />
          <SegmentedControl<PowerSource>
            options={[
              { value: 'auto', label: 'Read meter' },
              { value: 'manual', label: 'Slider' },
            ]}
            value={powerSource}
            onChange={setPowerSource}
          />
          <Slider
            label="Power"
            value={power}
            min={0.05}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={setPower}
          />
          <Note>
            {powerSource === 'manual'
              ? 'Using the slider for every shot.'
              : readPower !== null
                ? `Reading ${Math.round(readPower * 100)}% off the game's meter.` +
                  (powerSettled
                    ? ''
                    : ' Pull it all the way back once to calibrate the top end.')
                : 'Using the slider until you pull the cue back.'}
          </Note>
          <Note>
            Power sets how far the path is drawn, as its square: 20% reaches a
            twenty-fifth as far as 100%. It only changes the cue ball's angle on
            shots short enough that it is still sliding when it lands.
          </Note>

          <Slider
            label="Cue"
            value={cueTier}
            min={0}
            max={CUE_POWER_CM_S.length - 1}
            step={1}
            format={(v) => `tier ${v + 1} · ${CUE_POWER_CM_S[v]} cm/s`}
            onChange={(v) => setCueTier(Math.round(v))}
          />
          <Note>
            The meter is read as a fraction of the cue you have equipped, and
            the game's cues run from 666 to 889 cm/s. Set this too high and every
            path is drawn too long — speed enters the run squared, so the weakest
            cue reaches 44% less far than the strongest at the same reading.
          </Note>
        </Section>

        <Section title="Engine">
          <SegmentedControl<EngineOptions['cueBallSpin']>
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'stun', label: 'Stun' },
              { value: 'natural', label: 'Roll' },
            ]}
            value={cueBallSpin}
            onChange={setCueBallSpin}
          />
          <Note>
            {cueBallSpin === 'stun'
              ? 'Draws the 90-degree tangent, matching the line the game itself shows.'
              : cueBallSpin === 'natural'
                ? 'Assumes the cue ball is always rolling at contact: the 30-degree rule.'
                : 'Works out roll from power and distance. A rolling cue ball carries forward off the tangent, which is where the game says the ball really goes.'}
          </Note>
          <Slider
            label="Collision depth"
            value={maxDepth}
            min={0}
            max={4}
            step={1}
            format={(v) => `${v}`}
            onChange={setMaxDepth}
          />
          <Slider
            label="Max cushions per path"
            value={maxCushions}
            min={0}
            max={8}
            step={1}
            format={(v) => `${v}`}
            onChange={setMaxCushions}
          />
          <Slider
            label="Cushion restitution"
            value={restitution}
            min={0.5}
            max={1}
            step={0.01}
            onChange={setRestitution}
          />
          <Toggle
            label="Equal incidence/reflection angles"
            value={preserveAngle}
            onChange={setPreserveAngle}
          />
          <Note>
            {preserveAngle
              ? 'Mirrors the direction exactly and scales the whole speed by e.'
              : 'Damps only the normal component. More physical, but the outgoing angle no longer equals the incoming one.'}
          </Note>
        </Section>

        <Section title="Calibration">
          <Slider
            label="Offset X"
            value={adjust.offsetX}
            min={-200}
            max={200}
            step={1}
            format={(v) => `${v.toFixed(0)} px`}
            onChange={(v) => patch({ offsetX: v })}
          />
          <Slider
            label="Offset Y"
            value={adjust.offsetY}
            min={-200}
            max={200}
            step={1}
            format={(v) => `${v.toFixed(0)} px`}
            onChange={(v) => patch({ offsetY: v })}
          />
          <Slider
            label="Playfield scale"
            value={adjust.scale}
            min={0.8}
            max={1.2}
            step={0.002}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(v) => patch({ scale: v })}
          />
          <Slider
            label="Ball radius scale"
            value={adjust.ballRadiusScale}
            min={0.6}
            max={1.6}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => patch({ ballRadiusScale: v })}
          />
          <Slider
            label="Pocket capture scale"
            value={adjust.captureRadiusScale}
            min={0.5}
            max={2}
            step={0.01}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            onChange={(v) => patch({ captureRadiusScale: v })}
          />
          <Row>
            <Button
              title="Reset calibration"
              onPress={() => setAdjust(IDENTITY_ADJUSTMENT)}
            />
            <Button title="Re-read screen size" onPress={overlay.refresh} />
          </Row>
          <Note>
            Measured at 2340x1080. Devices with a different aspect ratio need the
            offset and scale nudges, because the game letterboxes rather than
            stretching.
          </Note>
        </Section>

        <Section title="Overlay contents">
          <Toggle label="Table outline and pockets" value={showTable} onChange={setShowTable} />
          <Toggle label="Ball positions" value={showBalls} onChange={setShowBalls} />
          <Toggle label="Cut angle readout" value={showCutAngle} onChange={setShowCutAngle} />
        </Section>
      </ScrollView>
    </View>
  );
}

/**
 * One line for what the detector is doing, which is the first thing to look at
 * when the overlay is not behaving. "held" means the current frame was rejected
 * and the last good reading is still on screen — normal in short bursts, and a
 * sign the table is covered or off screen if it stays there.
 */
function readingStatus(
  running: boolean,
  vision: CaptureApi['vision'],
  stats: CaptureApi['stats']
): string {
  if (!running) return '—';
  if (!vision) return stats.rejection ?? 'looking for the table';
  if (stats.age === 0) return 'ok';
  return `held ${stats.age}f · ${stats.rejection ?? 'no reading'}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: palette.bg,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 14,
  },
  left: { flex: 1 },
  right: { flex: 1 },
  columnContent: { paddingBottom: 24 },
  title: { color: palette.text, fontSize: 20, fontWeight: '700' },
  subtitle: {
    color: palette.muted,
    fontSize: 12,
    marginBottom: 10,
    fontVariant: ['tabular-nums'],
  },
  modeRow: { marginTop: 10 },
  stats: {
    marginTop: 10,
    backgroundColor: palette.panel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 10,
  },
});
