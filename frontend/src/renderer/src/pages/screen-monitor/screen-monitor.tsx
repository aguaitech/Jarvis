import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Modal, Image, Form, Message, Tag } from '@arco-design/web-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSetting } from '@renderer/hooks/use-setting'
import { useScreen } from '@renderer/hooks/use-screen'
import dayjs from 'dayjs'

import { useMemoizedFn, useMount } from 'ahooks'
import { appStore, loadableCaptureSourcesAtom } from '@renderer/atom/capture.atom'
import { useAtomValue } from 'jotai'
import { useObservableTask } from '@renderer/atom/event-loop.atom'
import { Progress, Alert } from '@arco-design/web-react'
// Extracted components
import ScreenMonitorHeader from './components/screen-monitor-header'
import DateNavigation from './components/date-navigation'
import RecordingTimeline from './components/recording-timeline'
import EmptyStatePlaceholder from './components/empty-state-placeholder'
import SettingsModal from './components/settings-modal'
import { getLogger } from '@shared/logger/renderer'
import { IpcChannel } from '@shared/IpcChannel'
import type { RecordingStats } from './components/recording-stats-card'
import { CaptureSource } from '@interface/common/source'
import { pathToFileURL } from '@renderer/utils/file'
import classNames from 'classnames'
import { Button } from '@arco-design/web-react'
import axiosInstance from '@renderer/services/axiosConfig'

const logger = getLogger('ScreenMonitor')

export interface Activity {
  id: string
  start_time: string
  end_time: string // Add optional end_time field
  resources: Array<{
    type: string
    id: string
    path: string
  }>
  title: string
  content: string
}

