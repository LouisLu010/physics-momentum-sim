import test from 'node:test'
import assert from 'node:assert/strict'
import { applyFixedRodPins, fixedRodPins, setRodFixed } from '../src/fixedRods.js'
import { connectEndpoint, endpointPosition, moveJoint, pruneJoints } from '../src/connections.js'
import { makeObject } from '../src/model.js'

const rod = (id, overrides = {}) => ({ ...makeObject('rod', 50, 100, id), ax: 0, ay: 100, bx: 100, by: 100, length: 100, fixed: false, ...overrides })
const rope = (id, overrides = {}) => ({ ...makeObject('rope', 250, 200, id), ax: 200, ay: 200, bx: 300, by: 200, length: 100, ...overrides })
const joint = (id, x = 100, y = 100) => makeObject('joint', x, y, id)
const byId = (objects, id) => objects.find(object => object.id === id)

test('固定杆端点以世界锚点解析，不随连接物体的旧坐标漂移', () => {
  const body = makeObject('ball', 500, 600, 'ball')
  const fixed = rod('fixed', { fixed: true, bodyA: body.id })
  assert.deepEqual(endpointPosition(fixed, 'a', [fixed, body]), { x: 0, y: 100 })
  assert.deepEqual(endpointPosition({ ...fixed, fixed: false }, 'a', [fixed, body]), { x: 500, y: 600 })
  assert.deepEqual([...fixedRodPins([fixed, body])], [['ball', { x: 0, y: 100 }]])
})

test('固定锚点映射忽略空端点和失效目标，兼容相同位置的多个支点', () => {
  const body = joint('joint')
  const fixed = rod('fixed', { fixed: true, bodyB: body.id })
  const second = rod('second', { fixed: true, bodyA: body.id, ax: 100, ay: 100 })
  const invalid = rod('invalid', { fixed: true, bodyA: 'missing', bodyB: 'ground' })
  const ground = makeObject('ground', 300, 500, 'ground')
  const pins = fixedRodPins([fixed, second, invalid, body, ground, rope('rope', { fixed: true, bodyA: body.id })])
  assert.equal(pins.size, 1)
  assert.deepEqual(pins.get(body.id), { x: 100, y: 100 })
  assert.equal(fixedRodPins([rod('free', { bodyA: body.id }), body]).size, 0)
})

test('冲突或非有限固定锚点被拒绝，输入数据保持不变', () => {
  const body = joint('joint')
  const objects = [body, rod('first', { fixed: true, bodyB: body.id }), rod('second', { fixed: true, bodyA: body.id, ax: 200 })]
  const before = structuredClone(objects)
  assert.throws(() => fixedRodPins(objects), /Conflicting fixed anchors/)
  assert.deepEqual(objects, before)
  assert.throws(() => fixedRodPins([body, rod('invalid', { fixed: true, bodyA: body.id, ax: NaN })]), /Invalid fixed anchor/)
})

test('应用固定杆约束保持物体自身固定标志，并支持槽圆心和连接点', () => {
  const ball = { ...makeObject('ball', 300, 400, 'ball'), vx: 60, vy: 90, fixed: false }
  const arc = { ...makeObject('arc', 300, 400, 'arc'), vx: 50, vy: 20, fixed: true }
  const node = { ...joint('joint', 700, 800), vx: 100, vy: -20 }
  const objects = [ball, arc, node, rod('r1', { fixed: true, bodyA: ball.id, bodyB: arc.id }), rod('r2', { fixed: true, bodyA: node.id, ax: 200, ay: 150 })]
  const before = structuredClone(objects)
  const result = applyFixedRodPins(objects)
  assert.deepEqual([result[0].x, result[0].y, result[0].vx, result[0].vy, result[0].fixed], [0, 100, 0, 0, false])
  assert.deepEqual([result[1].cx, result[1].cy, result[1].vx, result[1].vy, result[1].fixed], [100, 100, 0, 0, true])
  assert.deepEqual([result[2].x, result[2].y, result[2].vx, result[2].vy, result[2].fixed], [200, 150, 0, 0, false])
  assert.deepEqual(objects, before)
  assert.equal(result[3], objects[3])
})

test('开启固定杆捕获当前真实端点，解除时保留连接与位置', () => {
  const body = { ...joint('joint', 120, 180), vx: 30, vy: 40 }
  const source = rod('rod', { bodyB: body.id })
  const branch = rope('rope', { bodyA: body.id })
  const original = [body, source, branch]
  const fixed = setRodFixed(original, source.id, true)
  const updated = byId(fixed, source.id)
  assert.deepEqual([updated.ax, updated.ay, updated.bx, updated.by], [0, 100, 120, 180])
  assert.equal(updated.length, Math.hypot(120, 80))
  assert.equal(updated.fixed, true)
  assert.equal(byId(fixed, body.id).fixed, false)
  assert.equal(byId(fixed, body.id).vx, 0)
  const released = setRodFixed(fixed, source.id, false)
  assert.equal(byId(released, source.id).fixed, false)
  assert.equal(byId(released, source.id).bodyB, body.id)
  assert.deepEqual([byId(released, body.id).x, byId(released, body.id).y], [120, 180])
  assert.equal(source.fixed, false)
  assert.equal(body.vx, 30)
  assert.throws(() => setRodFixed(original, 'missing', true), /Invalid rod/)
  assert.throws(() => setRodFixed(original, branch.id, true), /Invalid rod/)
})

