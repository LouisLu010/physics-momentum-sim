import { arcBase } from './arcGeometry.js'

// 统一采用 100 px = 1 m；画布的 y 轴正方向向下。
const SCALE = 100
const EPSILON = 1e-9
const CONTACT_SLOP = 0.002
const ITERATIONS = 10
const CONTACT_TOLERANCE = CONTACT_SLOP * 4
const MAX_CONTACT_ANGLE = 0.005

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))
const isBody = (object) => ['ball', 'block', 'arc', 'joint'].includes(object?.type)
const isFixed = (object) => object?.fixed || (object?.type === 'arc' && !Number.isFinite(object.mass) && object.fixed !== false)
const mass = (object) => Math.max(object.type === 'joint' ? 0.001 : 0.01, finite(object.mass, object.type === 'arc' ? 5 : object.type === 'joint' ? 0.01 : 1))
const inverseMass = (object) => isBody(object) && !isFixed(object) ? 1 / mass(object) : 0
const velocity = (object) => ({ x: isFixed(object) ? 0 : finite(object?.vx), y: isFixed(object) ? 0 : finite(object?.vy) })
const position = (object) => object.type === 'arc' ? { x: finite(object.cx), y: finite(object.cy) } : { x: finite(object.x), y: finite(object.y) }
const hasBase = (object) => Number.isFinite(object.mass) || typeof object.fixed === 'boolean'

function pointFor(connector, side, byId) {
  if (connector.type === 'rod' && connector.fixed === true) {
    return { x: finite(connector[`${side}x`]), y: finite(connector[`${side}y`]) }
  }
  const body = byId.get(connector[`body${side.toUpperCase()}`])
  if (body && body.id !== connector.id && (isBody(body) || body.type === 'arc')) {
    return position(body)
  }
  return { x: finite(connector[`${side}x`]), y: finite(connector[`${side}y`]) }
}

function fixedRodPins(objects, byId) {
  const pins = new Map()
  for (const rod of objects) {
    if (rod.type !== 'rod' || rod.fixed !== true) continue
    for (const side of ['a', 'b']) {
      const id = rod[`body${side.toUpperCase()}`]
      if (!isBody(byId.get(id)) || pins.has(id)) continue
      // 冲突锚点由编辑层拒绝；无效外部数据按第一根固定杆确定性处理。
      pins.set(id, { x: finite(rod[`${side}x`]), y: finite(rod[`${side}y`]) })
    }
  }
  return pins
}

/** 解析连接元件的两端；未连接的端点作为世界坐标中的固定支点。 */
export function endpoints(connector, objects = []) {
  const byId = new Map(objects.map((object) => [object.id, object]))
  return { a: pointFor(connector, 'a', byId), b: pointFor(connector, 'b', byId) }
}

function geometry(connector, byId) {
  const a = pointFor(connector, 'a', byId)
  const b = pointFor(connector, 'b', byId)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const distance = Math.hypot(dx, dy)
  return {
    a, b, distance,
    nx: distance > EPSILON ? dx / distance : 1,
    ny: distance > EPSILON ? dy / distance : 0,
    bodyA: byId.get(connector.bodyA),
    bodyB: byId.get(connector.bodyB),
  }
}

function support(body, nx, ny) {
  if (body.type === 'arc') {
    const base = arcBase(body)
    return Math.abs(nx) * (base.right - base.left) / 2 + Math.abs(ny) * (base.bottom - base.top) / 2
  }
  return body.type === 'ball'
    ? Math.max(1, finite(body.radius, 18))
    : Math.abs(nx) * Math.max(1, finite(body.width, 80)) / 2 + Math.abs(ny) * Math.max(1, finite(body.height, 50)) / 2
}

function translate(body, x, y) {
  if (!inverseMass(body)) return
  if (body.type === 'arc') { body.cx += x; body.cy += y }
  else { body.x += x; body.y += y }
}

function accelerate(body, x, y) {
  if (!inverseMass(body)) return
  body.vx += x
  body.vy += y
}

function springForces(connectors, byId, dt) {
  for (const connector of connectors) {
    if (connector.type !== 'spring') continue
    const { bodyA, bodyB, distance, nx, ny } = geometry(connector, byId)
    if (bodyA && bodyA === bodyB) continue
    const va = velocity(bodyA)
    const vb = velocity(bodyB)
    const relative = (vb.x - va.x) * nx + (vb.y - va.y) * ny
    // 胡克定律的输入先换成米，再把加速度换回画布坐标。
    const extension = (distance - Math.max(0, finite(connector.length, distance))) / SCALE
    const force = Math.max(0, finite(connector.stiffness, 40)) * extension
      + Math.max(0, finite(connector.damping)) * relative / SCALE
    const impulse = force * SCALE * dt
    accelerate(bodyA, nx * impulse * inverseMass(bodyA), ny * impulse * inverseMass(bodyA))
    accelerate(bodyB, -nx * impulse * inverseMass(bodyB), -ny * impulse * inverseMass(bodyB))
  }
}

