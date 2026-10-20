// Smoothed body-weight trend (issue: smart tracking).
//
// A scale reading is your true weight plus a few kilos of water, gut contents and glycogen
// that come and go over days. Averaging a window lags; a line of best fit ignores that the
// noise is day-scale, not random. So this models the two explicitly and lets a Kalman filter
// separate them, then smooths backwards so a past day is informed by the days after it — the
// reason a weigh-in can be revised once more data arrives.
//
// This is a standard local-linear-trend state-space model with a transient term, fitted with
// the Rauch–Tung–Striebel smoother. Every constant below is a documented default chosen here,
// not lifted from any product; all of them are overridable so the behaviour can be tuned
// without touching the maths.
//
//   state x = [ level, rate, transient ]
//     level     — true weight (kg or lb; unit-agnostic)
//     rate       — level's drift per day; itself drifts slowly (a random walk)
//     transient  — fast water/glycogen swing, decaying toward 0 with a short half-life
//
// Pure function of the weigh-in list. Nothing is stored; change a preset and the whole curve
// is recomputed, so there are no cached trend values to fall out of sync with the log.

const HALF_LIFE_TRANSIENT = 4      // days for a water swing to fade by half
const TRANSIENT_SD = 0.8           // kg: typical size of the water/glycogen swing it absorbs
const DEFAULT_NOISE_FRACTION = 0.0075   // obs noise ≈ 0.75% of body weight when unmeasured
const OBS_NOISE_MIN = 0.3          // kg: a good scale is ±0.2–0.3 kg even standing still
const OBS_NOISE_MAX = 1.2          // kg: cap so one calm stretch can't make it over-trust
const OUTLIER_SIGMA = 3            // reject a reading this many robust-SDs from the prediction
const OUTLIER_RUN = 2              // after this many rejections in a row, accept it's a real shift
const MAD_TO_SIGMA = 1.4826        // MAD → σ for a normal distribution (textbook constant)
const MIN_FOR_NOISE = 5            // weigh-ins needed before scatter is measured, not assumed
const MS_DAY = 86400000

// Each preset is a (level, slope) process-noise pair. The level term says how freely the
// true weight may step beyond what its slope predicts; the slope term how freely the rate
// itself may turn. Bigger level trusts recent readings more and lags less; bigger slope lets
// the rate change direction faster. Both are tiny next to the observation noise, which is why
// day-to-day scatter lands in the transient term instead of the trend.
export const SMOOTHING = {
  responsive: { label: 'Responsive', qLevel: 0.020, qSlope: 2e-5, desc: 'Follows recent weigh-ins closely. Least lag, most wiggle.' },
  balanced: { label: 'Balanced', qLevel: 0.006, qSlope: 8e-6, desc: 'A steady line that still turns within a few days.' },
  smooth: { label: 'Smooth', qLevel: 0.0015, qSlope: 2e-6, desc: 'Ignores day-to-day noise hardest. Most lag, calmest line.' }
}
export const DEFAULT_SMOOTHING = 'balanced'

const tOf = b => b.t || new Date(b.d).getTime()
const median = a => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Robust day-to-day observation noise (kg), from the scatter of first differences. Successive
 * days share almost all of their true weight, so a difference is mostly noise; the median
 * absolute difference converts to a σ that a few wild readings cannot inflate.
 */
export function estimateNoise(bw) {
  const list = [...(bw || [])].sort((a, b) => tOf(a) - tOf(b))
  if (list.length < MIN_FOR_NOISE) {
    const w = list.length ? list[list.length - 1].w : 80
    return Math.min(OBS_NOISE_MAX, Math.max(OBS_NOISE_MIN, w * DEFAULT_NOISE_FRACTION))
  }
  const diffs = []
  for (let i = 1; i < list.length; i++) diffs.push(Math.abs(list[i].w - list[i - 1].w))
  // /√2 because a difference sums two days' independent noise.
  const sigma = (median(diffs) * MAD_TO_SIGMA) / Math.SQRT2
  return Math.min(OBS_NOISE_MAX, Math.max(OBS_NOISE_MIN, sigma))
}

// 3×3 helpers, kept local and explicit rather than pulling in a matrix dependency.
const matVec = (M, v) => M.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
const matMul = (A, B) => A.map((row, i) => B[0].map((_, j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]))
const transpose = M => M[0].map((_, j) => M.map(row => row[j]))
const addM = (A, B) => A.map((row, i) => row.map((v, j) => v + B[i][j]))
const subM = (A, B) => A.map((row, i) => row.map((v, j) => v - B[i][j]))
const ident = s => [[s, 0, 0], [0, s, 0], [0, 0, s]]

// Invert a 3×3 (used only on the smoother gain; these matrices are well-conditioned here).
function inv3(M) {
  const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2]
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  let det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) det = det < 0 ? -1e-12 : 1e-12
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g)
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d
  return [[A / det, D / det, G / det], [B / det, E / det, H / det], [C / det, F / det, I / det]]
}

function transition(dt, preset) {
  const rho = Math.pow(0.5, dt / HALF_LIFE_TRANSIENT)
  // level += rate·dt ; rate persists ; transient decays toward 0
  const F = [[1, dt, 0], [0, 1, 0], [0, 0, rho]]
  // Diagonal process noise (a local-linear-trend model with an AR(1) transient):
  //   · level random-walks by qLevel on top of what its slope predicts
  //   · slope random-walks by qSlope — small, so the rate turns slowly and reads smooth
  //   · transient regains exactly the stationary variance it shed this step, so the water
  //     term stays ~TRANSIENT_SD and keeps absorbing daily scatter the trend should ignore
  const tVar = TRANSIENT_SD * TRANSIENT_SD
  const Q = [
    [preset.qLevel * dt, 0, 0],
    [0, preset.qSlope * dt, 0],
    [0, 0, tVar * (1 - rho * rho)]
  ]
  return { F, Q }
}

