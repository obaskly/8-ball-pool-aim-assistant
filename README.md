# 8 Ball Pool Aim Assistant

Android app that reads the pool game off the screen and draws the predicted
shot as an overlay. Runs as a system overlay, so the game keeps running
underneath. Not affiliated with Miniclip. Doesn't touch the game process,
files, or network traffic. Everything it knows comes from pixels.

Not 100% accurate. A pixel or two of detection error grows over the length
of a trajectory, so trust the first contact and tangent line more than long
cushion chains. Spin isn't read. Colour thresholds were tuned on a handful
of table skins.

![the overlay drawing a cut shot](docs/screenshots/overlay-cut-shot.jpeg)

Green is the cue ball, amber is whatever it sets moving, the ring is the
ghost ball, the number is the cut angle. Rings on pockets mark the ones a
ball is going into.

| | |
|---|---|
| ![a bank into the far corner](docs/screenshots/overlay-bank-shot.jpeg) | ![a thin cut into the side pocket](docs/screenshots/overlay-side-pocket.jpeg) |
| ![the object ball running the cushions](docs/screenshots/overlay-cushion-run.jpeg) | ![the eight into a corner](docs/screenshots/overlay-eight-ball.jpeg) |

## Download

**[Download the APK](https://github.com/obaskly/8-ball-pool-aim-assistant/releases/latest/download/aim-assistant-arm64-v8a.apk)**
(about 25 MB, latest release)

64-bit ARM build, Android 7.0+.

1. Download on your phone, or `adb install -r aim-assistant-arm64-v8a.apk`.
2. Android will warn about an unknown source. Allow installs from your
   browser or file manager.
3. Play Protect may also warn, since it flags anything new. Install anyway
   if you're comfortable with that.
4. Check the APK against the checksum on the releases page:
   `sha256sum aim-assistant-arm64-v8a.apk`

Everything below is for building it yourself.

## How it works

Three pieces, running about 15 times a second.

### 1. Read the screen

A foreground service mirrors the display through `MediaProjection` into an
`ImageReader`. `TableAnalyzer.kt` does the vision work on the raw buffer:

- Detect the cloth colour. Table skins vary (blue, teal, green, brown,
  near-black), so it matches the *shape* of the colour rather than a fixed
  value; see **Reading any table** below.
- Take the playfield rectangle from the median cloth extent across
  scanlines, restricted to cloth connected to the table's centre.
- Flood-fill everything that isn't cloth, filter blobs by area/fill/aspect
  to drop HUD elements and pocket notches.
- Classify each ball as cue, eight, stripe or solid by white fraction and
  brightness.
- Read the game's own aim guideline and power meter directly off the
  screen.

The guideline does most of the work: since the game has already solved the
aim, the detector reads that answer instead of estimating one. It picks up
the aim line, the ghost-ball contact point (which sets the object ball's
direction), and, when the line hits a rail, the short reflected stub the
game draws past it. That's the game's own cushion response for that shot, used
for the first rebound instead of physics alone. On synthetic test frames
the stub match is within a degree and the corner within a pixel.

The ghost ring also confirms a ball is present. Balls are found as peaks
in the distance transform of the non-cloth mask, so a ball survives being
drawn over, but not a line drawn *across* it, since the game's dark navy
outline can split a ball into two thin lobes that don't register alone. In
that case the ring (always one diameter from the ball's centre) is swept
for the largest non-cloth disc and the ball is restored from that.

The power meter is read as a cue sitting in a slot: what matters is the y
position of the ferrule, not a fill level. Only the full-power end is
fixed; the app learns the other end on the first full pull-back it sees.

Nothing is written to disk and nothing leaves the device.

#### Reading any table

An earlier version matched one fixed colour and only worked on one skin.

The current approach splits a pixel into grey and colour parts. Cloth
shading scales the colour part, table light adds grey, neither rotates the
hue, so every shade of one cloth lies along a single ray out of the grey
axis, and distance from that ray separates cloth from rails, balls and
chrome. On the near-black skin the ray has almost no direction, which
correctly reads as "barely any colour."

Three things make it work:

- **A bounded run along the ray.** A floor separates blue cloth from the
  app's own navy chrome (same hue, less saturated); a ceiling keeps a blue
  ball on a blue table from reading as cloth.
- **Cloth must connect to the table.** The rectangle is measured only over
  cloth reachable from the table's centre, so matching-colour chrome
  outside the rail doesn't get pulled in.
- **The floor is chosen, not assumed.** Several candidate floors are
  tried; the one kept produces the most plausible pool-table-shaped
  rectangle, judged against known table proportions.

The guideline is found by shape, not brightness alone: it's a thin bright
ridge (white blended into felt), which clears the cloth beside it by
30-70 luma counts, versus 1-5 for the lit-centre gradient. A pure
brightness or saturation threshold fails across skins (misses the line on
a bright table, or excludes a tinted line), so the ridge test carries the
weight and the remaining thresholds stay loose.

The learned colour is cached and re-verified: only adopted if it produces
a plausible table (right proportions, reasonable cloth share, and
critically a rectangle that doesn't touch the screen edges, since the game
always frames the table inside chrome). No fallback to a "closest guess."
The cache is dropped as soon as it stops matching a real table, usually
within a second, or cleared manually from either panel.

Measured against `docs/reference-frames/` and other skin captures, the
playfield rectangle comes out within about two pixels in a thousand. The
detector avoids reading its own output: every default overlay colour sits
below the aim-sweep brightness threshold.

### 2. Predict the shot

Detected balls become a table in centimetres, run through the simulator in
`src/physics/sim.ts`. Fixed 200 Hz step, continuous collision detection,
constants recovered from the game itself:

| | |
|---|---|
| Table | 254 x 127 cm, ball radius 3.8 cm |
| Launch speed | `v = (1 - sqrt(1 - power)) * cuePower`, cuePower 666-888.85 cm/s |
| Sliding | 196 cm/s², until roll catches up with spin |
| Rolling | 10.878 cm/s² |
| Cushion | 0.804 restitution (normal), 0.4 friction (tangent) |
| Ball on ball | equal mass, elastic, 90° split; striker keeps its spin |
| Pockets | 8 cm radius, with the game's suction near the mouth |

Spin is tracked separately from velocity. The sliding phase covers ~987 cm
(near four table lengths), so a firm shot is still sliding on arrival and
the 90° guideline holds exactly; a soft shot is already rolling, and the
roll drags it forward after contact instead. One simulator covers both.

The table is a 46-point polygon with real pocket jaws, so balls bounce off
jaw corners like they do in the game.

The simulation runs under a wall-clock budget and a collision cap per
tick, for liveness rather than tuning: a heavy state (a break, a ball
rattling in a jaw) can cost far more than a quiet roll, or chain zero-time
collisions without limit. An overrunning prediction is truncated, keeping
the near (accurate) part of the path. The overlay also skips frames based
on the last prediction's cost, so a pathological table state thins the
drawing rather than freezing the app.

### 3. Draw it

A second foreground service owns a transparent, always-on-top window and
paints the prediction. Two services rather than one because Android 14
restricts a foreground service to its declared type, and combining them
would give the drawing service capture rights it doesn't need.

Lines show while the game is drawing its own guideline (while you're
aiming) and disappear the moment you take the shot. Two signals gate that:
the guideline disappearing (held a few frames since it flickers behind the
cue stick and HUD), and ball movement: if a ball moves further between
frames than detection noise explains, the shot has been struck and the
hold ends immediately.

A draggable chip sits on top of the game. Tapping it opens settings
(status, power, cue-ball roll, what the overlay draws) in a third window,
with a minimise button. It's a separate window because Android often drops
the capture session on a round trip back to the main app. The in-app panel
is the full one; the floating panel carries what's worth changing between
shots.

## Requirements

- Node 20+, npm
- JDK 17+ (21 works)
- Android SDK with platform 36 and build tools 36.x
- `adb` on your `PATH`
- A phone running Android 7.0+

The Gradle wrapper in `android/` pulls its own Gradle.

### Android SDK setup

With Android Studio: install "Android SDK Platform 36" and "Android SDK
Build-Tools 36" from the SDK Manager.

Without it, command line tools are enough:

```bash
mkdir -p ~/Android/Sdk/cmdline-tools
cd ~/Android/Sdk/cmdline-tools
# grab commandlinetools-linux-*.zip from https://developer.android.com/studio#command-tools
unzip commandlinetools-linux-*.zip
mv cmdline-tools latest

export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

Add the two `export` lines to `~/.bashrc` so they persist.

## Build

```bash
git clone https://github.com/obaskly/8-ball-pool-aim-assistant.git
cd 8-ball-pool-aim-assistant
npm install
npm run apk
```

Prints the output path when done:
`android/app/build/outputs/apk/release/app-release.apk`

Install: `adb install -r android/app/build/outputs/apk/release/app-release.apk`

The two steps separately, for debugging:

```bash
npx expo prebuild --platform android          # add --clean after editing app.json
cd android && ./gradlew assembleRelease
```

Or straight onto a connected device: `npx expo run:android --variant release`

The APK is ~66 MB (packs all four ABIs). For just your own phone:

```bash
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

### Build notes

`android/` is generated by prebuild, don't edit it by hand. Permissions
come from `plugins/withOverlayPermissions.js`, app config from
`app.json`, native code from `modules/overlay-native/`.

Release builds are signed by `plugins/withReleaseSigning.js`, which falls
back to the SDK debug key if these Gradle properties are missing (so a
fresh clone builds without setup). To use your own key:

```bash
keytool -genkeypair -v -keystore release.keystore -alias my-alias \
  -keyalg RSA -keysize 4096 -validity 10000
```

Then, in `~/.gradle/gradle.properties` (outside the repo):

```properties
AIM_RELEASE_STORE_FILE=/absolute/path/to/release.keystore
AIM_RELEASE_STORE_PASSWORD=...
AIM_RELEASE_KEY_ALIAS=my-alias
AIM_RELEASE_KEY_PASSWORD=...
```

Keep the keystore and that file out of git (`*.keystore` is already
gitignored). Losing the key means you can't ship an update over an
existing install.

Won't run in Expo Go. It needs a Kotlin module and manifest entries Expo Go
can't provide.

### Checks

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest, 116 tests
```

## First run

1. Open the pool game, start an offline match, switch back to the app.
2. Tap **Grant draw-over permission**, enable "Display over other apps".
   The app rechecks on returning to foreground, so tap again after.
3. Tap **Start reading table**, accept the screen recording prompt. Two
   notifications appear, each with a Stop action.
4. Switch to the game and aim. Tap the floating chip for settings on top
   of the game; **Minimise** puts them away and leaves the chip.

The **Reading** row shows detector status: `ok` is normal, `no cue ball`
means it's off the table or under a menu, `table not visible` means
something covers it, `no table colour` means it hasn't matched a table
yet, and an aspect ratio message means the view isn't head-on. **Table
colour** shows the matched cloth; **Re-read colour** forces a re-match.

Aim always follows the game's guideline. No hand-aim slider, since a
slider can't say anything the guideline doesn't say better. The overlay
clears when the game isn't drawing one. Power follows the game's meter and
falls back to a slider when the meter isn't showing. Touches always pass
through to the game.

Android won't resume a stopped capture session, so stopping and starting
always re-shows the consent dialog. That's an OS restriction, not this
app.

## Layout

```
App.tsx                     control panel and the per-frame loop
app.json                    Expo config, registers the plugin
plugins/                    injects overlay and foreground service permissions
modules/overlay-native/     local Expo module, autolinked, not published
  android/.../OverlayService.kt    overlay window
  android/.../CaptureService.kt    MediaProjection, ImageReader, VirtualDisplay
  android/.../TableAnalyzer.kt     cloth, balls, aim line, power meter
src/physics/                pure TypeScript, no React and no native imports
  gamePhysics.ts            the constants, with their derivations
  table8bp.ts               table polygon, pockets, cm-to-pixel mapping
  sim.ts                    the stepper
  simEngine.ts              simulation results into the shape the overlay speaks
src/vision/                 detections into a table, smoothing, latching
src/calibration/            measured table proportions
src/overlay/                prediction into draw commands
docs/reference-frames/      frames the calibration was measured from
docs/screenshots/           overlay running
```

## Limits

- Geometry measured at 2340x1080. A different aspect ratio needs the
  offset/scale nudges in the calibration panel, since the game letterboxes
  rather than stretches. Table colour needs no adjustment.
- Lucky Shot loses the cue ball: its marker is large enough to hollow the
  ball out in detection.
- No english. The simulator supports side spin but nothing reads the spin
  selector, so every shot is modelled through the centre.
- Set your equipped cue manually under **Shot**. Cue speed ranges 666-889
  cm/s and power is a fraction of it, so leaving it at the strongest
  overshoots every path on an early cue.
- Only one generation of struck balls is drawn by default, since detection
  error compounds through each collision. **Collision depth** goes up to
  four.
- A tight rack reads as a handful of balls, not fifteen, since the
  detector separates balls by visible cloth between them. A break is
  predicted against a table it can't fully see.
- Screen capture adds a frame or two of latency. Raising the fps slider
  helps if the ms-per-frame figure has room.

## Contributing

PRs welcome. Worth attention:

- Reading the spin selector so draw/follow aren't ignored (simulator
  already supports side spin).
- The Lucky Shot cue-ball detection issue above.
- Cutting latency between frame capture and lines landing.

Run `npm run typecheck` and `npm test` first.

## Credit

Physics constants and simulation structure came from
[PoolPredictor](https://github.com/OiwexO/PoolPredictor), which recovered
them from the game binary. [8BallPool](https://github.com/jonathansilva/8BallPool)
was useful for the overlay side. The vision pipeline, the Expo module and
everything in `src/` are original.
