import type { Metadata } from 'next';
import DebugFlowEditorLoader from '@/components/DebugFlowEditorLoader';
import { getMetadata } from '@/config/metadata';
import { getStructuredData } from '@/config/structuredData';

export const metadata: Metadata = getMetadata('zh');

const jsonLd = getStructuredData('zh');

/**
 * 4.2.2：JSON-LD 字面量形式渲染（替代 dangerouslySetInnerHTML）。
 *
 * 详见 app/page.tsx 中相同函数的注释。将 JSON 字符串中所有 `<` 替换为
 * `\u003c`，避免字符串中包含 `</script>` 字面量时提前结束 script 标签。
 */
const jsonLdString = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

export default function ZhPage() {
  return (
    <>
      <script type="application/ld+json">{jsonLdString}</script>
      <DebugFlowEditorLoader lang="zh" />
    </>
  );
}
