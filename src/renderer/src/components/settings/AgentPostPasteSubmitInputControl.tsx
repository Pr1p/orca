import { translate } from '@/i18n/i18n'
import { SettingsSegmentedControl } from './SettingsFormControls'
import type { AgentPostPasteSubmitInput } from '../../../../shared/tui-agent-post-paste-submit'

export function AgentPostPasteSubmitInputControl({
  value,
  onSave
}: {
  value: AgentPostPasteSubmitInput
  onSave: (value: AgentPostPasteSubmitInput) => void | Promise<void>
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {translate('settings.agents.postPasteSubmit', 'After pasting an action recipe')}
      </span>
      <SettingsSegmentedControl<AgentPostPasteSubmitInput>
        value={value}
        onChange={(next) => {
          if (next !== value) {
            void onSave(next)
          }
        }}
        ariaLabel={translate('settings.agents.postPasteSubmit', 'After pasting an action recipe')}
        size="sm"
        options={[
          { value: 'enter', label: translate('settings.agents.submitEnter', 'Press Enter') },
          {
            value: 'ctrl-enter',
            label: translate('settings.agents.submitCtrlEnter', 'Press Ctrl+Enter')
          }
        ]}
      />
    </div>
  )
}
