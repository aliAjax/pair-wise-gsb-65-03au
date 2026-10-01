import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { seedAudit, seedDeviations, seedIceBatches, seedShipments, seedStations } from '../data/seed'
import { buildSchedule } from '../services/scheduling'
import type {
  AllocationGap, AuditEntry, Deviation, DryIceBatch, EvidenceFile, PrecoolStation,
  ScheduleAllocation, Shipment, ShipmentStatus
} from '../types'

interface SubmitResult {
  ok: boolean
  message: string
  scheduled?: number
  queued?: number
  duplicate?: number
  invalidated?: number
  gaps?: AllocationGap[]
  /** 写入失败后从最后完整排程重试成功 */
  retried?: boolean
}

interface ShipmentState {
  shipments: Shipment[]
  deviations: Deviation[]
  audit: AuditEntry[]
  stations: PrecoolStation[]
  iceBatches: DryIceBatch[]
  allocations: ScheduleAllocation[]
  gaps: AllocationGap[]
  reportVersions: Record<string, number>
  scheduleSeq: number
  keyword: string
  status: ShipmentStatus | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: ShipmentStatus | '全部') => void
  /** 两名值班员同时提交：按航段原子预留冷位+冻结干冰；重复操作不重复扣减 */
  submitSchedule: (shipmentIds: string[], operator: string) => SubmitResult
  /** 设备报告更新：未开始补给的安排失效重算，已完成/已补给的保留原批次与耗量 */
  applyDeviceReport: (shipmentId: string, operator: string) => SubmitResult
  /** 执行干冰补给：冻结量转为批次实耗，安排锁定不再随报告失效 */
  supplyAllocation: (allocationId: string, operator: string) => SubmitResult
  /** 预冷补给已实际完成 */
  completeAllocation: (allocationId: string, operator: string) => SubmitResult
  addEvidence: (shipmentId: string, evidence: Omit<EvidenceFile, 'id' | 'version' | 'uploadedAt'>) => void
  verifyEvidence: (shipmentId: string, evidenceId: string) => void
  sign: (shipmentId: string, role: string, comment: string, status: '已签' | '已退回') => { ok: boolean; message: string }
  createDeviation: (shipmentId: string, segmentId: string, title: string, severity: '一般' | '重大') => void
  saveInvestigation: (id: string, patch: Partial<Deviation>) => void
  reviewDeviation: (id: string, disposition: Deviation['disposition'], note: string) => { ok: boolean; message: string }
  setShipmentStatus: (id: string, status: ShipmentStatus) => { ok: boolean; message: string }
  reset: () => void
}

