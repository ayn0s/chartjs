import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { createUplotScreenCursorPlugin } from './plugins/uplotScreenCursorPlugin'
import './App.css'

const SERIES_CONFIG = [
  {
    id: 'cpu',
    label: 'CPU Load',
    stroke: '#6ee7f9',
    fillTop: 'rgba(110, 231, 249, 0.28)',
    fillBottom: 'rgba(110, 231, 249, 0.02)',
  },
  {
    id: 'latency',
    label: 'Latency',
    stroke: '#fbbf24',
    fillTop: 'rgba(251, 191, 36, 0.16)',
    fillBottom: 'rgba(251, 191, 36, 0.01)',
  },
  {
    id: 'errors',
    label: 'Errors',
    stroke: '#fb7185',
    fillTop: 'rgba(251, 113, 133, 0.14)',
    fillBottom: 'rgba(251, 113, 133, 0.01)',
  },
]

const WINDOW_MS = 5 * 60 * 1000
const SAMPLES_PER_SECOND = 10
const SAMPLE_STEP_MS = 1000 / SAMPLES_PER_SECOND
const UPDATE_INTERVAL_MS = 1000

const generateSeriesValues = (x) => {
  const y1 = 56 + Math.sin(x / 2400) * 15 + Math.random() * 7
  const y2 = 38 + Math.cos(x / 2900) * 11 + Math.random() * 5
  const y3 = 10 + Math.abs(Math.sin(x / 1700)) * 9 + Math.random() * 2.4

  return [
    Math.max(5, Math.min(95, Number(y1.toFixed(2)))),
    Math.max(2, Math.min(70, Number(y2.toFixed(2)))),
    Math.max(0, Math.min(30, Number(y3.toFixed(2)))),
  ]
}

const formatTimestamp = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'N/A'
  }

  return new Date(value).toLocaleTimeString('fr-FR', {
    hour12: false,
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

const formatValue = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'N/A'
  }

  return value.toFixed(2)
}

