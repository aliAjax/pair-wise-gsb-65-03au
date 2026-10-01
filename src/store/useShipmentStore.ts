import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedAudit, seedBatches, seedDeviations, seedReservations, seedShipments, seedSlots } from '../data/seed'
import { invalidateForReport, planReservations } from '../services/schedulingEngine'
import type {
  AuditEntry, Deviation, DryIceBatch, EvidenceFile, PendingWrite, PreCoolSlot,
  Reservation, Shipment, ShipmentStatus
} from '../types'

/** 演示基准时刻：所有排程窗口围绕该时刻，避免真实时钟导致占用变化 */
export const NOW_ISO = '2026-10-01T12:00:00'

interface Result { ok: boolean; message: string }

interface ShipmentState {
  shipments: Shipment[]
  deviations: Deviation[]
  audit: AuditEntry[]
  slots: PreCoolSlot[]
  batches: DryIceBatch[]
  reservations: Reservation[]
  pendingWrites: PendingWrite[]
  /** 演练开关：打开后下一次落盘写入失败，验证从最后完整排程重试 */
  failNextWrite: boolean
  keyword: string
  status: ShipmentStatus | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: ShipmentStatus | '全部') => void
  addEvidence: (shipmentId: string, evidence: Omit<EvidenceFile, 'id' | 'version' | 'uploadedAt'>) => Result
  verifyEvidence: (shipmentId: string, evidenceId: string) => void
  /** 设备值班员上报新设备报告：未开始的补给安排失效并重算，已完成的保留原批次与耗量；delayMinutes 模拟报告中的起飞延误 */
  receiveEquipmentReport: (shipmentId: string, operator: string, delayMinutes?: number) => Result
  sign: (shipmentId: string, role: string, comment: string, status: '已签' | '已退回') => Result
  createDeviation: (shipmentId: string, segmentId: string, title: string, severity: '一般' | '重大') => void
  saveInvestigation: (id: string, patch: Partial<Deviation>) => void
  reviewDeviation: (id: string, disposition: Deviation['disposition'], note: string) => Result
  setShipmentStatus: (id: string, status: ShipmentStatus) => Result
  /** 提交（或重放）排程：幂等，重复操作不重复扣减；写入失败进暂存等待重试 */
  submitReservation: (shipmentId: string, operator: string) => Result
  planAll: (operator: string) => Result
  retryPendingWrites: () => Result
  markPreCooled: (reservationId: string, operator: string) => Result
  confirmSupply: (reservationId: string, suppliedKg: number, operator: string) => Result
  setFailNextWrite: (value: boolean) => void
  reset: () => void
}

