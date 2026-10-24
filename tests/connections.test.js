import test from 'node:test'
import assert from 'node:assert/strict'
import { ATTACHABLE_TYPES, CONNECTOR_TYPES, connectEndpoint, endpointPosition, moveJoint, pruneJoints } from '../src/connections.js'
import { makeObject, parseScene, removeObject, TYPES } from '../src/model.js'

const link = (id, type = 'rod', overrides = {}) => ({ ...makeObject(type, 100, 100, id), ax: 0, ay: 100, bx: 100, by: 100, length: 100, ...overrides })
const joint = (id, x = 100, y = 100) => makeObject('joint', x, y, id)
const scene = objects => ({ version: 1, name: '连接实验', objects, gravity: true, gravityValue: 9.8, ground: false, friction: false, frictionValue: 0.2, trails: false })
const byId = (objects, id) => objects.find(object => object.id === id)

test('连接类型声明与隐式连接点工厂保持一致', () => {
  assert.deepEqual(CONNECTOR_TYPES, ['rod', 'rope', 'spring'])
  assert.ok(ATTACHABLE_TYPES.includes('joint'))
  assert.ok(!TYPES.includes('joint'))
  const node = joint('j', 140, 80)
  assert.equal(node.name, '连接点')
  assert.equal(node.mass, 0.01)
  assert.equal(node.fixed, false)
  assert.deepEqual([node.x, node.y, node.vx, node.vy], [140, 80, 0, 0])
})

test('端点坐标解析物体、槽体和接头，失效目标回退到锚点', () => {
  const ball = makeObject('ball', 40, 60, 'ball')
  const arc = makeObject('arc', 300, 200, 'arc')
  const node = joint('j', 150, 90)
  const source = link('rod', 'rod', { bodyA: ball.id, bodyB: node.id })
  const objects = [ball, arc, node, source]
  assert.deepEqual(endpointPosition(source, 'a', objects), { x: 40, y: 60 })
  assert.deepEqual(endpointPosition(source, 'b', objects), { x: 150, y: 90 })
  assert.deepEqual(endpointPosition({ ...source, bodyA: arc.id }, 'a', objects), { x: 300, y: 200 })
  assert.deepEqual(endpointPosition({ ...source, bodyA: 'missing' }, 'a', objects), { x: 0, y: 100 })
  assert.deepEqual(endpointPosition({ ...source, bodyA: source.id }, 'a', objects), { x: 0, y: 100 })
})

test('两个自由端点连接生成一个共同节点，杆绳长度随新几何更新', () => {
  const objects = [link('rod'), link('rope', 'rope', { ax: 200, ay: 300, bx: 350, by: 300, length: 150 })]
  const snapshot = structuredClone(objects)
  const result = connectEndpoint(objects, 'rod', 'b', { connectorId: 'rope', end: 'a' })
  const shared = result.find(object => object.type === 'joint')
  assert.ok(shared)
  assert.equal(result.length, 3)
  assert.deepEqual([shared.x, shared.y, shared.mass], [200, 300, 0.01])
  assert.equal(byId(result, 'rod').bodyB, shared.id)
  assert.equal(byId(result, 'rope').bodyA, shared.id)
  assert.equal(byId(result, 'rod').length, Math.hypot(200, 200))
  assert.equal(byId(result, 'rope').length, 150)
  assert.deepEqual(objects, snapshot)
})

test('连接弹簧端点保留原长，不把现长改成弹簧原长', () => {
  const result = connectEndpoint([link('spring', 'spring', { length: 75 }), link('rod', 'rod', { ax: 300, ay: 250 })], 'spring', 'b', { connectorId: 'rod', end: 'a' })
  assert.equal(byId(result, 'spring').length, 75)
  assert.equal(byId(result, 'rod').length, Math.hypot(200, 150))
})

