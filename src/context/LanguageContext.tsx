import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Language = 'sv' | 'en';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (sv: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
  t: (_sv, en) => en,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem('appLanguage');
    return (stored === 'sv' || stored === 'en') ? stored : 'en';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('appLanguage', lang);
  }, []);

  const t = useCallback((sv: string, en: string) => {
    return language === 'sv' ? sv : en;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
