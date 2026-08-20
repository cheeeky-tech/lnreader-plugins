import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { fetchApi } from '@libs/fetch';
import { NovelStatus } from '@libs/novelStatus';
import { load as loadCheerio } from 'cheerio';

const BASE_URL = 'https://hexnovels.me';

class HexNovels implements Plugin.PluginBase {
  id = 'HEXNOVELS';
  name = 'HexNovels';
  site = BASE_URL;
  version = '1.0.0';
  icon = 'https://hexnovels.me/favicon.ico';

  /**
   * HexNovels не предоставляет нам известного публиного API.
   * Поэтому используем HTML сайта.
   */
  async popularNovels(
  pageNo: number,
  _options: Plugin.PopularNovelsOptions<Filters>,
): Promise<Plugin.NovelItem[]> {

    const url =
      pageNo <= 1
        ? this.site
        : `${this.site}/catalog?page=${pageNo}`;

    const res = await fetchApi(url);

    if (!res.ok) {
      throw new Error(`HexNovels: HTTP ${res.status}`);
    }

    const html = await res.text();
    const $ = loadCheerio(html);

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    /**
     * Все страницы произведений имеют:
     *
     * /content/<slug>
     *
     * Исключаем ссылки на главы:
     *
     * /content/<slug>/<uuid>
     */
    $('a[href^="/content/"]').each((_, element) => {
      const href = $(element).attr('href');

      if (!href) return;

      const path = href.replace(/^\/+/, '');

      const parts = path.split('/');

      if (parts.length !== 2) return;

      if (!parts[0] || !parts[1]) return;

      const name = $(element).text().replace(/\s+/g, ' ').trim();

      if (!name) return;

      if (seen.has(path)) return;

      seen.add(path);

      novels.push({
        name,
        path,
        cover: defaultCover,
      });
    });

    return novels;
  }