function distanceConstraint(connector, byId) {
  const { bodyA, bodyB, distance, nx, ny } = geometry(connector, byId)
  if (bodyA && bodyA === bodyB) return
  const wa = inverseMass(bodyA)
  const wb = inverseMass(bodyB)
  const weight = wa + wb
  if (!weight) return
  const rest = Math.max(0.01, finite(connector.length, distance))
  const error = distance - rest
  if (connector.type === 'rope' && error < -CONTACT_SLOP) return
  if (connector.type === 'rod' || error > 0) {
    translate(bodyA, nx * error * wa / weight, ny * error * wa / weight)
    translate(bodyB, -nx * error * wb / weight, -ny * error * wb / weight)
  }
  const va = velocity(bodyA)
  const vb = velocity(bodyB)
  const relative = (vb.x - va.x) * nx + (vb.y - va.y) * ny
  if (connector.type === 'rope' && relative <= 0) return
  const impulse = relative / weight
  accelerate(bodyA, nx * impulse * wa, ny * impulse * wa)
  accelerate(bodyB, -nx * impulse * wb, -ny * impulse * wb)
}

function jointConstraintGroup(connectors, bodies) {
  const ids = new Set(bodies.filter(body => body.type === 'joint').map(body => body.id))
  const linked = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const connector of connectors) {
      if (connector.type === 'spring' || linked.has(connector) || (!ids.has(connector.bodyA) && !ids.has(connector.bodyB))) continue
      linked.add(connector)
      if (connector.bodyA) ids.add(connector.bodyA)
      if (connector.bodyB) ids.add(connector.bodyB)
      changed = true
    }
  }
  return [...linked]
}

function jointConstraintsSettled(connectors, byId) {
  for (const connector of connectors) {
    const { distance, nx, ny, bodyA, bodyB } = geometry(connector, byId)
    if (!inverseMass(bodyA) && !inverseMass(bodyB)) continue
    const error = distance - connector.length
    if (connector.type === 'rope' && error < -CONTACT_SLOP) continue
    if (Math.abs(error) > 0.005) return false
    const va = velocity(bodyA)
    const vb = velocity(bodyB)
    const relative = (vb.x - va.x) * nx + (vb.y - va.y) * ny
    if (connector.type === 'rope' ? relative > 0.05 : Math.abs(relative) > 0.05) return false
  }
  return true
}

function guideImpulse(ball, bodyA, bodyB, t, nx, ny, impulse) {
  accelerate(ball, -nx * impulse * inverseMass(ball), -ny * impulse * inverseMass(ball))
  accelerate(bodyA, nx * impulse * (1 - t) * inverseMass(bodyA), ny * impulse * (1 - t) * inverseMass(bodyA))
  accelerate(bodyB, nx * impulse * t * inverseMass(bodyB), ny * impulse * t * inverseMass(bodyB))
}

function guideAxis(ball, bodyA, bodyB, t, nx, ny, error, removeVelocity = true) {
  const wc = inverseMass(ball)
  const wa = inverseMass(bodyA)
  const wb = inverseMass(bodyB)
  const ca = 1 - t
  const cb = t
  const weight = wc + ca * ca * wa + cb * cb * wb
  if (!weight) return 0
  translate(ball, -nx * error * wc / weight, -ny * error * wc / weight)
  translate(bodyA, nx * error * ca * wa / weight, ny * error * ca * wa / weight)
  translate(bodyB, nx * error * cb * wb / weight, ny * error * cb * wb / weight)
  if (!removeVelocity) return 0
  const vc = velocity(ball)
  const va = velocity(bodyA)
  const vb = velocity(bodyB)
  const relative = (vc.x - ca * va.x - cb * vb.x) * nx + (vc.y - ca * va.y - cb * vb.y) * ny
  const impulse = relative / weight
  guideImpulse(ball, bodyA, bodyB, t, nx, ny, impulse)
  return impulse
}

