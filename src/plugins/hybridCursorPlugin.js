const DRAG_HIT_RADIUS = 16
const DEFAULT_SCREEN_COLOR = '#e34f24'
const DEFAULT_LINE_WIDTH = 2

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function makeScreenCursor(cursor, fallbackId) {
  const ratio = Number(cursor?.ratio)
  if (!Number.isFinite(ratio)) {
    return null
  }

  return {
    id: cursor?.id ?? fallbackId,
    ratio: clamp(ratio, 0, 1),
    color: cursor?.color ?? DEFAULT_SCREEN_COLOR,
    lineWidth: cursor?.lineWidth ?? DEFAULT_LINE_WIDTH,
  }
}

function getInitialScreenCursors(pluginOptions) {
  const { screenCursor, screenCursors } = pluginOptions ?? {}
  const list = []

  if (Array.isArray(screenCursors)) {
    screenCursors.forEach((cursor, index) => {
      const parsed = makeScreenCursor(cursor, `screen-${index + 1}`)
      if (parsed) {
        list.push(parsed)
      }
    })
  }

  if (list.length === 0) {
    const parsed = makeScreenCursor(screenCursor, 'screen-1')
    if (parsed) {
      list.push(parsed)
    }
  }

  if (list.length === 0) {
    list.push({
      id: 'screen-1',
      ratio: 0.5,
      color: DEFAULT_SCREEN_COLOR,
      lineWidth: DEFAULT_LINE_WIDTH,
    })
  }

  return list
}

