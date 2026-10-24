import test from 'node:test'
import assert from 'node:assert/strict'
import { endpoints, integrate, measure } from '../src/physics.js'

const isolated = { gravity: false, friction: false, ground: false }
const ball = (id, x, y, overrides = {}) => ({ id, type: 'ball', x, y, radius: 10, mass: 1, vx: 0, vy: 0, restitution: 1, ...overrides })
const block = (id, x, y, overrides = {}) => ({ id, type: 'block', x, y, width: 20, height: 20, mass: 1, vx: 0, vy: 0, restitution: 1, ...overrides })
const connector = (type, overrides = {}) => ({ id: 'link', type, ax: 0, ay: 0, bx: 100, by: 0, bodyA: '', bodyB: '', length: 100, stiffness: 40, damping: 0, ...overrides })
const evolve = (objects, seconds, environment = isolated) => {
  let result = objects
  const steps = Math.round(seconds * 120)
  for (let i = 0; i < steps; i += 1) result = integrate(result, environment, 1 / 120)
  return result
}
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

test('endpoints resolve body centers and leave unconnected ends fixed', () => {
  const link = connector('rod', { bodyA: 'a', bx: 70, by: 80 })
  assert.deepEqual(endpoints(link, [ball('a', 20, 30)]), { a: { x: 20, y: 30 }, b: { x: 70, y: 80 } })
  assert.deepEqual(endpoints(connector('rope', { bodyA: 'missing' })), { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } })
})

test('free motion is uniform with no invisible wall or damping', () => {
  const original = [ball('a', -100, 20, { vx: -100, vy: 30 })]
  const result = evolve(original, 2)
  near(result[0].x, -300)
  near(result[0].y, 80)
  near(result[0].vx, -100)
  assert.equal(original[0].x, -100)
  assert.notEqual(result[0], original[0])
})

test('SI measurements use 100 px per meter and zero speed for fixed objects', () => {
  const result = measure([ball('a', 0, 0, { mass: 2, vx: 300, vy: -400 }), block('b', 30, 0, { fixed: true, mass: 3, vx: 500 }), connector('rod')])
  assert.deepEqual(result, { px: 6, py: -8, kineticEnergy: 25, totalMass: 5 })
  assert.deepEqual(measure(), { px: 0, py: 0, kineticEnergy: 0, totalMass: 0 })
})

test('gravity accelerates at the configured SI value', () => {
  const [falling] = evolve([ball('a', 0, 0)], 1, { ...isolated, gravity: true, gravityValue: 9.8 })
  near(falling.vy, 980, 1e-8)
  near(falling.y, 490, 2.1)
})

for (const [title, first, second] of [
  ['balls', ball, ball], ['blocks', block, block], ['ball and block', ball, block], ['block and ball', block, ball],
]) {
  test(`elastic head-on ${title} exchange velocity and conserve momentum/energy`, () => {
    const start = [first('a', 0, 0, { vx: 100 }), second('b', 70, 0)]
    const result = evolve(start, 1)
    near(result[0].vx, 0)
    near(result[1].vx, 100)
    near(measure(result).px, measure(start).px)
    near(measure(result).kineticEnergy, measure(start).kineticEnergy)
  })
}

test('unequal mass inelastic collision uses mass and restitution', () => {
  const start = [ball('a', 0, 0, { mass: 2, vx: 100, restitution: 0 }), ball('b', 50, 0, { mass: 1, restitution: 0 })]
  const result = evolve(start, 0.8)
  near(result[0].vx, 200 / 3)
  near(result[1].vx, 200 / 3)
  near(measure(result).px, measure(start).px)
  assert.ok(measure(result).kineticEnergy < measure(start).kineticEnergy)
})

test('low-speed impacts still obey restitution and elastic energy conservation', () => {
  for (const restitution of [1, 0.5]) {
    const start = [ball('a', 0, 0, { vx: 1, restitution }), ball('b', 20.3, 0, { restitution })]
    const result = evolve(start, 1)
    near(result[0].vx, (1 - restitution) / 2)
    near(result[1].vx, (1 + restitution) / 2)
    near(measure(result).px, measure(start).px)
    if (restitution === 1) near(measure(result).kineticEnergy, measure(start).kineticEnergy)
  }
})