function guideConstraint(ball, byId, friction) {
  const rod = byId.get(ball.rodId)
  if (!rod || rod.type !== 'rod' || rod.bodyA === ball.id || rod.bodyB === ball.id) return
  const { a, distance, nx, ny, bodyA, bodyB } = geometry(rod, byId)
  if (distance < EPSILON) return
  const rawT = ((ball.x - a.x) * nx + (ball.y - a.y) * ny) / distance
  const t = clamp(rawT, 0, 1)
  const perpendicularError = (ball.x - a.x) * -ny + (ball.y - a.y) * nx
  const normalImpulse = guideAxis(ball, bodyA, bodyB, t, -ny, nx, perpendicularError)

  // 导轨两端为限位；内部保留沿杆方向的速度。
  const vc = velocity(ball)
  const va = velocity(bodyA)
  const vb = velocity(bodyB)
  const relative = (vc.x - (1 - t) * va.x - t * vb.x) * nx + (vc.y - (1 - t) * va.y - t * vb.y) * ny
  const weight = inverseMass(ball) + (1 - t) ** 2 * inverseMass(bodyA) + t * t * inverseMass(bodyB)
  if (friction && weight) {
    const limit = Math.abs(normalImpulse) * friction
    guideImpulse(ball, bodyA, bodyB, t, nx, ny, clamp(relative / weight, -limit, limit))
  }
  if (rawT < 0 || (rawT <= CONTACT_SLOP && relative < 0)) {
    guideAxis(ball, bodyA, bodyB, 0, nx, ny, Math.min(0, rawT) * distance, relative < 0)
  } else if (rawT > 1 || (rawT >= 1 - CONTACT_SLOP && relative > 0)) {
    guideAxis(ball, bodyA, bodyB, 1, nx, ny, Math.max(0, rawT - 1) * distance, relative > 0)
  }
}

function contactImpulse(a, b, nx, ny, penetration, friction, contactRestitution, verticalSupport = false) {
  const wa = inverseMass(a)
  const wb = inverseMass(b)
  const wy = verticalSupport ? 0 : wb
  const weight = wa + wb * nx * nx + wy * ny * ny
  if (!weight) return
  const correction = Math.max(0, penetration - CONTACT_SLOP) / weight
  translate(a, -nx * correction * wa, -ny * correction * wa)
  translate(b, nx * correction * wb, ny * correction * wy)
  const va = velocity(a)
  const vb = velocity(b)
  const relativeNormal = (vb.x - va.x) * nx + (vb.y - va.y) * ny
  if (relativeNormal >= 0) return
  const restitution = contactRestitution ?? Math.min(clamp(finite(a?.restitution, 0.7), 0, 1), clamp(finite(b?.restitution, a?.restitution ?? 0.7), 0, 1))
  // 非完全弹性的静态接触在低速时静止；物体间碰撞仍严格采用恢复系数。
  const effectiveRestitution = !b && restitution < 1 && relativeNormal >= -15 ? 0 : restitution
  const impulse = -(1 + effectiveRestitution) * relativeNormal / weight
  accelerate(a, -nx * impulse * wa, -ny * impulse * wa)
  accelerate(b, nx * impulse * wb, ny * impulse * wy)
  if (!friction) return
  const tx = -ny
  const ty = nx
  const tangentVelocity = (vb.x - va.x) * tx + (vb.y - va.y) * ty
  const tangentWeight = wa + wb * tx * tx + wy * ty * ty
  if (!tangentWeight) return
  const tangentImpulse = clamp(-tangentVelocity / tangentWeight, -friction * impulse, friction * impulse)
  accelerate(a, -tx * tangentImpulse * wa, -ty * tangentImpulse * wa)
  accelerate(b, tx * tangentImpulse * wb, ty * tangentImpulse * wy)
}

function ballBall(a, b, friction) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const distance = Math.hypot(dx, dy)
  const radius = support(a, 1, 0) + support(b, 1, 0)
  if (distance > radius) return
  contactImpulse(a, b, distance > EPSILON ? dx / distance : 1, distance > EPSILON ? dy / distance : 0, radius - distance, friction)
}

function blockBlock(a, b, friction) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const xOverlap = support(a, 1, 0) + support(b, 1, 0) - Math.abs(dx)
  const yOverlap = support(a, 0, 1) + support(b, 0, 1) - Math.abs(dy)
  if (xOverlap < 0 || yOverlap < 0) return
  if (xOverlap < yOverlap) contactImpulse(a, b, Math.sign(dx) || 1, 0, xOverlap, friction)
  else contactImpulse(a, b, 0, Math.sign(dy) || 1, yOverlap, friction)
}

