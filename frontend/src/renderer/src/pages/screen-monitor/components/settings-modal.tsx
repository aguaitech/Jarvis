import React from 'react'
import { Button, Modal, Slider, TimePicker, Radio, Form, Switch } from '@arco-design/web-react'
interface SettingsModalProps {
  visible: boolean
  form: any
  tempRecordInterval: number
  tempEnableRecordingHours: boolean
  tempRecordingHours: [string, string]
  tempApplyToDays: string
  tempMaxConcurrentCaptures: number
  onCancel: () => void
  onSave: () => void
  onSetTempRecordInterval: (value: number) => void
  onSetTempEnableRecordingHours: (value: boolean) => void
  onSetTempRecordingHours: (value: [string, string]) => void
  onSetTempApplyToDays: (value: string) => void
  onSetTempMaxConcurrentCaptures: (value: number) => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  form,
  tempRecordInterval,
  tempEnableRecordingHours,
  tempRecordingHours,
  tempApplyToDays,
  tempMaxConcurrentCaptures,
  onCancel,
  onSave,
  onSetTempRecordInterval,
  onSetTempEnableRecordingHours,
  onSetTempRecordingHours,
  onSetTempApplyToDays,
  onSetTempMaxConcurrentCaptures
}) => {
  return (
    <Modal
      title="Settings"
      visible={visible}
      autoFocus={false}
      focusLock
      onCancel={onCancel}
      className="text-[#AEAFC2]"
      unmountOnExit
      footer={
        <>
          <Button onClick={onCancel} className="[&_.arco-btn]: !text-xs">
            Cancel
          </Button>
          <Button type="primary" onClick={onSave} className="[&_.arco-btn-primary]: !bg-black">
            Save
          </Button>
        </>
      }
      style={{ width: 682 }}>
      <Form layout="vertical" form={form}>
        <div className="flex w-full flex-1 mt-5">
          <div className="flex flex-col flex-1 pr-[24px]">
            <Form.Item label="Record Interval" className="[&_.arco-form-item-label]:!text-xs">
              <Slider
                value={tempRecordInterval}
                onChange={(value) => onSetTempRecordInterval(value as number)}
                min={5}
                max={300}
                marks={{
                  5: '5s',
                  300: '5min'
                }}
                className="!mt-4"
                formatTooltip={(value) => `${value}s`}
              />
            </Form.Item>
            <Form.Item label="Max concurrent captures" className="[&_.arco-form-item-label]:!text-xs">
              <Slider
                value={tempMaxConcurrentCaptures}
                onChange={(value) => onSetTempMaxConcurrentCaptures(value as number)}
                min={1}
                max={4}
                marks={{ 1: '1', 4: '4' }}
                className="!mt-2"
                formatTooltip={(value) => `${value}`}
              />
              <div className="text-[12px] text-[#6E718C] mt-1">
                Control how many screenshots process in parallel. Higher values speed up multi-monitor capture.
              </div>
            </Form.Item>
            <Form.Item label="Capture scope" className="[&_.arco-form-item-label]:!text-xs">
              <div className="text-[13px] text-[#42464e] leading-[20px]">
                Jarvis now always captures both the full display and the active window (with its title) each interval to
                give summaries more context.
              </div>
            </Form.Item>
            <Form.Item label="Enable recording hours" className="[&_.arco-form-item-label]:!text-xs !mb-0">
              <Switch
                checked={tempEnableRecordingHours}
                onChange={onSetTempEnableRecordingHours}
                className={
                  !tempEnableRecordingHours ? '[&_.arco-switch]: !bg-[#e2e3ef]' : '[&_.arco-switch]: !bg-black'
                }
              />
            </Form.Item>
            {tempEnableRecordingHours && (
              <div className="!mt-3">
                <Form.Item label="Set recording hours" className="[&_.arco-form-item-label]:!text-xs">
                  <TimePicker.RangePicker
                    format="HH:mm"
                    value={tempRecordingHours}
                    onChange={(value) => onSetTempRecordingHours(value as [string, string])}
                  />
                </Form.Item>
                <Form.Item label="Apply to days" className="[&_.arco-form-item-label]: !text-xs">
                  <Radio.Group value={tempApplyToDays} onChange={onSetTempApplyToDays}>
                    <Radio value="weekday" className="[&_.arco-radio-mask]: !border-[#d7daea]">
                      Only weekday
                    </Radio>
                    <Radio value="everyday" className="[&_.arco-radio-mask]: !border-[#d7daea]">
                      Everyday
                    </Radio>
                  </Radio.Group>
                </Form.Item>
              </div>
            )}
          </div>
        </div>
      </Form>
    </Modal>
  )
}

export default SettingsModal
