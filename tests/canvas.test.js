import test from 'node:test'
import assert from 'node:assert/strict'
import { connectorEndpoints, drawScene, hitConnectionTarget, hitObject, viewTransform, WORLD_SIZE } from '../src/canvasDrawing.js'
import { arcBase } from '../src/arcGeometry.js'

const ball = { id: 'ball', name: '小球', type: 'ball', x: 100, y: 150, radius: 15, mass: 1, vx: 0, vy: 0 }
const block = { id: 'block', name: '滑块', type: 'block', x: 300, y: 150, width: 80, height: 40, mass: 2, vx: 0, vy: 0 }
const rod = { id: 'rod', name: '杆', type: 'rod', bodyA: 'ball', bodyB: '', ax: 0, ay: 0, bx: 300, by: 150, length: 200 }

test('连接器使用物体质心或固定锚点，且不修改输入', () => {
  const objects = [ball, block, rod]
  const snapshot = structuredClone(objects)
  assert.deepEqual(connectorEndpoints(rod, objects), { a: { x: 100, y: 150 }, b: { x: 300, y: 150 } })
  assert.deepEqual(connectorEndpoints({ ...rod, bodyB: 'block' }, objects), { a: { x: 100, y: 150 }, b: { x: 300, y: 150 } })
  assert.deepEqual(connectorEndpoints({ ...rod, bodyA: 'removed' }, objects), { a: { x: 0, y: 0 }, b: { x: 300, y: 150 } })
  assert.deepEqual(objects, snapshot)
})

test('连接器可连接平移槽体，端点随圆心移动', () => {
  const arc = { id: 'trough', type: 'arc', cx: 410, cy: 260, radius: 90, startAngle: 0, angle: 180 }
  assert.deepEqual(connectorEndpoints({ ...rod, bodyB: arc.id }, [ball, arc]), { a: { x: 100, y: 150 }, b: { x: 410, y: 260 } })
  assert.deepEqual(connectorEndpoints({ ...rod, bodyA: arc.id, bodyB: 'ball' }, [{ ...arc, cx: 450 }, ball]), { a: { x: 450, y: 260 }, b: { x: 100, y: 150 } })
})

test('杆的中段可选中，重叠位置优先命中物体', () => {
  assert.equal(hitObject([ball, rod], { x: 220, y: 150 }, 1, true)?.id, 'rod')
  assert.equal(hitObject([ball, rod], { x: 100, y: 150 }, 1, true)?.id, 'ball')
  assert.equal(hitObject([ball, rod], { x: 220, y: 150 }, 1, true, true), null)
})

test('滑块按矩形范围命中，画布空白不命中', () => {
  assert.equal(hitObject([block], { x: 339, y: 169 }, 1, true)?.id, 'block')
  assert.equal(hitObject([block], { x: 300, y: 190 }, 1, true), null)
  assert.equal(hitObject([], { x: 100, y: 100 }, 1, true), null)
})

test('弧形槽只在真实扫角内命中，并处理跨越零度的弧段', () => {
  const arc = { id: 'arc', type: 'arc', cx: 300, cy: 300, radius: 100, startAngle: 0, angle: 180 }
  assert.equal(hitObject([arc], { x: 300, y: 400 }, 1, true)?.id, 'arc')
  assert.equal(hitObject([arc], { x: 300, y: 200 }, 1, true), null)
  assert.equal(hitObject([arc], { x: 300, y: 300 }, 1, true)?.id, 'arc')
  const wrapped = { ...arc, startAngle: 300, angle: 120 }
  assert.equal(hitObject([wrapped], { x: 400, y: 300 }, 1, true)?.id, 'arc')
  assert.equal(hitObject([wrapped], { x: 200, y: 300 }, 1, true), null)
})

