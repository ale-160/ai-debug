import type { Language } from '@/data/i18n';

const SITE_URL = 'https://ai-debug.ale160.com';

const PERSON_DATA = {
  '@type': 'Person',
  name: 'Ale',
  url: 'https://ale160.com',
};

const ZH_DATA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: '蛛网 · AI Debug',
  description:
    '把 AI 对话从线性列表变成 git 仓库式的蛛网结构。每个分支独立维护自己的上下文路径，支持分叉、合并、放弃、恢复。',
  url: `${SITE_URL}/zh/`,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  inLanguage: 'zh-CN',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
  author: PERSON_DATA,
};

const EN_DATA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Spider Web · AI Debug',
  description:
    'Transform AI conversations from linear lists into a git-repository-like web structure. Each branch maintains its own context path independently.',
  url: `${SITE_URL}/`,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web',
  inLanguage: 'en',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
  author: PERSON_DATA,
};

export function getStructuredData(lang: Language = 'en') {
  return lang === 'zh' ? ZH_DATA : EN_DATA;
}
