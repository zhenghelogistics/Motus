// Small shared formatters. These each existed as two or three copy-pasted
// definitions across pages, and had already drifted apart in ways that showed up
// on screen — see the note on nameFromEmail below.

/**
 * Turn a work email into a display name: john.smith@zhenghe.com.sg -> "John Smith".
 *
 * The copy that lived in App.jsx omitted the .toLowerCase(), so an address written
 * as John.SMITH@ rendered "John SMITH" in the sidebar but "John Smith" on the Job
 * Report PDF for the same person. Lower-casing the remainder matches what the other
 * two copies did and is the behaviour we want everywhere.
 */
export function nameFromEmail(email) {
  if (!email) return ''
  const prefix = email.split('@')[0]
  return prefix
    .split('.')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Parse a plain YYYY-MM-DD string as a LOCAL date.
 *
 * `new Date('2026-08-13')` is parsed as UTC midnight, which in UTC+8 is 8am on the
 * 13th — comparing that against a local-midnight "today" makes a deadline look a day
 * off. Building it from parts keeps both sides in the same frame.
 */
export function parseLocalDate(dateString) {
  if (!dateString) return null
  const [year, month, day] = String(dateString).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}