test('平底槽可由底座和槽体选中，空腔仍允许平移画布', () => {
  const arc = { id: 'trough', type: 'arc', cx: 300, cy: 300, radius: 100, startAngle: 0, angle: 180 }
  const base = arcBase(arc)
  assert.equal(hitObject([arc], { x: 300, y: (base.top + base.bottom) / 2 }, 1, true)?.id, arc.id)
  assert.equal(hitObject([arc], { x: 230, y: 395 }, 1, true)?.id, arc.id)
  assert.equal(hitObject([arc], { x: 300, y: 350 }, 1, true), null)
  assert.equal(hitObject([arc], { x: base.left - 25, y: base.bottom }, 1, true), null)
  assert.equal(hitObject([arc], { x: 300, y: base.bottom }, 1, true, true)?.id, arc.id)
  const overlapping = { ...ball, x: 300, y: base.top }
  assert.equal(hitObject([overlapping, arc], { x: 300, y: base.top }, 1, true, true)?.id, ball.id)
})

test('关闭的地面和有限地面外部不可选中', () => {
  const ground = { id: 'floor', type: 'ground', x: 100, y: 500, width: 300 }
  assert.equal(hitObject([ground], { x: 220, y: 500 }, 1, true)?.id, 'floor')
  assert.equal(hitObject([ground], { x: 220, y: 500 }, 1, false), null)
  assert.equal(hitObject([ground], { x: 470, y: 500 }, 1, true), null)
})

test('松绳的下垂部分和弹簧中段可选中', () => {
  const rope = { ...rod, id: 'rope', type: 'rope', bodyA: '', ax: 100, ay: 100, bx: 200, by: 100, length: 200 }
  assert.equal(hitObject([rope], { x: 150, y: 143.3 }, 1, true)?.id, 'rope')
  const spring = { ...rod, id: 'spring', type: 'spring' }
  assert.equal(hitObject([ball, spring], { x: 220, y: 150 }, 1, true)?.id, 'spring')
})

test('点击容差随着缩放保持屏幕尺寸一致', () => {
  const point = { x: ball.x + ball.radius + 12, y: ball.y }
  assert.equal(hitObject([ball], point, 1, true), null)
  assert.equal(hitObject([ball], point, 0.5, true)?.id, 'ball')
})

test('画布采用等比缩放、居中留白并叠加平移', () => {
  assert.deepEqual(viewTransform(WORLD_SIZE, { zoom: 1, x: 0, y: 0 }), { scale: 1, x: 0, y: 0 })
  assert.deepEqual(viewTransform({ width: 450, height: 310 }, { zoom: 1, x: 0, y: 0 }), { scale: 0.5, x: 0, y: 0 })
  assert.deepEqual(viewTransform({ width: 900, height: 900 }, { zoom: 1, x: 10, y: -20 }), { scale: 1, x: 10, y: 120 })
  assert.deepEqual(viewTransform(WORLD_SIZE, { zoom: 2, x: 15, y: 10 }), { scale: 2, x: -435, y: -300 })
})

function recordingCanvas() {
  const calls = []
  const context = {}
  for (const name of ['setTransform', 'clearRect', 'fillRect', 'translate', 'scale', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'save', 'restore', 'setLineDash', 'strokeText', 'fillText', 'roundRect', 'quadraticCurveTo']) {
    context[name] = (...args) => calls.push({ name, args })
  }
  return { width: 900, height: 620, getContext: () => context, calls }
}

const drawingOptions = { size: WORLD_SIZE, view: { zoom: 1, x: 0, y: 0 }, objects: [], groundEnabled: true, selectedId: null, connectionMode: null }

test('没有绘图上下文或画布尺寸为零时安全退出', () => {
  assert.doesNotThrow(() => drawScene({ getContext: () => null }, drawingOptions))
  const canvas = recordingCanvas()
  drawScene(canvas, { ...drawingOptions, size: { width: 0, height: 0 } })
  assert.equal(canvas.calls.length, 0)
})

test('绘图保留小球圆形几何，并清理前一帧而不改写物理对象', () => {
  const canvas = recordingCanvas()
  const objects = [{ ...ball, vx: 150, fixed: true }, block]
  const snapshot = structuredClone(objects)
  drawScene(canvas, { ...drawingOptions, objects, selectedId: 'ball' })
  assert.deepEqual(objects, snapshot)
  assert.ok(canvas.calls.some(call => call.name === 'clearRect'))
  assert.ok(canvas.calls.some(call => call.name === 'arc' && call.args[0] === ball.x && call.args[1] === ball.y && call.args[2] === ball.radius))
  assert.ok(canvas.calls.some(call => call.name === 'roundRect'))
  assert.ok(canvas.calls.some(call => call.name === 'fillText' && call.args[0] === '固定'))
})

