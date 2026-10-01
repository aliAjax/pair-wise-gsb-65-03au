import type {
  BlockReason, DryIceBatch, IceAllocation, PreCoolSlot, Reservation, ReservationStatus,
  Shipment, ShipmentSegment, TempZone, TempZoneId
} from '../types'

/** 温区规则：温区决定预冷位池与干冰消耗速率 */
export const TEMP_ZONES: Record<TempZoneId, TempZone> = {
  'Z2-8': { id: 'Z2-8', label: '2~8℃ 冷藏', iceRatePerHour: 2, preCoolHours: 4 },
  'Z2-25': { id: 'Z2-25', label: '-2~-25℃ 干冰', iceRatePerHour: 3, preCoolHours: 6 },
  'Z15-25': { id: 'Z15-25', label: '-15~-25℃ 深冷', iceRatePerHour: 4, preCoolHours: 8 }
}

/** 按航段温控范围推导温区 */
export function resolveZone(tempMin: number, tempMax: number): TempZoneId {
  if (tempMax <= -15) return 'Z15-25'
  if (tempMax <= 8) return 'Z2-8'
  return 'Z2-25'
}

export function toMinutes(iso: string): number {
  return new Date(iso).getTime() / 60000
}

export function toIso(minutes: number): string {
  return new Date(minutes * 60000).toISOString()
}

/** 单航段干冰需求 = (预冷时长 + 航段飞行时长) × 温区小时耗量 */
export function requiredIceKg(zone: TempZoneId, preCoolMinutes: number, flightMinutes: number): number {
  const rate = TEMP_ZONES[zone].iceRatePerHour
  return Math.ceil(((preCoolMinutes + flightMinutes) / 60) * rate)
}

/** 批次余量 = 到货 - 已完成耗用 - 在途冻结 */
export function batchRemaining(batch: DryIceBatch, frozen = 0): number {
  return batch.receivedKg - batch.consumedKg - frozen
}

/** 仍需排程的航段：非陆运、未完成、且该航段没有有效安排（已失效安排不占位，重新排程） */
export function derivePendingSegments(shipments: Shipment[], existing: Reservation[]): { shipment: Shipment; segment: ShipmentSegment }[] {
  const activeKeys = new Set(
    existing.filter((item) => item.status !== '已失效').map((item) => `${item.shipmentId}:${item.segmentId}`)
  )
  const result: { shipment: Shipment; segment: ShipmentSegment }[] = []
  for (const shipment of shipments) {
    for (const segment of shipment.segments) {
      if (segment.flight === '陆运') continue
      if (activeKeys.has(`${shipment.id}:${segment.id}`)) continue
      result.push({ shipment, segment })
    }
  }
  // 相同的提交顺序：先按预冷开始时间，再按任务编号，两名值班员看到同一张表
  return result.sort((a, b) => toMinutes(a.segment.plannedStart) - toMinutes(b.segment.plannedStart) || a.shipment.id.localeCompare(b.shipment.id))
}

interface Interval { start: number; end: number }

/** 该温区+货站的预冷位在给定窗口内已占用的区间（预冷结束即释放） */
function occupiedIntervals(slot: PreCoolSlot, reservations: Reservation[], excludeId?: string): Interval[] {
  return reservations
    .filter((item) => item.id !== excludeId && item.slotId === slot.id && item.status !== '已失效' && item.status !== '排队中' && item.preCoolStart)
    .map((item) => ({ start: toMinutes(item.preCoolStart), end: toMinutes(item.preCoolEnd) }))
}

/** 目标窗口是否与既有占用重叠（半开区间，相邻交接不算冲突） */
function overlaps(start: number, end: number, intervals: Interval[]): boolean {
  return intervals.some((interval) => start < interval.end && end > interval.start)
}

interface SlotPick { slot: PreCoolSlot; preCoolStart: number; preCoolEnd: number; gap: number }

/**
 * 选取预冷位：优先整窗可放下的位次；放不下时给出缺口最小的位次（排队并列出缺口）。
 * 同分时按预冷位编号，结果确定。
 */
