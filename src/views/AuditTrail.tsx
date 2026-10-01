import { Button, Input, Table, Tag } from 'antd'
import { useMemo, useState } from 'react'
import { useShipmentStore } from '../store/useShipmentStore'
import type { AuditEntry } from '../types'

export function AuditTrail() {
  const state = useShipmentStore()
  const [keyword, setKeyword] = useState('')
  const rows = useMemo(() => state.audit.filter((item) => `${item.shipmentId} ${item.action} ${item.operator} ${item.detail}`.toLowerCase().includes(keyword.toLowerCase())), [state.audit, keyword])
  const exportReport = () => {
    const report = { generatedAt: new Date().toISOString(), shipments: state.shipments, deviations: state.deviations, stations: state.stations, iceBatches: state.iceBatches, allocations: state.allocations, gaps: state.gaps, reportVersions: state.reportVersions, audit: state.audit }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '航空温控放行报告.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  const actionColor = (value: string) =>
    value.includes('偏差') ? 'warning'
    : value.includes('缺口') || value.includes('重复') || value.includes('失败') ? 'error'
    : value.includes('补给') || value.includes('排程') || value.includes('报告') ? 'geekblue'
    : 'processing'
  const columns = [
    { title: '时间', dataIndex: 'createdAt', width: 160, render: (value: string) => value.replace('T', ' ').slice(0, 16) },
    { title: '运输任务', dataIndex: 'shipmentId', width: 160, render: (value: string) => value === '*' ? <Tag>批量</Tag> : value },
    { title: '动作', dataIndex: 'action', width: 200, render: (value: string) => <Tag color={actionColor(value)}>{value}</Tag> },
    { title: '操作人', dataIndex: 'operator', width: 170 },
    { title: '说明（占用 / 余量 / 阻断原因）', dataIndex: 'detail' }
  ]
  return <section className="page"><header className="page-head"><div><p>温度点 / 证据版本 / 签收 / 放行决定</p><h1>完整报告与审计</h1></div><Button type="primary" onClick={exportReport}>导出完整报告</Button></header>
    <div className="toolbar"><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear placeholder="搜索任务、动作、操作人或说明" /><span>共{rows.length}条审计事件</span></div>
    <Table<AuditEntry> rowKey="id" size="small" columns={columns} dataSource={rows} pagination={{ pageSize: 12 }} />
  </section>
}
