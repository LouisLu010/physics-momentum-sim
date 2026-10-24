import test from 'node:test'
import assert from 'node:assert/strict'
import { angleOnArc, arcBounds, arcBase, verticalTangentCenters } from '../src/arcGeometry.js'
import { snapObject, SNAP_DISTANCE } from '../src/snapping.js'
import { createScene } from '../src/model.js'

const arc = { id: 'arc', type: 'arc', cx: 300, cy: 200, radius: 180, startAngle: 0, angle: 180 }
const ground = { id: 'ground', type: 'ground', x: 30, y: 420, width: 750 }
const ball = { id: 'ball', type: 'ball', x: 150, y: 205, radius: 20, rodId: '' }

test('arc angle membership supports wraparound and negative starting angles', () => {
  assert.ok(angleOnArc(0, 270, 180))
  assert.ok(angleOnArc(180, -180, 90))
  assert.ok(!angleOnArc(180, 270, 180))
  assert.ok(angleOnArc(180, 0, 180))
})

test('flat base bounds use actual arc extrema and retain a horizontal underside', () => {
  assert.deepEqual(arcBounds(arc), { left: 120, right: 480, top: 200, bottom: 380 })
  assert.deepEqual(arcBase(arc), { left: 108, right: 492, top: 386, bottom: 404 })
  const rightHalf = { ...arc, startAngle: -90, angle: 180 }
  const base = arcBase(rightHalf)
  assert.ok(Math.abs(base.left - 288) < 1e-8)
  assert.equal(base.right, 492)
  assert.equal(base.bottom, 404)
  const short = arcBounds({ ...arc, startAngle: 30, angle: 30 })
  assert.ok(short.left > arc.cx && short.top > arc.cy && short.bottom < arc.cy + arc.radius)
})

test('vertical tangent centers account for ball radius and wall thickness', () => {
  assert.deepEqual(verticalTangentCenters(arc, 20).map(point => [point.x, point.y, point.contactX]), [[457, 200, 480], [143, 200, 120]])
  assert.equal(verticalTangentCenters({ ...arc, startAngle: 30, angle: 120 }, 20).length, 0)
  assert.equal(verticalTangentCenters({ ...arc, startAngle: 0, angle: 90 }, 20).length, 1)
  assert.equal(verticalTangentCenters(arc, 180).length, 0)
})

test('dragged ball snaps to the nearest inner vertical tangent without moving the track', () => {
  const original = structuredClone(arc)
  const result = snapObject(ball, [arc])
  assert.equal(result.hint.kind, 'ball-arc')
  assert.deepEqual([result.object.x, result.object.y], [143, 200])
  assert.deepEqual(arc, original)
  assert.equal(ball.x, 150)
  const right = snapObject({ ...ball, x: 452, y: 196 }, [arc])
  assert.equal(right.object.x, 457)
  assert.equal(right.object.y, 200)
})

test('snap range is in screen pixels and free dragging resumes outside it', () => {
  const near = { ...ball, x: 143 + SNAP_DISTANCE - 1, y: 200 }
  assert.ok(snapObject(near, [arc]).hint)
  assert.equal(snapObject(near, [arc], { scale: 2 }).hint, null)
  assert.ok(snapObject({ ...near, x: 143 + 20 }, [arc], { scale: 0.5 }).hint)
  assert.equal(snapObject({ ...near, x: 143 + SNAP_DISTANCE + 1 }, [arc]).hint, null)
  assert.equal(snapObject(near, [arc], { disabled: true }).object, near)
  assert.ok(snapObject(near, [arc], { scale: NaN }).hint)
})

test('rod beads, unsupported arc angles and oversized balls do not snap', () => {
  assert.equal(snapObject({ ...ball, rodId: 'rod' }, [arc]).hint, null)
  assert.equal(snapObject(ball, [{ ...arc, startAngle: 30, angle: 120 }]).hint, null)
  assert.equal(snapObject({ ...ball, radius: 200 }, [arc]).hint, null)
  assert.equal(snapObject({ ...ball, type: 'block' }, [arc]).hint, null)
})

test('closest matching track and ground win instead of object order', () => {
  const nearArc = { ...arc, id: 'near', cx: arc.cx + 5, cy: 205 }
  const selected = snapObject(ball, [arc, nearArc])
  assert.equal(selected.object.x, 148)
  assert.equal(selected.object.y, 205)
  const second = { ...ground, id: 'near', y: 414 }
  const snapped = snapObject({ ...arc, cy: 210 }, [ground, second])
  assert.equal(arcBase(snapped.object).bottom, second.y)
})

test('flat bottom snaps to finite enabled floor and preserves horizontal drag position', () => {
  const raw = { ...arc, cy: 210, cx: 345 }
  const result = snapObject(raw, [ground])
  assert.equal(result.hint.kind, 'arc-ground')
  assert.equal(arcBase(result.object).bottom, ground.y)
  assert.equal(result.object.cx, raw.cx)
  assert.equal(snapObject(raw, [ground], { groundEnabled: false }).hint, null)
  assert.equal(snapObject(raw, [ground], { disabled: true }).hint, null)
  assert.equal(snapObject({ ...raw, cx: 1300 }, [ground]).hint, null)
  assert.equal(snapObject({ ...raw, cy: 100 }, [ground]).hint, null)
  const reversed = { ...ground, x: ground.x + ground.width, width: -ground.width }
  assert.equal(arcBase(snapObject(raw, [reversed]).object).bottom, ground.y)
})

test('default experiment starts with flat base on floor and ball at the inner tangent', () => {
  const scene = createScene('arc')
  const trough = scene.objects.find(object => object.type === 'arc')
  const bead = scene.objects.find(object => object.type === 'ball')
  const floor = scene.objects.find(object => object.type === 'ground')
  assert.equal(arcBase(trough).bottom, floor.y)
  assert.equal(bead.x, trough.cx - trough.radius + bead.radius + 3)
  assert.equal(bead.y, trough.cy)
  assert.equal(trough.fixed, false)
})
