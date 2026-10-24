import { Icon, NumberField, SelectField, Toggle } from './ui.jsx'
import { COLORS, LABELS, SCALE as PIXELS_PER_METER } from './model.js'
const CONNECTORS = new Set(['rod', 'rope', 'spring'])
const BODIES = new Set(['ball', 'block', 'arc', 'joint'])

function PositionFields({ object, onChange, xKey = 'x', yKey = 'y', prefix = '' }) {
  return (
    <>
      <NumberField label={`${prefix}位置 X`} value={object[xKey] / PIXELS_PER_METER} suffix="m" min={-100} max={100} step={0.1} onChange={(value) => onChange({ [xKey]: value * PIXELS_PER_METER })} />
      <NumberField label={`${prefix}位置 Y`} value={object[yKey] / PIXELS_PER_METER} suffix="m" min={-100} max={100} step={0.1} onChange={(value) => onChange({ [yKey]: value * PIXELS_PER_METER })} />
    </>
  )
}

function GeometryFields({ selected, onUpdateObject }) {
  const dimension = (key, label, min, max) => (
    <NumberField key={key} label={label} value={selected[key] / PIXELS_PER_METER} suffix="m" min={min} max={max} step={0.05} onChange={(value) => onUpdateObject({ [key]: value * PIXELS_PER_METER })} />
  )

  if (selected.type === 'arc') {
    return (
      <>
        {dimension('radius', '半径', 0.1, 10)}
        <NumberField label="圆心角" value={selected.angle} suffix="°" min={15} max={350} step={5} onChange={(angle) => onUpdateObject({ angle })} />
        <NumberField label="起始角" value={selected.startAngle} suffix="°" min={-360} max={360} step={5} onChange={(startAngle) => onUpdateObject({ startAngle })} />
        <PositionFields object={selected} xKey="cx" yKey="cy" onChange={onUpdateObject} />
      </>
    )
  }
  if (selected.type === 'ball') {
    return <>{dimension('radius', '半径', 0.05, 0.8)}<PositionFields object={selected} onChange={onUpdateObject} /></>
  }
  if (selected.type === 'block') {
    return <>{dimension('width', '宽度', 0.1, 3)}{dimension('height', '高度', 0.1, 3)}<PositionFields object={selected} onChange={onUpdateObject} /></>
  }
  if (selected.type === 'ground') {
    return <>{dimension('width', '宽度', 0.1, 30)}<PositionFields object={selected} onChange={onUpdateObject} /></>
  }
  if (selected.type === 'joint') return <PositionFields object={selected} onChange={onUpdateObject} />
  const lengthLabel = selected.type === 'spring' ? '原长' : selected.type === 'rope' ? '绳长' : '杆长'
  return (
    <>
      {dimension('length', lengthLabel, 0.05, 20)}
      {selected.type === 'rod' && !selected.bodyA && !selected.bodyB && (
        <NumberField label="杆倾角" value={Math.atan2(selected.by - selected.ay, selected.bx - selected.ax) * 180 / Math.PI} suffix="°" min={-180} max={180} step={5} onChange={(degrees) => {
          const angle = degrees * Math.PI / 180
          onUpdateObject({ bx: selected.ax + selected.length * Math.cos(angle), by: selected.ay + selected.length * Math.sin(angle) })
        }} />
      )}
      {selected.type === 'spring' && (
        <>
          <NumberField label="劲度系数" value={selected.stiffness ?? 30} suffix="N/m" min={0.1} max={1000} step={5} onChange={(stiffness) => onUpdateObject({ stiffness })} />
          <NumberField label="弹簧阻尼" value={selected.damping ?? 0} suffix="N·s/m" min={0} max={20} step={0.1} onChange={(damping) => onUpdateObject({ damping })} />
        </>
      )}
    </>
  )
}

