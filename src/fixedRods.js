const BODY_TYPES = new Set(['ball', 'block', 'arc', 'joint'])
const ANCHOR_TOLERANCE = 1e-7

/** 固定杆的端点是世界坐标约束，不改变被连接物体自己的固定标志。 */
export function fixedRodPins(objects) {
  const bodies = new Set(objects.filter(object => BODY_TYPES.has(object.type)).map(object => object.id))
  const pins = new Map()
  for (const rod of objects) {
    if (rod.type !== 'rod' || !rod.fixed) continue
    for (const end of ['a', 'b']) {
      const id = rod[end === 'a' ? 'bodyA' : 'bodyB']
      if (!bodies.has(id)) continue
      const point = { x: rod[`${end}x`], y: rod[`${end}y`] }
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid fixed anchor')
      const previous = pins.get(id)
      if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) > ANCHOR_TOLERANCE) throw new Error('Conflicting fixed anchors')
      pins.set(id, previous || point)
    }
  }
  return pins
}

export function applyFixedRodPins(objects) {
  const pins = fixedRodPins(objects)
  return objects.map(object => {
    const pin = pins.get(object.id)
    if (!pin) return object
    const position = object.type === 'arc' ? { cx: pin.x, cy: pin.y } : { x: pin.x, y: pin.y }
    return { ...object, ...position, vx: 0, vy: 0 }
  })
}

function currentEndpoint(rod, end, objects) {
  const body = objects.find(object => object.id === rod[end === 'a' ? 'bodyA' : 'bodyB'] && BODY_TYPES.has(object.type))
  if (!rod.fixed && body) return { x: body.cx ?? body.x, y: body.cy ?? body.y }
  return { x: rod[`${end}x`], y: rod[`${end}y`] }
}

export function setRodFixed(objects, id, fixed) {
  const rod = objects.find(object => object.id === id && object.type === 'rod')
  if (!rod) throw new Error('Invalid rod')
  const normalized = applyFixedRodPins(objects)
  const current = normalized.find(object => object.id === id)
  let updated = { ...current, fixed: Boolean(fixed) }
  if (fixed) {
    const a = currentEndpoint(current, 'a', normalized)
    const b = currentEndpoint(current, 'b', normalized)
    updated = { ...updated, ax: a.x, ay: a.y, bx: b.x, by: b.y, length: Math.max(5, Math.hypot(b.x - a.x, b.y - a.y)) }
  }
  return applyFixedRodPins(normalized.map(object => object.id === id ? updated : object))
}
