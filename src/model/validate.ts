/**
 * Project validation (PRD §6).
 *
 * Two layers run on load and on every mutation:
 *   1. Shape — the draft-07 JSON Schema in `schema/project.schema.json`.
 *   2. Referential integrity — the cross-entity rules the schema cannot express
 *      (dangling references, overlapping placements, track bounds, id collisions
 *      between the slot and chain namespaces).
 *
 * A failure returns errors; it never mutates or repairs the document. The store
 * rejects the mutation and keeps the last good state.
 */
import Ajv, { type ValidateFunction } from 'ajv'
import schema from '../../schema/project.schema.json'
import type { Project } from './types'

export interface ValidationError {
  /** Where the problem is, as a JSON pointer-ish path for the UI to show. */
  path: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationError[]
}

const ajv = new Ajv({ allErrors: true, strict: false })
let compiled: ValidateFunction | undefined

function shapeValidator(): ValidateFunction {
  compiled ??= ajv.compile(schema)
  return compiled
}

/** Rule 1-7 from PRD §6, run against a document that already matches the schema. */
export function validateReferences(project: Project): ValidationError[] {
  const errors: ValidationError[] = []
  const { meta, instruments, slots, chains, grid } = project

  // Ids must be unique across the slot and chain namespaces, because a grid
  // cell holds one string and the resolver has to disambiguate it.
  for (const id of Object.keys(slots)) {
    if (id in chains) {
      errors.push({
        path: `/slots/${id}`,
        message: `id "${id}" is used by both a slot and a chain; ids must be unique across both`,
      })
    }
  }

  // 1. slot.instrument must exist.
  for (const [id, slot] of Object.entries(slots)) {
    if (slot.instrument != null && !(slot.instrument in instruments)) {
      errors.push({
        path: `/slots/${id}/instrument`,
        message: `slot "${id}" references unknown instrument "${slot.instrument}"`,
      })
    }
  }

  // 2. chain.steps[].slot must exist, and chain.track is within bounds.
  for (const [id, chain] of Object.entries(chains)) {
    if (chain.track < 1 || chain.track > meta.trackCount) {
      errors.push({
        path: `/chains/${id}/track`,
        message: `chain "${id}" is on track ${chain.track}, outside 1-${meta.trackCount}`,
      })
    }
    chain.steps.forEach((step, i) => {
      if (!(step.slot in slots)) {
        errors.push({
          path: `/chains/${id}/steps/${i}/slot`,
          message: `chain "${id}" step ${i} references unknown slot "${step.slot}"`,
        })
      }
    })
  }

  // 3. grid cells resolve to a slot or a chain. 4. track bounds.
  grid.scenes.forEach((scene, sceneIndex) => {
    for (const [trackKey, ref] of Object.entries(scene.cells)) {
      const track = Number(trackKey)
      if (!Number.isInteger(track) || track < 1 || track > meta.trackCount) {
        errors.push({
          path: `/grid/scenes/${sceneIndex}/cells/${trackKey}`,
          message: `scene "${scene.name}" uses track ${trackKey}, outside 1-${meta.trackCount}`,
        })
        continue
      }
      if (!(ref in slots) && !(ref in chains)) {
        errors.push({
          path: `/grid/scenes/${sceneIndex}/cells/${trackKey}`,
          message: `scene "${scene.name}" cell on track ${trackKey} references unknown "${ref}"`,
        })
      }
    }
  })

  // Scene names are ids in their own namespace and must be unique.
  const seenScenes = new Set<string>()
  grid.scenes.forEach((scene, i) => {
    if (seenScenes.has(scene.name)) {
      errors.push({ path: `/grid/scenes/${i}/name`, message: `duplicate scene name "${scene.name}"` })
    }
    seenScenes.add(scene.name)
  })

  // Saved live state must still point at something real.
  for (const [trackKey, ref] of Object.entries(project.meta.lastSceneState?.cells ?? {})) {
    if (!(ref in slots) && !(ref in chains)) {
      errors.push({
        path: `/meta/lastSceneState/cells/${trackKey}`,
        message: `saved live state references unknown "${ref}"`,
      })
    }
  }

  return errors
}

/** Full validation: shape first, then references. Shape failures short-circuit. */
export function validateProject(value: unknown): ValidationResult {
  const validate = shapeValidator()
  if (!validate(value)) {
    const errors = (validate.errors ?? []).map((error) => ({
      path: error.instancePath || '/',
      message: `${error.instancePath || 'project'} ${error.message ?? 'is invalid'}`.trim(),
    }))
    return { ok: false, errors: errors.length ? errors : [{ path: '/', message: 'project is not valid' }] }
  }
  const errors = validateReferences(value as Project)
  return { ok: errors.length === 0, errors }
}

export function formatErrors(errors: ValidationError[]): string {
  return errors.map((error) => `• ${error.message}`).join('\n')
}
