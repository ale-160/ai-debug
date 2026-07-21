import type { NodeAttachment, AttachmentKind } from '@/components/node-flow/types';
import { generateId } from '@/lib/id';

/** 单文件大小上限：10MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** 图片压缩默认最大边长（px） */
const DEFAULT_MAX_IMAGE_SIZE = 1024;
/** 图片压缩默认 JPEG 质量（H-13：从 0.85 下调到 0.8，平衡体积与清晰度） */
const DEFAULT_QUALITY = 0.8;
/**
 * H-13：压缩后图片大小上限（base64 字符串长度）。
 * 10 张图片即可填满 localStorage 上限（5-10MB），故对单张压缩后图片设此上限。
 * 超过此大小的图片（即便已压缩）会被拒绝并提示用户。
 */
export const MAX_IMAGE_SIZE_BYTES = 500 * 1024;

/**
 * 4.5.1：单次批量处理附件总数上限。
 * 超过此值的附件直接返回 failed，避免一次性处理大量文件导致主线程卡顿 / 内存暴涨。
 */
export const MAX_ATTACHMENTS_PER_BATCH = 20;
/**
 * 4.5.1：processFiles 的最大并发数。
 * 限制为 4 避免一次性 FileReader + Image decode 占满主线程 / 网络队列。
 */
const MAX_CONCURRENT_PROCESSING = 4;

/**
 * 4.5.4：单张图片像素总数上限（50MP = 5000万像素）。
 * 超过此值的图片在 img.onload 后直接拒绝，避免 canvas 绘制 OOM。
 * 50MP 对应约 7000×7000，覆盖常见相机/手机原图，同时给浏览器留足内存余量。
 */
const MAX_IMAGE_PIXELS = 50_000_000;

/** 图片扩展名集合（小写，不含点）
 *
 * 4.5.2：从 IMAGE_EXTENSIONS 移除 `svg`，将 SVG 归类为 binary。
 * SVG 文件可内嵌 <script> 与外部资源引用，作为 image 渲染可能执行脚本
 * （<img src> 不执行脚本，但 innerHTML / data URL 渲染会执行）。
 * 归类为 binary 后只记录元信息，不会进入 image 处理路径，避免脚本执行风险。
 */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);
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
 * - image: png/jpg/jpeg/webp/gif/bmp（4.5.2：svg 已移除，归类为 binary）
 * - text: 常见代码与文本类文件（js/ts/md/json/yaml 等）
 * - binary: 其他所有格式（pdf/docx/xlsx/zip/exe/svg 等）
 * 用户需求：不限制任何格式，binary 分类仅记录元信息即可。
 *
 * 4.5.2：SVG 即使 MIME 是 image/svg+xml 也归类为 binary，
 * 避免作为 image 走压缩 / data URL 路径导致潜在脚本执行。
 *
 * 4.5.3 TODO（保守方案，本次不强制实现）：当前分类仅基于 MIME 与扩展名，
 * 不校验文件 magic number（文件头字节）。攻击者可把可执行文件扩展名改为
 * .png 绕过分类进入 image 处理路径，虽然 image 路径会因 Image decode 失败
 * 返回 failed，但仍是潜在风险点。后续可增加 magic number 校验：
 *   - 读取文件前 16 字节，对照常见格式签名（PNG: 89 50 4E 47、JPEG: FF D8 FF、
 *     PDF: 25 50 44 46、ZIP: 50 4B 03 04 等）
 *   - 与 MIME / 扩展名交叉校验，不一致时归类为 binary 或拒绝
 *   - 需平衡校验开销（FileReader.readAsArrayBuffer 前 N 字节）与用户体验
 * 当前保守策略：依赖 Image decode 失败作为兜底（image 路径）
 * + binary 路径不读取内容（无执行风险）+ 4.5.4 像素上限防 OOM。
 */
