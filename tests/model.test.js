import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COLORS, LABELS, PRESETS, SCALE, SCENE_VERSION, STORAGE_KEY, TYPES,
  alignGuides, cloneScene, createScene, makeObject, parseScene, removeObject,
} from '../src/model.js'
import { endpoints, integrate, measure } from '../src/physics.js'

const pack = (objects, overrides = {}) => ({ version: SCENE_VERSION, name: 'Test scene', objects, gravity: false, ground: false, friction: false, trails: false, gravityValue: 9.8, frictionValue: 0.2, ...overrides })

test('trail preference is preserved while old scenes default to no trails', () => {
  const saved = pack([], { trails: true })
  assert.equal(parseScene(JSON.stringify(saved)).trails, true)
  delete saved.trails
  assert.equal(parseScene(saved).trails, false)
  assert.equal(parseScene({ ...saved, trails: 'false' }).trails, false)
})

test('catalogs give every supported object a label, color, and factory', () => {
  assert.equal(SCALE, 100)
  assert.ok(STORAGE_KEY.includes(`v${SCENE_VERSION}`))
  assert.equal(new Set(TYPES).size, TYPES.length)
  for (const type of TYPES) {
    const object = makeObject(type, 200, 300, `id-${type}`)
    assert.equal(object.id, `id-${type}`)
    assert.equal(object.type, type)
    assert.equal(object.name, LABELS[type])
    assert.match(COLORS[type], /^#[0-9a-f]{6}$/i)
    assert.ok(Object.values(object).filter(value => typeof value === 'number').every(Number.isFinite))
  }
  assert.throws(() => makeObject('unknown'), /Unknown object type/)
})

test('factory positions bodies and tracks directly and centers grounds/connectors', () => {
  const ball = makeObject('ball', 30, 50)
  const secondBall = makeObject('ball', 30, 50)
  assert.notEqual(ball.id, secondBall.id)
  assert.equal(ball.x, 30)
  assert.equal(ball.y, 50)
  const arc = makeObject('arc', 30, 50)
  assert.equal(arc.cx, 30)
  assert.equal(arc.cy, 50)
  const ground = makeObject('ground', 30, 50)
  assert.equal(ground.x + ground.width / 2, 30)
  assert.equal(ground.y, 50)
  for (const type of ['rod', 'rope', 'spring']) {
    const object = makeObject(type, 30, 50)
    assert.equal((object.ax + object.bx) / 2, 30)
    assert.equal(object.ay, 50)
    assert.equal(object.by, 50)
    assert.equal(object.bodyA, '')
    assert.equal(object.bodyB, '')
  }
  assert.ok(Number.isFinite(makeObject('ball').x))
})

test('all presets survive exact JSON serialization and import', () => {
  for (const preset of PRESETS) {
    const original = createScene(preset.id)
    assert.equal(original.name, preset.name)
    assert.ok(original.objects.length > 0)
    const imported = parseScene(JSON.stringify(original))
    assert.deepEqual(imported, original)
    const loadedAgain = parseScene(JSON.parse(JSON.stringify(imported)))
    assert.deepEqual(loadedAgain, original)
  }
  assert.ok(createScene().objects.some(object => object.type === 'arc'))
  assert.equal(createScene('unavailable').name, '自由实验')
})

test('preset scenes run with finite state and isolated examples conserve momentum', () => {
  for (const preset of PRESETS) {
    const scene = createScene(preset.id)
    const initial = measure(scene.objects)
    let objects = scene.objects
    for (let step = 0; step < 120; step += 1) objects = integrate(objects, scene, 1 / 120)
    for (const object of objects) {
      assert.ok(Object.values(object).filter(value => typeof value === 'number').every(Number.isFinite), preset.id)
    }
    if (preset.id === 'collision' || preset.id === 'spring') {
      assert.ok(Math.abs(measure(objects).px - initial.px) < 1e-8, preset.id)
      assert.ok(Math.abs(measure(objects).py - initial.py) < 1e-8, preset.id)
    }
  }
})

test('cloning a scene isolates mutable object state', () => {
  const original = createScene('spring')
  const copy = cloneScene(original)
  assert.deepEqual(copy, original)
  assert.notEqual(copy, original)
  assert.notEqual(copy.objects, original.objects)
  copy.objects[0].x += 100
  copy.objects.pop()
  copy.gravity = true
  assert.equal(original.objects[0].x, 300)
  assert.equal(original.objects.length, 3)
  assert.equal(original.gravity, false)
})

test('parser rejects corrupt JSON, wrong versions, missing arrays and oversized scenes', () => {
  assert.throws(() => parseScene('{ bad json'))
  for (const value of [null, undefined, false, 42, [], {}, { version: SCENE_VERSION + 1, objects: [] }, { version: SCENE_VERSION, objects: {} }]) {
    assert.throws(() => parseScene(value), /Unsupported scene format/)
  }
  const objects = Array.from({ length: 61 }, (_, index) => makeObject('ball', 10, 20, `ball-${index}`))
  assert.throws(() => parseScene(pack(objects)), /Unsupported scene format/)
  assert.equal(parseScene(pack(objects.slice(0, 60))).objects.length, 60)
  assert.equal(parseScene(pack([])).objects.length, 0)
})

test('parser rejects duplicate IDs and invalid object types or IDs', () => {
  const valid = makeObject('ball', 10, 20, 'ball')
  for (const object of [null, 5, {}, { ...valid, type: 'unknown' }, { ...valid, id: '' }, { ...valid, id: 1 }]) {
    assert.throws(() => parseScene(pack([object])), /Invalid scene object/)
  }
  assert.throws(() => parseScene(pack([valid, { ...valid }])), /Invalid scene object/)
})

test('parser replaces nonfinite numbers, limits dimensions, and strips unknown fields', () => {
  const ball = { ...makeObject('ball', 10, 20, 'ball'), mass: -10, radius: -100, restitution: 10, vx: NaN, vy: Infinity, x: NaN, y: -Infinity, fixed: 'true', injected: true }
  const block = { ...makeObject('block', 10, 20, 'block'), width: 1e9, height: -1 }
  const arc = { ...makeObject('arc', 10, 20, 'arc'), radius: 1e9, startAngle: -1e9, angle: 1e9 }
  const spring = { ...makeObject('spring', 10, 20, 'spring'), length: -1, stiffness: -1, damping: 1e9 }
  const ground = { ...makeObject('ground', 10, 20, 'ground'), width: -1 }
  const parsed = parseScene(pack([ball, block, arc, spring, ground]))
  for (const object of parsed.objects) assert.ok(Object.values(object).filter(value => typeof value === 'number').every(Number.isFinite))
  const [savedBall, savedBlock, savedArc, savedSpring, savedGround] = parsed.objects
  assert.ok(savedBall.mass > 0 && savedBall.radius > 0)
  assert.equal(savedBall.restitution, 1)
  assert.equal(savedBall.vx, 0)
  assert.equal(savedBall.vy, 0)
  assert.equal(savedBall.fixed, false)
  assert.equal('injected' in savedBall, false)
  assert.ok(savedBlock.width <= 1000 && savedBlock.height > 0)
  assert.equal(savedArc.startAngle, -360)
  assert.equal(savedArc.angle, 350)
  assert.ok(savedSpring.stiffness > 0 && savedSpring.length > 0 && savedSpring.damping < 1000)
  assert.ok(savedGround.width > 0)
  assert.equal(ball.mass, -10)
})

test('parser supplies defaults and bounds text and environment settings', () => {
  const parsed = parseScene({ version: SCENE_VERSION, name: 'x'.repeat(100), objects: [{ id: 'ball', type: 'ball', name: 'y'.repeat(100) }], gravity: true, ground: 'true', friction: 1, gravityValue: -100, frictionValue: 10 })
  assert.equal(parsed.name.length, 60)
  assert.ok(parsed.objects[0].name.length <= 40)
  assert.equal(parsed.gravity, true)
  assert.equal(parsed.ground, false)
  assert.equal(parsed.friction, false)
  assert.equal(parsed.gravityValue, 0)
  assert.equal(parsed.frictionValue, 1)
  const defaults = parseScene({ version: SCENE_VERSION, objects: [{ id: 'block', type: 'block' }] })
  assert.equal(defaults.name, '导入实验')
  assert.equal(defaults.objects[0].name, '滑块')
  assert.equal(defaults.gravityValue, 9.8)
  assert.equal(defaults.frictionValue, 0.2)
})

test('dangling, non-body, and duplicate endpoint references are removed', () => {
  const ball = makeObject('ball', 10, 20, 'ball')
  const ground = makeObject('ground', 50, 50, 'ground')
  const rod = { ...makeObject('rod', 50, 50, 'rod'), bodyA: 'ball', bodyB: 'ball' }
  const spring = { ...makeObject('spring', 50, 50, 'spring'), bodyA: 'missing', bodyB: 'ground' }
  const rope = { ...makeObject('rope', 50, 50, 'rope'), bodyA: 12, bodyB: null }
  const parsed = parseScene(pack([ball, ground, rod, spring, rope]))
  assert.equal(parsed.objects[2].bodyA, 'ball')
  assert.equal(parsed.objects[2].bodyB, '')
  assert.equal(parsed.objects[3].bodyA, '')
  assert.equal(parsed.objects[3].bodyB, '')
  assert.equal(parsed.objects[4].bodyA, '')
  assert.equal(parsed.objects[4].bodyB, '')
})

test('guide references accept rods and reject missing, wrong-type, and cyclic bindings', () => {
  const rod = { ...makeObject('rod', 50, 50, 'rod'), bodyA: 'ball-a', bodyB: 'ball-b' }
  const rope = makeObject('rope', 50, 50, 'rope')
  const cases = ['rod', 'rod', 'rope', 'missing', 5, 'rod']
  const balls = cases.map((rodId, index) => ({ ...makeObject('ball', 10 + index * 30, 20, `ball-${String.fromCharCode(97 + index)}`), rodId }))
  const parsed = parseScene(pack([...balls, rod, rope]))
  assert.deepEqual(parsed.objects.slice(0, 6).map(object => object.rodId), ['', '', '', '', '', 'rod'])
})

test('removing a body keeps attached endpoints at its last position', () => {
  const ball = makeObject('ball', 40, 70, 'ball')
  const rod = { ...makeObject('rod', 300, 300, 'rod'), bodyA: 'ball' }
  const spring = { ...makeObject('spring', 300, 300, 'spring'), bodyB: 'ball' }
  const scene = pack([ball, rod, spring])
  const result = removeObject(scene, 'ball')
  assert.equal(result.objects.length, 2)
  assert.equal(result.objects[0].bodyA, '')
  assert.deepEqual(endpoints(result.objects[0], result.objects).a, { x: 40, y: 70 })
  assert.equal(result.objects[1].bodyB, '')
  assert.deepEqual(endpoints(result.objects[1], result.objects).b, { x: 40, y: 70 })
  assert.equal(scene.objects.length, 3)
  assert.equal(scene.objects[1].bodyA, 'ball')
})

test('removing a guide releases its beads and unknown IDs leave the scene intact', () => {
  const scene = createScene('bead')
  const removed = removeObject(scene, 'rod-a')
  assert.equal(removed.objects.find(object => object.type === 'ball').rodId, '')
  assert.equal(scene.objects.find(object => object.type === 'ball').rodId, 'rod-a')
  assert.deepEqual(removeObject(scene, 'missing-id'), scene)
  assert.deepEqual(removeObject(pack([]), 'missing-id'), pack([]))
})

test('legal inspector boundary values survive save and import without silent changes', () => {
  for (const upper of [false, true]) {
    const objects = TYPES.map(type => makeObject(type, 10000, -10000, `id-${type}`))
    for (const object of objects) {
      if (['ball', 'block', 'arc'].includes(object.type)) {
        object.mass = upper ? 1000 : 0.05
        object.vx = upper ? 5000 : -5000
        object.vy = upper ? -5000 : 5000
        object.restitution = upper ? 1 : 0
        object.fixed = upper
      }
      if (object.type === 'ball') object.radius = upper ? 80 : 5
      if (object.type === 'block') { object.width = upper ? 300 : 10; object.height = upper ? 300 : 10 }
      if (object.type === 'arc') { object.radius = upper ? 1000 : 10; object.angle = upper ? 350 : 15; object.startAngle = upper ? 360 : -360 }
      if (object.type === 'ground') object.width = upper ? 3000 : 10
      if (['rod', 'rope', 'spring'].includes(object.type)) { object.length = upper ? 2000 : 5; object.stiffness = upper ? 1000 : 0.1; object.damping = upper ? 20 : 0 }
    }
    const original = pack(objects, { gravityValue: upper ? 30 : 0, frictionValue: upper ? 1 : 0 })
    assert.deepEqual(parseScene(JSON.stringify(original)), original)
  }
})

test('old trough scenes acquire motion properties and explicit fixed state is respected', () => {
  const legacy = { id: 'arc', type: 'arc', name: 'Old trough', cx: 350, cy: 210, radius: 180, startAngle: 0, angle: 180 }
  const imported = parseScene(pack([legacy])).objects[0]
  assert.equal(imported.mass, 5)
  assert.equal(imported.fixed, false)
  assert.equal(imported.vx, 0)
  assert.equal(imported.vy, 0)
  assert.equal(parseScene(pack([{ ...legacy, fixed: true }])).objects[0].fixed, true)
  assert.equal(imported.cx, legacy.cx)
  assert.equal(imported.cy, legacy.cy)
})

test('fixed rod imports retain world endpoints and synchronize linked bodies without changing their fixed flag', () => {
  const block = { ...makeObject('block', 600, 400, 'body'), vx: 120, vy: 70 }
  const rod = { ...makeObject('rod', 300, 200, 'rod'), fixed: true, bodyB: block.id }
  const parsed = parseScene(pack([block, rod]))
  assert.equal(parsed.objects[1].fixed, true)
  assert.equal(parsed.objects[0].fixed, false)
  assert.deepEqual([parsed.objects[0].x, parsed.objects[0].y, parsed.objects[0].vx, parsed.objects[0].vy], [rod.bx, rod.by, 0, 0])
  assert.deepEqual(parseScene(JSON.stringify(parsed)), parsed)
  const legacy = { ...rod }
  delete legacy.fixed
  assert.equal(parseScene(pack([block, legacy])).objects[1].fixed, false)
})

test('import rejects one shared body pinned to conflicting fixed rod anchors', () => {
  const block = makeObject('block', 600, 400, 'body')
  const rod = { ...makeObject('rod', 300, 200, 'rod'), fixed: true, bodyB: block.id }
  const other = { ...makeObject('rod', 700, 200, 'other'), fixed: true, bodyA: block.id }
  assert.throws(() => parseScene(pack([block, rod, other])), /Conflicting fixed anchors/)
})

test('trough endpoints survive import and deletion preserves the current center', () => {
  const arc = makeObject('arc', 120, 80, 'arc')
  const rod = { ...makeObject('rod', 300, 300, 'rod'), bodyA: arc.id }
  const spring = { ...makeObject('spring', 300, 300, 'spring'), bodyB: arc.id }
  const scene = parseScene(pack([arc, rod, spring]))
  assert.equal(scene.objects[1].bodyA, arc.id)
  assert.equal(scene.objects[2].bodyB, arc.id)
  const without = removeObject(scene, arc.id)
  assert.deepEqual(endpoints(without.objects[0], without.objects).a, { x: 120, y: 80 })
  assert.deepEqual(endpoints(without.objects[1], without.objects).b, { x: 120, y: 80 })
  const bead = { ...makeObject('ball', 120, 80, 'bead'), rodId: rod.id }
  const aligned = alignGuides([arc, rod, bead]).at(-1)
  assert.ok(Number.isFinite(aligned.x) && Number.isFinite(aligned.y))
})

test('alignGuides projects a bead onto a fixed rail without mutating its source', () => {
  const rod = { ...makeObject('rod', 50, 50, 'rod'), ax: 0, ay: 0, bx: 100, by: 100 }
  const bead = { ...makeObject('ball', 20, 80, 'bead'), rodId: 'rod' }
  const free = makeObject('ball', 250, 30, 'free')
  const missing = { ...makeObject('ball', 300, 60, 'missing'), rodId: 'no-rod' }
  const original = [rod, bead, free, missing]
  const result = alignGuides(original)
  assert.equal(result[1].x, 50)
  assert.equal(result[1].y, 50)
  assert.equal(original[1].x, 20)
  assert.equal(original[1].y, 80)
  assert.equal(result[2], free)
  assert.equal(result[3], missing)
  assert.deepEqual(alignGuides([]), [])
})

test('alignGuides uses attached endpoint bodies and enforces finite rail ends', () => {
  const a = makeObject('block', 50, 80, 'a')
  const b = makeObject('block', 250, 80, 'b')
  const rod = { ...makeObject('rod', 300, 400, 'rod'), bodyA: 'a', bodyB: 'b' }
  const beads = [-100, 150, 500].map((x, i) => ({ ...makeObject('ball', x, 100, `bead-${i}`), rodId: 'rod' }))
  const result = alignGuides([a, b, rod, ...beads])
  assert.deepEqual(result.slice(3).map(object => ({ x: object.x, y: object.y })), [{ x: 50, y: 80 }, { x: 150, y: 80 }, { x: 250, y: 80 }])
  const zeroRod = { ...rod, bodyA: '', bodyB: '', ax: 10, ay: 20, bx: 10, by: 20 }
  const zero = alignGuides([zeroRod, beads[0]])
  assert.equal(zero[1].x, 10)
  assert.equal(zero[1].y, 20)
})
