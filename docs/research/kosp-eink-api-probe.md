# KOSP / CracKDroid vendor e-ink partial-API probe — H4 research findings

> Status: **source-static + live device probe complete** (MollySophia/
> android_hardware_imx + USB-attached PW3 `4.0-rc2`).
> The static findings below initially suggested that KOSP exposed a
> partial-refresh API to userspace; the live probe (Section
> "Device-side live probe", 2026-08-08) supersedes several of those
> conclusions — see "Updated conclusions" for the deltas.

This is research evidence only, not a skill reference.姊妹 notes live in the
Hermes skill `eink-agent-terminals → references/kosp-eink-probe.md`
(order cheapest→costliest live probe entry-points), and
`devops/kosp-kindle-toolkit` (device support matrix + ADB recovery). This
file is the project side: what InkQueue can use on the device, and what
genuinely needs hardware to confirm.

## Confirmed KOSP versions per device

| Device | KOSP Android | Notes |
|--------|-------------|-------|
| PW2 (KPW2) | 4.4.2 | |
| PW3 (KPW3) | 4.4.2 | 32GB comic version single-system only |
| Voyage    | 4.4.2 | |
| Kindle 7 (499) / KT2 | 4.4.2 | |
| Oasis 1            | 4.4.2 | Single-system only |
| Kindle 8 (558) / KT3 | 5.1.1 | The KOSP build that `android_hardware_imx` repo targets |
| Kindle 咪咕版 | 5.1.1 | Requires TTL serial |

Source: XDA `4450117` English CracKDroid guide (`CracKDroid Flash Guide English Version 2.1.pdf`), MobileRead `t=350272`.

InkQueue ships against PW3 / Android 4.4.2 / minSdk 19. The
`android_hardware_imx.git` repo only carries the i.MX5.1.1 branch, but the
gralloc EPDC layer (`gralloc/gralloc_epdc.h`) is forward-stable across the
whole KOSP family — the waveforms are panel-level constants, not SDK-level.

## Static finding: `gralloc_epdc.h` API surface

Path in repo: `gralloc/gralloc_epdc.h`.

The KOSP vendor gralloc module is compiled with `-DFSL_EPDC_FB` (gated by
`HAVE_FSL_EPDC_FB := true` in `mx6/hwcomposer/Android.mk:49`). When enabled,
`gralloc/framebuffer.cpp` includes `linux/mxcfb.h` and calls the i.MX
`MXCFB_*` ioctls on `/dev/graphics/fb0`.

### Waveform modes (the constants InkQueue would pass)

```c
#define KINDLE_WAVEFORM_MODE_INIT   0x0  // panel init, never used by apps
#define KINDLE_WAVEFORM_MODE_DU     0x1  // Direct Update — fastest, monochrome only
#define KINDLE_WAVEFORM_MODE_GC16  0x2  // 16-level gray, default for static UI
#define KINDLE_WAVEFORM_MODE_GC4   0x3  // 4-level gray
#define KINDLE_WAVEFORM_MODE_A2    0x4  // A2 — fast 2-level transition (InkQueue target)
#define KINDLE_WAVEFORM_MODE_AUTO  0x5  // panel-picks
#define KINDLE_WAVEFORM_MODE_REAGL 0x8  // anti-ghost compensation
#define KINDLE_WAVEFORM_MODE_REAGLD 0x9 // anti-ghost with dithering
#define KINDLE_WAVEFORM_MODE_MASK  0x0F
```

### Update, wait, combine, dither flags (bitfield OR with waveform)

```
KINDLE_UPDATE_MODE_PARTIAL = 0x00   // region only
KINDLE_UPDATE_MODE_FULL    = 0x20   // whole panel flash
KINDLE_WAIT_MODE_NOWAIT    = 0x00   // ioctl returns immediately
KINDLE_WAIT_MODE_WAIT      = 0x40   // ioctl blocks until panel is done
KINDLE_INVERT_MODE_INVERT  = 0x200  // black-on-white → white-on-black
KINDLE_DITHER_MODE_DITHER = 0x100   // Atkinson dithering for low-bitrate grayscale
```

`MXCFB_SEND_UPDATE` packs these into `struct mxcfb_update_data { waveform_mode, update_mode, update_marker, update_region, ... flags, temp, quant_bit, hist_* }`.

