---
type: doc
status: active
tags: [opengym, weight-trend, kalman, plate-calculator, rir, autoregulation, tdee, energy-balance]
relatedTo: [opengym]
---

# Smart tracking

Four data features that turn raw logs into decisions, all client-side and offline. Every
constant is a documented default and overridable; none is copied from any third-party app.

## Smoothed weight trend

`src/lib/weight-trend.js`. Your scale reading is true weight plus a few kilos of water and gut
contents that swing over days. The trend models those two things separately — a slow level
with a drifting rate, and a fast transient — and fits them with a Kalman filter followed by a
backward (RTS) smoothing pass, which is why a past day's trend can be revised once later data
arrives. Robust outlier rejection (MAD-based, with a run-length escape so a *real* step change
isn't rejected forever) keeps a mistyped weigh-in from dragging the line.

- Three presets in **Settings → Weight trend smoothing**: Responsive, Balanced, Smooth.
- Home and Stats draw the trend as the bold line with raw weigh-ins as faint dots beneath.
- Stats shows the current trend weight, the weekly rate, and an ETA to your goal weight.

## Plate calculator

`src/lib/plates.js`. Turns a target barbell weight into the plates to hang on each side
(greedy largest-first, optimal for real plate sets), and rounds a prescription to the nearest
weight you can actually build. Shown per set on the workout screen for barbell lifts. Bar
weight is set in **Settings → Barbell weight**; a finite plate inventory is supported by the
library.

## Effort-target (RIR) progression

`src/lib/progression.js`, policy `rir`. An autoregulated policy: rate how many reps you left
in reserve and the weight drifts to keep every session near a target RIR. Each rep-in-reserve
off target moves the load by ~3.3 % (the standard "1 rep ≈ 3 % of 1RM"), capped per session so
one stray rating can't lurch. Pick it per exercise under its progression rule; set the target
RIR there. Sits alongside the existing linear, Greyskull and double-progression policies.

## Energy expenditure & calorie targets

`src/lib/energy.js`. Measures expenditure instead of guessing it: over a window, TDEE ≈ mean
intake − 7700 kcal/kg × (change in trend weight ÷ days). It uses the *smoothed* trend, so one
salty day can't look like a change in metabolism. Log daily calories from **Stats → Energy →
Log calories**; after about a week it shows your expenditure and a suggested intake for a
chosen weekly rate of weight change.

7700 kcal/kg is the textbook energy content of body-mass change; the window (21 days) and
minimum data (7 days) are defaults in the module.

## Tests

Pure-function libraries, each with a Vitest suite:
`weight-trend.test.js`, `plates.test.js`, `progression-rir.test.js`, `energy.test.js`.
