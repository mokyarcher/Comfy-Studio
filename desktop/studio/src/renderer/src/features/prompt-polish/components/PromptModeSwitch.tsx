import type { AiPolishSettingsPublic } from '../../../../../shared/prompt-polish/types'

interface Props {
  aiSettings: AiPolishSettingsPublic
  onConfigureAi: () => void
}

/** Compact status for gateway / direct AI polish. */
export function PromptModeSwitch({ aiSettings, onConfigureAi }: Props) {
  if (aiSettings.useGateway !== false) {
    return (
      <button
        type="button"
        className="btn-ghost !px-1.5 !py-0.5 text-[11px] text-muted hover:text-primary"
        onClick={onConfigureAi}
        title={aiSettings.gatewayMessage || '网关润色'}
      >
        {aiSettings.gatewayMessage || '网关'}
      </button>
    )
  }

  if (aiSettings.enabled && aiSettings.hasApiKey && aiSettings.baseUrl) {
    return (
      <span className="text-[11px] text-muted" title={aiSettings.model || ''}>
        直连
      </span>
    )
  }

  return (
    <button
      type="button"
      className="btn-ghost !px-1.5 !py-0.5 text-[11px] text-warning"
      onClick={onConfigureAi}
    >
      未配置
    </button>
  )
}