test('各种元件与选中状态可绘制，尺寸标注使用米', () => {
  const objects = [ball, block, rod, { ...rod, id: 'rope', type: 'rope', bodyA: '', ax: 150, ay: 100 }, { ...rod, id: 'spring', type: 'spring', bodyB: 'block' }, { id: 'arc', type: 'arc', cx: 450, cy: 250, radius: 180, startAngle: 0, angle: 180 }, { id: 'floor', type: 'ground', x: 70, y: 535, width: 760 }]
  for (const object of objects) {
    const canvas = recordingCanvas()
    assert.doesNotThrow(() => drawScene(canvas, { ...drawingOptions, objects, selectedId: object.id, connectionMode: object.type === 'rod' ? { id: object.id, end: 'a' } : null }))
    assert.ok(canvas.calls.some(call => call.name === 'stroke'))
    if (object.type === 'arc') assert.ok(canvas.calls.some(call => call.name === 'fillText' && call.args[0].includes('1.80 m')))
  }
})

test('槽体底面是与碰撞几何一致的水平边，底座展示质量或固定状态', () => {
  const arc = { id: 'trough', type: 'arc', cx: 300, cy: 250, radius: 100, startAngle: 0, angle: 180, mass: 5, fixed: false }
  const base = arcBase(arc)
  const canvas = recordingCanvas()
  drawScene(canvas, { ...drawingOptions, objects: [arc], selectedId: arc.id })
  assert.ok(canvas.calls.some((call, index) => call.name === 'lineTo' && call.args[0] === base.left && call.args[1] === base.bottom && canvas.calls[index + 1]?.name === 'lineTo' && canvas.calls[index + 1].args[0] === base.right && canvas.calls[index + 1].args[1] === base.bottom))
  assert.ok(canvas.calls.some(call => call.name === 'fillText' && call.args[0] === '5 kg'))
  const fixed = recordingCanvas()
  drawScene(fixed, { ...drawingOptions, objects: [{ ...arc, fixed: true }] })
  assert.ok(fixed.calls.some(call => call.name === 'fillText' && call.args[0] === '固定'))
})

test('旋转或跨越上半圆的槽仍具有有效水平底座', () => {
  for (const [startAngle, angle] of [[300, 120], [180, 180], [75, 260]]) {
    const arc = { id: 'trough', type: 'arc', cx: 300, cy: 250, radius: 100, startAngle, angle, mass: 5 }
    const canvas = recordingCanvas()
    const base = arcBase(arc)
    drawScene(canvas, { ...drawingOptions, objects: [arc] })
    assert.ok(canvas.calls.some(call => call.name === 'fillRect' && call.args[0] === base.left && call.args[1] === base.top && call.args[3] === base.bottom - base.top))
    assert.ok(canvas.calls.every(call => call.args.filter(value => typeof value === 'number').every(Number.isFinite)))
    assert.equal(hitObject([arc], { x: (base.left + base.right) / 2, y: (base.top + base.bottom) / 2 }, 1, true)?.id, arc.id)
  }
})

test('吸附目标和对齐线使用场景坐标，在缩放后仍保持清晰', () => {
  const canvas = recordingCanvas()
  const snapHint = { kind: 'arc-ground', point: { x: 330, y: 535 }, line: { x1: 110, y1: 535, x2: 600, y2: 535 }, label: '槽底已贴合地面' }
  drawScene(canvas, { ...drawingOptions, view: { zoom: 2, x: 30, y: 20 }, snapHint })
  assert.ok(canvas.calls.some(call => call.name === 'moveTo' && call.args[0] === 110 && call.args[1] === 535))
  assert.ok(canvas.calls.some(call => call.name === 'lineTo' && call.args[0] === 600 && call.args[1] === 535))
  assert.ok(canvas.calls.some(call => call.name === 'arc' && call.args[0] === 330 && call.args[1] === 535 && call.args[2] * 2 === 5))
})

