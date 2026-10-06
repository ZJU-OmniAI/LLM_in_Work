import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImages, claudeImageInput, MAX_IMAGE_BYTES } from '../server/images.js';

const image = { name: 'PDF 第 2 页截图', mime: 'image/png', b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };

test('image input accepts bounded pixels and rejects paths, malformed or oversized payloads', () => {
  assert.equal(validateImages([image])[0].b64, image.b64);
  assert.deepEqual(validateImages(), []);
  for (const invalid of [null, {}, [null], [{ path: '/tmp/image.png' }], [{ ...image, mime: 'image/jpeg' }], [{ ...image, b64: '<svg>script</svg>' }], Array(5).fill(image), [{ ...image, b64: 'a'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 4) }]]) {
    assert.throws(() => validateImages(invalid));
  }
  const huge = Buffer.from(image.b64, 'base64'); huge.writeUInt32BE(50000, 16);
  assert.throws(() => validateImages([{ ...image, b64: huge.toString('base64') }]), /尺寸/);
});

test('Claude multimodal stdin preserves prompt and sends base64 image blocks in order', () => {
  const input = claudeImageInput('解释两张图', validateImages([image, { ...image, name: '第二张图' }]));
  assert.equal(input.split('\n').length, 2);
  const message = JSON.parse(input).message;
  assert.equal(message.role, 'user');
  assert.deepEqual(message.content.map((item) => item.type), ['text', 'image', 'text', 'image', 'text']);
  assert.equal(message.content[1].source.data, image.b64);
  assert.equal(message.content[1].source.media_type, 'image/png');
  assert.equal(message.content.at(-1).text, '解释两张图');
});
