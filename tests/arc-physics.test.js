import test from 'node:test'
import assert from 'node:assert/strict'
import { arcBase } from '../src/arcGeometry.js'
import { endpoints, integrate, measure } from '../src/physics.js'

const free = { gravity: false, friction: false, ground: false }
const smooth = { gravity: true, gravityValue: 9.8, friction: false, ground: true }
const trough = (id = 'trough', overrides = {}) => ({ id, type: 'arc', cx: 0, cy: 0, radius: 100, startAngle: 0, angle: 180, mass: 5, vx: 0, vy: 0, restitution: 0, fixed: false, ...overrides })
const ball = (id, x, y, overrides = {}) => ({ id, type: 'ball', x, y, radius: 10, mass: 1, vx: 0, vy: 0, restitution: 1, fixed: false, ...overrides })
const block = (id, x, y, overrides = {}) => ({ id, type: 'block', x, y, width: 20, height: 20, mass: 1, vx: 0, vy: 0, restitution: 1, fixed: false, ...overrides })
const floor = { id: 'floor', type: 'ground', x: -1000, y: 124, width: 3000 }
const evolve = (objects, seconds, environment = free) => {
  let result = objects
  for (let index = 0; index < Math.round(seconds * 120); index += 1) result = integrate(result, environment, 1 / 120)
  return result
}
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`)

test('movable trough translates freely and contributes SI momentum and energy', () => {
  const original = [trough('track', { cx: 200, cy: 100, vx: 50, vy: -20, mass: 4 })]
  const [result] = evolve(original, 1)
  near(result.cx, 250)
  near(result.cy, 80)
  assert.equal(original[0].cx, 200)
  assert.equal('x' in result, false)
  const metrics = measure([result])
  near(metrics.px, 2)
  near(metrics.py, -0.8)
  near(metrics.kineticEnergy, 0.58)
  near(metrics.totalMass, 4)
})

test('flat bottom stays on the floor while frictionless horizontal motion continues', () => {
  const [result] = evolve([trough('track', { vx: 120 }), floor], 2, smooth)
  near(arcBase(result).bottom, floor.y, 0.01)
  near(result.cy, 0, 0.01)
  near(result.cx, 240)
  near(result.vx, 120)
  near(result.vy, 0)
})

test('ground contact friction slows the trough but does not create air resistance', () => {
  const rough = { ...smooth, friction: true, frictionValue: 0.25 }
  const [supported] = evolve([trough('track', { vx: 120 }), floor], 1, rough)
  near(supported.vx, 0, 0.01)
  const [airborne] = evolve([trough('track', { cy: -1000, vx: 120 }), floor], 0.2, rough)
  near(airborne.vx, 120)
})

test('disabled or finite ground lets a trough fall instead of fixing it to a hidden floor', () => {
  const [disabled] = evolve([trough(), floor], 0.4, { ...smooth, ground: false })
  assert.ok(disabled.cy > 70)
  near(disabled.vy, 392, 1e-6)
  const [outside] = evolve([trough('track', { cx: 1000 }), { ...floor, x: 0, width: 100 }], 0.4, smooth)
  assert.ok(outside.cy > 70)
})

test('vertical tangent release transfers reaction to the moving trough and preserves horizontal momentum', () => {
  const start = [trough('track', { cx: 200 }), ball('ball', 113, 0, { restitution: 0 }), floor]
  const result = evolve(start, 0.45, smooth)
  assert.ok(result[0].cx < 199, `Trough did not move left: ${result[0].cx}`)
  assert.ok(result[1].x > 114, `Ball did not move right: ${result[1].x}`)
  near(measure(result).px, 0, 1e-8)
  near(arcBase(result[0]).bottom, floor.y, 0.01)
})

test('elastic impact transfers equal opposite impulse to a free trough', () => {
  const start = [trough(), ball('ball', 70, 0, { vx: 100 })]
  const result = evolve(start, 0.4)
  near(result[1].vx, -200 / 3)
  near(result[0].vx, 100 / 3)
  near(measure(result).px, measure(start).px)
  near(measure(result).kineticEnergy, measure(start).kineticEnergy)
  near(measure(result).py, 0)
})

test('moving trough collides with a fixed ball using relative velocity', () => {
  const result = evolve([trough('track', { vx: -100 }), ball('fixed', 70, 0, { fixed: true })], 0.4)
  near(result[0].vx, 100)
  near(result[1].x, 70)
})

test('fixed and legacy troughs remain static despite gravity and collision reaction', () => {
  const fixed = trough('track', { fixed: true, vx: 100 })
  const result = evolve([fixed, ball('ball', 70, 0, { vx: 100 })], 0.4)
  near(result[0].cx, 0)
  near(result[0].vx, 0)
  near(result[1].vx, -100)
  const legacy = { id: 'legacy', type: 'arc', cx: 10, cy: 20, radius: 100, startAngle: 0, angle: 180 }
  const [unchanged] = evolve([legacy], 0.3, smooth)
  near(unchanged.cx, 10)
  near(unchanged.cy, 20)
})

test('horizontal bases of two troughs collide and preserve momentum', () => {
  const start = [trough('a', { vx: 100 }), trough('b', { cx: 230 })]
  const result = evolve(start, 0.3)
  assert.ok(arcBase(result[0]).right <= arcBase(result[1]).left + 0.01)
  near(result[0].vx, 50)
  near(result[1].vx, 50)
  near(measure(result).px, measure(start).px)
})

test('balls and blocks strike the solid flat base and outer side walls', () => {
  for (const body of [ball('body', 0, 155, { vy: -100 }), block('body', 0, 155, { vy: -100 })]) {
    const start = [trough(), body]
    const result = evolve(start, 0.4)
    near(measure(result).py, measure(start).py)
    assert.ok(result[0].vy < 0)
    assert.ok(result[1].y >= arcBase(result[0]).bottom + 9.99)
  }
  for (const side of [-1, 1]) {
    const start = [trough(), ball('body', 140 * side, 40, { vx: -100 * side })]
    const result = evolve(start, 0.3)
    near(measure(result).px, measure(start).px)
    assert.ok(result[0].vx * side < 0)
  }
})

test('rod, rope and spring can resolve and move trough endpoint attachments', () => {
  for (const type of ['rod', 'rope', 'spring']) {
    const start = [trough('track', { vx: 100 }), ball('body', 0, -200), { id: 'connector', type, ax: 0, ay: 0, bx: 0, by: -200, bodyA: 'track', bodyB: 'body', length: type === 'spring' ? 150 : 200, stiffness: 40, damping: 0 }]
    const initialMomentum = measure(start)
    const result = evolve(start, 0.3)
    const ends = endpoints(result[2], result)
    assert.deepEqual(ends.a, { x: result[0].cx, y: result[0].cy })
    near(measure(result).px, initialMomentum.px)
    near(measure(result).py, initialMomentum.py)
    assert.ok(Math.abs(result[1].vx) + Math.abs(result[1].vy) > 0)
    if (type !== 'spring') near(Math.hypot(ends.a.x - ends.b.x, ends.a.y - ends.b.y), 200, 0.02)
  }
})

test('partial rotated trough uses the actual horizontal base extrema', () => {
  const track = trough('track', { startAngle: 40, angle: 70, radius: 80, cy: 30, vx: 50 })
  const floorY = arcBase(track).bottom
  const [result] = evolve([track, { ...floor, y: floorY }], 0.5, smooth)
  near(arcBase(result).bottom, floorY, 0.01)
  near(result.vx, 50)
  near(result.cx, 25)
})
