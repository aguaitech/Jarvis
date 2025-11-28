import React from 'react'
import { Tooltip, Image, Button } from '@arco-design/web-react'
import { pathToFileURL } from '@renderer/utils/file'
import { CaptureSource } from '@interface/common/source'

export interface RecordingStats {
  processed_screenshots: number
  failed_screenshots: number
  generated_activities: number
  next_activity_eta_seconds: number
  recent_errors: Array<{
    error_message: string
    processor_name: string
    timestamp: string
  }>
  recent_screenshots: string[]
}

interface RecordingStatsCardProps {
  stats: RecordingStats | null
  failedSources?: CaptureSource[]
  onRetryFailed?: (sources?: CaptureSource[]) => void
}

const RecordingStatsCard: React.FC<RecordingStatsCardProps> = ({ stats, failedSources = [], onRetryFailed }) => {
  console.log('[RecordingStatsCard] Rendering with stats:', stats)

  if (!stats) {
    console.log('[RecordingStatsCard] Stats is null, not rendering')
    return null
  }

  console.log('[RecordingStatsCard] Using stats:', stats)

  return (
    <div className="mt-2">
      {/* Recent screenshots display */}
      {stats.recent_screenshots && stats.recent_screenshots.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          <Image.PreviewGroup infinite className="[&_.arco-image-preview-img]:!scale-80">
            {stats.recent_screenshots.map((path, index) => (
              <Image
                key={index}
                src={pathToFileURL(path)}
                width={110}
                height={60}
                alt={`screenshot-${index + 1}`}
                className="cursor-pointer rounded-[8px] overflow-hidden"
              />
            ))}
          </Image.PreviewGroup>
        </div>
      )}

      {/* Stats text */}
      <div className="text-xs text-[#86909C]">
        <span className="text-[#00B42A] font-medium">{stats.processed_screenshots}</span>
        <span> screenshot{stats.processed_screenshots !== 1 ? 's' : ''} processed</span>
        {stats.failed_screenshots > 0 && (
          <>
            <span className="mx-2">•</span>
            <Tooltip
              content={
                <div className="max-w-xs">
                  <div className="font-medium mb-1">Recent Errors:</div>
                  {stats.recent_errors.length > 0 ? (
                    <ul className="text-xs space-y-1">
                      {stats.recent_errors.map((error, index) => (
                        <li key={index} className="break-words">
                          {error.error_message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-xs">No detailed error information available</span>
                  )}
                </div>
              }>
              <span className="text-[#FF4D4F] font-medium cursor-help underline decoration-dashed">
                {stats.failed_screenshots} screenshot{stats.failed_screenshots > 1 ? 's' : ''} failed
              </span>
            </Tooltip>
            {onRetryFailed && (
              <>
                <span className="mx-2">•</span>
                <Button size="mini" type="secondary" status="warning" onClick={() => onRetryFailed()}>
                  Retry all failed
                </Button>
              </>
            )}
          </>
        )}
      </div>

      {failedSources.length > 0 && onRetryFailed && (
        <div className="mt-2 space-x-2 flex flex-wrap items-center">
          {failedSources.map((src, idx) => (
            <Button
              key={`${src.id || idx}`}
              size="mini"
              type="outline"
              status="warning"
              onClick={() => onRetryFailed([src])}>
              Retry {src.name || `Source ${idx + 1}`}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

export default RecordingStatsCard
