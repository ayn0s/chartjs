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

const formatDuration = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) {
    return 'N/A'
  }

  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(2)} s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${minutes}m ${seconds.toFixed(2)}s`
}

function interpolateAt(xs, ys, x) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length === 0) {
    return null
  }

  const n = Math.min(xs.length, ys.length)
  if (n === 0 || !Number.isFinite(x)) {
    return null
  }

  if (x <= xs[0]) {
    const y0 = Number(ys[0])
    return Number.isFinite(y0) ? y0 : null
  }

  const last = n - 1
  if (x >= xs[last]) {
    const yl = Number(ys[last])
    return Number.isFinite(yl) ? yl : null
  }

  let lo = 0
  let hi = last
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

function percentile(values, q) {
  if (!Array.isArray(values) || values.length === 0) {
    return null
  }

  const pos = (values.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base

  if (base + 1 < values.length) {
    return values[base] + rest * (values[base + 1] - values[base])
  }

  return values[base]
}

function computeDatasetStats(xs, ys, startTs, endTs) {
  const tMin = Math.min(startTs, endTs)
  const tMax = Math.max(startTs, endTs)
  const n = Math.min(xs.length, ys.length)

  if (n === 0 || !Number.isFinite(tMin) || !Number.isFinite(tMax)) {
    return null
  }

  const startValue = interpolateAt(xs, ys, tMin)
  const endValue = interpolateAt(xs, ys, tMax)

  const values = []
  if (Number.isFinite(startValue)) {
    values.push(startValue)
  }

  for (let i = 0; i < n; i += 1) {
    const x = Number(xs[i])
    const y = Number(ys[i])
    if (x > tMin && x < tMax && Number.isFinite(y)) {
      values.push(y)
    }
  }

  if (Number.isFinite(endValue)) {
    values.push(endValue)
  }

  if (values.length === 0) {
    return null
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((acc, value) => acc + value, 0)
  const mean = sum / values.length
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length
  const stdDev = Math.sqrt(variance)

  return {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    stdDev,
    startValue,
    endValue,
    delta: Number.isFinite(startValue) && Number.isFinite(endValue) ? endValue - startValue : null,
  }
}

function App() {
  const plotHostRef = useRef(null)
  const uplotRef = useRef(null)
  const dataRef = useRef([[], [], [], []])
  const panStateRef = useRef({ active: false, startX: 0, min: 0, max: 0 })
  const [isPaused, setIsPaused] = useState(false)
  const [showPoints, setShowPoints] = useState(false)
  const [seriesVisibility, setSeriesVisibility] = useState([true, true, true])
  const [dataSnapshot, setDataSnapshot] = useState([[], [], [], []])
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

  const rangeStats = useMemo(() => {
    const xs = dataSnapshot[0] ?? []
    const sortedCursors = [...(cursorValues.cursors ?? [])]
      .filter((cursor) => Number.isFinite(cursor.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp)

    if (sortedCursors.length < 2) {
      return null
    }

    const left = sortedCursors[0]
    const right = sortedCursors[1]

    const datasets = SERIES_CONFIG.map((series, index) => {
      const ys = dataSnapshot[index + 1] ?? []
      const stats = computeDatasetStats(xs, ys, left.timestamp, right.timestamp)
      return {
        ...series,
        visible: seriesVisibility[index],
        stats,
      }
    })

    return {
      left,
      right,
      durationMs: right.timestamp - left.timestamp,
      datasets,
    }
  }, [cursorValues.cursors, dataSnapshot, seriesVisibility])

  const cursorPlugin = useMemo(
    () =>
      createUplotScreenCursorPlugin({
        cursors: [
          { id: 'A', ratio: 0.35, color: '#f97316', lineWidth: 2 },
          { id: 'B', ratio: 0.65, color: '#22c55e', lineWidth: 2 },
        ],
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
      setDataSnapshot(dataRef.current)
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
      setDataSnapshot(dataRef.current)
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
            <span className="label">Curseur A</span>
            <span className="value">{formatTimestamp(rangeStats?.left?.timestamp)}</span>
          </p>
          <p>
            <span className="label">Curseur B</span>
            <span className="value">{formatTimestamp(rangeStats?.right?.timestamp)}</span>
          </p>
          <p>
            <span className="label">Intervalle</span>
            <span className="value">{formatDuration(rangeStats?.durationMs)}</span>
          </p>
        </div>

        <div className="cursor-list">
          <p className="list-title">Curseurs actifs</p>
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
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="stats-block">
          <p className="list-title">Statistiques par dataset (entre A et B)</p>
          {!rangeStats ? (
            <p className="empty">Place deux curseurs pour afficher les stats.</p>
          ) : (
            <div className="stats-table-wrap">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th>Dataset</th>
                    <th>Count</th>
                    <th>Min</th>
                    <th>Max</th>
                    <th>Moyenne</th>
                    <th>Mediane</th>
                    <th>P95</th>
                    <th>Std</th>
                    <th>Debut</th>
                    <th>Fin</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {rangeStats.datasets.map((dataset) => (
                    <tr key={dataset.id} className={dataset.visible ? '' : 'row-muted'}>
                      <td>
                        <span className="dot" style={{ backgroundColor: dataset.stroke }} /> {dataset.label}
                      </td>
                      <td>{dataset.stats?.count ?? 'N/A'}</td>
                      <td>{formatValue(dataset.stats?.min)}</td>
                      <td>{formatValue(dataset.stats?.max)}</td>
                      <td>{formatValue(dataset.stats?.mean)}</td>
                      <td>{formatValue(dataset.stats?.median)}</td>
                      <td>{formatValue(dataset.stats?.p95)}</td>
                      <td>{formatValue(dataset.stats?.stdDev)}</td>
                      <td>{formatValue(dataset.stats?.startValue)}</td>
                      <td>{formatValue(dataset.stats?.endValue)}</td>
                      <td>{formatValue(dataset.stats?.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="hint">
          Glisser les curseurs A et B pour recalculer les stats en direct. Zoom: molette/pinch. Pan: maintenir <code>Shift</code> + glisser.
        </p>
      </section>
    </main>
  )
}

export default App
