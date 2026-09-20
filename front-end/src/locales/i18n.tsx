import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import plDict from './pl.json';
import enDict from './en.json';

export type Language = 'pl' | 'en';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  isPl: boolean;
}

const dictionaries: Record<Language, any> = {
  pl: plDict,
  en: enDict
};

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('esn_finances_lang');
      if (saved === 'pl' || saved === 'en') return saved;
    } catch {
      // localStorage may fail in private mode
    }
    return 'pl';
  });

  const setLanguage = (newLang: Language) => {
    setLanguageState(newLang);
    try {
      localStorage.setItem('esn_finances_lang', newLang);
    } catch {
      // ignore
    }
  };

  const t = (key: string, params?: Record<string, string | number>): string => {
    const keys = key.split('.');
    let value: any = dictionaries[language];

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        // Fallback to Polish
        let fallback: any = dictionaries.pl;
        for (const fbKey of keys) {
          if (fallback && typeof fallback === 'object' && fbKey in fallback) {
            fallback = fallback[fbKey];
          } else {
            fallback = null;
            break;
          }
        }
        value = fallback !== null ? fallback : key;
        break;
      }
    }

    if (typeof value !== 'string') {
      return key;
    }

    if (!params) {
      return value;
    }

    // Replace {{param}} placeholders
    return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, placeholder) => {
      return params[placeholder] !== undefined ? String(params[placeholder]) : `{{${placeholder}}}`;
    });
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t, isPl: language === 'pl' }}>
      {children}
    </I18nContext.Provider>
  );
};

export function useTranslation(): I18nContextType {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
}