test('目标端点已有真实物体时复用该物体，不创建额外接头', () => {
  const ball = makeObject('ball', 250, 140, 'ball')
  const result = connectEndpoint([link('rod'), link('rope', 'rope', { bodyA: ball.id }), ball], 'rod', 'b', { connectorId: 'rope', end: 'a' })
  assert.equal(result.filter(object => object.type === 'joint').length, 0)
  assert.equal(byId(result, 'rod').bodyB, ball.id)
  assert.equal(byId(result, 'rope').bodyA, ball.id)
  assert.deepEqual(endpointPosition(byId(result, 'rod'), 'b', result), { x: 250, y: 140 })
})

test('目标端点已有共享接头时复用它并保留所有支路', () => {
  const node = joint('j')
  const objects = [node, link('rod', 'rod', { bodyB: node.id }), link('rope', 'rope', { bodyA: node.id }), link('spring', 'spring')]
  const result = connectEndpoint(objects, 'spring', 'a', { connectorId: 'rope', end: 'a' })
  assert.equal(result.filter(object => object.type === 'joint').length, 1)
  assert.equal(byId(result, 'spring').bodyA, node.id)
  assert.equal(byId(result, 'rod').bodyB, node.id)
  assert.equal(byId(result, 'rope').bodyA, node.id)
})

test('合并两个接头时全部支路转到同一节点，输入不变', () => {
  const first = joint('j1', 100, 100)
  const second = joint('j2', 300, 250)
  const objects = [first, second, link('r1', 'rod', { bodyB: first.id }), link('p1', 'rope', { bodyA: first.id }), link('r2', 'rod', { bodyB: second.id }), link('s2', 'spring', { bodyA: second.id, length: 77 })]
  const snapshot = structuredClone(objects)
  const result = connectEndpoint(objects, 'r1', 'b', { connectorId: 'r2', end: 'b' })
  assert.deepEqual(result.filter(object => object.type === 'joint').map(object => object.id), [second.id])
  for (const [id, key] of [['r1', 'bodyB'], ['p1', 'bodyA'], ['r2', 'bodyB'], ['s2', 'bodyA']]) assert.equal(byId(result, id)[key], second.id)
  assert.equal(byId(result, 's2').length, 77)
  assert.equal(byId(result, 'r1').length, Math.hypot(300, 150))
  assert.deepEqual(objects, snapshot)
})

test('真实物体与接头相连时支路复用真实物体，两个真实物体不会被合并', () => {
  const bodyA = makeObject('ball', 50, 100, 'ball')
  const bodyB = makeObject('block', 300, 200, 'block')
  const bodies = [bodyA, bodyB, link('r1', 'rod', { bodyA: bodyA.id }), link('r2', 'rod', { bodyB: bodyB.id })]
  const attached = connectEndpoint(bodies, 'r1', 'a', { connectorId: 'r2', end: 'b' })
  assert.equal(byId(attached, 'r1').bodyA, bodyB.id)
  assert.equal(byId(attached, bodyA.id).x, bodyA.x)
  assert.equal(byId(attached, bodyB.id).x, bodyB.x)
  assert.equal(attached.length, bodies.length)

  const node = joint('j', 120, 130)
  const shared = [bodyA, node, link('body-rod', 'rod', { bodyA: bodyA.id }), link('joint-rod', 'rod', { bodyA: node.id }), link('branch', 'rope', { bodyB: node.id })]
  const merged = connectEndpoint(shared, 'body-rod', 'a', { connectorId: 'joint-rod', end: 'a' })
  assert.equal(merged.some(object => object.type === 'joint'), false)
  assert.equal(byId(merged, 'joint-rod').bodyA, bodyA.id)
  assert.equal(byId(merged, 'branch').bodyB, bodyA.id)
})

test('移动已有接头到自由目标端点时所有支路跟随', () => {
  const node = joint('j')
  const objects = [node, link('r1', 'rod', { bodyB: node.id }), link('r2', 'rod', { bodyA: node.id }), link('p', 'rope', { ax: 400, ay: 250 })]
  const result = connectEndpoint(objects, 'r1', 'b', { connectorId: 'p', end: 'a' })
  assert.deepEqual([byId(result, node.id).x, byId(result, node.id).y], [400, 250])
  assert.equal(byId(result, 'p').bodyA, node.id)
  assert.equal(byId(result, 'r2').length, Math.hypot(300, 150))
  assert.equal(node.x, 100)
})

