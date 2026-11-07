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

test('balls above either rim align to the vertical tangent without losing release height', () => {
  for (const [x, aligned] of [[150, 143], [450, 457]]) {
    const above = { ...ball, x, y: 50 }
    const result = snapObject(above, [arc])
    assert.equal(result.object.x, aligned)
    assert.equal(result.object.y, 50)
    assert.equal(result.hint.label, '小球已对齐竖直切线')
    assert.ok(result.hint.line.y1 < above.y)
    assert.ok(result.hint.line.y2 > arc.cy)
    assert.equal(above.x, x)
  }
})

test('vertical alignment has a horizontal distance limit, respects zoom and can be bypassed', () => {
  const above = { ...ball, x: 143 + 12, y: -300 }
  assert.ok(snapObject(above, [arc]).hint)
  assert.equal(snapObject(above, [arc], { scale: 2 }).hint, null)
  assert.equal(snapObject(above, [arc], { disabled: true }).hint, null)
  assert.equal(snapObject({ ...above, x: 143 + 15 }, [arc]).hint, null)
  assert.equal(snapObject({ ...above, x: 143, y: 230 }, [arc]).hint, null)
})

test('nearby tangent points take precedence over vertical extensions of other tracks', () => {
  const second = { ...arc, id: 'lower', cy: 600, cx: 305 }
  const result = snapObject({ ...ball, x: 148, y: 195 }, [second, arc])
  assert.equal(result.object.x, 143)
  assert.equal(result.object.y, 200)
  assert.equal(result.hint.label, '小球已对齐竖直切点')
})

test('upper alignment chooses the closest horizontal line and then the nearest rim below it', () => {
  const lower = { ...arc, id: 'lower', cy: 500 }
  const near = { ...arc, id: 'near', cx: 307 }
  const above = { ...ball, x: 150, y: 50 }
  const aligned = snapObject(above, [arc, near])
  assert.equal(aligned.object.x, 150)
  const closestRim = snapObject(above, [lower, arc])
  assert.equal(closestRim.hint.point.y, 200)
  assert.equal(closestRim.object.y, 50)
})

test('block bottom snaps to ground, preserves horizontal position and uses its actual height', () => {
  const block = { id: 'block', type: 'block', x: 300, y: 392, width: 76, height: 48 }
  const result = snapObject(block, [ground])
  assert.equal(result.object.x, 300)
  assert.equal(result.object.y + block.height / 2, 420)
  assert.equal(result.hint.kind, 'block-ground')
  assert.equal(result.hint.label, '滑块底面已贴合地面')
  assert.equal(block.y, 392)
  const taller = snapObject({ ...block, y: 369, height: 100 }, [ground])
  assert.equal(taller.object.y, 370)
})

test('block snap respects finite floors, zoom tolerance, Alt and disabled ground', () => {
  const block = { id: 'block', type: 'block', x: 300, y: 385, width: 80, height: 48 }
  assert.ok(snapObject(block, [ground]).hint)
  assert.equal(snapObject(block, [ground], { scale: 2 }).hint, null)
  assert.equal(snapObject(block, [ground], { disabled: true }).hint, null)
  assert.equal(snapObject(block, [ground], { groundEnabled: false }).hint, null)
  assert.equal(snapObject({ ...block, x: 900 }, [ground]).hint, null)
  assert.equal(snapObject({ ...block, y: 350 }, [ground]).hint, null)
  const closer = { ...ground, id: 'closer', y: 410 }
  assert.equal(snapObject(block, [ground, closer]).object.y, 386)
})

const targetBlock = { id: 'target-block', type: 'block', x: 300, y: 300, width: 100, height: 80 }
const smallBlock = { id: 'moving-block', type: 'block', x: 387, y: 300, width: 60, height: 40, vx: 100, vy: 0, mass: 2, fixed: false }

test('blocks snap to all four contact faces using their actual dimensions', () => {
  for (const [position, expected] of [
    [{ x: 387, y: 300 }, [380, 300]],
    [{ x: 213, y: 300 }, [220, 300]],
    [{ x: 300, y: 234 }, [300, 240]],
    [{ x: 300, y: 366 }, [300, 360]],
  ]) {
    const result = snapObject({ ...smallBlock, ...position }, [targetBlock])
    assert.deepEqual([result.object.x, result.object.y], expected)
    assert.equal(result.hint.kind, 'object-object')
    assert.equal(result.hint.label, '元件已吸附对齐')
    assert.equal(result.hint.lines.length, 2)
  }
})