export function pickSlot(
  slots: PreCoolSlot[], zone: TempZoneId, station: string,
  desiredStart: number, duration: number, reservations: Reservation[], excludeId?: string
): SlotPick | null {
  const candidates = slots.filter((slot) => slot.zone === zone && slot.station === station)
  let best: SlotPick | null = null
  for (const slot of candidates) {
    const intervals = occupiedIntervals(slot, reservations, excludeId)
    const desiredEnd = desiredStart + duration
    if (!overlaps(desiredStart, desiredEnd, intervals)) {
      const candidate = { slot, preCoolStart: desiredStart, preCoolEnd: desiredEnd, gap: 0 }
      if (!best || candidate.gap < best.gap || (candidate.gap === best.gap && candidate.slot.id < best.slot.id)) best = candidate
      continue
    }
    // 找期望开始时间之后第一个能连续容纳的空档
    const sorted = intervals.sort((a, b) => a.start - b.start)
    let cursor = desiredStart
    for (const interval of sorted) {
      if (interval.end <= cursor) continue
      if (cursor + duration <= interval.start) break
      cursor = Math.max(cursor, interval.end)
    }
    const gap = cursor - desiredStart
    const candidate = { slot, preCoolStart: cursor, preCoolEnd: cursor + duration, gap }
    if (!best || gap < best.gap || (gap === best.gap && slot.id < best.slot.id)) best = candidate
  }
  return best
}

/** 按批次顺序先到先分，余量不足时给出缺口；仅冻结，不动实际库存 */
export function allocateIce(
  requiredKg: number, batches: DryIceBatch[], frozenByBatch: Record<string, number>
): { allocations: IceAllocation[]; gapKg: number } {
  let need = requiredKg
  const allocations: IceAllocation[] = []
  const ordered = [...batches].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id))
  for (const batch of ordered) {
    if (need <= 0) break
    const remaining = batchRemaining(batch, frozenByBatch[batch.id] ?? 0)
    if (remaining <= 0) continue
    const take = Math.min(remaining, need)
    allocations.push({ batchId: batch.id, kg: take })
    need -= take
  }
  return { allocations, gapKg: Math.max(0, need) }
}

export interface PlanInput {
  shipments: Shipment[]
  slots: PreCoolSlot[]
  batches: DryIceBatch[]
  /** 已存在的安排（失效重算时传入剔除失效项后的工作集） */
  reservations: Reservation[]
  nowIso: string
  makeId: (prefix: string) => string
}

export interface PlanResult {
  reservations: Reservation[]
  planned: Reservation[]
}

