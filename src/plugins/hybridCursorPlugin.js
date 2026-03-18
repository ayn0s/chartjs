const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const DRAG_HIT_RADIUS = 16
const DEFAULT_SCREEN_CURSOR_COLOR = '#e34f24'
const DEFAULT_TIME_CURSOR_COLOR = '#117a65'

const createScreenCursor = (cursor, fallbackId) => {
  if (!cursor || typeof cursor.ratio !== 'number' || Number.isNaN(cursor.ratio)) {
    return null
  }

  return {
    id: cursor.id ?? fallbackId,
    ratio: clamp(cursor.ratio, 0, 1),
    color: cursor.color ?? DEFAULT_SCREEN_CURSOR_COLOR,
    lineWidth: cursor.lineWidth ?? 2,
  }
}

const createTimeCursor = (cursor, fallbackId) => {
  if (!cursor || typeof cursor.timestamp !== 'number' || Number.isNaN(cursor.timestamp)) {
    return null
  }

  return {
    id: cursor.id ?? fallbackId,
    timestamp: cursor.timestamp,
    color: cursor.color ?? DEFAULT_TIME_CURSOR_COLOR,
    lineWidth: cursor.lineWidth ?? 2,
  }
}

const getInitialScreenCursors = (pluginOptions) => {
  const { screenCursor = {}, screenCursors = [] } = pluginOptions ?? {}
  const cursors = []

  if (Array.isArray(screenCursors)) {
    screenCursors.forEach((cursor, index) => {
      const parsed = createScreenCursor(cursor, `screen-${index + 1}`)
      if (parsed) {
        cursors.push(parsed)
      }
    })
  }

  if (cursors.length === 0) {
    const single = createScreenCursor(screenCursor, 'screen-1')
    if (single) {
      cursors.push(single)
    }
  }

  if (cursors.length === 0) {
    cursors.push({
      id: 'screen-1',
      ratio: 0.5,
      color: DEFAULT_SCREEN_CURSOR_COLOR,
      lineWidth: 2,
    })
  }

  return cursors
}

const getInitialTimeCursors = (pluginOptions) => {
  const { timeCursor = {}, timeCursors = [] } = pluginOptions ?? {}
  const cursors = []

  if (Array.isArray(timeCursors)) {
    timeCursors.forEach((cursor, index) => {
      const parsed = createTimeCursor(cursor, `time-${index + 1}`)
      if (parsed) {
        cursors.push(parsed)
      }
    })
  }

  if (cursors.length === 0) {
    const single = createTimeCursor(timeCursor, 'time-1')
    if (single) {
      cursors.push(single)
    }
  }

  return cursors
}

