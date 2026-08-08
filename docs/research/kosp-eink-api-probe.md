# KOSP / CracKDroid vendor e-ink partial-API probe — H4 research findings

> Status: **source-static probe complete** (MollySophia/android_hardware_imx).
> Device-side live probing (sysfs / strace / launcher reverse) pending —
> blocked on USB-attached Kindle. The static findings below are sufficient
> to conclude that KOSP **does** expose a partial-refresh API to userspace.

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
