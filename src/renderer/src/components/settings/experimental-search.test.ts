import { afterEach, describe, expect, it } from 'vitest'

import { i18n, setRendererPluginLanguagePacks } from '@/i18n/i18n'
import { pluginLanguageResourceId } from '../../../../shared/plugins/plugin-language-pack-artifact'
import { getExperimentalSearchEntry } from './experimental-search'

afterEach(async () => {
  setRendererPluginLanguagePacks([])
  await i18n.changeLanguage('en')
})

describe('experimental search', () => {
  it('refreshes entries when the active plugin language pack changes in place', async () => {
    const id = 'plugin:test.experimental-search' as const
    const resourceLanguage = pluginLanguageResourceId(id)
    const pack = (terminalAttention: string) => ({
      id,
      resourceLanguage,
      pluginKey: 'test.experimental-search',
      locale: 'en',
      catalog: {
        auto: {
          components: {
            settings: {
              experimental: { search: { '9e4ddf776d': terminalAttention } }
            }
          }
        }
      }
    })
    setRendererPluginLanguagePacks([pack('Original terminal attention')])
    await i18n.changeLanguage(resourceLanguage)
    expect(getExperimentalSearchEntry().terminalAttention.title).toBe('Original terminal attention')

    setRendererPluginLanguagePacks([pack('Updated terminal attention')])

    expect(() => getExperimentalSearchEntry()).not.toThrow()
    expect(getExperimentalSearchEntry().terminalAttention.title).toBe('Updated terminal attention')
  })
})
