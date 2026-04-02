import { useEffect } from 'react';

const BASE_TITLE = 'Geminus';

/**
 * Sets document.title reactively.
 * Pass `null` / empty to reset to base title.
 */
export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} | ${BASE_TITLE}` : BASE_TITLE;
    return () => { document.title = BASE_TITLE; };
  }, [title]);
}
