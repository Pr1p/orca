import { useAppStore } from '../../../../store/index'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import type { PtyTransport } from '../../pty-transport/pty-transport-types'
import { getConnectionId } from '@/lib/workspace/ownership/connection-context'
import type { TerminalPasteSource, TerminalPasteTextOptions } from './terminal-paste-model'
import {
  resolveTerminalPasteRuntime,
  resolveTerminalPasteRuntimeEnvironmentId
} from './terminal-paste-runtime'
import {
  isTerminalPanePasteFocusCurrent,
  isTerminalPanePasteTargetCurrent
} from './terminal-paste-target-state'
import { pasteTextIntoTerminalPane } from './terminal-pane-paste-dispatch'
import { formatTerminalPasteExecutionError } from './terminal-paste-errors'
import { resolveTerminalKeyboardPane } from '../keyboard/terminal-keyboard-pane-resolution'
import { recordTerminalUserInputForLeaf } from '../terminal-input-activity'
import { scheduleImagePasteWebglAtlasRecovery } from '../../render-health/terminal-webgl-atlas-recovery'
import { pasteTerminalClipboard } from '../../clipboard/terminal-clipboard-paste'
import { createTerminalClipboardCopiedFiles } from '../../clipboard/terminal-clipboard-copied-files'
import type { ReadClipboardTextOptions } from '../../../../../../shared/clipboard-text'
import type { TerminalPaneCloseController } from '../../layout/close/use-terminal-pane-close-actions'
import { resolveProtectedMultilinePasteOptionsForPane } from './terminal-agent-paste-bracketing'
import { resolveTerminalInputHostPlatform } from '../terminal-input-host-platform'

export type TerminalPanePasteExecution = ReturnType<typeof createTerminalPanePasteExecution>

export function formatClipboardImagePasteError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `Image paste failed: ${detail}`
}