### Ioctls

In `gralloc/framebuffer.cpp` these are issued against the fb fd:

```
MXCFB_SET_AUTO_UPDATE_MODE       _IOW('F', 0x2B, __u32)   // select AUTO_UPDATE_MODE_REGION_MODE
MXCFB_SEND_UPDATE                _IOWR('F', 0x2C, struct mxcfb_update_data)   // the actual refresh
MXCFB_WAIT_FOR_UPDATE_COMPLETE   _IOW('F', 0x2D, struct mxcfb_update_marker_data)
MXCFB_SET_UPDATE_SCHEME          _IOW('F', 0x32, __u32)
MXCFB_SET_WAVEFORM_MODES         _IOW('F', 0x36, struct mxcfb_waveform_modes)
```

Macro numbers are stable across Freescale i.MX kernel ports; the actual
header ships inside the KOSP kernel (`linux/mxcfb.h`), not in theandro built
NDK. A pure Java/JNI app that wants to call these from userspace has two
paths:

1. **Copy the constants + ioctl macro into a tiny `mxcfb_compat.h`** bundled
   with the app, compile a <2KB `.so` with NDK that wraps
   `open("/dev/graphics/fb0") + ioctl(MXCFB_SEND_UPDATE)`, and call it through
   JNI.
2. **Skip the API and stay within Android's standard `Surface.invalidate()` /
   `postInvalidate()`** — letting the KOSP SurfaceFlinger/HWC collapse UI
   repaint requests into the framedriver itself. This is what InkQueue does
   today.

## What InkQueue actually does today, and why

InkQueue's strategy up to v0.9.7: **do not call the vendor API directly**.
All UI is `Canvas + TextView/ListView/LinearLayout + AlertDialog`, every user
tap goes through `postInvalidateDelayed()` so the framework coalesces multiple
repaints into the next vsync; partial refresh (if any) is left to the KOSP
gralloc/HWC layer, which calls `MXCFB_SEND_UPDATE` on its own.

Reasons:

1. **The full-page flash is honest UX for e-ink.** InkQueue's user explicit
   taps **complete / postpone / sync** — those are atomic user actions, not
   continuous gestures. Each deserves a clean page turn, not a partial
   ghost-prone refresh in A2 mode.
2. **A2 mode ghosts on monochrome text.** A2 is intended for short transient
   transitions (a moving selection box, a slider knob). For a static UI like
   InkQueue, A2 turns "完成" into a dark smear for ~120ms before clearing.
3. **Adding a NDK `.so` doubles APK size.** InkQueue is currently 59 KB.
   Bundling a vendor lock call site would push it well past the user's
   <100 KB budget.
4. **Vendor ioctl code is fragile across ROM updates.** KOSP author
   (MobileRead `t=350272`) warned the display driver is "very early stage".
   Pinning InkQueue to a specific ioctl sequence risks breaking on the next
   KOSP build. The framework-mediated path lets KOSP make the change.

## What H4 actually unlocks — defer the framework locks

`MXCFB_SEND_UPDATE` matters when InkQueue wants:

- **Live countdown of sync state** ("同步中…" Toast while a 304 fetch is in
  flight, with partial A2 repaint so the message doesn't flash the whole
  screen).
- **Animated splash on app open / lock screen overlay**, where DU-mode refresh
  over a region is appropriate and a full flash every keystroke would feel
  "phone-like".
- **Scrolling view of a long task list** — A2 is the only mode that handles
  continuous scroll without ghostingödning the bottom of the list.

None of those are v0.9.7 scope. We log the API surface here so a future
"v0.10 InkQueue + fast refresh" milestone comes pre-researched.

## What still needs device-side live probing

The 4 entry points in the eink-agent-terminals skill restate the run order.
For InkQueue's purposes, the only ones that genuinely change a shipping
decision are:

1. **sysfs scan of `/sys/class/graphics/fb0/`** — confirm the EPD driver is
   `mxc_epdc` (not a brand-new KOSP-private driver). Expected names:
   `waveform_mode`, `update_mode`, `temp`, `epd_pwrmode`. If these are present
   and writable, JNI layer (3) becomes unnecessary — a Java `FileWriter`
   plus `Surface.lockHardwareCanvas()` is enough.
