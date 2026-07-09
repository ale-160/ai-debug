import type { Metadata, Viewport } from 'next';

const SITE_URL = 'https://ai-debug.ale160.com';

export const METADATA_ZH = {
  title: '蛛网 · AI Debug —— 蛛网式上下文管理工具',
  description:
    '把 AI 对话从线性列表变成 git 仓库式的蛛网结构。每个分支独立维护自己的上下文路径，支持分叉、合并、放弃、恢复，让复杂问题的排查不再被无关历史污染。',
  keywords: [
    'AI Debug',
    '蛛网式对话',
    'AI 对话工具',
    '上下文管理',
    '分支对话',
    'AI 调试助手',
    '可视化对话',
    'React Flow',
    '蛛网结构',
    '本地存储',
    '隐私保护',
    '无后端',
    '开源',
    '中文',
    '英文',
    '双语',
  ],
  authors: [{ name: 'Ale', url: 'https://ale160.com' }],
  creator: 'Ale',
  publisher: 'Ale',
  openGraph: {
    title: '蛛网 · AI Debug —— 蛛网式上下文管理工具',
    description: '把 AI 对话从线性列表变成 git 仓库式的蛛网结构，支持分叉、合并、放弃、恢复。',
    url: `${SITE_URL}/zh/`,
    siteName: '蛛网 · AI Debug',
    locale: 'zh_CN',
    type: 'website',
    images: [
      {
        url: 'https://ale160.com/og-image.png',
        width: 1200,
        height: 630,
        alt: '蛛网 · AI Debug 预览图',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '蛛网 · AI Debug —— 蛛网式上下文管理工具',
    description: '把 AI 对话从线性列表变成 git 仓库式的蛛网结构，支持分叉、合并、放弃、恢复。',
    images: ['https://ale160.com/og-image.png'],
    creator: '@ale160',
  },
  alternates: {
    canonical: `${SITE_URL}/zh/`,
    languages: {
      en: `${SITE_URL}/`,
      'zh-CN': `${SITE_URL}/zh/`,
    },
  },
};

export const METADATA_EN = {
  title: 'Spider Web · AI Debug — Web-style Context Management Tool',
  description:
    'Transform AI conversations from linear lists into a git-repository-like web structure. Each branch maintains its own context path independently, with forking, merging, abandoning, and restoring.',
  keywords: [
    'AI Debug',
    'web-style conversation',
    'AI chat tool',
    'context management',
    'branching conversation',
    'AI debugging assistant',
    'visual conversation',
    'React Flow',
    'spider web structure',
    'local storage',
    'privacy focused',
    'no backend',
    'open source',
    'Chinese',
    'English',
    'bilingual',
  ],
  authors: [{ name: 'Ale', url: 'https://ale160.com' }],
  creator: 'Ale',
  publisher: 'Ale',
  openGraph: {
    title: 'Spider Web · AI Debug — Web-style Context Management Tool',
    description:
      'Transform AI conversations from linear lists into a git-repository-like web structure with forking, merging, abandoning, and restoring.',
    url: `${SITE_URL}/`,
    siteName: 'Spider Web · AI Debug',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: 'https://ale160.com/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Spider Web · AI Debug Preview',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Spider Web · AI Debug — Web-style Context Management Tool',
    description:
      'Transform AI conversations from linear lists into a git-repository-like web structure with forking, merging, abandoning, and restoring.',
    images: ['https://ale160.com/og-image.png'],
    creator: '@ale160',
  },
  alternates: {
    canonical: `${SITE_URL}/`,
    languages: {
      en: `${SITE_URL}/`,
      'zh-CN': `${SITE_URL}/zh/`,
    },
  },
};

export function getMetadata(lang: string = 'zh'): Metadata {
  const metadata = lang === 'en' ? METADATA_EN : METADATA_ZH;

  return {
    title: metadata.title,
    description: metadata.description,
    keywords: metadata.keywords,
    authors: metadata.authors,
    creator: metadata.creator,
    publisher: metadata.publisher,
    icons: {
      icon: 'https://ale160.com/favicon.png',
    },
    formatDetection: {
      email: false,
      telephone: false,
    },
    openGraph: metadata.openGraph,
    twitter: metadata.twitter,
    robots: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
    alternates: metadata.alternates,
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export const SITE_URL_CONST = SITE_URL;
