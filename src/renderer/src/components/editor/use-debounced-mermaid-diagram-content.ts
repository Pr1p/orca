import { useEffect, useState } from 'react'

export const MERMAID_RENDER_DEBOUNCE_MS = 250

export function useDebouncedMermaidDiagramContent(content: string): string {
  const [debouncedContent, setDebouncedContent] = useState(content)

  useEffect(() => {
    if (content.length === 0) {
      setDebouncedContent('')
      return
    }

    const timer = window.setTimeout(() => {
      setDebouncedContent(content)
    }, MERMAID_RENDER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [content])

  return debouncedContent
}
