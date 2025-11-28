// Copyright (c) 2025 Beijing Volcano Engine Technology Co., Ltd.
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react'
import { Message } from '@arco-design/web-react'
import { useSelector } from 'react-redux'
import { useMemoizedFn, useMount } from 'ahooks'
import dayjs from 'dayjs'

import { RootState, useAppDispatch } from '@renderer/store'
import {
  addScreenshotToGroup,
  setIsMonitoring as setIsMonitoringAction,
  setCurrentSession as setCurrentSessionAction,
  removeScreenshot as removeScreenshotAction,
  MonitorSession,
  ScreenshotRecord
} from '@renderer/store/screen'
import { CaptureSource } from '@interface/common/source'
import axiosInstance from '@renderer/services/axiosConfig'
import { timeToISOTimeString } from '@renderer/utils/time'
import { getLogger } from '@shared/logger/renderer'
import { captureScreenshotThunk } from '@renderer/store/thunk/screen-thunk'

const logger = getLogger('useScreen')

// As long as the application is not closed, this variable resides in memory and will not be garbage collected
export const intervalRef: { current: NodeJS.Timeout | null } = { current: null }

export const useScreen = () => {
  const dispatch = useAppDispatch()
  const isMonitoring = useSelector((state: RootState) => state.screen.isMonitoring)
  const currentSession = useSelector((state: RootState) => state.screen.currentSession) as MonitorSession | null
  const [hasPermission, setHasPermission] = useState(false)
  // const [initialized, setInitialized] = useState(false)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)

  const checkPermissions = useMemoizedFn(async () => {
    const permission = await window.screenMonitorAPI.checkPermissions()
    if (!permission) {
      Message.error('Screen recording permission is required.')
      setHasPermission(false)
    } else {
      setHasPermission(true)
    }
  })

  const grantPermission = useMemoizedFn(() => {
    window.screenMonitorAPI.openPrefs()
    setTimeout(checkPermissions, 5000)
  })

  const setIsMonitoring = useMemoizedFn((isMonitoring: boolean) => {
    dispatch(setIsMonitoringAction(isMonitoring))
  })

  const setCurrentSession = useMemoizedFn((newCurrentSession: MonitorSession | null) => {
    dispatch(setCurrentSessionAction(newCurrentSession))
  })

  const removeScreenshot = useMemoizedFn((screenshotId: string) => {
    dispatch(removeScreenshotAction({ screenshotId }))
  })
  const [isProgressing, setIsProgressing] = useState(false)

  // Automatic screenshot (using thunk)
  const captureScreenshot = useMemoizedFn(async (visibleSources: CaptureSource[], maxConcurrency = 1) => {
    if (isProgressing) {
      return []
    }
    setIsProgressing(true)
    try {
      // Refresh the latest captureable sources to avoid stale IDs
      let screenTargets = visibleSources.filter((s) => s.type === 'screen')
      try {
        const fresh = await window.screenMonitorAPI.getCaptureAllSources()
        const freshList = [...(fresh?.screenSources || []), ...(fresh?.appSources || [])]
          .filter((s: any) => s?.isVisible && s?.type === 'screen')
        if (freshList.length) {
          const freshIds = new Set(freshList.map((s: any) => s.id))
          const filtered = screenTargets.filter((src) => src?.id && freshIds.has(src.id))
          screenTargets = filtered.length ? filtered : (freshList as CaptureSource[])
        }
      } catch (err) {
        logger.debug('Failed to refresh capture sources before capture; using provided list', { err })
      }

      // Always include only the primary display plus the active window
      const captureTargets: CaptureSource[] = []
      if (screenTargets.length > 0) {
        captureTargets.push(screenTargets[0])
      }

      try {
        const active = await window.screenMonitorAPI.getActiveWindowSource()
        if (active?.success && active.source?.id) {
          const alreadyAdded = captureTargets.some((t) => t.id === active.source.id)
          if (!alreadyAdded) {
            captureTargets.push(active.source as CaptureSource)
          }
        } else {
          logger.debug('Active window source not found; capturing display only', { active })
        }
      } catch (activeErr) {
        logger.debug('Failed to resolve active window; capturing display only', { activeErr })
      }

      // Step 1: Capture only available sources in batches
      const batches: CaptureSource[][] = []
      for (let i = 0; i < captureTargets.length; i += maxConcurrency) {
        batches.push(captureTargets.slice(i, i + maxConcurrency))
      }

      const capturePromises = batches.map(async (batch) => {
        const results = await Promise.all(
          batch.map(async (source) => {
            try {
              const screenshot = await dispatch(captureScreenshotThunk(source.id))
              if (screenshot) {
                await postScreenshotToServer(screenshot)
                // Push to local session so it shows up immediately
                dispatch(
                  addScreenshotToGroup({
                    screenshot,
                    groupKey: screenshot.group_id || String(screenshot.timestamp)
                  })
                )
              }
              return { source, success: true }
            } catch (error) {
              logger.error(`Failed to capture ${source.name}`, { error })
              return { source, success: false }
            }
          })
        )
        return results
      })

      const captureResults = await Promise.all(capturePromises)
      setIsProgressing(false)
      // Only log if there are failures
      const flattened = captureResults.flat()
      const failures = flattened.filter((r) => !r.success)
      if (failures.length > 0) {
        logger.debug(
          'Capture results with failures:',
          flattened.map((r) => ({ name: r.source?.name, success: r.success }))
        )
      }
      return flattened
    } catch (error) {
      setIsProgressing(false)
      Message.error('Capture failed, please retry')
      logger.error('Failed to capture visible sources', { error })
      return []
    }
  })

  // Get new activities
  const getNewActivities = useMemoizedFn(async (lastEndTime: string) => {
    const res = await window.dbAPI.getNewActivities(lastEndTime)
    if (res) {
      return res
    } else {
      console.log('No new activities')
      return []
    }
  })

  // Get activities for a specific date
  const getActivitiesByDate = useMemoizedFn(async (date: Date) => {
    const startOfDay = dayjs(date).startOf('day').toDate()
    const endOfDay = dayjs(date).endOf('day').toDate()

    const res = await window.dbAPI.getNewActivities(timeToISOTimeString(startOfDay), timeToISOTimeString(endOfDay))
    if (res.length > 0) {
      console.log('Retrieved activities for the day')
      return res
    } else {
      console.log('No activities for the day')
      return []
    }
  })

  // Load and display image
  const loadAndShowImage = useMemoizedFn(async (screenshot: ScreenshotRecord) => {
    if (screenshot.base64_url) {
      setSelectedImage(screenshot.base64_url)
    } else if (screenshot.image_url) {
      try {
        const result = await window.screenMonitorAPI.readImageAsBase64(screenshot.image_url)
        if (result.success && result.data) {
          const base64Url = `data:image/png;base64,${result.data}`
          setSelectedImage(base64Url)
        } else {
          Message.error('Failed to load image')
        }
      } catch (error) {
        console.error('Failed to load image:', error)
        Message.error('Failed to load image')
      }
    }
  })

  // Screenshot download handler
  const downloadScreenshot = useMemoizedFn(async (screenshot: ScreenshotRecord) => {
    console.log('downloadScreenshot', screenshot)
    try {
      let base64Url = screenshot.base64_url

      // If no base64 data, load from file
      if (!base64Url && screenshot.image_url) {
        const result = await window.screenMonitorAPI.readImageAsBase64(screenshot.image_url)
        if (result.success && result.data) {
          base64Url = `data:image/png;base64,${result.data}`
        } else {
          console.error('Failed to read image data')
          return
        }
      }

      if (base64Url) {
        const link = document.createElement('a')
        link.href = base64Url
        link.download = `screenshot-${screenshot.timestamp}.png`
        link.click()
        Message.success('Download has started')
      } else {
        Message.error('Unable to get image data')
      }
    } catch (error) {
      console.error('Failed to download screenshot:', error)
    }
  })

  const postScreenshotToServer = useMemoizedFn(async (screenshot: ScreenshotRecord) => {
    try {
      const data = {
        path: screenshot.image_url,
        window: screenshot.description || 'Screen',
        create_time: dayjs(screenshot.timestamp).toISOString(),
        app: screenshot.description || 'Screen'
      }
      const res = await axiosInstance.post('/api/add_screenshot', data)
      if (res.status !== 200) {
        throw new Error(`Upload failed with status ${res.status}`)
      }
    } catch (error) {
      console.error('Failed to upload screenshot:', error)
      throw error
    }
  })

  useMount(() => {
    checkPermissions()
  })

  return {
    isMonitoring,
    setIsMonitoring,
    currentSession,
    setCurrentSession,
    removeScreenshot,
    captureScreenshot,
    isProgressing,
    hasPermission,
    grantPermission,
    selectedImage,
    setSelectedImage,
    loadAndShowImage,
    downloadScreenshot,
    getNewActivities,
    getActivitiesByDate
  }
}
