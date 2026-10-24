import { arcBase, verticalTangentCenters } from './arcGeometry.js'

export const SNAP_DISTANCE = 14

export function snapObject(object, objects, { groundEnabled = true, scale = 1, disabled = false } = {}) {
  if (disabled) return { object, hint: null }
  const displayScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const tolerance = SNAP_DISTANCE / displayScale
  if (object.type === 'ball' && !object.rodId) {
    let best = null
    for (const arc of objects.filter(candidate => candidate.type === 'arc')) {
      for (const point of verticalTangentCenters(arc, object.radius)) {
        const distance = Math.hypot(object.x - point.x, object.y - point.y)
        if (distance <= tolerance && (!best || distance < best.distance)) best = { point, distance }
      }
    }
    if (best) {
      const { point } = best
      return { object: { ...object, x: point.x, y: point.y }, hint: { kind: 'ball-arc', point: { x: point.contactX, y: point.y }, line: { x1: point.contactX, y1: point.y - object.radius - 25 / displayScale, x2: point.contactX, y2: point.y + object.radius + 25 / displayScale }, label: '小球已对齐竖直切点' } }
    }
  }
  if (object.type === 'arc' && groundEnabled) {
    const base = arcBase(object)
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
      return { object: { ...object, cy: object.cy + ground.y - base.bottom }, hint: { kind: 'arc-ground', point: { x: (left + right) / 2, y: ground.y }, line: { x1: left, y1: ground.y, x2: right, y2: ground.y }, label: '槽底已贴合地面' } }
    }
  }
  return { object, hint: null }
}
