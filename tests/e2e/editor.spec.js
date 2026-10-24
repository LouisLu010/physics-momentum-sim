import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const browserErrors = new WeakMap()

test.beforeEach(async ({ page }) => {
  const errors = []
  browserErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '把物理，画出来。' })).toBeVisible()
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), '页面不应出现运行时或控制台错误').toEqual([])
})

async function exportScene(page) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出场景', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('momentum-scene.json')
  return JSON.parse(await readFile(await download.path(), 'utf8'))
}

function numberField(page, name) {
  return page.getByRole('spinbutton', { name: new RegExp(`^${name}(?:\\s|$)`) })
}

async function editNumber(page, name, value) {
  const input = numberField(page, name)
  await input.fill(String(value))
  await input.press('Enter')
  return input
}

async function preset(page, name) {
  await page.getByRole('combobox', { name: '加载实验示例' }).selectOption(name)
}

async function canvasPoint(page, x, y) {
  const bounds = await page.locator('canvas').boundingBox()
  if (!bounds) throw new Error('Canvas is not visible')
  const scale = Math.min(bounds.width / 900, bounds.height / 620)
  return { x: bounds.x + (bounds.width - 900 * scale) / 2 + x * scale, y: bounds.y + (bounds.height - 620 * scale) / 2 + y * scale }
}

async function runUntil(page, seconds) {
  await page.getByRole('button', { name: '运行模拟' }).click()
  await expect.poll(async () => Number((await page.getByLabel('模拟时间').textContent()).match(/[\d.]+/)[0]), { timeout: 7000, intervals: [100, 150] }).toBeGreaterThanOrEqual(seconds)
  await page.getByRole('button', { name: '暂停模拟' }).click()
}

