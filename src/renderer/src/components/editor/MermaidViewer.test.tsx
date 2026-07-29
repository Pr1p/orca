// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => {
  const mockState = { keybindings: {}, settings: { theme: 'light' } }
  const useAppStore = Object.assign(
    (selector: (state: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState }
  )
  return { useAppStore }
})

vi.mock('./MermaidBlock', () => ({
  default: ({ content }: { content: string }) => <div data-testid="mermaid-block">{content}</div>
}))

vi.mock('./ZoomableDiagramSurface', () => ({
  default: ({ children, diagramKey }: { children: ReactNode; diagramKey: string }) => (
    <div data-diagram-key={diagramKey} data-testid="diagram-surface">
      {children}
    </div>
  )
}))

import MermaidViewer from './MermaidViewer'

afterEach(() => {
  cleanup()
})

describe('MermaidViewer', () => {
  it('edits source in split mode and rerenders the diagram from the draft', () => {
    const onContentChange = vi.fn()

    render(
      <MermaidViewer
        content={'flowchart TD\n  A --> B'}
        filePath="/repo/demo.mmd"
        onContentChange={onContentChange}
      />
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Split' }))
    fireEvent.change(screen.getByLabelText('Mermaid source'), {
      target: { value: 'flowchart TD\n  A --> C' }
    })

    expect(onContentChange).toHaveBeenLastCalledWith('flowchart TD\n  A --> C')
    expect(screen.getByTestId('diagram-surface').getAttribute('data-diagram-key')).toBe(
      'flowchart TD\n  A --> C'
    )
    expect(screen.getByTestId('mermaid-block').textContent).toContain('A --> C')
  })

  it('keeps code mode editable without rendering the diagram panel', () => {
    render(
      <MermaidViewer
        content={'flowchart TD\n  A --> B'}
        filePath="/repo/demo.mmd"
        onContentChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Code' }))

    expect((screen.getByLabelText('Mermaid source') as HTMLTextAreaElement).readOnly).toBe(false)
    expect(screen.queryByTestId('diagram-surface')).toBeNull()
  })

  it('keeps a new empty diagram editable after the first input', () => {
    render(<MermaidViewer content="" filePath="/repo/new.mmd" onContentChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Mermaid source'), {
      target: { value: 'flowchart LR\n  Start --> Done' }
    })

    expect(screen.getByRole('radio', { name: 'Split' }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByLabelText('Mermaid source') as HTMLTextAreaElement).value).toBe(
      'flowchart LR\n  Start --> Done'
    )
    expect(screen.getByTestId('diagram-surface').getAttribute('data-diagram-key')).toBe(
      'flowchart LR\n  Start --> Done'
    )
  })
})
