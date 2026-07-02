import type { Metadata } from 'next';
import DebugFlowEditorLoader from '@/components/DebugFlowEditorLoader';
import { getMetadata } from '@/config/metadata';
import { getStructuredData } from '@/config/structuredData';

export const metadata: Metadata = getMetadata('zh');

const jsonLd = getStructuredData('zh');

export default function ZhPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <DebugFlowEditorLoader lang="zh" />
    </>
  );
}
