import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// Accept pixels only, never a client-supplied local path or remote URL.
export function validateImages(images = []) {
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(`每次最多发送 ${MAX_IMAGES} 张图片。`);
  return images.map((image, index) => {
    if (!image || typeof image.b64 !== 'string' || image.b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || image.b64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.b64)) throw new Error('图片数据无效或过大，请重新框选。');
    const buffer = Buffer.from(image.b64, 'base64');
    const png = buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    if ((!png && !jpeg) || image.mime !== (png ? 'image/png' : 'image/jpeg') || !buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new Error('仅支持有效的 PNG / JPEG 图片。');
    if (png && (!buffer.readUInt32BE(16) || !buffer.readUInt32BE(20) || buffer.readUInt32BE(16) > 4096 || buffer.readUInt32BE(20) > 4096)) throw new Error('图片尺寸超出限制，请缩小框选范围。');
    return { buffer, b64: buffer.toString('base64'), mime: image.mime, name: String(image.name || `图片 ${index + 1}`).slice(0, 120) };
  });
}

export function claudeImageInput(prompt, images) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [
    ...images.flatMap((image, index) => [
      { type: 'text', text: `图片 ${index + 1}：${image.name}` },
      { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.b64 } },
    ]), { type: 'text', text: prompt },
  ] } }) + '\n';
}

export async function writeImages(images, directory) {
  return Promise.all(images.map(async (image, index) => {
    const filename = path.join(directory, `image-${index + 1}.${image.mime === 'image/png' ? 'png' : 'jpg'}`);
    await writeFile(filename, image.buffer, { mode: 0o600 });
    return filename;
  }));
}
