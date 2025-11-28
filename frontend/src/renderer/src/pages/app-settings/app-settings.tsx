// Copyright (c) 2025 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: Apache-2.0

import React from 'react'
import { Card, Button, Message, Space } from '@arco-design/web-react'
import { getLogger } from '@shared/logger/renderer'
import axiosInstance from '@renderer/services/axiosConfig'

const logger = getLogger('AppSettings')

const AppSettings: React.FC = () => {
  const runAction = async (label: string, fn: () => Promise<any>) => {
    try {
      await fn()
      Message.success(`${label} triggered`)
    } catch (error: any) {
      logger.error(`${label} failed`, { error })
      Message.error(`${label} failed: ${error?.message || 'unknown error'}`)
    }
  }

  const clearContexts = () => runAction('Clear contexts', () => axiosInstance.post('/api/admin/clear_contexts'))
  const clearActivities = () => runAction('Clear activities', () => axiosInstance.post('/api/admin/clear_activities'))
  const clearAll = () => runAction('Clear all data', () => axiosInstance.post('/api/admin/clear_all'))

  const generateActivityNow = () => runAction('Generate activity', () => axiosInstance.post('/api/admin/generate_activity_now'))
  const summarizeNow = () => runAction('Generate summary', () => axiosInstance.post('/api/admin/generate_summary_now'))

  return (
    <div className="p-6 flex flex-col gap-4 overflow-auto h-full">
      <h2 className="text-xl font-bold text-black">Settings & Debug</h2>
      <Card title="Data Management" bordered>
        <Space wrap>
          <Button status="danger" onClick={clearContexts}>
            Clear all contexts
          </Button>
          <Button status="danger" onClick={clearActivities}>
            Clear all activities
          </Button>
          <Button status="danger" type="outline" onClick={clearAll}>
            Clear everything
          </Button>
        </Space>
      </Card>
      <Card title="Debug Actions" bordered>
        <Space wrap>
          <Button type="primary" onClick={generateActivityNow}>
            Generate activity now
          </Button>
          <Button type="primary" onClick={summarizeNow}>
            Generate summary now
          </Button>
        </Space>
      </Card>
    </div>
  )
}

export default AppSettings
