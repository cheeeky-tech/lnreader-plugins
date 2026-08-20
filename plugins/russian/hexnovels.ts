import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { fetchApi } from '@libs/fetch';
import { NovelStatus } from '@libs/novelStatus';

const BASE_URL = 'https://hexnovels.me';
const API_URL = 'https://api.hexnovels.me/v2';

type HexBook = {
  id: string;
  slug: string;
  poster?: string | null;
  status?: string | null;
  name?: {
    ru?: string;
    en?: string;
    original?: string;
  };
};

type ProseMirrorNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  marks?: Array<{
    type?: string;
  }>;
};

type HexChapter = {
  id: string;
  name?: string | null;
  title?: string | null;
  number?: number | string;
  volume?: number | string;
  bookId?: string;
  branchId?: string;
  content?: {
    type?: string;
    content?: ProseMirrorNode[];
  };
};

class HexNovels implements Plugin.PluginBase {
  id = 'HEXNOVELS';
  name = 'HexNovels';
  site = BASE_URL;
  version = '2.1.0';
  icon = 'https://hexnovels.me/favicon.ico';

  async popularNovels(
    _pageNo: number,
    _options: Plugin.PopularNovelsOptions<Filters>,
  ): Promise<Plugin.NovelItem[]> {
    return [];
  }

  async searchNovels(
    searchTerm: string,
    _pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const url =
      `${API_URL}/books?` +
      `search=${encodeURIComponent(searchTerm)}` +
      `&ignoreUserScopedContentStatus=true` +
      `&serviceName=hexnovels`;

    const res = await fetchApi(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`HexNovels search: HTTP ${res.status}`);
    }

    const books = (await res.json()) as HexBook[];

    if (!Array.isArray(books)) {
      return [];
    }

    return books.map(book => ({
      name:
        book.name?.ru ||
        book.name?.en ||
        book.name?.original ||
        book.slug,
      path: book.slug,
      cover: book.poster || defaultCover,
    }));
  }

  async parseNovel(
    novelPath: string,
  ): Promise<Plugin.SourceNovel> {
    const slug = getSlug(novelPath);

    const book = await this.findBook(slug);

    if (!book) {
      throw new Error(
        `HexNovels: book not found: ${slug}`,
      );
    }

    const chapters =
      await this.getChapters(book.id, slug);

    if (!chapters.length) {
      throw new Error(
        `HexNovels: no chapters found for ${slug}`,
      );
    }

    const name =
      book.name?.ru ||
      book.name?.en ||
      book.name?.original ||
      slug;

    const cover = book.poster || defaultCover;

    let status = NovelStatus.Unknown;

    if (book.status === 'DONE') {
      status = NovelStatus.Completed;
    } else if (book.status === 'ONGOING') {
      status = NovelStatus.Ongoing;
    }

    return {
      path: slug,
      name,
      cover,
      summary: '',
      author: '',
      status,
      chapters,
    };
  }

  async parseChapter(
    chapterPath: string,
  ): Promise<string> {
    const chapterId = getChapterId(chapterPath);

    const url =
      `${API_URL}/chapters/${chapterId}`;

    const res = await fetchApi(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(
        `HexNovels chapter: HTTP ${res.status}`,
      );
    }

    const chapter =
      (await res.json()) as HexChapter;

    if (!chapter.content?.content) {
      throw new Error(
        'HexNovels: chapter content is empty',
      );
    }

    return nodesToHtml(
      chapter.content.content,
    );
  }

  private async findBook(
    slug: string,
  ): Promise<HexBook | null> {
    const url =
      `${API_URL}/books?` +
      `search=${encodeURIComponent(slug)}` +
      `&ignoreUserScopedContentStatus=true` +
      `&serviceName=hexnovels`;

    const res = await fetchApi(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      return null;
    }

    const books =
      (await res.json()) as HexBook[];

    if (!Array.isArray(books)) {
      return null;
    }

    return (
      books.find(
        book => book.slug === slug,
      ) || null
    );
  }

  private async getChapters(
    bookId: string,
    slug: string,
  ): Promise<Plugin.ChapterItem[]> {
    const url =
      `${API_URL}/chapters?bookId=${encodeURIComponent(
        bookId,
      )}`;

    const res = await fetchApi(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(
        `HexNovels chapters: HTTP ${res.status}`,
      );
    }

    const data =
  (await res.json()) as HexChapter[];

if (!Array.isArray(data)) {
  throw new Error(
    'HexNovels: chapters response is not an array',
  );
}

throw new Error(
  `HEX TEST: API returned ${data.length} chapters`,
);


    if (!Array.isArray(data)) {
      throw new Error(
        'HexNovels: chapters response is not an array',
      );
    }

    const chapters = data
      .filter(chapter => {
        return (
          typeof chapter.id === 'string' &&
          chapter.id.length > 0
        );
      })
      .map((chapter, index) => {
        const number = Number(
          chapter.number,
        );

        const chapterNumber =
          Number.isFinite(number) && number > 0
            ? number
            : index + 1;

        const chapterName =
          chapter.name?.trim() ||
          chapter.title?.trim() ||
          `Глава ${chapterNumber}`;

        return {
          name: chapterName,
          path: `${slug}/${chapter.id}`,
          releaseTime: null,
          chapterNumber,
        };
      });

    chapters.sort(
      (a, b) =>
        (a.chapterNumber ?? 0) -
        (b.chapterNumber ?? 0),
    );

    return chapters;
  }

  resolveUrl = (
    path: string,
    _isNovel?: boolean,
  ): string => {
    const normalized = path
      .replace(
        /^https?:\/\/hexnovels\.me\/?/i,
        '',
      )
      .replace(/^\/+/, '');

    return `${BASE_URL}/${normalized}`;
  };
}