test('fast collision does not tunnel through a small ball', () => {
  const result = integrate([ball('a', 0, 0, { vx: 20000, radius: 4 }), ball('b', 80, 0, { radius: 4 })], isolated, 1 / 30)
  near(result[0].vx, 0)
  near(result[1].vx, 20000)
})

test('fixed bodies remain fixed and reflect collisions', () => {
  const result = evolve([ball('a', 0, 0, { vx: 100 }), ball('b', 70, 0, { fixed: true })], 1)
  near(result[0].vx, -100)
  near(result[1].x, 70)
})

test('ground can be disabled and only covers its finite extent', () => {
  const ground = { id: 'floor', type: 'ground', x: 0, y: 100, width: 100 }
  const objects = [ball('a', 50, 0), ball('b', 250, 0), ground]
  const enabled = evolve(objects, 1, { ...isolated, ground: true, gravity: true })
  assert.ok(enabled[0].y <= 90.01)
  assert.ok(enabled[1].y > 100)
  const disabled = evolve(objects, 1, { ...isolated, gravity: true })
  assert.ok(disabled[0].y > 100)
})

test('friction acts at contact rather than slowing bodies in mid-air', () => {
  const start = [block('a', 50, 90, { vx: 100, restitution: 0 }), { id: 'floor', type: 'ground', x: -1000, y: 100, width: 3000 }]
  const environment = { gravity: true, ground: true, friction: true, frictionValue: 0.2 }
  const stopped = evolve(start, 1, environment)
  near(stopped[0].vx, 0, 0.01)
  const smooth = evolve(start, 1, { ...environment, friction: false })
  near(smooth[0].vx, 100)
  const flying = evolve([ball('b', 0, -1000, { vx: 100 })], 0.2, environment)
  near(flying[0].vx, 100)
})

test('rod holds its length between moving bodies and conserves total momentum', () => {
  const start = [ball('a', 0, 0, { vx: 30, vy: -80 }), ball('b', 100, 0, { mass: 2, vx: 30, vy: 40 }), connector('rod', { bodyA: 'a', bodyB: 'b' })]
  const result = evolve(start, 2)
  near(Math.hypot(result[1].x - result[0].x, result[1].y - result[0].y), 100, 0.01)
  near(measure(result).px, measure(start).px, 1e-8)
  near(measure(result).py, measure(start).py, 1e-8)
})

test('fixed rod anchor creates a swinging pendulum', () => {
  const result = evolve([ball('a', 100, 0), connector('rod', { bodyB: 'a' })], 0.3, { ...isolated, gravity: true })
  near(Math.hypot(result[0].x, result[0].y), 100, 0.01)
  assert.ok(result[0].y > 10)
  assert.ok(result[0].x < 100)
})

test('rope is slack under compression and taut only under extension', () => {
  const slack = evolve([ball('a', 50, 0, { vx: -20 }), connector('rope', { bodyB: 'a' })], 0.5)
  near(slack[0].x, 40)
  near(slack[0].vx, -20)
  const taut = evolve([ball('a', 90, 0, { vx: 100 }), connector('rope', { bodyB: 'a' })], 0.5)
  near(taut[0].x, 100, 0.01)
  near(taut[0].vx, 0)
})

test('spring exchanges equal opposite forces and responds to stiffness', () => {
  const start = [ball('a', 0, 0), ball('b', 150, 0), connector('spring', { bodyA: 'a', bodyB: 'b', stiffness: 10 })]
  const result = evolve(start, 0.1)
  assert.ok(result[0].vx > 0 && result[1].vx < 0)
  near(measure(result).px, 0)
  const stiff = evolve(start.map((object) => object.type === 'spring' ? { ...object, stiffness: 30 } : object), 0.1)
  assert.ok(stiff[0].vx > result[0].vx)
})

test('compressed spring pushes its ends apart and fixed anchor stays fixed', () => {
  const result = evolve([ball('a', 50, 0), connector('spring', { bodyB: 'a', stiffness: 20 })], 0.1)
  assert.ok(result[0].x > 50)
  assert.equal(result[1].ax, 0)
})

