import type { GridBox, OverviewBreakpoint, OverviewItem, OverviewRow, OverviewSnapshot, OverviewWidgetSize } from '#shared/overview'
import type { Ref } from 'vue'
import { dropInRows, fitRow, groupRows, itemsAt, layoutRows, mergeOverviewLayout, moveInRows, overviewColumns, overviewGap, overviewHeaderHeight, overviewMinColumns, overviewRowHeight, overviewRows, readingOrder, resizeInRows, rowHeight } from '#shared/overview'

/** A widget's place on the grid; the grid library moves and resizes these objects. */
export interface OverviewBox extends GridBox {
  /** Rows when expanded: the height of its row (`h` is the header's rows while the whole row is collapsed). */
  rows: number
  fit: boolean
  collapsed: boolean
}

/** The rows a collapsed widget keeps: its header. */
export const collapsedRows = overviewRows(overviewHeaderHeight - 1)

type ShellOverview = ReturnType<typeof useShellOverview>

/**
 * The arrangement of a shell's Overview (ADR 0032): rows of widgets that
 * fill the grid's width and share one height, one layout per breakpoint of
 * the Overview's width, drags and resizes, the menu actions that arrange
 * without a pointer, views that follow their content height, and the one
 * undo of every change. The row rules themselves are in `shared/overview.ts`.
 */
