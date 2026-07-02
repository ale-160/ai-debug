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
  console.log(generateSitemapXml());
}
