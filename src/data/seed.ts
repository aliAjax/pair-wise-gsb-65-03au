import type { AuditEntry, Deviation, DryIceBatch, PrecoolStation, Shipment } from '../types'

export const seedStations: PrecoolStation[] = [
  { id: 'ST-COLD-A', name: '冷藏预冷位 A 组', zone: '冷藏', capacity: 2 },
  { id: 'ST-COLD-B', name: '冷藏预冷位 B 组', zone: '冷藏', capacity: 1 },
  { id: 'ST-CHILL', name: '控温预冷位 C 组', zone: '控温', capacity: 2 },
  { id: 'ST-FROZEN', name: '深冷预冷位 D 组', zone: '深冷', capacity: 1 }
]

export const seedIceBatches: DryIceBatch[] = [
  { id: 'ICE-260928-01', stationId: 'ST-COLD-A', totalKg: 120, receivedAt: '2026-09-28T18:00:00', note: '夜班补给批次' },
  { id: 'ICE-260928-02', stationId: 'ST-COLD-B', totalKg: 60, receivedAt: '2026-09-28T18:10:00', note: '冷藏备用' },
  { id: 'ICE-260928-03', stationId: 'ST-CHILL', totalKg: 90, receivedAt: '2026-09-28T18:20:00', note: '控温区批次' },
  { id: 'ICE-260928-04', stationId: 'ST-FROZEN', totalKg: 140, receivedAt: '2026-09-28T18:30:00', note: '深冷高耗量批次' }
]

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
      { id: 'SEG-1', from: '北京实验室', to: '首都机场', flight: '陆运', plannedStart: '2026-09-29T07:00:00', actualStart: '2026-09-29T07:12:00', actualEnd: '2026-09-29T08:05:00', handler: '苏晴', note: '干冰余量复核', temperature: series(4.2, [0, .3, .6, .8, .5, .2]) },
      { id: 'SEG-2', from: '首都机场', to: '羽田机场', flight: 'NH964', plannedStart: '2026-09-29T09:30:00', actualStart: '2026-09-29T10:05:00', actualEnd: '2026-09-29T14:10:00', handler: '全日空货运', note: '货舱温度短时偏高', temperature: series(5.8, [0, .9, 1.8, 2.4, 3.1, 4.4, 3.2, 1.8, .7, .2]) }
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
    id: 'AIR-261001-03', product: '冻存血浆制剂', batch: 'PLS-260930', route: '上海浦东 PVG → 卢森堡 LUX', containerId: 'RKN-77001',
    tempMin: -30, tempMax: -15, plannedDeparture: '2026-10-01T08:00:00', actualArrival: '2026-10-01T08:00:00', status: '待装机', version: 2, updatedAt: '2026-09-30T16:20:00',
    segments: [
      { id: 'SEG-1', from: '上海血浆冷库', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-09-30T22:00:00', actualStart: '', actualEnd: '', handler: '待派车', note: '深冷箱封条待核', temperature: [], flightHours: 1 },
      { id: 'SEG-2', from: '浦东机场货站', to: 'LUX货站', flight: 'CV601', plannedStart: '2026-10-01T08:00:00', actualStart: '', actualEnd: '', handler: '卢森堡货运', note: '宽体机深冷舱位已确认', temperature: [], flightHours: 11 }
    ],
    evidence: [
      { id: 'E-6', name: 'CV601深冷舱位确认.pdf', category: '设备报告', version: 1, uploadedBy: '卢森堡货运', uploadedAt: '2026-09-30T15:00:00', verified: false }
    ],
    signatures: [
      { role: '发货方', name: '上海血浆库', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '卢森堡货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: 'LUX Depot', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261001-04', product: '冻存干细胞制剂', batch: 'STEM-260930', route: '上海浦东 PVG → 安克雷奇 ANC', containerId: 'RKN-77002',
    tempMin: -35, tempMax: -15, plannedDeparture: '2026-10-01T10:30:00', actualArrival: '2026-10-01T10:30:00', status: '待装机', version: 1, updatedAt: '2026-09-30T17:00:00',
    segments: [
      { id: 'SEG-1', from: '苏州细胞库', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-10-01T01:00:00', actualStart: '', actualEnd: '', handler: '待派车', note: '全程深冷车厢', temperature: [], flightHours: 2 },
      { id: 'SEG-2', from: '浦东机场货站', to: 'ANC货站', flight: '5Y829', plannedStart: '2026-10-01T10:30:00', actualStart: '', actualEnd: '', handler: '阿特拉斯航空', note: '与CV601早高峰争用深冷预冷位', temperature: [], flightHours: 12 }
    ],
    evidence: [
      { id: 'E-7', name: '5Y829货机温控舱位图.pdf', category: '设备报告', version: 1, uploadedBy: '阿特拉斯航空', uploadedAt: '2026-09-30T16:40:00', verified: false }
    ],
    signatures: [
      { role: '发货方', name: '苏州细胞库', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '阿特拉斯航空', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: 'ANC Cell Bank', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261001-05', product: '胰岛素笔芯', batch: 'INS-260930', route: '上海浦东 PVG → 法兰克福 FRA', containerId: 'RKN-44018',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-10-01T13:30:00', actualArrival: '2026-10-01T13:30:00', status: '待装机', version: 1, updatedAt: '2026-09-30T17:30:00',
    segments: [
      { id: 'SEG-1', from: '苏州制药厂', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-10-01T06:30:00', actualStart: '', actualEnd: '', handler: '待派车', note: '冷藏车4℃', temperature: [], flightHours: 2 },
      { id: 'SEG-2', from: '浦东机场货站', to: 'FRA货站', flight: 'CA933', plannedStart: '2026-10-01T13:30:00', actualStart: '', actualEnd: '', handler: '国航货运', note: '复用RKN-44018，注意与MU553排程冲突', temperature: [], flightHours: 12 }
    ],
    evidence: [
      { id: 'E-8', name: 'CA933冷藏舱位确认.pdf', category: '设备报告', version: 1, uploadedBy: '国航货运', uploadedAt: '2026-09-30T17:10:00', verified: false }
    ],
    signatures: [
      { role: '发货方', name: '苏州制药', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '国航货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: 'FRA Pharma', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-261001-06', product: '重组人生长激素', batch: 'GH-260930', route: '上海浦东 PVG → 巴黎 CDG', containerId: 'RKN-44018',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-10-01T12:00:00', actualArrival: '2026-10-01T12:00:00', status: '待装机', version: 1, updatedAt: '2026-09-30T17:35:00',
    segments: [
      { id: 'SEG-1', from: '上海生物制品所', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-10-01T05:00:00', actualStart: '', actualEnd: '', handler: '待派车', note: '与CA933同箱不同航段', temperature: [], flightHours: 2 },
      { id: 'SEG-2', from: '浦东机场货站', to: 'CDG货站', flight: 'MU553', plannedStart: '2026-10-01T12:00:00', actualStart: '', actualEnd: '', handler: '东航货运', note: 'RKN-44018连续执行，预冷窗口与CA933重叠', temperature: [], flightHours: 11 }
    ],
    evidence: [
      { id: 'E-9', name: 'MU553装机预冷单.pdf', category: '设备报告', version: 1, uploadedBy: '东航货运', uploadedAt: '2026-09-30T17:20:00', verified: false }
    ],
    signatures: [
      { role: '发货方', name: '上海生物所', status: '待签', signedAt: '', comment: '' },
      { role: '承运方', name: '东航货运', status: '待签', signedAt: '', comment: '' },
      { role: '收货方', name: 'CDG Pharma', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
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
  { id: 'A65-3', shipmentId: 'AIR-260929-02', action: '提交偏差调查', operator: '温控质量组', detail: '补充处理分支，等待收货方稳定性确认', createdAt: '2026-09-29T16:40:00' }
]