test('nearby blocks align their centers or matching edges while attaching', () => {
  const centered = snapObject({ ...smallBlock, x: 291, y: 234 }, [targetBlock])
  assert.deepEqual([centered.object.x, centered.object.y], [300, 240])
  const topAligned = snapObject({ ...smallBlock, y: 288 }, [targetBlock])
  assert.deepEqual([topAligned.object.x, topAligned.object.y], [380, 280])
  const bottomAligned = snapObject({ ...smallBlock, y: 319 }, [targetBlock])
  assert.deepEqual([bottomAligned.object.x, bottomAligned.object.y], [380, 320])
  const overlapping = snapObject({ ...smallBlock, x: 374, y: 295 }, [targetBlock])
  assert.deepEqual([overlapping.object.x, overlapping.object.y], [380, 300])
})

test('element snapping excludes the moving object and preserves input and physical properties', () => {
  const objects = [smallBlock, targetBlock]
  const snapshot = structuredClone(objects)
  const result = snapObject(smallBlock, objects)
  assert.equal(result.object.x, 380)
  assert.deepEqual({ ...result.object, x: smallBlock.x, y: smallBlock.y }, smallBlock)
  assert.deepEqual(objects, snapshot)
  assert.equal(snapObject(smallBlock, [smallBlock, { ...smallBlock }]).hint, null)
})

test('nearest element wins independently of scene order with stable ties', () => {
  const closer = { ...targetBlock, id: 'closer', x: 305 }
  for (const objects of [[targetBlock, closer], [closer, targetBlock]]) assert.equal(snapObject(smallBlock, objects).object.x, 385)
  const left = { ...targetBlock, id: 'a', x: 300 }
  const right = { ...targetBlock, id: 'b', x: 466 }
  const between = { ...smallBlock, x: 383 }
  for (const objects of [[left, right], [right, left]]) assert.equal(snapObject(between, objects).object.x, 380)
})

test('element snapping respects screen distance, Alt and free movement beyond tolerance', () => {
  const outside = { ...smallBlock, x: 395 }
  assert.equal(snapObject(outside, [targetBlock]).hint, null)
  assert.equal(snapObject(smallBlock, [targetBlock], { scale: 3 }).hint, null)
  assert.equal(snapObject(smallBlock, [targetBlock], { disabled: true }).object, smallBlock)
  assert.equal(snapObject(outside, [targetBlock], { scale: 0.5 }).object.x, 380)
  for (const scale of [NaN, Infinity, 0, -1]) assert.equal(snapObject(smallBlock, [targetBlock], { scale }).object.x, 380)
})

test('distant and deeply overlapping elements do not attract one another', () => {
  for (const position of [{ x: 387, y: 600 }, { x: 300, y: 100 }, { x: 300, y: 300 }]) {
    const moving = { ...smallBlock, ...position }
    assert.equal(snapObject(moving, [targetBlock]).hint, null)
  }
  assert.equal(snapObject(smallBlock, [{ ...targetBlock, width: NaN }]).hint, null)
  assert.equal(snapObject({ ...smallBlock, height: NaN }, [targetBlock]).hint, null)
})

test('combined axes discard an alignment whose target becomes too far away', () => {
  const moving = { ...smallBlock, x: 0, y: 0, width: 20, height: 20 }
  const right = { ...moving, id: 'right', x: 26, y: 34 }
  const above = { ...moving, id: 'above', x: -27, y: -33 }
  const result = snapObject(moving, [right, above])
  assert.deepEqual([result.object.x, result.object.y], [0, -13])
  assert.equal(result.hint.lines.length, 1)
})

test('small blocks inside another element are not snapped into its matching corner', () => {
  const moving = { ...smallBlock, x: 255, y: 265, width: 10, height: 10 }
  const result = snapObject(moving, [targetBlock])
  assert.equal(result.object, moving)
  assert.equal(result.hint, null)
})

