import type {
  AllocationGap, BlockKind, DryIceBatch, DryIceLine, PrecoolStation, ScheduleAllocation,
  Shipment, TempZone
} from '../types'

/** 各温区准备时长（小时）：预冷开始 = 航段起飞 - 准备时长 */
export const ZONE_PREP_HOURS: Record<TempZone, number> = { 冷藏: 4, 控温: 3, 深冷: 6 }
/** 各温区干冰消耗率（kg/小时/箱），用于按航段冻结干冰 */
export const ZONE_ICE_RATE_KG: Record<TempZone, number> = { 冷藏: 4, 控温: 3, 深冷: 10 }
export const ZONE_COLOR: Record<TempZone, string> = { 冷藏: 'blue', 控温: 'cyan', 深冷: 'geekblue' }

export function zoneOf(min: number, max: number): TempZone {
  if (min <= -20 || max <= -10) return '深冷'
  if (min >= 0 && max <= 10) return '冷藏'
  return '控温'
}

/** 仅飞行航段占用货站预冷位与干冰补给；陆运段不排 */
export function isAirSegment(segment: Shipment['segments'][number]): boolean {
  return segment.flight !== '陆运'
}

export function flightHours(segment: Shipment['segments'][number]): number {
  if (segment.flightHours && segment.flightHours > 0) return segment.flightHours
  const end = segment.actualEnd || segment.plannedStart
  const hours = (Date.parse(end) - Date.parse(segment.plannedStart)) / 3600000
  return Math.max(1, Math.round(hours * 10) / 10)
}

export function prepWindow(segment: Shipment['segments'][number], zone: TempZone) {
  const end = Date.parse(segment.plannedStart)
  const start = end - ZONE_PREP_HOURS[zone] * 3600000
  return { start, end, startISO: new Date(start).toISOString(), endISO: new Date(end).toISOString() }
}

export function iceRequired(segment: Shipment['segments'][number], zone: TempZone): number {
  return Math.round(flightHours(segment) * ZONE_ICE_RATE_KG[zone] * 10) / 10
}

const overlap = (aStart: number, aEnd: number, bStart: string, bEnd: string) =>
  aStart < Date.parse(bEnd) && Date.parse(bStart) < aEnd

export interface BatchLedger {
  batch: DryIceBatch
  frozenKg: number
  consumedKg: number
}

/** 批次余量 = 总量 - 已冻结 - 已实耗（补给完成时冻结转为实耗） */
export function batchRemaining(batch: DryIceBatch, frozenKg: number, consumedKg: number) {
  return Math.round((batch.totalKg - frozenKg - consumedKg) * 10) / 10
}

interface SlotUsage {
  /** 区间占用计数：同一温区在窗口重叠处叠加 */
  intervals: { start: number; end: number; slots: number }[]
}

interface BuildResult {
  allocations: ScheduleAllocation[]
  gaps: AllocationGap[]
  stationUsage: Record<string, SlotUsage>
  ledger: Record<string, BatchLedger>
  recalculated: number
}

export interface BuildInput {
  shipments: Shipment[]
  stations: PrecoolStation[]
  batches: DryIceBatch[]
  previous: ScheduleAllocation[]
  /** shipmentId -> 当前设备报告版本；已完成的安排不受其变化影响 */
  reportVersions: Record<string, number>
  /** 本次只重排这些任务；不传则全量重排 */
  targetShipmentIds?: string[]
  /** 只排该时间之后的航段（演示以自然日 00:00 为界，历史在途航班不进预冷队列） */
  cutoffIso?: string
  nowIso: string
  idFactory: () => string
}

/**
 * 从最后完整排程重算：
 * - 已完成 / 已补给（设备报告更新前冻结）的安排保留原批次和耗量；
 * - 已排定待补给的安排随报告版本失效重算；
 * - 排队安排不持有任何资源，直接重算；
 * - 非目标任务的既有安排原样保留并继续占用资源。
 */