function ballBlock(ball, block, friction) {
  const halfWidth = support(block, 1, 0)
  const halfHeight = support(block, 0, 1)
  const localX = ball.x - block.x
  const localY = ball.y - block.y
  const closestX = clamp(localX, -halfWidth, halfWidth)
  const closestY = clamp(localY, -halfHeight, halfHeight)
  const dx = closestX - localX
  const dy = closestY - localY
  const distance = Math.hypot(dx, dy)
  const radius = support(ball, 1, 0)
  if (distance > radius) return
  if (distance > EPSILON) {
    contactImpulse(ball, block, dx / distance, dy / distance, radius - distance, friction)
    return
  }
  const xExit = halfWidth - Math.abs(localX)
  const yExit = halfHeight - Math.abs(localY)
  if (xExit < yExit) contactImpulse(ball, block, -(Math.sign(localX) || 1), 0, radius + xExit, friction)
  else contactImpulse(ball, block, 0, -(Math.sign(localY) || 1), radius + yExit, friction)
}

function bodyContacts(bodies, friction) {
  for (let first = 0; first < bodies.length; first += 1) {
    for (let second = first + 1; second < bodies.length; second += 1) {
      const a = bodies[first]
      const b = bodies[second]
      if (!inverseMass(a) && !inverseMass(b)) continue
      if (a.type === 'ball' && b.type === 'ball') ballBall(a, b, friction)
      else if (a.type === 'block' && b.type === 'block') blockBlock(a, b, friction)
      else ballBlock(a.type === 'ball' ? a : b, a.type === 'block' ? a : b, friction)
    }
  }
}

function groundContact(body, ground, previous, friction) {
  if (body.type === 'arc') {
    const base = arcBase(body)
    const left = Math.min(ground.x, ground.x + ground.width)
    const right = Math.max(ground.x, ground.x + ground.width)
    const previousBottom = base.bottom + previous.y - body.cy
    if (base.right < left || base.left > right || base.bottom < ground.y || previousBottom > ground.y + 15) return
    contactImpulse(body, null, 0, 1, base.bottom - ground.y, friction)
    return
  }
  const halfWidth = support(body, 1, 0)
  const halfHeight = support(body, 0, 1)
  const left = Math.min(ground.x, ground.x + ground.width)
  const right = Math.max(ground.x, ground.x + ground.width)
  if (body.x + halfWidth < left || body.x - halfWidth > right) return
  const bottom = body.y + halfHeight
  if (bottom < ground.y || previous.y + halfHeight > ground.y + halfHeight * 0.8) return
  contactImpulse(body, null, 0, 1, bottom - ground.y, friction)
}

function withinArc(degrees, start, sweep) {
  const delta = ((degrees - start) % 360 + 360) % 360
  return delta <= Math.max(0, sweep) + 1e-7 || sweep >= 360
}

function arcContact(body, arc, previous, previousArc, friction, continuous = false, supported = false) {
  const radius = Math.max(1, finite(arc.radius, 160))
  const dx = body.x - arc.cx
  const dy = body.y - arc.cy
  const distance = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  const start = finite(arc.startAngle)
  const sweep = finite(arc.angle, 180)
  if (withinArc(angle, start, sweep)) {
    const radialX = distance > EPSILON ? dx / distance : 1
    const radialY = distance > EPSILON ? dy / distance : 0
    const previousDistance = Math.hypot(previous.x - previousArc.x, previous.y - previousArc.y)
    const oldSigned = previousDistance - radius
    const signed = distance - radius
    const side = Math.sign(oldSigned) || Math.sign(signed) || -1
    const extent = support(body, radialX, radialY) + 3
    const penetration = extent - side * signed
    if (penetration < 0) return
    const restitution = continuous && side < 0 ? 0 : clamp(finite(body.restitution, 0.7), 0, 1)
    contactImpulse(body, arc, -side * radialX, -side * radialY, penetration, friction, restitution, supported && -side * radialY >= 0 && arc.vy >= 0)
    return
  }
  // 开放弧槽的两个端点也有碰撞，避免从端部穿过。
  for (const degrees of [start, start + sweep]) {
    const radians = degrees * Math.PI / 180
    const x = arc.cx + Math.cos(radians) * radius
    const y = arc.cy + Math.sin(radians) * radius
    const pointX = x - body.x
    const pointY = y - body.y
    const pointDistance = Math.hypot(pointX, pointY)
    const nx = pointDistance > EPSILON ? pointX / pointDistance : 0
    const ny = pointDistance > EPSILON ? pointY / pointDistance : 1
    const extent = support(body, nx, ny) + 3
    if (pointDistance <= extent) contactImpulse(body, arc, nx, ny, extent - pointDistance, friction, clamp(finite(body.restitution, 0.7), 0, 1), supported && ny >= 0 && arc.vy >= 0)
  }
}