test('blocks and troughs snap reciprocally to the real base edges', () => {
  const partial = { ...arc, startAngle: -90, angle: 180 }
  const base = arcBase(partial)
  const nextToArc = { ...smallBlock, x: base.right + smallBlock.width / 2 + 7, y: base.bottom - smallBlock.height / 2 + 4 }
  const blockResult = snapObject(nextToArc, [partial])
  assert.equal(blockResult.object.x - smallBlock.width / 2, base.right)
  assert.equal(blockResult.object.y + smallBlock.height / 2, base.bottom)
  const target = { ...targetBlock, x: 600, y: 364 }
  const movingArc = { ...arc, cx: 368 }
  const arcResult = snapObject(movingArc, [target])
  assert.equal(arcBase(arcResult.object).right, target.x - target.width / 2)
  assert.equal(arcBase(arcResult.object).bottom, target.y + target.height / 2)
})

test('neighboring troughs align their base sides and undersides on both axes', () => {
  const target = { ...arc, id: 'target-arc', cx: 600, radius: 100 }
  const moving = { ...arc, radius: 100, cx: 385, cy: 196 }
  const result = snapObject(moving, [target])
  assert.equal(arcBase(result.object).right, arcBase(target).left)
  assert.equal(arcBase(result.object).bottom, arcBase(target).bottom)
  assert.equal(result.hint.lines.length, 2)
})

test('trough underside can rest on a block without turning the cavity into a support face', () => {
  const movingArc = { ...arc, cx: targetBlock.x, cy: 61 }
  const resting = snapObject(movingArc, [targetBlock])
  assert.equal(arcBase(resting.object).bottom, targetBlock.y - targetBlock.height / 2)
  const cavityBlock = { ...smallBlock, x: arc.cx, y: arc.cy - smallBlock.height / 2 + 5 }
  assert.equal(snapObject(cavityBlock, [arc]).hint, null)
  const nearBaseTop = { ...smallBlock, x: arc.cx, y: arcBase(arc).top - smallBlock.height / 2 + 5 }
  assert.equal(snapObject(nearBaseTop, [arc]).object.y, nearBaseTop.y)
})

test('ground support and horizontal element snapping work together with both guide lines', () => {
  const floor = { ...ground, y: 340 }
  const moving = { ...smallBlock, y: 315 }
  const result = snapObject(moving, [targetBlock, floor])
  assert.deepEqual([result.object.x, result.object.y], [380, 320])
  assert.match(result.hint.label, /滑块底面已贴合地面/)
  assert.match(result.hint.label, /元件已吸附对齐/)
  assert.equal(result.hint.lines.length, 2)
  assert.equal(result.hint.point.y, floor.y)
  assert.equal(result.hint.line.y1, floor.y)
})

test('horizontal alignment never pulls a supported element off its finite ground', () => {
  const floor = { ...ground, x: 419, width: 60, y: 320 }
  const neighbor = { ...targetBlock, x: 330 }
  const moving = { ...smallBlock, x: 393, y: 296 }
  const result = snapObject(moving, [floor, neighbor])
  assert.equal(result.object.x, moving.x)
  assert.equal(result.object.y + moving.height / 2, floor.y)
  assert.equal(result.hint.kind, 'block-ground')
})

test('free balls snap to finite ground while guide beads and disabled ground remain free', () => {
  const moving = { ...ball, x: 300, y: 393 }
  const result = snapObject(moving, [ground])
  assert.equal(result.object.x, moving.x)
  assert.equal(result.object.y + moving.radius, ground.y)
  assert.equal(result.hint.kind, 'ball-ground')
  assert.equal(result.hint.label, '小球已贴合地面')
  assert.equal(snapObject({ ...moving, rodId: 'rod' }, [ground]).hint, null)
  assert.equal(snapObject(moving, [ground], { groundEnabled: false }).hint, null)
  assert.equal(snapObject(moving, [ground], { disabled: true }).hint, null)
  assert.equal(snapObject(moving, [ground], { scale: 3 }).hint, null)
  assert.equal(snapObject({ ...moving, x: 900 }, [ground]).hint, null)
})