export function buildSchedule(input: BuildInput): BuildResult {
  const { shipments, stations, batches, previous, reportVersions, nowIso, idFactory } = input
  const targets = new Set(input.targetShipmentIds ?? shipments.map((item) => item.id))
  const cutoff = input.cutoffIso ? Date.parse(input.cutoffIso) : 0
  const allocations: ScheduleAllocation[] = []
  const gaps: AllocationGap[] = []

  const stationUsage: Record<string, SlotUsage> = {}
  const ledger: Record<string, BatchLedger> = {}
  for (const batch of batches) {
    ledger[batch.id] = { batch, frozenKg: 0, consumedKg: 0 }
  }

  const occupySlot = (stationId: string, start: number, end: number, slots: number) => {
    const usage = stationUsage[stationId] ?? (stationUsage[stationId] = { intervals: [] })
    usage.intervals.push({ start, end, slots })
  }
  const freeSlotAt = (stationId: string, start: number, end: number, need: number) => {
    const usage = stationUsage[stationId]
    if (!usage) return true
    const station = stations.find((item) => item.id === stationId)!
    // 扫描线：在查询窗口任意时刻，区间叠加入 + 本次需求不得超过容量
    const events = usage.intervals
      .filter((item) => item.start < end && start < item.end)
      .flatMap((item) => [[Math.max(item.start, start), item.slots], [Math.min(item.end, end), -item.slots]] as [number, number][])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
    let concurrent = 0
    for (const [, delta] of events) {
      concurrent += delta
      if (concurrent + need > station.capacity) return false
    }
    return true
  }
  const reserveIce = (stationId: string, need: number): DryIceLine[] => {
    // 先试算，整票冻结成功才提交；任一批次不够则整票不扣，避免部分扣减
    let remain = need
    const planned: { batchId: string; frozenKg: number }[] = []
    for (const batch of batches.filter((item) => item.stationId === stationId)) {
      if (remain <= 0) break
      const entry = ledger[batch.id]
      const available = batchRemaining(entry.batch, entry.frozenKg, entry.consumedKg)
      if (available <= 0) continue
      const take = Math.min(available, remain)
      planned.push({ batchId: batch.id, frozenKg: Math.round(take * 10) / 10 })
      remain = Math.round((remain - take) * 10) / 10
    }
    if (remain > 0) return []
    return planned.map((item) => {
      ledger[item.batchId].frozenKg = Math.round((ledger[item.batchId].frozenKg + item.frozenKg) * 10) / 10
      return { batchId: item.batchId, frozenKg: item.frozenKg, consumedKg: 0 }
    })
  }
  const shortageAtStation = (stationId: string, need: number) => {
    let available = 0
    for (const batch of batches.filter((item) => item.stationId === stationId)) {
      const entry = ledger[batch.id]
      available += batchRemaining(entry.batch, entry.frozenKg, entry.consumedKg)
    }
    return Math.round((need - available) * 10) / 10
  }

  // 1) 保留与失效：
  //    - 已完成 / 已补给：锁定原批次与耗量，永不重算
  //    - 指纹（任务+航段+报告版本）未变的已排定/排队：原样保留并继续占用，重复提交不重复扣减
  //    - 指纹变化（设备报告更新）且未开始补给：失效，稍后按新版本重算
  let recalculated = 0
  const fingerprintOf = (item: ScheduleAllocation) => `${item.shipmentId}:${item.segmentId}:v${reportVersions[item.shipmentId] ?? 1}`
  for (const old of previous) {
    const locked = old.status === '已完成' || old.supplyStatus === '已补给'
    const unchangedActive = (old.status === '已排定' || old.status === '排队') && old.idempotencyKey === fingerprintOf(old)
    if (!locked && !unchangedActive) {
      recalculated += 1
      allocations.push({ ...old, status: '已失效', supplyStatus: '待补给', iceLines: [], blockReason: old.blockReason, scheduledAt: '', queuedAt: old.queuedAt || nowIso })
      continue
    }
    allocations.push(old)
    if (old.status === '已排定' || old.status === '已完成') {
      occupySlot(old.precoolStationId, Date.parse(old.windowStart), Date.parse(old.windowEnd), old.slotsNeeded)
      for (const line of old.iceLines) {
        const entry = ledger[line.batchId]
        if (!entry) continue
        if (old.status === '已完成' || old.supplyStatus === '已补给') entry.consumedKg += line.consumedKg || line.frozenKg
        else entry.frozenKg += line.frozenKg
      }
    }
  }

  // 2) 生成候选航段（飞行段），按预冷开始时间 + 任务号排序，先到先得
  const candidates = shipments
    .filter((shipment) => targets.has(shipment.id))
    .flatMap((shipment) => shipment.segments
      .filter(isAirSegment)
      .filter((segment) => Date.parse(segment.plannedStart) >= cutoff)
      .map((segment) => {
        const zone = zoneOf(shipment.tempMin, shipment.tempMax)
        const window = prepWindow(segment, zone)
        return { shipment, segment, zone, window, key: `${shipment.id}:${segment.id}:v${reportVersions[shipment.id] ?? 1}` }
      }))
    .sort((a, b) => a.window.start - b.window.start || a.shipment.id.localeCompare(b.shipment.id))

  // 已保留（锁定或指纹未变）的同航段安排不再重排
  const skipSegments = new Set(
    allocations
      .filter((item) => item.status !== '已失效')
      .map((item) => `${item.shipmentId}:${item.segmentId}`)
  )

  for (const candidate of candidates) {
    const { shipment, segment, zone, window, key } = candidate
    if (skipSegments.has(`${shipment.id}:${segment.id}`)) continue
    const slotsNeeded = 1
    const iceNeed = iceRequired(segment, zone)
    const base = {
      id: idFactory(), shipmentId: shipment.id, segmentId: segment.id, containerId: shipment.containerId, zone,
      windowStart: window.startISO, windowEnd: window.endISO, slotsNeeded, iceRequiredKg: iceNeed,
      sourceReportVersion: reportVersions[shipment.id] ?? 1, idempotencyKey: key, queuedAt: nowIso
    }

    // 同一温控箱在重叠预冷窗口不得占用两个冷位（两名值班员重复提交也在此拦截）
    const containerClash = allocations.some((item) =>
      item.status !== '已失效' && item.containerId === shipment.containerId &&
      overlap(window.start, window.end, item.windowStart, item.windowEnd))

    // 该温区按容量富余程度选站；容量不足时选排队人数最少的站并报缺口
    const zoneStations = stations.filter((item) => item.zone === zone)
    let chosen: PrecoolStation | undefined
    for (const station of zoneStations) {
      if (!freeSlotAt(station.id, window.start, window.end, slotsNeeded)) continue
      if (shortageAtStation(station.id, iceNeed) > 0) continue
      chosen ??= station
    }
    // 容量够但干冰全缺时，也要选出可报缺口的站
    chosen ??= zoneStations
      .filter((station) => freeSlotAt(station.id, window.start, window.end, slotsNeeded))
      .sort((a, b) => shortageAtStation(a.id, iceNeed) - shortageAtStation(b.id, iceNeed))[0]
    chosen ??= zoneStations[0]

    const slotFree = chosen ? freeSlotAt(chosen.id, window.start, window.end, slotsNeeded) : false
    const iceLines = chosen && slotFree ? reserveIce(chosen.id, iceNeed) : []
    const iceShortage = chosen ? shortageAtStation(chosen.id, iceNeed) : iceNeed

    const blockKinds: BlockKind[] = []
    if (containerClash) blockKinds.push('温控箱冲突')
    if (!slotFree) blockKinds.push('预冷位不足')
    if (iceLines.length === 0 && iceShortage > 0) blockKinds.push('干冰不足')

    if (blockKinds.length > 0 || !chosen) {
      const detailParts: string[] = []
      if (containerClash) detailParts.push(`温控箱 ${shipment.containerId} 在该预冷窗口已被另一票任务占用`)
      if (!slotFree && chosen) detailParts.push(`${chosen.name} ${fmt(window.startISO)}~${fmt(window.endISO)} 冷位已满（容量${chosen.capacity}）`)
      if (iceLines.length === 0 && iceShortage > 0 && chosen) detailParts.push(`${chosen.name} 干冰缺口 ${iceShortage}kg / 需 ${iceNeed}kg`)
      const blockReason = detailParts.join('；')
      allocations.push({
        ...base, precoolStationId: chosen?.id ?? '', iceLines: [], status: '排队', supplyStatus: '待补给',
        suppliedAt: '', blockReason, blockKinds, scheduledAt: ''
      })
      for (const kind of blockKinds) {
        gaps.push({
          allocationId: base.id, shipmentId: shipment.id, containerId: shipment.containerId, zone,
          windowStart: window.startISO, windowEnd: window.endISO, slotsNeeded, iceNeededKg: iceNeed,
          blockKind: kind, detail: blockReason
        })
      }
      continue
    }

    occupySlot(chosen.id, window.start, window.end, slotsNeeded)
    allocations.push({
      ...base, precoolStationId: chosen.id, iceLines, status: '已排定', supplyStatus: '待补给',
      suppliedAt: '', blockReason: '', blockKinds: [], scheduledAt: nowIso
    })
  }

  return { allocations: allocations.sort((a, b) => a.windowStart.localeCompare(b.windowStart)), gaps, stationUsage, ledger, recalculated }
}

