/** Slots of the phones' bottom bar (Material: three to five). */
export const phoneNavSlots = 5

/**
 * The phones' bottom bar on a grid of `slots` equal slots. The centre item
 * (Shells) is raised in the middle slot, with the same number of slots on
 * either side; slots without an item stay empty (`null`), so no item grows
 * and the centre stays centred. When more items exist than fit, the last
 * slot becomes *More* (`more` lists its items, in their order).
 */
export function phoneNavLayout<T> (items: readonly T[], isCentre: (item: T) => boolean, slots = phoneNavSlots) {
  const centre = items.find(item => isCentre(item)) ?? null
  const others = items.filter(item => item !== centre)
  const room = slots - (centre ? 1 : 0)
  const shown = others.length > room ? others.slice(0, room - 1) : others
  const more = others.slice(shown.length)
  if (!centre) {
    return { start: shown, centre, end: [] as Array<T | null>, more }
  }
  const side = Math.floor(room / 2)
  const pad = (list: T[], length: number) => [...list, ...Array.from({ length: length - list.length }, () => null)]
  const start = pad(shown.slice(0, side), side)
  // The right side ends with More when it is needed.
  const end = pad(shown.slice(side), side - (more.length > 0 ? 1 : 0))
  return { start, centre, end, more }
}
