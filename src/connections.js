import { applyFixedRodPins, fixedRodPins } from './fixedRods.js'

export const CONNECTOR_TYPES = ['rod', 'rope', 'spring']
export const ATTACHABLE_TYPES = ['ball', 'block', 'arc', 'joint']

export function endpointPosition(connector, end, objects) {
  if (connector.type === 'rod' && connector.fixed) return { x: connector[`${end}x`], y: connector[`${end}y`] }
  const body = objects.find(object => object.id === connector[end === 'a' ? 'bodyA' : 'bodyB'] && ATTACHABLE_TYPES.includes(object.type))
  return body ? { x: body.cx ?? body.x, y: body.cy ?? body.y } : { x: connector[`${end}x`], y: connector[`${end}y`] }
}

export function pruneJoints(objects) {
  const pins = fixedRodPins(objects)
  const detached = new Map(objects.filter(object => object.type === 'joint' && objects.filter(candidate => CONNECTOR_TYPES.includes(candidate.type) && (candidate.bodyA === object.id || candidate.bodyB === object.id)).length < 2).map(object => [object.id, object]))
  if (!detached.size) return objects
  return objects.filter(object => !detached.has(object.id)).map(object => {
    if (!CONNECTOR_TYPES.includes(object.type)) return object
    const next = { ...object }
    for (const end of ['a', 'b']) {
      const key = end === 'a' ? 'bodyA' : 'bodyB'
      const joint = detached.get(object[key])
      if (joint) {
        const point = pins.get(joint.id) || joint
        next[key] = ''; next[`${end}x`] = point.x; next[`${end}y`] = point.y
      }
    }
    return next
  })
}

function validConnections(objects) {
  for (const object of objects.filter(candidate => CONNECTOR_TYPES.includes(candidate.type))) {
    if (object.bodyA && object.bodyA === object.bodyB) throw new Error('Same connection target')
    if (objects.some(body => body.rodId === object.id && [object.bodyA, object.bodyB].includes(body.id))) throw new Error('Cyclic rod guide')
  }
}

function resizeConstraints(objects, changedIds) {
  return objects.map(object => {
    if (!['rod', 'rope'].includes(object.type) || !changedIds.has(object.id)) return object
    const a = endpointPosition(object, 'a', objects)
    const b = endpointPosition(object, 'b', objects)
    return { ...object, length: Math.max(5, Math.hypot(b.x - a.x, b.y - a.y)) }
  })
}

/** 端点共享同一物体或连接点，不使用会形成递归的“连接件引用连接件”。 */
export function connectEndpoint(objects, sourceId, end, target) {
  const source = objects.find(object => object.id === sourceId && CONNECTOR_TYPES.includes(object.type))
  if (!source || !['a', 'b'].includes(end)) throw new Error('Invalid source endpoint')
  const key = end === 'a' ? 'bodyA' : 'bodyB'
  const changed = new Set([sourceId])
  let next = objects.map(object => ({ ...object }))
  const nextSource = next.find(object => object.id === sourceId)
  if (typeof target === 'string') {
    if (target && !objects.some(object => object.id === target && ATTACHABLE_TYPES.includes(object.type))) throw new Error('Invalid connection target')
    const current = endpointPosition(source, end, objects)
    nextSource[key] = target
    if (!target) { nextSource[`${end}x`] = current.x; nextSource[`${end}y`] = current.y }
  } else {
    const other = next.find(object => object.id === target?.connectorId && CONNECTOR_TYPES.includes(object.type))
    if (!other || other.id === sourceId || !['a', 'b'].includes(target.end)) throw new Error('Invalid connection target')
    const targetKey = target.end === 'a' ? 'bodyA' : 'bodyB'
    const sourceBody = next.find(object => object.id === nextSource[key])
    const targetBody = next.find(object => object.id === other[targetKey])
    const destination = endpointPosition(other, target.end, next)
    let shared = targetBody || sourceBody
    if (targetBody?.type === 'joint' && sourceBody && sourceBody.type !== 'joint') shared = sourceBody
    if (!shared) {
      shared = { id: crypto.randomUUID(), type: 'joint', name: `连接点 ${objects.filter(object => object.type === 'joint').length + 1}`, x: destination.x, y: destination.y, mass: 0.01, vx: 0, vy: 0, restitution: 0, fixed: false }
      next.push(shared)
    } else if (!targetBody && sourceBody?.type === 'joint') {
      shared.x = destination.x; shared.y = destination.y
    }
    // 合并已有连接点，所有支路继续共用同一自由度。
    const replaced = new Set([sourceBody, targetBody].filter(body => body?.type === 'joint' && body.id !== shared.id).map(body => body.id))
    next = next.filter(object => !replaced.has(object.id))
    for (const object of next.filter(candidate => CONNECTOR_TYPES.includes(candidate.type))) {
      for (const bodyKey of ['bodyA', 'bodyB']) {
        if (replaced.has(object[bodyKey])) { object[bodyKey] = shared.id; changed.add(object.id) }
      }
      if (object.bodyA === shared.id || object.bodyB === shared.id) changed.add(object.id)
    }
    nextSource[key] = shared.id
    other[targetKey] = shared.id
    changed.add(other.id)
  }
  validConnections(next)
  const pinnedIds = new Set(fixedRodPins(next).keys())
  for (const object of next) if (CONNECTOR_TYPES.includes(object.type) && (pinnedIds.has(object.bodyA) || pinnedIds.has(object.bodyB))) changed.add(object.id)
  next = applyFixedRodPins(next)
  next = pruneJoints(next)
  if (next.length > 60) throw new Error('Scene capacity exceeded')
  return resizeConstraints(next, changed)
}

export function moveJoint(objects, id, point) {
  const pins = fixedRodPins(objects)
  const destination = pins.get(id) || point
  const next = applyFixedRodPins(objects.map(object => object.id === id && object.type === 'joint' ? { ...object, x: destination.x, y: destination.y, vx: 0, vy: 0 } : object))
  const changed = new Set(next.filter(object => CONNECTOR_TYPES.includes(object.type) && (object.bodyA === id || object.bodyB === id)).map(object => object.id))
  return resizeConstraints(next, changed)
}
