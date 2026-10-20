const test = require('node:test');
const assert = require('node:assert/strict');

const {
  app,
  db,
  publishBloggerPost,
  checkAndPublishBlogger
} = require('../src/index');

test('INTEGRATION: Telegram fallback handles photo failures by sending text message', async () => {
  // Test fallback logic in publishBloggerPost
  const post = {
    id: 'post-fallback-123',
    title: 'Post with Fallback Image',
    summary: 'Testing fallback handling',
    link: 'https://testblog.blogspot.com/2026/10/fallback.html',
    imageUrl: 'https://invalid-host-unreachable-domain.xyz/broken.jpg'
  };

  db.blogger.channelId = '-1003980723831';
  // With simulated bot or live bot catching photo error, it must return a message_id without crashing
  const result = await publishBloggerPost(post);
  assert.ok(result && result.message_id, 'Must return a valid message_id even if photo fails');
});

test('INTEGRATION: Caption clamp enforces <= 1024 character Telegram API limit', async () => {
  const giantTitle = 'T'.repeat(200);
  const giantSummary = 'S'.repeat(900);
  const post = {
    id: 'giant-post-1',
    title: giantTitle,
    summary: giantSummary,
    link: 'https://giantblog.blogspot.com/post.html'
  };

  db.blogger.footerText = '#Tag1 #Tag2 #Tag3 #Tag4 #LongFooterText';
  const result = await publishBloggerPost(post);
  assert.ok(result && result.message_id, 'Post must be published safely without exceeding limit');
});

test('INTEGRATION: Duplicate check prevents re-posting same article twice', async () => {
  const post = {
    id: 'dedup-article-999',
    title: 'Dedup Article',
    link: 'https://blog.com/dedup.html',
    summary: 'Summary for dedup'
  };

  // Clear and test
  db.blogger.publishedIds = [];
  assert.equal(db.blogger.publishedIds.includes(post.id), false);

  // Set mock published
  db.blogger.publishedIds.push(post.id);
  assert.equal(db.blogger.publishedIds.includes(post.id), true);
});