function App() {
  const plotHostRef = useRef(null)
  const uplotRef = useRef(null)
  const dataRef = useRef([[], [], [], []])
  const panStateRef = useRef({ active: false, startX: 0, min: 0, max: 0 })
  const screenCursorIndexRef = useRef(2)
  const [isPaused, setIsPaused] = useState(false)
  const [showPoints, setShowPoints] = useState(false)
  const [seriesVisibility, setSeriesVisibility] = useState([true, true, true])
  const [cursorValues, setCursorValues] = useState({
    primaryTimestamp: null,
    cursors: [],
  })

  const handleCursorsUpdate = useCallback((payload) => {
    setCursorValues({
      primaryTimestamp: payload?.primaryTimestamp ?? payload?.screenTimestamp ?? null,
      cursors: Array.isArray(payload?.cursors)
        ? payload.cursors
        : Array.isArray(payload?.screenCursors)
          ? payload.screenCursors
          : [],
    })
  }, [])

  const addScreenCursor = () => {
    const nextIndex = screenCursorIndexRef.current
    const u = uplotRef.current
    const palette = ['#e34f24', '#ff7f11', '#b54708', '#8a3ffc', '#3d5a80']
    const color = palette[(nextIndex - 1) % palette.length]

    u?.screenCursorApi?.addCursor({
      id: `screen-${nextIndex}`,
      ratio: 0.5,
      color,
      lineWidth: 2,
    })

    screenCursorIndexRef.current = nextIndex + 1
  }

  const cursorPlugin = useMemo(
    () =>
      createUplotScreenCursorPlugin({
        cursors: [{ id: 'screen-1', ratio: 0.5, color: '#e34f24', lineWidth: 2 }],
        onCursorsUpdate: handleCursorsUpdate,
      }),
    [handleCursorsUpdate],
  )

  useEffect(() => {
    const host = plotHostRef.current
    if (!host) {
      return undefined
    }

    if (dataRef.current[0].length === 0) {
      const now = Date.now()
      const xs = []
      const ys1 = []
      const ys2 = []
      const ys3 = []
      const totalSamples = Math.floor(WINDOW_MS / SAMPLE_STEP_MS)

      for (let i = totalSamples; i >= 0; i -= 1) {
        const x = now - i * SAMPLE_STEP_MS
        const [v1, v2, v3] = generateSeriesValues(x)
        xs.push(x)
        ys1.push(v1)
        ys2.push(v2)
        ys3.push(v3)
      }

      dataRef.current = [xs, ys1, ys2, ys3]
    }

    const u = new uPlot(
      {
        width: host.clientWidth,
        height: 420,
        ms: 1,
        scales: {
          x: { time: false },
          y: { auto: true },
        },
        axes: [
          {
            stroke: 'rgba(173, 186, 217, 0.86)',
            grid: { stroke: 'rgba(173, 186, 217, 0.12)', width: 1 },
            gap: 9,
            values: (_u, values) => values.map((v) => formatTimestamp(v)),
          },
          {
            stroke: 'rgba(173, 186, 217, 0.86)',
            grid: { stroke: 'rgba(173, 186, 217, 0.12)', width: 1 },
            gap: 9,
          },
        ],
        series: [
          {},
          ...SERIES_CONFIG.map((series) => ({
            label: series.label,
            stroke: series.stroke,
            width: 2.1,
            points: {
              show: showPoints,
              size: 3,
              stroke: series.stroke,
              fill: series.stroke,
            },
            fill: (plot) => {
              const top = Number.isFinite(plot?.bbox?.top) ? plot.bbox.top : 0
              const height = Number.isFinite(plot?.bbox?.height) ? plot.bbox.height : 1
              const bottom = top + Math.max(1, height)

              const gradient = plot.ctx.createLinearGradient(0, top, 0, bottom)
              gradient.addColorStop(0, series.fillTop)
              gradient.addColorStop(1, series.fillBottom)
              return gradient
            },
          })),
        ],
        cursor: {
          lock: false,
          drag: {
            x: false,
            y: false,
            setScale: false,
          },
        },
        plugins: [cursorPlugin],
      },
      dataRef.current,
      host,
    )

    uplotRef.current = u

    const onWheel = (event) => {
      event.preventDefault()
      const { min, max } = u.scales.x
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return
      }

      const factor = event.deltaY > 0 ? 1.12 : 0.88
      const mouseX = event.offsetX
      const center = u.posToVal(mouseX, 'x')
      const nextMin = center - (center - min) * factor
      const nextMax = center + (max - center) * factor
      u.setScale('x', { min: nextMin, max: nextMax })
    }

    const onMouseDown = (event) => {
      if (!event.shiftKey) {
        return
      }

      const { min, max } = u.scales.x
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return
      }

      panStateRef.current = {
        active: true,
        startX: event.clientX,
        min,
        max,
      }
    }

    const onMouseMove = (event) => {
      const pan = panStateRef.current
      if (!pan.active) {
        return
      }

      const deltaPx = event.clientX - pan.startX
      const deltaVal = u.posToVal(0, 'x') - u.posToVal(deltaPx, 'x')
      u.setScale('x', {
        min: pan.min + deltaVal,
        max: pan.max + deltaVal,
      })
    }

    const onMouseUp = () => {
      panStateRef.current.active = false
    }

    u.root.addEventListener('wheel', onWheel, { passive: false })
    u.root.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    const onResize = () => {
      u.setSize({ width: host.clientWidth, height: 420 })
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      u.root.removeEventListener('wheel', onWheel)
      u.root.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      u.destroy()
      uplotRef.current = null
    }
  }, [cursorPlugin, showPoints])

  useEffect(() => {
    const u = uplotRef.current
    if (!u) {
      return
    }

    seriesVisibility.forEach((visible, index) => {
      u.setSeries(index + 1, { show: visible })
    })

    u.redraw()
  }, [seriesVisibility])

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPaused) {
        return
      }

      const u = uplotRef.current
      if (!u) {
        return
      }

      const xs = [...dataRef.current[0]]
      const ys1 = [...dataRef.current[1]]
      const ys2 = [...dataRef.current[2]]
      const ys3 = [...dataRef.current[3]]

      const lastX = xs.length > 0 ? xs[xs.length - 1] : Date.now() - UPDATE_INTERVAL_MS
      for (let i = 1; i <= SAMPLES_PER_SECOND; i += 1) {
        const x = lastX + i * SAMPLE_STEP_MS
        const [v1, v2, v3] = generateSeriesValues(x)
        xs.push(x)
        ys1.push(v1)
        ys2.push(v2)
        ys3.push(v3)
      }

      const latestX = xs[xs.length - 1]
      while (xs.length > 0 && xs[0] < latestX - WINDOW_MS) {
        xs.shift()
        ys1.shift()
        ys2.shift()
        ys3.shift()
      }

      dataRef.current = [xs, ys1, ys2, ys3]
      u.setData(dataRef.current)
      u.setScale('x', { min: latestX - WINDOW_MS, max: latestX })
    }, UPDATE_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [isPaused])

  return (
    <main className="page">
      <section className="chart-card">
        <div className="controls">
          <button type="button" className="control-btn" onClick={() => setIsPaused((v) => !v)}>
            {isPaused ? 'Reprendre le defilement' : 'Arreter le defilement'}
          </button>
          <button type="button" className="control-btn secondary" onClick={addScreenCursor}>
            Ajouter un screen curseur
          </button>
          <label className="refresh-control">
            <input
              type="checkbox"
              checked={showPoints}
              onChange={(event) => setShowPoints(event.target.checked)}
            />
            Afficher les points
          </label>
        </div>

        <div className="series-toggles">
          {SERIES_CONFIG.map((series, index) => (
            <label key={series.id} className="series-toggle">
              <input
                type="checkbox"
                checked={seriesVisibility[index]}
                onChange={(event) => {
                  const checked = event.target.checked
                  setSeriesVisibility((prev) => {
                    const next = [...prev]
                    next[index] = checked
                    return next
                  })
                }}
              />
              <span className="legend-dot" style={{ backgroundColor: series.stroke }} />
              <span>{series.label}</span>
            </label>
          ))}
        </div>

        <div className="chart-wrap" ref={plotHostRef} />

        <div className="cursor-panel">
          <p>
            <span className="label">Screen Cursor (drag horizontal)</span>
            <span className="value">{formatTimestamp(cursorValues.primaryTimestamp)}</span>
          </p>
        </div>

        <div className="cursor-list">
          <p className="list-title">Screen curseurs actifs</p>
          {cursorValues.cursors.length === 0 ? (
            <p className="empty">Aucun screen curseur.</p>
          ) : (
            <ul>
              {cursorValues.cursors.map((cursor) => (
                <li key={cursor.id}>
                  <span className="dot" style={{ backgroundColor: cursor.color }} />
                  <span>{cursor.id}</span>
                  <code>{formatTimestamp(cursor.timestamp)}</code>
                  <code>{formatValue(cursor.value)}</code>
                  <button
                    type="button"
                    className="small-btn"
                    onClick={() => uplotRef.current?.screenCursorApi?.removeCursor(cursor.id)}
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="hint">
          Glisser un screen curseur avec la souris ou le doigt. Zoom: molette/pinch. Pan: maintenir <code>Shift</code> + glisser.
        </p>
      </section>
    </main>
  )
}

export default App
