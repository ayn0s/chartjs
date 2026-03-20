const DEFAULT_HIT_RADIUS = 24
const DEFAULT_COLOR = '#e34f24'
const DEFAULT_LINE_WIDTH = 2

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function normalizeCursor(input, fallbackId) {
  const ratio = Number(input?.ratio)
  if (!Number.isFinite(ratio)) {
    return null
  }

  return {
    id: input?.id ?? fallbackId,
    ratio: clamp(ratio, 0, 1),
    color: input?.color ?? DEFAULT_COLOR,
    lineWidth: input?.lineWidth ?? DEFAULT_LINE_WIDTH,
  }
}

function resolveInitialCursors(options) {
  const initial = Array.isArray(options?.cursors) ? options.cursors : []
  const parsed = []

  initial.forEach((cursor, index) => {
    const normalized = normalizeCursor(cursor, `screen-${index + 1}`)
    if (normalized) {
      parsed.push(normalized)
    }
  })

  if (parsed.length === 0) {
    parsed.push({
      id: 'screen-1',
      ratio: 0.5,
      color: DEFAULT_COLOR,
      lineWidth: DEFAULT_LINE_WIDTH,
    })
  }

  return parsed
}

function resolveSeriesIndices(u, options) {
  const configured =
    typeof options?.seriesIndices === 'function'
      ? options.seriesIndices(u)
      : options?.seriesIndices
  const maxSeries = u.series.length - 1

  if (Array.isArray(configured) && configured.length > 0) {
    return configured.filter(
      (idx) => Number.isInteger(idx) && idx >= 1 && idx <= maxSeries,
    )
  }

  const visible = []
  for (let i = 1; i <= maxSeries; i += 1) {
    if (u.series?.[i]?.show !== false) {
      visible.push(i)
    }
  }

  return visible
}

function interpolateAt(xs, ys, x) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length === 0) {
    return null
  }

  const n = Math.min(xs.length, ys.length)
  if (n === 0) {
    return null
  }

  if (n === 1) {
    const only = Number(ys[0])
    return Number.isFinite(only) ? only : null
  }

  if (x <= xs[0]) {
    const first = Number(ys[0])
    return Number.isFinite(first) ? first : null
  }

  const lastIndex = n - 1
  if (x >= xs[lastIndex]) {
    const last = Number(ys[lastIndex])
    return Number.isFinite(last) ? last : null
  }

  let lo = 0
  let hi = lastIndex
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const x0 = Number(xs[lo])
  const x1 = Number(xs[hi])
  const y0 = Number(ys[lo])
  const y1 = Number(ys[hi])

  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(y0) || !Number.isFinite(y1)) {
    return null
  }

  const span = x1 - x0
  if (span <= 0) {
    return y1
  }

  const t = (x - x0) / span
  return y0 + (y1 - y0) * t
}

function eventToRootX(event, rootRect) {
  if (!event || !rootRect) {
    return null
  }

  if (typeof event.clientX === 'number') {
    return event.clientX - rootRect.left
  }

  const touch = event.touches?.[0] ?? event.changedTouches?.[0]
  if (touch && typeof touch.clientX === 'number') {
    return touch.clientX - rootRect.left
  }

  return null
}

function ratioToTimestamp(u, ratio) {
  const min = Number(u.scales?.x?.min)
  const max = Number(u.scales?.x?.max)

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null
  }

  return min + clamp(ratio, 0, 1) * (max - min)
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

