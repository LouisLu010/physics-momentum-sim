import { useCallback, useEffect, useRef, useState } from 'react'
import { connectorEndpoints, drawScene, hitObject, viewTransform, WORLD_SIZE } from './canvasDrawing.js'

const INITIAL_VIEW = { zoom: 1, x: 0, y: 0 }
const CONNECTOR_TYPES = ['rod', 'rope', 'spring']
const EMPTY_TRAILS = Object.freeze({})

function ViewIcon({ type }) {
  return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {type === 'plus' ? <path d="M4 10h12M10 4v12" /> : type === 'minus' ? <path d="M4 10h12" /> : <path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4M7 10h6m-3-3v6" />}
  </svg>
}

export default function SimulationCanvas({ objects, groundEnabled, selectedId, onSelect, onMove, onDropTool, connectionMode, onConnectionPick, onCancelConnection, onEndpointMove, trails = EMPTY_TRAILS }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const dragRef = useRef(null)
  const pointersRef = useRef(new Map())
  const viewRef = useRef(INITIAL_VIEW)
  const sizeRef = useRef({ width: WORLD_SIZE.width, height: WORLD_SIZE.height })
  const [view, setView] = useState(INITIAL_VIEW)
  const [size, setSize] = useState(sizeRef.current)
  const [dragging, setDragging] = useState(false)

  const updateView = useCallback((nextView) => {
    viewRef.current = nextView
    setView(nextView)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const measure = () => {
      const rect = containerRef.current.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const nextSize = { width: rect.width, height: rect.height }
      const dpr = window.devicePixelRatio || 1
      // 改变像素缓冲区会清空画布，仅在尺寸或屏幕像素密度变化时修改。
      const width = Math.round(rect.width * dpr)
      const height = Math.round(rect.height * dpr)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      sizeRef.current = nextSize
      setSize(nextSize)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(containerRef.current)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    drawScene(canvasRef.current, { size, view, objects, groundEnabled, selectedId, connectionMode, trails })
  }, [size, view, objects, groundEnabled, selectedId, connectionMode, trails])

  const localPoint = useCallback((event) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }, [])

  const worldPoint = useCallback((point) => {
    const transform = viewTransform(sizeRef.current, viewRef.current)
    return { x: (point.x - transform.x) / transform.scale, y: (point.y - transform.y) / transform.scale }
  }, [])

  const zoomAt = useCallback((factor, center) => {
    const previous = viewRef.current
    const anchor = worldPoint(center)
    const zoom = Math.max(0.25, Math.min(4, previous.zoom * factor))
    const transform = viewTransform(sizeRef.current, { zoom, x: 0, y: 0 })
    updateView({ zoom, x: center.x - anchor.x * transform.scale - transform.x, y: center.y - anchor.y * transform.scale - transform.y })
  }, [updateView, worldPoint])

  useEffect(() => {
    const canvas = canvasRef.current
    const wheel = (event) => {
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      zoomAt(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.004), localPoint(event))
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [localPoint, zoomAt])

  const startPointer = (event) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return
    const local = localPoint(event)
    pointersRef.current.set(event.pointerId, local)
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()]
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      dragRef.current = { mode: 'pinch', distance: Math.hypot(second.x - first.x, second.y - first.y), anchor: worldPoint(center), zoom: viewRef.current.zoom }
      setDragging(true)
      return
    }
    const point = worldPoint(local)
    const { scale } = viewTransform(sizeRef.current, viewRef.current)
    if (connectionMode) {
      const target = hitObject(objects, point, scale, groundEnabled, true)
      if (target) onConnectionPick(target.id)
      return
    }
    if (event.button === 0) {
      const selected = objects.find((object) => object.id === selectedId)
      if (selected && CONNECTOR_TYPES.includes(selected.type)) {
        const ends = connectorEndpoints(selected, objects)
        const endpoint = ['a', 'b'].find((end) => Math.hypot(point.x - ends[end].x, point.y - ends[end].y) < 11 / scale)
        if (endpoint) {
          dragRef.current = { mode: 'endpoint', id: selected.id, end: endpoint }
          setDragging(true)
          return
        }
      }
      const target = hitObject(objects, point, scale, groundEnabled)
      if (target) {
        onSelect(target.id)
        dragRef.current = { mode: 'object', id: target.id, previous: point }
        setDragging(true)
        return
      }
      onSelect(null)
    }
    dragRef.current = { mode: 'pan', previous: local }
    setDragging(true)
  }

  const movePointer = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return
    const local = localPoint(event)
    pointersRef.current.set(event.pointerId, local)
    const drag = dragRef.current
    if (!drag) return
    if (drag.mode === 'pinch' && pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()]
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const zoom = Math.max(0.25, Math.min(4, drag.zoom * distance / Math.max(drag.distance, 1)))
      const transform = viewTransform(sizeRef.current, { zoom, x: 0, y: 0 })
      updateView({ zoom, x: center.x - drag.anchor.x * transform.scale - transform.x, y: center.y - drag.anchor.y * transform.scale - transform.y })
    } else if (drag.mode === 'pan') {
      updateView({ ...viewRef.current, x: viewRef.current.x + local.x - drag.previous.x, y: viewRef.current.y + local.y - drag.previous.y })
      drag.previous = local
    } else if (drag.mode === 'object') {
      const point = worldPoint(local)
      onMove(drag.id, point.x - drag.previous.x, point.y - drag.previous.y)
      drag.previous = point
    } else if (drag.mode === 'endpoint') {
      onEndpointMove?.(drag.id, drag.end, worldPoint(local))
    }
  }

  const finishPointer = (event) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size === 1 && dragRef.current?.mode === 'pinch') {
      dragRef.current = { mode: 'pan', previous: [...pointersRef.current.values()][0] }
    } else if (pointersRef.current.size === 0) {
      dragRef.current = null
      setDragging(false)
    }
  }

  const drop = (event) => {
    event.preventDefault()
    const type = event.dataTransfer.getData('application/x-momentum-tool')
    if (['arc', 'block', 'ball', 'rod', 'rope', 'spring', 'ground'].includes(type)) onDropTool(type, worldPoint(localPoint(event)))
  }

  const zoomFromButton = (factor) => zoomAt(factor, { x: size.width / 2, y: size.height / 2 })

  return <div className="canvas-shell" ref={containerRef}>
    <canvas
      ref={canvasRef}
      className="simulation-canvas"
      role="img"
      aria-label={`物理实验画布，包含 ${objects.length} 个元件。可拖动元件，拖动空白处平移，滚轮或双指缩放。也可使用元件列表与检查器编辑。`}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', minHeight: 0, cursor: connectionMode ? 'crosshair' : dragging ? 'grabbing' : 'grab' }}
      onPointerDown={startPointer}
      onPointerMove={movePointer}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onLostPointerCapture={finishPointer}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
      onContextMenu={(event) => event.preventDefault()}
    />
    <div className="canvas-controls" aria-label="画布视图控制">
      <button className="canvas-view-button" title="缩小" aria-label="缩小画布" onClick={() => zoomFromButton(1 / 1.2)}><ViewIcon type="minus" /></button>
      <span className="canvas-zoom-value">{Math.round(view.zoom * 100)}%</span>
      <button className="canvas-view-button" title="放大" aria-label="放大画布" onClick={() => zoomFromButton(1.2)}><ViewIcon type="plus" /></button>
      <button className="canvas-view-button" title="复位视角" aria-label="复位视角" onClick={() => updateView(INITIAL_VIEW)}><ViewIcon type="reset" /></button>
    </div>
    {connectionMode ? <div className="canvas-connection-notice" role="status">点击小球或滑块，连接端点 {connectionMode.end.toUpperCase()}<button onClick={onCancelConnection}>取消</button></div> : <div className="canvas-instruction">拖动元件 · 空白处平移 · 滚轮缩放</div>}
  </div>
}
