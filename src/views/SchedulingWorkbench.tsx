import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Card, Descriptions, InputNumber, Modal, Progress, Space, Switch, Table, Tag, Timeline, message } from 'antd'
import { useShipmentStore, NOW_ISO } from '../store/useShipmentStore'
import { TEMP_ZONES, statusColor, toIso, toMinutes } from '../services/schedulingEngine'
import type { DryIceBatch, PreCoolSlot, Reservation } from '../types'

const fmt = (iso: string) => iso ? iso.replace('T', ' ').slice(5, 16) : '—'

function windowRows(slot: PreCoolSlot, reservations: Reservation[]) {
  const rows = reservations
    .filter((item) => item.slotId === slot.id && item.status !== '已失效' && item.status !== '排队中' && item.preCoolStart)
    .map((item) => ({ key: item.id, start: toMinutes(item.preCoolStart), end: toMinutes(item.preCoolEnd), reservation: item }))
    .sort((a, b) => a.start - b.start)
  const timeline: { key: string; start: number; end: number; reservation: Reservation }[] = []
  for (const row of rows) {
    const last = timeline[timeline.length - 1]
    if (last && row.start < last.end) timeline.push({ ...row, key: `${row.key}-b` })
    else timeline.push(row)
  }
  return timeline
}

export function SchedulingWorkbench() {
  const state = useShipmentStore()
  const navigate = useNavigate()
  const [operator, setOperator] = useState('值班员 高岚')
  const [supplyTarget, setSupplyTarget] = useState<Reservation | null>(null)
  const [supplyKg, setSupplyKg] = useState(0)

  const reservations = useMemo(
    () => [...state.reservations].sort((a, b) => (toMinutes(a.preCoolStart || a.queuedAt || a.createdAt)) - (toMinutes(b.preCoolStart || b.queuedAt || b.createdAt))),
    [state.reservations]
  )

  const frozenByBatch = useMemo(() => {
    const map: Record<string, number> = {}
    for (const reservation of state.reservations) {
      if (reservation.status !== '已排程' && reservation.status !== '排队中') continue
      for (const allocation of reservation.allocations) map[allocation.batchId] = (map[allocation.batchId] ?? 0) + allocation.kg
    }
    return map
  }, [state.reservations])

  const scheduledCount = reservations.filter((item) => item.status === '已排程').length
  const queuedCount = reservations.filter((item) => item.status === '排队中').length
  const totalFrozen = Object.values(frozenByBatch).reduce((sum, value) => sum + value, 0)
  const totalRemaining = state.batches.reduce((sum, batch) => sum + batch.receivedKg - batch.consumedKg, 0)

  const submitOne = (shipmentId: string) => {
    const result = state.submitReservation(shipmentId, operator)
    result.ok ? message.success(result.message) : message.warning(result.message)
  }

  const openSupply = (reservation: Reservation) => {
    setSupplyTarget(reservation)
    setSupplyKg(reservation.frozenKg)
  }

  const confirmSupply = () => {
    if (!supplyTarget) return
    const result = state.confirmSupply(supplyTarget.id, supplyKg, operator)
    if (result.ok) {
      message.success(result.message)
      setSupplyTarget(null)
    } else {
      message.error(result.message)
    }
  }

  const retry = () => {
    const result = state.retryPendingWrites()
    result.ok ? message.success(result.message) : message.error(result.message)
  }

  const reportUpdate = (shipmentId: string) => {
    const result = state.receiveEquipmentReport(shipmentId, operator, 600)
    result.ok ? message.success(result.message) : message.warning(result.message)
  }

  const reservationColumns = [
    { title: '运输任务', dataIndex: 'shipmentId', width: 135, render: (value: string) => <Button type="link" onClick={() => navigate(`/shipments/${value}`)}>{value}</Button> },
    { title: '温控箱', dataIndex: 'containerId', width: 105 },
    { title: '航段', dataIndex: 'segmentId', width: 70 },
    { title: '温区', dataIndex: 'zone', width: 110, render: (value: Reservation['zone']) => <Tag>{TEMP_ZONES[value].label}</Tag> },
    { title: '货站', dataIndex: 'station', width: 105 },
    {
      title: '预冷窗（位次）', width: 215,
      render: (_: unknown, row: Reservation) => row.status === '排队中'
        ? <Space size={4}><Badge status="warning" /><span>等待位次释放</span></Space>
        : <div><strong>{row.slotId}</strong><small className="cell-sub">{fmt(row.preCoolStart)} ~ {fmt(row.preCoolEnd)}</small></div>
    },
    {
      title: '干冰冻结', width: 210,
      render: (_: unknown, row: Reservation) => <div>
        <strong>需求 {row.iceRequiredKg}kg</strong>
        <small className="cell-sub">
          {row.allocations.length > 0
            ? row.allocations.map((item) => `${item.batchId} ${item.kg}kg`).join('、')
            : '未冻结（排队中）'}
        </small>
      </div>
    },
    { title: '状态', dataIndex: 'status', width: 85, render: (value: Reservation['status']) => <Tag color={statusColor(value)}>{value}</Tag> },
    {
      title: '阻断原因 / 缺口', width: 220,
      render: (_: unknown, row: Reservation) => row.status === '排队中'
        ? <Alert type="warning" showIcon style={{ padding: '4px 8px' }} message={row.blockReason} description={
          <Space size={4} wrap>
            {row.slotGap > 0 && <Tag color="volcano">冷位缺口 {Math.round(row.slotGap)} 分钟</Tag>}
            {row.iceGapKg > 0 && <Tag color="red">干冰缺口 {row.iceGapKg}kg</Tag>}
          </Space>
        } />
        : <span className="cell-sub">占用已锁定，FIFO 排队中不被后来者抢占</span>
    },
    {
      title: '操作', width: 230,
      render: (_: unknown, row: Reservation) => <Space size={4}>
        {row.status === '已排程' && <Button size="small" onClick={() => state.markPreCooled(row.id, operator)}>登记预冷到位</Button>}
        {row.status === '已预冷' && <Button size="small" type="primary" onClick={() => openSupply(row)}>确认补给</Button>}
        {row.status === '已补给' && <Tag color="success">{row.suppliedKg}kg 已入账</Tag>}
        {row.status === '已失效' && <Tag>待重算</Tag>}
        {(row.status === '已排程' || row.status === '排队中') && <Button size="small" danger type="link" onClick={() => reportUpdate(row.shipmentId)}>设备报告更新（延误10h）</Button>}
      </Space>
    }
  ]

  return <section className="page">
    <header className="page-head">
      <div><p>货站资源 / 预冷位 / 干冰批次 统一排程</p><h1>温控箱预冷位与干冰补给排程</h1></div>
      <span className="sync">排程基准时刻 {fmt(NOW_ISO)}</span>
    </header>

    <div className="metrics">
      <article><span>已排程（位次+干冰已锁定）</span><strong>{scheduledCount}</strong><small>重复提交幂等返回同一占用</small></article>
      <article><span>排队中</span><strong>{queuedCount}</strong><small>容量释放后 FIFO 自动补位</small></article>
      <article><span>干冰已冻结 / 可用总量</span><strong>{totalFrozen}<small style={{ display: 'inline', fontSize: 12 }}> / {totalRemaining}kg</small></strong><small>冻结不扣实际库存，补给后转实耗</small></article>
      <article><span>待重试写入</span><strong>{state.pendingWrites.length}</strong><small>从最后完整排程重试</small></article>
    </div>

    <div className="toolbar">
      <Badge status="processing" text="当前值班员" />
      <input className="ant-input" style={{ maxWidth: 200 }} value={operator} onChange={(event) => setOperator(event.target.value)} />
      <Button onClick={() => { const result = state.planAll(operator); result.ok ? message.success(result.message) : message.warning(result.message) }}>全量排程</Button>
      <Button onClick={retry} disabled={state.pendingWrites.length === 0}>从最后完整排程重试 ({state.pendingWrites.length})</Button>
      <Space><span style={{ color: '#7c898c', fontSize: 12 }}>演练：下一次写入失败</span><Switch checked={state.failNextWrite} onChange={state.setFailNextWrite} /></Space>
    </div>

    {queuedCount > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }}
      message={`${queuedCount} 票排程被阻断并已排队，位次与干冰都未被扣减`}
      description="排队项按提交时刻 FIFO；任意资源释放后点击「全量排程」或重放该票即可自动补位。" />}

    <Table<Reservation> rowKey="id" size="small" columns={reservationColumns} dataSource={reservations} pagination={false} />

    <div className="resource-grid">
      <Card size="small" title="预冷位容量（同温区 / 同货站 / 时间窗互斥）">
        <div className="slot-grid">
          {state.slots.map((slot) => {
            const rows = windowRows(slot, state.reservations)
            return <div key={slot.id} className="slot-card">
              <div className="slot-head"><strong>{slot.id}</strong><Tag>{TEMP_ZONES[slot.zone].label}</Tag></div>
              <small>{slot.station} · 容量 {slot.capacity}</small>
              <div className="slot-lanes">{rows.map((row) => <div key={row.key} className={row.reservation.status === '已补给' ? 'done' : row.reservation.status === '排队中' ? 'queued' : ''} title={`${row.reservation.containerId} ${fmt(toIso(row.start))}~${fmt(toIso(row.end))}`}>
                {row.reservation.containerId}<span>{fmt(toIso(row.start))} - {fmt(toIso(row.end))}</span>
              </div>)}</div>
            </div>
          })}
        </div>
      </Card>
      <Card size="small" title="干冰批次余量（冻结 vs 实耗）">
        {state.batches.map((batch) => {
          const frozen = frozenByBatch[batch.id] ?? 0
          const remaining = batch.receivedKg - batch.consumedKg - frozen
          const percent = Math.round((remaining / batch.receivedKg) * 100)
          return <div key={batch.id} className="batch-row">
            <Descriptions size="small" column={4} items={[
              { key: 'id', label: '批次', children: <strong>{batch.id}</strong> },
              { key: 'received', label: '到货', children: `${batch.receivedKg}kg` },
              { key: 'consumed', label: '已实耗（已完成，保留）', children: `${batch.consumedKg}kg` },
              { key: 'frozen', label: '在途冻结', children: `${frozen}kg` }
            ]} />
            <Progress percent={Math.max(0, percent)} size="small" status={remaining <= 0 ? 'exception' : 'active'} format={() => `余量 ${remaining}kg`} />
            <small className="cell-sub">{batch.note} · 到货 {fmt(batch.receivedAt)}</small>
          </div>
        })}
      </Card>
    </div>

    <Card size="small" title="排程规则与一致性保证" style={{ marginTop: 14 }}>
      <Timeline items={[
        { color: 'green', children: '航段温区决定预冷位池与准备时长：2~8℃ 4h、-2~-25℃ 6h、-15~-25℃ 8h，按航段起飞时间倒推预冷窗。' },
        { color: 'green', children: '同一温区+货站的预冷位时间窗互斥，同一只温控箱不会被两名值班员占两次；干冰按批次 FIFO 冻结，重复操作返回同一占用。' },
        { color: 'orange', children: '预冷位或干冰容量不足时进入排队并列出分钟/kg 缺口；写入失败只暂存意图，最后完整排程不受污染，重试不重复扣减。' },
        { color: 'blue', children: '设备报告更新后，「已排程/排队中」的安排立即失效（释放位次与冻结）并全量重算；「已预冷/已补给」保留原批次和实际耗量。' }
      ]} />
    </Card>

    <Modal title="确认干冰补给（冻结量转批次实耗）" open={!!supplyTarget} onCancel={() => setSupplyTarget(null)} onOk={confirmSupply} okText="确认实装">
      {supplyTarget && <Descriptions column={1} size="small" bordered items={[
        { key: 'r', label: '安排', children: `${supplyTarget.shipmentId} / ${supplyTarget.segmentId} / ${supplyTarget.containerId}` },
        { key: 's', label: '预冷位', children: `${supplyTarget.slotId}（${TEMP_ZONES[supplyTarget.zone].label}）` },
        { key: 'a', label: '冻结批次', children: supplyTarget.allocations.map((item) => `${item.batchId}：${item.kg}kg`).join('；') }
      ]} />}
      <div style={{ height: 12 }} />
      <InputNumber min={1} value={supplyKg} onChange={(value) => setSupplyKg(Number(value) ?? 0)} addonAfter="kg" style={{ width: '100%' }} />
      <p style={{ color: '#839094', fontSize: 12, marginTop: 8 }}>实装量须与冻结量一致；数量有变请先更新设备报告触发重排。确认后批次实耗永久入账，重复确认不重复扣减。</p>
    </Modal>
  </section>
}
