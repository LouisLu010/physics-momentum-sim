import test from 'node:test'
import assert from 'node:assert/strict'
import { endpoints, integrate, measure } from '../src/physics.js'

const free = { gravity: false, friction: false, ground: false }
const gravity = { ...free, gravity: true, gravityValue: 9.8 }
const joint = (id, x, y, overrides = {}) => ({ id, type: 'joint', x, y, mass: 0.01, vx: 0, vy: 0, fixed: false, restitution: 0, ...overrides })
const ball = (id, x, y, overrides = {}) => ({ id, type: 'ball', x, y, radius: 10, mass: 1, vx: 0, vy: 0, fixed: false, restitution: 1, ...overrides })
const connector = (id, type, overrides) => ({ id, type, ax: 0, ay: 0, bx: 100, by: 0, bodyA: '', bodyB: '', length: 100, stiffness: 20, damping: 0, ...overrides })
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`)

function evolve(objects, seconds, environment = free) {
  let result = objects
  for (let index = 0; index < Math.round(seconds * 120); index += 1) result = integrate(result, environment, 1 / 120)
  return result
}

function length(object, objects) {
  const { a, b } = endpoints(object, objects)
  return Math.hypot(a.x - b.x, a.y - b.y)
}

test('joint endpoints resolve shared position and include their explicit mass in SI measurements', () => {
  const node = joint('node', 80, 60, { mass: 0.01, vx: 300, vy: -400 })
  const rod = connector('rod', 'rod', { bodyB: node.id })
  const rope = connector('rope', 'rope', { bodyA: node.id, bx: 180, by: 60 })
  assert.deepEqual(endpoints(rod, [node, rod, rope]).b, { x: 80, y: 60 })
  assert.deepEqual(endpoints(rope, [node, rod, rope]).a, { x: 80, y: 60 })
  assert.deepEqual(measure([node, rod, rope]), { px: 0.03, py: -0.04, kineticEnergy: 0.125, totalMass: 0.01 })
  near(measure([joint('small', 0, 0, { mass: 0.001, vx: 100 })]).px, 0.001)
})

test('a rod-joint-rope pendulum swings while both connector lengths remain constrained', () => {
  const original = [joint('node', 80, 60), ball('weight', 160, 120), connector('rod', 'rod', { bodyB: 'node' }), connector('rope', 'rope', { bodyA: 'node', bodyB: 'weight' })]
  const result = evolve(original, 1, gravity)
  assert.ok(result[1].y > original[1].y + 10)
  assert.ok(result[0].x < original[0].x)
  near(length(result[2], result), 100, 0.1)
  assert.ok(length(result[3], result) <= 100.1)
  assert.deepEqual(endpoints(result[2], result).b, endpoints(result[3], result).a)
  assert.equal(original[0].x, 80)
})

test('a free rod-joint-rope chain transmits tension and conserves horizontal and vertical momentum', () => {
  const start = [ball('left', 0, 0, { vx: -80, vy: -20 }), joint('node', 100, 0), ball('right', 200, 0, { mass: 2, vx: 100, vy: 30 }), connector('rod', 'rod', { bodyA: 'left', bodyB: 'node' }), connector('rope', 'rope', { bodyA: 'node', bodyB: 'right' })]
  const result = evolve(start, 1)
  near(measure(result).px, measure(start).px, 1e-8)
  near(measure(result).py, measure(start).py, 1e-8)
  near(length(result[3], result), 100, 0.1)
  assert.ok(length(result[4], result) <= 100.1)
  assert.ok(result[0].vx > start[0].vx + 10)
  assert.ok(result[2].vx < start[2].vx - 10)
})

test('a rope attached to a joint remains slack when its endpoints approach', () => {
  const original = [joint('node', 0, 0, { fixed: true }), ball('weight', 80, 0, { vx: -50 }), connector('rope', 'rope', { bodyA: 'node', bodyB: 'weight', length: 100 })]
  const result = evolve(original, 0.5)
  near(result[1].x, 55)
  near(result[1].vx, -50)
  near(result[0].x, 0)
})

test('spring force through a shared joint moves the coupled body with finite state and conserved momentum', () => {
  const original = [joint('node', 100, 0), ball('weight', 200, 0), ball('other', -50, 0, { mass: 2 }), connector('rod', 'rod', { bodyA: 'node', bodyB: 'weight' }), connector('spring', 'spring', { bodyA: 'other', bodyB: 'node', length: 100, stiffness: 40, damping: 0.1 })]
  const result = evolve(original, 0.2)
  for (const object of result.filter(item => ['ball', 'joint'].includes(item.type))) {
    for (const key of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(object[key]))
  }
  assert.ok(result[1].vx < -1)
  assert.ok(result[2].vx > 1)
  near(length(result[3], result), 100, 0.01)
  near(measure(result).px, 0, 1e-8)
})

test('joint particles have no hidden collision volume or ground friction', () => {
  const node = joint('node', 0, 0, { vx: 100 })
  const wall = ball('fixed', 50, 0, { fixed: true, radius: 30 })
  const floor = { id: 'floor', type: 'ground', x: -1000, y: 50, width: 2000 }
  const result = evolve([node, wall, floor], 1, { ...gravity, ground: true, friction: true, frictionValue: 1 })
  near(result[0].x, 100)
  near(result[0].vx, 100)
  near(result[0].vy, 980)
  assert.ok(result[0].y > 400)
  const suspended = evolve([joint('node', 100, 0), connector('rod', 'rod', { bodyB: 'node' }), floor], 0.8, { ...gravity, ground: true })
  near(Math.hypot(suspended[0].x, suspended[0].y), 100, 0.01)
})

test('rod guide reactions can be carried by joint endpoints', () => {
  const start = [joint('a', 0, 0, { mass: 0.1 }), joint('b', 200, 0, { mass: 0.1 }), ball('bead', 100, 0, { rodId: 'rod', vy: 100 }), connector('rod', 'rod', { bodyA: 'a', bodyB: 'b', length: 200 })]
  const result = evolve(start, 0.2)
  near(measure(result).py, 1, 1e-7)
  assert.ok(result[0].vy > 0 && result[1].vy > 0)
  near(result[2].y, (result[0].y + result[1].y) / 2, 0.01)
})

test('very light spring junction stays finite at the supported mass minimum', () => {
  const start = [joint('node', 150, 0, { mass: 0.001 }), connector('spring', 'spring', { bodyB: 'node', length: 100, stiffness: 1000, damping: 1 })]
  const [node] = evolve(start, 0.1)
  for (const key of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(node[key]))
  assert.ok(Math.abs(node.x - 100) < 2)
})

test('three-link rod and rope chains converge with minimum-mass nodes at both frame sizes', () => {
  const makeChain = () => [
    joint('first', 60, 80, { mass: 0.001 }),
    joint('second', 120, 160, { mass: 0.001 }),
    ball('weight', 180, 240),
    connector('rod-a', 'rod', { bodyB: 'first' }),
    connector('rod-b', 'rod', { bodyA: 'first', bodyB: 'second' }),
    connector('rope', 'rope', { bodyA: 'second', bodyB: 'weight' }),
  ]
  const results = []
  for (const dt of [1 / 120, 1 / 30]) {
    let objects = makeChain()
    for (let step = 0; step < Math.round(0.5 / dt); step += 1) {
      objects = integrate(objects, gravity, dt)
      for (const constraint of objects.slice(3)) near(length(constraint, objects), 100, 0.05)
    }
    results.push(objects)
  }
  for (let index = 0; index < 3; index += 1) {
    near(results[0][index].x, results[1][index].x, 0.01)
    near(results[0][index].y, results[1][index].y, 0.01)
  }
})

test('a freely moving junction crossing a trough is not treated as a physical collider', () => {
  const arc = { id: 'arc', type: 'arc', cx: 0, cy: 0, radius: 100, startAngle: 0, angle: 180, mass: 5, fixed: true, vx: 0, vy: 0, restitution: 0 }
  const start = [joint('node', 0, 50, { vy: 200 }), arc]
  const result = evolve(start, 0.5)
  near(result[0].x, 0)
  near(result[0].y, 150)
  near(result[0].vy, 200)
  near(result[1].cy, 0)
})
