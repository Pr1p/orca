// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../ui/tooltip'
import { AgentPostPasteSubmitInputControl } from './AgentPostPasteSubmitInputControl'

afterEach(cleanup)

it('keeps the selected input inert and saves a different selection', () => {
  const onSave = vi.fn()
  render(
    <TooltipProvider>
      <AgentPostPasteSubmitInputControl value="enter" onSave={onSave} />
    </TooltipProvider>
  )

  fireEvent.click(screen.getByRole('radio', { name: 'Press Enter' }))
  expect(onSave).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('radio', { name: 'Press Ctrl+Enter' }))
  expect(onSave).toHaveBeenCalledWith('ctrl-enter')
})