/** 纯函数全量重排：基于候选安排逐个占位、冻结干冰；容量不足则排队并列缺口 */
export function planReservations(input: PlanInput): PlanResult {
  const { shipments, slots, batches, makeId } = input
  // 已完成（已预冷/已补给）与已失效历史原样保留不动
  const working = input.reservations.filter((item) => !['已失效'].includes(item.status))
  const planned: Reservation[] = []
  const frozenByBatch: Record<string, number> = {}
  const accountFrozen = (allocations: IceAllocation[]) => {
    for (const allocation of allocations) frozenByBatch[allocation.batchId] = (frozenByBatch[allocation.batchId] ?? 0) + allocation.kg
  }
  for (const reservation of working) {
    if (reservation.status === '已排程' || reservation.status === '排队中') accountFrozen(reservation.allocations)
  }

  const pending = derivePendingSegments(shipments, working)
  for (const { shipment, segment } of pending) {
    const zone = resolveZone(shipment.tempMin, shipment.tempMax)
    const duration = TEMP_ZONES[zone].preCoolHours * 60
    const departure = toMinutes(segment.plannedStart)
    const desiredStart = departure - duration
    const flightMinutes = Math.max(0, toMinutes(segment.actualEnd || segment.plannedStart) - departure)
    const iceRequired = requiredIceKg(zone, duration, flightMinutes)
    const station = segment.from
    const pick = pickSlot(slots, zone, station, desiredStart, duration, working)
    const { allocations, gapKg } = allocateIce(iceRequired, batches, frozenByBatch)
    const slotGap = pick?.gap ?? 0
    const schedulable = pick !== null && pick.gap === 0 && gapKg === 0

    const reportVersion = Math.max(
      0,
      ...shipment.evidence.filter((item) => item.category === '设备报告').map((item) => item.version)
    )
    const timestamp = input.nowIso
    const base: Reservation = {
      id: makeId('RSV'),
      shipmentId: shipment.id,
      segmentId: segment.id,
      containerId: shipment.containerId,
      station,
      zone,
      preCoolStart: '',
      preCoolEnd: '',
      slotId: pick?.slot.id ?? '',
      slotGap,
      iceRequiredKg: iceRequired,
      iceGapKg: gapKg,
      allocations: schedulable ? allocations : [],
      status: '排队中',
      blockReason: '',
      frozenKg: 0,
      suppliedKg: 0,
      suppliedAt: '',
      reportVersion,
      idempotencyKey: '',
      queuedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastError: ''
    }

    if (schedulable && pick) {
      base.status = '已排程'
      base.preCoolStart = toIso(pick.preCoolStart)
      base.preCoolEnd = toIso(pick.preCoolEnd)
      base.frozenKg = iceRequired - gapKg
      accountFrozen(allocations)
      base.lastError = ''
    } else {
      const reason: BlockReason = pick && pick.gap > 0 && gapKg > 0
        ? '预冷位与干冰均不足'
        : gapKg > 0 ? '干冰余量不足' : '预冷位容量不足'
      base.blockReason = reason
      base.lastError = reason
    }
    working.push(base)
    planned.push(base)
  }

  // 容量释放后按 FIFO 补位（排队序号 = queuedAt，相同提交时刻按任务编号）
  let moved = true
  while (moved) {
    moved = false
    const queued = working
      .filter((item) => item.status === '排队中')
      .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt) || a.shipmentId.localeCompare(b.shipmentId))
    for (const reservation of queued) {
      const duration = TEMP_ZONES[reservation.zone].preCoolHours * 60
      const shipment = shipments.find((item) => item.id === reservation.shipmentId)
      const segment = shipment?.segments.find((item) => item.id === reservation.segmentId)
      if (!shipment || !segment) continue
      const departure = toMinutes(segment.plannedStart)
      const desiredStart = departure - duration
      const pick = pickSlot(slots, reservation.zone, reservation.station, desiredStart, duration, working, reservation.id)
      const { allocations, gapKg } = allocateIce(reservation.iceRequiredKg, batches, frozenByBatch)
      if (pick && pick.gap === 0 && gapKg === 0) {
        reservation.slotId = pick.slot.id
        reservation.slotGap = 0
        reservation.preCoolStart = toIso(pick.preCoolStart)
        reservation.preCoolEnd = toIso(pick.preCoolEnd)
        reservation.allocations = allocations
        reservation.iceGapKg = 0
        reservation.frozenKg = reservation.iceRequiredKg
        reservation.status = '已排程'
        reservation.blockReason = ''
        reservation.updatedAt = input.nowIso
        accountFrozen(allocations)
        planned.push(reservation)
        moved = true
      } else {
        reservation.slotGap = pick?.gap ?? reservation.slotGap
        reservation.iceGapKg = gapKg
      }
    }
  }

  return { reservations: working, planned }
}

/** 设备报告更新：未开始（排队中/已排程）的安排失效并重算，已完成保留原批次与耗量 */
export function invalidateForReport(
  reservations: Reservation[], shipmentId: string, newReportVersion: number, nowIso: string
): Reservation[] {
  return reservations.map((reservation) => {
    if (reservation.shipmentId !== shipmentId) return reservation
    if (reservation.status !== '已排程' && reservation.status !== '排队中') return reservation
    return {
      ...reservation,
      status: '已失效',
      blockReason: '',
      slotId: '',
      allocations: [],
      frozenKg: 0,
      updatedAt: nowIso,
      lastError: `设备报告更新至V${newReportVersion}，未开始的安排失效重算`
    }
  })
}

export function statusColor(status: ReservationStatus): string {
  switch (status) {
    case '已排程': return 'processing'
    case '排队中': return 'warning'
    case '已预冷': return 'cyan'
    case '已补给': return 'success'
    case '已失效': return 'default'
  }
}