const ScreenMonitor: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    recordInterval,
    recordingHours,
    enableRecordingHours,
    applyToDays,
    maxConcurrentCaptures,
    setRecordInterval,
    setEnableRecordingHours,
    setRecordingHours,
    setApplyToDays,
    setMaxConcurrentCaptures
  } = useSetting()
  const {
    currentSession,
    hasPermission = false,
    grantPermission,
    selectedImage,
    setSelectedImage,
    getNewActivities,
    getActivitiesByDate,
    captureScreenshot,
    isProgressing
  } = useScreen()
  const [isMonitoring, setIsMonitoring] = useState(false)
  useMount(() => {
    window.serverPushAPI.pushScreenMonitorStatus((status) => {
      setIsMonitoring(status === 'running')
    })
  })
  // Get selectable sources
  const sources = useAtomValue(loadableCaptureSourcesAtom, { store: appStore })
  // Used to update whether the optional application list has been read to render the page
  // const [sourcesRead, setSourcesRead] = useState(false)
  const screenAllSources = useMemo(() => {
    return (sources.state === 'hasData' ? sources.data.screenSources : []).filter((v) => v.isVisible)
  }, [sources])
  const appAllSources = useMemo(() => {
    return (sources.state === 'hasData' ? sources.data.appSources : []).filter((v) => v.isVisible)
  }, [sources])

  const [currentDate, setCurrentDate] = useState(dayjs().toDate())
  const isToday = dayjs(currentDate).isSame(dayjs(), 'day')
  const [activities, setActivities] = useState<Activity[]>([])
  const [recordingStats, setRecordingStats] = useState<RecordingStats | null>(null)
  const screenshots = currentSession?.screenshots || {}
  const allScreenshots = useMemo(() => Object.values(screenshots).flat(), [screenshots])
  const assignedScreenshotPaths = useMemo(() => {
    const set = new Set<string>()
    activities.forEach((activity) => {
      (activity.resources || [])
        .filter((r) => r.type === 'image' && r.path)
        .forEach((r) => set.add(r.path))
    })
    return set
  }, [activities])
  const unassignedScreenshots = useMemo(
    () => allScreenshots.filter((shot) => !assignedScreenshotPaths.has(shot.image_url)),
    [allScreenshots, assignedScreenshotPaths]
  )
  const [settingsVisible, setSettingsVisible] = useState(false)
  const activityPollingRef = useRef<NodeJS.Timeout | null>(null)
  const statsPollingRef = useRef<NodeJS.Timeout | null>(null)
  const lastCheckedTimeRef = useRef<string>(
    activities.length > 0
      ? activities[activities.length - 1].end_time || activities[activities.length - 1].start_time
      : dayjs().toISOString()
  )
  const isScreenLockedRef = useRef(false)

  // Settings form state
  const [tempRecordInterval, setTempRecordInterval] = useState(recordInterval)
  const [tempEnableRecordingHours, setTempEnableRecordingHours] = useState(enableRecordingHours)
  const [tempRecordingHours, setTempRecordingHours] = useState<[string, string]>(recordingHours as [string, string])
  const [tempApplyToDays, setTempApplyToDays] = useState(applyToDays)
  const [tempMaxConcurrentCaptures, setTempMaxConcurrentCaptures] = useState(maxConcurrentCaptures)
  const [captureFailures, setCaptureFailures] = useState<CaptureSource[]>([])

  useEffect(() => {
    const initActivities = async () => {
      const date = dayjs(currentDate).startOf('day').toDate()
      const todayActivities = await getActivitiesByDate(date)
      const todayActivitiesParsed: Activity[] = todayActivities.map((item: any) => ({
        ...item,
        resources: JSON.parse(item.resources)
      }))
      const uniqueActivities = Array.from(new Map(todayActivitiesParsed.map((item) => [item.id, item])).values())
      setActivities(uniqueActivities)

      // Reset lastCheckedTimeRef to the time of the last activity of the day
      if (uniqueActivities.length > 0) {
        const latestActivity = uniqueActivities[uniqueActivities.length - 1]
        lastCheckedTimeRef.current = latestActivity.end_time || latestActivity.start_time
      } else {
        // If there are no activities, reset to the start of the day
        lastCheckedTimeRef.current = dayjs(currentDate).startOf('day').toISOString()
      }
    }
    initActivities()
  }, [currentDate, getActivitiesByDate])

  // Manage polling when date or monitoring status changes
  useEffect(() => {
    if (isToday) {
      // Always keep activity polling for today so the list refreshes even after stopping recording
      startActivityPolling()
      if (isMonitoring) {
        startStatsPolling()
      } else {
        stopStatsPolling()
      }
    } else {
      // Historical date: no live polling
      stopActivityPolling()
      stopStatsPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, isMonitoring, isToday])

  const handlePreviousDay = () => {
    const newDate = dayjs(currentDate).subtract(1, 'day').toDate()
    setCurrentDate(newDate)
  }

  const handleNextDay = () => {
    const newDate = dayjs(currentDate).add(1, 'day').toDate()
    setCurrentDate(newDate)
  }

  const handleDateChange = (_dateString, date) => {
    setCurrentDate(date.toDate())
  }

  const disabledDate = (current) => {
    return current && dayjs(current).isAfter(dayjs(), 'day')
  }

  // Start monitoring session
  const startMonitoring = useMemoizedFn(async () => {
    const defaultSources: CaptureSource[] = []
    if (screenAllSources.length) {
      defaultSources.push(screenAllSources[0])
    }
    try {
      const active = await window.screenMonitorAPI.getActiveWindowSource()
      if (active?.success && active.source) {
        defaultSources.push(active.source as CaptureSource)
      }
    } catch (err) {
      logger.debug('Failed to fetch active window source for auto capture', { err })
    }
    if (defaultSources.length) {
      await window.screenMonitorAPI.updateCurrentRecordApp(defaultSources as CaptureSource[])
    }
    await window.screenMonitorAPI.updateModelConfig({
      recordInterval,
      recordingHours,
      enableRecordingHours,
      applyToDays
    })
    await window.screenMonitorAPI.startTask()
    // Start polling for new activities
    startActivityPolling()
    // Start polling for recording stats
    startStatsPolling()
  })

  // Stop monitoring
  const stopMonitoring = useMemoizedFn(async () => {
    if (isMonitoring) {
      await window.screenMonitorAPI.stopTask()
      // Keep activity polling running so the list shows the final screenshots/activities
      stopStatsPolling()
    }
  })

  const pauseMonitoring = useMemoizedFn(() => {
    logger.info('Screen locked, pausing monitoring timers')
    stopActivityPolling()
    stopStatsPolling()
  })

  // Resume monitoring (when screen is unlocked)
  const resumeMonitoring = useMemoizedFn(() => {
    if (isMonitoring && !isScreenLockedRef.current) {
      // Resume activity polling
      startActivityPolling()
      // Resume stats polling
      startStatsPolling()
    }
  })

  // Start polling for new activities
  const startActivityPolling = useMemoizedFn(() => {
    if (activityPollingRef.current) {
      clearInterval(activityPollingRef.current)
    }
    // Immediately execute a check for new activities
    const checkNewActivities = async () => {
      try {
        // Only poll for new activities when viewing today
        if (!isToday) {
          return
        }

        const newActivities = await getNewActivities(lastCheckedTimeRef.current)
        const newActivitiesParsed: Activity[] = newActivities.map((item: any) => ({
          ...item,
          resources: JSON.parse(item.resources)
        }))
        if (newActivitiesParsed && newActivitiesParsed.length > 0) {
          // Filter activities for the current date
          const currentDateStr = dayjs(currentDate).format('YYYY-MM-DD')
          const filteredActivities = newActivitiesParsed.filter((activity) => {
            const activityDateStr = dayjs(activity.start_time).format('YYYY-MM-DD')
            return activityDateStr === currentDateStr
          })

          if (filteredActivities.length > 0) {
            // Update last checked time to the latest activity's start time
            const latestActivity = filteredActivities[filteredActivities.length - 1]
            lastCheckedTimeRef.current = latestActivity.start_time
            // Add new activities to the beginning of the activities array (maintaining time order) and deduplicate
            setActivities((prev) => {
              const existingIds = new Set(prev.map((a) => a.id))
              const uniqueNewActivities = filteredActivities.filter((a) => !existingIds.has(a.id))
              return [...uniqueNewActivities, ...prev]
            })
          }
        }
      } catch (error) {
        logger.error('Failed to check new activity', { error })
      }
    }
    // Execute immediately
    checkNewActivities()
    // Set timer
    activityPollingRef.current = setInterval(checkNewActivities, 5000) // Poll every 5 seconds
  })

  // Stop polling for new activities
  const stopActivityPolling = useMemoizedFn(() => {
    if (activityPollingRef.current) {
      clearInterval(activityPollingRef.current)
      activityPollingRef.current = null
    }
  })

  // Start polling for recording stats
  const startStatsPolling = useMemoizedFn(() => {
    if (statsPollingRef.current) {
      clearInterval(statsPollingRef.current)
    }

    const fetchStats = async () => {
      try {
        if (!isToday || !isMonitoring) {
          return
        }
        const stats = await window.screenMonitorAPI.getRecordingStats()
        if (stats) {
          setRecordingStats(stats)
        }
      } catch (error) {
        logger.error('Failed to fetch recording stats', { error })
      }
    }

    // Execute immediately
    fetchStats()
    // Poll every 5 seconds
    statsPollingRef.current = setInterval(fetchStats, 5000)
  })

  // Stop polling for recording stats
  const stopStatsPolling = useMemoizedFn(() => {
    if (statsPollingRef.current) {
      clearInterval(statsPollingRef.current)
      statsPollingRef.current = null
    }
    setRecordingStats(null)
  })

  // Clean up polling on component unmount
  useEffect(() => {
    return () => {
      stopActivityPolling()
      stopStatsPolling()
    }
  }, [stopActivityPolling, stopStatsPolling])

  // Listen for lock/unlock screen events
  useObservableTask(
    {
      active: () => {
        isScreenLockedRef.current = true
        if (isMonitoring) {
          pauseMonitoring()
        }
      },
      inactive: () => {
        isScreenLockedRef.current = false
        if (isMonitoring) {
          resumeMonitoring()
        }
      }
    },
    'screen-monitor'
  )

  // Listen for tray toggle recording event (from Router.tsx when already on this page)
  useEffect(() => {
    const handleTrayToggleRecording = () => {
      if (isMonitoring) {
        stopMonitoring()
      } else {
        startMonitoring()
      }
    }

    window.addEventListener('tray-toggle-recording', handleTrayToggleRecording)

    return () => {
      window.removeEventListener('tray-toggle-recording', handleTrayToggleRecording)
    }
  }, [isMonitoring, startMonitoring, stopMonitoring])

  // Handle navigation state when coming from tray icon while on a different page
  useEffect(() => {
    const state = location.state as { toggleRecording?: boolean } | null
    if (state?.toggleRecording) {
      // Clear the navigation state first to prevent re-triggering
      navigate(location.pathname, { replace: true, state: {} })

      // Toggle recording based on current state
      if (isMonitoring) {
        stopMonitoring()
      } else {
        startMonitoring()
      }
    }
    // Only depend on location.state to avoid re-triggering when isMonitoring changes
    // startMonitoring and stopMonitoring are memoized so they're stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const openSettings = useMemoizedFn(async () => {
    // Refresh the application list before opening settings
    try {
      setSettingsVisible(true)
    } catch (error) {
      logger.error('Failed to refresh application list', { error })
    }
  })

  const handleCancelSettings = useMemoizedFn(() => {
    setTempRecordInterval(recordInterval)
    setTempEnableRecordingHours(enableRecordingHours)
    setTempRecordingHours(recordingHours as [string, string])
    setTempApplyToDays(applyToDays)
    setTempMaxConcurrentCaptures(maxConcurrentCaptures)
    setSettingsVisible(false)
  })

  const handleSaveSettings = useMemoizedFn(() => {
    setRecordInterval(tempRecordInterval)
    setEnableRecordingHours(tempEnableRecordingHours)
    setRecordingHours(tempRecordingHours as [string, string])
    setApplyToDays(tempApplyToDays as 'weekday' | 'everyday')
    setMaxConcurrentCaptures(tempMaxConcurrentCaptures)
    setSettingsVisible(false)
  })

  // Check if recording is possible under the current settings
  const [canRecord, setCanRecord] = useState(false)
  const checkCanRecord = useMemoizedFn(async () => {
    const result = await window.screenMonitorAPI.checkCanRecord()
    setCanRecord(result.canRecord)
    setIsMonitoring(result.status === 'running')
    return result
  })

  // Check recording status on component mount
  useEffect(() => {
    checkCanRecord()
  }, [setCanRecord])

  // Periodically check recording status
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    if (isMonitoring && enableRecordingHours) {
      interval = setInterval(() => {
        checkCanRecord()
      }, 60000) // Check every minute
    }
    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [isMonitoring, enableRecordingHours, checkCanRecord])

  // Sync recording status to tray
  useEffect(() => {
    if (isToday) {
      window.electron.ipcRenderer
        .invoke(IpcChannel.Tray_UpdateRecordingStatus, isMonitoring && canRecord)
        .catch((error) => {
          logger.error('Failed to update tray recording status:', error)
        })
    }
  }, [isMonitoring, canRecord, isToday])

  // Get sources
  const [form] = Form.useForm<{ screenSources?: string[]; windowSources?: string[] }>()
  const entry = useMemoizedFn(async () => {
    form.setFieldsValue({})
  })

  // Tips: The biggest problem with using Form for management is that when the user does not select any screen or window, it will cause the save to fail
  const handleSave = useMemoizedFn(async () => {
    handleSaveSettings()
  })

  useEffect(() => {
    entry()
    setTempRecordInterval(recordInterval)
    setTempEnableRecordingHours(enableRecordingHours)
    setTempRecordingHours(recordingHours as [string, string])
    setTempApplyToDays(applyToDays)
    setTempMaxConcurrentCaptures(maxConcurrentCaptures)
  }, [sources])

  const handleRequestPermission = useMemoizedFn(async () => {
    await grantPermission()
  })

  const mergedSources = useMemo(() => {
    // Only use the primary available screen for manual capture
    return screenAllSources?.length ? [screenAllSources[0]] : []
  }, [screenAllSources])

  const handleCaptureNow = useMemoizedFn(async () => {
    try {
      // Prefer fresh sources from main to avoid stale IDs
      let sourcesToUse: CaptureSource[] = mergedSources
      try {
        const fresh = await window.screenMonitorAPI.getCaptureAllSources()
        if (fresh?.screenSources) {
          const freshScreens = (fresh.screenSources || []).filter((src: any) => src?.isVisible)
          if (freshScreens.length) {
            sourcesToUse = [freshScreens[0]] as CaptureSource[]
          }
        }
      } catch (err) {
        logger.debug('Failed to refresh capture sources, using cached list', { err })
      }

      // Only capture the first available screen
      const firstSource = sourcesToUse.length ? [sourcesToUse[0]] : []
      if (!firstSource.length) {
        Message.error('No screen source available to capture')
        setLastCaptureFailed(true)
        return
      }

      const results = await captureScreenshot(firstSource, maxConcurrentCaptures)
      const failures = (results || []).filter((r) => !r.success).map((r) => r.source)
      setCaptureFailures(failures as CaptureSource[])

      Message.success('Captured now and sent for processing')
      if (failures.length === 0) {
        setCaptureFailures([])
      }
    } catch (error) {
      logger.error('Manual capture failed', { error })
      setCaptureFailures(mergedSources)
      Message.error('Manual capture failed, please retry')
    }
  })

  const handleRetryCapture = useMemoizedFn(async (sources?: CaptureSource[]) => {
    const retryTargets = sources && sources.length > 0 ? sources : captureFailures
    if (!retryTargets.length) return
    const results = await captureScreenshot(retryTargets, maxConcurrentCaptures)
    const failures = (results || []).filter((r) => !r.success).map((r) => r.source)
    setCaptureFailures(failures as CaptureSource[])
    if (failures.length === 0) {
      Message.success('Retry successful')
    } else {
      Message.warning(`${failures.length} capture(s) still failing`)
    }
  })

  const handleRetryProcessing = useMemoizedFn(async () => {
    try {
      if (!unassignedScreenshots.length) {
        Message.info('No failed screenshots to retry')
        return
      }
      const payload = unassignedScreenshots.map((shot) => ({
        path: shot.image_url,
        window: shot.description || shot.source_id || 'Screen',
        create_time: dayjs(shot.timestamp).toISOString(),
        source: shot.capture_type || 'unknown'
      }))
      await axiosInstance.post('/api/add_screenshots', { screenshots: payload })
      Message.success('Re-submitted failed screenshots for processing')
    } catch (error: any) {
      logger.error('Failed to trigger retry processing', { error })
      Message.error('Retry processing failed')
    }
  })

  return (
    <div className="top-0 left-0 flex flex-col h-screen overflow-y-hidden pr-2 pb-2 pl-0 rounded-[20px] relative">
      <div style={{ height: '8px', appRegion: 'drag' } as React.CSSProperties} />
      <div className="bg-white rounded-[16px] p-6 h-[calc(100%-8px)] flex flex-col overflow-y-auto overflow-x-hidden scrollbar-hide pb-2">
        <ScreenMonitorHeader
          hasPermission={hasPermission}
          isMonitoring={isMonitoring}
          isToday={isToday}
          screenAllSources={screenAllSources}
          appAllSources={appAllSources}
          onOpenSettings={openSettings}
          onStartMonitoring={startMonitoring}
          onStopMonitoring={stopMonitoring}
          onRequestPermission={handleRequestPermission}
          onCaptureNow={handleCaptureNow}
          failedCount={captureFailures.length}
          onRetryFailure={handleRetryCapture}
        />

        {/* Recording area */}
        <div className="w-full mb-0 mx-auto flex-1 flex flex-col">
          <div className="border-2 border-dashed border-gray-300 rounded-[12px] p-[30px] bg-gray-50 transition-all duration-300 flex-1 flex flex-col overflow-auto">
            {isProgressing && (
              <Alert
                type="info"
                showIcon
                content={
                  <div className="flex items-center gap-3">
                    <span>Processing screenshots with LLM…</span>
                    <Progress percent={100} status="active" showText={false} />
                  </div>
                }
                className="mb-4"
              />
            )}
            <DateNavigation
              hasPermission={hasPermission}
              currentDate={currentDate}
              isToday={isToday}
              onPreviousDay={handlePreviousDay}
              onNextDay={handleNextDay}
              onDateChange={handleDateChange}
              onSetCurrentDate={setCurrentDate}
              disabledDate={disabledDate}
            />
            {(isMonitoring && isToday) || activities.length > 0 || Object.keys(screenshots).length > 0 ? (
              <RecordingTimeline
                isMonitoring={isMonitoring}
                isToday={isToday}
                canRecord={canRecord}
                activities={activities}
                recordingStats={recordingStats}
                failedSources={captureFailures}
                onRetryFailed={handleRetryProcessing}
              />
            ) : (
              <EmptyStatePlaceholder
                hasPermission={hasPermission}
                isToday={isToday}
                onGrantPermission={grantPermission}
              />
            )}

            {allScreenshots.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-semibold text-sm text-black">Captured screenshots</span>
                  {!isMonitoring && <Tag color="orange">Recording stopped</Tag>}
                  {unassignedScreenshots.length > 0 && (
                    <Tag color="arcoblue">{unassignedScreenshots.length} unassigned</Tag>
                  )}
                  {captureFailures.length > 0 && (
                    <Button type="secondary" size="mini" status="warning" onClick={() => handleRetryCapture()}>
                      Retry failed ({captureFailures.length})
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-4">
                  <Image.PreviewGroup infinite>
                    {Object.entries(screenshots).map(([groupKey, groupShots]) => {
                      const full = groupShots.find((s) => s.capture_type === 'full_display') || groupShots[0]
                      const active = groupShots.find((s) => s.capture_type === 'active_window')
                      return (
                        <div key={groupKey} className="relative w-full max-w-3xl">
                          {full && (
                            <Image
                              src={full.base64_url || pathToFileURL(full.image_url)}
                              alt={full.description || 'Display'}
                              width="100%"
                              height={220}
                              className="rounded-[12px] object-cover"
                            />
                          )}
                          {active && (
                            <div className="absolute bottom-3 right-3 shadow-lg border border-white rounded-[10px] overflow-hidden bg-white">
                              <Image
                                src={active.base64_url || pathToFileURL(active.image_url)}
                                alt={active.description || 'Active window'}
                                width={200}
                                height={120}
                                className={classNames('object-cover', 'rounded-[10px]')}
                              />
                              <div className="px-2 py-1 text-[10px] text-gray-700 bg-white border-t border-gray-100">
                                Active window
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </Image.PreviewGroup>
                </div>
              </div>
            )}
          </div>
        </div>

        <Modal
          style={{ width: '60%', minHeight: '30%' }}
          title="Display Screenshot"
          visible={!!selectedImage}
          onCancel={() => setSelectedImage(null)}
          footer={null}>
          {selectedImage && (
            <Image src={selectedImage} alt="Display Screenshot" style={{ width: '100%', borderRadius: 8 }} />
          )}
        </Modal>

        <SettingsModal
          visible={settingsVisible}
          form={form}
          tempRecordInterval={tempRecordInterval}
          tempEnableRecordingHours={tempEnableRecordingHours}
          tempRecordingHours={tempRecordingHours}
          tempApplyToDays={tempApplyToDays}
          tempMaxConcurrentCaptures={tempMaxConcurrentCaptures}
          onCancel={handleCancelSettings}
          onSave={handleSave}
          onSetTempRecordInterval={setTempRecordInterval}
          onSetTempEnableRecordingHours={setTempEnableRecordingHours}
          onSetTempRecordingHours={setTempRecordingHours}
          onSetTempApplyToDays={setTempApplyToDays}
          onSetTempMaxConcurrentCaptures={setTempMaxConcurrentCaptures}
        />
      </div>
    </div>
  )
}

export default ScreenMonitor