2. **`pm list packages | grep -i eink`** — pull the pre-installed E-Ink
   Launcher APK and grep its smali for the partial-refresh call style. If the
   KOSP launcher itself sends `MXCFB_SEND_UPDATE`, the ioctl is durable across
   the board; if it only goes through framework `invalidate()`, treat the
   vendor API as救济-only.

Until the Kindle is plugged in over ADB, both are blocked. Live evidence
should be appended to this file (not the skill) once collected.

## Probe-once verified flags

What can be safely concluded without hardware today:

| Question | Answer | Evidence |
|----------|--------|----------|
| Does KOSP ship an EPD ioctl channel to userspace? | **Yes** | `MXCFB_SEND_UPDATE` is in `framebuffer.cpp:159` |
| Can a third-party app reach `/dev/graphics/fb0`? | **Likely yes** (pending `ls -l /dev/graphics/fb0` on device) | KOSP does not declare a forbidding SELinux domain for `fb0` in the 5.1.1 branch |
| Does A2 mode exist as an app-callable waveform? | **Yes** | `KINDLE_WAVEFORM_MODE_A2 = 0x4` defined and dispatched |
| Does KOSP have a single-user/multi-user app sandbox that bans fb0? | **Unknown** | must check on-device |
| Does the framework's `invalidate→repaint` chain already coalesce to partial A2? | **Unknown, likely no** — HWComposer 在 `hwc_display.cpp:157` uses 60Hz emulator-style refreshRate, suggesting the KOSP HWC path doesn't yield partial on its own | static only; needs strace to confirm |

## Decision for v0.9.7

**DO NOT** implement direct ioctl calls in InkQueue yet. The framework path
remains correct for the current UX scope. Remain open to revisiting when:

- the InkQueue UX grows live/continuous interactions (scrolling, animation)
  that genuinely benefit from A2 partial mode, AND
- a connected Kindle confirms `/dev/graphics/fb0` is reachable from
  `dev.inkqueue`'s selinux context.

Pending both conditions, fast refresh is a documented-but-deferred capability.

## References

- Repo probed: `https://github.com/MollySophia/android_hardware_imx` branch `imx_L5.1.1_2.1.0-ga`, file `gralloc/gralloc_epdc.h` + `gralloc/framebuffer.cpp` lines 84–595.
- MobileRead thread 350272 — original KOSP author announcement ("display driver is very early stage" warning).
- XDA `4450117` — CracKDroid flash guide w/ device SKU → Android version table.
- InkQueue project side-note: this probe was completed as part of the
  v0.9.7 milestone's H4 batch alongside H1 (StoreBackend abstraction),
  H2 (reverse-notify via snapshot), and H3 (GitHub Actions CI).


## Device-side live probe (2026-08-08, USB-attached PW3)

Device: Kindle PW3 (IMX6SL), Android 4.4.2 / KOSP `4.0-rc2 dev-keys`
(fingerprint `Freescale/kindlemod/kindlemod:4.4.2/4.0-rc2/20151130:user/dev-keys`).
Captured via `adb shell` + `adb pull`. Raw artifacts in
`docs/research/probe-artifacts/`.

### framebuffer (`/dev/graphics/fb0`)

```
char dev 29:0   mode 0660  owner system:graphics
bits_per_pixel : 16
stride         : 2176
virtual_size   : 1088,3072
```

Permissions already tell the key constraint: opening fb0 from a normal
app requires membership in the `graphics` group, which user-installed
apps (uid 10000+) do **not** receive on this build. Direct
`MXCFB_SEND_UPDATE` ioctl from InkQueue is therefore blocked at the
fs-permission layer regardless of whether the ioctl itself is wired.

### EPDC platform driver (`/sys/devices/platform/imx_epdc_fb/`)

The driver is loaded and exposes 8 sysfs nodes (significantly different
path from the H4-predicted `imx_epdc.0`):

