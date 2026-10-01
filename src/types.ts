export type ShipmentStatus = '待装机' | '运输中' | '待放行' | '已放行' | '已拒绝'
export type DeviationStatus = '待调查' | '调查中' | '待放行复核' | '已关闭'

export interface TemperaturePoint {
  id: string
  time: string
  value: number
}

export interface ShipmentSegment {
  id: string
  from: string
  to: string
  flight: string
  plannedStart: string
  actualStart: string
  actualEnd: string
  handler: string
  note: string
  temperature: TemperaturePoint[]
}

export interface EvidenceFile {
  id: string
  name: string
  category: '温度曲线' | '设备报告' | '包装确认' | '交接签字'
  version: number
  uploadedBy: string
  uploadedAt: string
  verified: boolean
}

export interface ShipmentSignature {
  role: '发货方' | '承运方' | '收货方' | '放行人员'
  name: string
  status: '待签' | '已签' | '已退回'
  signedAt: string
  comment: string
}

export interface Shipment {
  id: string
  product: string
  batch: string
  route: string
  containerId: string
  tempMin: number
  tempMax: number
  plannedDeparture: string
  actualArrival: string
  status: ShipmentStatus
  segments: ShipmentSegment[]
  evidence: EvidenceFile[]
  signatures: ShipmentSignature[]
  version: number
  updatedAt: string
}

export interface Deviation {
  id: string
  shipmentId: string
  segmentId: string
  title: string
  source: '自动监测' | '人工报告'
  severity: '一般' | '重大'
  status: DeviationStatus
  owner: string
  openedAt: string
  dueDate: string
  cause: string
  assessment: string
  disposition: '接受' | '补充处理' | '拒绝'
  correctiveAction: string
  evidence: string
  reviewer: string
  reviewNote: string
  version: number
}

// ===== 货站预冷位 / 干冰补给排程域 =====

/** 温区由航段温控范围推导，决定预冷位池与干冰消耗速率 */
export type TempZoneId = 'Z2-8' | 'Z2-25' | 'Z15-25'

export interface TempZone {
  id: TempZoneId
  label: string
  /** 每小时干冰基础耗量（kg/h），按温区保温难度给出 */
  iceRatePerHour: number
  /** 装机前标准预冷时长（小时） */
  preCoolHours: number
}

/** 预冷位：同一温区、同一货站、同一时间窗内不可被两只温控箱重复占用 */
export interface PreCoolSlot {
  id: string
  station: string
  zone: TempZoneId
  capacity: number
}

/** 干冰批次：余量 = 到货 - 已冻结 - 已耗用量 */
export interface DryIceBatch {
  id: string
  receivedAt: string
  receivedKg: number
  /** 已完成补给实际耗用，历史记录永久保留 */
  consumedKg: number
  note: string
}

/** 某票货对某干冰批次的冻结量 */
export interface IceAllocation {
  batchId: string
  kg: number
}

export type ReservationStatus = '已排程' | '排队中' | '已预冷' | '已补给' | '已失效'
export type BlockReason = '预冷位容量不足' | '干冰余量不足' | '预冷位与干冰均不足'

export interface Reservation {
  id: string
  shipmentId: string
  segmentId: string
  containerId: string
  station: string
  zone: TempZoneId
  preCoolStart: string
  preCoolEnd: string
  slotId: string
  slotGap: number
  iceRequiredKg: number
  iceGapKg: number
  allocations: IceAllocation[]
  status: ReservationStatus
  blockReason: BlockReason | ''
  /** 已冻结的总干冰量（排程时锁定） */
  frozenKg: number
  /** 已补给后实际装入量（完成后批次记录不可变） */
  suppliedKg: number
  suppliedAt: string
  /** 驱动本次排程的设备报告版本；报告更新后未开始的安排据此失效 */
  reportVersion: number
  /** 幂等键：同一任务+航段+报告版本+操作者重复提交不重复扣减 */
  idempotencyKey: string
  /** 排队序号，容量释放后按 FIFO 补位 */
  queuedAt: string
  createdAt: string
  updatedAt: string
  lastError: string
}

/** 待写入暂存：模拟写入失败后从最后完整排程重试 */
export interface PendingWrite {
  action: string
  shipmentId: string
  reservationId: string
  operator: string
  idempotencyKey: string
  payload?: { suppliedKg?: number; reportVersion?: number }
  createdAt: string
}

export interface AuditEntry {
  id: string
  shipmentId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  category?: '证据' | '签收' | '偏差' | '放行' | '排程'
  reservationId?: string
}