export function useOverviewGrid (options: {
  overview: ShellOverview
  /** The breakpoint of the Overview's width, whose layout is shown. */
  breakpoint: () => OverviewBreakpoint
  /** The widgets shown, in their default order, with the size they start with at this breakpoint. */
  widgets: () => OverviewWidgetSize[]
  /** The grid component, to make it place its items again and to measure it. */
  container: Readonly<Ref<{ layoutUpdate?: () => void, $el?: unknown } | null>>
}) {
  const { t } = useI18n()
  const { overview } = options

  // Heights the views reported (`studio.ui.setHeight`), in grid rows by widget ID.
  const contentRows = reactive(new Map<string, number>())
  /** The rows a widget's content needs: as reported, else the height it has. */
  function desired (item: OverviewItem): number {
    return contentRows.get(item.i) ?? item.h
  }
  /** A row's height: collapsed widgets do not count while others in the row are open. */
  function heightOf (row: OverviewRow): number {
    const open = row.filter(item => !item.collapsed)
    return rowHeight(open.length > 0 ? open : row, desired)
  }

  // The rows shown and the grid's boxes laid out from them, rebuilt whenever
  // the stored layout, the widgets, the breakpoint or a content height
  // changes. Boxes are kept by ID, so frames are never re-created.
  const rows = ref<OverviewRow[]>([])
  const grid = ref<OverviewBox[]>([])
  const moving = ref(false)

  /** Lays out rows and moves the boxes there; returns the items to store. */
  function apply (next: OverviewRow[]): OverviewItem[] {
    const items = layoutRows(next, heightOf)
    rows.value = groupRows(items)
    const collapsedRow = new Set(rows.value.filter(row => row.every(item => item.collapsed)).flat().map(item => item.i))
    const existing = new Map(grid.value.map(box => [box.i, box]))
    grid.value = items.map(item => Object.assign(existing.get(item.i) ?? { i: item.i }, {
      x: item.x,
      y: item.y,
      w: item.w,
      h: collapsedRow.has(item.i) ? collapsedRows : item.h,
      rows: item.h,
      fit: item.fit,
      collapsed: item.collapsed,
    }) as OverviewBox)
    return items
  }

  watch([options.widgets, () => itemsAt(overview.layout.value, options.breakpoint()), () => [...contentRows], moving], () => {
    // Not while a widget is dragged; its drop saves the grid, which rebuilds it.
    if (!moving.value) {
      apply(mergeOverviewLayout(options.widgets(), itemsAt(overview.layout.value, options.breakpoint())))
      relayout()
    }
  }, { immediate: true })

  /** The grid knows its width and has placed the widgets. */
  const ready = ref(false)
  const gridProps = computed(() => ({
    onLayoutReady: () => (ready.value = true),
    // Emitted when a drag or resize ends (and when the grid compacts).
    onLayoutUpdated: () => endGesture(),
    layout: grid.value,
    colNum: overviewColumns,
    rowHeight: overviewRowHeight,
    margin: [overviewGap, overviewGap],
    useStyleCursor: false,
  }))

  /** The props of a widget's grid item. */
  function itemProps (box: OverviewBox) {
    return {
      i: box.i,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      minW: overviewMinColumns,
      minH: collapsedRows,
      isResizable: !box.collapsed,
      dragAllowFrom: '.overview-handle',
      // The cell the widget is dragged to, before other widgets make room.
      onMove: (_id: string, x: number, y: number) => startGesture('move', box.i, { x, y }),
      onResize: () => startGesture('resize', box.i),
      onDblclick: (event: MouseEvent) => {
        if ((event.target as HTMLElement | null)?.classList.contains('vgl-item__resizer')) {
          fitToContent(box)
        }
      },
    }
  }

  function relayout () {
    nextTick(() => options.container.value?.layoutUpdate?.())
  }

  /** Stores the layout of this breakpoint; stored items of widgets not shown now (hidden, or not loaded) are kept. */
  function save (items: OverviewItem[]) {
    const shown = new Set(items.map(item => item.i))
    const others = itemsAt(overview.layout.value, options.breakpoint()).filter(item => !shown.has(item.i))
    return overview.saveItems(options.breakpoint(), [...items, ...others].slice(0, 100))
  }

  // Every change of the Overview can be undone once.
  const undo = ref<{ text: string, snapshot: OverviewSnapshot } | null>(null)
  const undoOpen = ref(false)
  /** Offers to put back what `before` holds. */
  function offerUndo (text: string, before: OverviewSnapshot) {
    undo.value = { text, snapshot: before }
    undoOpen.value = true
  }
  /** Shows and stores new rows, and offers to undo the change. */
  function commit (text: string, next: OverviewRow[], before = overview.snapshot()) {
    const items = apply(next)
    relayout()
    offerUndo(text, before)
    return save(items)
  }
  function restoreUndo () {
    if (undo.value) {
      void overview.restore(undo.value.snapshot)
    }
    undo.value = null
    undoOpen.value = false
  }

  // The grid column under the pointer while a widget is dragged. The grid
  // reports the widget's left cell, which it keeps inside the grid, so a
  // wide widget could not be dropped on the right of a row.
  let pointerColumn: number | null = null
  function trackPointer (event: PointerEvent) {
    const element = options.container.value?.$el
    if (element instanceof HTMLElement) {
      const bounds = element.getBoundingClientRect()
      pointerColumn = (event.clientX - bounds.left) / bounds.width * overviewColumns
    }
  }

  // A drag or resize in progress: the widget, the rows when it began, and
  // for a drag the cell it is dragged to.
  let gesture: { kind: 'move' | 'resize', id: string, start: OverviewRow[], spans: { top: number, height: number }[], before: OverviewSnapshot, cell: { x: number, y: number } | null } | null = null
  function startGesture (kind: 'move' | 'resize', id: string, cell?: { x: number, y: number }) {
    if (!gesture) {
      // Where the rows are shown when the gesture begins, before the grid makes room.
      const boxes = new Map(grid.value.map(box => [box.i, box]))
      const spans = rows.value.map(row => {
        const shown = row.flatMap(item => boxes.get(item.i) ?? [])
        return { top: Math.min(...shown.map(box => box.y)), height: Math.max(...shown.map(box => box.h)) }
      })
      gesture = { kind, id, start: structuredClone(toRaw(rows.value)), spans, before: overview.snapshot(), cell: null }
      pointerColumn = null
      if (kind === 'move') {
        document.addEventListener('pointermove', trackPointer)
      }
    }
    if (cell) {
      gesture.cell = cell
    }
    moving.value = true
  }

  function endGesture () {
    if (!gesture) {
      return
    }
    const { kind, id, start, spans, before, cell } = gesture
    gesture = null
    document.removeEventListener('pointermove', trackPointer)
    const box = grid.value.find(entry => entry.i === id)
    const from = start.flat().find(item => item.i === id)
    let next: OverviewRow[] | null = null
    if (box && from && kind === 'resize' && (box.w !== from.w || box.h !== from.h)) {
      // The other widgets of the row share what is left; a new height is the whole row's.
      next = resizeInRows(start, id, box.w, box.h === from.h ? undefined : box.h)
    } else if (box && from && kind === 'move' && cell && (cell.x !== from.x || cell.y !== from.y)) {
      next = dropInRows(start, id, pointerColumn ?? cell.x + from.w / 2, cell.y, spans)
    }
    if (next) {
      void commit(kind === 'resize' ? t('overview.resized') : t('overview.moved'), next, before)
    } else {
      // Nothing changed: put back whatever the grid moved out of the way.
      apply(start)
      relayout()
    }
    // After saving: the rebuild this allows reads the saved layout.
    moving.value = false
  }

  function fitToContent (box: OverviewBox) {
    void commit(t('overview.fitted'), fitRow(rows.value, box.i).map(row => row.map(item => item.i === box.i ? { ...item, collapsed: false } : item)))
  }

  // A view that follows its content grows and shrinks with it, and its row
  // with it. The new height is stored only if the user arranged this
  // breakpoint already, as the height to start with next time.
  let fitTimer: ReturnType<typeof setTimeout> | undefined
  function onContentHeight (box: OverviewBox, height: number) {
    const next = overviewRows(height + overviewHeaderHeight)
    if (contentRows.get(box.i) === next) {
      return
    }
    contentRows.set(box.i, next)
    if (box.fit && overview.layout.value.layouts[options.breakpoint()]) {
      clearTimeout(fitTimer)
      fitTimer = setTimeout(() => void save(layoutRows(rows.value, heightOf)), 1000)
    }
  }
  onBeforeUnmount(() => {
    clearTimeout(fitTimer)
    document.removeEventListener('pointermove', trackPointer)
  })

  function toggleCollapsed (box: OverviewBox) {
    const collapse = !box.collapsed
    void commit(collapse ? t('overview.collapsed') : t('overview.expanded'), rows.value.map(row => row.map(item => item.i === box.i ? { ...item, collapsed: collapse } : item)))
  }

  /** A preset width; the other widgets of the row share the rest, or move to a row below. */
  function setWidth (box: OverviewBox, columns: number) {
    void commit(t('overview.resized'), resizeInRows(rows.value, box.i, columns))
  }

  /** Swaps a widget with the one before or after it in reading order (the keyboard way to arrange them). */
  function move (box: OverviewBox, step: -1 | 1) {
    const next = moveInRows(rows.value, box.i, step)
    if (next) {
      void commit(t('overview.moved'), next)
    }
  }

  const order = computed(() => readingOrder(grid.value))

  return {
    grid,
    order,
    moving,
    ready,
    gridProps,
    itemProps,
    undo,
    undoOpen,
    offerUndo,
    restoreUndo,
    fitToContent,
    onContentHeight,
    toggleCollapsed,
    setWidth,
    move,
  }
}
