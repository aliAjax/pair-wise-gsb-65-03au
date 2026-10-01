export type ShipmentStatus = '待装机' | '运输中' | '待放行' | '已放行' | '已拒绝'
export type DeviationStatus = '待调查' | '调查中' | '待放行复核' | '已关闭'

/** 航段温区：由运输任务温限推导，决定预冷时长和干冰消耗率 */
export type TempZone = '冷藏' | '控温' | '深冷'

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
  /** 计划飞行小时；未填写时按计划/实际时间推算，用于干冰量冻结 */
  flightHours?: number
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

export interface AuditEntry {
  id: string
  shipmentId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

/* ===================== 货站预冷位 / 干冰排程 ===================== */

export interface PrecoolStation {
  id: string
  name: string
  zone: TempZone
  /** 同一时刻可容纳的温控箱数量（冷位） */
  capacity: number
}

export interface DryIceBatch {
  id: string
  stationId: string
  /** 批次总重 kg */
  totalKg: number
  receivedAt: string
  note: string
}

/** 一票航段在某个干冰批次上冻结/实耗的分量 */
export interface DryIceLine {
  batchId: string
  frozenKg: number
  consumedKg: number
}

/**
 * 排程占用 = 一票航段对预冷位 + 干冰的一次原子预留。
 * 已排定：冷位与干冰同时到位；排队：容量不足，不占用任何资源。
 */
export interface ScheduleAllocation {
  id: string
  shipmentId: string
  segmentId: string
  containerId: string
  zone: TempZone
  /** 预冷开始 = 航段起飞 - 准备时长 */
  windowStart: string
  /** 预冷结束 = 航段起飞 */
  windowEnd: string
  slotsNeeded: number
  precoolStationId: string
  iceRequiredKg: number
  iceLines: DryIceLine[]
  status: '已排定' | '排队' | '已完成' | '已失效'
  supplyStatus: '待补给' | '已补给'
  suppliedAt: string
  /** 设备报告版本；补给完成后保留，重算时不覆盖 */
  sourceReportVersion: number | null
  /** 容量不足时列出的缺口 */
  blockReason: string
  /** 结构化阻断原因，排队缺口据此与列表/详情共享同一份数据 */
  blockKinds: BlockKind[]
  queuedAt: string
  scheduledAt: string
  /** 幂等指纹：同一任务同一航段同一报告版本只排一次 */
  idempotencyKey: string
}

export type BlockKind = '温控箱冲突' | '预冷位不足' | '干冰不足'

export interface AllocationGap {
  allocationId: string
  shipmentId: string
  containerId: string
  zone: TempZone
  windowStart: string
  windowEnd: string
  slotsNeeded: number
  iceNeededKg: number
  blockKind: BlockKind
  detail: string
}

export interface StationCapacityView {
  station: PrecoolStation
  /** 该站在全部活跃窗口中的峰值占用 */
  peakUsed: number
  available: number
}