test('字符串目标可连接物体或共享节点，解绑保留当前端点位置', () => {
  const body = makeObject('arc', 300, 250, 'arc')
  let objects = connectEndpoint([body, link('rod')], 'rod', 'a', body.id)
  assert.equal(byId(objects, 'rod').bodyA, body.id)
  objects = connectEndpoint(objects, 'rod', 'a', '')
  assert.equal(byId(objects, 'rod').bodyA, '')
  assert.deepEqual(endpointPosition(byId(objects, 'rod'), 'a', objects), { x: 300, y: 250 })
  const node = joint('j')
  const attached = connectEndpoint([node, link('r', 'rod', { bodyA: node.id }), link('p', 'rope', { bodyB: node.id }), link('s', 'spring')], 's', 'a', node.id)
  assert.equal(byId(attached, 's').bodyA, node.id)
  assert.ok(byId(attached, node.id))
})

test('无效目标、自身端点、同一物体与套杆循环都会拒绝且不修改输入', () => {
  const body = { ...makeObject('ball', 200, 200, 'ball'), rodId: 'rod' }
  const objects = [body, link('rod'), link('rope', 'rope', { bodyA: body.id }), makeObject('ground', 300, 400, 'ground')]
  const snapshot = structuredClone(objects)
  for (const action of [
    () => connectEndpoint(objects, 'missing', 'a', ''),
    () => connectEndpoint(objects, 'rod', 'z', ''),
    () => connectEndpoint(objects, 'rod', 'a', 'missing'),
    () => connectEndpoint(objects, 'rod', 'a', 'ground'),
    () => connectEndpoint(objects, 'rod', 'a', { connectorId: 'rod', end: 'b' }),
    () => connectEndpoint(objects, 'rod', 'a', { connectorId: 'rope', end: 'z' }),
    () => connectEndpoint(objects, 'rope', 'b', body.id),
    () => connectEndpoint(objects, 'rod', 'a', body.id),
    () => connectEndpoint(objects, 'rod', 'a', { connectorId: 'rope', end: 'a' }),
    () => connectEndpoint(objects, 'rod', 'a', null),
  ]) assert.throws(action)
  assert.deepEqual(objects, snapshot)
})

test('合并节点不能使第三个连接件两端指向同一节点', () => {
  const first = joint('j1')
  const second = joint('j2', 300, 100)
  const objects = [first, second, link('bridge', 'rod', { bodyA: first.id, bodyB: second.id }), link('a', 'rod', { bodyA: first.id }), link('b', 'rope', { bodyB: second.id })]
  const snapshot = structuredClone(objects)
  assert.throws(() => connectEndpoint(objects, 'a', 'a', { connectorId: 'b', end: 'b' }), /Same connection target/)
  assert.deepEqual(objects, snapshot)
})

test('移除不足两个连接件引用的节点，并把剩余端点转为原位置锚点', () => {
  const unused = joint('unused', 40, 50)
  const single = joint('single', 120, 130)
  const shared = joint('shared', 220, 230)
  const objects = [unused, single, shared, link('single-rod', 'rod', { bodyA: single.id }), link('shared-rod', 'rod', { bodyB: shared.id }), link('shared-rope', 'rope', { bodyA: shared.id })]
  const snapshot = structuredClone(objects)
  const result = pruneJoints(objects)
  assert.deepEqual(result.filter(object => object.type === 'joint').map(object => object.id), [shared.id])
  assert.equal(byId(result, 'single-rod').bodyA, '')
  assert.deepEqual(endpointPosition(byId(result, 'single-rod'), 'a', result), { x: 120, y: 130 })
  assert.deepEqual(objects, snapshot)
  assert.equal(pruneJoints(result), result)
  const malformed = pruneJoints([single, link('r', 'rod', { bodyA: single.id, bodyB: single.id })])
  assert.equal(malformed.some(object => object.type === 'joint'), false)
})