test('关闭地面后不再绘制地面的斜线标记', () => {
  const objects = [{ id: 'floor', type: 'ground', x: 77, y: 531, width: 300 }]
  const enabled = recordingCanvas()
  const disabled = recordingCanvas()
  drawScene(enabled, { ...drawingOptions, objects })
  drawScene(disabled, { ...drawingOptions, objects, groundEnabled: false })
  const groundStart = call => call.name === 'moveTo' && call.args[0] === 77 && call.args[1] === 531
  assert.ok(enabled.calls.some(groundStart))
  assert.ok(!disabled.calls.some(groundStart))
})

test('未开启轨迹或没有记录时不增加绘制路径', () => {
  const baseline = recordingCanvas()
  const noTrails = recordingCanvas()
  const tooShort = recordingCanvas()
  const options = { ...drawingOptions, objects: [ball] }
  drawScene(baseline, options)
  drawScene(noTrails, { ...options, trails: {} })
  drawScene(tooShort, { ...options, trails: { ball: [{ x: 10, y: 20 }] } })
  assert.deepEqual(noTrails.calls, baseline.calls)
  assert.deepEqual(tooShort.calls, baseline.calls)
})

test('轨迹绘制连续折线并位于物体下方，使用同一个画布变换', () => {
  const canvas = recordingCanvas()
  const trails = { ball: [{ x: 23, y: 29 }, { x: 45, y: 61 }, { x: 78, y: 96 }] }
  const snapshot = structuredClone(trails)
  drawScene(canvas, { ...drawingOptions, objects: [ball], view: { zoom: 2, x: 20, y: -10 }, trails })
  const firstPoint = canvas.calls.findIndex(call => call.name === 'moveTo' && call.args[0] === 23 && call.args[1] === 29)
  assert.ok(firstPoint >= 0)
  assert.deepEqual(canvas.calls[firstPoint + 1], { name: 'lineTo', args: [45, 61] })
  assert.deepEqual(canvas.calls[firstPoint + 2], { name: 'lineTo', args: [78, 96] })
  const body = canvas.calls.findIndex(call => call.name === 'arc' && call.args[0] === ball.x && call.args[1] === ball.y)
  assert.ok(body > firstPoint)
  assert.ok(canvas.calls.slice(0, firstPoint).some(call => call.name === 'scale' && call.args[0] === 2 && call.args[1] === 2))
  assert.deepEqual(trails, snapshot)
})

test('删除物体的旧轨迹和非物体元件的轨迹被忽略', () => {
  const baseline = recordingCanvas()
  const withInvalidIds = recordingCanvas()
  const options = { ...drawingOptions, objects: [ball, rod] }
  const points = [{ x: 17, y: 31 }, { x: 41, y: 59 }]
  drawScene(baseline, options)
  drawScene(withInvalidIds, { ...options, trails: { removed: points, rod: points } })
  assert.deepEqual(withInvalidIds.calls, baseline.calls)
})

test('共享接头优先于重合物体命中，两个连接件端点使用同一坐标', () => {
  const joint = { id: 'joint', type: 'joint', name: '连接点', x: 100, y: 150, mass: 0.01, vx: 0, vy: 0, fixed: false }
  const first = { ...rod, bodyA: joint.id }
  const second = { ...rod, id: 'rope', type: 'rope', bodyA: '', bodyB: joint.id }
  const objects = [joint, ball, first, second]
  assert.equal(hitObject(objects, { x: 100, y: 150 }, 1, true)?.id, joint.id)
  assert.equal(hitObject(objects, { x: 110, y: 150 }, 1, true, true)?.id, joint.id)
  assert.deepEqual(connectorEndpoints(first, objects).a, connectorEndpoints(second, objects).b)
  const moved = objects.map(object => object.id === joint.id ? { ...object, x: 125, y: 165 } : object)
  assert.deepEqual(connectorEndpoints(first, moved).a, { x: 125, y: 165 })
  assert.deepEqual(connectorEndpoints(second, moved).b, { x: 125, y: 165 })
  const arc = { id: 'arc', type: 'arc', cx: 300, cy: 300, radius: 100, startAngle: 0, angle: 180 }
  const overlapping = { ...rod, bodyA: '', ax: 200, ay: 415, bx: 400, by: 415 }
  assert.equal(hitObject([arc, overlapping], { x: 300, y: 415 }, 1, true)?.id, arc.id)
})

