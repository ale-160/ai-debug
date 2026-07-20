import type { NodeAttachment, AttachmentKind } from '@/components/node-flow/types';
import { generateId } from '@/lib/id';

/** 单文件大小上限：10MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** 图片压缩默认最大边长（px） */
const DEFAULT_MAX_IMAGE_SIZE = 1024;
/** 图片压缩默认 JPEG 质量 */
const DEFAULT_QUALITY = 0.85;

/** 图片扩展名集合（小写，不含点） */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg']);
/** 文本类扩展名集合（小写，覆盖常见代码/配置/文档格式） */
const TEXT_EXTENSIONS = new Set([
  'js',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'c',
  'cpp',
  'go',
  'rust',
  'md',
  'txt',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'sql',
  'sh',
]);

/** 生成附件 ID（统一使用 @/lib/id 的 CSPRNG 方案） */
function generateAttachmentId(): string {
  return generateId('att');
}

/** 从文件名提取扩展名（小写，不含点）。无扩展名返回空串 */
function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

/**
 * 根据 MIME 类型与文件扩展名判断附件分类。
 * - image: png/jpg/jpeg/webp/gif/bmp/svg
 * - text: 常见代码与文本类文件（js/ts/md/json/yaml 等）
 * - binary: 其他所有格式（pdf/docx/xlsx/zip/exe 等）
 * 用户需求：不限制任何格式，binary 分类仅记录元信息即可。
 */
export function classifyFile(file: File): AttachmentKind {
  const { type, name } = file;
  // MIME 优先判断
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml') {
    return 'text';
  }
  // 扩展名回退判断（部分文件 MIME 可能空或 application/octet-stream）
  const ext = getExtension(name);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'binary';
}

/** FileReader 读取文件为纯文本 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read text failed'));
    reader.readAsText(file);
  });
}

/**
 * 压缩图片到指定最大边长，返回 JPEG data URL。
 * - 等比缩放，长边不超过 maxSize
 * - GIF 仅渲染首帧（canvas drawImage 限制）
 * - 透明 PNG 转 JPEG 时填充白底，避免黑色背景
 * - SSR 安全：仅在浏览器环境执行
 */
export function compressImage(
  file: File,
  maxSize: number = DEFAULT_MAX_IMAGE_SIZE,
  quality: number = DEFAULT_QUALITY,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('compressImage requires browser environment'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read image failed'));
    reader.onload = () => {
      const src = reader.result;
      if (typeof src !== 'string') {
        reject(new Error('invalid image data'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('image decode failed'));
      img.onload = () => {
        let { width, height } = img;
        // 长边等比缩放到 maxSize
        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas 2d context unavailable'));
          return;
        }
        // 白底填充，避免透明 PNG 转 JPEG 后变黑
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * 处理单个 File 对象，返回 NodeAttachment。
 * - 超过 MAX_FILE_SIZE 时返回 parseStatus='failed' 的附件（携带 parseError）
 * - image: 压缩后存 data URL
 * - text: 读取为纯文本存 data
 * - binary: 不读取内容，data 字段为空
 * 永不抛错，失败统一以 failed 状态返回，便于 UI 展示原因。
 */
export async function processFile(file: File): Promise<NodeAttachment> {
  const base: NodeAttachment = {
    id: generateAttachmentId(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind: classifyFile(file),
    parseStatus: 'pending',
  };

  // 大小预检：超过上限直接返回 failed
  if (file.size > MAX_FILE_SIZE) {
    return {
      ...base,
      parseStatus: 'failed',
      parseError: `file size ${file.size} exceeds ${MAX_FILE_SIZE}`,
    };
  }

  try {
    if (base.kind === 'image') {
      const dataUrl = await compressImage(file);
      return { ...base, data: dataUrl, parseStatus: 'parsed' };
    }
    if (base.kind === 'text') {
      const text = await readFileAsText(file);
      return { ...base, data: text, parseStatus: 'parsed' };
    }
    // binary：不读取内容
    return { ...base, parseStatus: 'parsed' };
  } catch (err) {
    return {
      ...base,
      parseStatus: 'failed',
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 批量处理文件，返回所有 NodeAttachment（含 failed 项）。
 * 调用方可通过 parseStatus 过滤 parsed 用于持久化，或据 failed 数量提示用户。
 */
export async function processFiles(files: FileList | File[]): Promise<NodeAttachment[]> {
  const arr = Array.from(files);
  return Promise.all(arr.map(processFile));
}

/** 格式化文件大小为人类可读字符串（B/KB/MB） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