export function peakUsage(usage: SlotUsage | undefined, capacity: number) {
  if (!usage) return { peakUsed: 0, available: capacity }
  const points = usage.intervals.flatMap((item) => [[item.start, item.slots], [item.end, -item.slots]] as [number, number][])
    .sort((a, b) => a[0] - b[0])
  let current = 0
  let peak = 0
  for (const [, delta] of points) { current += delta; peak = Math.max(peak, current) }
  return { peakUsed: peak, available: capacity - peak }
}

export const fmt = (iso: string) => iso.replace('T', ' ').slice(5, 16)

/* ---------- 列表 / 详情 / 审计共用的实时视图（同一份占用、余量、阻断原因） ---------- */

export function stationCapacityView(stations: PrecoolStation[], allocations: ScheduleAllocation[]): { station: PrecoolStation; peakUsed: number; available: number }[] {
  return stations.map((station) => {
    const intervals = allocations
      .filter((item) => (item.status === '已排定' || item.status === '已完成') && item.precoolStationId === station.id)
      .map((item) => ({ start: Date.parse(item.windowStart), end: Date.parse(item.windowEnd), slots: item.slotsNeeded }))
    const { peakUsed, available } = peakUsage({ intervals }, station.capacity)
    return { station, peakUsed, available }
  })
}