export const hybridCursorPlugin = {
  id: 'hybridCursorPlugin',

  afterInit(chart, _args, pluginOptions) {
    const screenCursors = getInitialScreenCursors(pluginOptions)
    const timeCursors = getInitialTimeCursors(pluginOptions)

    chart.$hybridCursorState = {
      dragging: null,
      screenCursors,
      timeCursors,
      nextScreenCursorId: screenCursors.length + 1,
      nextTimeCursorId: timeCursors.length + 1,
    }

    chart.$hybridCursorApi = {
      addScreenCursor: (cursor) => {
        const state = chart.$hybridCursorState
        if (!state) {
          return null
        }

        const id = cursor?.id ?? `screen-${state.nextScreenCursorId++}`
        const parsed = createScreenCursor(
          {
            ratio: cursor?.ratio ?? 0.5,
            color: cursor?.color,
            lineWidth: cursor?.lineWidth,
            id,
          },
          id,
        )

        if (!parsed) {
          return null
        }

        state.screenCursors.push(parsed)
        chart.draw()
        return parsed
      },

      removeScreenCursor: (id) => {
        const state = chart.$hybridCursorState
        if (!state) {
          return false
        }

        const previousLength = state.screenCursors.length
        state.screenCursors = state.screenCursors.filter((cursor) => cursor.id !== id)

        if (state.screenCursors.length !== previousLength) {
          chart.draw()
          return true
        }

        return false
      },

      addTimeCursor: (cursor) => {
        const state = chart.$hybridCursorState
        if (!state) {
          return null
        }

        const id = cursor?.id ?? `time-${state.nextTimeCursorId++}`
        const parsed = createTimeCursor(
          {
            timestamp: cursor?.timestamp,
            color: cursor?.color,
            lineWidth: cursor?.lineWidth,
            id,
          },
          id,
        )

        if (!parsed) {
          return null
        }

        state.timeCursors.push(parsed)
        chart.draw()
        return parsed
      },

      removeTimeCursor: (id) => {
        const state = chart.$hybridCursorState
        if (!state) {
          return false
        }

        const previousLength = state.timeCursors.length
        state.timeCursors = state.timeCursors.filter((cursor) => cursor.id !== id)

        if (state.timeCursors.length !== previousLength) {
          chart.draw()
          return true
        }

        return false
      },
    }
  },

  afterDestroy(chart) {
    delete chart.$hybridCursorState
    delete chart.$hybridCursorApi
  },

  afterDraw(chart, _args, pluginOptions) {
    const xScale = chart.scales.x
    const yScale = chart.scales.y
    const area = chart.chartArea

    if (!xScale || !yScale || !area) {
      return
    }

    const state = chart.$hybridCursorState
    const { onValuesUpdate } = pluginOptions ?? {}
    if (!state) {
      return
    }

    const points = extractDataPoints(chart)

    const screenCursorValues = state.screenCursors.map((cursor) => {
      const x = area.left + (area.right - area.left) * clamp(cursor.ratio, 0, 1)
      const timestamp = xScale.getValueForPixel(x)
      return {
        ...cursor,
        x,
        timestamp: Number.isFinite(timestamp) ? timestamp : null,
        value: Number.isFinite(timestamp) ? interpolateYAtTimestamp(points, timestamp) : null,
      }
    })

    const timeCursorValues = state.timeCursors.map((cursor) => ({
      ...cursor,
      x: xScale.getPixelForValue(cursor.timestamp),
      value: interpolateYAtTimestamp(points, cursor.timestamp),
    }))

    const { ctx } = chart
    ctx.save()

    screenCursorValues.forEach((cursor) => {
      if (!Number.isFinite(cursor.x)) {
        return
      }

      drawCursorLine(ctx, cursor.x, area.top, area.bottom, cursor.color, cursor.lineWidth)
    })

    timeCursorValues.forEach((cursor) => {
      if (!Number.isFinite(cursor.x)) {
        return
      }

      drawCursorLine(ctx, cursor.x, area.top, area.bottom, cursor.color, cursor.lineWidth)
    })

    ctx.restore()

    if (typeof onValuesUpdate === 'function') {
      onValuesUpdate({
        screenTimestamp: screenCursorValues[0]?.timestamp ?? null,
        timeTimestamp: timeCursorValues[0]?.timestamp ?? null,
        screenCursors: screenCursorValues.map((cursor) => ({
          id: cursor.id,
          ratio: cursor.ratio,
          timestamp: cursor.timestamp,
          value: cursor.value,
          color: cursor.color,
        })),
        timeCursors: timeCursorValues.map((cursor) => ({
          id: cursor.id,
          timestamp: cursor.timestamp,
          value: cursor.value,
          color: cursor.color,
        })),
      })
    }
  },

  afterEvent(chart, args) {
    const event = args.event
    const xScale = chart.scales.x
    const area = chart.chartArea
    const state = chart.$hybridCursorState

    if (!event || !xScale || !area || !state) {
      return
    }

    const cursorPixels = [
      ...state.screenCursors.map((cursor) => ({
        type: 'screen',
        id: cursor.id,
        x: area.left + (area.right - area.left) * clamp(cursor.ratio, 0, 1),
      })),
      ...state.timeCursors.map((cursor) => ({
        type: 'time',
        id: cursor.id,
        x: xScale.getPixelForValue(cursor.timestamp),
      })),
    ]

    if (
      event.type === 'mousedown' ||
      event.type === 'touchstart' ||
      event.type === 'pointerdown'
    ) {
      const target = pickClosestCursor(event.x, cursorPixels)
      state.dragging = target
      updateCanvasCursor(chart.canvas, target ? target.type : null)
      return
    }

    if (
      event.type === 'mouseup' ||
      event.type === 'touchend' ||
      event.type === 'pointerup' ||
      event.type === 'pointercancel' ||
      event.type === 'mouseout'
    ) {
      state.dragging = null
      updateCanvasCursor(chart.canvas, null)
      return
    }

    if (
      event.type === 'mousemove' ||
      event.type === 'touchmove' ||
      event.type === 'pointermove'
    ) {
      if (state.dragging?.type === 'screen') {
        const targetCursor = state.screenCursors.find((cursor) => cursor.id === state.dragging.id)
        if (targetCursor) {
          targetCursor.ratio = clamp((event.x - area.left) / (area.right - area.left), 0, 1)
          args.changed = true
          chart.draw()
          updateCanvasCursor(chart.canvas, 'screen')
        }
        return
      }

      if (state.dragging?.type === 'time') {
        const targetCursor = state.timeCursors.find((cursor) => cursor.id === state.dragging.id)
        if (targetCursor) {
          const nextTimestamp = xScale.getValueForPixel(clamp(event.x, area.left, area.right))
          if (Number.isFinite(nextTimestamp)) {
            targetCursor.timestamp = nextTimestamp
            args.changed = true
            chart.draw()
            updateCanvasCursor(chart.canvas, 'time')
          }
        }
        return
      }

      const hovered = pickClosestCursor(event.x, cursorPixels)
      updateCanvasCursor(chart.canvas, hovered ? hovered.type : null)
    }
  },
}

