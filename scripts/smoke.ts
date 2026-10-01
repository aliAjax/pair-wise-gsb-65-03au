import { seedBatches, seedReservations, seedShipments, seedSlots } from '../src/data/seed'
import { invalidateForReport, planReservations } from '../src/services/schedulingEngine'

let counter = 1000
const makeId = (p: string) => `${p}-T${counter++}`
const NOW = '2026-10-01T12:00:00'

let plan = planReservations({ shipments: structuredClone(seedShipments), slots: structuredClone(seedSlots), batches: structuredClone(seedBatches), reservations: structuredClone(seedReservations), nowIso: NOW, makeId })
let r = plan.reservations
const show = (label: string) => {
  console.log(`\n== ${label} ==`)
  for (const x of r.filter(i => !['已补给'].includes(i.status)).sort((a, b) => a.shipmentId.localeCompare(b.shipmentId))) {
    console.log(x.shipmentId, x.status, x.zone, x.slotId || '-', x.preCoolStart?.slice(5, 16) || '-', `need ${x.iceRequiredKg}`, `frozen ${x.frozenKg}`, x.blockReason || '', `slotGap ${x.slotGap}`, `iceGap ${x.iceGapKg}`, x.allocations.map(a => `${a.batchId}:${a.kg}`).join(','))
  }
}
show('initial')

// 幂等：再跑一次，结果集合不变
const again = planReservations({ shipments: structuredClone(seedShipments), slots: structuredClone(seedSlots), batches: structuredClone(seedBatches), reservations: structuredClone(r), nowIso: NOW, makeId })
const before = JSON.stringify(r.filter(i => i.status !== '已失效').map(i => [i.shipmentId, i.status, i.slotId, i.frozenKg]))
const after = JSON.stringify(again.reservations.filter(i => i.status !== '已失效').map(i => [i.shipmentId, i.status, i.slotId, i.frozenKg]))
console.log('\nidempotent replay identical:', before === after)

// 设备报告更新（起飞延误240分钟）AIR-261001-02 → 失效重算，FIFO 应让 01-03 先补位
const updated = invalidateForReport(structuredClone(r), 'AIR-261001-02', 2, NOW)
const shipments2 = structuredClone(seedShipments)
const s2 = shipments2.find(s => s.id === 'AIR-261001-02')!
s2.evidence.push({ id: 'E99', name: 'new.pdf', category: '设备报告', version: 2, uploadedBy: 'x', uploadedAt: NOW, verified: true })
const shift = 600 * 60000
s2.plannedDeparture = new Date(new Date(s2.plannedDeparture).getTime() + shift).toISOString()
for (const seg of s2.segments) if (seg.flight !== '陆运') { seg.plannedStart = new Date(new Date(seg.plannedStart).getTime() + shift).toISOString(); seg.actualEnd = new Date(new Date(seg.actualEnd).getTime() + shift).toISOString() }
plan = planReservations({ shipments: shipments2, slots: structuredClone(seedSlots), batches: structuredClone(seedBatches), reservations: updated, nowIso: NOW, makeId })
r = plan.reservations
show('after report V2 for 01-02')

// 批次余量
console.log('\nbatch remaining:')
const frozen: Record<string, number> = {}
for (const x of r) if (x.status === '已排程') for (const a of x.allocations) frozen[a.batchId] = (frozen[a.batchId] ?? 0) + a.kg
for (const b of seedBatches) console.log(b.id, `received ${b.receivedKg} consumed ${b.consumedKg} frozen ${frozen[b.id] ?? 0} remaining ${b.receivedKg - b.consumedKg - (frozen[b.id] ?? 0)}`)
