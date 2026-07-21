import type { Metadata } from 'next';
import ClientRedirect from '@/components/seo/ClientRedirect';
import DebugFlowEditorLoader from '@/components/DebugFlowEditorLoader';
import { getMetadata } from '@/config/metadata';
import { getStructuredData } from '@/config/structuredData';

export const metadata: Metadata = getMetadata('en');

const jsonLd = getStructuredData('en');

/**
 * 4.2.2：JSON-LD 字面量形式渲染（替代 dangerouslySetInnerHTML）。
 *
 * 原实现用 dangerouslySetInnerHTML 注入 JSON.stringify(jsonLd)，存在 XSS 风险
 * （若 jsonLd 含用户输入且未严格转义，可注入 </script><script> 恶意代码）。
 *
 * 改为 JSX 字面量形式：{jsonLdString} 作为 script 子节点渲染。React 对 script
 * 标签内的子节点不会做 HTML 转义（script 内容为 raw text），因此需在 JS 层
 * 做防御性转义：将所有 `<` 替换为 `\u003c`，让浏览器解析 JSON 时还原为 `<`，
 * 同时避免字符串中包含 `</script>` 字面量时提前结束 script 标签。
 *
 * 即使当前 jsonLd 数据来自受控的 structuredData.ts（无用户输入），也做防御性
 * 处理，避免未来数据源变更引入 XSS。
 */
const jsonLdString = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

export default function EnglishPage() {
  return (
    <>
      <script type="application/ld+json">{jsonLdString}</script>
      <ClientRedirect />
      <DebugFlowEditorLoader lang="en" />
    </>
  );
}
