import { COLORS } from './model.js'
import { angleOnArc, arcBase, ARC_WALL_HALF } from './arcGeometry.js'
import { endpointPosition } from './connections.js'
export const WORLD_SIZE = { width: 900, height: 620 }
const CONNECTOR_TYPES = new Set(['rod', 'rope', 'spring'])
const BODY_TYPES = new Set(['ball', 'block', 'arc', 'joint'])

export function connectorEndpoints(object, objects) {
  return { a: endpointPosition(object, 'a', objects), b: endpointPosition(object, 'b', objects) }
}

function distanceToSegment(point, first, second) {
  const dx = second.x - first.x
  const dy = second.y - first.y
  const t = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(point.x - first.x - t * dx, point.y - first.y - t * dy)
}

function arcPoint(object, degrees) {
  const radians = degrees * Math.PI / 180
  return { x: object.cx + object.radius * Math.cos(radians), y: object.cy + object.radius * Math.sin(radians) }
}

function arcBodyPolygon(object) {
  const count = Math.max(2, Math.ceil(object.angle / 3))
  const points = Array.from({ length: count + 1 }, (_, index) => arcPoint(object, object.startAngle + object.angle * index / count))
  // 下半圆槽的外壳可自然延伸到平底；其他朝向保留薄弧壁和独立水平底座。
  if (points.some(point => point.y < object.cy - 1e-6)) return null
  const base = arcBase(object)
  return [...points, { x: base.left, y: points.at(-1).y }, { x: base.left, y: base.bottom }, { x: base.right, y: base.bottom }, { x: base.right, y: points[0].y }]
}

function pointInPolygon(point, polygon) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]
    const b = polygon[previous]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function arcOuterSides(object) {
  const angles = [object.startAngle, object.startAngle + object.angle, ...[0, 90, 180, 270].filter(angle => angleOnArc(angle, object.startAngle, object.angle))]
  const points = angles.map(angle => arcPoint(object, angle))
  const left = points.reduce((extreme, point) => point.x < extreme.x ? point : extreme)
  const right = points.reduce((extreme, point) => point.x > extreme.x ? point : extreme)
  const base = arcBase(object)
  return [
    { left: base.left, right: left.x - ARC_WALL_HALF, top: left.y, bottom: base.top, outerX: base.left },
    { left: right.x + ARC_WALL_HALF, right: base.right, top: right.y, bottom: base.top, outerX: base.right },
  ]
}

export function hitObject(objects, point, scale, groundEnabled, bodiesOnly = false) {
  const padding = 8 / scale
  // 接头位于最上层；重合时先选接头，再选物体，最后选连接线。
  const sorted = [
    ...objects.filter(object => !BODY_TYPES.has(object.type)),
    ...objects.filter(object => object.type === 'arc'),
    ...objects.filter(object => object.type === 'ball' || object.type === 'block'),
    ...objects.filter(object => object.type === 'joint'),
  ]
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const object = sorted[index]
    if (object.type === 'joint' && Math.hypot(point.x - object.x, point.y - object.y) <= 11 / scale) return object
    if (object.type === 'ball' && Math.hypot(point.x - object.x, point.y - object.y) <= object.radius + padding) return object
    if (object.type === 'block' && Math.abs(point.x - object.x) <= object.width / 2 + padding && Math.abs(point.y - object.y) <= object.height / 2 + padding) return object
    if (object.type === 'arc') {
      const distance = Math.hypot(point.x - object.cx, point.y - object.cy)
      const angle = Math.atan2(point.y - object.cy, point.x - object.cx) * 180 / Math.PI
      if (distance <= padding || (Math.abs(distance - object.radius) <= padding + 5 && angleOnArc(angle, object.startAngle, object.angle))) return object
      const base = arcBase(object)
      if (point.x >= base.left - padding && point.x <= base.right + padding && point.y >= base.top - padding && point.y <= base.bottom + padding) return object
      const polygon = arcBodyPolygon(object)
      if (polygon && (pointInPolygon(point, polygon) || polygon.some((first, index) => distanceToSegment(point, first, polygon[(index + 1) % polygon.length]) <= padding))) return object
      if (!polygon) {
        if (arcOuterSides(object).some(side => point.x >= side.left - padding && point.x <= side.right + padding && point.y >= side.top - padding && point.y <= side.bottom + padding)) return object
      }
    }
    if (bodiesOnly) continue
    if (object.type === 'ground' && groundEnabled && distanceToSegment(point, { x: object.x, y: object.y }, { x: object.x + object.width, y: object.y }) <= padding + 3) return object
    if (['rod', 'rope', 'spring'].includes(object.type)) {
      const { a, b } = connectorEndpoints(object, objects)
      if (distanceToSegment(point, a, b) <= padding + 7) return object
      if (object.type === 'rope') {
        const sag = ropeSag(object, a, b)
        let previous = a
        for (let i = 1; i <= 16; i += 1) {
          const t = i / 16
          const current = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + 2 * (1 - t) * t * sag }
          if (distanceToSegment(point, previous, current) <= padding + 3) return object
          previous = current
        }
      }
    }
  }
  return null
}