const H = [1, 0, 1]   // a reading sees level + transient

/**
 * Smoothed trend for a body-weight series.
 * @param bw  [{ d:'YYYY-MM-DD', w, t? }]
 * @param opts { smoothing, obsNoise }
 * @returns null | {
 *   points: [{ d, t, raw, trend, rate }],   // rate is kg/day of the level
 *   latest: { trend, weeklyRate, raw },
 *   outliers: Set<iso>,
 *   obsNoise
 * }
 */
export function weightTrend(bw, opts = {}) {
  const list = [...(bw || [])].filter(b => b && b.w > 0).sort((a, b) => tOf(a) - tOf(b))
  if (!list.length) return null

  const preset = SMOOTHING[opts.smoothing] || SMOOTHING[DEFAULT_SMOOTHING]
  const obsNoise = opts.obsNoise > 0 ? opts.obsNoise : estimateNoise(list)
  const R = obsNoise * obsNoise

  if (list.length === 1) {
    const only = list[0]
    return {
      points: [{ d: only.d, t: tOf(only), raw: only.w, trend: only.w, rate: 0 }],
      latest: { trend: round1(only.w), weeklyRate: 0, raw: only.w },
      outliers: new Set(), obsNoise
    }
  }

  const n = list.length
  const outliers = new Set()
  // Robust scatter of first differences, so the outlier gate scales with this person's scale.
  const diffs = []
  for (let i = 1; i < n; i++) diffs.push(Math.abs(list[i].w - list[i - 1].w))
  const robustSd = Math.max(obsNoise, median(diffs) * MAD_TO_SIGMA)

  // ---- forward pass (Kalman filter) ----
  let x = [list[0].w, 0, 0]
  let P = [[R, 0, 0], [0, 0.01, 0], [0, 0, TRANSIENT_SD * TRANSIENT_SD]]
  const fx = [x], fP = [P], preds = [], Fs = []
  let consecutiveOutliers = 0
  for (let i = 1; i < n; i++) {
    const dt = Math.max(1, Math.round((tOf(list[i]) - tOf(list[i - 1])) / MS_DAY))
    const { F, Q } = transition(dt, preset)
    const xPred = matVec(F, x)
    const PPred = addM(matMul(matMul(F, P), transpose(F)), Q)
    preds.push({ x: xPred, P: PPred }); Fs.push(F)

    const yHat = xPred[0] + xPred[2]
    const resid = list[i].w - yHat
    const S = PPred[0][0] + 2 * PPred[0][2] + PPred[2][2] + R

    // A lone reading far from the prediction is a mis-entry or a one-off (travel, big meal) —
    // reject it so it can't drag the trend. But a real level shift looks the same at first, so
    // once a few readings in a row all disagree it is the trend that is wrong: stop rejecting
    // and let the filter move to the new reality.
    if (Math.abs(resid) > OUTLIER_SIGMA * robustSd && consecutiveOutliers < OUTLIER_RUN) {
      outliers.add(list[i].d)
      consecutiveOutliers++
      x = xPred; P = PPred
    } else {
      consecutiveOutliers = 0
      // Kalman gain K = P Hᵀ / S, then standard state and covariance updates.
      const PHt = [PPred[0][0] + PPred[0][2], PPred[1][0] + PPred[1][2], PPred[2][0] + PPred[2][2]]
      const K = [PHt[0] / S, PHt[1] / S, PHt[2] / S]
      x = [xPred[0] + K[0] * resid, xPred[1] + K[1] * resid, xPred[2] + K[2] * resid]
      const KH = [[K[0], 0, K[0]], [K[1], 0, K[1]], [K[2], 0, K[2]]]
      P = matMul(subM(ident(1), KH), PPred)
    }
    fx.push(x); fP.push(P)
  }

  // ---- backward pass (RTS smoother) ----
  const sx = fx.slice()
  for (let i = n - 2; i >= 0; i--) {
    const C = matMul(matMul(fP[i], transpose(Fs[i])), inv3(preds[i].P))
    sx[i] = fx[i].map((v, k) => v + (C[k][0] * (sx[i + 1][0] - preds[i].x[0]) +
      C[k][1] * (sx[i + 1][1] - preds[i].x[1]) +
      C[k][2] * (sx[i + 1][2] - preds[i].x[2])))
  }

  const points = list.map((b, i) => ({
    d: b.d, t: tOf(b), raw: b.w,
    trend: round1(sx[i][0]), rate: sx[i][1]
  }))
  const latest = points[points.length - 1]
  return {
    points,
    latest: { trend: latest.trend, weeklyRate: round1(latest.rate * 7), raw: latest.raw },
    outliers, obsNoise
  }
}

// Whole days until `trend` reaches `goal` at the current weekly rate, or null when the rate
// points the wrong way, is negligible, or the goal is more than a year out (not a projection
// worth showing). 0 once the goal is met in the right direction.
export function daysToGoal(trend, weeklyRate, goal) {
  if (goal == null || !isFinite(goal)) return null
  const gap = goal - trend
  if (Math.abs(gap) < 0.05) return 0
  const perDay = weeklyRate / 7
  if (Math.abs(perDay) < 1e-4) return null
  if (Math.sign(gap) !== Math.sign(perDay)) return null
  const days = Math.round(gap / perDay)
  return days > 366 ? null : days
}

function round1(v) { return Math.round(v * 10) / 10 }
