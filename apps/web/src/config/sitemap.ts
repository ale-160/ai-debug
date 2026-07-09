// ============================================================
// AI Debug — sitemap.xml 生成脚本（CLI 入口）
//
// 用途：通过 `node -e "require('./src/config/sitemap')"` 或直接 `node` 执行
//      输出 sitemap.xml 到 stdout，重定向到 public/sitemap.xml。
//      不被应用代码 import，knip 会误报为 unused file。
// ============================================================

const SITEMAP_PROJECTS = [
  {
    path: '',
    priority: 1.0,
    changefreq: 'weekly' as const,
    lang: 'en' as const,
  },
  {
    path: 'zh',
    priority: 0.9,
    changefreq: 'weekly' as const,
    lang: 'zh' as const,
  },
];

const SITE_URL = 'https://ai-debug.ale160.com';

export function generateSitemapXml(): string {
  const today = new Date().toISOString().split('T')[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
`;

  SITEMAP_PROJECTS.forEach((item) => {
    const loc = item.path ? `${SITE_URL}/${item.path}/` : `${SITE_URL}/`;

    xml += `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}/"/>
    <xhtml:link rel="alternate" hreflang="zh" href="${SITE_URL}/zh/"/>
  </url>
`;
  });

  xml += `</urlset>`;
  return xml;
}

if (typeof require !== 'undefined' && require.main === module) {
  // eslint-disable-next-line no-console -- CLI 脚本入口，输出 sitemap 到 stdout
  console.log(generateSitemapXml());
}
