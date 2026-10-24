export const TRAIL_LIMIT = 600
export const TRAIL_INTERVAL = 1 / 30

const validPoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y)

/** 以结构共享保留历史，不修改传入对象或轨迹点。 */
export function recordTrails(trails = {}, objects = []) {
  const result = new Map()
  for (const object of objects) {
    if (!object || !['ball', 'block'].includes(object.type) || typeof object.id !== 'string' || !object.id) continue
    const previous = Object.hasOwn(trails, object.id) && Array.isArray(trails[object.id]) ? trails[object.id] : []
    const points = previous.every(validPoint) && previous.length <= TRAIL_LIMIT
      ? previous
      : previous.filter(validPoint).slice(-TRAIL_LIMIT)
    if (!validPoint(object)) {
      if (points.length) result.set(object.id, points)
      continue
    }
    const last = points.at(-1)
    if (last && Math.hypot(object.x - last.x, object.y - last.y) < 0.5) {
      result.set(object.id, points)
      continue
    }
    result.set(object.id, [...points.slice(-(TRAIL_LIMIT - 1)), { x: object.x, y: object.y }])
  }
  return Object.fromEntries(result)
}
