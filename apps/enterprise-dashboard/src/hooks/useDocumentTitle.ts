import { useEffect } from 'react';

const BASE_TITLE = 'Funti3rPay';

export function useDocumentTitle(pageTitle: string) {
  useEffect(() => {
    document.title = `${pageTitle} | ${BASE_TITLE}`;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [pageTitle]);
}
