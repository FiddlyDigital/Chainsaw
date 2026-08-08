/**
 * Reading a number out of a text field, given what the document will accept.
 *
 * Separate from the component because it is the part with the edge cases, and
 * they are all reachable by typing: an empty field, a lone minus sign part-way
 * through "-4", a value whose prefix is out of range, and `1e999` — which is
 * not a silly input so much as an unlucky one, because it parses to Infinity,
 * and Infinity satisfies a JSON Schema `maximum` by being larger than every
 * comparison rather than by being in range.
 */
export function parseNumberField(raw: string, min: number, max: number, integer = false): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  if (integer && !Number.isInteger(value)) return null
  if (value < min || value > max) return null
  return value
}