export function classifyFile(file: File): AttachmentKind {
  const { type, name } = file;
  // 4.5.2：SVG 强制归类为 binary（即使 MIME 为 image/svg+xml）
  if (type === 'image/svg+xml' || getExtension(name) === 'svg') {
    return 'binary';
  }
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

/** FileReader 读取文件为纯文本
 *
 * 4.5.5 TODO（保守方案，本次不强制实现）：当前直接用 FileReader.readAsText
 * 读取文本，不校验文件编码。FileReader 默认按 UTF-8 解码，遇到非 UTF-8 编码
 * （如 GBK、Shift-JIS、UTF-16）的文本文件会产出乱码或 U+FFFD 替换字符，
 * 不会抛错。乱码文本拼到 LLM 上下文中会浪费 token 且无意义。
 * 后续可增加编码检测：
 *   - 读取前若干字节判断 BOM（UTF-8 BOM: EF BB BF、UTF-16 LE: FF FE、UTF-16 BE: FE FF）
 *   - 无 BOM 时用 TextDecoder 通检测常见编码（UTF-8 / GBK / Shift-JIS）
 *   - 检测失败或乱码率过高（U+FFFD 占比 > 阈值）时返回 failed + 提示用户转码
 * 当前保守策略：依赖 LLM 对乱码的容错性 + 用户在 UI 看到乱码后手动删除附件。
 */
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
 *
 * 5.8.3 注记（保守方案）：当前在主线程执行 canvas 压缩，单张 5MB 图片约阻塞 30-80ms。
 * 大批量导入（10+ 张）可能阻塞 ~500ms+。优化方向：
 *   - 用 createImageBitmap + OffscreenCanvas 在 Web Worker 中异步压缩
 *   - 主线程仅负责文件读取与结果接收，避免阻塞 UI
 *   - 需注意 OffscreenCanvas 兼容性（Chrome/Edge 全支持，Safari 16.4+，Firefox 105+）
 * 当前保守策略：保留主线程实现 + H-13 的体积/数量限制；批量导入时单图串行而非并行，
 * 避免主线程同时承载多个 canvas 操作。批量并行的迁移留待后续。
 * TODO：实现 attachment-worker.ts，把 compressImage 主体搬到 Worker。
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
        // 4.5.4：先校验原图像素总数，超阈值直接拒绝，避免后续 canvas 绘制 OOM
        const originalPixels = img.width * img.height;
        if (originalPixels > MAX_IMAGE_PIXELS) {
          reject(
            new Error(
              `image dimensions ${img.width}x${img.height} (${(originalPixels / 1_000_000).toFixed(1)}MP) exceed max ${MAX_IMAGE_PIXELS / 1_000_000}MP`,
            ),
          );
          return;
        }
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
      // H-13：压缩后仍超过 MAX_IMAGE_SIZE_BYTES 的图片拒绝入库，
      // 避免少量大图填满 localStorage 上限（5-10MB）
      if (dataUrl.length > MAX_IMAGE_SIZE_BYTES) {
        return {
          ...base,
          parseStatus: 'failed',
          parseError: `compressed image size ${formatFileSize(dataUrl.length)} exceeds ${formatFileSize(MAX_IMAGE_SIZE_BYTES)} (try smaller image or lower resolution)`,
        };
      }
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
 *
 * 4.5.1：限制单次批量总数（MAX_ATTACHMENTS_PER_BATCH=20）与并发数（MAX_CONCURRENT_PROCESSING=4）。
 * - 总数超限：超出部分直接返回 failed，避免一次性处理大量文件
 * - 并发限制：用简单的"槽位"模式控制同时处理的文件数，避免主线程卡顿
 */
export async function processFiles(files: FileList | File[]): Promise<NodeAttachment[]> {
  const arr = Array.from(files);
  // 4.5.1：总数上限检测，超出部分直接构造 failed 附件
  const accepted = arr.slice(0, MAX_ATTACHMENTS_PER_BATCH);
  const overflow = arr.slice(MAX_ATTACHMENTS_PER_BATCH);

  // 4.5.1：并发限制处理
  const results: NodeAttachment[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < accepted.length) {
      const idx = cursor++;
      results[idx] = await processFile(accepted[idx]);
    }
  }
  // 启动 MAX_CONCURRENT_PROCESSING 个 worker 并等待全部完成
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(MAX_CONCURRENT_PROCESSING, accepted.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // 4.5.1：超限文件构造 failed 附件
  for (const file of overflow) {
    results.push({
      id: generateAttachmentId(),
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      kind: classifyFile(file),
      parseStatus: 'failed',
      parseError: `attachment count exceeds batch limit ${MAX_ATTACHMENTS_PER_BATCH}`,
    });
  }
  return results;
}

/** 格式化文件大小为人类可读字符串（B/KB/MB） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