function BodyFields({ selected, objects, onUpdateObject }) {
  const rods = objects.filter((object) => object.type === 'rod' && object.bodyA !== selected.id && object.bodyB !== selected.id)
  return (
    <section className="property-section" aria-label="运动参数">
      <span className="section-label">运动参数</span>
      <NumberField label="质量" value={selected.mass} suffix="kg" min={selected.type === 'joint' ? 0.001 : 0.05} max={1000} step={selected.type === 'joint' ? 0.001 : 0.1} onChange={(mass) => onUpdateObject({ mass })} />
      <NumberField label="水平速度" value={(selected.vx || 0) / PIXELS_PER_METER} suffix="m/s" min={-50} max={50} step={0.1} onChange={(value) => onUpdateObject({ vx: value * PIXELS_PER_METER })} />
      <NumberField label="竖直速度" value={(selected.vy || 0) / PIXELS_PER_METER} suffix="m/s" min={-50} max={50} step={0.1} onChange={(value) => onUpdateObject({ vy: value * PIXELS_PER_METER })} />
      {selected.type !== 'joint' && <NumberField label="恢复系数" value={selected.restitution ?? 0.8} min={0} max={1} step={0.05} onChange={(restitution) => onUpdateObject({ restitution })} />}
      <Toggle checked={selected.fixed} onChange={(fixed) => onUpdateObject({ fixed, ...(fixed ? { vx: 0, vy: 0 } : {}) })} label="固定物体" detail="固定时不受力移动" />
      {selected.type === 'arc' && <p className="property-help">槽体可在平底上滑动；开启固定后作为静止轨道。</p>}
      {selected.type === 'joint' && <p className="property-help">连接点将相连端点保持在一起，质量计入总动量；它本身不参与碰撞。</p>}
      {selected.type === 'ball' && (
        <>
          <SelectField label="杆上滑动" value={selected.rodId} onChange={(rodId) => onUpdateObject({ rodId })}>
            <option value="">自由小球</option>
            {rods.map((rod) => <option key={rod.id} value={rod.id}>{rod.name}</option>)}
          </SelectField>
          {selected.rodId && <p className="property-help">小球沿杆滑动，运动限制在两端之间。</p>}
        </>
      )}
    </section>
  )
}