function extractDataPointsFromDataset(dataset) {
  const raw = dataset?.data ?? []

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

function resolveDatasetIndices(chart, pluginOptions) {
  const configured = pluginOptions?.datasetIndices
  const datasetCount = chart.data?.datasets?.length ?? 0

  if (Array.isArray(configured) && configured.length > 0) {
    return configured.filter(
      (index) => Number.isInteger(index) && index >= 0 && index < datasetCount,
    )
  }

  return Array.from({ length: datasetCount }, (_, index) => index)
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

function drawCursorLine(ctx, x, top, bottom, color, lineWidth) {
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.setLineDash([6, 4])
  ctx.moveTo(x, top)
  ctx.lineTo(x, bottom)
  ctx.stroke()
}

function updateCanvasCursor(canvas, active) {
  if (!canvas) {
    return
  }

  canvas.style.cursor = active ? 'ew-resize' : 'default'
}

function pickClosestCursor(pointerX, cursorPixels) {
  const candidates = cursorPixels
    .filter((cursor) => Number.isFinite(cursor.x))
    .map((cursor) => ({
      ...cursor,
      distance: Math.abs(pointerX - cursor.x),
    }))

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((a, b) => a.distance - b.distance)
  return candidates[0].distance <= DRAG_HIT_RADIUS ? candidates[0] : null
}

export const hybridCursorPlugin = {
  id: 'hybridCursorPlugin',

  afterInit(chart, _args, pluginOptions) {
    const screenCursors = getInitialScreenCursors(pluginOptions)

    chart.$hybridCursorState = {
      draggingCursorId: null,
      screenCursors,
      nextScreenCursorId: screenCursors.length + 1,
    }

    chart.$hybridCursorApi = {
      addScreenCursor: (cursor = {}) => {
        const state = chart.$hybridCursorState
        if (!state) {
          return null
        }

        const id = cursor.id ?? `screen-${state.nextScreenCursorId++}`
        const parsed = makeScreenCursor(
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

        state.screenCursors.push(parsed)
        chart.draw()
        return parsed
      },

      removeScreenCursor: (id) => {
        const state = chart.$hybridCursorState
        if (!state || !id) {
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
    }
  },

  afterDestroy(chart) {
    delete chart.$hybridCursorState
    delete chart.$hybridCursorApi
  },

  afterDraw(chart, _args, pluginOptions) {
    const xScale = chart.scales.x
    const area = chart.chartArea
    const state = chart.$hybridCursorState

    if (!xScale || !area || !state) {
      return
    }

    const datasets = chart.data?.datasets ?? []
    const datasetIndices = resolveDatasetIndices(chart, pluginOptions)
    const datasetPointCache = new Map(
      datasetIndices.map((datasetIndex) => [
        datasetIndex,
        extractDataPointsFromDataset(datasets[datasetIndex]),
      ]),
    )

    const screenCursorValues = state.screenCursors.map((cursor) => {
      const x = area.left + (area.right - area.left) * clamp(cursor.ratio, 0, 1)
      const timestampRaw = xScale.getValueForPixel(x)
      const timestamp = Number.isFinite(timestampRaw) ? timestampRaw : null
      const datasetsAtCursor = datasetIndices.map((datasetIndex) => {
        const points = datasetPointCache.get(datasetIndex) ?? []

        return {
          datasetIndex,
          label: datasets[datasetIndex]?.label ?? `dataset-${datasetIndex}`,
          value:
            timestamp === null ? null : interpolateYAtTimestamp(points, timestamp),
        }
      })

      return {
        id: cursor.id,
        ratio: cursor.ratio,
        color: cursor.color,
        lineWidth: cursor.lineWidth,
        x,
        timestamp,
        value: datasetsAtCursor[0]?.value ?? null,
        datasets: datasetsAtCursor,
      }
    })

    const { ctx } = chart
    ctx.save()
    screenCursorValues.forEach((cursor) => {
      if (!Number.isFinite(cursor.x)) {
        return
      }
      drawCursorLine(ctx, cursor.x, area.top, area.bottom, cursor.color, cursor.lineWidth)
    })
    ctx.restore()

    const payload = {
      primaryTimestamp: screenCursorValues[0]?.timestamp ?? null,
        screenTimestamp: screenCursorValues[0]?.timestamp ?? null,
      cursors: screenCursorValues.map((cursor) => ({
        id: cursor.id,
        ratio: cursor.ratio,
        timestamp: cursor.timestamp,
        value: cursor.value,
        color: cursor.color,
        datasets: cursor.datasets,
      })),
        screenCursors: screenCursorValues.map((cursor) => ({
          id: cursor.id,
          ratio: cursor.ratio,
          timestamp: cursor.timestamp,
          value: cursor.value,
          color: cursor.color,
          datasets: cursor.datasets,
        })),
    }

    if (typeof pluginOptions?.onCursorsUpdate === 'function') {
      pluginOptions.onCursorsUpdate(payload)
    }

    if (typeof pluginOptions?.onValuesUpdate === 'function') {
      pluginOptions.onValuesUpdate(payload)
    }
  },

  afterEvent(chart, args) {
    const event = args.event
    const area = chart.chartArea
    const state = chart.$hybridCursorState

    if (!event || !area || !state) {
      return
    }

    const cursorPixels = state.screenCursors.map((cursor) => ({
      id: cursor.id,
      x: area.left + (area.right - area.left) * clamp(cursor.ratio, 0, 1),
    }))

    if (
      event.type === 'mousedown' ||
      event.type === 'touchstart' ||
      event.type === 'pointerdown'
    ) {
      const target = pickClosestCursor(event.x, cursorPixels)
      state.draggingCursorId = target?.id ?? null
      updateCanvasCursor(chart.canvas, Boolean(target))
      return
    }

    if (
      event.type === 'mouseup' ||
      event.type === 'touchend' ||
      event.type === 'pointerup' ||
      event.type === 'pointercancel' ||
      event.type === 'mouseout'
    ) {
      state.draggingCursorId = null
      updateCanvasCursor(chart.canvas, false)
      return
    }

    if (
      event.type === 'mousemove' ||
      event.type === 'touchmove' ||
      event.type === 'pointermove'
    ) {
      if (state.draggingCursorId) {
        const targetCursor = state.screenCursors.find(
          (cursor) => cursor.id === state.draggingCursorId,
        )

        if (targetCursor) {
          targetCursor.ratio = clamp((event.x - area.left) / (area.right - area.left), 0, 1)
          args.changed = true
          chart.draw()
          updateCanvasCursor(chart.canvas, true)
        }
        return
      }

      const hovered = pickClosestCursor(event.x, cursorPixels)
      updateCanvasCursor(chart.canvas, Boolean(hovered))
    }
  },
}