export function hitConnectionTarget(objects, point, scale = 1, sourceId) {
  const displayScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const endpointRadius = 12 / displayScale
  let closest = null
  const consider = (target, position, priority) => {
    const distance = Math.hypot(point.x - position.x, point.y - position.y)
    if (!closest || distance < closest.distance - 1e-7 || (Math.abs(distance - closest.distance) <= 1e-7 && priority > closest.priority)) closest = { target, distance, priority }
  }
  for (const object of objects) {
    if (object.id === sourceId) continue
    if (BODY_TYPES.has(object.type) && hitObject([object], point, displayScale, true, true)) {
      consider(object.id, { x: object.cx ?? object.x, y: object.cy ?? object.y }, object.type === 'joint' ? 2 : 1)
    } else if (CONNECTOR_TYPES.has(object.type)) {
      const ends = connectorEndpoints(object, objects)
      for (const end of ['a', 'b']) {
        if (Math.hypot(point.x - ends[end].x, point.y - ends[end].y) <= endpointRadius) consider({ connectorId: object.id, end }, ends[end], 0)
      }
    }
  }
  return closest?.target ?? null
}

export function viewTransform(size, view) {
  const scale = Math.min(size.width / WORLD_SIZE.width, size.height / WORLD_SIZE.height) * view.zoom
  return {
    scale,
    x: (size.width - WORLD_SIZE.width * scale) / 2 + view.x,
    y: (size.height - WORLD_SIZE.height * scale) / 2 + view.y,
  }
}

function ropeSag(object, a, b) {
  const distance = Math.hypot(b.x - a.x, b.y - a.y)
  return Math.min(150, Math.sqrt(Math.max(0, object.length ** 2 - distance ** 2)) / 2)
}

function circle(context, x, y, radius) {
  context.beginPath()
  context.arc(x, y, radius, 0, Math.PI * 2)
}

function line(context, a, b) {
  context.beginPath()
  context.moveTo(a.x, a.y)
  context.lineTo(b.x, b.y)
  context.stroke()
}

function label(context, text, x, y, scale, color = '#777168') {
  context.save()
  context.font = `${11 / scale}px "SFMono-Regular", Consolas, monospace`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineWidth = 5 / scale
  context.lineJoin = 'round'
  context.strokeStyle = '#fcfbf7'
  context.strokeText(text, x, y)
  context.fillStyle = color
  context.fillText(text, x, y)
  context.restore()
}

function drawGrid(context, size, transform) {
  const { scale, x, y } = transform
  let step = 50
  while (step * scale < 24) step *= 2
  while (step * scale > 95) step /= 2
  const left = -x / scale
  const top = -y / scale
  const right = (size.width - x) / scale
  const bottom = (size.height - y) / scale
  context.lineWidth = 0.75 / scale
  context.strokeStyle = '#ebe7df'
  context.beginPath()
  for (let column = Math.ceil(left / step) * step; column <= right; column += step) {
    context.moveTo(column, top)
    context.lineTo(column, bottom)
  }
  for (let row = Math.ceil(top / step) * step; row <= bottom; row += step) {
    context.moveTo(left, row)
    context.lineTo(right, row)
  }
  context.stroke()
}