test('bead slides along an angled rod under gravity instead of being pinned', () => {
  const rod = connector('rod', { bx: 200, by: 200, length: Math.hypot(200, 200) })
  const start = [ball('bead', 50, 50, { rodId: 'link' }), rod]
  const result = evolve(start, 0.3, { ...isolated, gravity: true })
  near(result[0].x, result[0].y, 0.01)
  assert.ok(result[0].x > 65)
  near(result[0].vx, result[0].vy, 0.01)
})

test('bead stops at the ends of a finite rod', () => {
  const start = [ball('bead', 50, 0, { rodId: 'link', vx: 100 }), connector('rod')]
  const result = evolve(start, 1)
  near(result[0].x, 100, 0.01)
  near(result[0].vx, 0)
})

test('bead respects both guide endpoints and contact friction', () => {
  const leftward = evolve([ball('bead', 50, 0, { rodId: 'link', vx: -100 }), connector('rod')], 1)
  near(leftward[0].x, 0, 0.01)
  near(leftward[0].vx, 0)
  const start = [ball('bead', 20, 0, { rodId: 'link', vx: 100 }), connector('rod', { length: 500, bx: 500 })]
  const smooth = evolve(start, 0.3, { ...isolated, gravity: true })
  const rough = evolve(start, 0.3, { ...isolated, gravity: true, friction: true, frictionValue: 0.2 })
  near(smooth[0].vx, 100)
  assert.ok(rough[0].vx < 50)
  near(rough[0].y, 0)
})

test('overlapping balls and blocks separate without nonfinite state', () => {
  for (const x of [0, 8]) {
    const result = integrate([ball('a', x, 0), block('b', 0, 0, { width: 20, height: 50 })], isolated, 1 / 120)
    assert.ok(Number.isFinite(result[0].x))
    assert.ok(Math.hypot(result[0].x - result[1].x, result[0].y - result[1].y) > 18)
  }
  const result = integrate([block('a', 0, 0), block('b', 5, 0)], isolated, 1 / 120)
  near(Math.abs(result[1].x - result[0].x), 20, 0.01)
})

test('bead transfers reaction to moving rod endpoints without changing system momentum', () => {
  const start = [ball('a', 0, 0), ball('b', 100, 0), ball('bead', 50, 0, { vy: 100, rodId: 'link' }), connector('rod', { bodyA: 'a', bodyB: 'b' })]
  const result = evolve(start, 0.2)
  near(measure(result).py, 1, 1e-7)
  assert.ok(result[0].vy > 0 && result[1].vy > 0)
  near(result[2].y, (result[0].y + result[1].y) / 2, 0.01)
})

test('all arc tracks support bodies on their inner surfaces', () => {
  const arc = (id, cx) => ({ id, type: 'arc', cx, cy: 0, radius: 100, startAngle: 0, angle: 180 })
  const result = evolve([ball('a', 0, 70, { restitution: 0 }), block('b', 300, 70, { restitution: 0 }), arc('arc1', 0), arc('arc2', 300)], 0.7, { ...isolated, gravity: true })
  near(result[0].y, 87, 0.01)
  near(result[1].y, 87, 0.01)
})

test('arc only collides along its sweep and has no hidden complete-circle wall', () => {
  const arc = { id: 'arc', type: 'arc', cx: 0, cy: 0, radius: 100, startAngle: 180, angle: 180 }
  const result = evolve([ball('a', 0, 70), arc], 0.5, { ...isolated, gravity: true })
  assert.ok(result[0].y > 150)
})

test('invalid and degenerate inputs do not introduce NaN or mutate a scene', () => {
  const objects = [ball('a', 0, 0, { mass: 0 }), ball('b', 0, 0), connector('rod', { bodyA: 'a', bodyB: 'a', length: 0 }), connector('spring', { id: 'spring', bodyA: 'a', bodyB: 'b', stiffness: 500, damping: 10 })]
  assert.deepEqual(integrate(objects, isolated, NaN), objects)
  assert.deepEqual(integrate(objects, isolated, -1), objects)
  assert.deepEqual(integrate(), [])
  const result = integrate(objects, isolated, 0.05)
  for (const object of result.filter((item) => item.type === 'ball')) {
    for (const field of ['x', 'y', 'vx', 'vy']) assert.ok(Number.isFinite(object[field]))
  }
})
