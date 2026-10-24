import test from 'node:test'
import assert from 'node:assert/strict'
import { integrate, measure } from '../src/physics.js'

const environment = { gravity: true, gravityValue: 9.8, friction: false, ground: true }
const DT = 1 / 120

function fixture({ radius = 225, height = 150, mass = 5, restitution = 0.1, fixed = false, commonVelocity = 0 }) {
  const ballRadius = Math.min(19, radius * 0.1)
  return [
    { id: 'trough', type: 'arc', cx: 0, cy: 0, radius, startAngle: 0, angle: 180, mass, vx: commonVelocity, vy: 0, restitution: 0, fixed },
    { id: 'ball', type: 'ball', x: -radius + ballRadius + 3, y: -height, radius: ballRadius, mass: 1, vx: commonVelocity, vy: 0, restitution, fixed: false },
    { id: 'floor', type: 'ground', x: -50000, y: radius + 24, width: 100000 },
  ]
}

function mechanicalEnergy(objects) {
  // 画布向下为正，所以重力势能是 -mgy；共同平移的动能在比较时扣除。
  return measure(objects).kineticEnergy - 9.8 * (objects[0].mass * objects[0].cy + objects[1].mass * objects[1].y) / 100
}

function relativeState(objects, time) {
  const [trough, ball] = objects
  return { time, x: ball.x - trough.cx, y: ball.y - trough.cy, vx: ball.vx - trough.vx, vy: ball.vy - trough.vy }
}

function observeRoundTrips(options, targetReturns = 4) {
  let objects = fixture(options)
  const initial = objects.map(object => ({ ...object }))
  const initialMomentum = measure(objects).px
  const totalMass = objects[0].mass + objects[1].mass
  const commonEnergy = options.fixed ? 0 : initialMomentum * initialMomentum / (2 * totalMass)
  const initialEnergy = mechanicalEnergy(objects) - commonEnergy
  const effectiveRadius = objects[0].radius - objects[1].radius - 3
  let maximumMomentumError = 0
  let maximumEnergyGain = 0
  let maximumEnergyStep = 0
  let previousEnergy = initialEnergy
  let previous = relativeState(objects, 0)
  let flight = null
  const returns = []
  const exits = []
  // 四次完整飞出/回落，覆盖左右槽口各两次；不是只检查首次下滑。
  for (let index = 1; index <= 45 / DT && returns.length < targetReturns; index += 1) {
    objects = integrate(objects, environment, DT)
    const current = relativeState(objects, index * DT)
    const energy = mechanicalEnergy(objects) - commonEnergy
    maximumMomentumError = Math.max(maximumMomentumError, Math.abs(measure(objects).px - initialMomentum))
    maximumEnergyGain = Math.max(maximumEnergyGain, (energy - initialEnergy) / initialEnergy)
    maximumEnergyStep = Math.max(maximumEnergyStep, Math.abs(energy - previousEnergy) / initialEnergy)
    previousEnergy = energy
    if (!flight && previous.y >= 0 && current.y < 0 && current.vy < 0) {
      flight = { side: Math.sign(current.x), exit: current, top: current.y, horizontalDrift: 0, maximumAirHorizontalSpeed: Math.abs(current.vx) }
      exits.push(current)
    }
    if (flight && current.y < 0) {
      flight.top = Math.min(flight.top, current.y)
      flight.horizontalDrift = Math.max(flight.horizontalDrift, Math.abs(current.x - flight.side * effectiveRadius))
      flight.maximumAirHorizontalSpeed = Math.max(flight.maximumAirHorizontalSpeed, Math.abs(current.vx))
    }
    if (flight && previous.y < 0 && current.y >= 0 && current.vy > 0) {
      returns.push({ ...flight, entry: current })
      flight = null
    }
    previous = current
  }
  return { initial, objects, returns, exits, effectiveRadius, maximumMomentumError, maximumEnergyGain, maximumEnergyStep, finalEnergyRatio: previousEnergy / initialEnergy }
}

function assertRepeatedReturn(observation, targetReturns = 4, fixed = false) {
  assert.equal(observation.returns.length, targetReturns, 'Ball must complete the requested departures and returns')
  assert.deepEqual(observation.returns.map(flight => flight.side), Array.from({ length: targetReturns }, (_, index) => index % 2 ? -1 : 1))
  for (const [index, flight] of observation.returns.entries()) {
    const label = `flight ${index + 1}, side ${flight.side}`
    assert.ok(Math.abs(flight.exit.vx) <= 0.1, `${label}: departure tangent error ${flight.exit.vx} px/s`)
    assert.ok(flight.maximumAirHorizontalSpeed <= 0.1, `${label}: unexpected airborne side impulse ${flight.maximumAirHorizontalSpeed} px/s`)
    assert.ok(flight.horizontalDrift <= 0.2, `${label}: horizontal drift ${flight.horizontalDrift} px`)
    assert.ok(Math.abs(flight.entry.x - flight.side * observation.effectiveRadius) <= 0.5, `${label}: return missed the inner rim at ${flight.entry.x} px`)
    const predictedApex = flight.exit.y - flight.exit.vy ** 2 / (2 * 980)
    const gravityIntegrationTolerance = Math.abs(flight.exit.vy) * DT + 0.2
    assert.ok(Math.abs(flight.top - predictedApex) <= gravityIntegrationTolerance, `${label}: flight apex differs from ballistic motion by ${Math.abs(flight.top - predictedApex)} px`)
  }
  if (!fixed) assert.ok(observation.maximumMomentumError < 1e-7, `Horizontal momentum drifted by ${observation.maximumMomentumError}`)
  // 本回归约束异常接触造成的能量突变，不把长期一阶积分耗散误当成槽口错误。
  assert.ok(observation.maximumEnergyGain < 0.01, `Mechanical energy increased by ${(observation.maximumEnergyGain * 100).toFixed(3)}%`)
  assert.ok(observation.maximumEnergyStep < 0.02, `Single-step energy jump was ${(observation.maximumEnergyStep * 100).toFixed(3)}%`)
}