test('连接选择只选其他连接件端点，按最近距离选择且排除自身', () => {
  const first = { ...rod, bodyA: '', ax: 100, ay: 100, bx: 260, by: 100 }
  const second = { ...rod, id: 'rope', type: 'rope', bodyA: '', ax: 268, ay: 100, bx: 500, by: 100 }
  assert.deepEqual(hitConnectionTarget([first, second], { x: 262, y: 100 }, 1, first.id), { connectorId: second.id, end: 'a' })
  assert.deepEqual(hitConnectionTarget([first, second], { x: 266, y: 100 }, 1), { connectorId: second.id, end: 'a' })
  assert.deepEqual(hitConnectionTarget([first, second], { x: 261, y: 100 }, 1), { connectorId: first.id, end: 'b' })
  assert.equal(hitConnectionTarget([first], { x: 260, y: 100 }, 1, first.id), null)
  assert.equal(hitConnectionTarget([first, second], { x: 180, y: 100 }, 1), null)
  assert.equal(hitConnectionTarget([first, second], { x: 500, y: 113 }, 1), null)
  assert.deepEqual(hitConnectionTarget([first, second], { x: 500, y: 113 }, 0.5), { connectorId: second.id, end: 'b' })
})

test('连接选择支持物体、槽体、接头，重合目标优先共享接头', () => {
  const joint = { id: 'joint', type: 'joint', x: 100, y: 150, mass: 0.01 }
  const attached = { ...rod, bodyA: joint.id }
  assert.equal(hitConnectionTarget([ball, joint, attached], { x: 100, y: 150 }, 1), joint.id)
  assert.equal(hitConnectionTarget([ball, rod], { x: 102, y: 150 }, 1), ball.id)
  assert.equal(hitConnectionTarget([block], { x: 335, y: 166 }, 1), block.id)
  const arc = { id: 'arc', type: 'arc', cx: 300, cy: 300, radius: 100, startAngle: 0, angle: 180 }
  const base = arcBase(arc)
  assert.equal(hitConnectionTarget([arc], { x: 300, y: base.bottom }, 1), arc.id)
  assert.equal(hitConnectionTarget([{ id: 'ground', type: 'ground', x: 0, y: 100, width: 500 }], { x: 100, y: 100 }, 1), null)
  assert.equal(hitConnectionTarget([joint], { x: 100, y: 150 }, NaN), joint.id)
})

test('连接模式标出其他端点，接头保持屏幕大小且不绘制运动轨迹', () => {
  const joint = { id: 'joint', type: 'joint', name: '连接点 1', x: 100, y: 150, mass: 0.01, fixed: false }
  const objects = [joint, { ...rod, bodyA: joint.id }]
  const canvas = recordingCanvas()
  const options = { ...drawingOptions, objects, selectedId: joint.id, connectionMode: { id: 'another', end: 'a' }, view: { zoom: 2, x: 0, y: 0 } }
  drawScene(canvas, options)
  assert.ok(canvas.calls.some(call => call.name === 'fillText' && call.args[0] === '连接点 1'))
  assert.ok(canvas.calls.some(call => call.name === 'fillText' && call.args[0] === '0.01 kg'))
  assert.ok(canvas.calls.some(call => call.name === 'fillText' && call.args[0] === 'A'))
  assert.ok(canvas.calls.some(call => call.name === 'arc' && call.args[0] === joint.x && call.args[1] === joint.y && call.args[2] === 2.5))
  const withTrail = recordingCanvas()
  drawScene(withTrail, { ...options, trails: { joint: [{ x: 20, y: 30 }, { x: 60, y: 70 }] } })
  assert.deepEqual(withTrail.calls, canvas.calls)
})