function pickClosestCursor(pointerX, cursorPixels) {
  const validCursors = cursorPixels
    .filter((cursor) => Number.isFinite(cursor.x))
    .map((cursor) => ({
      ...cursor,
      distance: Math.abs(pointerX - cursor.x),
    }))

  if (validCursors.length === 0) {
    return null
  }

  validCursors.sort((a, b) => a.distance - b.distance)
  return validCursors[0].distance <= DRAG_HIT_RADIUS ? validCursors[0] : null
}

function extractDataPoints(chart) {
  const raw = chart.data?.datasets?.[0]?.data ?? []

  const points = raw
    .map((point) => {
      if (typeof point === 'number') {
        return null
      }

      const x = Number(point?.x)
      const y = Number(point?.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null
      }

      return { x, y }
    })
    .filter(Boolean)

  points.sort((a, b) => a.x - b.x)
  return points
}

function interpolateYAtTimestamp(points, timestamp) {
  if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(timestamp)) {
    return null
  }

  if (points.length === 1) {
    return points[0].y
  }

  if (timestamp <= points[0].x) {
    return points[0].y
  }

  const lastIndex = points.length - 1
  if (timestamp >= points[lastIndex].x) {
    return points[lastIndex].y
  }

  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1]
    const right = points[i]

    if (timestamp <= right.x) {
      const range = right.x - left.x
      if (range <= 0) {
        return right.y
      }

      const ratio = (timestamp - left.x) / range
      return left.y + (right.y - left.y) * ratio
    }
  }

  return points[lastIndex].y
}

function updateCanvasCursor(canvas, activeCursor) {
  if (!canvas) {
    return
  }

  canvas.style.cursor = activeCursor ? 'ew-resize' : 'default'
}

function drawCursorLine(ctx, x, top, bottom, color, lineWidth) {
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.setLineDash([6, 4])
  ctx.moveTo(x, top)
  ctx.lineTo(x, bottom)
  ctx.stroke()
}
