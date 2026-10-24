import { useCallback, useEffect, useRef, useState } from 'react'
import SimulationCanvas from './SimulationCanvas.jsx'
import Inspector from './Inspector.jsx'
import { Icon } from './ui.jsx'
import { integrate, endpoints, measure } from './physics.js'
import { alignGuides, cloneScene, COLORS, createScene, LABELS, makeObject, parseScene, PRESETS, removeObject, STORAGE_KEY, TYPES } from './model.js'

const HINTS = { arc: '半径 / 圆心角', block: '质量与初速度', ball: '自由运动 / 沿杆滑动', rod: '保持两端距离', rope: '绷紧时产生拉力', spring: '胡克定律', ground: '有限碰撞平面' }
const IS_BODY = object => object && ['ball', 'block'].includes(object.type)
const IS_CONNECTOR = object => object && ['rod', 'rope', 'spring'].includes(object.type)
const FIXED_DT = 1 / 120

function readSavedScene() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return { scene: saved ? parseScene(saved) : createScene(), message: '' }
  } catch {
    return { scene: createScene(), message: '无法读取上次场景，已打开默认实验。' }
  }
}

function Toolbox({ onAdd, objects, selectedId, onSelect }) {
  return <aside className="left-panel" aria-label="元件库">
    <div className="panel-heading"><h2>元件库</h2><span className="count-mark">{TYPES.length}</span></div>
    <p className="panel-note">拖入画布，或点击添加。</p>
    <div className="tool-list">{TYPES.map(type => <button type="button" key={type} className="tool-card" aria-label={`添加${LABELS[type]}`} draggable onDragStart={event => event.dataTransfer.setData('application/x-momentum-tool', type)} onClick={() => onAdd(type)}>
      <span className="tool-icon" style={{ '--tool-color': COLORS[type] }}><Icon name={type} size={22} /></span>
      <span className="tool-copy"><strong>{LABELS[type]}</strong><small>{HINTS[type]}</small></span><span className="tool-plus"><Icon name="plus" size={14} /></span>
    </button>)}</div>
    <div className="scene-list"><div className="section-label-row"><span className="section-label">场景元件</span><span className="object-count">{objects.length} / 60</span></div>
      <div className="scene-list-items">{objects.map(object => <button className={`scene-item ${selectedId === object.id ? 'is-selected' : ''}`} aria-pressed={selectedId === object.id} key={object.id} onClick={() => onSelect(object.id)}><span style={{ color: COLORS[object.type] }}><Icon name={object.type} size={15} /></span><span>{object.name}</span>{object.fixed && <Icon name="lock" size={12} />}</button>)}</div>
      {!objects.length && <p className="panel-note">从上方添加第一个元件。</p>}
    </div>
    <div className="tip-card"><Icon name="pencil" size={17} /><div><strong>让想法动起来</strong><p>连接件的空端点是固定锚点。将 A、B 两端接到物体，就能搭建自己的实验。</p></div></div>
  </aside>
}

function HelpDialog({ onClose }) {
  const dialogRef = useRef(null)
  useEffect(() => { dialogRef.current.showModal() }, [])
  return <dialog ref={dialogRef} className="help-dialog" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="dialog-heading"><h2>从一张草图开始</h2><button aria-label="关闭使用说明" className="icon-button" onClick={onClose}><Icon name="close" /></button></div>
    <ol><li>拖入或点击添加元件。在画布上拖动，选中后在检查器中改参数。</li><li>添加杆、绳或弹簧，分别设置端点 A、B；未连接的端点固定在空间中。</li><li>选中小球，在“杆上滑动”中选择杆，小球便成为可滑动的套环。</li><li>开启或关闭地面、重力与摩擦，设置初速度，然后点击运行。空格可暂停。</li><li>重置恢复到本次运行前的布局；修改参数会暂停模拟，并将当前位置作为新起点。</li></ol>
    <p>画布坐标向右、向下为正，100 px 对应 1 m。无外力时，系统总动量守恒；固定锚点、地面和弧槽可向系统施加外力。</p>
    <p className="model-note">二维教学模型：滑块不旋转，杆、绳、弹簧无质量，弧槽固定。滑块与弧槽接触使用支撑半径近似；数值积分存在小量误差。</p>
    <button className="button button-primary" onClick={onClose}>开始实验</button>
  </dialog>
}