export interface BatchView {
  batch: DryIceBatch
  frozenKg: number
  consumedKg: number
  remainingKg: number
}

export function batchViews(batches: DryIceBatch[], allocations: ScheduleAllocation[]): BatchView[] {
  const frozen: Record<string, number> = {}
  const consumed: Record<string, number> = {}
  for (const item of allocations) {
    if (item.status === '已失效') continue
    for (const line of item.iceLines) {
      if (item.status === '已完成' || item.supplyStatus === '已补给') consumed[line.batchId] = (consumed[line.batchId] ?? 0) + (line.consumedKg || line.frozenKg)
      else frozen[line.batchId] = (frozen[line.batchId] ?? 0) + line.frozenKg
    }
  }
  return batches.map((batch) => {
    const frozenKg = Math.round((frozen[batch.id] ?? 0) * 10) / 10
    const consumedKg = Math.round((consumed[batch.id] ?? 0) * 10) / 10
    return { batch, frozenKg, consumedKg, remainingKg: batchRemaining(batch, frozenKg, consumedKg) }
  })
}

export function activeAllocations(allocations: ScheduleAllocation[]) {
  return allocations.filter((item) => item.status !== '已失效')
}

export function allocationsOfShipment(allocations: ScheduleAllocation[], shipmentId: string) {
  return allocations.filter((item) => item.shipmentId === shipmentId && item.status !== '已失效')
}

export function gapsOfShipment(gaps: AllocationGap[], shipmentId: string) {
  return gaps.filter((item) => item.shipmentId === shipmentId)
}

/** 一票任务（或其某航段）的阻断原因（任务列表/详情共用） */
export function blockReasonFor(gaps: AllocationGap[], allocations: ScheduleAllocation[], shipmentId: string, segmentId?: string): string {
  const allocationIds = new Set(allocations
    .filter((item) => item.shipmentId === shipmentId && (!segmentId || item.segmentId === segmentId))
    .map((item) => item.id))
  const mine = gaps.filter((item) => item.shipmentId === shipmentId && allocationIds.has(item.allocationId))
  if (mine.length === 0) return ''
  return [...new Set(mine.map((item) => item.blockKind))].join('、')
}