function getSlug(
  path: string,
): string {
  const normalized = path
    .replace(
      /^https?:\/\/hexnovels\.me\/?/i,
      '',
    )
    .replace(/^\/+/, '')
    .split('?')[0];

  const parts = normalized.split('/');

  if (parts[0] === 'content') {
    return parts[1] || '';
  }

  return parts[0] || '';
}

function getChapterId(
  path: string,
): string {
  const normalized = path
    .replace(
      /^https?:\/\/hexnovels\.me\/?/i,
      '',
    )
    .replace(/^\/+/, '')
    .split('?')[0];

  const parts = normalized.split('/');

  return parts[parts.length - 1];
}

function nodesToHtml(
  nodes: ProseMirrorNode[],
): string {
  return nodes
    .map(nodeToHtml)
    .join('');
}

function nodeToHtml(
  node: ProseMirrorNode,
): string {
  const type = node.type || '';

  if (type === 'text') {
    return applyMarks(
      escapeHtml(node.text || ''),
      node.marks || [],
    );
  }

  const children = node.content
    ? nodesToHtml(node.content)
    : '';

  switch (type) {
    case 'paragraph':
      return `<p>${children}</p>`;

    case 'heading': {
      const level =
        typeof node.attrs?.level === 'number'
          ? Math.min(
              Math.max(
                node.attrs.level,
                1,
              ),
              6,
            )
          : 2;

      return `<h${level}>${children}</h${level}>`;
    }

    case 'blockquote':
      return `<blockquote>${children}</blockquote>`;

    case 'bulletList':
      return `<ul>${children}</ul>`;

    case 'orderedList':
      return `<ol>${children}</ol>`;

    case 'listItem':
      return `<li>${children}</li>`;

    case 'hardBreak':
      return '<br>';

    case 'horizontalRule':
      return '<hr>';

    case 'image': {
      const src = node.attrs?.src;

      if (
        typeof src !== 'string' ||
        !src
      ) {
        return '';
      }

      return (
        `<p><img src="` +
        `${escapeAttribute(
          absoluteUrl(src),
        )}" /></p>`
      );
    }

    default:
      return children;
  }
}

function applyMarks(
  text: string,
  marks: Array<{ type?: string }>,
): string {
  let result = text;

  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `<strong>${result}</strong>`;
        break;

      case 'italic':
        result = `<em>${result}</em>`;
        break;

      case 'underline':
        result = `<u>${result}</u>`;
        break;

      case 'strike':
        result = `<s>${result}</s>`;
        break;
    }
  }

  return result;
}

function escapeHtml(
  value: string,
): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(
      /</g,
      '&lt;',
    )
    .replace(
      />/g,
      '&gt;',
    )
    .replace(
      /"/g,
      '&quot;',
    )
    .replace(
      /'/g,
      '&#39;',
    );
}

function escapeAttribute(
  value: string,
): string {
  return escapeHtml(value);
}

function absoluteUrl(
  url: string,
): string {
  if (
    url.startsWith('http://') ||
    url.startsWith('https://')
  ) {
    return url;
  }

  if (url.startsWith('//')) {
    return `https:${url}`;
  }

  if (url.startsWith('/')) {
    return `${BASE_URL}${url}`;
  }

  return `${BASE_URL}/${url}`;
}

export default new HexNovels();
