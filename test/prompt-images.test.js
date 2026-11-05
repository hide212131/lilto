const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePrompt } = require('../dist/main/ipc-contract');
const { ConversationHistoryService } = require('../dist/main/conversation-history');
const { mergeSessionMessages } = require('../dist/shared/conversation-message-merge');
const image = { name: 'clip.png', dataUrl: 'data:image/png;base64,aGVsbG8=' };

test('image-only prompts are accepted; invalid and oversized attachments are rejected', () => {
  assert.equal(validatePrompt({ text: '', images: [image] }).ok, true);
  assert.equal(validatePrompt({ text: '', images: [] }).code, 'EMPTY_PROMPT');
  for (const images of [null, [image, image, image, image, image], [{ ...image, dataUrl: 'file:///private/image.png' }], [{ ...image, dataUrl: 'data:image/svg+xml;base64,aGVsbG8=' }], [{ ...image, dataUrl: 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024) }]]) {
    assert.equal(validatePrompt({ text: 'test', images }).code, 'INVALID_REQUEST');
  }
});

test('history hydrates image-only turns and does not expose base64 as message text', async () => {
  const service = new ConversationHistoryService({ workspaceDir: '/workspace' });
  service.createClient = async () => ({ close() {}, async request(method) {
    if (method === 'thread/read') return { thread: { id: 'a', createdAt: 1700000000 } };
    return { data: [{ id: 't', startedAt: 1700000000, items: [
      { id: 'u', type: 'userMessage', content: [{ type: 'image', url: image.dataUrl }] }
    ] }], nextCursor: null, backwardsCursor: null };
  } });
  const history = await service.readConversation('a');
  assert.equal(history.messages.length, 1);
  assert.equal(history.messages[0].text, '');
  assert.equal(history.messages[0].images[0].dataUrl, image.dataUrl);
  const local = { ...history.messages[0], id: 'local', images: [image] };
  assert.equal(mergeSessionMessages(history.messages, [local]).length, 1);
  const different = { ...local, images: [{ ...image, dataUrl: 'data:image/png;base64,d29ybGQ=' }] };
  assert.equal(mergeSessionMessages(history.messages, [different]).length, 2);
});