export function createTerminalPanePasteExecution(
  controller: TerminalPaneCloseController,
  shortcutPlatform: NodeJS.Platform
) {
  const {
    cwd,
    forceBracketedMultilineTextPaste,
    managerRef,
    paneTransportsRef,
    setTerminalError,
    tabId,
    worktreeId
  } = controller
  const isPanePasteTargetMounted = (
    pane: ManagedPane,
    transport: PtyTransport | undefined,
    ptyId: string | null
  ): boolean =>
    isTerminalPanePasteTargetCurrent({
      manager: managerRef.current,
      paneTransports: paneTransportsRef.current,
      paneId: pane.id,
      leafId: pane.leafId,
      transport,
      ptyId
    })

  const isKeyboardOwnedPasteSource = (source: TerminalPasteSource): boolean =>
    source === 'keyboard' || source === 'paste-event' || source === 'app-menu'

  // Why: menu accelerators and native paste events never run keydown's active-pane repair, so a keyboard-owned paste must aim at the pane owning the dispatch focus instead of a stale active pane that would cancel it as a focus change (#41352). Resolve once at dispatch; clipboard paths must keep that resolution through execution, because re-resolving after the async clipboard read can pick a different pane when the terminal-element lookup misses and the manager's active pane changed mid-read.
  const resolveKeyboardOwnedPasteTargetPane = (
    pane: ManagedPane,
    source: TerminalPasteSource,
    activeElementAtDispatch: Element | null
  ): ManagedPane => {
    if (!isKeyboardOwnedPasteSource(source)) {
      return pane
    }
    const manager = managerRef.current
    return manager && activeElementAtDispatch instanceof Element
      ? (resolveTerminalKeyboardPane(manager, activeElementAtDispatch) ?? pane)
      : pane
  }

  const pasteTextIntoResolvedPane = async (
    targetPane: ManagedPane,
    source: TerminalPasteSource,
    activeElementAtDispatch: Element | null,
    text: string,
    options?: TerminalPasteTextOptions
  ): Promise<void> => {
    const keyboardOwnedPaste = isKeyboardOwnedPasteSource(source)
    const transport = paneTransportsRef.current.get(targetPane.id)
    const ptyId = transport?.getPtyId() ?? null
    const execution = await pasteTextIntoTerminalPane({
      pane: targetPane,
      text,
      source,
      ptyId,
      runtime: resolveTerminalPasteRuntime({
        platform: shortcutPlatform,
        ptyId,
        transport,
        isWindowsConpty: forceBracketedMultilineTextPaste
      }),
      transport,
      inputKind: 'driving',
      isTargetCurrent: () => {
        if (!isPanePasteTargetMounted(targetPane, transport, ptyId)) {
          return false
        }
        return isTerminalPanePasteFocusCurrent({
          requireSameFocusedElement: keyboardOwnedPaste,
          activeElementAtDispatch,
          paneContainer: targetPane.container
        })
      },
      canContinue: () => isPanePasteTargetMounted(targetPane, transport, ptyId),
      planOptions: options
    })
    if (execution.status !== 'pasted') {
      setTerminalError(formatTerminalPasteExecutionError(execution.reason))
      return
    }
    if (text) {
      recordTerminalUserInputForLeaf(tabId, targetPane.leafId)
    }
    if (options?.recoverImagePasteWebglAtlas) {
      scheduleImagePasteWebglAtlasRecovery()
    }
  }

  // Public entry point for direct callers that pass a pane; clipboard flows call pasteTextIntoResolvedPane with their dispatch-time target.
  const executePanePasteText = (
    pane: ManagedPane,
    source: TerminalPasteSource,
    activeElementAtDispatch: Element | null,
    text: string,
    options?: TerminalPasteTextOptions
  ): Promise<void> =>
    pasteTextIntoResolvedPane(
      resolveKeyboardOwnedPasteTargetPane(pane, source, activeElementAtDispatch),
      source,
      activeElementAtDispatch,
      text,
      options
    )

  // Resolve per pane/PTY host: Windows Codex needs input-record newlines even beside other protocols.
  const resolvePaneProtectedMultilinePasteOptions = (
    pane: ManagedPane
  ): TerminalPasteTextOptions | undefined => {
    const state = useAppStore.getState()
    const options = resolveProtectedMultilinePasteOptionsForPane({
      isWindowsClient: forceBracketedMultilineTextPaste,
      hostPlatform: resolveTerminalInputHostPlatform({
        clientPlatform: shortcutPlatform,
        state,
        worktreeId,
        transport: paneTransportsRef.current.get(pane.id) ?? null
      }),
      agentStatusByPaneKey: state.agentStatusByPaneKey,
      paneForegroundAgentByPaneKey: state.paneForegroundAgentByPaneKey,
      tabId,
      leafId: pane.leafId
    })
    // Why: non-Windows clients keep xterm's own bracketing; only the Windows input-record contract is added.
    return forceBracketedMultilineTextPaste || options?.windowsInputRecordNewline
      ? options
      : undefined
  }

  const createPaneClipboardCopiedFiles = (pane: ManagedPane) =>
    createTerminalClipboardCopiedFiles({
      managerRef,
      paneTransportsRef,
      worktreeId,
      tabId,
      cwd,
      pane
    })

  const pasteFromClipboard = (
    pane: ManagedPane,
    source: Extract<TerminalPasteSource, 'keyboard' | 'paste-event'>,
    readClipboardText: (options?: ReadClipboardTextOptions) => Promise<string> = window.api.ui
      .readClipboardText
  ): void => {
    const activeElementAtDispatch = document.activeElement
    const targetPane = resolveKeyboardOwnedPasteTargetPane(pane, source, activeElementAtDispatch)
    const connectionId = getConnectionId(worktreeId) ?? null
    const runtimeEnvironmentId = resolveTerminalPasteRuntimeEnvironmentId(
      useAppStore.getState(),
      worktreeId,
      paneTransportsRef.current.get(targetPane.id)
    )
    void pasteTerminalClipboard({
      readClipboardText,
      saveClipboardImageAsTempFile: window.api.ui.saveClipboardImageAsTempFile,
      copiedFiles: createPaneClipboardCopiedFiles(targetPane),
      connectionId,
      runtimeEnvironmentId,
      protectedMultilineTextPasteOptions: resolvePaneProtectedMultilinePasteOptions(targetPane),
      pasteText: (text, options) =>
        pasteTextIntoResolvedPane(targetPane, source, activeElementAtDispatch, text, options),
      onTextPasteError: () =>
        setTerminalError('Paste failed: clipboard text is too large for a safe terminal paste.'),
      onImagePasteError: (error) => setTerminalError(formatClipboardImagePasteError(error))
    }).catch(() => {
      setTerminalError('Paste failed.')
    })
  }

  return {
    createPaneClipboardCopiedFiles,
    executePanePasteText,
    pasteFromClipboard,
    pasteTextIntoResolvedPane,
    resolveKeyboardOwnedPasteTargetPane,
    resolvePaneProtectedMultilinePasteOptions
  }
}