export function createUplotScreenCursorPlugin(options = {}) {
  return {
    hooks: {
      ready: [
        (u) => {
          const state = {
            cursors: resolveInitialCursors(options),
            draggingId: null,
            nextId: 2,
          }

          const hitRadius = Number.isFinite(options.hitRadius)
            ? Math.max(4, options.hitRadius)
            : DEFAULT_HIT_RADIUS

          const root = u.root
          root.style.touchAction = 'none'

          const getPlotX = (event) => eventToRootX(event, root.getBoundingClientRect())

          const getCursorPixels = () => {
            const { left, width } = u.bbox
            return state.cursors.map((cursor) => ({
              id: cursor.id,
              x: left + cursor.ratio * width,
            }))
          }

          const getClosestCursor = (plotX) => {
            const candidates = getCursorPixels().map((cursor) => ({
              ...cursor,
              distance: Math.abs(plotX - cursor.x),
            }))

            candidates.sort((a, b) => a.distance - b.distance)
            return candidates[0] && candidates[0].distance <= hitRadius ? candidates[0] : null
          }

          const redraw = () => u.redraw()

          const moveDraggedCursor = (event) => {
            if (!state.draggingId) {
              return
            }

            const plotX = getPlotX(event)
            if (!Number.isFinite(plotX)) {
              return
            }

            const dragged = state.cursors.find((cursor) => cursor.id === state.draggingId)
            if (!dragged) {
              return
            }

            const { left, width } = u.bbox
            dragged.ratio = clamp((plotX - left) / width, 0, 1)
            root.style.cursor = 'ew-resize'
            redraw()
          }

          const onDown = (event) => {
            if (event.shiftKey) {
              return
            }

            const plotX = getPlotX(event)
            if (!Number.isFinite(plotX)) {
              return
            }

            const target = getClosestCursor(plotX)
            state.draggingId = target?.id ?? null

            if (state.draggingId) {
              root.style.cursor = 'ew-resize'
              event.preventDefault()
            }
          }

          const onMove = (event) => {
            if (state.draggingId) {
              moveDraggedCursor(event)
              return
            }

            const plotX = getPlotX(event)
            if (!Number.isFinite(plotX)) {
              return
            }

            const hovered = getClosestCursor(plotX)
            root.style.cursor = hovered ? 'ew-resize' : 'default'
          }

          const onUp = () => {
            state.draggingId = null
            root.style.cursor = 'default'
          }

          const onWindowPointerMove = (event) => {
            moveDraggedCursor(event)
          }

          const onWindowMouseMove = (event) => {
            moveDraggedCursor(event)
          }

          root.addEventListener('pointerdown', onDown)
          root.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          window.addEventListener('pointercancel', onUp)
          window.addEventListener('pointermove', onWindowPointerMove)

          root.addEventListener('mousedown', onDown)
          root.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
          window.addEventListener('mousemove', onWindowMouseMove)

          u.screenCursorApi = {
            addCursor: (cursor = {}) => {
              const id = cursor.id ?? `screen-${state.nextId++}`
              const parsed = normalizeCursor(
                {
                  id,
                  ratio: cursor.ratio ?? 0.5,
                  color: cursor.color,
                  lineWidth: cursor.lineWidth,
                },
                id,
              )

              if (!parsed) {
                return null
              }

              state.cursors.push(parsed)
              redraw()
              return parsed
            },

            removeCursor: (id) => {
              const before = state.cursors.length
              state.cursors = state.cursors.filter((cursor) => cursor.id !== id)
              const changed = state.cursors.length !== before
              if (changed) {
                redraw()
              }
              return changed
            },

            getCursors: () => state.cursors.map((cursor) => ({ ...cursor })),
          }

          u.screenCursorCleanup = () => {
            root.removeEventListener('pointerdown', onDown)
            root.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
            window.removeEventListener('pointermove', onWindowPointerMove)

            root.removeEventListener('mousedown', onDown)
            root.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            window.removeEventListener('mousemove', onWindowMouseMove)

            delete u.screenCursorApi
            delete u.screenCursorCleanup
          }

          u.screenCursorState = state
        },
      ],

      draw: [
        (u) => {
          const state = u.screenCursorState
          if (!state) {
            return
          }

          const { left, top, width, height } = u.bbox
          const xs = u.data?.[0] ?? []
          const seriesIndices = resolveSeriesIndices(u, options)

          const payloadCursors = state.cursors.map((cursor) => {
            const timestamp = ratioToTimestamp(u, cursor.ratio)
            const datasets = seriesIndices.map((seriesIndex) => ({
              seriesIndex,
              label: u.series?.[seriesIndex]?.label ?? `series-${seriesIndex}`,
              value: timestamp === null ? null : interpolateAt(xs, u.data?.[seriesIndex] ?? [], timestamp),
            }))

            return {
              id: cursor.id,
              ratio: cursor.ratio,
              timestamp,
              value: datasets[0]?.value ?? null,
              color: cursor.color,
              lineWidth: cursor.lineWidth,
              datasets,
            }
          })

          const ctx = u.ctx
          ctx.save()
          payloadCursors.forEach((cursor) => {
            const xPx = left + cursor.ratio * width
            ctx.beginPath()
            ctx.strokeStyle = cursor.color
            ctx.lineWidth = cursor.lineWidth
            ctx.setLineDash([6, 4])
            ctx.moveTo(xPx, top)
            ctx.lineTo(xPx, top + height)
            ctx.stroke()

            const label = String(cursor.id)
            ctx.font = '600 11px Space Grotesk, Segoe UI, sans-serif'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'

            const textPaddingX = 9
            const boxHeight = 20
            const textWidth = ctx.measureText(label).width
            const boxWidth = Math.max(40, textWidth + textPaddingX * 2)
            const boxX = clamp(xPx - boxWidth / 2, left, left + width - boxWidth)
            const boxY = top + 6

            drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 7)
            ctx.fillStyle = cursor.color
            ctx.fill()

            ctx.fillStyle = 'rgba(255, 255, 255, 0.98)'
            ctx.fillText(label, boxX + boxWidth / 2, boxY + boxHeight / 2 + 0.2)
          })
          ctx.restore()

          const payload = {
            primaryTimestamp: payloadCursors[0]?.timestamp ?? null,
            cursors: payloadCursors,
          }

          if (typeof options.onCursorsUpdate === 'function') {
            options.onCursorsUpdate(payload)
          }

          if (typeof options.onValuesUpdate === 'function') {
            options.onValuesUpdate({
              primaryTimestamp: payload.primaryTimestamp,
              screenTimestamp: payload.primaryTimestamp,
              cursors: payload.cursors,
              screenCursors: payload.cursors,
            })
          }
        },
      ],

      destroy: [
        (u) => {
          if (typeof u.screenCursorCleanup === 'function') {
            u.screenCursorCleanup()
          }
          delete u.screenCursorState
        },
      ],
    },
  }
}
