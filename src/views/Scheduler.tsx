import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Popconfirm, Progress, Space, Table, Tag, Tooltip, message } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { armNextWriteFailure, useShipmentStore } from '../store/useShipmentStore'
import {
  ZONE_COLOR, activeAllocations, allocationsOfShipment, batchViews, fmt,
  gapsOfShipment, stationCapacityView, zoneOf
} from '../services/scheduling'
import type { AllocationGap, ScheduleAllocation } from '../types'

const statusTag = (status: ScheduleAllocation['status']) => {
  const color = status === '已排定' ? 'processing' : status === '排队' ? 'error' : status === '已完成' ? 'success' : 'default'
  return <Tag color={color}>{status}</Tag>
}

export function Scheduler() {
  const navigate = useNavigate()
  const state = useShipmentStore()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [lastDual, setLastDual] = useState<{ a: string; b: string } | null>(null)

  const stations = useMemo(() => stationCapacityView(state.stations, state.allocations), [state.stations, state.allocations])
  const batches = useMemo(() => batchViews(state.iceBatches, state.allocations), [state.iceBatches, state.allocations])
  const active = useMemo(() => activeAllocations(state.allocations), [state.allocations])

  const frozenKg = Math.round(batches.reduce((sum, item) => sum + item.frozenKg, 0) * 10) / 10
  const consumedKg = Math.round(batches.reduce((sum, item) => sum + item.consumedKg, 0) * 10) / 10
  const queuedShipments = new Set(state.gaps.map((item) => item.shipmentId))
  const selectable = state.shipments.filter((shipment) =>
    shipment.segments.some((segment) => segment.flight !== '陆运' && Date.parse(segment.plannedStart) >= Date.parse(new Date().toISOString().slice(0, 10))))
  const submit = (operator: string, ids: string[]) => {
    const result = state.submitSchedule(ids, operator)
    result.ok ? message.success(result.message) : message.error(result.message)
    return result
  }

  /** 两名值班员同时提交同一批任务：第二次命中幂等指纹，不重复占冷位/扣干冰 */
  const dualSubmit = () => {
    const ids = selectedIds.length ? selectedIds : selectable.map((item) => item.id)
    const a = submit('值班员 王磊（预冷位）', ids)
    const b = submit('值班员 陈晨（干冰补给）', ids)
    if (a.ok && b.ok) setLastDual({ a: a.message, b: b.message })
  }

  const supply = (allocation: ScheduleAllocation) => {
    const result = state.supplyAllocation(allocation.id, '值班员 陈晨（干冰补给）')
    result.ok ? message.success(result.message) : message.error(result.message)
  }
  const complete = (allocation: ScheduleAllocation) => {
    const result = state.completeAllocation(allocation.id, '货站值班长')
    result.ok ? message.success(result.message) : message.error(result.message)
  }
  const reportUpdate = (shipmentId: string) => {
    const result = state.applyDeviceReport(shipmentId, '设备监测系统')
    result.ok ? message.success(result.message) : message.error(result.message)
  }
  const armFailure = () => {
    armNextWriteFailure()
    message.warning('已令下一次持久化写入失败，随后提交将从最后完整排程重试')
  }

  const stationColumns = [
    { title: '预冷位', render: (_: unknown, row: typeof stations[number]) => <div><strong>{row.station.name}</strong><small className="cell-sub">{row.station.id}</small></div> },
    { title: '温区', dataIndex: ['station', 'zone'], width: 80, render: (zone: keyof typeof ZONE_COLOR) => <Tag color={ZONE_COLOR[zone]}>{zone}</Tag> },
    { title: '冷位容量', width: 200, render: (_: unknown, row: typeof stations[number]) => <Progress percent={Math.round(row.peakUsed / row.station.capacity * 100)} size="small" format={() => `${row.peakUsed}/${row.station.capacity}`} status={row.peakUsed >= row.station.capacity ? 'exception' : 'active'} /> },
    { title: '余量', width: 90, render: (_: unknown, row: typeof stations[number]) => row.available > 0 ? <Tag color="success">余 {row.available}</Tag> : <Tag color="error">已满</Tag> }
  ]

  const batchColumns = [
    { title: '干冰批次', render: (_: unknown, row: typeof batches[number]) => <div><strong>{row.batch.id}</strong><small className="cell-sub">{row.batch.note} · 到货 {fmt(row.batch.receivedAt)}</small></div> },
    { title: '总量', dataIndex: ['batch', 'totalKg'], width: 90, render: (value: number) => `${value}kg` },
    { title: '冻结中', dataIndex: 'frozenKg', width: 100, render: (value: number) => <Tag color="processing">冻结 {value}kg</Tag> },
    { title: '已实耗', dataIndex: 'consumedKg', width: 100, render: (value: number) => <Tag color="warning">实耗 {value}kg</Tag> },
    { title: '余量', dataIndex: 'remainingKg', width: 100, render: (value: number) => value > 0 ? <Tag color="success">余 {value}kg</Tag> : <Tag color="error">0kg</Tag> }
  ]

  const allocationColumns = [
    { title: '预冷窗口', width: 175, render: (_: unknown, row: ScheduleAllocation) => <div><strong>{fmt(row.windowStart)}</strong><small className="cell-sub">至 {fmt(row.windowEnd)}</small></div> },
    { title: '运输任务 / 航段', render: (_: unknown, row: ScheduleAllocation) => {
      const shipment = state.shipments.find((item) => item.id === row.shipmentId)
      const segment = shipment?.segments.find((item) => item.id === row.segmentId)
      return <div><Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/shipments/${row.shipmentId}`)}><strong>{row.shipmentId}</strong></Button><small className="cell-sub">{row.segmentId} · {segment?.flight} · {segment?.from} → {segment?.to}</small></div>
    } },
    { title: '温控箱', dataIndex: 'containerId', width: 105 },
    { title: '温区', dataIndex: 'zone', width: 75, render: (zone: keyof typeof ZONE_COLOR) => <Tag color={ZONE_COLOR[zone]}>{zone}</Tag> },
    { title: '预冷位', width: 130, render: (_: unknown, row: ScheduleAllocation) => row.precoolStationId ? state.stations.find((item) => item.id === row.precoolStationId)?.name ?? row.precoolStationId : <Tag>未分配</Tag> },
    { title: '冻结干冰', width: 210, render: (_: unknown, row: ScheduleAllocation) => row.iceLines.length
      ? <Space size={4} wrap>{row.iceLines.map((line) => <Tooltip key={line.batchId} title={row.supplyStatus === '已补给' ? `已实耗 ${line.consumedKg}kg` : '冻结中，补给时转为实耗'}><Tag color={row.supplyStatus === '已补给' ? 'warning' : 'blue'}>{line.batchId} {line.frozenKg}kg</Tag></Tooltip>)}</Space>
      : <span className="cell-sub">—</span> },
    { title: '状态', width: 150, render: (_: unknown, row: ScheduleAllocation) => <Space direction="vertical" size={2}>{statusTag(row.status)}{row.supplyStatus === '已补给' && <Tag color="warning">已补给</Tag>}</Space> },
    { title: '阻断原因', width: 200, render: (_: unknown, row: ScheduleAllocation) => row.blockReason ? <Tooltip title={row.blockReason}><Tag color="error">{gapsOfShipment(state.gaps, row.shipmentId).filter((item) => item.allocationId === row.id).map((item) => item.blockKind).join('、') || '阻断'}</Tag></Tooltip> : <span className="cell-sub">无</span> },
    { title: '操作', width: 200, render: (_: unknown, row: ScheduleAllocation) => <Space direction="vertical" size={2}>
      <Button size="small" type="primary" ghost disabled={row.status !== '已排定' || row.supplyStatus === '已补给'} onClick={() => supply(row)}>执行补给</Button>
      <Button size="small" disabled={row.supplyStatus !== '已补给' || row.status === '已完成'} onClick={() => complete(row)}>标记完成</Button>
    </Space> }
  ]

  const gapColumns = [
    { title: '阻断类型', dataIndex: 'blockKind', width: 110, render: (value: AllocationGap['blockKind']) => <Tag color="error">{value}</Tag> },
    { title: '运输任务', dataIndex: 'shipmentId', width: 140, render: (value: string) => <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/shipments/${value}`)}>{value}</Button> },
    { title: '温控箱', dataIndex: 'containerId', width: 105 },
    { title: '温区', dataIndex: 'zone', width: 75, render: (zone: keyof typeof ZONE_COLOR) => <Tag color={ZONE_COLOR[zone]}>{zone}</Tag> },
    { title: '预冷窗口', width: 170, render: (_: unknown, row: AllocationGap) => `${fmt(row.windowStart)} ~ ${fmt(row.windowEnd)}` },
    { title: '缺口明细', dataIndex: 'detail' }
  ]

  return <section className="page">
    <header className="page-head">
      <div><p>运输任务 / 航段 / 温控箱 / 预冷位 / 干冰批次 一体化排程</p><h1>货站预冷位与干冰补给排程</h1></div>
      <Space>
        <Tooltip title="令下一次写入失败，用于验证“从最后完整排程重试、不重复扣减”"><Button danger onClick={armFailure} icon={<ThunderboltOutlined />}>模拟下次写入失败</Button></Tooltip>
        <Button onClick={dualSubmit}>两名值班员同时提交</Button>
        <Button type="primary" onClick={() => submit('值班员 王磊（预冷位）', selectedIds.length ? selectedIds : selectable.map((item) => item.id))}>提交排程</Button>
      </Space>
    </header>

    <div className="metrics">
      <article><span>已排定占用</span><strong>{active.filter((item) => item.status === '已排定').length}</strong><small>冷位与干冰原子预留</small></article>
      <article><span>排队缺口</span><strong>{queuedShipments.size}</strong><small>{state.gaps.length} 条阻断原因</small></article>
      <article><span>冻结干冰</span><strong>{frozenKg}kg</strong><small>补给前未实扣批次</small></article>
      <article><span>已实耗</span><strong>{consumedKg}kg</strong><small>完成补给锁定耗量</small></article>
    </div>

    {lastDual && <Alert type="info" showIcon style={{ marginBottom: 12 }}
      message="两名值班员同时提交结果"
      description={<Space direction="vertical"><span>值班员A：{lastDual.a}</span><span>值班员B：{lastDual.b}</span></Space>} />}
    {state.gaps.length > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }}
      message={`${queuedShipments.size} 票任务存在 ${state.gaps.length} 项缺口，已自动排队（不占用冷位、不扣干冰）`} />}

    <div className="scheduler-grid">
      <div>
        <div className="panel-title"><h2>预冷位容量</h2><span>按温区分组，窗口重叠叠加计数</span></div>
        <Table rowKey={(row) => row.station.id} size="small" columns={stationColumns} dataSource={stations} pagination={false} />
      </div>
      <div>
        <div className="panel-title"><h2>干冰批次余量</h2><span>余量 = 总量 − 冻结 − 实耗</span></div>
        <Table rowKey={(row) => row.batch.id} size="small" columns={batchColumns} dataSource={batches} pagination={false} />
      </div>
    </div>

    <div className="panel-title"><h2>待提交运输任务</h2><span>勾选后提交；不勾选则提交全部</span></div>
    <Table rowKey="id" size="small" className="scheduler-pick" pagination={false}
      rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as string[]) }}
      dataSource={selectable}
      columns={[
        { title: '运输任务', dataIndex: 'id', width: 150 },
        { title: '温控箱', dataIndex: 'containerId', width: 105 },
        { title: '温区', width: 80, render: (_: unknown, row) => <Tag color={ZONE_COLOR[zoneOf(row.tempMin, row.tempMax)]}>{zoneOf(row.tempMin, row.tempMax)}</Tag> },
        { title: '航段', render: (_: unknown, row) => row.segments.filter((item: { flight: string }) => item.flight !== '陆运').map((item: { flight: string; plannedStart: string }) => `${item.flight} ${fmt(item.plannedStart)}`).join(' / ') },
        { title: '当前占用', render: (_: unknown, row) => {
          const mine = allocationsOfShipment(state.allocations, row.id).filter((item) => item.status !== '已失效')
          const blocked = gapsOfShipment(state.gaps, row.id)
          return <Space size={4} wrap>
            {mine.length === 0 && <span className="cell-sub">未排程</span>}
            {mine.map((item) => <Badge key={item.id} status={item.status === '排队' ? 'error' : item.status === '已完成' ? 'success' : 'processing'} text={`${item.segmentId} ${item.status}`} />)}
            {blocked.length > 0 && <Tag color="error">{[...new Set(blocked.map((item) => item.blockKind))].join('、')}</Tag>}
          </Space>
        } },
        { title: '设备报告', width: 220, render: (_: unknown, row) => <Space><Tag>V{state.reportVersions[row.id] ?? 1}</Tag><Popconfirm title="模拟设备报告更新？未开始补给的安排将失效重算，已完成的保留" onConfirm={() => reportUpdate(row.id)}><Button size="small">设备报告更新</Button></Popconfirm></Space> }
      ]} />

    <div className="panel-title" style={{ marginTop: 16 }}><h2>占用与补给队列</h2><span>任务列表、详情与审计展示同一占用、余量与阻断原因</span></div>
    <Table rowKey="id" size="small" columns={allocationColumns} dataSource={state.allocations} pagination={{ pageSize: 8 }} />

    <div className="panel-title" style={{ marginTop: 16 }}><h2>缺口清单</h2><span>容量不足排队时逐票列出</span></div>
    <Table rowKey={(row) => row.allocationId + row.blockKind} size="small" columns={gapColumns} dataSource={state.gaps} pagination={false} />
  </section>
}