function drawArc(context, object, selected, scale) {
  const start = object.startAngle * Math.PI / 180
  const end = (object.startAngle + object.angle) * Math.PI / 180
  const point = (angle, radius = object.radius) => ({ x: object.cx + radius * Math.cos(angle), y: object.cy + radius * Math.sin(angle) })
  const base = arcBase(object)
  const polygon = arcBodyPolygon(object)
  context.strokeStyle = '#93b3c8'
  context.lineWidth = 1.2 / scale
  if (polygon) {
    context.fillStyle = '#e7f0f5'
    context.beginPath()
    const first = point(start)
    context.moveTo(first.x, first.y)
    context.arc(object.cx, object.cy, object.radius, start, end)
    context.lineTo(base.left, point(end).y)
    context.lineTo(base.left, base.bottom)
    context.lineTo(base.right, base.bottom)
    context.lineTo(base.right, first.y)
    context.closePath()
    context.fill()
    context.stroke()
  } else {
    context.fillStyle = '#e7f0f5'
    for (const side of arcOuterSides(object)) {
      context.fillRect(side.left, side.top, side.right - side.left, side.bottom - side.top)
      line(context, { x: side.outerX, y: side.top }, { x: side.outerX, y: side.bottom })
      line(context, { x: side.left, y: side.top }, { x: side.right, y: side.top })
    }
  }
  context.fillStyle = '#d8e7f0'
  context.fillRect(base.left, base.top, base.right - base.left, base.bottom - base.top)
  context.strokeStyle = selected ? '#477e9d' : '#799fb8'
  context.lineWidth = 1.5 / scale
  context.beginPath()
  context.moveTo(base.left, base.top)
  context.lineTo(base.left, base.bottom)
  context.lineTo(base.right, base.bottom)
  context.lineTo(base.right, base.top)
  context.stroke()
  context.lineWidth = 0.8 / scale
  context.strokeStyle = '#a9c4d5'
  line(context, { x: base.left, y: base.top }, { x: base.right, y: base.top })
  if ((base.bottom - base.top) * scale >= 12) {
    context.fillStyle = '#537d96'
    context.font = `${10 / scale}px "SFMono-Regular", Consolas, monospace`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(object.fixed || (!Number.isFinite(object.mass) && object.fixed === undefined) ? '固定' : `${object.mass ?? 5} kg`, (base.left + base.right) / 2, (base.top + base.bottom) / 2)
  }
  context.strokeStyle = COLORS.arc
  context.lineWidth = Math.max(7, 2.5 / scale)
  context.beginPath()
  context.arc(object.cx, object.cy, object.radius, start, end)
  context.stroke()
  context.strokeStyle = '#9abdd4'
  context.lineWidth = 1.2 / scale
  context.beginPath()
  context.arc(object.cx, object.cy, object.radius + 6, start, end)
  context.stroke()
  if (!selected) return
  context.save()
  context.strokeStyle = '#8ba9bc'
  context.lineWidth = 1 / scale
  context.setLineDash([4 / scale, 5 / scale])
  line(context, { x: object.cx, y: object.cy }, point(start))
  line(context, { x: object.cx, y: object.cy }, point(end))
  context.setLineDash([])
  context.beginPath()
  context.arc(object.cx, object.cy, Math.min(32, object.radius * 0.25), start, end)
  context.stroke()
  line(context, { x: object.cx - 5 / scale, y: object.cy }, { x: object.cx + 5 / scale, y: object.cy })
  line(context, { x: object.cx, y: object.cy - 5 / scale }, { x: object.cx, y: object.cy + 5 / scale })
  label(context, `R ${(object.radius / 100).toFixed(2)} m · ${object.angle}°`, object.cx, object.cy - 24 / scale, scale, COLORS.arc)
  context.restore()
}

function drawGround(context, object, selected, scale) {
  context.strokeStyle = selected ? '#e16551' : COLORS.ground
  context.lineWidth = 3 / scale
  line(context, { x: object.x, y: object.y }, { x: object.x + object.width, y: object.y })
  context.lineWidth = 1 / scale
  context.strokeStyle = '#aaa59d'
  for (let x = object.x; x < object.x + object.width; x += 15 / scale) {
    line(context, { x, y: object.y + 3 / scale }, { x: x - 6 / scale, y: object.y + 12 / scale })
  }
}

function drawAnchor(context, point, fixed, selected, scale) {
  context.fillStyle = '#fcfbf7'
  context.lineWidth = 1.6 / scale
  circle(context, point.x, point.y, (selected ? 5 : 3.5) / scale)
  context.fill()
  context.stroke()
  if (fixed) {
    context.lineWidth = 1 / scale
    const radius = 8 / scale
    line(context, { x: point.x - radius, y: point.y + radius }, { x: point.x + radius, y: point.y + radius })
  }
}