test('主界面、元件库与使用说明完整显示，桌面无溢出', async ({ page }) => {
  await expect(page).toHaveTitle(/Momentum/)
  for (const name of ['弧形槽', '滑块', '小球', '杆子', '细绳', '弹簧', '地面']) {
    await expect(page.getByRole('button', { name: `添加${name}`, exact: true })).toBeVisible()
  }
  await expect(page.getByRole('img', { name: /物理实验画布，包含 4 个元件/ })).toBeVisible()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '使用说明', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText(/二维教学模型/)).toBeVisible()
  await page.getByRole('button', { name: '关闭使用说明' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('拖入并拖动弧槽，编辑数字可处理清空、越界、提交与取消', async ({ page }) => {
  const point = await canvasPoint(page, 660, 100)
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await page.getByRole('button', { name: '添加弧形槽', exact: true }).dispatchEvent('dragstart', { dataTransfer })
  await page.locator('canvas').dispatchEvent('dragover', { dataTransfer, clientX: point.x, clientY: point.y })
  await page.locator('canvas').dispatchEvent('drop', { dataTransfer, clientX: point.x, clientY: point.y })
  await dataTransfer.dispose()
  await expect(page.locator('.scene-item')).toHaveCount(5)
  let scene = await exportScene(page)
  let added = scene.objects.at(-1)
  expect(added.type).toBe('arc')
  expect(Math.abs(added.cx - 660)).toBeLessThan(2)
  expect(Math.abs(added.cy - 100)).toBeLessThan(2)

  const from = await canvasPoint(page, 660, 280)
  const to = await canvasPoint(page, 610, 320)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  scene = await exportScene(page)
  added = scene.objects.at(-1)
  expect(Math.abs(added.cx - 610)).toBeLessThan(2)
  expect(Math.abs(added.cy - 140)).toBeLessThan(2)

  const radius = await editNumber(page, '半径', 2.5)
  await expect(radius).toHaveValue('2.5')
  await radius.fill('')
  await radius.press('Tab')
  await expect(radius).toHaveValue('2.5')
  await radius.fill('-5')
  await radius.press('Enter')
  await expect(radius).toHaveValue('0.1')
  await radius.fill('9')
  await radius.press('Escape')
  await expect(radius).toHaveValue('0.1')
  await editNumber(page, '圆心角', 999)
  await expect(numberField(page, '圆心角')).toHaveValue('350')
  const result = (await exportScene(page)).objects.at(-1)
  expect(result.radius).toBe(10)
  expect(result.angle).toBe(350)
})

test('杆、绳、弹簧两端可连接滑块和小球，支持画布点选', async ({ page }) => {
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await page.getByRole('button', { name: '添加滑块', exact: true }).click()
  await editNumber(page, '位置 X', 2.5)
  await editNumber(page, '位置 Y', 3)
  await page.getByRole('button', { name: '添加小球', exact: true }).click()
  await editNumber(page, '位置 X', 6.5)
  await editNumber(page, '位置 Y', 3)
  const bodies = (await exportScene(page)).objects
  const block = bodies.find(object => object.type === 'block')
  const ball = bodies.find(object => object.type === 'ball')
  for (const [type, label] of [['rod', '杆子'], ['rope', '细绳'], ['spring', '弹簧']]) {
    await page.getByRole('button', { name: `添加${label}`, exact: true }).click()
    await page.getByRole('combobox', { name: '端点 A', exact: true }).selectOption(block.id)
    if (type === 'rod') {
      await page.getByRole('button', { name: '在画布连接端点 B', exact: true }).click()
      await page.keyboard.press('Escape')
      await expect(page.locator('.canvas-connection-notice')).toHaveCount(0)
      await page.getByRole('button', { name: '在画布连接端点 B', exact: true }).click()
      const target = await canvasPoint(page, ball.x, ball.y)
      await page.mouse.click(target.x, target.y)
      await expect(page.locator('.canvas-connection-notice')).toHaveCount(0)
    } else {
      await page.getByRole('combobox', { name: '端点 B', exact: true }).selectOption(ball.id)
    }
    await expect(page.getByRole('combobox', { name: '端点 A', exact: true })).toHaveValue(block.id)
    await expect(page.getByRole('combobox', { name: '端点 B', exact: true })).toHaveValue(ball.id)
    await expect(page.getByRole('combobox', { name: '端点 B', exact: true }).locator(`option[value="${block.id}"]`)).toHaveCount(0)
  }
  const connected = (await exportScene(page)).objects.filter(object => ['rod', 'rope', 'spring'].includes(object.type))
  expect(connected).toHaveLength(3)
  expect(connected.every(object => object.bodyA === block.id && object.bodyB === ball.id)).toBe(true)
})

test('小球可套在杆上并沿杆运动', async ({ page }) => {
  await preset(page, 'bead')
  await page.locator('.scene-item').filter({ hasText: '套杆小球' }).click()
  await page.getByRole('combobox', { name: '杆上滑动', exact: true }).selectOption('')
  await page.getByRole('combobox', { name: '杆上滑动', exact: true }).selectOption('rod-a')
  await expect(page.getByText('小球沿杆滑动，运动限制在两端之间。')).toBeVisible()
  const before = await exportScene(page)
  await runUntil(page, 0.45)
  const rod = before.objects.find(object => object.id === 'rod-a')
  const initial = before.objects.find(object => object.id === 'ball-a')
  const ball = { x: Number(await numberField(page, '位置 X').inputValue()) * 100, y: Number(await numberField(page, '位置 Y').inputValue()) * 100 }
  const dx = rod.bx - rod.ax
  const dy = rod.by - rod.ay
  const distance = Math.abs((ball.x - rod.ax) * dy - (ball.y - rod.ay) * dx) / Math.hypot(dx, dy)
  await expect(page.getByRole('combobox', { name: '杆上滑动', exact: true })).toHaveValue('rod-a')
  expect(distance).toBeLessThan(0.2)
  expect(ball.x).toBeGreaterThan(initial.x + 5)
  expect(ball.y).toBeGreaterThan(initial.y + 5)
})

test('地面、重力与摩擦可独立切换并影响单步运动', async ({ page }) => {
  await preset(page, 'collision')
  const ground = page.getByRole('checkbox', { name: /^地面/ })
  const gravity = page.getByRole('checkbox', { name: /^重力/ })
  const friction = page.getByRole('checkbox', { name: /^摩擦/ })
  await ground.check()
  await gravity.check()
  await friction.check()
  await editNumber(page, '重力加速度', 4.9)
  await editNumber(page, '摩擦系数', 0.35)
  await page.getByRole('button', { name: '单步前进' }).click()
  let scene = await exportScene(page)
  expect(scene.ground).toBe(true)
  expect(scene.gravity).toBe(true)
  expect(scene.friction).toBe(true)
  expect(scene.frictionValue).toBe(0.35)
  expect(scene.objects.filter(object => object.type === 'ground')).toHaveLength(1)
  expect(Number(await numberField(page, '竖直速度').inputValue())).toBeGreaterThan(0)
  await ground.uncheck()
  await gravity.uncheck()
  await friction.uncheck()
  await expect(numberField(page, '重力加速度')).toHaveCount(0)
  await expect(numberField(page, '摩擦系数')).toHaveCount(0)
  scene = await exportScene(page)
  expect([scene.ground, scene.gravity, scene.friction]).toEqual([false, false, false])
})

test('单步、运行、暂停、重置保留自建实验的初始布局', async ({ page }) => {
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await page.getByRole('button', { name: '添加小球', exact: true }).click()
  await editNumber(page, '位置 X', 3)
  await editNumber(page, '位置 Y', 1)
  await editNumber(page, '水平速度', 1.2)
  await page.getByRole('checkbox', { name: /^重力/ }).uncheck()
  await page.getByRole('checkbox', { name: /^地面/ }).uncheck()
  const design = await exportScene(page)
  await page.getByRole('button', { name: '单步前进' }).click()
  await expect(page.getByLabel('模拟时间')).toHaveText('t = 0.02 s')
  expect(Number(await numberField(page, '位置 X').inputValue())).toBeGreaterThan(3)
  await runUntil(page, 0.18)
  const pausedTime = await page.getByLabel('模拟时间').textContent()
  expect(Number(await numberField(page, '位置 X').inputValue())).toBeGreaterThan(3.15)
  await expect(page.getByLabel('模拟时间')).toHaveText(pausedTime)
  await page.getByRole('button', { name: '重置模拟' }).click()
  await expect(page.getByLabel('模拟时间')).toHaveText('t = 0.00 s')
  expect(await exportScene(page)).toEqual(design)
  await expect(page.locator('.scene-item')).toHaveCount(1)
})

test('碰撞示例发生速度交换且总动量和动能守恒', async ({ page }) => {
  await preset(page, 'collision')
  const momentum = Number.parseFloat(await page.getByTestId('momentum-x').textContent())
  const energy = Number.parseFloat(await page.getByTestId('kinetic-energy').textContent())
  await page.getByRole('combobox', { name: '模拟速度' }).selectOption('2')
  await runUntil(page, 1.65)
  expect(Number(await numberField(page, '水平速度').inputValue())).toBeLessThan(0)
  await page.locator('.scene-item').filter({ hasText: '小球 B' }).click()
  expect(Number(await numberField(page, '水平速度').inputValue())).toBeGreaterThan(0)
  expect(Number.parseFloat(await page.getByTestId('momentum-x').textContent())).toBeCloseTo(momentum, 3)
  expect(Number.parseFloat(await page.getByTestId('kinetic-energy').textContent())).toBeCloseTo(energy, 3)
})

test('本机保存刷新后恢复，JSON 导入导出与损坏文件处理可用', async ({ page }) => {
  await preset(page, 'collision')
  await editNumber(page, '质量', 3.5)
  const name = page.getByRole('textbox', { name: '元件名称' })
  await name.fill('验证小球')
  await name.press('Enter')
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible()
  const saved = await exportScene(page)
  await page.reload()
  await expect(numberField(page, '质量')).toHaveValue('3.5')
  await expect(page.locator('.scene-item').filter({ hasText: '验证小球' })).toBeVisible()
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await page.getByLabel('选择场景文件').setInputFiles({ name: 'experiment.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) })
  await expect(page.locator('.toast')).toContainText('场景已导入。')
  expect(await exportScene(page)).toEqual(saved)
  await page.getByLabel('选择场景文件').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"objects":') })
  await expect(page.locator('.toast')).toContainText('无法导入')
  expect(await exportScene(page)).toEqual(saved)
})

test('手机宽度下无横向溢出，画布与检查器可操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const bounds = await page.locator('canvas').boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '添加杆子', exact: true }).click()
  const length = await editNumber(page, '杆长', 2.2)
  await expect(length).toHaveValue('2.2')
  await page.getByRole('button', { name: '运行模拟' }).click()
  await expect(page.getByRole('button', { name: '暂停模拟' })).toBeVisible()
  await page.getByRole('button', { name: '暂停模拟' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('删除物体或导轨后连接引用会被安全清理', async ({ page }) => {
  await preset(page, 'spring')
  await page.getByRole('button', { name: '删除选中元件' }).click()
  let scene = await exportScene(page)
  const spring = scene.objects.find(object => object.type === 'spring')
  expect(scene.objects.some(object => object.id === 'block-a')).toBe(false)
  expect(spring.bodyA).toBe('')
  expect(spring.ax).toBe(300)
  expect(spring.ay).toBe(330)
  await preset(page, 'bead')
  await page.getByRole('button', { name: '删除选中元件' }).click()
  scene = await exportScene(page)
  expect(scene.objects.some(object => object.type === 'rod')).toBe(false)
  expect(scene.objects.find(object => object.type === 'ball').rodId).toBe('')
})

async function trailSamples(page) {
  const status = await page.locator('.trail-status').textContent()
  return Number(status.match(/\d+/)[0])
}

async function simulationTime(page) {
  return Number((await page.getByLabel('模拟时间').textContent()).match(/[\d.]+/)[0])
}

test('运行中可开关轨迹，路径真实累积且不暂停或重置时间', async ({ page }) => {
  await preset(page, 'collision')
  const trails = page.getByRole('checkbox', { name: /^显示轨迹/ })
  await trails.check()
  await expect(page.locator('.trail-status')).toHaveText('轨迹 · 0 个采样点')
  await page.getByRole('button', { name: '运行模拟' }).click()
  await expect.poll(() => trailSamples(page)).toBeGreaterThan(2)
  const beforeDisable = await simulationTime(page)

  await trails.uncheck()
  await expect(page.locator('.trail-status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '暂停模拟' })).toBeVisible()
  const afterDisable = await simulationTime(page)
  expect(afterDisable).toBeGreaterThanOrEqual(beforeDisable)

  await trails.check()
  await expect.poll(() => trailSamples(page)).toBeGreaterThan(2)
  await expect(page.getByRole('button', { name: '暂停模拟' })).toBeVisible()
  expect(await simulationTime(page)).toBeGreaterThanOrEqual(afterDisable)
  await page.getByRole('button', { name: '暂停模拟' }).click()
})

test('单步记录轨迹，重置和编辑清空路径，刷新只保留开关', async ({ page }) => {
  await preset(page, 'collision')
  const trails = page.getByRole('checkbox', { name: /^显示轨迹/ })
  await trails.check()
  await page.getByRole('button', { name: '单步前进' }).click()
  await expect.poll(() => trailSamples(page)).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: '重置模拟' }).click()
  await expect(trails).toBeChecked()
  await expect(page.locator('.trail-status')).toHaveText('轨迹 · 0 个采样点')

  await page.getByRole('button', { name: '单步前进' }).click()
  await expect.poll(() => trailSamples(page)).toBeGreaterThanOrEqual(2)
  await expect(page.getByText('已保存到本机', { exact: true })).toBeVisible()
  await page.reload()
  await expect(trails).toBeChecked()
  await expect(page.locator('.trail-status')).toHaveText('轨迹 · 0 个采样点')

  await page.getByRole('button', { name: '单步前进' }).click()
  await expect.poll(() => trailSamples(page)).toBeGreaterThanOrEqual(2)
  await editNumber(page, '位置 X', 3.2)
  await expect(page.locator('.trail-status')).toHaveText('轨迹 · 0 个采样点')
})

async function dragStart(page, from) {
  const point = await canvasPoint(page, from.x, from.y)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
}

async function dragMove(page, to) {
  const point = await canvasPoint(page, to.x, to.y)
  await page.mouse.move(point.x, point.y, { steps: 6 })
}

test('小球靠近竖直切点自动吸附，吸附后继续拖动可脱离', async ({ page }) => {
  await preset(page, 'arc')
  await page.locator('.scene-item').filter({ hasText: '小球 A' }).click()
  await editNumber(page, '位置 X', 4.3)
  await editNumber(page, '位置 Y', 1.4)
  const initial = await exportScene(page)
  const arc = initial.objects.find(object => object.type === 'arc')
  const ball = initial.objects.find(object => object.id === 'ball-a')
  const target = { x: arc.cx - arc.radius + ball.radius + 3, y: arc.cy }

  await dragStart(page, ball)
  await dragMove(page, { x: target.x + 5, y: target.y + 4 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('小球已对齐竖直切点')
  expect(Number(await numberField(page, '位置 X').inputValue()) * 100).toBeCloseTo(target.x, 2)
  expect(Number(await numberField(page, '位置 Y').inputValue()) * 100).toBeCloseTo(target.y, 2)

  const detached = { x: target.x + 75, y: target.y - 60 }
  await dragMove(page, detached)
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await page.mouse.up()
  let scene = await exportScene(page)
  let moved = scene.objects.find(object => object.id === ball.id)
  expect(Math.abs(moved.x - detached.x)).toBeLessThan(2)
  expect(Math.abs(moved.y - detached.y)).toBeLessThan(2)

  const right = { x: arc.cx + arc.radius - ball.radius - 3, y: arc.cy }
  await dragStart(page, moved)
  await dragMove(page, { x: right.x - 4, y: right.y + 3 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('小球已对齐竖直切点')
  await page.mouse.up()
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  scene = await exportScene(page)
  moved = scene.objects.find(object => object.id === ball.id)
  expect(moved.x).toBeCloseTo(right.x, 3)
  expect(moved.y).toBeCloseTo(right.y, 3)
})

test('吸附有距离边界且按住 Alt 可以临时禁用', async ({ page }) => {
  await preset(page, 'arc')
  await page.locator('.scene-item').filter({ hasText: '小球 A' }).click()
  await editNumber(page, '位置 X', 4.3)
  await editNumber(page, '位置 Y', 1.4)
  const scene = await exportScene(page)
  const arc = scene.objects.find(object => object.type === 'arc')
  const ball = scene.objects.find(object => object.id === 'ball-a')
  const target = { x: arc.cx - arc.radius + ball.radius + 3, y: arc.cy }
  const outside = { x: target.x, y: target.y + 35 }
  await dragStart(page, ball)
  await dragMove(page, outside)
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await page.mouse.up()
  const moved = (await exportScene(page)).objects.find(object => object.id === ball.id)
  expect(Math.abs(moved.y - outside.y)).toBeLessThan(2)

  const bypassed = { x: target.x + 8, y: target.y + 8 }
  await dragStart(page, moved)
  await page.keyboard.down('Alt')
  await dragMove(page, bypassed)
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await page.mouse.up()
  await page.keyboard.up('Alt')
  const result = (await exportScene(page)).objects.find(object => object.id === ball.id)
  expect(Math.abs(result.x - bypassed.x)).toBeLessThan(2)
  expect(Math.abs(result.y - bypassed.y)).toBeLessThan(2)
})

test('槽的水平底座吸附地面并保留水平拖动，地面关闭时不吸附', async ({ page }) => {
  await preset(page, 'arc')
  await editNumber(page, '位置 Y', 2)
  await dragStart(page, { x: 365, y: 200 })
  await dragMove(page, { x: 425, y: 292 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('槽底已贴合地面')
  expect(Number(await numberField(page, '位置 Y').inputValue())).toBeCloseTo(2.86, 3)
  await dragMove(page, { x: 485, y: 294 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('槽底已贴合地面')
  await page.mouse.up()
  let scene = await exportScene(page)
  let arc = scene.objects.find(object => object.id === 'arc-a')
  const ground = scene.objects.find(object => object.type === 'ground')
  expect(Math.abs(arc.cx - 485)).toBeLessThan(2)
  expect(arc.cy + arc.radius + 24).toBeCloseTo(ground.y, 3)

  await dragStart(page, { x: arc.cx, y: arc.cy })
  await dragMove(page, { x: arc.cx, y: 225 })
  await page.mouse.up()
  await page.getByRole('checkbox', { name: /^地面/ }).uncheck()
  scene = await exportScene(page)
  arc = scene.objects.find(object => object.id === 'arc-a')
  await dragStart(page, { x: arc.cx, y: arc.cy })
  await dragMove(page, { x: arc.cx, y: 290 })
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await page.mouse.up()
  const result = (await exportScene(page)).objects.find(object => object.id === 'arc-a')
  expect(Math.abs(result.cy - 290)).toBeLessThan(2)
})

test('可动槽参与动量交换，固定开关和连接端点均可用', async ({ page }) => {
  await preset(page, 'arc')
  await expect(numberField(page, '质量')).toHaveValue('5')
  await expect(page.getByRole('checkbox', { name: /^固定物体/ })).not.toBeChecked()
  const initialX = Number(await numberField(page, '位置 X').inputValue())
  const momentum = Number.parseFloat(await page.getByTestId('momentum-x').textContent())
  await runUntil(page, 0.65)
  expect(Math.abs(Number(await numberField(page, '位置 X').inputValue()) - initialX)).toBeGreaterThan(0.005)
  expect(Math.abs(Number(await numberField(page, '水平速度').inputValue()))).toBeGreaterThan(0.01)
  expect(Number.parseFloat(await page.getByTestId('momentum-x').textContent())).toBeCloseTo(momentum, 2)

  await page.getByRole('button', { name: '重置模拟' }).click()
  await page.getByRole('checkbox', { name: /^固定物体/ }).check()
  await runUntil(page, 0.35)
  expect(Number(await numberField(page, '位置 X').inputValue())).toBeCloseTo(initialX, 4)
  expect(Number(await numberField(page, '水平速度').inputValue())).toBe(0)
  await page.getByRole('button', { name: '重置模拟' }).click()
  await page.getByRole('button', { name: '添加弹簧', exact: true }).click()
  await page.getByRole('combobox', { name: '端点 A', exact: true }).selectOption('arc-a')
  await expect(page.getByRole('combobox', { name: '端点 A', exact: true })).toHaveValue('arc-a')
  await page.getByRole('combobox', { name: '端点 A', exact: true }).selectOption('')
  expect(Number(await numberField(page, 'A 位置 X').inputValue())).toBeCloseTo(initialX, 4)
  expect(Number(await numberField(page, 'A 位置 Y').inputValue())).toBeCloseTo(2.86, 4)
})

test('槽口上方的小球可对齐左右竖直切线，保留高度且可拖离', async ({ page }) => {
  await preset(page, 'arc')
  await page.locator('.scene-item').filter({ hasText: '小球 A' }).click()
  await editNumber(page, '位置 X', 4.3)
  await editNumber(page, '位置 Y', 1.1)
  const initial = await exportScene(page)
  const arc = initial.objects.find(object => object.type === 'arc')
  const ball = initial.objects.find(object => object.id === 'ball-a')
  const leftX = arc.cx - arc.radius + ball.radius + 3
  const height = arc.cy - 100

  await dragStart(page, ball)
  await dragMove(page, { x: leftX + 5, y: height })
  await expect(page.locator('.canvas-snap-notice')).toContainText('小球已对齐竖直切线')
  expect(Number(await numberField(page, '位置 X').inputValue()) * 100).toBeCloseTo(leftX, 2)
  expect(Math.abs(Number(await numberField(page, '位置 Y').inputValue()) * 100 - height)).toBeLessThan(2)

  const detached = { x: leftX + 70, y: height - 25 }
  await dragMove(page, detached)
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await page.mouse.up()
  const moved = (await exportScene(page)).objects.find(object => object.id === ball.id)
  expect(Math.abs(moved.x - detached.x)).toBeLessThan(2)
  expect(Math.abs(moved.y - detached.y)).toBeLessThan(2)

  const rightX = arc.cx + arc.radius - ball.radius - 3
  await dragStart(page, moved)
  await dragMove(page, { x: rightX - 5, y: height - 20 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('小球已对齐竖直切线')
  await page.mouse.up()
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  const aligned = (await exportScene(page)).objects.find(object => object.id === ball.id)
  expect(aligned.x).toBeCloseTo(rightX, 3)
  expect(Math.abs(aligned.y - (height - 20))).toBeLessThan(2)
})

test('上方切线对齐支持 Alt 禁用，槽口下方不沿切线吸附', async ({ page }) => {
  await preset(page, 'arc')
  await page.locator('.scene-item').filter({ hasText: '小球 A' }).click()
  await editNumber(page, '位置 X', 4.3)
  await editNumber(page, '位置 Y', 1.1)
  const initial = await exportScene(page)
  const arc = initial.objects.find(object => object.type === 'arc')
  const ball = initial.objects.find(object => object.id === 'ball-a')
  const leftX = arc.cx - arc.radius + ball.radius + 3
  const bypassed = { x: leftX + 8, y: arc.cy - 100 }

  await dragStart(page, ball)
  await page.keyboard.down('Alt')
  await dragMove(page, bypassed)
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await page.mouse.up()
  await page.keyboard.up('Alt')
  const moved = (await exportScene(page)).objects.find(object => object.id === ball.id)
  expect(Math.abs(moved.x - bypassed.x)).toBeLessThan(2)
  expect(Math.abs(moved.y - bypassed.y)).toBeLessThan(2)

  const below = { x: leftX + 5, y: arc.cy + 100 }
  await dragStart(page, moved)
  await dragMove(page, below)
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await page.mouse.up()
  const result = (await exportScene(page)).objects.find(object => object.id === ball.id)
  expect(Math.abs(result.x - below.x)).toBeLessThan(2)
  expect(Math.abs(result.y - below.y)).toBeLessThan(2)
})
