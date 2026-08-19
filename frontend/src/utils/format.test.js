import { describe, it, expect } from 'vitest'
import { nameFromEmail, parseLocalDate } from './format'

describe('nameFromEmail', () => {
  it('turns a dotted work address into a display name', () => {
    expect(nameFromEmail('john.smith@zhenghe.com.sg')).toBe('John Smith')
  })

  it('normalises shouty addresses the same way everywhere', () => {
    // The regression this replaces: App.jsx rendered "John SMITH" in the sidebar
    // while JobDetail rendered "John Smith" on the Job Report PDF, for one person.
    expect(nameFromEmail('John.SMITH@zhenghe.com.sg')).toBe('John Smith')
    expect(nameFromEmail('BRANDON.RODRIGUES@zhenghe.com.sg')).toBe('Brandon Rodrigues')
  })

  it('handles a single-word address', () => {
    expect(nameFromEmail('info@zhenghe.com.sg')).toBe('Info')
  })

  it('returns an empty string for nothing', () => {
    expect(nameFromEmail('')).toBe('')
    expect(nameFromEmail(null)).toBe('')
    expect(nameFromEmail(undefined)).toBe('')
  })
})

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD in the local frame, not UTC', () => {
    const d = parseLocalDate('2026-08-13')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7) // zero-indexed August
    expect(d.getDate()).toBe(13)
    expect(d.getHours()).toBe(0)
  })

  it('lines up with a local-midnight today for day-difference maths', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(parseLocalDate(iso).getTime()).toBe(today.getTime())
  })

  it('returns null for missing or malformed input rather than an Invalid Date', () => {
    expect(parseLocalDate('')).toBe(null)
    expect(parseLocalDate(null)).toBe(null)
    expect(parseLocalDate('not-a-date')).toBe(null)
  })
})
