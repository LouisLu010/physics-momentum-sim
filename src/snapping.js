import { arcBase, verticalTangentCenters } from './arcGeometry.js'

export const SNAP_DISTANCE = 14

function placementBounds(object) {
  const bounds = object.type === 'arc' ? arcBase(object) : object.type === 'block'
    ? { left: object.x - object.width / 2, right: object.x + object.width / 2, top: object.y - object.height / 2, bottom: object.y + object.height / 2 }
    : null
  return bounds && Object.values(bounds).every(Number.isFinite) ? bounds : null
}

function nearbyAlignment(object, objects, tolerance, displayScale, support) {
  const bounds = placementBounds(object)
  if (!bounds) return null
  const best = { x: null, y: null }
  const targets = objects.filter(candidate => candidate !== object && candidate.id !== object.id && ['block', 'arc'].includes(candidate.type)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const consider = (axis, source, destination, target, priority) => {
    if (axis === 'y' && support) return
    const delta = destination - source
    const distance = Math.abs(delta)
    if (distance > tolerance) return
    if (axis === 'x' && support && (bounds.right + delta <= Math.min(support.x, support.x + support.width) || bounds.left + delta >= Math.max(support.x, support.x + support.width))) return
    const previous = best[axis]
    if (!previous || distance < previous.distance - 1e-7 || (Math.abs(distance - previous.distance) <= 1e-7 && priority < previous.priority)) best[axis] = { delta, distance, coordinate: destination, target, priority }
  }
  for (const target of targets) {
    const other = placementBounds(target)
    if (!other) continue
    const gapX = Math.max(bounds.left - other.right, other.left - bounds.right)
    const gapY = Math.max(bounds.top - other.bottom, other.top - bounds.bottom)
    if (gapY <= tolerance) {
      consider('x', bounds.left, other.right, other, 0)
      consider('x', bounds.right, other.left, other, 0)
      if (gapY >= -tolerance) {
        consider('x', (bounds.left + bounds.right) / 2, (other.left + other.right) / 2, other, 1)
        consider('x', bounds.left, other.left, other, 2)
        consider('x', bounds.right, other.right, other, 2)
      }
    }
    if (gapX <= tolerance) {
      // 槽口是空腔；只把滑块顶面和槽体底面作为竖直接触面。
      if (target.type === 'block') consider('y', bounds.bottom, other.top, other, 0)
      if (object.type === 'block') consider('y', bounds.top, other.bottom, other, 0)
      if (gapX >= -tolerance) {
        consider('y', (bounds.top + bounds.bottom) / 2, (other.top + other.bottom) / 2, other, 1)
        consider('y', bounds.top, other.top, other, 2)
        consider('y', bounds.bottom, other.bottom, other, 2)
      }
    }
  }
  const xKey = object.type === 'arc' ? 'cx' : 'x'
  const yKey = object.type === 'arc' ? 'cy' : 'y'
  const position = () => ({ ...object, [xKey]: object[xKey] + (best.x?.delta || 0), [yKey]: object[yKey] + (best.y?.delta || 0) })
  let snapped = position()
  let finalBounds = placementBounds(snapped)
  // 两轴可能选择不同元件，组合后仍须邻近且不能将底座或滑块吸进目标内部。
  for (let pass = 0; pass < 2; pass += 1) {
    let changed = false
    for (const axis of ['x', 'y']) {
      if (!best[axis]) continue
      const target = best[axis].target
      const gapX = Math.max(finalBounds.left - target.right, target.left - finalBounds.right)
      const gapY = Math.max(finalBounds.top - target.bottom, target.top - finalBounds.bottom)
      if ((axis === 'x' ? gapY : gapX) > tolerance || (gapX < -1e-7 && gapY < -1e-7)) { best[axis] = null; changed = true }
    }
    if (!changed) break
    snapped = position()
    finalBounds = placementBounds(snapped)
  }
  if (!best.x && !best.y) return null
  const padding = 10 / displayScale
  const lines = []
  if (best.x) lines.push({ x1: best.x.coordinate, y1: Math.min(finalBounds.top, best.x.target.top) - padding, x2: best.x.coordinate, y2: Math.max(finalBounds.bottom, best.x.target.bottom) + padding })
  if (best.y) lines.push({ x1: Math.min(finalBounds.left, best.y.target.left) - padding, y1: best.y.coordinate, x2: Math.max(finalBounds.right, best.y.target.right) + padding, y2: best.y.coordinate })
  return { object: snapped, hint: { kind: 'object-object', lines, label: '元件已吸附对齐' } }
}

export function snapObject(object, objects, { groundEnabled = true, scale = 1, disabled = false } = {}) {
  if (disabled) return { object, hint: null }
  const displayScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const tolerance = SNAP_DISTANCE / displayScale
  if (object.type === 'ball' && !object.rodId) {
    let bestPoint = null
    let bestLine = null
    for (const arc of objects.filter(candidate => candidate.type === 'arc')) {
      for (const point of verticalTangentCenters(arc, object.radius)) {
        const distance = Math.hypot(object.x - point.x, object.y - point.y)
        if (distance <= tolerance && (!bestPoint || distance < bestPoint.distance)) bestPoint = { point, distance }
        const horizontalDistance = Math.abs(object.x - point.x)
        const aboveHeight = point.y - object.y
        if (aboveHeight > 0 && horizontalDistance <= tolerance && (!bestLine || horizontalDistance < bestLine.distance || (horizontalDistance === bestLine.distance && aboveHeight < bestLine.aboveHeight))) {
          bestLine = { point, distance: horizontalDistance, aboveHeight }
        }
      }
    }
    // 槽口附近优先对齐切点；上方则只对齐水平方向，保留释放高度。
    const best = bestPoint || bestLine
    if (best) {
      const { point } = best
      const y = bestPoint ? point.y : object.y
      return { object: { ...object, x: point.x, y }, hint: { kind: 'ball-arc', point: { x: point.contactX, y: point.y }, line: { x1: point.contactX, y1: Math.min(y, point.y) - object.radius - 25 / displayScale, x2: point.contactX, y2: point.y + object.radius + 25 / displayScale }, label: bestPoint ? '小球已对齐竖直切点' : '小球已对齐竖直切线' } }
    }
  }
  let placed = object
  let hint = null
  let support = null
  if ((['arc', 'block'].includes(object.type) || (object.type === 'ball' && !object.rodId)) && groundEnabled) {
    const halfWidth = object.type === 'ball' ? object.radius : object.width / 2
    const halfHeight = object.type === 'ball' ? object.radius : object.height / 2
    const base = object.type === 'arc' ? arcBase(object) : { left: object.x - halfWidth, right: object.x + halfWidth, bottom: object.y + halfHeight }
    let best = null
    for (const ground of objects.filter(candidate => candidate.type === 'ground')) {
      const left = Math.min(ground.x, ground.x + ground.width)
      const right = Math.max(ground.x, ground.x + ground.width)
      if (base.right <= left || base.left >= right) continue
      const distance = Math.abs(base.bottom - ground.y)
      if (distance <= tolerance && (!best || distance < best.distance)) best = { ground, distance, left: Math.max(base.left, left), right: Math.min(base.right, right) }
    }
    if (best) {
      const { ground, left, right } = best
      const key = object.type === 'arc' ? 'cy' : 'y'
      placed = { ...object, [key]: object[key] + ground.y - base.bottom }
      support = ground
      hint = { kind: `${object.type}-ground`, point: { x: (left + right) / 2, y: ground.y }, line: { x1: left, y1: ground.y, x2: right, y2: ground.y }, label: object.type === 'arc' ? '槽底已贴合地面' : object.type === 'block' ? '滑块底面已贴合地面' : '小球已贴合地面' }
    }
  }
  const aligned = nearbyAlignment(placed, objects, tolerance, displayScale, support)
  if (!aligned) return { object: placed, hint }
  if (!hint) return aligned
  const base = placementBounds(aligned.object)
  const left = Math.max(base.left, Math.min(support.x, support.x + support.width))
  const right = Math.min(base.right, Math.max(support.x, support.x + support.width))
  const line = { x1: left, y1: support.y, x2: right, y2: support.y }
  return { object: aligned.object, hint: { ...hint, point: { x: (left + right) / 2, y: support.y }, line, lines: [line, ...aligned.hint.lines], label: `${hint.label} · ${aligned.hint.label}` } }
}