function drawConnector(context, object, objects, selected, scale, connectionMode) {
  const { a, b } = connectorEndpoints(object, objects)
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  context.strokeStyle = COLORS[object.type]
  context.lineWidth = object.type === 'rod' ? Math.max(6, 3 / scale) : 1.8 / scale
  if (object.type === 'rod') {
    line(context, a, b)
  } else if (object.type === 'rope') {
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 + ropeSag(object, a, b), b.x, b.y)
    context.stroke()
  } else {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const normal = { x: -dy / (length || 1), y: dx / (length || 1) }
    const turns = Math.max(8, Math.min(28, Math.round(length / 12)))
    const amplitude = Math.min(7 / Math.max(scale, 0.6), length * 0.12)
    context.beginPath()
    context.moveTo(a.x, a.y)
    context.lineTo(a.x + dx * 0.08, a.y + dy * 0.08)
    for (let index = 1; index < turns; index += 1) {
      const t = 0.08 + 0.84 * index / turns
      const offset = index % 2 ? amplitude : -amplitude
      context.lineTo(a.x + dx * t + normal.x * offset, a.y + dy * t + normal.y * offset)
    }
    context.lineTo(a.x + dx * 0.92, a.y + dy * 0.92)
    context.lineTo(b.x, b.y)
    context.stroke()
  }
  context.lineWidth = 1.7 / scale
  const availableTarget = connectionMode && connectionMode.id !== object.id
  drawAnchor(context, a, object.fixed || !object.bodyA, selected || availableTarget, scale)
  drawAnchor(context, b, object.fixed || !object.bodyB, selected || availableTarget, scale)
  if (selected || availableTarget) {
    label(context, 'A', a.x, a.y - 17 / scale, scale, COLORS[object.type])
    label(context, 'B', b.x, b.y - 17 / scale, scale, COLORS[object.type])
  }
  if (selected) {
    label(context, `${(length / 100).toFixed(2)} m${object.fixed ? ' · 固定' : ''}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 18 / scale, scale, COLORS[object.type])
  }
  if (connectionMode?.id === object.id) {
    const endpoint = connectionMode.end === 'a' ? a : b
    context.strokeStyle = '#e16551'
    context.lineWidth = 2 / scale
    circle(context, endpoint.x, endpoint.y, 10 / scale)
    context.stroke()
  }
}

function drawJoint(context, object, selected, scale) {
  const color = COLORS.joint || '#596e62'
  context.fillStyle = '#fcfbf7'
  context.strokeStyle = color
  context.lineWidth = 2 / scale
  circle(context, object.x, object.y, 5 / scale)
  context.fill()
  context.stroke()
  if (!selected) return
  context.save()
  context.setLineDash([3 / scale, 3 / scale])
  context.lineWidth = 1 / scale
  context.strokeStyle = '#df6f55'
  circle(context, object.x, object.y, 11 / scale)
  context.stroke()
  context.restore()
  label(context, object.name || '连接点', object.x, object.y - 21 / scale, scale, color)
  label(context, object.fixed ? '固定' : `${object.mass} kg`, object.x, object.y + 20 / scale, scale, color)
}

function drawBody(context, object, selected, scale, compact) {
  context.fillStyle = COLORS[object.type]
  context.strokeStyle = object.type === 'ball' ? '#ad7138' : '#a65340'
  context.lineWidth = 1.7 / scale
  if (object.type === 'ball') {
    circle(context, object.x, object.y, object.radius)
    context.fill()
    context.stroke()
    context.fillStyle = '#fff0d2'
    circle(context, object.x - object.radius * 0.27, object.y - object.radius * 0.3, object.radius * 0.18)
    context.fill()
    if (object.rodId) {
      context.fillStyle = '#fcfbf7'
      context.strokeStyle = '#7b714e'
      circle(context, object.x, object.y, object.radius * 0.32)
      context.fill()
      context.stroke()
    }
  } else {
    context.beginPath()
    context.roundRect(object.x - object.width / 2, object.y - object.height / 2, object.width, object.height, 4)
    context.fill()
    context.stroke()
    if (object.width * scale > 48) {
      context.fillStyle = '#fff5e9'
      context.font = `500 ${11 / scale}px "SFMono-Regular", Consolas, monospace`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(`${object.mass} kg`, object.x, object.y)
    }
  }
  if (selected) {
    context.save()
    context.strokeStyle = '#e16551'
    context.lineWidth = 1.3 / scale
    context.setLineDash([4 / scale, 4 / scale])
    if (object.type === 'ball') {
      circle(context, object.x, object.y, object.radius + 7 / scale)
    } else {
      context.beginPath()
      context.roundRect(object.x - object.width / 2 - 7 / scale, object.y - object.height / 2 - 7 / scale, object.width + 14 / scale, object.height + 14 / scale, 7 / scale)
    }
    context.stroke()
    context.restore()
  }
  const extent = object.type === 'ball' ? object.radius : object.height / 2
  if (selected || !compact) label(context, object.name, object.x, object.y - extent - 19 / scale, scale)
  if (object.fixed) label(context, '固定', object.x, object.y + extent + 15 / scale, scale)
  if (selected && !object.fixed) {
    const speed = Math.hypot(object.vx || 0, object.vy || 0)
    if (speed > 1) {
      const length = Math.min(100 / scale, speed * 0.25)
      const ux = object.vx / speed
      const uy = object.vy / speed
      const end = { x: object.x + ux * length, y: object.y + uy * length }
      context.strokeStyle = '#675944'
      context.lineWidth = 1.5 / scale
      line(context, { x: object.x, y: object.y }, end)
      line(context, end, { x: end.x - ux * 7 / scale - uy * 4 / scale, y: end.y - uy * 7 / scale + ux * 4 / scale })
      line(context, end, { x: end.x - ux * 7 / scale + uy * 4 / scale, y: end.y - uy * 7 / scale - ux * 4 / scale })
      label(context, `${(speed / 100).toFixed(2)} m/s`, end.x, end.y - 12 / scale, scale)
    }
  }
}

function drawTrails(context, objects, trails, scale) {
  for (const object of objects) {
    if (object.type !== 'ball' && object.type !== 'block') continue
    const points = trails[object.id]
    if (!Array.isArray(points) || points.length < 2) continue
    context.save()
    context.strokeStyle = COLORS[object.type]
    context.lineWidth = 1.5 / scale
    context.globalAlpha = 0.6
    context.beginPath()
    let started = false
    for (const point of points) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        started = false
        continue
      }
      if (started) context.lineTo(point.x, point.y)
      else context.moveTo(point.x, point.y)
      started = true
    }
    context.stroke()
    context.restore()
  }
}

function drawSnapHint(context, hint, scale) {
  if (!hint) return
  context.save()
  context.strokeStyle = '#4d8765'
  context.fillStyle = '#f3faf1'
  context.lineWidth = 1.5 / scale
  if (hint.line) {
    context.setLineDash([5 / scale, 4 / scale])
    line(context, { x: hint.line.x1, y: hint.line.y1 }, { x: hint.line.x2, y: hint.line.y2 })
    context.setLineDash([])
  }
  if (hint.point) {
    circle(context, hint.point.x, hint.point.y, 5 / scale)
    context.fill()
    context.stroke()
  }
  context.restore()
}

export function drawScene(canvas, { size, view, objects, groundEnabled, selectedId, connectionMode, snapHint = null, trails = {} }) {
  const context = canvas.getContext('2d')
  if (!context || size.width <= 0 || size.height <= 0) return
  const dpr = canvas.width / size.width
  const transform = viewTransform(size, view)
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, size.width, size.height)
  context.fillStyle = '#fcfbf7'
  context.fillRect(0, 0, size.width, size.height)
  context.translate(transform.x, transform.y)
  context.scale(transform.scale, transform.scale)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  drawGrid(context, size, transform)
  drawTrails(context, objects, trails, transform.scale)
  for (const object of objects) {
    const selected = selectedId === object.id
    context.save()
    if (object.type === 'arc') drawArc(context, object, selected, transform.scale)
    if (object.type === 'ground' && groundEnabled) drawGround(context, object, selected, transform.scale)
    context.restore()
  }
  for (const object of objects) {
    if (!['rod', 'rope', 'spring'].includes(object.type)) continue
    context.save()
    drawConnector(context, object, objects, selectedId === object.id, transform.scale, connectionMode)
    context.restore()
  }
  for (const object of objects) {
    if (object.type !== 'ball' && object.type !== 'block') continue
    context.save()
    drawBody(context, object, selectedId === object.id, transform.scale, size.width < 560)
    context.restore()
  }
  for (const object of objects) {
    if (object.type !== 'joint') continue
    context.save()
    drawJoint(context, object, selectedId === object.id, transform.scale)
    context.restore()
  }
  drawSnapHint(context, snapHint, transform.scale)
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  const rulerWidth = 100 * transform.scale
  if (rulerWidth > 20 && rulerWidth < size.width / 2) {
    context.strokeStyle = '#969087'
    context.lineWidth = 1
    const y = size.height - 24
    line(context, { x: 18, y }, { x: 18 + rulerWidth, y })
    line(context, { x: 18, y: y - 3 }, { x: 18, y: y + 3 })
    line(context, { x: 18 + rulerWidth, y: y - 3 }, { x: 18 + rulerWidth, y: y + 3 })
    context.font = '10px "SFMono-Regular", Consolas, monospace'
    context.fillStyle = '#8b857c'
    context.textAlign = 'center'
    context.fillText('1 m', 18 + rulerWidth / 2, y - 7)
  }
}