function rectangleContact(body, rectangle, owner, friction) {
  const centerX = (rectangle.left + rectangle.right) / 2
  const centerY = (rectangle.top + rectangle.bottom) / 2
  const halfWidth = (rectangle.right - rectangle.left) / 2
  const halfHeight = (rectangle.bottom - rectangle.top) / 2
  const dx = centerX - body.x
  const dy = centerY - body.y
  if (body.type === 'block') {
    const overlapX = halfWidth + body.width / 2 - Math.abs(dx)
    const overlapY = halfHeight + body.height / 2 - Math.abs(dy)
    if (overlapX < 0 || overlapY < 0) return
    if (overlapX < overlapY) contactImpulse(body, owner, Math.sign(dx) || 1, 0, overlapX, friction)
    else contactImpulse(body, owner, 0, Math.sign(dy) || 1, overlapY, friction)
    return
  }
  const localX = body.x - centerX
  const localY = body.y - centerY
  const closestX = clamp(localX, -halfWidth, halfWidth)
  const closestY = clamp(localY, -halfHeight, halfHeight)
  const normalX = closestX - localX
  const normalY = closestY - localY
  const distance = Math.hypot(normalX, normalY)
  if (distance > body.radius) return
  if (distance > EPSILON) contactImpulse(body, owner, normalX / distance, normalY / distance, body.radius - distance, friction)
  else {
    const exitX = halfWidth - Math.abs(localX)
    const exitY = halfHeight - Math.abs(localY)
    if (exitX < exitY) contactImpulse(body, owner, -(Math.sign(localX) || 1), 0, body.radius + exitX, friction)
    else contactImpulse(body, owner, 0, -(Math.sign(localY) || 1), body.radius + exitY, friction)
  }
}

function arcShellContacts(body, arc, friction) {
  if (!hasBase(arc)) return
  rectangleContact(body, arcBase(arc), arc, friction)
  // 外立边与水平底座构成槽体外壳；内部圆弧仍由径向接触处理。
  for (const side of ['left', 'right']) {
    const points = [arc.startAngle, arc.startAngle + arc.angle]
    for (const angle of [0, 90, 180, 270]) if (withinArc(angle, arc.startAngle, arc.angle)) points.push(angle)
    const vertices = points.map(degrees => ({ x: arc.cx + arc.radius * Math.cos(degrees * Math.PI / 180), y: arc.cy + arc.radius * Math.sin(degrees * Math.PI / 180) }))
    const extreme = vertices.reduce((best, point) => (side === 'left' ? point.x < best.x : point.x > best.x) ? point : best)
    const base = arcBase(arc)
    if (base.top <= extreme.y) continue
    const rectangle = side === 'left'
      ? { left: base.left, right: extreme.x - 3, top: extreme.y, bottom: base.top }
      : { left: extreme.x + 3, right: base.right, top: extreme.y, bottom: base.top }
    rectangleContact(body, rectangle, arc, friction)
  }
}

function arcBaseContacts(arcs, friction) {
  for (let first = 0; first < arcs.length; first += 1) {
    const a = arcs[first]
    if (!hasBase(a)) continue
    for (let second = first + 1; second < arcs.length; second += 1) {
      const b = arcs[second]
      if (!hasBase(b) || (!inverseMass(a) && !inverseMass(b))) continue
      const boxA = arcBase(a)
      const boxB = arcBase(b)
      const overlapX = Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left)
      const overlapY = Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top)
      if (overlapX < 0 || overlapY < 0) continue
      if (overlapX < overlapY) contactImpulse(a, b, Math.sign(boxB.left + boxB.right - boxA.left - boxA.right) || 1, 0, overlapX, friction)
      else contactImpulse(a, b, 0, Math.sign(boxB.top + boxB.bottom - boxA.top - boxA.bottom) || 1, overlapY, friction)
    }
  }
}

function pairKey(body, arc) {
  return JSON.stringify([body.id, arc.id])
}

