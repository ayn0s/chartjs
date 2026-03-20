import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { createUplotScreenCursorPlugin } from './plugins/uplotScreenCursorPlugin'
import './App.css'

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
  const dataRef = useRef([[], []])
  const panStateRef = useRef({ active: false, startX: 0, min: 0, max: 0 })
  const screenCursorIndexRef = useRef(2)
  const [isPaused, setIsPaused] = useState(false)
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
        seriesIndices: [1],
      }),
    [handleCursorsUpdate],
  )

  useEffect(() => {
    const host = plotHostRef.current
    if (!host) {
      return undefined
    }

    const now = Date.now()
    const xs = []
    const ys = []

    for (let i = 49; i >= 0; i -= 1) {
      const x = now - i * 500
      const y = 55 + Math.sin(x / 2400) * 15 + Math.random() * 8
      xs.push(x)
      ys.push(Math.max(5, Math.min(95, Number(y.toFixed(2)))))
    }

    dataRef.current = [xs, ys]

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
            stroke: '#3a4c66',
            grid: { stroke: 'rgba(18, 31, 54, 0.08)' },
            values: (_u, values) => values.map((v) => formatTimestamp(v)),
          },
          {
            stroke: '#3a4c66',
            grid: { stroke: 'rgba(18, 31, 54, 0.08)' },
          },
        ],
        series: [
          {},
          {
            label: 'Flux mockup (500ms)',
            stroke: '#0b5fff',
            width: 2,
          },
        ],
        cursor: {
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
  }, [cursorPlugin])

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPaused) {
        return
      }

      const u = uplotRef.current
      if (!u) {
        return
      }

      const now = Date.now()
      const nextY = 55 + Math.sin(now / 2400) * 15 + Math.random() * 8
      const boundedY = Math.max(5, Math.min(95, Number(nextY.toFixed(2))))

      const xs = [...dataRef.current[0], now]
      const ys = [...dataRef.current[1], boundedY]
      const maxPoints = 120

      if (xs.length > maxPoints) {
        xs.splice(0, xs.length - maxPoints)
        ys.splice(0, ys.length - maxPoints)
      }

      dataRef.current = [xs, ys]
      u.setData(dataRef.current)
      u.setScale('x', { min: now - 25000, max: now })
    }, 500)

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