for (const scenario of [
  { radius: 100, height: 50, mass: 5, restitution: 0, targetReturns: 2 },
  { radius: 180, height: 150, mass: 1, restitution: 0.1 },
  { radius: 225, height: 150, mass: 5, restitution: 0.1 },
  { radius: 225, height: 250, mass: 5, restitution: 1 },
  { radius: 180, height: 500, mass: 5, restitution: 1 },
]) {
  test(`left-tangent release returns repeatedly: R=${scenario.radius}, h=${scenario.height}, M=${scenario.mass}, e=${scenario.restitution}`, () => {
    const targetReturns = scenario.targetReturns || 4
    assertRepeatedReturn(observeRoundTrips(scenario, targetReturns), targetReturns)
  })
}

test('fixed trough also preserves tangent departure and repeated return', () => {
  const scenario = { radius: 225, height: 150, mass: 5, restitution: 1, fixed: true }
  const observation = observeRoundTrips(scenario)
  assertRepeatedReturn(observation, 4, true)
  assert.equal(observation.objects[0].cx, observation.initial[0].cx)
  assert.equal(observation.objects[0].cy, observation.initial[0].cy)
})

test('common horizontal motion preserves the relative trajectory instead of forcing global velocity to zero', () => {
  const scenario = { radius: 225, height: 150, mass: 5, restitution: 0.1, commonVelocity: 100 }
  const moving = observeRoundTrips(scenario)
  assertRepeatedReturn(moving)
  const stationary = observeRoundTrips({ ...scenario, commonVelocity: 0 })
  for (let index = 0; index < moving.exits.length; index += 1) {
    assert.ok(Math.abs(moving.exits[index].time - stationary.exits[index].time) < 0.03)
  }
  assert.ok(moving.objects[0].cx > 100, 'Trough must retain its shared laboratory-frame translation')
  assert.ok(Math.abs(measure(moving.objects).px - 6) < 1e-7)
})

test('an external diagonal strike still rebounds from the physical end cap', () => {
  const objects = fixture({ radius: 100, height: 40, fixed: true })
  Object.assign(objects[1], { x: 120, y: -40, vx: -50, vy: 100, restitution: 1 })
  const startEnergy = measure(objects).kineticEnergy
  let result = objects
  for (let index = 0; index < 48; index += 1) result = integrate(result, { gravity: false, ground: false, friction: false }, DT)
  assert.ok(result[1].vx > 40, 'External ball must rebound outward, not get captured onto the inner track')
  assert.ok(result[1].vy < -90, 'Physical end cap must still reflect a genuine impact')
  assert.ok(result[1].x > 110 && result[1].y < -20)
  assert.ok(Math.abs(measure(result).kineticEnergy - startEnergy) < 1e-6)
})

test('a rotated partial arc releases along its endpoint tangent and then moves freely', () => {
  const angle = 100 * Math.PI / 180
  const endpointAngle = 30 * Math.PI / 180
  const objects = fixture({ radius: 100, height: 0, fixed: true })
  Object.assign(objects[0], { startAngle: 30, angle: 120 })
  Object.assign(objects[1], { x: 87 * Math.cos(angle), y: 87 * Math.sin(angle), vx: 100 * Math.sin(angle), vy: -100 * Math.cos(angle), restitution: 1 })
  const freeEnvironment = { gravity: false, ground: false, friction: false }
  let result = objects
  let departed = null
  for (let index = 0; index < 240 && !departed; index += 1) {
    result = integrate(result, freeEnvironment, DT)
    const currentAngle = Math.atan2(result[1].y, result[1].x) * 180 / Math.PI
    if (currentAngle < 30) departed = { ...result[1] }
  }
  assert.ok(departed, 'Ball must leave the 30-degree start endpoint')
  const radialVelocity = departed.vx * Math.cos(endpointAngle) + departed.vy * Math.sin(endpointAngle)
  assert.ok(Math.abs(radialVelocity) < 0.1, `Departure normal component was ${radialVelocity} px/s`)
  assert.ok(departed.vx > 40 && departed.vy < -70, 'Rotated tangent must not be replaced by vertical global velocity')
  for (let index = 0; index < 60; index += 1) result = integrate(result, freeEnvironment, DT)
  assert.ok(Math.abs(result[1].x - departed.x - departed.vx * 0.5) < 1e-6)
  assert.ok(Math.abs(result[1].y - departed.y - departed.vy * 0.5) < 1e-6)
  assert.ok(Math.abs(result[1].vx - departed.vx) < 1e-6)
  assert.ok(Math.abs(result[1].vy - departed.vy) < 1e-6)
})

test('a genuine inward-wall impact keeps restitution instead of becoming a sliding constraint', () => {
  const objects = fixture({ radius: 100, height: 0, fixed: true })
  Object.assign(objects[1], { x: 0, y: 60, vx: 0, vy: 100, restitution: 1 })
  let result = objects
  for (let index = 0; index < 48; index += 1) result = integrate(result, { gravity: false, ground: false, friction: false }, DT)
  assert.ok(result[1].vy < -99, 'Real normal impact must rebound rather than stick to the arc')
  assert.ok(result[1].y < 80)
  assert.ok(Math.abs(measure(result).kineticEnergy - measure(objects).kineticEnergy) < 1e-6)
})