function continuousInnerContacts(solids, arcs) {
  const result = []
  for (const body of solids) {
    if (body.type !== 'ball' || body.rodId) continue
    for (const arc of arcs) {
      const radius = arc.radius - body.radius - 3
      if (radius <= 0 || (!inverseMass(body) && !inverseMass(arc))) continue
      const dx = body.x - arc.cx
      const dy = body.y - arc.cy
      const distance = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx) * 180 / Math.PI
      if (!withinArc(angle, arc.startAngle, arc.angle) || Math.abs(distance - radius) > CONTACT_TOLERANCE) continue
      const nx = dx / distance
      const ny = dy / distance
      const relativeX = body.vx - arc.vx
      const relativeY = body.vy - arc.vy
      const normal = relativeX * nx + relativeY * ny
      // 几何误差引起的法向方向误差约为 slop / R；此界限不随碰撞恢复系数放大。
      const tolerance = CONTACT_TOLERANCE * Math.max(1, Math.hypot(relativeX, relativeY)) / radius
      const key = pairKey(body, arc)
      if (Math.abs(normal) > tolerance) continue
      const tangent = -relativeX * ny + relativeY * nx
      const progress = ((angle - arc.startAngle) % 360 + 360) % 360
      if ((progress < 1e-7 && tangent < 0) || (Math.abs(progress - arc.angle) < 1e-7 && tangent > 0)) continue
      result.push({ body, arc, radius, nx, ny, tangent, key })
    }
  }
  return result
}

function supportedArcs(arcs, grounds) {
  return new Set(arcs.filter(arc => {
    if (isFixed(arc) || arc.vy < 0) return false
    const base = arcBase(arc)
    return grounds.some(ground => Math.abs(base.bottom - ground.y) <= CONTACT_TOLERANCE && base.right > Math.min(ground.x, ground.x + ground.width) && base.left < Math.max(ground.x, ground.x + ground.width))
  }).map(arc => arc.id))
}

function boundaryEvent(solids, arcs, activeContacts, oldVelocity, acceleration, step) {
  const active = new Map(activeContacts.map(contact => [contact.key, contact]))
  let earliest = null
  for (const body of solids) {
    if (body.type !== 'ball' || body.rodId) continue
    for (const arc of arcs) {
      const radius = arc.radius - body.radius - 3
      if (radius <= 0 || (!inverseMass(body) && !inverseMass(arc))) continue
      const contact = active.get(pairKey(body, arc))
      const x = body.x - arc.cx
      const y = body.y - arc.cy
      const bv = oldVelocity.get(body.id)
      const av = oldVelocity.get(arc.id)
      const ba = acceleration.get(body.id)
      const aa = acceleration.get(arc.id)
      const vx = bv.x - av.x
      const vy = bv.y - av.y
      const ax = ba.x - aa.x
      const ay = ba.y - aa.y
      for (const [degrees, direction] of [[arc.startAngle, -1], [arc.startAngle + arc.angle, 1]]) {
        const radians = degrees * Math.PI / 180
        const nx = Math.cos(radians)
        const ny = Math.sin(radians)
        const tangentPosition = -x * ny + y * nx
        const tangentVelocity = -vx * ny + vy * nx
        const tangentAcceleration = -ax * ny + ay * nx
        const endPosition = tangentPosition + tangentVelocity * step + tangentAcceleration * step * step
        const exiting = contact && tangentPosition * direction < -EPSILON && endPosition * direction >= 0
        const entering = !contact && tangentPosition * direction > EPSILON && endPosition * direction <= 0
        if ((!exiting && !entering) || x * nx + y * ny <= 0) continue
        let low = 0
        let high = step
        // 与半隐式积分使用同一条预测轨迹，定位越过弧端的时刻。
        for (let iteration = 0; iteration < 32; iteration += 1) {
          const middle = (low + high) / 2
          const position = tangentPosition + tangentVelocity * middle + tangentAcceleration * middle * middle
          if ((position * direction < 0) === Boolean(exiting)) low = middle
          else high = middle
        }
        const time = (low + high) / 2
        const radialPosition = (x + vx * time + ax * time * time) * nx + (y + vy * time + ay * time * time) * ny
        const normalVelocity = (vx + ax * time) * nx + (vy + ay * time) * ny
        if (entering && (Math.abs(radialPosition - radius) > CONTACT_TOLERANCE || Math.abs(normalVelocity) > 1e-7 * Math.max(1, Math.hypot(vx, vy)))) continue
        if (time > EPSILON && (!earliest || time < earliest.time)) earliest = { body, arc, radius, nx, ny, time, entering }
      }
    }
  }
  return earliest
}

