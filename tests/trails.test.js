import test from 'node:test'
import assert from 'node:assert/strict'
import { recordTrails, TRAIL_INTERVAL, TRAIL_LIMIT } from '../src/trails.js'

const ball = (x = 0, y = 0, extras = {}) => ({ id: 'ball', type: 'ball', x, y, ...extras })

test('trajectory configuration limits sampling to 30 Hz and 600 points', () => {
  assert.equal(TRAIL_INTERVAL, 1 / 30)
  assert.equal(TRAIL_LIMIT, 600)
  assert.deepEqual(recordTrails(), {})
})

test('first points record balls and blocks, including fixed bodies', () => {
  const objects = [ball(1, 2), { id: 'block', type: 'block', x: 4, y: 5 }, ball(8, 9, { id: 'fixed', fixed: true }), { id: 'arc', type: 'arc', x: 0, y: 0 }, { id: 'rod', type: 'rod', x: 0, y: 0 }]
  assert.deepEqual(recordTrails({}, objects), { ball: [{ x: 1, y: 2 }], block: [{ x: 4, y: 5 }], fixed: [{ x: 8, y: 9 }] })
})

test('stationary objects and subthreshold displacement do not add points', () => {
  const first = recordTrails({}, [ball()])
  const stationary = recordTrails(first, [ball()])
  assert.equal(stationary.ball.length, 1)
  assert.equal(stationary.ball, first.ball)
  assert.equal(recordTrails(stationary, [ball(0.2, 0.2)]).ball.length, 1)
  // 位移相对于最后一个记录点累计，而不是相邻帧累计。
  assert.equal(recordTrails(stationary, [ball(0.3, 0.4)]).ball.length, 2)
  assert.equal(recordTrails(stationary, [ball(-0.5, 0)]).ball.length, 2)
})

test('each body keeps only its latest 600 points', () => {
  let trails = {}
  for (let index = 0; index < TRAIL_LIMIT + 7; index += 1) {
    trails = recordTrails(trails, [ball(index, 0), { id: 'block', type: 'block', x: index * 2, y: 3 }])
  }
  assert.equal(trails.ball.length, TRAIL_LIMIT)
  assert.equal(trails.block.length, TRAIL_LIMIT)
  assert.deepEqual(trails.ball[0], { x: 7, y: 0 })
  assert.deepEqual(trails.ball.at(-1), { x: TRAIL_LIMIT + 6, y: 0 })
  assert.deepEqual(trails.block[0], { x: 14, y: 3 })
})

test('removed bodies and objects that are no longer bodies lose their paths', () => {
  const initial = { ball: [{ x: 0, y: 0 }], deleted: [{ x: 2, y: 3 }], arc: [{ x: 2, y: 3 }] }
  const result = recordTrails(initial, [ball(), { id: 'arc', type: 'arc', x: 2, y: 3 }])
  assert.deepEqual(result, { ball: [{ x: 0, y: 0 }] })
  assert.deepEqual(recordTrails(initial, []), {})
})

test('invalid coordinates do not append nonfinite samples or erase good history', () => {
  const initial = recordTrails({}, [ball(1, 2)])
  for (const object of [ball(NaN, 2), ball(1, Infinity), ball(-Infinity, 2), ball('3', 2)]) {
    assert.deepEqual(recordTrails(initial, [object]), initial)
    assert.deepEqual(recordTrails({}, [object]), {})
  }
  assert.deepEqual(recordTrails({}, [null, {}, ball(1, 2, { id: '' }), ball(1, 2, { id: 5 })]), {})
})

test('input arrays and points remain immutable when adding or pruning history', () => {
  const point = Object.freeze({ x: 1, y: 2 })
  const initial = Object.freeze({ ball: Object.freeze([point]) })
  const object = Object.freeze(ball(3, 4))
  const result = recordTrails(initial, Object.freeze([object]))
  assert.deepEqual(initial, { ball: [{ x: 1, y: 2 }] })
  assert.deepEqual(result, { ball: [{ x: 1, y: 2 }, { x: 3, y: 4 }] })
  assert.notEqual(result, initial)
  assert.notEqual(result.ball, initial.ball)
  assert.notEqual(result.ball[1], object)
})

test('malformed or oversized history is reduced to finite bounded points', () => {
  const invalid = recordTrails({ ball: 'not-an-array' }, [ball(1, 2)])
  assert.deepEqual(invalid, { ball: [{ x: 1, y: 2 }] })
  const history = Array.from({ length: TRAIL_LIMIT + 5 }, (_, index) => ({ x: index, y: 0 }))
  const result = recordTrails({ ball: [null, { x: NaN, y: 0 }, ...history] }, [ball(TRAIL_LIMIT + 4, 0)])
  assert.equal(result.ball.length, TRAIL_LIMIT)
  assert.deepEqual(result.ball[0], { x: 5, y: 0 })
  assert.deepEqual(result.ball.at(-1), { x: TRAIL_LIMIT + 4, y: 0 })
  assert.equal(history.length, TRAIL_LIMIT + 5)
})

test('string IDs that match object prototype keys remain ordinary trajectory keys', () => {
  const result = recordTrails({}, [ball(1, 2, { id: '__proto__' }), ball(3, 4, { id: 'constructor' })])
  assert.equal(Object.getPrototypeOf(result), Object.prototype)
  assert.equal(Object.hasOwn(result, '__proto__'), true)
  assert.deepEqual(result.__proto__, [{ x: 1, y: 2 }])
  assert.deepEqual(result.constructor, [{ x: 3, y: 4 }])
})
