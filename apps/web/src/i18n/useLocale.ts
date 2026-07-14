import { useState, useCallback } from 'react'
import { translations, type Locale, type TranslationKey } from './translations'

const STORAGE_KEY = 'pooly_locale'

function getSavedLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'fr' || saved === 'en') return saved
  const browser = navigator.language.toLowerCase()
  return browser.startsWith('fr') ? 'fr' : 'en'
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(getSavedLocale)

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }, [])

  const t = useCallback((key: TranslationKey): string => {
    const dict = translations[locale] as Record<TranslationKey, string | undefined>
    return dict[key] ?? (translations['en'][key] as string) ?? key
  }, [locale])

  return { locale, setLocale, t }
}
