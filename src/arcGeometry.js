export const ARC_WALL_HALF = 3
export const ARC_BASE_MARGIN = 12
export const ARC_BASE_GAP = 6
export const ARC_BASE_HEIGHT = 18

export function angleOnArc(degrees, start, sweep) {
  return ((degrees - start) % 360 + 360) % 360 <= sweep + 1e-7
}

export function arcBounds(arc) {
  const start = arc.startAngle ?? 0
  const sweep = arc.angle ?? 180
  const angles = [start, start + sweep, ...[0, 90, 180, 270].filter(angle => angleOnArc(angle, start, sweep))]
  const points = angles.map(degrees => ({ x: arc.cx + arc.radius * Math.cos(degrees * Math.PI / 180), y: arc.cy + arc.radius * Math.sin(degrees * Math.PI / 180) }))
  return { left: Math.min(...points.map(point => point.x)), right: Math.max(...points.map(point => point.x)), top: Math.min(...points.map(point => point.y)), bottom: Math.max(...points.map(point => point.y)) }
}

export function arcBase(arc) {
  const bounds = arcBounds(arc)
  const top = bounds.bottom + ARC_BASE_GAP
  return { left: bounds.left - ARC_BASE_MARGIN, right: bounds.right + ARC_BASE_MARGIN, top, bottom: top + ARC_BASE_HEIGHT }
}

export function verticalTangentCenters(arc, ballRadius) {
  const distance = arc.radius - ballRadius - ARC_WALL_HALF
  if (distance <= 0) return []
  return [0, 180].filter(angle => angleOnArc(angle, arc.startAngle ?? 0, arc.angle ?? 180)).map(angle => ({
    x: arc.cx + (angle === 0 ? distance : -distance),
    y: arc.cy,
    contactX: arc.cx + (angle === 0 ? arc.radius : -arc.radius),
    side: angle === 0 ? 'right' : 'left',
  }))
}
