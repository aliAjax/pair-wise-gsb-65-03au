import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Badge, Button, Card, DatePicker, Descriptions, Divider, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Upload, message } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { TemperatureChart } from '../components/TemperatureChart'
import { useShipmentStore } from '../store/useShipmentStore'
import { TEMP_ZONES, statusColor as reservationStatusColor } from '../services/schedulingEngine'
import type { EvidenceFile, Reservation, ShipmentSegment } from '../types'

export function ShipmentDetail() {
  const { id } = useParams()
  const state = useShipmentStore()
  const shipment = state.shipments.find((item) => item.id === id)
  const [activeSegmentId, setActiveSegmentId] = useState(shipment?.segments[0]?.id ?? '')
  const [signOpen, setSignOpen] = useState(false)
  const [deviationOpen, setDeviationOpen] = useState(false)
  const [form] = Form.useForm()
  if (!shipment) return <section className="page empty">未找到运输任务</section>
  const activeSegment = shipment.segments.find((item) => item.id === activeSegmentId) ?? shipment.segments[0]
  const deviations = state.deviations.filter((item) => item.shipmentId === shipment.id)
  const openDeviations = deviations.filter((item) => item.status !== '已关闭')
  const reservations = state.reservations
    .filter((item) => item.shipmentId === shipment.id)
    .sort((a, b) => (a.segmentId.localeCompare(b.segmentId)))
  const reservationColumns = [
    { title: '航段', dataIndex: 'segmentId', width: 70 },
    { title: '温区', dataIndex: 'zone', width: 115, render: (value: Reservation['zone']) => TEMP_ZONES[value].label },
    { title: '货站', dataIndex: 'station', width: 110 },
    {
      title: '预冷位 / 时间窗', render: (_: unknown, row: Reservation) => row.status === '排队中'
        ? <Tag color="warning">等待位次释放</Tag>
        : <div><strong>{row.slotId}</strong><small className="cell-sub">{row.preCoolStart.replace('T', ' ').slice(5, 16)} ~ {row.preCoolEnd.replace('T', ' ').slice(5, 16)}</small></div>
    },
    {
      title: '干冰冻结', render: (_: unknown, row: Reservation) => <div>
        <strong>需求 {row.iceRequiredKg}kg</strong>
        <small className="cell-sub">{row.allocations.map((item) => `${item.batchId} ${item.kg}kg`).join('、') || '未冻结'}</small>
      </div>
    },
    { title: '状态', dataIndex: 'status', width: 85, render: (value: Reservation['status']) => <Tag color={reservationStatusColor(value)}>{value}</Tag> },
    {
      title: '阻断 / 缺口', width: 230,
      render: (_: unknown, row: Reservation) => row.status !== '排队中'
        ? <span className="cell-sub">{row.status === '已补给' ? `已实装 ${row.suppliedKg}kg（${row.suppliedAt.replace('T', ' ').slice(5, 16)}）` : '占用锁定中'}</span>
        : <Space direction="vertical" size={2}>
          <Tag color="volcano">{row.blockReason}</Tag>
          {row.slotGap > 0 && <small>冷位缺口 {Math.round(row.slotGap)} 分钟</small>}
          {row.iceGapKg > 0 && <small>干冰缺口 {row.iceGapKg}kg</small>}
        </Space>
    }
  ]
  const evidenceColumns = [
    { title: '文件', dataIndex: 'name', render: (value: string, row: EvidenceFile) => <div><strong>{value}</strong><small className="cell-sub">{row.category} · V{row.version}</small></div> },
    { title: '上传', render: (_: unknown, row: EvidenceFile) => `${row.uploadedBy} ${row.uploadedAt.replace('T', ' ').slice(0, 16)}` },
    { title: '核验', dataIndex: 'verified', width: 95, render: (value: boolean, row: EvidenceFile) => value ? <Tag color="success">已核验</Tag> : <Button size="small" onClick={() => state.verifyEvidence(shipment.id, row.id)}>核验</Button> }
  ]
  const sign = async () => {
    const values = await form.validateFields()
    const result = state.sign(shipment.id, values.role, values.comment ?? '', values.decision)
    result.ok ? message.success(result.message) : message.error(result.message)
    if (result.ok) setSignOpen(false)
  }
  const createDeviation = async () => {
    const values = await form.validateFields()
    state.createDeviation(shipment.id, values.segmentId, values.title, values.severity)
    setDeviationOpen(false)
    message.success('已创建偏差并进入调查队列')
  }
  const release = () => {
    const result = state.setShipmentStatus(shipment.id, '已放行')
    result.ok ? message.success(result.message) : message.error(result.message)
  }
  return <section className="page">
    <header className="page-head detail-head">
      <div><p>{shipment.id} · {shipment.batch}</p><h1>{shipment.product}</h1></div>
      <Space><Tag color={shipment.status === '已放行' ? 'success' : 'warning'}>{shipment.status}</Tag><Button onClick={() => setDeviationOpen(true)}>登记偏差</Button><Button onClick={() => setSignOpen(true)}>角色签收</Button><Button type="primary" onClick={release}>放行审核</Button></Space>
    </header>
    {openDeviations.length > 0 && <Alert type="error" showIcon message={`存在${openDeviations.length}项未关闭温度偏差，系统阻止放行`} />}
    <Descriptions className="summary-band" size="small" column={5} items={[
      { key: 'route', label: '运输路线', children: shipment.route },
      { key: 'box', label: '温控箱', children: shipment.containerId },
      { key: 'range', label: '允许范围', children: `${shipment.tempMin} - ${shipment.tempMax} ℃` },
      { key: 'version', label: '任务版本', children: `V${shipment.version}` },
      { key: 'updated', label: '最近更新', children: shipment.updatedAt.replace('T', ' ').slice(0, 16) }
    ]} />
    <div className="detail-grid">
      <div className="timeline-panel">
        <div className="panel-title"><h2>航段时间轴</h2><span>原始温度点不可修改</span></div>
        {shipment.segments.map((segment) => <button key={segment.id} className={activeSegment.id === segment.id ? 'active' : ''} onClick={() => setActiveSegmentId(segment.id)}>
          <div className="segment-index">{segment.id.replace('SEG-', '')}</div>
          <div><strong>{segment.from} → {segment.to}</strong><span>{segment.flight} · {segment.plannedStart.replace('T', ' ').slice(0, 16)}</span><small>操作人：{segment.handler} · {segment.note}</small></div>
          <Badge status={segment.temperature.some((item) => item.value < shipment.tempMin || item.value > shipment.tempMax) ? 'error' : 'success'} />
        </button>)}
      </div>
      <div className="chart-panel">
        <div className="panel-title"><h2>{activeSegment.from} → {activeSegment.to}</h2><span>{activeSegment.flight}</span></div>
        <TemperatureChart points={activeSegment.temperature} min={shipment.tempMin} max={shipment.tempMax} />
        <div className="segment-meta"><span>计划：{activeSegment.plannedStart.replace('T', ' ').slice(0, 16)}</span><span>实际：{activeSegment.actualStart.replace('T', ' ').slice(0, 16)} - {activeSegment.actualEnd.replace('T', ' ').slice(0, 16)}</span></div>
      </div>
    </div>
    <Tabs className="detail-tabs" items={[
      { key: 'evidence', label: `证据版本 (${shipment.evidence.length})`, children: <div><div className="tab-actions"><Upload beforeUpload={() => { state.addEvidence(shipment.id, { name: `现场补充材料-${Date.now()}.pdf`, category: '包装确认', uploadedBy: '当前用户', verified: false }); message.success('已新增证据版本'); return false }} showUploadList={false}><Button icon={<UploadOutlined />}>上传证据</Button></Upload><span>同分类文件自动递增版本</span></div><Table rowKey="id" size="small" columns={evidenceColumns} dataSource={shipment.evidence} pagination={false} /></div> },
      { key: 'signatures', label: `签收记录 (${shipment.signatures.filter((item) => item.status === '已签').length}/${shipment.signatures.length})`, children: <div className="signature-grid">{shipment.signatures.map((item) => <Card key={item.role} size="small"><div className="signature-head"><strong>{item.role}</strong><Tag color={item.status === '已签' ? 'success' : item.status === '已退回' ? 'error' : 'default'}>{item.status}</Tag></div><p>{item.name}</p><small>{item.signedAt ? item.signedAt.replace('T', ' ').slice(0, 16) : '尚未签署'}</small><Divider /><span>{item.comment || '暂无意见'}</span></Card>)}</div> },
      { key: 'deviations', label: `偏差 (${deviations.length})`, children: <Table rowKey="id" size="small" pagination={false} dataSource={deviations} columns={[{ title: '编号', dataIndex: 'id' }, { title: '标题', dataIndex: 'title' }, { title: '状态', dataIndex: 'status' }, { title: '版本', dataIndex: 'version', render: (value: number) => `V${value}` }]} /> },
      {
        key: 'scheduling', label: `冷链准备 (${reservations.length})`,
        children: <div>
          <div className="tab-actions">
            <Space>
              <Button type="primary" onClick={() => {
                const result = state.submitReservation(shipment.id, '值班员 高岚')
                result.ok ? message.success(result.message) : message.warning(result.message)
              }}>提交 / 重放排程</Button>
              <Button onClick={() => {
                const result = state.receiveEquipmentReport(shipment.id, '设备值班员 沈牧', 600)
                result.ok ? message.success(result.message) : message.warning(result.message)
              }}>模拟设备报告更新（延误10h）</Button>
            </Space>
            <span>同一占用与余量：位次按温区+货站+时间窗互斥，干冰按批次冻结；报告更新后未开始安排失效重算，已完成保留原批次耗量</span>
          </div>
          <Table<Reservation> rowKey="id" size="small" pagination={false} dataSource={reservations} columns={reservationColumns} />
        </div>
      }
    ]} />
    <Modal title="多角色签收" open={signOpen} onCancel={() => setSignOpen(false)} onOk={sign} okText="提交签收">
      <Form form={form} layout="vertical" initialValues={{ role: '放行人员', decision: '已签' }}>
        <Form.Item name="role" label="签收角色" rules={[{ required: true }]}><Select options={shipment.signatures.map((item) => ({ label: item.role, value: item.role }))} /></Form.Item>
        <Form.Item name="decision" label="签收决定" rules={[{ required: true }]}><Select options={[{ label: '签署确认', value: '已签' }, { label: '退回补充', value: '已退回' }]} /></Form.Item>
        <Form.Item name="comment" label="签收意见"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="登记温度偏差" open={deviationOpen} onCancel={() => setDeviationOpen(false)} onOk={createDeviation} okText="创建偏差">
      <Form form={form} layout="vertical" initialValues={{ segmentId: activeSegment.id, severity: '一般' }}>
        <Form.Item name="segmentId" label="发生航段" rules={[{ required: true }]}><Select options={shipment.segments.map((item) => ({ label: `${item.from} → ${item.to}`, value: item.id }))} /></Form.Item>
        <Form.Item name="title" label="偏差描述" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Form.Item name="severity" label="严重度" rules={[{ required: true }]}><Select options={['一般', '重大'].map((value) => ({ label: value, value }))} /></Form.Item>
      </Form>
    </Modal>
  </section>
}