let idSeed = 10
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`
const makeId = (prefix: string) => `${prefix}-${(idSeed++).toString().padStart(4, '0')}`

function makeAudit(shipmentId: string, action: string, operator: string, detail: string, category?: AuditEntry['category'], reservationId?: string): AuditEntry {
  return { id: nextId('AUD'), shipmentId, action, operator, detail, createdAt: NOW_ISO, category, reservationId }
}

/** 初始即做一次全量排程，保证列表、详情、审计看到同一套占用与余量 */
const initialPlan = planReservations({
  shipments: structuredClone(seedShipments), slots: structuredClone(seedSlots),
  batches: structuredClone(seedBatches), reservations: structuredClone(seedReservations),
  nowIso: NOW_ISO, makeId
})

/** 演练开关：打开后下一次落盘写入失败，业务数据保持最后完整排程，仅留失败审计 */
const failGuard = (state: ShipmentState): boolean => {
  if (!state.failNextWrite) return false
  state.failNextWrite = false
  return true
}

export const useShipmentStore = create<ShipmentState>()(persist((set, get) => ({
  shipments: structuredClone(seedShipments),
  deviations: structuredClone(seedDeviations),
  audit: structuredClone(seedAudit),
  slots: structuredClone(seedSlots),
  batches: structuredClone(seedBatches),
  reservations: initialPlan.reservations,
  pendingWrites: [],
  failNextWrite: false,
  keyword: '',
  status: '全部',
  setKeyword: (keyword) => set({ keyword }),
  setStatus: (status) => set({ status }),

  addEvidence: (shipmentId, evidence) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return { ok: false, message: '运输任务不存在' }
    if (shipment.evidence.some((item) => item.category === evidence.category && item.name === evidence.name)) {
      return { ok: true, message: '相同证据已存在，未重复创建' }
    }
    // 演练写入失败：在改动前拦截，内存与持久层都保持最后完整排程
    if (state.failNextWrite) {
      state.failNextWrite = false
      set((current) => ({ audit: [makeAudit('系统', '写入失败', '持久化层', '检测到演练开关：证据上传未落盘，已保留最后完整排程作为重试基线'), ...current.audit] }))
      return { ok: false, message: '写入失败：证据未落盘，可重新上传' }
    }
    const sameCount = shipment.evidence.filter((item) => item.category === evidence.category).length
    shipment.evidence.unshift({ ...evidence, id: nextId('E'), version: sameCount + 1, uploadedAt: NOW_ISO })
    shipment.version += 1
    shipment.updatedAt = NOW_ISO
    set((current) => ({ shipments: [...current.shipments], audit: [makeAudit(shipmentId, '上传证据版本', evidence.uploadedBy, `${evidence.name} 版本${sameCount + 1}`, '证据'), ...current.audit] }))
    return { ok: true, message: '证据版本已保存' }
  },

  verifyEvidence: (shipmentId, evidenceId) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    const evidence = shipment?.evidence.find((item) => item.id === evidenceId)
    if (!shipment || !evidence || evidence.verified) return state
    evidence.verified = true
    shipment.version += 1
    return { shipments: [...state.shipments], audit: [makeAudit(shipmentId, '核验证据', '当前用户', evidence.name, '证据'), ...state.audit] }
  }),

  receiveEquipmentReport: (shipmentId, operator, delayMinutes = 0) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return { ok: false, message: '运输任务不存在' }
    const touchable = state.reservations.filter((item) => item.shipmentId === shipmentId && (item.status === '已排程' || item.status === '排队中'))
    if (touchable.length === 0) return { ok: false, message: '没有未开始的补给安排，已完成记录保持不变' }

    // 同一批改动先在工作副本上完成：航段延误 → 失效 → 全量重算（原子落盘）
    const workShipments = structuredClone(state.shipments)
    const workShipment = workShipments.find((item) => item.id === shipmentId)!
    const newVersion = Math.max(0, ...workShipment.evidence.filter((item) => item.category === '设备报告').map((item) => item.version)) + 1
    workShipment.evidence.unshift({
      id: nextId('E'), name: `${shipment.containerId}设备报告V${newVersion}.pdf`, category: '设备报告',
      version: newVersion, uploadedBy: operator, uploadedAt: NOW_ISO, verified: true
    })
    workShipment.version += 1
    workShipment.updatedAt = NOW_ISO
    if (delayMinutes > 0) {
      const shiftMs = delayMinutes * 60000
      for (const segment of workShipment.segments) {
        if (segment.flight === '陆运') continue
        segment.plannedStart = new Date(new Date(segment.plannedStart).getTime() + shiftMs).toISOString()
        if (segment.actualEnd) segment.actualEnd = new Date(new Date(segment.actualEnd).getTime() + shiftMs).toISOString()
      }
      workShipment.plannedDeparture = new Date(new Date(workShipment.plannedDeparture).getTime() + shiftMs).toISOString()
    }

    let workReservations = structuredClone(state.reservations)
    const before = workReservations.filter((item) => item.shipmentId === shipmentId && (item.status === '已排程' || item.status === '排队中'))
    workReservations = invalidateForReport(workReservations, shipmentId, newVersion, NOW_ISO)
    const plan = planReservations({ shipments: workShipments, slots: structuredClone(state.slots), batches: structuredClone(state.batches), reservations: workReservations, nowIso: NOW_ISO, makeId })
    workReservations = plan.reservations

    const draftAudit: AuditEntry[] = [
      makeAudit(shipmentId, '设备报告更新', operator, `设备报告更新至V${newVersion}${delayMinutes > 0 ? `，起飞延误${delayMinutes}分钟` : ''}：${before.length}项未开始的预冷/干冰安排失效并重新计算，已完成记录保留原批次和耗量`, '排程')
    ]
    for (const reservation of plan.planned) {
      draftAudit.push(makeAudit(reservation.shipmentId,
        reservation.status === '排队中' ? '排程排队' : '位次与干冰重排',
        operator, describeReservation(reservation), '排程', reservation.id))
    }
    if (failGuard(state)) {
      set((current) => ({
        audit: [
          makeAudit(shipmentId, '写入失败', '持久化层', `设备报告V${newVersion}更新未落盘：未开始安排仍占用原资源，可重试，重复操作不重复扣减`),
          ...current.audit
        ]
      }))
      return { ok: false, message: '写入失败：设备报告更新未落盘，保留最后完整排程，请重试' }
    }

    set((current) => ({
      shipments: workShipments,
      reservations: workReservations,
      audit: [...draftAudit.reverse(), ...current.audit]
    }))
    return { ok: true, message: `设备报告V${newVersion}已接收，未开始的安排已重算` }
  },

  sign: (shipmentId, role, comment, status) => {
    const shipment = get().shipments.find((item) => item.id === shipmentId)
    const signature = shipment?.signatures.find((item) => item.role === role)
    if (!shipment || !signature) return { ok: false, message: '签收角色不存在' }
    if (status === '已退回' && !comment.trim()) return { ok: false, message: '退回必须填写原因' }
    signature.status = status
    signature.comment = comment
    signature.signedAt = NOW_ISO
    shipment.version += 1
    shipment.updatedAt = signature.signedAt
    set((state) => ({ shipments: [...state.shipments], audit: [makeAudit(shipmentId, `${role}${status}`, signature.name, comment || '签署确认', '签收'), ...state.audit] }))
    return { ok: true, message: status === '已签' ? '签收成功' : '已退回并要求补充材料' }
  },

  createDeviation: (shipmentId, segmentId, title, severity) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return state
    const deviation: Deviation = {
      id: nextId('TDEV'), shipmentId, segmentId, title, source: '人工报告', severity, status: '待调查', owner: '温控质量组', openedAt: NOW_ISO,
      dueDate: NOW_ISO.slice(0, 10), cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '', version: 1
    }
    shipment.status = '待放行'
    shipment.version += 1
    return { deviations: [deviation, ...state.deviations], shipments: [...state.shipments], audit: [makeAudit(shipmentId, '登记温度偏差', '当前用户', title, '偏差'), ...state.audit] }
  }),

  saveInvestigation: (id, patch) => set((state) => {
    const deviation = state.deviations.find((item) => item.id === id)
    if (!deviation || !patch.cause?.trim() || !patch.assessment?.trim()) return state
    Object.assign(deviation, patch, { status: '待放行复核', version: deviation.version + 1 })
    return { deviations: [...state.deviations], audit: [makeAudit(deviation.shipmentId, '提交偏差调查', deviation.owner, deviation.assessment, '偏差'), ...state.audit] }
  }),

  reviewDeviation: (id, disposition, note) => {
    const deviation = get().deviations.find((item) => item.id === id)
    if (!deviation) return { ok: false, message: '偏差不存在' }
    if (disposition === '拒绝' && !note.trim()) return { ok: false, message: '拒绝放行必须填写理由' }
    deviation.disposition = disposition
    deviation.reviewer = '放行人员 顾言'
    deviation.reviewNote = note
    deviation.status = '已关闭'
    deviation.version += 1
    const shipment = get().shipments.find((item) => item.id === deviation.shipmentId)
    if (shipment) shipment.status = disposition === '拒绝' ? '已拒绝' : '待放行'
    set((state) => ({ deviations: [...state.deviations], shipments: [...state.shipments], audit: [makeAudit(deviation.shipmentId, `偏差复核：${disposition}`, deviation.reviewer, note, '偏差'), ...state.audit] }))
    return { ok: true, message: `已执行${disposition}` }
  },

  setShipmentStatus: (id, status) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === id)
    if (!shipment) return { ok: false, message: '运输任务不存在' }
    const open = state.deviations.some((item) => item.shipmentId === id && item.status !== '已关闭')
    if (status === '已放行' && open) return { ok: false, message: '存在未关闭温度偏差，不能放行' }
    if (status === '已放行' && shipment.evidence.some((item) => !item.verified)) return { ok: false, message: '仍有证据未核验' }
    if (status === '已放行' && shipment.signatures.some((item) => item.role !== '放行人员' && item.status !== '已签')) return { ok: false, message: '多角色签收未完成' }
    shipment.status = status
    shipment.version += 1
    shipment.updatedAt = NOW_ISO
    set((current) => ({ shipments: [...current.shipments], audit: [makeAudit(id, `状态流转：${status}`, '当前用户', '放行工作台操作', '放行'), ...current.audit] }))
    return { ok: true, message: `状态已更新为${status}` }
  },

  submitReservation: (shipmentId, operator) => {
    const state = get()
    const pending = state.pendingWrites.find((item) => item.action === 'submitReservation' && item.shipmentId === shipmentId)
    if (pending) return { ok: false, message: '存在失败的排程提交，系统将从最后完整排程重试，不重复扣减' }
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return { ok: false, message: '运输任务不存在' }
    const airSegments = shipment.segments.filter((segment) => segment.flight !== '陆运')
    const reportVersion = Math.max(0, ...shipment.evidence.filter((item) => item.category === '设备报告').map((item) => item.version))
    // 幂等：同一任务+航段+报告版本已有有效安排，直接返回既有占用
    const duplicate = state.reservations.find((item) =>
      item.shipmentId === shipmentId && item.status !== '已失效' && item.reportVersion === reportVersion
      && airSegments.some((segment) => segment.id === item.segmentId))
    if (duplicate) {
      return { ok: true, message: `幂等命中：${duplicate.status === '排队中' ? '该票仍在排队' : '位次与干冰冻结已存在'}，未重复扣减` }
    }

    // 从最后完整排程重算：当前 reservations 即最后完整落盘的一致快照
    const plan = planReservations({
      shipments: structuredClone(state.shipments), slots: structuredClone(state.slots),
      batches: structuredClone(state.batches), reservations: structuredClone(state.reservations),
      nowIso: NOW_ISO, makeId
    })
    const draftAudit: AuditEntry[] = []
    for (const reservation of plan.planned) {
      draftAudit.push(makeAudit(reservation.shipmentId,
        reservation.status === '排队中' ? '排程排队' : '预留预冷位并冻结干冰',
        operator, describeReservation(reservation), '排程', reservation.id))
    }
    const pendingWrite: PendingWrite = {
      action: 'submitReservation', shipmentId, reservationId: '', operator,
      idempotencyKey: `${shipmentId}:V${reportVersion}`, createdAt: NOW_ISO
    }
    if (failGuard(state)) {
      const failAudit: AuditEntry[] = [
        makeAudit('系统', '写入失败', '持久化层', '检测到演练开关：排程提交未落盘，位次与干冰均未扣减，已登记待重试'),
        ...draftAudit
      ]
      // 不落盘：计算结果丢弃，只登记待重试；干冰与位次都没有被扣过
      set((current) => ({ pendingWrites: [...current.pendingWrites, pendingWrite], audit: [...failAudit.reverse(), ...current.audit] }))
      return { ok: false, message: '写入失败：已保留最后完整排程，可一键重试，重复提交不会重复扣减' }
    }
    set((current) => ({ reservations: plan.reservations, audit: [...draftAudit.reverse(), ...current.audit] }))
    const mine = plan.planned.filter((item) => item.shipmentId === shipmentId)
    const queued = mine.filter((item) => item.status === '排队中')
    return {
      ok: true,
      message: queued.length === mine.length
        ? `容量不足已排队：${queued.map((item) => item.blockReason).join('、')}`
        : `已为${mine.length - queued.length}个航段预留位次并冻结干冰${queued.length ? `，${queued.length}个航段排队（${queued.map((item) => item.blockReason).join('、')}）` : ''}`
    }
  },

  planAll: (operator) => {
    const state = get()
    const pending = state.pendingWrites.filter((item) => item.action === 'submitReservation')
    if (pending.length > 0) return { ok: false, message: '存在失败暂存，请先“从最后完整排程重试”' }
    const plan = planReservations({
      shipments: structuredClone(state.shipments), slots: structuredClone(state.slots),
      batches: structuredClone(state.batches), reservations: structuredClone(state.reservations),
      nowIso: NOW_ISO, makeId
    })
    const draftAudit = plan.planned.map((reservation) => makeAudit(reservation.shipmentId,
      reservation.status === '排队中' ? '排程排队' : '预留预冷位并冻结干冰',
      operator, describeReservation(reservation), '排程', reservation.id))
    if (failGuard(state)) {
      set((current) => ({
        audit: [makeAudit('系统', '写入失败', '持久化层', '全量排程未落盘，占用与余量保持最后完整状态，可重试'), ...draftAudit.reverse(), ...current.audit]
      }))
      return { ok: false, message: '写入失败：全量排程未落盘，请重试' }
    }
    set((current) => ({ reservations: plan.reservations, audit: [...draftAudit.reverse(), ...current.audit] }))
    return { ok: true, message: `全量排程完成：${plan.planned.filter((item) => item.status === '已排程').length}项落位，${plan.planned.filter((item) => item.status === '排队中').length}项排队` }
  },

  retryPendingWrites: () => {
    const state = get()
    if (state.pendingWrites.length === 0) return { ok: true, message: '没有待重试的写入' }
    const writes = state.pendingWrites
    // 先摘下暂存再重放：成功即清空；仍失败的动作会自行重新登记，可继续重试
    set({ pendingWrites: [] })
    const results: string[] = []
    for (const write of writes) {
      if (write.action === 'submitReservation') {
        const result = get().submitReservation(write.shipmentId, write.operator)
        results.push(`${write.shipmentId}：${result.message}`)
      } else if (write.action === 'confirmSupply') {
        const result = get().confirmSupply(write.reservationId, write.payload?.suppliedKg ?? 0, write.operator)
        results.push(`${write.reservationId}：${result.message}`)
      }
    }
    return { ok: true, message: `已从最后完整排程重试：${results.join('；')}` }
  },

  markPreCooled: (reservationId, operator) => {
    const state = get()
    const reservation = state.reservations.find((item) => item.id === reservationId)
    if (!reservation) return { ok: false, message: '排程安排不存在' }
    if (reservation.status === '已预冷' || reservation.status === '已补给') return { ok: true, message: '预冷已完成，重复操作不重复扣减' }
    if (reservation.status !== '已排程') return { ok: false, message: `当前为「${reservation.status}」，不能登记预冷完成` }
    reservation.status = '已预冷'
    reservation.updatedAt = NOW_ISO
    set((current) => ({ reservations: [...current.reservations], audit: [makeAudit(reservation.shipmentId, '预冷到位', operator, `${reservation.slotId} 预冷窗 ${reservation.preCoolStart.replace('T', ' ').slice(5, 16)} ~ ${reservation.preCoolEnd.replace('T', ' ').slice(5, 16)}，温控箱 ${reservation.containerId}`, '排程', reservation.id), ...current.audit] }))
    return { ok: true, message: '预冷完成已登记' }
  },

  confirmSupply: (reservationId, suppliedKg, operator) => {
    const state = get()
    const reservation = state.reservations.find((item) => item.id === reservationId)
    if (!reservation) return { ok: false, message: '排程安排不存在' }
    // 幂等：已完成补给永久保留原批次与实际耗量
    if (reservation.status === '已补给') return { ok: true, message: `幂等命中：已按原批次实装${reservation.suppliedKg}kg，未重复扣减` }
    if (reservation.status !== '已预冷') return { ok: false, message: `当前为「${reservation.status}」，需先完成预冷` }
    if (suppliedKg <= 0) return { ok: false, message: '实装干冰量必须大于0' }
    if (suppliedKg !== reservation.frozenKg) return { ok: false, message: `实装量须与冻结量一致（${reservation.frozenKg}kg）；数量有变请先更新设备报告触发重排` }

    const pending = state.pendingWrites.find((item) => item.action === 'confirmSupply' && item.reservationId === reservationId)
    if (pending) return { ok: false, message: '该补给已有失败写入，等待重试，不重复扣减' }

    // 原子落盘：冻结量转批次实耗，安排转为已补给
    const workBatches = structuredClone(state.batches)
    for (const allocation of reservation.allocations) {
      const batch = workBatches.find((item) => item.id === allocation.batchId)
      if (!batch) return { ok: false, message: `干冰批次 ${allocation.batchId} 不存在` }
      if (batch.receivedKg - batch.consumedKg < allocation.kg) return { ok: false, message: `批次 ${allocation.batchId} 余量不足，冻结后已被其他变动占用` }
    }
    const pendingWrite: PendingWrite = {
      action: 'confirmSupply', shipmentId: reservation.shipmentId, reservationId, operator,
      idempotencyKey: reservation.idempotencyKey || reservation.id, payload: { suppliedKg }, createdAt: NOW_ISO
    }
    const draftAudit: AuditEntry[] = []
    if (state.failNextWrite) {
      state.failNextWrite = false
      set((current) => ({
        pendingWrites: [...current.pendingWrites, pendingWrite],
        audit: [makeAudit(reservation.shipmentId, '写入失败', '持久化层', '补给确认未落盘，冻结量保持占用，等待从最后完整排程重试；重复操作不重复扣减', '排程', reservation.id), ...current.audit]
      }))
      return { ok: false, message: '写入失败：干冰未实际扣减，可重试，重复操作不重复扣减' }
    }
    for (const allocation of reservation.allocations) {
      const batch = workBatches.find((item) => item.id === allocation.batchId)!
      batch.consumedKg += allocation.kg
    }
    reservation.status = '已补给'
    reservation.suppliedKg = suppliedKg
    reservation.suppliedAt = NOW_ISO
    reservation.updatedAt = NOW_ISO
    const detail = `${reservation.containerId} 实装${suppliedKg}kg（冻结${reservation.frozenKg}kg），批次：${reservation.allocations.map((item) => `${item.batchId} ${item.kg}kg`).join('、')}`
    set((current) => ({
      batches: workBatches,
      reservations: [...current.reservations],
      audit: [makeAudit(reservation.shipmentId, '干冰补给确认', operator, detail, '排程', reservation.id), ...current.audit]
    }))
    return { ok: true, message: `已确认补给${suppliedKg}kg，批次耗量已记账` }
  },

  setFailNextWrite: (value) => set({ failNextWrite: value }),

  reset: () => {
    const fresh = planReservations({
      shipments: structuredClone(seedShipments), slots: structuredClone(seedSlots),
      batches: structuredClone(seedBatches), reservations: structuredClone(seedReservations),
      nowIso: NOW_ISO, makeId
    })
    set({
      shipments: structuredClone(seedShipments), deviations: structuredClone(seedDeviations),
      audit: structuredClone(seedAudit), slots: structuredClone(seedSlots), batches: structuredClone(seedBatches),
      reservations: fresh.reservations, pendingWrites: [], failNextWrite: false, keyword: '', status: '全部'
    })
  }
}), {
  name: 'gsb65:temperature-chain-v2',
  version: 2,
  migrate: (persisted: unknown, version: number) => {
    const state = (persisted ?? {}) as Partial<ShipmentState>
    if (version >= 2) return state
    // v1 本地缓存没有预冷位/干冰/排程切片：补齐种子并以其为准做一次全量排程
    const fresh = planReservations({
      shipments: state.shipments ? structuredClone(state.shipments) : structuredClone(seedShipments),
      slots: structuredClone(seedSlots),
      batches: structuredClone(seedBatches),
      reservations: structuredClone(seedReservations),
      nowIso: NOW_ISO,
      makeId
    })
    return {
      ...state,
      slots: structuredClone(seedSlots),
      batches: structuredClone(seedBatches),
      reservations: fresh.reservations,
      pendingWrites: [],
      failNextWrite: false
    }
  }
}))

function describeReservation(reservation: Reservation): string {
  const window = reservation.preCoolStart
    ? `${reservation.slotId} ${reservation.preCoolStart.replace('T', ' ').slice(5, 16)}~${reservation.preCoolEnd.replace('T', ' ').slice(11, 16)}`
    : `等待 ${reservation.station} 预冷位释放`
  const ice = reservation.frozenKg
    ? `冻结干冰${reservation.frozenKg}kg（${reservation.allocations.map((item) => `${item.batchId} ${item.kg}kg`).join('、')}）`
    : `干冰需求${reservation.iceRequiredKg}kg`
  if (reservation.status === '排队中') {
    const gaps: string[] = []
    if (reservation.slotGap > 0) gaps.push(`预冷位缺口${Math.round(reservation.slotGap)}分钟`)
    if (reservation.iceGapKg > 0) gaps.push(`干冰缺口${reservation.iceGapKg}kg`)
    return `${reservation.containerId} 排队等待：${gaps.join('、')}（${window}；${ice}），阻断原因：${reservation.blockReason}`
  }
  return `${reservation.containerId} 占用 ${window}；${ice}`
}