function resolveBoundaryEvent(event, supports) {
  const { body, arc, radius, nx, ny } = event
  const wa = inverseMass(body)
  const wb = inverseMass(arc)
  const wy = supports.has(arc.id) && arc.vy >= 0 ? 0 : wb
  // 仅已贴轨离口或精确擦边进入的事件使用端点约束；普通端帽碰撞不走这里。
  const errorX = body.x - arc.cx - radius * nx
  const errorY = body.y - arc.cy - radius * ny
  if (wa + wb) { translate(body, -errorX * wa / (wa + wb), 0); translate(arc, errorX * wb / (wa + wb), 0) }
  if (wa + wy) { translate(body, 0, -errorY * wa / (wa + wy)); translate(arc, 0, errorY * wy / (wa + wy)) }
  const weight = wa + wb * nx * nx + wy * ny * ny
  if (!weight) return
  const relativeNormal = (body.vx - arc.vx) * nx + (body.vy - arc.vy) * ny
  const impulse = relativeNormal / weight
  accelerate(body, -nx * impulse * wa, -ny * impulse * wa)
  accelerate(arc, nx * impulse * wb, ny * impulse * wy)
}

function timestep(bodies, connectors, byId, totalTime) {
  let maximum = 1 / 240
  for (const body of bodies) {
    if (!inverseMass(body) || body.type === 'joint') continue
    const size = body.type === 'ball' ? support(body, 1, 0) : Math.min(support(body, 1, 0), support(body, 0, 1))
    const speed = Math.hypot(body.vx, body.vy)
    if (speed > EPSILON) maximum = Math.min(maximum, size / (speed * 3))
  }
  for (const connector of connectors) {
    if (connector.type !== 'spring') continue
    const effectiveWeight = inverseMass(byId.get(connector.bodyA)) + inverseMass(byId.get(connector.bodyB))
    const stiffness = Math.max(0, finite(connector.stiffness, 40))
    const damping = Math.max(0, finite(connector.damping))
    if (effectiveWeight * stiffness > EPSILON) maximum = Math.min(maximum, 0.15 / Math.sqrt(stiffness * effectiveWeight))
    if (effectiveWeight * damping > EPSILON) maximum = Math.min(maximum, 0.25 / (damping * effectiveWeight))
  }
  for (const body of bodies) {
    if (body.type !== 'ball') continue
    for (const arc of bodies.filter(candidate => candidate.type === 'arc')) {
      const radius = arc.radius - body.radius - 3
      if (radius <= 0 || Math.abs(Math.hypot(body.x - arc.cx, body.y - arc.cy) - radius) > CONTACT_TOLERANCE) continue
      const speed = Math.hypot(body.vx - arc.vx, body.vy - arc.vy)
      if (speed > EPSILON) maximum = Math.min(maximum, MAX_CONTACT_ANGLE * radius / speed)
    }
  }
  return Math.min(totalTime, Math.max(1 / 20000, maximum))
}