export default function App() {
  const [boot] = useState(readSavedScene)
  const [design, setDesign] = useState(boot.scene)
  const [frame, setFrame] = useState(null)
  const designRef = useRef(design)
  const frameRef = useRef(null)
  const [running, setRunning] = useState(false)
  const [simTime, setSimTime] = useState(0)
  const timeRef = useRef(0)
  const [speed, setSpeed] = useState(1)
  const [selectedId, setSelectedId] = useState(design.objects[0]?.id || null)
  const [connectionMode, setConnectionMode] = useState(null)
  const [saveState, setSaveState] = useState('正在保存')
  const [message, setMessage] = useState(boot.message)
  const [showHelp, setShowHelp] = useState(false)
  const importRef = useRef(null)
  const scene = frame || design
  const selected = scene.objects.find(object => object.id === selectedId)
  const metrics = measure(scene.objects)

  useEffect(() => {
    setSaveState('正在保存')
    const timeout = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(design)); setSaveState('已保存到本机') }
      catch { setSaveState('本机保存不可用') }
    }, 300)
    return () => clearTimeout(timeout)
  }, [design])

  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(() => setMessage(''), 5500)
    return () => clearTimeout(timer)
  }, [message])

  const edit = useCallback(updater => {
    setRunning(false)
    const current = frameRef.current || designRef.current
    const result = typeof updater === 'function' ? updater(current) : updater
    const next = { ...result, objects: alignGuides(result.objects) }
    designRef.current = next
    frameRef.current = null
    timeRef.current = 0
    setDesign(next); setFrame(null); setSimTime(0)
  }, [])

  const reset = useCallback(() => {
    setRunning(false); setFrame(null); setSimTime(0); setConnectionMode(null)
    frameRef.current = null; timeRef.current = 0
  }, [])

  const toggleRunning = useCallback(() => { setConnectionMode(null); setRunning(value => !value) }, [])
  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    edit(current => {
      const next = removeObject(current, selectedId)
      return { ...next, ground: next.objects.some(object => object.type === 'ground') && next.ground }
    })
    setSelectedId(null); setConnectionMode(null)
  }, [edit, selectedId])

  useEffect(() => {
    const keydown = event => {
      if (event.key === 'Escape' && !showHelp) { setConnectionMode(null); return }
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target?.tagName) || event.target?.isContentEditable || showHelp) return
      if (event.code === 'Space') { event.preventDefault(); toggleRunning() }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelected() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [toggleRunning, deleteSelected, showHelp])

  useEffect(() => {
    if (!running) return undefined
    let last = null
    let accumulator = 0
    let request
    const animate = now => {
      if (last !== null) {
        accumulator += Math.min((now - last) / 1000, 0.05) * speed
        let current = frameRef.current || cloneScene(designRef.current)
        while (accumulator >= FIXED_DT) {
          current = { ...current, objects: integrate(current.objects, current, FIXED_DT) }
          accumulator -= FIXED_DT
          timeRef.current += FIXED_DT
        }
        const invalid = current.objects.some(object => (IS_BODY(object) && [object.x, object.y, object.vx, object.vy].some(value => !Number.isFinite(value))))
        if (invalid) { setRunning(false); setMessage('当前组合计算不稳定，已暂停。请减小初速度或弹簧劲度。'); return }
        frameRef.current = current
        setFrame(current); setSimTime(timeRef.current)
      }
      last = now
      request = requestAnimationFrame(animate)
    }
    request = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(request)
  }, [running, speed])

  const step = () => {
    setRunning(false)
    const current = frameRef.current || cloneScene(designRef.current)
    const next = { ...current, objects: integrate(current.objects, current, 1 / 60) }
    frameRef.current = next; timeRef.current += 1 / 60
    setFrame(next); setSimTime(timeRef.current)
  }

  const addObject = (type, point) => {
    if (scene.objects.length >= 60) { setMessage('最多支持 60 个元件，请先删除一些元件。'); return }
    const count = scene.objects.filter(object => object.type === type).length
    const position = point || { x: 440 + count * 25, y: type === 'ground' ? 535 : 220 + count * 20 }
    const object = makeObject(type, position.x, position.y)
    object.name = `${LABELS[type]} ${count + 1}`
    edit(current => ({ ...current, objects: [...current.objects, object], ...(type === 'ground' ? { ground: true } : {}) }))
    setSelectedId(object.id); setConnectionMode(null)
  }

  const updateObject = changes => {
    if (!selected) return
    const updated = { ...selected, ...changes }
    if (IS_CONNECTOR(updated)) {
      if (updated.bodyA && updated.bodyA === updated.bodyB) { setMessage('两个端点需要连接不同的物体。'); return }
      if (scene.objects.some(object => object.rodId === updated.id && [updated.bodyA, updated.bodyB].includes(object.id))) { setMessage('套在杆上的小球不能同时作为该杆的端点。'); return }
      const { a, b } = endpoints(updated, scene.objects)
      if (('bodyA' in changes || 'bodyB' in changes) && selected.type !== 'spring') updated.length = Math.max(5, Math.hypot(b.x - a.x, b.y - a.y))
      if (selected.type === 'rod' && 'length' in changes) {
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        if (!updated.bodyB) { updated.bx = a.x + Math.cos(angle) * updated.length; updated.by = a.y + Math.sin(angle) * updated.length }
        else if (!updated.bodyA) { updated.ax = b.x - Math.cos(angle) * updated.length; updated.ay = b.y - Math.sin(angle) * updated.length }
      } else if (selected.type === 'rod' && ['ax', 'ay', 'bx', 'by'].some(key => key in changes)) updated.length = Math.max(5, Math.hypot(b.x - a.x, b.y - a.y))
    }
    if (updated.type === 'ball' && changes.rodId) {
      const rod = scene.objects.find(object => object.id === changes.rodId)
      if (rod) {
        const { a, b } = endpoints(rod, scene.objects)
        const dx = b.x - a.x; const dy = b.y - a.y
        const t = Math.max(0, Math.min(1, ((updated.x - a.x) * dx + (updated.y - a.y) * dy) / Math.max(1, dx * dx + dy * dy)))
        updated.x = a.x + dx * t; updated.y = a.y + dy * t
      }
    }
    edit(current => ({ ...current, objects: current.objects.map(object => {
      if (object.id === updated.id) return updated
      if (updated.type === 'rod' && object.rodId === updated.id) {
        const oldEnds = endpoints(selected, current.objects)
        const newEnds = endpoints(updated, current.objects)
        const dx = oldEnds.b.x - oldEnds.a.x; const dy = oldEnds.b.y - oldEnds.a.y
        const t = Math.max(0, Math.min(1, ((object.x - oldEnds.a.x) * dx + (object.y - oldEnds.a.y) * dy) / Math.max(1, dx * dx + dy * dy)))
        return { ...object, x: newEnds.a.x + (newEnds.b.x - newEnds.a.x) * t, y: newEnds.a.y + (newEnds.b.y - newEnds.a.y) * t }
      }
      return object
    }) }))
  }

  const moveObject = (id, dx, dy) => {
    edit(current => {
      const target = current.objects.find(object => object.id === id)
      if (!target) return current
      const movedIds = new Set([id])
      if (IS_CONNECTOR(target)) { if (target.bodyA) movedIds.add(target.bodyA); if (target.bodyB) movedIds.add(target.bodyB) }
      if (target.type === 'rod') current.objects.filter(object => object.rodId === id).forEach(object => movedIds.add(object.id))
      return { ...current, objects: current.objects.map(object => {
        if (!movedIds.has(object.id)) return object
        if (object.type === 'arc') return { ...object, cx: object.cx + dx, cy: object.cy + dy }
        if (IS_CONNECTOR(object)) return { ...object, ax: object.ax + dx, ay: object.ay + dy, bx: object.bx + dx, by: object.by + dy }
        return { ...object, x: object.x + dx, y: object.y + dy }
      }) }
    })
  }

  const moveEndpoint = (id, end, point) => {
    edit(current => ({ ...current, objects: current.objects.map(object => {
      if (object.id !== id) return object
      const next = { ...object, [end === 'a' ? 'bodyA' : 'bodyB']: '', [`${end}x`]: point.x, [`${end}y`]: point.y }
      if (next.type !== 'spring') { const { a, b } = endpoints(next, current.objects); next.length = Math.max(5, Math.hypot(b.x - a.x, b.y - a.y)) }
      return next
    }) }))
  }

  const startConnection = end => {
    if (!IS_CONNECTOR(selected)) return
    setRunning(false)
    setConnectionMode(mode => mode?.id === selected.id && mode.end === end ? null : { id: selected.id, end })
  }
  const pickConnection = id => {
    if (!connectionMode || !IS_BODY(scene.objects.find(object => object.id === id))) return
    updateObject({ [connectionMode.end === 'a' ? 'bodyA' : 'bodyB']: id })
    setConnectionMode(null)
  }
  const select = id => { setSelectedId(id); setConnectionMode(null) }

  const changePreset = value => {
    const next = createScene(value)
    edit(next); setSelectedId(next.objects[0]?.id || null); setConnectionMode(null)
  }
  const updateEnvironment = changes => edit(current => {
    const next = { ...current, ...changes }
    if (changes.ground && !current.objects.some(object => object.type === 'ground')) {
      if (current.objects.length >= 60) { setMessage('元件已达上限，请先删除一个元件再开启地面。'); return current }
      const floor = { ...makeObject('ground', 450, 535), x: 65, width: 770 }
      next.objects = [...current.objects, floor]
    }
    return next
  })
  const exportScene = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(designRef.current, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'momentum-scene.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setMessage('实验初始场景已导出为 JSON 文件。')
  }
  const importScene = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if (file.size > 1_000_000) throw new Error('Scene file too large')
      const next = parseScene(await file.text())
      edit(next); setSelectedId(next.objects[0]?.id || null); setConnectionMode(null); setMessage('场景已导入。')
    } catch { setMessage('无法导入，请选择本工具导出的场景 JSON 文件（不超过 1 MB）。') }
    event.target.value = ''
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><span /><span /><span /></span><div><strong>MOMENTUM LAB</strong><small>动量实验室</small></div></div>
      <div className="document-title"><span className="status-dot" />{scene.name}</div>
      <div className="topbar-right"><span className="save-state"><span className="save-dot" />{saveState}</span><span className="topbar-divider" /><div className="file-actions">
        <button className="icon-button" aria-label="导入场景" title="导入场景" onClick={() => importRef.current.click()}><Icon name="upload" size={16} /></button>
        <button className="icon-button" aria-label="导出场景" title="导出初始场景" onClick={exportScene}><Icon name="download" size={16} /></button>
        <button className="icon-button" aria-label="使用说明" title="使用说明" onClick={() => setShowHelp(true)}><Icon name="help" size={16} /></button>
      </div><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importScene} aria-label="选择场景文件" /></div>
    </header>
    <main className="workspace">
      <Toolbox onAdd={addObject} objects={scene.objects} selectedId={selectedId} onSelect={select} />
      <section className="stage" aria-label="模拟实验">
        <div className="stage-toolbar"><div className="stage-title"><h1>把物理，画出来。</h1><p>搭建一个场景，观察每一次动量传递。</p></div><label className="preset-picker"><span>实验示例</span><select aria-label="加载实验示例" value="" onChange={event => changePreset(event.target.value)}><option value="" disabled>选择示例</option>{PRESETS.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label></div>
        <div className="simulation-toolbar"><div className="playback-actions"><button className={`button ${running ? 'button-soft' : 'button-primary'}`} aria-label={running ? '暂停模拟' : '运行模拟'} onClick={toggleRunning}><Icon name={running ? 'pause' : 'play'} size={14} />{running ? '暂停' : '运行'}</button><button className="icon-button" aria-label="重置模拟" title="恢复运行前的布局" onClick={reset}><Icon name="reset" size={17} /></button><button className="icon-button" aria-label="单步前进" title="前进 1/60 秒" onClick={step}><Icon name="step" size={16} /></button><select className="speed-picker" aria-label="模拟速度" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></div><div className="stage-meta"><span className={`live-pill ${running ? 'live' : ''}`}><span />{running ? '运行中' : '已暂停'}</span><output className="time-readout" aria-label="模拟时间">t = {simTime.toFixed(2)} s</output><button className="clear-button" onClick={() => { edit(current => ({ ...current, ground: false, objects: [], name: '自由实验' })); select(null) }}>清空</button></div></div>
        <div className="canvas-wrap"><SimulationCanvas objects={scene.objects} groundEnabled={scene.ground} selectedId={selectedId} onSelect={select} onMove={moveObject} onDropTool={addObject} connectionMode={connectionMode} onConnectionPick={pickConnection} onCancelConnection={() => setConnectionMode(null)} onEndpointMove={moveEndpoint} /></div>
        <div className="measurement-strip" aria-label="实时测量"><div><span>水平总动量 <i>pₓ</i></span><output data-testid="momentum-x">{metrics.px.toFixed(3)} <small>kg·m/s</small></output></div><div><span>竖直总动量 <i>pᵧ</i></span><output data-testid="momentum-y">{metrics.py.toFixed(3)} <small>kg·m/s</small></output></div><div><span>总动能 <i>Eₖ</i></span><output data-testid="kinetic-energy">{metrics.kineticEnergy.toFixed(3)} <small>J</small></output></div></div>
        <div className="stage-footer"><span>100 px = 1 m · 右 / 下为正</span><span className="footer-spacer" /><span className="shortcut-key">空格</span><span>运行 / 暂停</span></div>
      </section>
      <Inspector selected={selected} objects={scene.objects} environment={scene} onEnvironmentChange={updateEnvironment} onUpdateObject={updateObject} onDelete={deleteSelected} onStartConnection={startConnection} connectionMode={connectionMode} />
    </main>
    {message && <div className="toast" role="status">{message}<button aria-label="关闭提示" onClick={() => setMessage('')}><Icon name="close" size={14} /></button></div>}
    {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
  </div>
}