function EndpointFields({ end, selected, objects, onUpdateObject, onStartConnection, connectionMode }) {
  const bodyKey = end === 'a' ? 'bodyA' : 'bodyB'
  const otherKey = end === 'a' ? 'bodyB' : 'bodyA'
  const endLabel = end.toUpperCase()
  const targets = objects.filter((object) => BODIES.has(object.type) && object.id !== selected[otherKey] && object.rodId !== selected.id)
  const endpointTargets = objects.filter(object => CONNECTORS.has(object.type) && object.id !== selected.id).flatMap(object => ['a', 'b'].flatMap(targetEnd => {
    const targetBody = object[targetEnd === 'a' ? 'bodyA' : 'bodyB']
    const body = objects.find(candidate => candidate.id === targetBody)
    if ((targetBody && targetBody === selected[otherKey]) || body?.rodId === selected.id) return []
    return [{ value: `endpoint:${JSON.stringify([object.id, targetEnd])}`, label: `${object.name} · ${targetEnd.toUpperCase()} 端` }]
  }))
  const picking = connectionMode?.id === selected.id && connectionMode?.end === end
  const changeBody = (id) => {
    // 解绑时保留当前连接点，避免锚点跳回旧坐标。
    const previous = objects.find((object) => object.id === selected[bodyKey])
    onUpdateObject({ [bodyKey]: id, ...(!id && previous ? { [`${end}x`]: previous.type === 'arc' ? previous.cx : previous.x, [`${end}y`]: previous.type === 'arc' ? previous.cy : previous.y } : {}) })
  }

  return (
    <div className="endpoint-fields">
      <SelectField label={`端点 ${endLabel}`} value={selected[bodyKey]} onChange={changeBody}>
        <option value="">固定锚点</option>
        {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
        {endpointTargets.length > 0 && <optgroup label="连接件端点">{endpointTargets.map(target => <option key={target.value} value={target.value}>{target.label}</option>)}</optgroup>}
      </SelectField>
      {!selected[bodyKey] && <PositionFields object={selected} xKey={`${end}x`} yKey={`${end}y`} prefix={`${endLabel} `} onChange={onUpdateObject} />}
      <button type="button" className={`connect-inline${picking ? ' active' : ''}`} onClick={() => onStartConnection(end)} aria-pressed={picking}>
        <Icon name="link" size={14} />
        {picking ? `请点选端点 ${endLabel} 的连接目标` : `在画布连接端点 ${endLabel}`}
      </button>
    </div>
  )
}

function EnvironmentFields({ environment, onEnvironmentChange }) {
  return (
    <section className="environment-section" aria-label="环境设置">
      <span className="section-label">环境</span>
      <Toggle label="地面" detail="显示地面并启用碰撞" checked={environment.ground} onChange={(ground) => onEnvironmentChange({ ground })} />
      <Toggle label="重力" detail="竖直向下" checked={environment.gravity} onChange={(gravity) => onEnvironmentChange({ gravity })} />
      {environment.gravity && <NumberField label="重力加速度" value={environment.gravityValue ?? 9.8} suffix="m/s²" min={0} max={30} step={0.1} onChange={(gravityValue) => onEnvironmentChange({ gravityValue })} />}
      <Toggle label="摩擦" detail="接触面摩擦" checked={environment.friction} onChange={(friction) => onEnvironmentChange({ friction })} />
      {environment.friction && <NumberField label="摩擦系数" value={environment.frictionValue ?? 0.2} min={0} max={1} step={0.05} onChange={(frictionValue) => onEnvironmentChange({ frictionValue })} />}
      <Toggle label="显示轨迹" detail="记录小球与滑块的运动路径" checked={environment.trails} onChange={(trails) => onEnvironmentChange({ trails })} />
    </section>
  )
}

export default function Inspector({ selected, objects, environment, onEnvironmentChange, onUpdateObject, onDelete, onStartConnection, connectionMode }) {
  return (
    <aside className="right-panel" aria-label="检查器">
      <div className="panel-heading inspector-heading"><h2>检查器</h2>{selected && <span className="selection-dot" />}</div>
      {selected ? (
        <div key={selected.id}>
          <div className="selected-object">
            <span className="selected-symbol" style={{ '--selected-color': COLORS[selected.type] }}><Icon name={selected.type} size={22} /></span>
            <div><strong>{selected.name}</strong><small>{LABELS[selected.type]}{selected.type === 'joint' ? ` · ${selected.mass} kg` : ''}</small></div>
            <button className="icon-button delete-object" type="button" title="删除选中元件" aria-label="删除选中元件" onClick={onDelete}><Icon name="trash" size={15} /></button>
          </div>
          <label className="property-field name-field">
            <span>名称</span>
            <input type="text" aria-label="元件名称" defaultValue={selected.name} maxLength={32} onBlur={(event) => {
              const name = event.target.value.trim().slice(0, 32) || LABELS[selected.type]
              event.target.value = name
              if (name !== selected.name) onUpdateObject({ name })
            }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
          </label>
          <section className="property-section" aria-label="几何参数">
            <span className="section-label">几何参数</span>
            <GeometryFields selected={selected} onUpdateObject={onUpdateObject} />
          </section>
          {BODIES.has(selected.type) && <BodyFields selected={selected} objects={objects} onUpdateObject={onUpdateObject} />}
          {CONNECTORS.has(selected.type) && (
            <section className="property-section" aria-label="连接端点">
              <span className="section-label">连接端点</span>
              <p className="property-help">可选择其他杆、绳或弹簧的端点，两端将共用连接点。</p>
              <EndpointFields end="a" selected={selected} objects={objects} onUpdateObject={onUpdateObject} onStartConnection={onStartConnection} connectionMode={connectionMode} />
              <EndpointFields end="b" selected={selected} objects={objects} onUpdateObject={onUpdateObject} onStartConnection={onStartConnection} connectionMode={connectionMode} />
            </section>
          )}
        </div>
      ) : (
        <div className="empty-inspector"><div className="empty-sketch"><Icon name="select" size={30} /></div><strong>选择一个元件</strong><p>点击画布中的对象，即可调整参数。</p></div>
      )}
      <EnvironmentFields environment={environment} onEnvironmentChange={onEnvironmentChange} />
    </aside>
  )
}
