import test from 'node:test'
import assert from 'node:assert/strict'
import { endpoints, integrate, measure } from '../src/physics.js'

const free = { gravity: false, friction: false, ground: false }
const gravity = { ...free, gravity: true, gravityValue: 9.8 }
const ball = (id, x, y, extra = {}) => ({ id, type: 'ball', x, y, radius: 10, mass: 1, vx: 0, vy: 0, fixed: false, restitution: 1, ...extra })
const joint = (id, x, y, extra = {}) => ({ id, type: 'joint', x, y, mass: 0.01, vx: 0, vy: 0, fixed: false, restitution: 0, ...extra })
const rod = (id, extra = {}) => ({ id, type: 'rod', ax: 0, ay: 0, bx: 100, by: 0, bodyA: '', bodyB: '', length: 100, fixed: true, ...extra })
const rope = (id, extra = {}) => ({ id, type: 'rope', ax: 100, ay: 0, bx: 160, by: 80, bodyA: '', bodyB: '', length: 100, ...extra })
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`)

function evolve(objects, seconds, environment = free) {
  let result = objects
  for (let index = 0; index < Math.round(seconds * 120); index += 1) result = integrate(result, environment, 1 / 120)
  return result
}

test('fixed rod endpoints use captured world anchors rather than body positions', () => {
  const fixed = rod('rod', { bodyA: 'first', bodyB: 'second' })
  const objects = [fixed, ball('first', 20, 30), joint('second', 140, 50)]
  assert.deepEqual(endpoints(fixed, objects), { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })
  assert.deepEqual(endpoints({ ...fixed, fixed: false }, objects), { a: { x: 20, y: 30 }, b: { x: 140, y: 50 } })
})

test('fixed rod supports a shared joint while a hanging rope and ball still swing', () => {
  const objects = [
    rod('support', { bodyB: 'node' }),
    joint('node', 100, 0),
    rope('string', { bodyA: 'node', bodyB: 'weight' }),
    ball('weight', 160, 80),
    ball('unrelated', 500, -100, { vx: 50 }),
  ]
  const original = structuredClone(objects)
  const result = evolve(objects, 0.5, gravity)
  const node = result[1]
  near(node.x, 100)
  near(node.y, 0)
  near(node.vx, 0)
  near(node.vy, 0)
  assert.equal(node.fixed, false)
  assert.ok(result[3].y > 85)
  assert.ok(result[3].x < 155)
  assert.ok(Math.hypot(result[3].x - node.x, result[3].y - node.y) <= 100.01)
  near(result[4].x, 525)
  near(result[4].vy, 490)
  assert.deepEqual(endpoints(result[0], result).b, endpoints(result[2], result).a)
  assert.deepEqual(objects, original)
})

test('unlocking a rod releases its shared endpoint without changing the body fixed flag', () => {
  const start = [rod('support', { bodyB: 'node' }), joint('node', 100, 0), rope('string', { bodyA: 'node', bodyB: 'weight' }), ball('weight', 160, 80)]
  const held = evolve(start, 0.2, gravity)
  const released = held.map(object => object.id === 'support' ? { ...object, fixed: false } : object)
  const result = evolve(released, 0.3, gravity)
  assert.equal(result[1].fixed, false)
  assert.ok(result[1].y > 5)
  near(Math.hypot(result[1].x, result[1].y), 100, 0.05)
  assert.equal(start[0].fixed, true)
})

test('a bead can slide along a fixed rod whose attached endpoint nodes stay pinned', () => {
  const length = Math.hypot(200, 100)
  const start = [rod('guide', { bx: 200, by: 100, length, bodyA: 'left', bodyB: 'right' }), joint('left', 0, 0), joint('right', 200, 100), ball('bead', 60, 30, { rodId: 'guide' })]
  const result = evolve(start, 0.3, gravity)
  assert.ok(result[3].x > 65 && result[3].y > 32)
  near(result[3].y, result[3].x / 2, 0.01)
  assert.deepEqual([result[1].x, result[1].y, result[2].x, result[2].y], [0, 0, 200, 100])
  assert.equal(result[1].fixed, false)
  assert.equal(result[2].fixed, false)
})

test('fixed rods pin balls blocks and trough centers while springs remain able to move other bodies', () => {
  for (const attached of [
    ball('attached', 170, 20, { vx: 150, vy: -80 }),
    { id: 'attached', type: 'block', x: 170, y: 20, width: 20, height: 20, mass: 2, vx: 150, vy: -80, fixed: false, restitution: 0 },
    { id: 'attached', type: 'arc', cx: 170, cy: 20, radius: 40, startAngle: 0, angle: 180, mass: 5, vx: 150, vy: -80, fixed: false, restitution: 0 },
  ]) {
    const start = [rod('fixed', { bodyB: 'attached' }), attached, ball('weight', 260, -100), { id: 'spring', type: 'spring', ax: 100, ay: 0, bx: 260, by: -100, bodyA: 'attached', bodyB: 'weight', length: 100, stiffness: 20, damping: 0 }]
    const result = evolve(start, 0.2, gravity)
    near(result[1].cx ?? result[1].x, 100)
    near(result[1].cy ?? result[1].y, 0)
    near(result[1].vx, 0)
    near(result[1].vy, 0)
    assert.equal(result[1].fixed, false)
    assert.ok(result[2].vx < -1)
    assert.equal(attached.vx, 150)
  }
})

test('measure ignores stale velocities of endpoints held by fixed rods', () => {
  const moving = ball('free', 400, 0, { mass: 2, vx: 300, vy: -400 })
  const held = joint('node', 100, 0, { mass: 0.01, vx: 9999, vy: 500 })
  const objects = [rod('fixed', { bodyB: 'node' }), held, moving]
  const metrics = measure(objects)
  near(metrics.px, 6)
  near(metrics.py, -8)
  near(metrics.kineticEnergy, 25)
  near(metrics.totalMass, 2.01)
  assert.equal(held.vx, 9999)
})

test('pinned bodies preserve explicit fixed state or the absence of a fixed property', () => {
  const unmarked = joint('unmarked', 100, 0)
  delete unmarked.fixed
  const marked = ball('marked', 0, 0, { fixed: true })
  const start = [rod('fixed', { bodyA: 'marked', bodyB: 'unmarked' }), marked, unmarked]
  const result = evolve(start, 0.2, gravity)
  assert.equal(result[1].fixed, true)
  assert.equal(Object.hasOwn(result[2], 'fixed'), false)
  assert.deepEqual(Object.keys(result[2]).sort(), Object.keys(unmarked).sort())
  assert.equal(JSON.stringify(result).includes('pin'), false)
})

test('multiple fixed rods support the same point without moving their anchors', () => {
  const rods = [rod('first', { bodyB: 'node' }), rod('second', { ax: 100, ay: 0, bx: 100, by: -100, bodyA: 'node' })]
  const original = [...rods, joint('node', 100, 0, { vx: 200 })]
  const result = evolve(original, 0.3, gravity)
  assert.deepEqual(endpoints(result[0], result).b, endpoints(result[1], result).a)
  near(result[2].x, 100)
  near(result[2].y, 0)
  near(result[2].vx, 0)
  assert.deepEqual(result.slice(0, 2), rods)
})

test('invalid or missing endpoint references do not pin unrelated objects or introduce NaN', () => {
  const malformed = rod('invalid', { ax: NaN, ay: Infinity, bodyA: 'missing', bodyB: 'rope' })
  const objects = [malformed, rope('rope'), ball('free', 400, 0, { vx: 100 })]
  const result = evolve(objects, 0.1)
  near(result[2].x, 410)
  assert.deepEqual(endpoints(malformed, objects).a, { x: 0, y: 0 })
  const conflicting = [rod('first', { bodyB: 'node' }), rod('second', { bx: 500, by: 200, bodyB: 'node' }), joint('node', 100, 0)]
  const [,, pinned] = evolve(conflicting, 0.1, gravity)
  near(pinned.x, 100)
  near(pinned.y, 0)
})

test('zero and invalid time steps remain non-mutating clones without applying fixed rod edits', () => {
  const input = [rod('fixed', { bodyB: 'node' }), joint('node', 150, 20, { vx: 100 })]
  for (const dt of [0, -1, NaN, Infinity]) {
    const result = integrate(input, gravity, dt)
    assert.deepEqual(result, input)
    assert.notEqual(result, input)
    assert.notEqual(result[1], input[1])
  }
})
