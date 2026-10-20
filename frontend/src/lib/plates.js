// Plate calculator (issue: smart tracking).
//
// Turns a target barbell weight into "what do I hang on each side" and, because not every
// number is loadable, rounds a prescription to the nearest weight you can actually build. A
// greedy largest-first fill is optimal for real plate sets (each plate divides the gaps left
// by the bigger ones), and it mirrors how anyone loads a bar by hand.
//
// Pure functions. Weights are unit-agnostic numbers; the caller passes the matching bar and
// plate set. All defaults are standard gym equipment, chosen here and overridable.

// Standard plate denominations, heaviest first.
export const DEFAULT_PLATES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5]
}
export const DEFAULT_BAR = { kg: 20, lb: 45 }

const barFor = unit => DEFAULT_BAR[unit === 'lb' ? 'lb' : 'kg']
const platesForUnit = unit => DEFAULT_PLATES[unit === 'lb' ? 'lb' : 'kg']

/**
 * How to load one barbell.
 * @param target total weight wanted (bar + all plates)
 * @param opts { bar, unit, plates, inventory }
 *   plates    — denominations available, heaviest first (defaults by unit)
 *   inventory — { [plate]: countAvailable } total plates owned of each size; a side can use
 *               at most floor(count/2). Omit for an unlimited set.
 * @returns null | { bar, target, perSide:[plate…], achieved, leftover }
 *   perSide   plates for ONE side, heaviest first
 *   achieved  the weight these plates actually make (≤ target)
 *   leftover  target − achieved, what could not be loaded
 */
export function platesFor(target, opts = {}) {
  if (!(target > 0)) return null
  const unit = opts.unit || 'kg'
  const bar = opts.bar > 0 ? opts.bar : barFor(unit)
  const plates = opts.plates || platesForUnit(unit)
  if (target <= bar) return { bar, target, perSide: [], achieved: bar, leftover: 0 }

  let perSideWeight = (target - bar) / 2
  const perSide = []
  // Pairs available of each plate (a plate must go on both sides to stay balanced).
  const pairsLeft = {}
  if (opts.inventory) for (const p of plates) pairsLeft[p] = Math.floor((opts.inventory[p] || 0) / 2)

  const EPS = 1e-9
  for (const p of plates) {
    while (p <= perSideWeight + EPS && (!opts.inventory || pairsLeft[p] > 0)) {
      perSide.push(p)
      perSideWeight -= p
      if (opts.inventory) pairsLeft[p]--
    }
  }
  const achieved = round2(bar + 2 * perSide.reduce((s, p) => s + p, 0))
  return { bar, target, perSide, achieved, leftover: round2(target - achieved) }
}

/**
 * The nearest loadable total weight to `target`, using the same bar and plate set. Ties round
 * up (a slightly heavier working set beats a slightly lighter one). Never below the bar.
 */
export function roundToLoadable(target, opts = {}) {
  const unit = opts.unit || 'kg'
  const bar = opts.bar > 0 ? opts.bar : barFor(unit)
  if (!(target > bar)) return bar
  const plates = opts.plates || platesForUnit(unit)
  const step = 2 * Math.min(...plates)     // smallest change to a balanced bar
  const down = platesFor(target, opts).achieved
  const up = round2(down + step)
  return (target - down <= up - target) ? down : up
}

function round2(v) { return Math.round(v * 100) / 100 }