test('重复固定不会从失配的物体坐标重新捕获锚点', () => {
  const body = joint('joint', 700, 600)
  const fixed = rod('fixed', { fixed: true, bodyB: body.id })
  const result = setRodFixed([fixed, body], fixed.id, true)
  assert.deepEqual(endpointPosition(byId(result, fixed.id), 'b', result), { x: 100, y: 100 })
  assert.deepEqual([byId(result, body.id).x, byId(result, body.id).y], [100, 100])
})

test('固定杆连接自由绳端时接头位于固定杆锚点，双方顺序不改变结果', () => {
  for (const reverse of [false, true]) {
    const objects = [rod('fixed', { fixed: true }), rope('free')]
    const before = structuredClone(objects)
    const result = reverse
      ? connectEndpoint(objects, 'free', 'a', { connectorId: 'fixed', end: 'b' })
      : connectEndpoint(objects, 'fixed', 'b', { connectorId: 'free', end: 'a' })
    const shared = result.find(object => object.type === 'joint')
    assert.deepEqual([shared.x, shared.y, shared.vx, shared.vy, shared.fixed], [100, 100, 0, 0, false])
    assert.equal(byId(result, 'fixed').bodyB, shared.id)
    assert.equal(byId(result, 'free').bodyA, shared.id)
    assert.equal(byId(result, 'fixed').length, 100)
    assert.equal(byId(result, 'free').length, Math.hypot(200, 100))
    assert.deepEqual(objects, before)
  }
})

test('固定杆连到真实物体后将物体置于锚点，但不永久锁定物体', () => {
  const ball = { ...makeObject('ball', 350, 260, 'ball'), vx: 80, fixed: false }
  const objects = [rod('fixed', { fixed: true }), rope('branch', { bodyA: ball.id }), ball]
  for (const target of [ball.id, { connectorId: 'branch', end: 'a' }]) {
    const result = connectEndpoint(objects, 'fixed', 'b', target)
    assert.equal(result.some(object => object.type === 'joint'), false)
    assert.deepEqual([byId(result, ball.id).x, byId(result, ball.id).y, byId(result, ball.id).vx, byId(result, ball.id).fixed], [100, 100, 0, false])
    assert.equal(byId(result, 'branch').length, Math.hypot(200, 100))
  }
  assert.equal(ball.x, 350)
})

test('已有固定接头接入自由端点时不被目标端点拖走', () => {
  const node = joint('joint')
  const objects = [node, rod('fixed', { fixed: true, bodyB: node.id }), rope('branch', { bodyA: node.id }), rope('new', { ax: 600, ay: 500 })]
  const result = connectEndpoint(objects, 'branch', 'a', { connectorId: 'new', end: 'a' })
  assert.deepEqual([byId(result, node.id).x, byId(result, node.id).y], [100, 100])
  assert.equal(byId(result, 'new').bodyA, node.id)
  const moved = moveJoint(result, node.id, { x: 900, y: 700 })
  assert.deepEqual([byId(moved, node.id).x, byId(moved, node.id).y], [100, 100])
  assert.equal(byId(moved, 'fixed').length, 100)
})

test('不同位置的固定端点不能合并，相同位置可共享节点', () => {
  const incompatible = [rod('first', { fixed: true }), rod('second', { fixed: true, ax: 300, ay: 200 })]
  const before = structuredClone(incompatible)
  assert.throws(() => connectEndpoint(incompatible, 'first', 'b', { connectorId: 'second', end: 'a' }), /Conflicting fixed anchors/)
  assert.deepEqual(incompatible, before)
  const compatible = [incompatible[0], { ...incompatible[1], ax: 100, ay: 100, bx: 200, by: 200 }]
  const result = connectEndpoint(compatible, 'first', 'b', { connectorId: 'second', end: 'a' })
  const shared = result.find(object => object.type === 'joint')
  assert.equal(byId(result, 'first').bodyB, shared.id)
  assert.equal(byId(result, 'second').bodyA, shared.id)
  assert.deepEqual(fixedRodPins(result).get(shared.id), { x: 100, y: 100 })
})

test('间接合并固定接头时也拒绝冲突，解绑后保留固定世界坐标', () => {
  const first = joint('j1')
  const second = joint('j2', 400, 300)
  const objects = [first, second, rod('f1', { fixed: true, bodyB: first.id }), rod('f2', { fixed: true, bodyB: second.id, bx: 400, by: 300 }), rope('r1', { bodyA: first.id }), rope('r2', { bodyA: second.id })]
  const before = structuredClone(objects)
  assert.throws(() => connectEndpoint(objects, 'r1', 'a', { connectorId: 'r2', end: 'a' }), /Conflicting fixed anchors/)
  assert.deepEqual(objects, before)
  const detached = connectEndpoint(objects, 'r1', 'a', '')
  assert.equal(byId(detached, first.id), undefined)
  assert.equal(byId(detached, 'f1').bodyB, '')
  assert.deepEqual(endpointPosition(byId(detached, 'f1'), 'b', detached), { x: 100, y: 100 })
  assert.deepEqual(endpointPosition(byId(detached, 'r1'), 'a', detached), { x: 100, y: 100 })
})

test('孤立接头清理以固定杆锚点为准，不使用过时节点坐标', () => {
  const node = joint('joint', 600, 700)
  const fixed = rod('fixed', { fixed: true, bodyB: node.id })
  const result = pruneJoints([fixed, node])
  assert.equal(result.length, 1)
  assert.equal(result[0].bodyB, '')
  assert.deepEqual(endpointPosition(result[0], 'b', result), { x: 100, y: 100 })
  assert.equal(node.x, 600)
})
