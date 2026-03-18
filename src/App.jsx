import { useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  TimeScale,
  Title,
  Tooltip,
} from 'chart.js'
import 'hammerjs'
import zoomPlugin from 'chartjs-plugin-zoom'
import streamingPlugin from 'chartjs-plugin-streaming'
import 'chartjs-adapter-date-fns'
import { Line } from 'react-chartjs-2'
import { hybridCursorPlugin } from './plugins/hybridCursorPlugin'
import './App.css'

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Title,
  streamingPlugin,
  zoomPlugin,
  hybridCursorPlugin,
)

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

const INITIAL_TIME_ANCHOR = Date.now() - 5_000

function App() {
  const chartRef = useRef(null)
  const screenCursorIndexRef = useRef(2)
  const timeCursorIndexRef = useRef(2)
  const [isPaused, setIsPaused] = useState(false)
  const [cursorValues, setCursorValues] = useState({
    screenTimestamp: null,
    timeTimestamp: null,
    screenCursors: [],
    timeCursors: [],
  })

  const addScreenCursor = () => {
    const nextIndex = screenCursorIndexRef.current
    const chart = chartRef.current
    const palette = ['#e34f24', '#ff7f11', '#b54708', '#8a3ffc', '#3d5a80']
    const color = palette[(nextIndex - 1) % palette.length]

    chart?.$hybridCursorApi?.addScreenCursor({
      id: `screen-${nextIndex}`,
      ratio: 0.5,
      color,
      lineWidth: 2,
    })

    screenCursorIndexRef.current = nextIndex + 1
  }

  const addTimeCursor = () => {
    const chart = chartRef.current
    const timestamp =
      typeof cursorValues.screenTimestamp === 'number'
        ? cursorValues.screenTimestamp
        : typeof cursorValues.timeTimestamp === 'number'
          ? cursorValues.timeTimestamp
          : INITIAL_TIME_ANCHOR

    const palette = ['#117a65', '#c2571a', '#5f3dc4', '#0b5fff', '#9b2226']
  const nextIndex = timeCursorIndexRef.current
    const color = palette[(nextIndex - 1) % palette.length]

    chart?.$hybridCursorApi?.addTimeCursor({
      id: `time-${nextIndex}`,
      timestamp,
      color,
      lineWidth: 2,
    })

    timeCursorIndexRef.current = nextIndex + 1
  }

  const data = useMemo(
    () => ({
      datasets: [
        {
          label: 'Flux mockup (500ms)',
          data: [],
          borderColor: '#0b5fff',
          backgroundColor: 'rgba(11, 95, 255, 0.25)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
          fill: true,
        },
      ],
    }),
    [],
  )

  const options = useMemo(
    () => ({
      maintainAspectRatio: false,
      responsive: true,
      animation: false,
      parsing: false,
      normalized: true,
      events: [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
        'mousedown',
        'mouseup',
        'mousemove',
        'mouseout',
        'touchstart',
        'touchmove',
        'touchend',
      ],
      scales: {
        x: {
          type: 'realtime',
          realtime: {
            duration: 25_000,
            delay: 1_500,
            refresh: 500,
            frameRate: 30,
            pause: isPaused,
            onRefresh: (chart) => {
              if (isPaused) {
                return
              }

              const nextY = 55 + Math.sin(Date.now() / 2_400) * 15 + Math.random() * 8
              chart.data.datasets[0].data.push({
                x: Date.now(),
                y: Math.max(5, Math.min(95, Number(nextY.toFixed(2)))),
              })
            },
          },
          ticks: {
            color: '#3a4c66',
            maxRotation: 0,
            autoSkipPadding: 32,
          },
          grid: {
            color: 'rgba(18, 31, 54, 0.08)',
            borderColor: 'rgba(18, 31, 54, 0.18)',
          },
        },
        y: {
          suggestedMin: 0,
          suggestedMax: 100,
          ticks: {
            color: '#3a4c66',
          },
          grid: {
            color: 'rgba(18, 31, 54, 0.08)',
            borderColor: 'rgba(18, 31, 54, 0.18)',
          },
        },
      },
      interaction: {
        intersect: false,
        mode: 'nearest',
      },
      plugins: {
        legend: {
          labels: {
            color: '#10223e',
          },
        },
        title: {
          display: true,
          text: 'Chart.js Realtime + Hybrid Cursor Plugin',
          color: '#0d1e35',
          font: {
            size: 16,
            weight: '600',
          },
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
            modifierKey: 'shift',
          },
          zoom: {
            wheel: {
              enabled: true,
            },
            pinch: {
              enabled: true,
            },
            mode: 'x',
          },
        },
        hybridCursorPlugin: {
          screenCursors: [{ id: 'screen-1', ratio: 0.5, color: '#e34f24', lineWidth: 2 }],
          timeCursors: [{ id: 'time-1', timestamp: INITIAL_TIME_ANCHOR, color: '#117a65', lineWidth: 2 }],
          onValuesUpdate: setCursorValues,
        },
      },
    }),
    [isPaused],
  )

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
          <button type="button" className="control-btn secondary" onClick={addTimeCursor}>
            Ajouter un curseur temporel
          </button>
        </div>

        <div className="chart-wrap">
          <Line ref={chartRef} data={data} options={options} />
        </div>

        <div className="cursor-panel">
          <p>
            <span className="label">Screen Cursor (drag horizontal)</span>
            <span className="value">{formatTimestamp(cursorValues.screenTimestamp)}</span>
          </p>
          <p>
            <span className="label">Time Cursor (drag horizontal)</span>
            <span className="value">{formatTimestamp(cursorValues.timeTimestamp)}</span>
          </p>
        </div>

        <div className="cursor-list">
          <p className="list-title">Screen curseurs actifs</p>
          {cursorValues.screenCursors.length === 0 ? (
            <p className="empty">Aucun screen curseur.</p>
          ) : (
            <ul>
              {cursorValues.screenCursors.map((cursor) => (
                <li key={cursor.id}>
                  <span className="dot" style={{ backgroundColor: cursor.color }} />
                  <span>{cursor.id}</span>
                  <code>{formatTimestamp(cursor.timestamp)}</code>
                  <code>{formatValue(cursor.value)}</code>
                  <button
                    type="button"
                    className="small-btn"
                    onClick={() => chartRef.current?.$hybridCursorApi?.removeScreenCursor(cursor.id)}
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="cursor-list">
          <p className="list-title">Curseurs temporels actifs</p>
          {cursorValues.timeCursors.length === 0 ? (
            <p className="empty">Aucun curseur temporel.</p>
          ) : (
            <ul>
              {cursorValues.timeCursors.map((cursor) => (
                <li key={cursor.id}>
                  <span className="dot" style={{ backgroundColor: cursor.color }} />
                  <span>{cursor.id}</span>
                  <code>{formatTimestamp(cursor.timestamp)}</code>
                  <code>{formatValue(cursor.value)}</code>
                  <button
                    type="button"
                    className="small-btn"
                    onClick={() => chartRef.current?.$hybridCursorApi?.removeTimeCursor(cursor.id)}
                  >
                    Supprimer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="hint">
          Glisser un curseur avec la souris ou le doigt. Zoom: molette/pinch. Pan: maintenir <code>Shift</code> + glisser.
        </p>
      </section>
    </main>
  )
}

export default App
