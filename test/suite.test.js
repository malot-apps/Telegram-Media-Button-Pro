const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Import units under test
const {
  cleanHtml,
  escapeTelegramHtml,
  extractBloggerImage,
  normalizeUrl
} = require('../src/blogger');

const {
  db,
  resolveDirectUrl,
  sanitizeDatabaseUrls,
  buttonsSafe,
  keyboard,
  bloggerKeyboard,
  isPostPublished,
  markPostAsPublished
} = require('../src/index');

test('DIRECT URLS: buttonsSafe and keyboard generate direct destination URLs', () => {
  const inputButtons = [
    { text: 'Official Website', url: 'https://example.com/portal', row: 0 },
    { text: 'Telegram Group', url: 'https://t.me/mygroup', row: 1 },
    { text: 'Invalid Item', url: 'javascript:alert(1)', row: 0 },
    { text: '', url: 'https://empty-label.com', row: 0 }
  ];

  const safe = buttonsSafe(inputButtons);
  assert.equal(safe.length, 2, 'Only valid HTTPS items with text must be kept');
  assert.equal(safe[0].url, 'https://example.com/portal');
  assert.equal(safe[1].url, 'https://t.me/mygroup');

  const kb = keyboard(safe);
  assert.ok(kb && kb.reply_markup && kb.reply_markup.inline_keyboard, 'Inline keyboard must be created');
  const rows = kb.reply_markup.inline_keyboard;
  assert.equal(rows.length, 2, 'Two rows expected');
  assert.equal(rows[0][0].url, 'https://example.com/portal', 'Must be direct URL without any /r/ prefix');
  assert.equal(rows[1][0].url, 'https://t.me/mygroup', 'Must be direct URL without any /r/ prefix');
  assert.ok(!rows[0][0].url.includes('/r/'), 'Must not contain /r/ redirect');
  assert.ok(!rows[1][0].url.includes('/r/'), 'Must not contain /r/ redirect');
});

test('DIRECT URLS: bloggerKeyboard generates direct post link and direct fixed buttons', () => {
  const post = {
    id: 'tag:blogger.com,1999:blog-1.post-12345',
    title: 'Breaking Tech News',
    link: 'https://mycoolblog.blogspot.com/2026/10/breaking-tech-news.html',
    summary: 'A short overview of the news.'
  };

  const fixedButtons = [
    { text: '📢 Official Channel', url: 'https://t.me/techchannel', row: 1 },
    { text: '🌐 Main Website', url: 'https://techsite.org', row: 1 }
  ];

  const kb = bloggerKeyboard(post, fixedButtons, '📖 Read Full Story');
  assert.ok(kb && kb.reply_markup && kb.reply_markup.inline_keyboard);
  const rows = kb.reply_markup.inline_keyboard;

  // Row 0: Dynamic Article Button
  assert.equal(rows[0][0].text, '📖 Read Full Story');
  assert.equal(rows[0][0].url, 'https://mycoolblog.blogspot.com/2026/10/breaking-tech-news.html');
  assert.ok(!rows[0][0].url.includes('/r/'), 'Dynamic button must link directly to the post without /r/');

  // Row 1: Fixed Buttons
  assert.equal(rows[1].length, 2);
  assert.equal(rows[1][0].text, '📢 Official Channel');
  assert.equal(rows[1][0].url, 'https://t.me/techchannel');
  assert.equal(rows[1][1].text, '🌐 Main Website');
  assert.equal(rows[1][1].url, 'https://techsite.org');
});

test('LEGACY MIGRATION: resolveDirectUrl unwraps legacy redirect URLs safely', () => {
  // Seed mock clicks store
  db.clicks = db.clicks || {};
  db.clicks['test-uuid-1'] = {
    id: 'test-uuid-1',
    label: 'Old Redirect Link',
    target: 'https://original-destination.com/article'
  };

  // Case 1: Legacy Render /r/ tracking URL
  const legacyUrl = 'https://my-service.onrender.com/r/test-uuid-1';
  const unwrapped = resolveDirectUrl(legacyUrl);
  assert.equal(unwrapped, 'https://original-destination.com/article', 'Should resolve back to the original destination URL');

  // Case 2: Clean direct destination URL remains untouched
  const cleanUrl = 'https://github.com/torvalds/linux';
  assert.equal(resolveDirectUrl(cleanUrl), cleanUrl, 'Direct URLs must not be modified');

  // Case 3: Empty or invalid input
  assert.equal(resolveDirectUrl(null), '');
  assert.equal(resolveDirectUrl(''), '');
});

test('LEGACY MIGRATION: sanitizeDatabaseUrls cleans legacy templates, schedules, and fixed buttons', () => {
  db.clicks = db.clicks || {};
  db.clicks['redirect-abc'] = { id: 'redirect-abc', target: 'https://clean-site.org/home' };

  db.templates = {
    'tpl-1': {
      id: 'tpl-1',
      name: 'Old Template',
      buttons: [
        { text: 'Click Here', url: 'https://service.onrender.com/r/redirect-abc', row: 0 },
        { text: 'Already Direct', url: 'https://direct-site.com', row: 0 }
      ]
    }
  };

  db.schedules = {
    'sch-1': {
      id: 'sch-1',
      type: 'photo',
      file_id: 'AgACtest',
      buttons: [
        { text: 'Visit', url: 'http://localhost:3000/r/redirect-abc', row: 0 }
      ]
    }
  };

  db.blogger = db.blogger || {};
  db.blogger.fixedButtons = [
    { text: 'Old Button', url: 'https://my-app.onrender.com/r/redirect-abc', row: 1 }
  ];

  sanitizeDatabaseUrls();

  assert.equal(db.templates['tpl-1'].buttons[0].url, 'https://clean-site.org/home', 'Template button URL must be cleaned');
  assert.equal(db.templates['tpl-1'].buttons[1].url, 'https://direct-site.com', 'Clean URL must remain unchanged');
  assert.equal(db.schedules['sch-1'].buttons[0].url, 'https://clean-site.org/home', 'Scheduled button URL must be cleaned');
  assert.equal(db.blogger.fixedButtons[0].url, 'https://clean-site.org/home', 'Blogger fixed button URL must be cleaned');
});