/** 固定小步积分：平动刚体、接触冲量、无质量连接件与滑动导轨。 */
export function integrate(objects = [], environment = {}, dt = 0) {
  const next = objects.map((object) => ({ ...object }))
  if (!Number.isFinite(dt) || dt <= 0) return next
  const byId = new Map(next.map((object) => [object.id, object]))
  const pins = fixedRodPins(next, byId)
  const originalFixed = new Map()
  for (const [id, point] of pins) {
    const body = byId.get(id)
    originalFixed.set(id, { present: Object.hasOwn(body, 'fixed'), value: body.fixed })
    if (body.type === 'arc') { body.cx = point.x; body.cy = point.y }
    else { body.x = point.x; body.y = point.y }
    // 固定杆提供外部支撑，但不覆盖用户设置的物体固定状态。
    body.fixed = true
    body.vx = 0
    body.vy = 0
  }
  const bodies = next.filter(isBody)
  const solids = bodies.filter(object => object.type === 'ball' || object.type === 'block')
  const connectors = next.filter((object) => ['rod', 'rope', 'spring'].includes(object.type))
  const jointConstraints = jointConstraintGroup(connectors, bodies)
  const arcs = next.filter((object) => object.type === 'arc')
  const grounds = environment.ground ? next.filter((object) => object.type === 'ground') : []
  const guides = bodies.filter((body) => body.type === 'ball' && body.rodId)
  const friction = environment.friction ? clamp(finite(environment.frictionValue, 0.2), 0, 2) : 0
  const gravity = environment.gravity ? finite(environment.gravityValue, 9.8) * SCALE : 0
  for (const body of bodies) {
    if (body.type === 'arc') { body.cx = finite(body.cx); body.cy = finite(body.cy) }
    else { body.x = finite(body.x); body.y = finite(body.y) }
    body.vx = isFixed(body) ? 0 : finite(body.vx)
    body.vy = isFixed(body) ? 0 : finite(body.vy)
  }
  // 过长帧间隔由调用方拆分；此上限避免休眠恢复后执行无界积分。
  let remaining = Math.min(dt, 0.25)
  while (remaining > EPSILON) {
    let step = timestep(bodies, connectors, byId, remaining)
    const previous = new Map(bodies.map((body) => [body.id, position(body)]))
    const oldVelocity = new Map(bodies.map(body => [body.id, velocity(body)]))
    let continuous = continuousInnerContacts(solids, arcs)
    // 光滑地面可将向下支持约束合并到接触有效质量，避免逐次抵消时人为耗能。
    // 粗糙地面仍保留完整冲量路径，让槽受到的下压力参与库仑摩擦。
    const supports = friction ? new Set() : supportedArcs(arcs, grounds)
    springForces(connectors, byId, step)
    for (const body of bodies) {
      if (!inverseMass(body)) continue
      body.vy += gravity * step
      if (supports.has(body.id)) {
        if (body.vy >= 0) body.vy = 0
        else supports.delete(body.id)
      }
    }
    const acceleration = new Map(bodies.map(body => {
      const old = oldVelocity.get(body.id)
      return [body.id, { x: (body.vx - old.x) / step, y: (body.vy - old.y) / step }]
    }))
    // 单侧轨道只能推不能拉：外力使物体离开内壁时，立即释放持续接触。
    continuous = continuous.filter(contact => {
      const ba = acceleration.get(contact.body.id)
      const aa = acceleration.get(contact.arc.id)
      return contact.tangent * contact.tangent / contact.radius + (ba.x - aa.x) * contact.nx + (ba.y - aa.y) * contact.ny >= -EPSILON
    })
    const event = boundaryEvent(solids, arcs, continuous, oldVelocity, acceleration, step)
    if (event) {
      step = event.time
      for (const body of bodies) {
        const old = oldVelocity.get(body.id)
        const change = acceleration.get(body.id)
        body.vx = old.x + change.x * step
        body.vy = old.y + change.y * step
      }
    }
    for (const body of bodies) translate(body, body.vx * step, body.vy * step)
    if (event) resolveBoundaryEvent(event, supports)
    const continuousKeys = new Set(continuous.map(contact => contact.key))
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      for (const connector of connectors) if (connector.type !== 'spring') distanceConstraint(connector, byId)
      // 只加密包含轻连接点的约束链，并在满足长度和相对速度误差时提前结束。
      // 接触、弧槽及无关元件仍使用原来的迭代次数，避免整幅场景反复求解。
      for (let pass = 0; pass < 128 && jointConstraints.length; pass += 1) {
        if (pass % 8 === 0 && jointConstraintsSettled(jointConstraints, byId)) break
        for (const connector of jointConstraints) distanceConstraint(connector, byId)
      }
      for (const ball of guides) guideConstraint(ball, byId, friction)
      bodyContacts(solids, friction)
      arcBaseContacts(arcs, friction)
      for (const body of solids) {
        for (const arc of arcs) {
          if (!inverseMass(body) && !inverseMass(arc)) continue
          arcContact(body, arc, previous.get(body.id), previous.get(arc.id), friction, continuousKeys.has(pairKey(body, arc)), supports.has(arc.id))
          arcShellContacts(body, arc, friction)
        }
      }
      // 连接点有质量但没有碰撞体积，接触只作用于小球、滑块和槽体。
      for (const body of bodies) if (body.type !== 'joint' && inverseMass(body)) for (const ground of grounds) groundContact(body, ground, previous.get(body.id), friction)
    }
    remaining -= step
  }
  for (const [id, original] of originalFixed) {
    const body = byId.get(id)
    if (original.present) body.fixed = original.value
    else delete body.fixed
  }
  return next
}

/** 返回 SI 制的系统动量、动能与总质量，固定物体速度按零计。 */
export function measure(objects = []) {
  let px = 0
  let py = 0
  let kineticEnergy = 0
  let totalMass = 0
  const pins = fixedRodPins(objects, new Map(objects.map(object => [object.id, object])))
  for (const body of objects) {
    if (!isBody(body)) continue
    const bodyMass = mass(body)
    const { x, y } = pins.has(body.id) ? { x: 0, y: 0 } : velocity(body)
    const vx = x / SCALE
    const vy = y / SCALE
    px += bodyMass * vx
    py += bodyMass * vy
    kineticEnergy += bodyMass * (vx * vx + vy * vy) / 2
    totalMass += bodyMass
  }
  return { px, py, kineticEnergy, totalMass }
}
