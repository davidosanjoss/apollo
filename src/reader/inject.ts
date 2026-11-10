// Roda num mundo isolado da página (injetado pelo processo principal): decide se a
// página parece um artigo e troca o documento pela versão de leitura.
import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { readerHtml, styleVars, type ReaderStyle } from './template';

const api = {
  probe(): boolean {
    try {
      return isProbablyReaderable(document, { minContentLength: 140, minScore: 20 });
    } catch {
      return false;
    }
  },

  enter(style: ReaderStyle): 'ok' | 'not-article' {
    const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 300 }).parse();
    if (!article?.content) return 'not-article';
    const html = readerHtml({
      title: article.title || document.title, byline: article.byline ?? null, siteName: article.siteName ?? null,
      content: article.content, length: article.length ?? 0, lang: article.lang ?? document.documentElement.lang ?? null,
    }, style);
    // Para a página: carregamento e timers dela (senão ela pode redesenhar por cima).
    window.stop();
    const last = window.setTimeout(() => {}, 0);
    for (let i = 0; i <= last; i++) { window.clearTimeout(i); window.clearInterval(i); }
    document.open();
    document.write(html);
    document.close();
    window.scrollTo(0, 0);
    return 'ok';
  },

  style(style: ReaderStyle): void {
    const el = document.getElementById('apollo-reader-vars');
    if (el) el.textContent = styleVars(style);
  },
};

(globalThis as unknown as { __apolloReader: typeof api }).__apolloReader = api;
