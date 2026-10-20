import { describe, it, expect } from 'vitest'
import { platesFor, roundToLoadable, DEFAULT_PLATES, DEFAULT_BAR } from './plates.js'

describe('platesFor', () => {
  it('solves a clean barbell load per side', () => {
    const r = platesFor(60, { bar: 20, unit: 'kg' })
    expect(r.perSide).toEqual([20])          // 20 + 2×20 = 60
    expect(r.achieved).toBe(60)
    expect(r.leftover).toBe(0)
  })

  it('uses the largest plates first', () => {
    const r = platesFor(100, { bar: 20, unit: 'kg' })   // 40/side = 25 + 15
    expect(r.perSide).toEqual([25, 15])
  })

  it('combines mixed plates', () => {
    const r = platesFor(102.5, { bar: 20, unit: 'kg' })  // 41.25/side = 25+15+1.25
    expect(r.perSide).toEqual([25, 15, 1.25])
    expect(r.achieved).toBe(102.5)
  })

  it('reports what it cannot load exactly', () => {
    const r = platesFor(61, { bar: 20, unit: 'kg' })  // 20.5/side; smallest plate 1.25
    expect(r.achieved).toBeLessThan(61)
    expect(r.leftover).toBeGreaterThan(0)
  })

  it('respects a finite plate inventory (pairs available)', () => {
    // only one pair of 20s
    const r = platesFor(100, { bar: 20, unit: 'kg', inventory: { 20: 2, 10: 4, 5: 4 } })
    expect(r.perSide).toEqual([20, 10, 10])   // 40/side without a second 20-pair
    expect(r.achieved).toBe(100)
  })

  it('returns the bare bar when the target is at or below it', () => {
    expect(platesFor(20, { bar: 20 }).perSide).toEqual([])
    expect(platesFor(15, { bar: 20 }).perSide).toEqual([])
    expect(platesFor(15, { bar: 20 }).achieved).toBe(20)
  })

  it('handles a null/invalid target', () => {
    expect(platesFor(0, { bar: 20 })).toBeNull()
    expect(platesFor(-10, { bar: 20 })).toBeNull()
    expect(platesFor(null, { bar: 20 })).toBeNull()
  })

  it('defaults bar and plates from unit', () => {
    const kg = platesFor(60, { unit: 'kg' })
    expect(kg.bar).toBe(DEFAULT_BAR.kg)
    const lb = platesFor(135, { unit: 'lb' })   // 45 bar + 2×45
    expect(lb.bar).toBe(DEFAULT_BAR.lb)
    expect(lb.perSide).toEqual([45])
  })

  it('exposes sensible default plate sets', () => {
    expect(DEFAULT_PLATES.kg).toContain(20)
    expect(DEFAULT_PLATES.lb).toContain(45)
  })
})

describe('roundToLoadable', () => {
  it('rounds a target to the nearest loadable weight', () => {
    expect(roundToLoadable(61, { bar: 20, unit: 'kg' })).toBe(60)    // 61 → 60
    expect(roundToLoadable(62, { bar: 20, unit: 'kg' })).toBe(62.5)  // 62 → 62.5
  })

  it('never rounds below the bar', () => {
    expect(roundToLoadable(10, { bar: 20, unit: 'kg' })).toBe(20)
  })

  it('passes an already-loadable weight through', () => {
    expect(roundToLoadable(100, { bar: 20, unit: 'kg' })).toBe(100)
  })
})
