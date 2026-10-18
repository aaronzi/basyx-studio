// A short label for a submodel's semantic ID: which submodel template it
// follows and in which version, e.g. `Nameplate 3.0`. Shown next to the
// submodel in the tree, where the idShort already names the submodel.

/** IRDIs of submodel templates (ECLASS / IEC CDD) that carry no version of the template itself. */
const knownIrdis: Record<string, string> = {
  // IDTA 02003 Technical Data
  AHX837: 'TechnicalData',
  // IDTA 02004 Handover Documentation (VDI 2770)
  AHF578: 'HandoverDocumentation',
}

/** Path segments that name no template, e.g. `…/TechnicalData/Submodel/2/0`. */
const generic = new Set(['submodel', 'submodeltemplate', 'aas'])

const irdi = /^\d{4}-\d#\d{2}-([A-Z]{3}\d{3})#\d{3}$/

function capitalized (name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function normalized (text: string): string {
  return text.toLowerCase().replaceAll(/[\s_-]/g, '')
}

/**
 * The template and version of a semantic ID, or `null` when it says nothing
 * the idShort does not:
 * - an IRI with `…/<major>/<minor>` (IDTA, ZVEI): the segment after the
 *   version (the submodel's name in the template) or, where that is missing
 *   or generic, the one before it, and the version: `ContactInformations 1.0`;
 * - an IRDI of a known template: its name, without a version, because the
 *   IRDI's own version (`#003`) is not the template's;
 * - anything else: nothing, since a last segment such as `002` is no help.
 * A name without a version that only repeats `idShort` is left out too.
 */
export function semanticLabel (semanticId: string, idShort?: string | null): string | null {
  const id = semanticId.trim()
  let label: string | null = null
  let versioned = false

  const code = irdi.exec(id)?.[1]
  if (code) {
    label = knownIrdis[code] ?? null
  } else {
    const segments = id.split(/[/#]/).filter(Boolean)
    const at = segments.findIndex((segment, index) => /^\d+$/.test(segment) && /^\d+$/.test(segments[index + 1] ?? ''))
    if (at > 0) {
      const named = (segment: string | undefined) => segment !== undefined && /\D/.test(segment) && !generic.has(segment.toLowerCase())
      const after = segments.slice(at + 2).find(segment => named(segment))
      const before = segments.slice(0, at).findLast(segment => named(segment))
      const name = after ?? before
      if (name) {
        label = `${capitalized(name)} ${segments[at]}.${segments[at + 1]}`
        versioned = true
      }
    }
  }

  if (!label || (!versioned && idShort && normalized(label) === normalized(idShort))) {
    return null
  }
  return label
}
