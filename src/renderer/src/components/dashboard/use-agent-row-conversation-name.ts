import { getAgentRowConversationName } from '../../../../shared/agent-row-conversation-name'
import { defaultAgentChatLabel } from '../../../../shared/agent-session-chat-label'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { Tab } from '../../../../shared/tab-types'
import type { ConversationNameTab } from '../../../../shared/agent-row-conversation-name'
import { resolveAgentRowPaneLiveTitle } from './agent-row-pane-live-title'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import type { DashboardAgentRow } from './useDashboardData'

type WorktreeTabs = NonNullable<AppState['tabsByWorktree'][string]>
type WorktreeUnifiedTabs = NonNullable<AppState['unifiedTabsByWorktree'][string]>

const tabIndexByTabs = new WeakMap<WorktreeTabs, ReadonlyMap<string, WorktreeTabs[number]>>()
const unifiedTabIndexByTabs = new WeakMap<
  WorktreeUnifiedTabs,
  ReadonlyMap<string, WorktreeUnifiedTabs[number]>
>()

/** Reads a terminal tab by id from one immutable worktree tab array. */
function getIndexedTab(
  tabs: WorktreeTabs | undefined,
  tabId: string
): WorktreeTabs[number] | undefined {
  if (!tabs) {
    return undefined
  }
  let tabIndex = tabIndexByTabs.get(tabs)
  if (!tabIndex) {
    tabIndex = new Map(tabs.map((tab) => [tab.id, tab]))
    tabIndexByTabs.set(tabs, tabIndex)
  }
  return tabIndex.get(tabId)
}

/** Reads the native agent-session tab owned by a sidebar agent row. */
function getIndexedAgentSessionTab(
  tabs: WorktreeUnifiedTabs | undefined,
  tabId: string
): Tab | undefined {
  if (!tabs) {
    return undefined
  }
  let tabIndex = unifiedTabIndexByTabs.get(tabs)
  if (!tabIndex) {
    tabIndex = new Map(tabs.map((tab) => [tab.id, tab]))
    unifiedTabIndexByTabs.set(tabs, tabIndex)
  }
  const tab = tabIndex.get(tabId)
  return tab?.contentType === 'agent-session' ? tab : undefined
}

/** Adapts unified-tab naming fields to the existing agent-row title resolver. */
function asConversationNameTab(
  tab: Tab,
  agentType: DashboardAgentRow['agentType']
): ConversationNameTab {
  return {
    customTitle: tab.customLabel,
    quickCommandLabel: tab.quickCommandLabel,
    aiVaultTitle: tab.aiVaultTitle,
    generatedTitle: tab.generatedLabel,
    title: tab.label,
    defaultTitle: defaultAgentChatLabel(agentType)
  }
}

/** The row's conversation name, or null when nothing usable exists. */
export function useAgentRowConversationName(agent: DashboardAgentRow): string | null {
  const parentPaneKey = agent.entry.orchestration?.parentPaneKey
  const usesParentTab =
    agent.lineage?.depth === 1 &&
    parentPaneKey !== undefined &&
    parsePaneKey(parentPaneKey)?.tabId === agent.tab.id
  const cannotOwnTabName = agent.rowSource === 'subagent' || usesParentTab
  const generatedTitlesEnabled = useAppStore(
    (s) => !cannotOwnTabName && s.settings?.tabAutoGenerateTitle === true
  )
  const liveTab = useAppStore((s) =>
    cannotOwnTabName
      ? undefined
      : getIndexedTab(s.tabsByWorktree[agent.tab.worktreeId], agent.tab.id)
  )
  const liveAgentSessionTab = useAppStore((s) =>
    cannotOwnTabName
      ? undefined
      : getIndexedAgentSessionTab(s.unifiedTabsByWorktree[agent.tab.worktreeId], agent.tab.id)
  )
  // Why: parsed per render rather than inside the selector, which runs on every
  // store update and must stay allocation-free.
  const ownLeafId = cannotOwnTabName ? null : parsePaneKey(agent.paneKey)?.leafId
  // Why: in a split tab the tab title belongs to whichever pane has focus, so
  // this row reads its OWN pane's title. Returns a primitive, so a row
  // re-renders only when its own pane's title changes.
  const paneLiveTitle = useAppStore((s) =>
    cannotOwnTabName
      ? undefined
      : resolveAgentRowPaneLiveTitle(
          s.terminalLayoutsByTabId?.[agent.tab.id],
          s.runtimePaneTitlesByTabId?.[agent.tab.id],
          ownLeafId
        )
  )
  // Why: synthetic and same-tab child rows do not own the parent tab's name.
  if (cannotOwnTabName) {
    return null
  }
  // Why: retained row snapshots need a fallback after their live tab disappears.
  return getAgentRowConversationName(
    liveTab ??
      (liveAgentSessionTab
        ? asConversationNameTab(liveAgentSessionTab, agent.agentType)
        : agent.tab),
    agent.agentType,
    generatedTitlesEnabled,
    paneLiveTitle,
    agent.entry.providerSession?.id
  )
}
