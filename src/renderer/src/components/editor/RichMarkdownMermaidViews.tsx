import { NodeViewContent } from '@tiptap/react'
import { type JSX, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import MermaidBlock from './MermaidBlock'
import ZoomableDiagramSurface from './ZoomableDiagramSurface'

type MermaidTextDiagramMode = 'code' | 'split' | 'chart'

const MODE_OPTIONS = [
  {
    value: 'code',
    get label() {
      return translate('auto.components.editor.RichMarkdownMermaidViews.code', 'Code')
    }
  },
  {
    value: 'split',
    get label() {
      return translate('auto.components.editor.RichMarkdownMermaidViews.split', 'Split')
    }
  },
  {
    value: 'chart',
    get label() {
      return translate('auto.components.editor.RichMarkdownMermaidViews.chart', 'Chart')
    }
  }
] as const satisfies readonly { value: MermaidTextDiagramMode; label: string }[]

type RichMarkdownMermaidViewsProps = {
  content: string
  isDark: boolean
}

export default function RichMarkdownMermaidViews({
  content,
  isDark
}: RichMarkdownMermaidViewsProps): JSX.Element {
  const [mode, setMode] = useState<MermaidTextDiagramMode>('split')
  const trimmedContent = content.trim()
  const showSource = mode !== 'chart' || trimmedContent.length === 0
  const showDiagram = mode !== 'code' && trimmedContent.length > 0

  return (
    <>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        spacing={0}
        value={mode}
        className="rich-markdown-mermaid-view-toggle"
        contentEditable={false}
        onValueChange={(nextMode) => {
          if (nextMode) {
            setMode(nextMode as MermaidTextDiagramMode)
          }
        }}
      >
        {MODE_OPTIONS.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className={cn('rich-markdown-mermaid-layout', `is-${mode}`)}>
        <NodeViewContent<'pre'>
          as="pre"
          className={cn(!showSource && 'rich-markdown-code-block-source-hidden')}
        />
        {showDiagram ? (
          <div contentEditable={false} className="mermaid-preview">
            <ZoomableDiagramSurface
              diagramKey={trimmedContent}
              label={translate(
                'auto.components.editor.RichMarkdownMermaidViews.mermaid',
                'Mermaid'
              )}
            >
              <MermaidBlock content={trimmedContent} isDark={isDark} htmlLabels={false} />
            </ZoomableDiagramSurface>
          </div>
        ) : null}
      </div>
    </>
  )
}
