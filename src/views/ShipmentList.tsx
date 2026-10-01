import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Input, Select, Space, Table, Tag, Tooltip } from 'antd'
import { useShipmentStore } from '../store/useShipmentStore'
import { loadShipmentSnapshot } from '../services/api'
import { statusColor as reservationStatusColor, TEMP_ZONES } from '../services/schedulingEngine'
import type { Reservation, Shipment, ShipmentStatus } from '../types'

const statusColor = (status: ShipmentStatus) => status === '已放行' ? 'success' : status === '已拒绝' ? 'error' : status === '待放行' ? 'warning' : 'processing'

export function ShipmentList() {
  const navigate = useNavigate()
  const state = useShipmentStore()
  const { isFetching } = useQuery({ queryKey: ['shipments'], queryFn: () => loadShipmentSnapshot(state.shipments), staleTime: 60000 })
  const rows = useMemo(() => state.shipments.filter((item) => {
    const text = `${item.id} ${item.product} ${item.batch} ${item.route} ${item.containerId}`.toLowerCase()
    return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
  }), [state.shipments, state.keyword, state.status])
  const reservationsByShipment = useMemo(() => {
    const map = new Map<string, Reservation[]>()
    for (const reservation of state.reservations) {
      const list = map.get(reservation.shipmentId) ?? []
      list.push(reservation)
      map.set(reservation.shipmentId, list)
    }
    return map
  }, [state.reservations])
  const columns = [
    { title: '任务编号', dataIndex: 'id', width: 150 },
    { title: '货物', dataIndex: 'product', render: (value: string, row: Shipment) => <div><strong>{value}</strong><small className="cell-sub">{row.batch}</small></div> },
    { title: '航线', dataIndex: 'route', width: 210 },
    { title: '温控箱', dataIndex: 'containerId', width: 105 },
    { title: '范围', render: (_: unknown, row: Shipment) => `${row.tempMin} - ${row.tempMax} ℃`, width: 95 },
    {
      title: '预冷位 / 干冰占用', width: 245,
      render: (_: unknown, row: Shipment) => {
        const list = reservationsByShipment.get(row.id) ?? []
        const active = list.filter((item) => item.status !== '已失效')
        if (active.length === 0) return <small className="cell-sub">尚无货站排程</small>
        return <Space size={4} wrap>{active.map((item) => <Tooltip key={item.id} title={item.status === '排队中'
          ? `${item.blockReason}${item.slotGap > 0 ? `；冷位缺口 ${Math.round(item.slotGap)} 分钟` : ''}${item.iceGapKg > 0 ? `；干冰缺口 ${item.iceGapKg}kg` : ''}`
          : `${item.slotId} ${item.preCoolStart.replace('T', ' ').slice(5, 16)}~${item.preCoolEnd.replace('T', ' ').slice(11, 16)}；冻结 ${item.frozenKg}kg（${TEMP_ZONES[item.zone].label}）`}>
          <Tag color={reservationStatusColor(item.status)} style={{ marginInlineEnd: 0 }}>
            {item.status === '排队中' ? `排队·${item.iceRequiredKg}kg` : `${item.slotId.replace('PC-', '')} ${item.frozenKg}kg`}
          </Tag>
        </Tooltip>)}</Space>
      }
    },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: ShipmentStatus) => <Tag color={statusColor(value)}>{value}</Tag> },
    { title: '版本', dataIndex: 'version', width: 65, render: (value: number) => `V${value}` },
    { title: '', width: 80, render: (_: unknown, row: Shipment) => <Button type="link" onClick={() => navigate(`/shipments/${row.id}`)}>打开</Button> }
  ]
  return <section className="page">
    <header className="page-head"><div><p>温控运输中心 / 在途与待放行</p><h1>温控货物运输任务</h1></div><span className="sync">{isFetching ? '正在同步' : '本地证据快照已加载'}</span></header>
    <div className="metrics">
      <article><span>运输任务</span><strong>{state.shipments.length}</strong><small>PVG与PEK始发</small></article>
      <article><span>待放行</span><strong>{state.shipments.filter((item) => item.status === '待放行').length}</strong><small>需完成证据核验</small></article>
      <article><span>未关闭偏差</span><strong>{state.deviations.filter((item) => item.status !== '已关闭').length}</strong><small>温度超限调查</small></article>
      <article><span>待核验文件</span><strong>{state.shipments.flatMap((item) => item.evidence).filter((item) => !item.verified).length}</strong><small>不得直接放行</small></article>
    </div>
    <div className="toolbar">
      <Input value={state.keyword} onChange={(event) => state.setKeyword(event.target.value)} allowClear placeholder="搜索任务、货物、批次、航线或温控箱" />
      <Select value={state.status} onChange={state.setStatus} options={['全部', '待装机', '运输中', '待放行', '已放行', '已拒绝'].map((value) => ({ label: value, value }))} />
      <Badge status="processing" text="温度点按原始时间持久化" />
    </div>
    <Table rowKey="id" size="small" columns={columns} dataSource={rows} pagination={false} />
  </section>
}
