import type { AuditEntry, Deviation, DryIceBatch, PreCoolSlot, Reservation, Shipment } from '../types'

const series = (base: number, pattern: number[]): { id: string; time: string; value: number }[] => pattern.map((value, index) => ({
  id: `T-${index}`,
  time: `2026-09-29T${String(6 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}:00`,
  value: base + value
}))

export const seedShipments: Shipment[] = [
  {
    id: 'AIR-260929-01', product: '单克隆抗体注射液', batch: 'MAB-260927', route: '上海浦东 PVG → 巴黎 CDG', containerId: 'RKN-44018',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-09-29T06:00:00', actualArrival: '2026-09-29T06:00:00', status: '待放行', version: 5, updatedAt: '2026-09-29T10:10:00',
    segments: [
      { id: 'SEG-1', from: '上海医药仓库', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-09-29T04:30:00', actualStart: '2026-09-29T04:36:00', actualEnd: '2026-09-29T05:22:00', handler: '张骁', note: '预冷至4.2℃后装车', temperature: series(3.8, [0, .2, .4, .7, .5, .3, .1, .2, .4, .6, .5, .3]) },
      { id: 'SEG-2', from: '浦东机场货站', to: 'CDG货站', flight: 'AF111', plannedStart: '2026-09-29T06:00:00', actualStart: '2026-09-29T06:42:00', actualEnd: '2026-09-29T18:30:00', handler: '法航货运', note: '中转停留2小时，外包装完整', temperature: series(4.1, [0, .3, .5, .2, -.2, -.5, -.8, -.4, .1, .8, 1.3, 1.7, 1.9, 1.4, .7, .2, -.1, .3]) },
      { id: 'SEG-3', from: 'CDG货站', to: '巴黎中心仓', flight: '陆运', plannedStart: '2026-09-29T18:30:00', actualStart: '2026-09-29T19:05:00', actualEnd: '2026-09-29T20:20:00', handler: 'L. Martin', note: '交接时箱体指示灯正常', temperature: series(4.5, [0, .4, .8, 1.2, .9, .5, .2, -.1, -.2, .1]) }
    ],
    evidence: [
      { id: 'E-1', name: 'RKN-44018原始温度记录.csv', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T20:32:00', verified: true },
      { id: 'E-2', name: 'AF111装机确认.pdf', category: '设备报告', version: 2, uploadedBy: '法航货运', uploadedAt: '2026-09-29T06:50:00', verified: true },
      { id: 'E-3', name: '巴黎中心仓交接单.jpg', category: '交接签字', version: 1, uploadedBy: 'L. Martin', uploadedAt: '2026-09-29T20:25:00', verified: false }
    ],
    signatures: [
      { role: '发货方', name: '张骁', status: '已签', signedAt: '2026-09-29T05:30:00', comment: '包装与预冷符合要求' },
      { role: '承运方', name: '法航货运', status: '已签', signedAt: '2026-09-29T19:12:00', comment: '航段交接无异常' },
      { role: '收货方', name: 'L. Martin', status: '已签', signedAt: '2026-09-29T20:30:00', comment: '外包装完整，箱体数据已核' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-260929-02', product: '细胞治疗样本', batch: 'CELL-260929', route: '北京首都 PEK → 东京羽田 HND', containerId: 'CRT-9207',
    tempMin: 2, tempMax: 10, plannedDeparture: '2026-09-29T09:30:00', actualArrival: '2026-09-29T09:30:00', status: '待放行', version: 4, updatedAt: '2026-09-29T17:40:00',
    segments: [
      { id: 'SEG-1', from: '北京实验室', to: '首都机场货站', flight: '陆运', plannedStart: '2026-09-29T07:00:00', actualStart: '2026-09-29T07:12:00', actualEnd: '2026-09-29T08:05:00', handler: '苏晴', note: '干冰余量复核', temperature: series(4.2, [0, .3, .6, .8, .5, .2]) },
      { id: 'SEG-2', from: '首都机场货站', to: '羽田机场', flight: 'NH964', plannedStart: '2026-09-29T09:30:00', actualStart: '2026-09-29T10:05:00', actualEnd: '2026-09-29T14:10:00', handler: '全日空货运', note: '货舱温度短时偏高', temperature: series(5.8, [0, .9, 1.8, 2.4, 3.1, 4.4, 3.2, 1.8, .7, .2]) }
    ],
    evidence: [
      { id: 'E-4', name: 'CRT-9207温度曲线.xlsx', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T17:12:00', verified: true },
      { id: 'E-5', name: '货舱温控说明.pdf', category: '设备报告', version: 1, uploadedBy: '全日空货运', uploadedAt: '2026-09-29T17:20:00', verified: false }
    ],
    signatures: [
      { role: '发货方', name: '苏晴', status: '已签', signedAt: '2026-09-29T08:10:00', comment: '样本封箱完成' },
      { role: '承运方', name: '全日空货运', status: '已签', signedAt: '2026-09-29T14:30:00', comment: '温度波动已报告' },
      { role: '收货方', name: '佐藤健', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261001-01', product: '单克隆抗体注射液', batch: 'MAB-260930', route: '上海浦东 PVG → 巴黎 CDG', containerId: 'RKN-51207',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-10-01T14:00:00', actualArrival: '', status: '待装机', version: 1, updatedAt: '2026-10-01T07:20:00',
    segments: [
      { id: 'SEG-1', from: '苏州制药厂', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-10-01T08:30:00', actualStart: '', actualEnd: '', handler: '张骁', note: '陆运冷藏车，无需货站预冷位', temperature: [] },
      { id: 'SEG-2', from: '浦东机场货站', to: 'CDG货站', flight: 'AF117', plannedStart: '2026-10-01T14:00:00', actualStart: '', actualEnd: '2026-10-02T02:30:00', handler: '法航货运', note: '预计飞行12.5小时，落地直转', temperature: [] }
    ],
    evidence: [
      { id: 'E-11', name: 'RKN-51207设备出场报告.pdf', category: '设备报告', version: 1, uploadedBy: '设备值班员 沈牧', uploadedAt: '2026-10-01T07:10:00', verified: true }
    ],
    signatures: [
      { role: '发货方', name: '张骁', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '法航货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: 'CDG药房', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261001-02', product: '流感裂解疫苗', batch: 'FLU-260930', route: '上海浦东 PVG → 法兰克福 FRA', containerId: 'RKN-51218',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-10-01T13:30:00', actualArrival: '', status: '待装机', version: 1, updatedAt: '2026-10-01T07:45:00',
    segments: [
      { id: 'SEG-1', from: '上海生物所', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-10-01T07:40:00', actualStart: '', actualEnd: '', handler: '侯琳', note: '陆运冷藏车', temperature: [] },
      { id: 'SEG-2', from: '浦东机场货站', to: 'FRA货站', flight: 'LH729', plannedStart: '2026-10-01T13:30:00', actualStart: '', actualEnd: '2026-10-02T00:30:00', handler: '汉莎货运', note: '预计飞行11小时', temperature: [] }
    ],
    evidence: [
      { id: 'E-12', name: 'RKN-51218机组点检单.pdf', category: '设备报告', version: 1, uploadedBy: '设备值班员 沈牧', uploadedAt: '2026-10-01T07:12:00', verified: true }
    ],
    signatures: [
      { role: '发货方', name: '侯琳', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '汉莎货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: 'FRA冷链仓', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261001-03', product: '重组人胰岛素', batch: 'INS-260928', route: '上海浦东 PVG → 洛杉矶 LAX', containerId: 'RKN-51302',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-10-01T17:00:00', actualArrival: '', status: '待装机', version: 1, updatedAt: '2026-10-01T08:05:00',
    segments: [
      { id: 'SEG-1', from: '通化华东仓', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-10-01T10:20:00', actualStart: '', actualEnd: '', handler: '侯琳', note: '陆运冷藏车', temperature: [] },
      { id: 'SEG-2', from: '浦东机场货站', to: 'LAX货站', flight: 'UA857', plannedStart: '2026-10-01T17:00:00', actualStart: '', actualEnd: '2026-10-02T05:00:00', handler: '联合航空货运', note: '预计飞行12小时，预冷窗口与前两票重叠', temperature: [] }
    ],
    evidence: [
      { id: 'E-13', name: 'RKN-51302运行自检报告.pdf', category: '设备报告', version: 1, uploadedBy: '设备值班员 沈牧', uploadedAt: '2026-10-01T07:15:00', verified: true }
    ],
    signatures: [
      { role: '发货方', name: '侯琳', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '联合航空货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: 'LAX分拨中心', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261002-04', product: '多肽注射液', batch: 'PEP-261001', route: '北京首都 PEK → 首尔仁川 ICN', containerId: 'CRT-60110',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-10-02T10:00:00', actualArrival: '', status: '待装机', version: 1, updatedAt: '2026-10-01T09:00:00',
    segments: [
      { id: 'SEG-1', from: '北京亦庄仓', to: '首都机场货站', flight: '陆运', plannedStart: '2026-10-02T04:30:00', actualStart: '', actualEnd: '', handler: '苏晴', note: '陆运冷藏车', temperature: [] },
      { id: 'SEG-2', from: '首都机场货站', to: '仁川货站', flight: 'OZ332', plannedStart: '2026-10-02T10:00:00', actualStart: '', actualEnd: '2026-10-02T12:00:00', handler: '韩亚货运', note: '短航段2小时', temperature: [] }
    ],
    evidence: [
      { id: 'E-14', name: 'CRT-60110设备点检单.pdf', category: '设备报告', version: 1, uploadedBy: '设备值班员 高岚', uploadedAt: '2026-10-01T08:40:00', verified: true }
    ],
    signatures: [
      { role: '发货方', name: '苏晴', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '韩亚货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: '仁川医药仓', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261002-05', product: 'CAR-T 细胞制剂', batch: 'CART-261001', route: '上海浦东 PVG → 旧金山 SFO', containerId: 'CRT-77041',
    tempMin: -25, tempMax: -15, plannedDeparture: '2026-10-02T12:00:00', actualArrival: '', status: '待装机', version: 1, updatedAt: '2026-10-01T09:12:00',
    segments: [
      { id: 'SEG-1', from: '上海细胞治疗库', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-10-02T01:00:00', actualStart: '', actualEnd: '', handler: '张骁', note: '液氮罐陆运转干冰箱', temperature: [] },
      { id: 'SEG-2', from: '浦东机场货站', to: 'SFO货站', flight: 'UA858', plannedStart: '2026-10-02T12:00:00', actualStart: '', actualEnd: '2026-10-02T22:30:00', handler: '联合航空货运', note: '深冷温区，预冷8小时', temperature: [] }
    ],
    evidence: [
      { id: 'E-15', name: 'CRT-77041深冷设备报告.pdf', category: '设备报告', version: 1, uploadedBy: '设备值班员 沈牧', uploadedAt: '2026-10-01T08:50:00', verified: true }
    ],
    signatures: [
      { role: '发货方', name: '张骁', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '联合航空货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: 'SFO细胞中心', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  }
]

/** 预冷位：按货站、温区分池；PVG 2-8℃ 只有两个冷位，三票抢位必有一票排队 */
export const seedSlots: PreCoolSlot[] = [
  { id: 'PC-PVG-C1', station: '浦东机场货站', zone: 'Z2-8', capacity: 1 },
  { id: 'PC-PVG-C2', station: '浦东机场货站', zone: 'Z2-8', capacity: 1 },
  { id: 'PC-PVG-F1', station: '浦东机场货站', zone: 'Z15-25', capacity: 1 },
  { id: 'PC-PEK-C1', station: '首都机场货站', zone: 'Z2-8', capacity: 1 }
]

export const seedBatches: DryIceBatch[] = [
  { id: 'ICE-B-260926', receivedAt: '2026-09-26T08:00:00', receivedKg: 300, consumedKg: 210, note: '09-29航班批次补给耗用后剩余90kg' },
  { id: 'ICE-B-260930', receivedAt: '2026-09-30T16:00:00', receivedKg: 30, consumedKg: 0, note: '国庆航班波前到货' },
  { id: 'ICE-B-261001', receivedAt: '2026-10-01T06:30:00', receivedKg: 92, consumedKg: 0, note: '早班干冰补货，总量212kg' }
]

/** 已完成补给保留原批次与实际耗量，设备报告再怎么更新都不动 */
export const seedReservations: Reservation[] = [
  {
    id: 'RSV-260929-01', shipmentId: 'AIR-260929-01', segmentId: 'SEG-2', containerId: 'RKN-44018', station: '浦东机场货站', zone: 'Z2-8',
    preCoolStart: '2026-09-29T02:00:00', preCoolEnd: '2026-09-29T06:00:00', slotId: 'PC-PVG-C1', slotGap: 0,
    iceRequiredKg: 32, iceGapKg: 0, allocations: [{ batchId: 'ICE-B-260926', kg: 31 }], status: '已补给', blockReason: '',
    frozenKg: 0, suppliedKg: 31, suppliedAt: '2026-09-29T05:40:00', reportVersion: 2, idempotencyKey: 'seed-rsv-01',
    queuedAt: '', createdAt: '2026-09-29T01:50:00', updatedAt: '2026-09-29T05:40:00', lastError: ''
  },
  {
    id: 'RSV-260929-02', shipmentId: 'AIR-260929-02', segmentId: 'SEG-2', containerId: 'CRT-9207', station: '首都机场货站', zone: 'Z2-8',
    preCoolStart: '2026-09-29T05:30:00', preCoolEnd: '2026-09-29T09:30:00', slotId: 'PC-PEK-C1', slotGap: 0,
    iceRequiredKg: 17, iceGapKg: 0, allocations: [{ batchId: 'ICE-B-260926', kg: 16 }], status: '已补给', blockReason: '',
    frozenKg: 0, suppliedKg: 16, suppliedAt: '2026-09-29T09:10:00', reportVersion: 1, idempotencyKey: 'seed-rsv-02',
    queuedAt: '', createdAt: '2026-09-29T05:00:00', updatedAt: '2026-09-29T09:10:00', lastError: ''
  }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'TDEV-260929-01', shipmentId: 'AIR-260929-02', segmentId: 'SEG-2', title: '航段温度最高达到10.4℃', source: '自动监测', severity: '重大', status: '调查中', owner: '温控质量组', openedAt: '2026-09-29T14:05:00', dueDate: '2026-09-29', version: 3,
    cause: '航班临时调整至非温控货舱，转运时开门时间延长。', assessment: '超限约18分钟，样本稳定性研究显示可承受30分钟内偏差，但需收货方确认。', disposition: '补充处理', correctiveAction: '收货方完成外观和温度标签复核后决定是否接收。', evidence: '温度原始曲线、航班货舱变更通知、地面操作记录。', reviewer: '', reviewNote: ''
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'A65-1', shipmentId: 'AIR-260929-01', action: '任务创建', operator: '张骁', detail: '关联3个航段和4类证据要求', createdAt: '2026-09-29T04:10:00' },
  { id: 'A65-2', shipmentId: 'AIR-260929-02', action: '自动创建偏差', operator: '温度监测系统', detail: 'SEG-2温度10.4℃超出2-10℃范围', createdAt: '2026-09-29T14:05:00' },
  { id: 'A65-3', shipmentId: 'AIR-260929-02', action: '提交偏差调查', operator: '温控质量组', detail: '补充处理分支，等待收货方稳定性确认', createdAt: '2026-09-29T16:40:00' },
  { id: 'A65-4', shipmentId: 'AIR-260929-01', action: '干冰补给确认', operator: '设备值班员 高岚', detail: 'RSV-260929-01 自 ICE-B-260926 实装31kg，预冷位 PC-PVG-C1', createdAt: '2026-09-29T05:40:00', category: '排程', reservationId: 'RSV-260929-01' },
  { id: 'A65-5', shipmentId: 'AIR-260929-02', action: '干冰补给确认', operator: '设备值班员 高岚', detail: 'RSV-260929-02 自 ICE-B-260926 实装16kg，预冷位 PC-PEK-C1', createdAt: '2026-09-29T09:10:00', category: '排程', reservationId: 'RSV-260929-02' }
]
