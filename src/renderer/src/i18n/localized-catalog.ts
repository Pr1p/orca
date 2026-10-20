import { i18n } from './i18n'

// Why: search metadata and catalogs call translate() during build. Caching per
// active locale and resource bundle keeps lookups cheap while plugin updates refresh labels.
export function createLocalizedCatalog<T>(builder: () => T): () => T {
  let cachedLocale: string | undefined
  let cachedResourceBundle: unknown
  let cachedValue: T | undefined

  return () => {
    const resourceBundle = i18n.getResourceBundle(i18n.language, 'translation')
    if (
      cachedLocale !== i18n.language ||
      cachedResourceBundle !== resourceBundle ||
      cachedValue === undefined
    ) {
      cachedLocale = i18n.language
      cachedResourceBundle = resourceBundle
      cachedValue = builder()
    }
    return cachedValue
  }
}