test('BLOGGER PARSER: cleanHtml strips scripts, styles, HTML tags and decodes entities', () => {
  const dirtyHtml = `
    <style>.hide { display: none; }</style>
    <script>alert("hack");</script>
    <p>Welcome to <b>Google AI</b> &amp; technology updates!</p>
    <div>Read more about &quot;Quantum Computing&quot; &#8217;s latest milestones &hellip;</div>
  `;

  const cleaned = cleanHtml(dirtyHtml, 200);
  assert.ok(!cleaned.includes('<style>'), 'Style block must be removed');
  assert.ok(!cleaned.includes('<script>'), 'Script block must be removed');
  assert.ok(!cleaned.includes('<b>'), 'Tags must be stripped');
  assert.ok(cleaned.includes('& technology'), '&amp; must be decoded to &');
  assert.ok(cleaned.includes('"Quantum Computing"'), '&quot; must be decoded to "');
  assert.ok(cleaned.includes("latest milestones"), 'Entities decoded cleanly');
});

test('BLOGGER PARSER: extractBloggerImage extracts and upgrades thumbnails to high-res /s1600/', () => {
  // Case 1: Blogger JSON media$thumbnail with /s72-c/
  const entry1 = {
    media$thumbnail: {
      url: 'https://blogger.googleusercontent.com/img/b/test/s72-c/photo.jpg'
    }
  };
  const img1 = extractBloggerImage(entry1);
  assert.equal(img1, 'https://blogger.googleusercontent.com/img/b/test/s1600/photo.jpg', 'Should upgrade /s72-c/ to /s1600/');

  // Case 2: Blogger thumbnail with w72-h72
  const entry2 = {
    media$thumbnail: {
      url: 'https://blogger.googleusercontent.com/img/b/test/w72-h72-p-k-no-nu/photo.png'
    }
  };
  const img2 = extractBloggerImage(entry2);
  assert.equal(img2, 'https://blogger.googleusercontent.com/img/b/test/s1600/photo.png', 'Should upgrade w72-h72 to /s1600/');

  // Case 3: Lead <img> in HTML content
  const entry3 = {
    content: {
      $t: '<p>Some text</p><img src="https://blogger.googleusercontent.com/img/b/abc/s320/lead.jpg" alt="lead" />'
    }
  };
  const img3 = extractBloggerImage(entry3);
  assert.equal(img3, 'https://blogger.googleusercontent.com/img/b/abc/s1600/lead.jpg', 'HTML img should be upgraded to /s1600/');

  // Case 4: No image present
  const entry4 = { content: { $t: '<p>Only text without images</p>' } };
  assert.equal(extractBloggerImage(entry4), null, 'Must return null when no image exists');
});

test('BLOGGER PARSER: normalizeUrl formats clean HTTPS URLs', () => {
  assert.equal(normalizeUrl('myblog.blogspot.com'), 'https://myblog.blogspot.com');
  assert.equal(normalizeUrl('https://myblog.blogspot.com/'), 'https://myblog.blogspot.com');
  assert.equal(normalizeUrl('http://mycustomdomain.com///'), 'http://mycustomdomain.com');
});

test('DUPLICATE PREVENTION: isPostPublished detects posts by ID or link and prevents duplicates', () => {
  db.blogger = db.blogger || {};
  db.blogger.publishedIds = [];

  const postA = {
    id: 'tag:blogger.com,1999:blog-1.post-100',
    link: 'https://myblog.blogspot.com/2026/10/post-100.html'
  };
  const postB = {
    id: 'tag:blogger.com,1999:blog-1.post-200',
    link: 'https://myblog.blogspot.com/2026/10/post-200.html'
  };

  assert.equal(isPostPublished(postA), false, 'New post must not be marked as published');
  markPostAsPublished(postA);
  assert.equal(isPostPublished(postA), true, 'Post A must now be marked as published');

  // Verify duplicate check works with only link or only id
  assert.equal(isPostPublished({ id: 'tag:blogger.com,1999:blog-1.post-100' }), true, 'Recognized by ID');
  assert.equal(isPostPublished({ link: 'https://myblog.blogspot.com/2026/10/post-100.html' }), true, 'Recognized by link');
  assert.equal(isPostPublished(postB), false, 'Post B is still unpublished');
});

test('TELEGRAM FORMATTING: escapeTelegramHtml safely escapes HTML special characters', () => {
  const unsafe = 'Check out <Python> & "JavaScript" > C++';
  const escaped = escapeTelegramHtml(unsafe);
  assert.equal(escaped, 'Check out &lt;Python&gt; &amp; "JavaScript" &gt; C++');
  assert.ok(!escaped.includes('<Python>'));
});
