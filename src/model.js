import { arcBase, verticalTangentCenters } from './arcGeometry.js'
import { endpointPosition, pruneJoints } from './connections.js'

export const SCALE = 100
export const SCENE_VERSION = 1
export const STORAGE_KEY = 'momentum-lab.scene.v1'
export const TYPES = ['arc', 'block', 'ball', 'rod', 'rope', 'spring', 'ground']
export const LABELS = { arc: '弧形槽', block: '滑块', ball: '小球', rod: '杆子', rope: '细绳', spring: '弹簧', ground: '地面', joint: '连接点' }
export const COLORS = { arc: '#3f80b5', block: '#df6f55', ball: '#e5a04d', rod: '#4d7a62', rope: '#9677b8', spring: '#b36b61', ground: '#4b4944', joint: '#426956' }
export const PRESETS = [
  { id: 'arc', name: '弧形槽实验' },
  { id: 'collision', name: '一维动量守恒' },
  { id: 'pendulum', name: '细绳摆球' },
  { id: 'spring', name: '弹簧与滑块' },
  { id: 'bead', name: '小球沿杆滑动' },
]

export function makeObject(type, x = 450, y = 280, id = crypto.randomUUID()) {
  if (!TYPES.includes(type) && type !== 'joint') throw new Error('Unknown object type')
  const common = { id, type, name: LABELS[type] }
  if (type === 'arc') return { ...common, cx: x, cy: y, radius: 180, startAngle: 0, angle: 180, mass: 5, vx: 0, vy: 0, restitution: 0, fixed: false }
  if (type === 'ground') return { ...common, x: x - 200, y, width: 400 }
  if (['rod', 'rope', 'spring'].includes(type)) return { ...common, ax: x - 75, ay: y, bx: x + 75, by: y, bodyA: '', bodyB: '', length: 150, stiffness: 40, damping: 0 }
  const body = { ...common, x, y, vx: 0, vy: 0, mass: 1, restitution: 1, fixed: false }
  if (type === 'joint') return { ...body, mass: 0.01, restitution: 0 }
  if (type === 'ball') return { ...body, radius: 19, rodId: '' }
  return { ...body, width: 76, height: 48, mass: 2 }
}

export function createScene(preset = 'arc') {
  const scene = { version: SCENE_VERSION, name: PRESETS.find(item => item.id === preset)?.name || '自由实验', gravity: true, gravityValue: 9.8, ground: true, friction: false, frictionValue: 0.2, trails: false, objects: [] }
  const ball = (id, x, y, extra = {}) => ({ ...makeObject('ball', x, y, id), ...extra })
  const block = (id, x, y, extra = {}) => ({ ...makeObject('block', x, y, id), ...extra })
  const connector = (type, id, extra) => ({ ...makeObject(type, 450, 300, id), ...extra })
  const floor = { ...makeObject('ground', 450, 535, 'floor'), x: 65, width: 770 }
  if (preset === 'collision') {
    scene.gravity = false; scene.ground = false
    scene.objects = [ball('ball-a', 260, 330, { name: '小球 A', vx: 160 }), ball('ball-b', 580, 330, { name: '小球 B', vx: -40, mass: 2, radius: 25 })]
  } else if (preset === 'pendulum') {
    scene.objects = [ball('ball-a', 620, 280, { name: '摆球' }), connector('rope', 'rope-a', { name: '摆绳', ax: 420, ay: 130, bodyB: 'ball-a', bx: 620, by: 280, length: 250 }), floor]
  } else if (preset === 'spring') {
    scene.gravity = false; scene.ground = false
    scene.objects = [block('block-a', 300, 330, { name: '滑块 A', mass: 1 }), block('block-b', 600, 330, { name: '滑块 B', mass: 2 }), connector('spring', 'spring-a', { bodyA: 'block-a', bodyB: 'block-b', length: 200, stiffness: 25, name: '弹簧 AB' })]
  } else if (preset === 'bead') {
    scene.objects = [connector('rod', 'rod-a', { name: '固定斜杆', ax: 250, ay: 190, bx: 650, by: 420, length: Math.hypot(400, 230) }), ball('ball-a', 330, 236, { name: '套杆小球', rodId: 'rod-a' }), floor]
  } else {
    const arc = { ...makeObject('arc', 365, 235, 'arc-a'), name: '弧形槽 A', radius: 225 }
    arc.cy += floor.y - arcBase(arc).bottom
    const tangent = verticalTangentCenters(arc, 19).find(point => point.side === 'left')
    scene.objects = [arc, ball('ball-a', tangent.x, tangent.y, { name: '小球 A', restitution: 0.1 }), block('block-a', 695, 490, { name: '滑块 A', restitution: 0.3 }), floor]
  }
  return scene
}

export function cloneScene(scene) {
  return { ...scene, objects: scene.objects.map(object => ({ ...object })) }
}