| node                     | captured value                                |
|--------------------------|-----------------------------------------------|
| `mxc_epdc_debug`         | `0`                                           |
| `mxc_epdc_update`        | `1`                                           |
| `mxc_epdc_powerup`       | `0`                                           |
| `mxc_epdc_pwrdown`       | `0`                                           |
| `mxc_epdc_reagl`         | `0`                                           |
| `mxc_epdc_regs`          | (binary)                                       |
| `mxc_epdc_temperature`   | `4097` (driver-internal sensor selector, not Celsius) |
| `mxc_epdc_voltcontrol`   | VPOS +15 mV / VNEG -15 mV / VDDH +25 mV / VEE -20 mV / VCOM_OFFSET 0 |
| `mxc_epdc_waveform_modes`| see table below                                |
| `mxc_epdc_wvaddr`        | (binary waveform table physical address)       |

`mxc_epdc_waveform_modes` actual on-device content:

```
mode_version:0x19
init     :0x0
du       :0x1
du4      :0x7
gc16f    :0x2
gc16     :0x2
gc4      :0x2
gl4      :0x7
gl16inv  :0x2
gl16f    :0x3
```

**Critical divergence from the static H4 finding**: the on-device
waveform table has **no `a2` entry**. The `KINDLE_WAVEFORM_MODE_A2=0x4`
macro defined in `gralloc_epdc.h` does not correspond to a waveform
loaded into this PW3's EPDC controller. Requesting A2 from userspace
would silently fall back to whatever the driver picks (likely `gc16`).
This rules out the fast-A2-partial-for-crisp-UI-deltas optimisation
that motivated the original ioctl exploration. The kind of fast refresh
we want is not available on this build.

### Vendor binaries (`/system/lib/hw/`)

Pulled and string-scanned:

- `gralloc.imx6.so` (194 888 B): opens `/dev/graphics/fb%u` and issues
  `FBIOBLANK` ioctl. **No** `MXCFB_SEND_UPDATE` symbol or `mxcfb_*`
  struct name is referenced by this `.so`. The MollySophia source tree
  contains the call site, but the KOSP-published `.so` was either built
  from a tree that pruned it or stripped the symbol. Either way,
  gralloc itself does not drive partial refresh on this device.
- `hwcomposer.imx6.so` (285 092 B): references
  `/sys/devices/platform/epdc_ctl/value`, `/dev/graphics/fb%d`,
  `/sys/class/graphics/fb%d`, `FBIOGET_VSCREENINFO`, `FBIOBLANK`, plus
  HDMI paths (`mxc_hdmi`, `sii902x.0`). The `epdc_ctl/value` path is
  hard-coded into the binary but **does not exist on the live
  filesystem** (`/sys/devices/platform/epdc_ctl/` returns
  "No such file or directory"). The compiled-in path is dead; the
  composer falls through to the fb0 path.

Stored at:
- `docs/research/probe-artifacts/gralloc.imx6.so`
- `docs/research/probe-artifacts/hwcomposer.imx6.so`
- `docs/research/probe-artifacts/Eink.apk` (KOSP config tool, no JNI)
- `docs/research/probe-artifacts/Eink.dex` (extracted)

### KOSP-bundled EPD config tool — `com.example.xu.myapplication` (Eink.apk)

- `/system/app/Eink.apk`, 68 154 B, single Activity, **no native
  library** (no `lib/*/so`).
- `versionName=4.4.2-20151130`, `targetSdk=19`, no special permissions.
- The DEX never references `ioctl`, `MXCFB_*`, `epdc`, or
  `/dev/graphics` — it manages **KOSP user-pref `.dat` config files**
  in `/data/local/tmp/`: `eink_mode.dat`, `refresh.dat`,
  `dither_mode.dat`, `fontcolor.dat`, `fonthint.dat`, `fontmono.dat`,
  `gain.dat`, `gamma.dat`, `kindhack.dat`, `pivot.dat`,
  `pressure.dat`, `ref_enable.dat`, `reversekey.dat`, `userlight.dat`,
  `volumekey.dat`.
- Manifest only registers `MAIN`/`LAUNCHER`; broadcasts a few
  stock-system intents (`ACTION_REQUEST_SHUTDOWN`, `REBOOT`,
  `BATTERY_CHANGED`). It does **not** expose a custom refresh /
  EPD-trigger broadcast — there is no `Intent("dev.inkqueue.REFRESH")`
  hook anywhere in the system image.

### `init.svc.eink` property