  async searchNovels(
  searchTerm: string,
  _pageNo: number,
): Promise<Plugin.NovelItem[]> {

    /**
     * Основной вариант — каталог HexNovels.
     *
     * Если текущая версия сайта изменит параметр поиска,
     * достаточно будет изменить URL здесь.
     */
    const url =
      `${this.site}/catalog?search=` +
      encodeURIComponent(searchTerm);

    const res = await fetchApi(url);

    if (!res.ok) {
      throw new Error(`HexNovels search: HTTP ${res.status}`);
    }

    const html = await res.text();
    const $ = loadCheerio(html);

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('a[href^="/content/"]').each((_, element) => {
      const href = $(element).attr('href');

      if (!href) return;

      const path = href.replace(/^\/+/, '');
      const parts = path.split('/');

      // Только страницы произведений, не страницы глав.
      if (parts.length !== 2) return;

      const name = $(element).text().replace(/\s+/g, ' ').trim();

      if (!name || seen.has(path)) return;

      seen.add(path);

      novels.push({
        name,
        path,
        cover: defaultCover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const normalizedPath = novelPath
      .replace(/^https?:\/\/hexnovels\.me\/?/i, '')
      .replace(/^\/+/, '')
      .split('?')[0];

    const url = `${this.site}/${normalizedPath}`;

    const res = await fetchApi(url);

    if (!res.ok) {
      throw new Error(`HexNovels novel: HTTP ${res.status}`);
    }

    const html = await res.text();
    const $ = loadCheerio(html);

    /**
     * Заголовок.
     *
     * На HexNovels:
     * h1 = "Реинкарнация с Самой Сильной Системой (Новелла)"
     */
    const name =
      $('h1').first().text().replace(/\s+/g, ' ').trim() ||
      normalizedPath.split('/').pop() ||
      'Без названия';

    /**
     * Обложка.
     */
    let cover = defaultCover;

    const coverCandidates = [
      'img[alt*="Постер"]',
      'img[alt*="обложк"]',
      'img[alt*="Image"]',
      'img',
    ];

    for (const selector of coverCandidates) {
      const src =
        $(selector).first().attr('src') ||
        $(selector).first().attr('data-src');

      if (src) {
        cover = absoluteUrl(src);
        break;
      }
    }

    /**
     * Описание.
     *
     * На странице оно находится после "Описание".
     * Берём контейнер вокруг соответствующего заголовка.
     */
    let summary = '';

    $('h2, h3, h4, h5').each((_, element) => {
      const heading = $(element)
        .text()
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      if (heading !== 'описание') return;

      const container = $(element).parent();

      const text = container
        .find('p')
        .map((_, p) => $(p).text().trim())
        .get()
        .filter(Boolean)
        .join('\n\n');

      if (text) {
        summary = text;
      }
    });

    /**
     * Если структура выше изменится, пробуем найти description
     * по тексту страницы.
     */
    if (!summary) {
      const description = $('[class*="description"]')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      if (description) {
        summary = description;
      }
    }

    /**
     * Статус.
     */
    const pageText = $('body').text().replace(/\s+/g, ' ');

    let status = NovelStatus.Unknown;

    if (/Статус оригинала\s*Завершен/i.test(pageText)) {
      status = NovelStatus.Completed;
    } else if (/Статус оригинала\s*Онгоинг/i.test(pageText)) {
      status = NovelStatus.Ongoing;
    } else if (/Статус оригинала\s*Приостановлен/i.test(pageText)) {
      status = NovelStatus.OnHiatus;
    }

    /**
     * Автор.
     */
    let author = '';

    $('h2, h3, h4, h5').each((_, element) => {
      const heading = $(element)
        .text()
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

      if (heading !== 'автор') return;

      const value = $(element)
        .next()
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      if (value) {
        author = value;
      }
    });

    /**
     * Главы.
     *
     * На HexNovels ссылки имеют:
     *
     * /content/<slug>/<uuid>
     *
     * UUID позволяет безопасно использовать URL главы
     * как chapter.path.
     */
    const chapters: Plugin.ChapterItem[] = [];
    const seenChapters = new Set<string>();

    $('a[href^="/content/"]').each((_, element) => {
      const href = $(element).attr('href');

      if (!href) return;

      const path = href.replace(/^\/+/, '').split('?')[0];
      const parts = path.split('/');

      if (parts.length !== 3) return;

      if (parts[0] !== normalizedPath.split('/')[1]) return;

      const chapterPath = path;

      if (seenChapters.has(chapterPath)) return;

      const chapterName = $(element)
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      if (!chapterName) return;

      seenChapters.add(chapterPath);

      /**
       * Пытаемся определить номер главы.
       */
      const match = chapterName.match(
        /(?:глава|chapter)\s+(\d+(?:\.\d+)?)/i,
      );

      const chapterNumber = match
        ? Number(match[1])
        : chapters.length + 1;

      chapters.push({
        name: chapterName,
        path: chapterPath,
        releaseTime: null,
        chapterNumber,
      });
    });

    /**
     * HexNovels сейчас отдаёт виртуализированный список глав.
     * Если список оказался в обратном порядке, LNReader всё равно
     * сможет читать главы по их реальным URL.
     */
    chapters.sort((a, b) => {
      const aNumber =
        typeof a.chapterNumber === 'number'
          ? a.chapterNumber
          : 0;

      const bNumber =
        typeof b.chapterNumber === 'number'
          ? b.chapterNumber
          : 0;

      return aNumber - bNumber;
    });

    return {
      path: normalizedPath,
      name,
      cover,
      summary,
      author,
      status,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const normalizedPath = chapterPath
      .replace(/^https?:\/\/hexnovels\.me\/?/i, '')
      .replace(/^\/+/, '')
      .split('?')[0];

    const url = `${this.site}/${normalizedPath}`;

    const res = await fetchApi(url);

    if (!res.ok) {
      throw new Error(
        `HexNovels chapter: HTTP ${res.status}`,
      );
    }

    const html = await res.text();
    const $ = loadCheerio(html);

    /**
     * Важно:
     *
     * Не берём весь body, потому что туда попадут:
     * - меню;
     * - реклама;
     * - комментарии;
     * - навигация;
     * - footer.
     *
     * Сначала ищем контейнер по содержимому.
     */

    const title = $('h1').first();

    let content = '';

    /**
     * Варианты селекторов на случай небольшого изменения
     * HTML-разметки сайта.
     */
    const selectors = [
      '[class*="chapter-content"]',
      '[class*="chapter_content"]',
      '[class*="ChapterContent"]',
      '[class*="reader-content"]',
      '[class*="reader_content"]',
      '[class*="ReaderContent"]',
      'article',
    ];

    for (const selector of selectors) {
      const node = $(selector).first();

      if (node.length) {
        const htmlContent = node.html();

        if (htmlContent && htmlContent.trim().length > 100) {
          content = htmlContent;
          break;
        }
      }
    }

    /**
     * Если класс контейнера неизвестен, ищем родителя H1,
     * содержащего основной текст главы.
     */
    if (!content && title.length) {
      let node = title.parent();

      for (let i = 0; i < 5 && node.length; i++) {
        const textLength = node.text().trim().length;

        if (textLength > 500) {
          content = node.html() || '';
          break;
        }

        node = node.parent();
      }
    }

    /**
     * Последний fallback.
     *
     * На индексируемых страницах HexNovels текст главы находится
     * непосредственно после заголовка главы.
     */
    if (!content && title.length) {
      const parts: string[] = [];

      let current = title.next();

      while (current.length) {
        const tag = current[0]?.tagName?.toLowerCase();

        if (
          tag === 'footer' ||
          tag === 'nav' ||
          tag === 'header'
        ) {
          break;
        }

        const text = current.text().trim();

        if (text) {
          parts.push(current.toString());
        }

        current = current.next();
      }

      content = parts.join('\n');
    }

    if (!content || content.replace(/<[^>]*>/g, '').trim().length < 50) {
      throw new Error(
        'HexNovels: не удалось найти текст главы',
      );
    }

    /**
     * Удаляем мусор.
     */
    const content$ = loadCheerio(
      `<div id="lnreader-hex-content">${content}</div>`,
    );

    const root = content$('#lnreader-hex-content');

    root.find(
      [
        'script',
        'style',
        'noscript',
        'iframe',
        'form',
        'button',
        '[class*="comment"]',
        '[class*="Comment"]',
        '[class*="advert"]',
        '[class*="Advert"]',
        '[class*="banner"]',
        '[class*="Banner"]',
      ].join(','),
    ).remove();

    /**
     * Удаляем повторный заголовок главы, если он попал
     * в контейнер с текстом.
     */
    root.find('h1').remove();

    /**
     * Преобразуем относительные ссылки/картинки в абсолютные.
     */
    root.find('img').each((_, element) => {
      const src =
        content$(element).attr('src') ||
        content$(element).attr('data-src');

      if (src) {
        content$(element).attr(
          'src',
          absoluteUrl(src),
        );
      }
    });

    root.find('a').each((_, element) => {
      const href = content$(element).attr('href');

      if (href) {
        content$(element).attr(
          'href',
          absoluteUrl(href),
        );
      }
    });

    return root.html()?.trim() || '';
  }

  resolveUrl = (
    path: string,
    isNovel?: boolean,
  ): string => {
    const normalizedPath = path
      .replace(/^https?:\/\/hexnovels\.me\/?/i, '')
      .replace(/^\/+/, '');

    return `${this.site}/${normalizedPath}`;
  };
}

function absoluteUrl(url: string): string {
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('//')
  ) {
    return url.startsWith('//')
      ? `https:${url}`
      : url;
  }

  if (url.startsWith('/')) {
    return `${BASE_URL}${url}`;
  }

  return `${BASE_URL}/${url}`;
}

export default new HexNovels();
