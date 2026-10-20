// Energy expenditure from intake and the weight trend (issue: smart tracking).
//
// The honest way to know how much you burn is to measure it, not to guess from height and
// age: over any stretch of days, intake minus the energy your weight changed by is what you
// expended. This is the energy-balance identity, and it adapts to the individual because it
// is built from their own logged food and their own smoothed weight.
//
//   TDEE ≈ mean(daily intake)  −  ENERGY_PER_KG · (Δ trend weight / days)
//
// A falling trend on 2000 kcal means you burn more than 2000; a rising one means less. The
// weight term uses the SMOOTHED trend (passed in from lib/weight-trend.js), never raw scale
// readings, so a single salty day cannot masquerade as a change in expenditure.
//
// Pure functions. ENERGY_PER_KG and the window are documented defaults chosen here — 7700 kcal
// per kg is the textbook energy content of body-mass change — and both are overridable.

export const ENERGY_PER_KG = 7700   // kcal per kg of body-mass change
export const DEFAULT_WINDOW = 21    // days of history the estimate is built from
export const MIN_DAYS = 7           // fewer logged days than this is too little to trust

const tOf = p => p.t || Date.parse(p.d)

/**
 * Adaptive TDEE from an intake log and a smoothed weight trend.
 * @param calories [{ d:'YYYY-MM-DD', kcal }]  — days with no entry, or kcal ≤ 0, are skipped
 * @param trend    [{ d, t?, trend }]          — smoothed weight points (weightTrend().points)
 * @param opts { windowDays, energyPerKg, minDays }
 * @returns null | { kcal, window, daysPresent, meanIntake, weeklyRateKg }
 */
export function expenditure(calories, trend, opts = {}) {
  const windowDays = opts.windowDays > 0 ? opts.windowDays : DEFAULT_WINDOW
  const energyPerKg = opts.energyPerKg > 0 ? opts.energyPerKg : ENERGY_PER_KG
  const minDays = opts.minDays > 0 ? opts.minDays : MIN_DAYS
  if (!calories || !calories.length || !trend || trend.length < 2) return null

  // Window anchored on the most recent intake entry, so a gap before today doesn't shrink it.
  const cals = [...calories].filter(c => c && c.kcal > 0).sort((a, b) => tOf(a) - tOf(b))
  if (cals.length < minDays) return null
  const end = tOf(cals[cals.length - 1])
  const start = end - (windowDays - 1) * 86400000

  const inWin = cals.filter(c => tOf(c) >= start)
  if (inWin.length < minDays) return null
  const meanIntake = inWin.reduce((s, c) => s + c.kcal, 0) / inWin.length

  // Trend weight at the window's start and end. Clamp the lookup to the points we have.
  const tp = [...trend].sort((a, b) => tOf(a) - tOf(b))
  const wEnd = trendAt(tp, end)
  const wStart = trendAt(tp, Math.max(start, tOf(tp[0])))
  const spanDays = Math.max(1, Math.round((end - Math.max(start, tOf(tp[0]))) / 86400000))
  const deltaKg = wEnd - wStart
  const kcal = Math.round(meanIntake - (energyPerKg * deltaKg) / spanDays)

  return {
    kcal,
    window: windowDays,
    daysPresent: inWin.length,
    meanIntake: Math.round(meanIntake),
    weeklyRateKg: Math.round((deltaKg / spanDays) * 7 * 100) / 100
  }
}

// Linear read of the smoothed trend at time `when`, clamped to the series ends.
function trendAt(tp, when) {
  if (when <= tOf(tp[0])) return tp[0].trend
  if (when >= tOf(tp[tp.length - 1])) return tp[tp.length - 1].trend
  for (let i = 1; i < tp.length; i++) {
    const t1 = tOf(tp[i])
    if (t1 >= when) {
      const t0 = tOf(tp[i - 1])
      const f = t1 === t0 ? 0 : (when - t0) / (t1 - t0)
      return tp[i - 1].trend + f * (tp[i].trend - tp[i - 1].trend)
    }
  }
  return tp[tp.length - 1].trend
}

/**
 * Daily calorie target for a desired weekly rate of weight change.
 * @param tdee              estimated expenditure (kcal/day)
 * @param goalRateKgPerWeek negative to lose, positive to gain, 0 to maintain
 * @param energyPerKg       override the energy density
 */
export function calorieTarget(tdee, goalRateKgPerWeek, energyPerKg = ENERGY_PER_KG) {
  if (!(tdee > 0)) return null
  return Math.round(tdee + (energyPerKg * goalRateKgPerWeek) / 7)
}