let idSeed = 10
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idSeed++}`

/** 设备报告版本以该任务“设备报告”类证据的最高版本为准 */
function reportVersionsOf(shipments: Shipment[]): Record<string, number> {
  const versions: Record<string, number> = {}
  for (const shipment of shipments) {
    versions[shipment.id] = Math.max(1, ...shipment.evidence.filter((item) => item.category === '设备报告').map((item) => item.version))
  }
  return versions
}

const STORAGE_KEY = 'gsb65:temperature-chain-v2'

/**
 * 持久化适配器：armNextWriteFailure 让下一次写入抛错，用于演示
 * “写入失败 → 从最后完整排程重试”。
 */
let nextWriteFails = false
export function armNextWriteFailure() { nextWriteFails = true }

function transactionStorage(): Storage {
  return {
    getItem: (name) => localStorage.getItem(name),
    removeItem: (name) => localStorage.removeItem(name),
    clear: () => localStorage.clear(),
    key: (index) => localStorage.key(index),
    get length() { return localStorage.length },
    setItem: (name, value) => {
      if (nextWriteFails) {
        nextWriteFails = false
        throw new Error('模拟持久化写入失败：存储暂不可用')
      }
      localStorage.setItem(name, value)
    }
  }
}

export const useShipmentStore = create<ShipmentState>()(persist((set, get) => {
  /**
   * 事务提交：先把完整快照写入持久层，成功后才更新内存；
   * 写入失败则不改变任何状态，从最后完整排程重新计算并重试一次。
   * zustand persist 自身会吞掉存储异常，所以这里显式预写。
   */
  const commit = (patch: Partial<ShipmentState>, auditEntries: AuditEntry[], label: string): SubmitResult => {
    const next: Partial<ShipmentState> = { ...patch, audit: [...auditEntries, ...get().audit] }
    const snapshot = () => {
      const state = get()
      return JSON.stringify({ state: {
        shipments: state.shipments, deviations: state.deviations, audit: next.audit,
        stations: state.stations, iceBatches: state.iceBatches,
        allocations: next.allocations ?? state.allocations, gaps: next.gaps ?? state.gaps,
        reportVersions: next.reportVersions ?? state.reportVersions,
        scheduleSeq: next.scheduleSeq ?? state.scheduleSeq,
        keyword: state.keyword, status: state.status
      }, version: 0 })
    }
    try {
      if (typeof window !== 'undefined') transactionStorage().setItem(STORAGE_KEY, snapshot())
    } catch (error) {
      // 内存未改动（仍是最后完整排程）；按当前状态重新取数并重试一次
      try {
        if (typeof window !== 'undefined') transactionStorage().setItem(STORAGE_KEY, snapshot())
        set(next)
        return { ok: true, retried: true, message: `${label}写入失败，已从最后完整排程重试成功`, scheduled: 0, queued: 0, gaps: next.gaps ?? [] }
      } catch (retryError) {
        return { ok: false, message: `${label}写入失败且重试未成功：${(retryError as Error).message}` }
      }
    }
    set(next)
    return { ok: true, message: '', gaps: next.gaps ?? [] }
  }

  /** 从当前（最后完整）排程出发重算目标任务 */
  const todayStart = () => new Date().toISOString().slice(0, 10)
  const rebuild = (targetShipmentIds: string[] | undefined) => {
    const state = get()
    return buildSchedule({
      shipments: state.shipments,
      stations: state.stations,
      batches: state.iceBatches,
      previous: state.allocations,
      reportVersions: state.reportVersions,
      targetShipmentIds,
      cutoffIso: todayStart(),
      nowIso: new Date().toISOString(),
      idFactory: () => nextId('SCH')
    })
  }

  return {
    shipments: seedShipments,
    deviations: seedDeviations,
    audit: seedAudit,
    stations: seedStations,
    iceBatches: seedIceBatches,
    allocations: [],
    gaps: [],
    reportVersions: reportVersionsOf(seedShipments),
    scheduleSeq: 1,
    keyword: '',
    status: '全部',
    setKeyword: (keyword) => set({ keyword }),
    setStatus: (status) => set({ status }),

    submitSchedule: (shipmentIds, operator) => {
      const state = get()
      const ids = shipmentIds.length ? shipmentIds : state.shipments.map((item) => item.id)

      // 幂等：同一指纹（任务+航段+设备报告版本）已有活跃安排的航段直接跳过，不重复扣冷位/干冰
      const activeFingerprints = new Set(
        state.allocations.filter((item) => item.status === '已排定' || item.status === '排队').map((item) => item.idempotencyKey)
      )
      const versionOf = (shipmentId: string) => state.reportVersions[shipmentId] ?? 1
      const fingerprintExists = (shipmentId: string, segmentId: string) =>
        activeFingerprints.has(`${shipmentId}:${segmentId}:v${versionOf(shipmentId)}`)

      const pendingShipments = ids.filter((shipmentId) => {
        const shipment = state.shipments.find((item) => item.id === shipmentId)
        return shipment?.segments.some((segment) => segment.flight !== '陆运' && !fingerprintExists(shipmentId, segment.id))
      })
      const duplicateCount = ids.length - pendingShipments.length
      if (pendingShipments.length === 0) {
        // 纯幂等命中：不触发持久化事务（也不消耗“模拟写入失败”开关），重复操作零写入、零扣减
        set({ audit: [makeAudit('*', '重复提交排程（幂等拦截）', operator,
          `值班员对 ${ids.join('、')} 重复提交，活跃排程指纹全部命中，未重复占用冷位或扣减干冰`), ...get().audit] })
        return { ok: true, message: '提交内容与现有排程一致，已忽略重复操作，未重复扣减', duplicate: duplicateCount, scheduled: 0, queued: 0, gaps: [] }
      }

      const built = rebuild(pendingShipments)
      // 仅统计本次新建的安排（保留项沿用原 id，由历史审计覆盖）
      const previousIds = new Set(state.allocations.map((item) => item.id))
      const created = built.allocations.filter((item) => !previousIds.has(item.id))
      const queuedIds = new Set(created.filter((item) => item.status === '排队').map((item) => item.id))
      const newScheduled = created.filter((item) => item.status === '已排定').length
      const newGaps = built.gaps.filter((item) => queuedIds.has(item.allocationId) || !previousIds.has(item.allocationId))
      const auditEntries = [makeAudit(pendingShipments.join(','), '提交货站排程', operator,
        `按航段温区与准备时长预留预冷位、按航段冻结干冰：本次新建排定 ${newScheduled} 项、排队 ${queuedIds.size} 项`
        + (duplicateCount ? `；另有 ${duplicateCount} 票重复提交被幂等拦截` : '')
        + (newGaps.length ? `；缺口：${[...new Set(newGaps.map((item) => item.blockKind))].join('、')}` : ''))]

      const result = commit(
        { allocations: built.allocations, gaps: built.gaps, scheduleSeq: state.scheduleSeq + 1 },
        auditEntries, '排程'
      )
      if (!result.ok) return result
      result.scheduled = newScheduled
      result.queued = queuedIds.size
      result.duplicate = duplicateCount
      result.message = result.retried
        ? `${result.message}：排定 ${newScheduled} 项、排队 ${queuedIds.size} 项，占用与余量未重复扣减`
        : `排定 ${newScheduled} 项预冷/补给安排，${queuedIds.size} 项容量不足进入排队并列出缺口`
        + (duplicateCount ? `；${duplicateCount} 票重复提交已拦截` : '')
      return result
    },

    applyDeviceReport: (shipmentId, operator) => {
      const state = get()
      const shipment = state.shipments.find((item) => item.id === shipmentId)
      if (!shipment) return { ok: false, message: '运输任务不存在' }

      const staleBefore = state.allocations.filter((item) =>
        item.shipmentId === shipmentId && item.status !== '已完成' && item.supplyStatus !== '已补给'
        && (item.status === '已排定' || item.status === '排队'))
      const lockedBefore = state.allocations.filter((item) =>
        item.shipmentId === shipmentId && (item.status === '已完成' || item.supplyStatus === '已补给'))
      const nextVersion = (state.reportVersions[shipmentId] ?? 1) + 1

      // 版本推进与排程重算放进同一次事务提交，失败则整体不落库
      const built = buildSchedule({
        shipments: state.shipments, stations: state.stations, batches: state.iceBatches,
        previous: state.allocations,
        reportVersions: { ...state.reportVersions, [shipmentId]: nextVersion },
        targetShipmentIds: [shipmentId],
        cutoffIso: todayStart(),
        nowIso: new Date().toISOString(), idFactory: () => nextId('SCH')
      })
      const queuedIds = new Set(built.gaps.filter((item) => item.shipmentId === shipmentId).map((item) => item.allocationId))
      const auditEntries = [makeAudit(shipmentId, '设备报告更新，排程重算', operator,
        `设备报告版本升至 V${nextVersion}：${staleBefore.length} 项未开始补给的安排失效并按新版本重算（排定 ${built.allocations.filter((item) => item.shipmentId === shipmentId && item.status === '已排定' && item.scheduledAt).length}、排队 ${queuedIds.size}）；${lockedBefore.length} 项已完成/已补给保留原批次和耗量`)]

      const result = commit(
        { allocations: built.allocations, gaps: built.gaps, reportVersions: { ...state.reportVersions, [shipmentId]: nextVersion } },
        auditEntries, '报告重算'
      )
      if (!result.ok) return result
      result.invalidated = staleBefore.length
      result.message = result.retried ?? false
        ? `${result.message}：设备报告 V${nextVersion}，已完成的 ${lockedBefore.length} 项仍保留原批次和耗量`
        : `设备报告 V${nextVersion}：未开始的补给安排已失效重算，已完成的 ${lockedBefore.length} 项保留原批次和耗量`
      return result
    },

    supplyAllocation: (allocationId, operator) => {
      const allocation = get().allocations.find((item) => item.id === allocationId)
      if (!allocation) return { ok: false, message: '排程安排不存在' }
      if (allocation.status === '排队') return { ok: false, message: '该安排仍在排队（冷位或干冰缺口），无法补给' }
      if (allocation.supplyStatus === '已补给') return { ok: false, message: '该安排已补给，重复操作不重复扣减' }

      const now = new Date().toISOString()
      const allocations = get().allocations.map((item) => item.id === allocationId ? {
        ...item,
        supplyStatus: '已补给' as const,
        suppliedAt: now,
        iceLines: item.iceLines.map((line) => ({ ...line, consumedKg: line.frozenKg }))
      } : item)
      const frozenTotal = Math.round(allocation.iceLines.reduce((sum, line) => sum + line.frozenKg, 0) * 10) / 10
      const batchText = allocation.iceLines.map((line) => `${line.batchId} ${line.frozenKg}kg`).join('、')
      const auditEntries = [makeAudit(allocation.shipmentId, '执行干冰补给', operator,
        `${allocation.segmentId} 冻结量转实耗 ${frozenTotal}kg（${batchText}），批次余量同步扣减`)]
      const result = commit({ allocations }, auditEntries, '补给')
      if (!result.ok) return result
      result.message = `已按冻结量从 ${batchText} 扣减 ${frozenTotal}kg`
      return result
    },

    completeAllocation: (allocationId, operator) => {
      const allocation = get().allocations.find((item) => item.id === allocationId)
      if (!allocation) return { ok: false, message: '排程安排不存在' }
      if (allocation.status === '已完成') return { ok: false, message: '该安排已完成，无需重复操作' }
      if (allocation.supplyStatus !== '已补给') return { ok: false, message: '尚未补给，不能标记完成' }
      const allocations = get().allocations.map((item) => item.id === allocationId ? { ...item, status: '已完成' as const } : item)
      const auditEntries = [makeAudit(allocation.shipmentId, '预冷补给完成', operator,
        `${allocation.segmentId} 预冷与干冰补给完成，锁定批次 ${allocation.iceLines.map((line) => line.batchId).join('、')} 与耗量，后续设备报告更新不再重算`)]
      const result = commit({ allocations }, auditEntries, '完成')
      if (!result.ok) return result
      result.message = '已完成并锁定批次与耗量'
      return result
    },

    addEvidence: (shipmentId, evidence) => set((state) => {
      const shipment = state.shipments.find((item) => item.id === shipmentId)
      if (!shipment) return state
      const sameCount = shipment.evidence.filter((item) => item.category === evidence.category).length
      shipment.evidence.unshift({ ...evidence, id: nextId('E'), version: sameCount + 1, uploadedAt: new Date().toISOString() })
      shipment.version += 1
      shipment.updatedAt = new Date().toISOString()
      return { shipments: [...state.shipments], audit: [makeAudit(shipmentId, '上传证据版本', evidence.uploadedBy, `${evidence.name} 版本${sameCount + 1}`), ...state.audit] }
    }),
    verifyEvidence: (shipmentId, evidenceId) => set((state) => {
      const shipment = state.shipments.find((item) => item.id === shipmentId)
      const evidence = shipment?.evidence.find((item) => item.id === evidenceId)
      if (!shipment || !evidence) return state
      evidence.verified = true
      shipment.version += 1
      return { shipments: [...state.shipments], audit: [makeAudit(shipmentId, '核验证据', '当前用户', evidence.name), ...state.audit] }
    }),
    sign: (shipmentId, role, comment, status) => {
      const shipment = get().shipments.find((item) => item.id === shipmentId)
      const signature = shipment?.signatures.find((item) => item.role === role)
      if (!shipment || !signature) return { ok: false, message: '签收角色不存在' }
      if (status === '已退回' && !comment.trim()) return { ok: false, message: '退回必须填写原因' }
      signature.status = status
      signature.comment = comment
      signature.signedAt = new Date().toISOString()
      shipment.version += 1
      shipment.updatedAt = signature.signedAt
      set((state) => ({ shipments: [...state.shipments], audit: [makeAudit(shipmentId, `${role}${status}`, signature.name, comment || '签署确认'), ...state.audit] }))
      return { ok: true, message: status === '已签' ? '签收成功' : '已退回并要求补充材料' }
    },
    createDeviation: (shipmentId, segmentId, title, severity) => set((state) => {
      const shipment = state.shipments.find((item) => item.id === shipmentId)
      if (!shipment) return state
      const now = new Date().toISOString()
      const deviation: Deviation = {
        id: nextId('TDEV'), shipmentId, segmentId, title, source: '人工报告', severity, status: '待调查', owner: '温控质量组', openedAt: now,
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '', version: 1
      }
      shipment.status = '待放行'
      shipment.version += 1
      return { deviations: [deviation, ...state.deviations], shipments: [...state.shipments], audit: [makeAudit(shipmentId, '登记温度偏差', '当前用户', title), ...state.audit] }
    }),
    saveInvestigation: (id, patch) => set((state) => {
      const deviation = state.deviations.find((item) => item.id === id)
      if (!deviation || !patch.cause?.trim() || !patch.assessment?.trim()) return state
      Object.assign(deviation, patch, { status: '待放行复核', version: deviation.version + 1 })
      return { deviations: [...state.deviations], audit: [makeAudit(deviation.shipmentId, '提交偏差调查', deviation.owner, deviation.assessment), ...state.audit] }
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
      set((state) => ({ deviations: [...state.deviations], shipments: [...state.shipments], audit: [makeAudit(deviation.shipmentId, `偏差复核：${disposition}`, deviation.reviewer, note), ...state.audit] }))
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
      shipment.updatedAt = new Date().toISOString()
      set((current) => ({ shipments: [...current.shipments], audit: [makeAudit(id, `状态流转：${status}`, '当前用户', '放行工作台操作'), ...current.audit] }))
      return { ok: true, message: `状态已更新为${status}` }
    },
    reset: () => set({
      shipments: structuredClone(seedShipments),
      deviations: structuredClone(seedDeviations),
      audit: structuredClone(seedAudit),
      stations: structuredClone(seedStations),
      iceBatches: structuredClone(seedIceBatches),
      allocations: [],
      gaps: [],
      reportVersions: reportVersionsOf(seedShipments),
      scheduleSeq: 1,
      keyword: '',
      status: '全部'
    })
  }
}, {
  name: STORAGE_KEY,
  storage: typeof window === 'undefined' ? undefined : createJSONStorage(transactionStorage)
}))
function makeAudit(shipmentId: string, action: string, operator: string, detail: string): AuditEntry {
  return { id: nextId('AUD'), shipmentId, action, operator, detail, createdAt: new Date().toISOString() }
}