function number(value, fallback, min = -100000, max = 100000) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

export function parseScene(input) {
  const value = typeof input === 'string' ? JSON.parse(input) : input
  if (!value || value.version !== SCENE_VERSION || !Array.isArray(value.objects) || value.objects.length > 60) throw new Error('Unsupported scene format')
  const ids = new Set()
  const objects = value.objects.map(object => {
    if (!object || (!TYPES.includes(object.type) && object.type !== 'joint') || typeof object.id !== 'string' || !object.id || ids.has(object.id)) throw new Error('Invalid scene object')
    ids.add(object.id)
    const base = makeObject(object.type, 450, 280, object.id)
    for (const key of Object.keys(base)) {
      if (typeof base[key] === 'number') base[key] = number(object[key], base[key])
    }
    base.name = typeof object.name === 'string' ? object.name.slice(0, 40) : base.name
    if (['ball', 'block', 'arc', 'joint'].includes(object.type)) {
      base.mass = number(object.mass, base.mass, object.type === 'joint' ? 0.001 : 0.05, 1000)
      base.fixed = object.fixed === true
      base.restitution = number(object.restitution, base.restitution, 0, 1)
      base.vx = number(object.vx, 0, -5000, 5000)
      base.vy = number(object.vy, 0, -5000, 5000)
      if (object.type === 'ball') { base.radius = number(object.radius, 19, 5, 80); base.rodId = typeof object.rodId === 'string' ? object.rodId : '' }
      else if (object.type === 'block') { base.width = number(object.width, 76, 10, 300); base.height = number(object.height, 48, 10, 300) }
      else if (object.type === 'arc') {
        base.radius = number(object.radius, 180, 10, 1000)
        base.angle = number(object.angle, 180, 15, 350)
        base.startAngle = number(object.startAngle, 0, -360, 360)
      }
    } else if (object.type === 'ground') base.width = number(object.width, 400, 10, 3000)
    else {
      base.length = number(object.length, 150, 5, 2000)
      base.stiffness = number(object.stiffness, 40, 0.1, 1000)
      base.damping = number(object.damping, 0, 0, 20)
      base.bodyA = typeof object.bodyA === 'string' ? object.bodyA : ''
      base.bodyB = typeof object.bodyB === 'string' ? object.bodyB : ''
    }
    return base
  })
  const bodies = new Set(objects.filter(object => ['ball', 'block', 'arc', 'joint'].includes(object.type)).map(object => object.id))
  const rods = new Set(objects.filter(object => object.type === 'rod').map(object => object.id))
  for (const object of objects) {
    if ('bodyA' in object) { if (!bodies.has(object.bodyA)) object.bodyA = ''; if (!bodies.has(object.bodyB) || object.bodyB === object.bodyA) object.bodyB = '' }
    if ('rodId' in object && !rods.has(object.rodId)) object.rodId = ''
    // 导轨不能连接到套在自身上的小球，以免形成无解约束。
    if (object.rodId) {
      const rod = objects.find(item => item.id === object.rodId)
      if (rod.bodyA === object.id || rod.bodyB === object.id) object.rodId = ''
    }
  }
  return { version: SCENE_VERSION, name: typeof value.name === 'string' ? value.name.slice(0, 60) : '导入实验', objects: pruneJoints(objects), gravity: value.gravity === true, ground: value.ground === true, friction: value.friction === true, trails: value.trails === true, gravityValue: number(value.gravityValue, 9.8, 0, 30), frictionValue: number(value.frictionValue, 0.2, 0, 1) }
}

export function removeObject(scene, id) {
  const removed = scene.objects.find(object => object.id === id)
  return { ...scene, objects: pruneJoints(scene.objects.filter(object => object.id !== id).map(object => {
    const updated = { ...object }
    if (object.rodId === id) updated.rodId = ''
    if (object.bodyA === id) { updated.bodyA = ''; updated.ax = removed.cx ?? removed.x; updated.ay = removed.cy ?? removed.y }
    if (object.bodyB === id) { updated.bodyB = ''; updated.bx = removed.cx ?? removed.x; updated.by = removed.cy ?? removed.y }
    return updated
  })) }
}

export function alignGuides(objects) {
  return objects.map(object => {
    if (!object.rodId) return object
    const rod = objects.find(item => item.id === object.rodId && item.type === 'rod')
    if (!rod) return object
    const a = endpointPosition(rod, 'a', objects)
    const b = endpointPosition(rod, 'b', objects)
    const dx = b.x - a.x; const dy = b.y - a.y
    const t = Math.max(0, Math.min(1, ((object.x - a.x) * dx + (object.y - a.y) * dy) / Math.max(1, dx * dx + dy * dy)))
    return { ...object, x: a.x + t * dx, y: a.y + t * dy }
  })
}
