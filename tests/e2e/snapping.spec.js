import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { arcBase } from '../../src/arcGeometry.js'

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

function block(id, name, x, y, extra = {}) {
  return { id, type: 'block', name, x, y, width: 80, height: 48, mass: 1, vx: 0, vy: 0, restitution: 1, fixed: false, ...extra }
}

function arc(id, name, cx, cy) {
  return { id, type: 'arc', name, cx, cy, radius: 100, startAngle: 0, angle: 180, mass: 5, vx: 0, vy: 0, restitution: 0, fixed: false }
}

async function importScene(page, objects, ground = false) {
  const scene = { version: 1, name: '元件吸附测试', gravity: false, gravityValue: 9.8, ground, friction: false, frictionValue: 0.2, trails: false, objects }
  await page.getByLabel('选择场景文件').setInputFiles({ name: 'snapping.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) })
  await expect(page.locator('.toast')).toContainText('场景已导入。')
  await expect(page.locator('.scene-item')).toHaveText(objects.map(object => object.name))
}

async function exportScene(page) {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出场景', exact: true }).click()
  const download = await downloadPromise
  return JSON.parse(await readFile(await download.path(), 'utf8'))
}

async function canvasPoint(page, point) {
  const bounds = await page.locator('canvas').boundingBox()
  if (!bounds) throw new Error('Canvas is not visible')
  const scale = Math.min(bounds.width / 900, bounds.height / 620)
  return { x: bounds.x + (bounds.width - 900 * scale) / 2 + point.x * scale, y: bounds.y + (bounds.height - 620 * scale) / 2 + point.y * scale }
}

async function dragStart(page, from) {
  const point = await canvasPoint(page, from)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
}

async function dragMove(page, to) {
  const point = await canvasPoint(page, to)
  await page.mouse.move(point.x, point.y, { steps: 6 })
}

async function dragEnd(page) {
  await page.mouse.up()
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
}

test('滑块可同时贴地和贴边，支持 Alt 绕过、拖离，小球也可贴地', async ({ page }) => {
  await importScene(page, [
    block('moving', '移动滑块', 250, 350),
    block('target', '参照滑块', 480, 516, { fixed: true }),
    { id: 'ball', type: 'ball', name: '贴地小球', x: 700, y: 350, radius: 20, mass: 1, vx: 0, vy: 0, restitution: 1, fixed: false, rodId: '' },
    { id: 'floor', type: 'ground', name: '地面', x: 60, y: 540, width: 780 },
  ], true)
  const initial = await exportScene(page)
  const target = initial.objects.find(object => object.id === 'target')
  let moving = initial.objects.find(object => object.id === 'moving')

  await dragStart(page, moving)
  await dragMove(page, { x: 406, y: 521 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('元件已吸附对齐')
  await expect(page.locator('.canvas-snap-notice')).toContainText('滑块底面已贴合地面')
  await dragEnd(page)
  let scene = await exportScene(page)
  moving = scene.objects.find(object => object.id === 'moving')
  expect(moving.x + moving.width / 2).toBeCloseTo(target.x - target.width / 2, 3)
  expect(moving.y + moving.height / 2).toBeCloseTo(540, 3)
  expect(scene.objects.find(object => object.id === target.id)).toEqual(target)

  await dragStart(page, moving)
  await page.keyboard.down('Alt')
  await dragMove(page, { x: 406, y: 521 })
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await dragEnd(page)
  await page.keyboard.up('Alt')
  moving = (await exportScene(page)).objects.find(object => object.id === 'moving')
  expect(Math.abs(moving.x - 406)).toBeLessThan(2)
  expect(Math.abs(moving.y - 521)).toBeLessThan(2)

  await dragStart(page, moving)
  await dragMove(page, { x: 300, y: 400 })
  await expect(page.locator('.canvas-snap-notice')).toHaveCount(0)
  await dragEnd(page)
  moving = (await exportScene(page)).objects.find(object => object.id === 'moving')
  expect(Math.abs(moving.x - 300)).toBeLessThan(2)
  expect(Math.abs(moving.y - 400)).toBeLessThan(2)

  const ball = initial.objects.find(object => object.id === 'ball')
  await dragStart(page, ball)
  await dragMove(page, { x: 710, y: 526 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('贴合地面')
  await dragEnd(page)
  scene = await exportScene(page)
  const resting = scene.objects.find(object => object.id === ball.id)
  expect(resting.y + resting.radius).toBeCloseTo(540, 3)
  expect(Math.abs(resting.x - 710)).toBeLessThan(2)
})

test('滑块与弧形槽可双向吸附，使用槽的真实底座边界', async ({ page }) => {
  await importScene(page, [block('moving', '移动滑块', 250, 320), arc('trough', '参照弧槽', 520, 220)])
  let initial = await exportScene(page)
  let trough = initial.objects.find(object => object.id === 'trough')
  let moving = initial.objects.find(object => object.id === 'moving')
  const base = arcBase(trough)

  await dragStart(page, moving)
  await dragMove(page, { x: base.left - moving.width / 2 + 6, y: base.bottom - moving.height / 2 + 6 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('元件已吸附对齐')
  await dragEnd(page)
  let scene = await exportScene(page)
  moving = scene.objects.find(object => object.id === 'moving')
  expect(moving.x + moving.width / 2).toBeCloseTo(base.left, 3)
  expect(moving.y + moving.height / 2).toBeCloseTo(base.bottom, 3)
  expect(scene.objects.find(object => object.id === trough.id)).toEqual(trough)

  await importScene(page, [block('target', '参照滑块', 250, 320, { fixed: true }), arc('trough', '移动弧槽', 520, 220)])
  initial = await exportScene(page)
  trough = initial.objects.find(object => object.id === 'trough')
  const target = initial.objects.find(object => object.id === 'target')
  const originalBase = arcBase(trough)
  const grab = { x: trough.cx, y: (originalBase.top + originalBase.bottom) / 2 }
  const next = { x: target.x + target.width / 2 - (originalBase.left - trough.cx), y: target.y + target.height / 2 - (originalBase.bottom - trough.cy) }
  await dragStart(page, grab)
  await dragMove(page, { x: grab.x + next.x - trough.cx + 6, y: grab.y + next.y - trough.cy + 6 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('元件已吸附对齐')
  await dragEnd(page)
  scene = await exportScene(page)
  const movedBase = arcBase(scene.objects.find(object => object.id === trough.id))
  expect(movedBase.left).toBeCloseTo(target.x + target.width / 2, 3)
  expect(movedBase.bottom).toBeCloseTo(target.y + target.height / 2, 3)
  expect(scene.objects.find(object => object.id === target.id)).toEqual(target)
})

test('滑块可堆叠并对齐中心，运行后仍按初速度独立移动', async ({ page }) => {
  await importScene(page, [
    block('moving', '移动滑块', 200, 220, { width: 60, height: 40, vx: 300 }),
    block('target', '支撑滑块', 450, 420, { width: 180, height: 50, fixed: true }),
  ])
  const initial = await exportScene(page)
  const source = initial.objects.find(object => object.id === 'moving')
  const target = initial.objects.find(object => object.id === 'target')
  await dragStart(page, source)
  await dragMove(page, { x: target.x + 7, y: target.y - target.height / 2 - source.height / 2 + 6 })
  await expect(page.locator('.canvas-snap-notice')).toContainText('元件已吸附对齐')
  await dragEnd(page)
  const moving = (await exportScene(page)).objects.find(object => object.id === source.id)
  expect(moving.x).toBeCloseTo(target.x, 3)
  expect(moving.y + moving.height / 2).toBeCloseTo(target.y - target.height / 2, 3)
  expect(moving.fixed).toBe(false)
  expect(moving.vx).toBe(source.vx)

  for (let step = 0; step < 12; step += 1) await page.getByRole('button', { name: '单步前进', exact: true }).click()
  await expect(page.getByLabel('模拟时间')).toHaveText('t = 0.20 s')
  const position = await page.getByRole('spinbutton', { name: /^位置 X(?:\s|$)/ }).inputValue()
  expect(Number(position) * 100).toBeGreaterThan(moving.x + 30)
  await expect(page.getByRole('checkbox', { name: /^固定物体/ })).not.toBeChecked()
})