test('拖动接头更新杆绳长度并清除节点初速度，弹簧原长不变', () => {
  const node = { ...joint('j'), vx: 50, vy: 25 }
  const objects = [node, link('r', 'rod', { bodyB: node.id }), link('p', 'rope', { bodyA: node.id }), link('s', 'spring', { bodyA: node.id, length: 65 })]
  const snapshot = structuredClone(objects)
  const result = moveJoint(objects, node.id, { x: 300, y: 400 })
  assert.deepEqual([byId(result, node.id).x, byId(result, node.id).y, byId(result, node.id).vx, byId(result, node.id).vy], [300, 400, 0, 0])
  assert.equal(byId(result, 'r').length, Math.hypot(300, 300))
  assert.equal(byId(result, 'p').length, Math.hypot(200, 300))
  assert.equal(byId(result, 's').length, 65)
  assert.deepEqual(objects, snapshot)
  assert.deepEqual(moveJoint(objects, 'missing', { x: 0, y: 0 }), objects)
})

test('新增接头遵守场景容量，复用物体无需额外名额', () => {
  const bodies = Array.from({ length: 58 }, (_, index) => makeObject('ball', 300, 300, `ball-${index}`))
  const objects = [link('rod'), link('rope', 'rope'), ...bodies]
  assert.throws(() => connectEndpoint(objects, 'rod', 'a', { connectorId: 'rope', end: 'b' }), /Scene capacity exceeded/)
  assert.equal(objects.length, 60)
  assert.equal(connectEndpoint(objects, 'rod', 'a', bodies[0].id).length, 60)
  const belowCapacity = objects.slice(0, 59)
  assert.equal(connectEndpoint(belowCapacity, 'rod', 'a', { connectorId: 'rope', end: 'b' }).length, 60)
})

test('共享接头保存导入完全往返，非法质量归一且孤立节点清理', () => {
  const node = joint('j', 150, 160)
  const original = scene([node, link('r', 'rod', { bodyB: node.id }), link('p', 'rope', { bodyA: node.id })])
  assert.deepEqual(parseScene(JSON.stringify(original)), original)
  const clamped = parseScene(scene([{ ...node, mass: 0, vx: Infinity }, ...original.objects.slice(1)]))
  assert.equal(clamped.objects[0].mass, 0.001)
  assert.equal(clamped.objects[0].vx, 0)
  const orphaned = parseScene(scene([node, original.objects[1]]))
  assert.equal(orphaned.objects.length, 1)
  assert.equal(orphaned.objects[0].bodyB, '')
  assert.deepEqual(endpointPosition(orphaned.objects[0], 'b', orphaned.objects), { x: 150, y: 160 })
})

test('删除支路或节点会安全解绑，其他元件保持原位置', () => {
  const node = joint('j', 150, 160)
  const original = scene([node, link('r', 'rod', { bodyB: node.id }), link('p', 'rope', { bodyA: node.id })])
  const removedBranch = removeObject(original, 'r')
  assert.equal(removedBranch.objects.length, 1)
  assert.equal(removedBranch.objects[0].id, 'p')
  assert.deepEqual(endpointPosition(removedBranch.objects[0], 'a', removedBranch.objects), { x: 150, y: 160 })
  const removedJoint = removeObject(original, node.id)
  assert.equal(removedJoint.objects.length, 2)
  assert.equal(byId(removedJoint.objects, 'r').bodyB, '')
  assert.equal(byId(removedJoint.objects, 'p').bodyA, '')
  assert.deepEqual(endpointPosition(byId(removedJoint.objects, 'r'), 'b', removedJoint.objects), { x: 150, y: 160 })
  assert.ok(original.objects.some(object => object.id === node.id))
})