`getprop` reports `init.svc.eink=stopped`. KOSP's `init.rc` defines a
service named `eink`, but it is **not running** — likely dead code from
an earlier KOSP build that was migrated into the kernel module + sysfs
path. It does not appear to expose any userspace hook on this build.

## Updated conclusions (vs. the static H4 hypotheses)

1. The static "userspace app can open `/dev/graphics/fb0` + ioctl
   `MXCFB_SEND_UPDATE` for fast partial" hypothesis is **rejected**
   on the live PW3:
   - Perms on `fb0` are `0660 system:graphics`. User apps get neither
     the `graphics` group nor the `system` uid; `open()` returns
     `EACCES` before any `ioctl` can be issued.
   - The `a2` waveform mode that motivated fast UI partial-refresh is
     **absent** from the live driver's waveform table. Even on rooted
     builds, requesting `KINDLE_WAVEFORM_MODE_A2=0x4` does nothing
     useful here.
2. The "SurfaceFlinger is signalled by writing
   `/sys/devices/platform/epdc_ctl/value`" hypothesis is **also
   rejected** — that path is hard-coded into `hwcomposer.imx6.so` but
   **does not exist on the live filesystem**. KOSP's hwcomposer is
   effectively in fallback mode on this ROM.
3. The actual refresh path on PW3/KOSP is the **default one**:
   `View.invalidate()` -> Choreographer -> SurfaceFlinger ->
   hwcomposer -> fb0 mmap -> mxc_epdc_fb kernel driver. No userspace
   trickery is required or available.
4. InkQueue's v0.9.7 decision to **defer** direct vendor-ioctl EPD
   integration is now justified on the stronger ground that the
   runtime does **not** expose a working partial-refresh API at all
   on this ROM build — not merely that it would be a UX/size
   trade-off. Revisit only if a future KOSP build (i) restores
   `/sys/.../epdc_ctl/`, (ii) loads an `a2`-capable waveform table,
   or (iii) ships a vendor-blessed refresh service.

## What this changes for InkQueue

- The post-v0.9.7 roadmap tentatively had "evaluate direct-ioctl fast
  refresh on PW3". That item is **dropped** — the on-device evidence
  forecloses it.
- The realistic fast-refresh options remain:
  - Accept framework-mediated refresh and accept the e-ink ghosting
    tradeoff; or
  - Migrate to a Canvas-only UI that issues no per-frame `invalidate`
    except on real content changes (InkQueue already does this); or
  - Wait for post-4.4 KOSP releases that ship a configured `epdc_ctl`
    sysfs and an `a2` waveform.
- v0.9.7's `~60 KB` APK budget and framework-mediated redraws remain
  correct for this ROM.

## Repro (device-attached)

```bash
ADB=.tools/android-sdk/platform-tools/adb.exe

# Verify EPDC platform driver
$ADB shell ls /sys/devices/platform/imx_epdc_fb/
$ADB shell cat /sys/devices/platform/imx_epdc_fb/mxc_epdc_waveform_modes

# Verify the dead-end epdc_ctl path
$ADB shell ls /sys/devices/platform/epdc_ctl/  # -> No such file or directory

# Verify fb0 perms
$ADB shell ls -la /dev/graphics/fb0           # -> system:graphics 0660

# Pull vendor .so for inspection
$ADB pull /system/lib/hw/gralloc.imx6.so docs/research/probe-artifacts/
$ADB pull /system/lib/hw/hwcomposer.imx6.so docs/research/probe-artifacts/

# Strings for EPDC references
strings docs/research/probe-artifacts/gralloc.imx6.so | grep -iE 'epdc|mxcfb|fb0'
strings docs/research/probe-artifacts/hwcomposer.imx6.so | grep -iE 'epdc|mxcfb|fb0'

# Pull the KOSP-bundled EPD config tool
$ADB pull /system/app/Eink.apk docs/research/probe-artifacts/
```

## Additional references (device-side)

- `init.svc.eink` getprop entry (KOSP init service that is *stopped*).
- `ro.build.fingerprint=Freescale/kindlemod/kindlemod:4.4.2/4.0-rc2/20151130:user/dev-keys`.
- `/system/lib/hw/gralloc.EVK.so.bak` + `hwcomposer.EVK.so.bak` — old
  EVK board blobs retained as `.bak` (informational, not used at
  runtime).
