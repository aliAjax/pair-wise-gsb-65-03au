import { Button, Input, Space, Table, Tag } from 'antd'
import { useMemo, useState } from 'react'
import { useShipmentStore } from '../store/useShipmentStore'
import type { AuditEntry } from '../types'

export function AuditTrail() {
  const state = useShipmentStore()
  const [keyword, setKeyword] = useState('')
  const rows = useMemo(() => state.audit.filter((item) => `${item.shipmentId} ${item.action} ${item.operator} ${item.detail} ${item.reservationId ?? ''}`.toLowerCase().includes(keyword.toLowerCase())), [state.audit, keyword])
  const exportReport = () => {
    const report = { generatedAt: new Date().toISOString(), shipments: state.shipments, deviations: state.deviations, slots: state.slots, batches: state.batches, reservations: state.reservations, pendingWrites: state.pendingWrites, audit: state.audit }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '航空温控放行报告.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  const columns = [
    { title: '时间', dataIndex: 'createdAt', width: 150, render: (value: string) => value.replace('T', ' ').slice(0, 16) },
    { title: '运输任务', dataIndex: 'shipmentId', width: 145 },
    { title: '关联安排', dataIndex: 'reservationId', width: 140, render: (value?: string) => value ?? '—' },
    {
      title: '动作', dataIndex: 'action', width: 180,
      render: (value: string, row: AuditEntry) => <Space size={4}><Tag color={categoryColor(row.category)}>{row.category ?? '任务'}</Tag><span>{value}</span></Space>
    },
    { title: '操作人', dataIndex: 'operator', width: 130 },
    { title: '说明', dataIndex: 'detail' }
  ]
  return <section className="page"><header className="page-head"><div><p>温度点 / 证据版本 / 签收 / 放行决定</p><h1>完整报告与审计</h1></div><Button type="primary" onClick={exportReport}>导出完整报告</Button></header>
    <div className="toolbar"><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear placeholder="搜索任务、安排编号、动作、操作人或说明" /><span>共{rows.length}条审计事件（含占用、余量变动与阻断原因）</span></div>
    <Table<AuditEntry> rowKey="id" size="small" columns={columns} dataSource={rows} pagination={{ pageSize: 12 }} />
  </section>
}

function categoryColor(category?: AuditEntry['category']): string {
  switch (category) {
    case '排程': return 'geekblue'
    case '偏差': return 'warning'
    case '放行': return 'success'
    case '签收': return 'cyan'
    case '证据': return 'default'
    default: return 'processing'
  }
}
