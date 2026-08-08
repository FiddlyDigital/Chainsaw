/**
 * Bringing older documents forward.
 *
 * The schema is closed — `additionalProperties: false` — so a field that has
 * been removed is not merely ignored on load, it makes the whole document
 * invalid and the file refuses to open. Anything dropped from the format has to
 * be dropped from the file on the way in, here, before validation sees it.
 */

/** What a migration had to throw away, so the app can say so rather than not. */
export interface Migration {
  /** The document, with anything the current format cannot hold removed. */
  document: unknown
  /** Human-readable notes about what was discarded, empty when nothing was. */
  dropped: string[]
}

interface LegacyArrangement {
  tracks?: Record<string, unknown[]>
}

/**
 * Strip fields the current format no longer has.
 *
 * Chainsaw used to carry a written arrangement — chains placed on a bar
 * timeline — alongside the scene grid. The grid is now the whole of it, so an
 * older project's arrangement cannot be represented and is dropped. Its chains
 * and slots are untouched and still in the project panel, ready to be put in a
 * scene; it is only the placements on the timeline that are gone.
 */
export function migrate(value: unknown): Migration {
  if (typeof value !== 'object' || value === null) return { document: value, dropped: [] }

  const document = { ...(value as Record<string, unknown>) }
  const dropped: string[] = []

  if ('arrangement' in document) {
    const placements = Object.values((document.arrangement as LegacyArrangement)?.tracks ?? {}).reduce(
      (total, list) => total + (Array.isArray(list) ? list.length : 0),
      0,
    )
    delete document.arrangement
    if (placements > 0) {
      dropped.push(`its arrangement (${placements} placement${placements === 1 ? '' : 's'}) — Chainsaw is grid-only now`)
    }
  }

  return { document, dropped }
}
