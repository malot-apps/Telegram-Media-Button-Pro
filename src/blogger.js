const Parser = require('rss-parser');

const rssParser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; TelegramBloggerAutoPublisher/3.0; +https://telegram.org)'
  },
  timeout: 12000
});

/**
 * Strips HTML tags, removes styles/scripts, decodes common entities and trims text.
 */
function cleanHtml(rawHtml = '', maxLength = 300) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let text = rawHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&hellip;/gi, '...')
    .replace(/&#8217;/gi, "'")
    .replace(/&#8220;/gi, '"')
    .replace(/&#8221;/gi, '"')
    .replace(/&#8211;/gi, '-')
    .replace(/&#8212;/gi, '--')
    .replace(/\s+/g, ' ')
    .trim();

  if (maxLength && text.length > maxLength) {
    text = text.slice(0, maxLength).trim() + '...';
  }
  return text;
}

/**
 * Escapes characters for Telegram HTML parse_mode: <, >, &
 */
function escapeTelegramHtml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extracts the highest resolution image URL from Blogger entry or HTML snippet.
 */
function extractBloggerImage(entry = {}, contentHtml = '') {
  // Check media$thumbnail
  if (entry.media$thumbnail && entry.media$thumbnail.url) {
    let thumb = entry.media$thumbnail.url;
    // Upgrade low-res thumbnail (/s72-c/, /w72-h72-p-k-no-nu/, /s72-w.../) to full high-res /s1600/
    thumb = thumb
      .replace(/\/s[0-9]+(-[a-zA-Z0-9_-]+)?\//, '/s1600/')
      .replace(/\/w[0-9]+-h[0-9]+[^/]*\//, '/s1600/');
    if (/^https?:\/\//i.test(thumb)) {
      return thumb;
    }
  }

  // Check enclosures or media
  if (entry.enclosure && entry.enclosure.url && /^https?:\/\//i.test(entry.enclosure.url)) {
    return entry.enclosure.url;
  }

  // Scan HTML content for first image
  const htmlToSearch = (entry.content && entry.content.$t) || contentHtml || (typeof entry.content === 'string' ? entry.content : '') || '';
  const match = htmlToSearch.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]+)["']/i);
  if (match && match[1]) {
    // If it's a blogger image with small size tag, upgrade it
    let img = match[1];
    img = img
      .replace(/\/s[0-9]+(-[a-zA-Z0-9_-]+)?\//, '/s1600/')
      .replace(/\/w[0-9]+-h[0-9]+[^/]*\//, '/s1600/');
    return img;
  }

  return null;
}

/**
 * Normalizes a user-entered blog or feed URL.
 */
function normalizeUrl(rawUrl = '') {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  return url.replace(/\/+$/, '');
}

/**
 * Fetches and parses a Blogger feed via JSON API or standard RSS/Atom fallback.
 */
async function fetchBloggerFeed(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Blogger URL is required');
  }

  const base = normalizeUrl(rawUrl);

  // Determine potential JSON feed URL
  let jsonFeedUrl = '';
  if (base.includes('/feeds/posts/default')) {
    jsonFeedUrl = base.includes('?') ? (base.includes('alt=json') ? base : `${base}&alt=json`) : `${base}?alt=json`;
  } else {
    jsonFeedUrl = `${base}/feeds/posts/default?alt=json&max-results=15`;
  }

  // Try Blogger JSON feed first
  try {
    const res = await fetch(jsonFeedUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; TelegramBloggerAutoPublisher/3.0)'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.feed) {
        const feedTitle = data.feed.title?.$t || 'Blogger Feed';
        const entries = Array.isArray(data.feed.entry) ? data.feed.entry : [];

        const items = entries.map(e => {
          const id = e.id?.$t || '';
          const title = e.title?.$t || 'Untitled Post';
          const altLink = (e.link || []).find(l => l.rel === 'alternate') || e.link?.[0];
          const link = altLink?.href || '';
          const published = e.published?.$t || e.updated?.$t || new Date().toISOString();
          const contentHtml = e.content?.$t || e.summary?.$t || '';
          const summary = cleanHtml(contentHtml, 320);
          const imageUrl = extractBloggerImage(e, contentHtml);

          return {
            id: id || link,
            title: title.trim(),
            link: link.trim(),
            published,
            summary,
            imageUrl
          };
        }).filter(it => it.link);

        return {
          source: 'Blogger JSON API',
          blogTitle: feedTitle,
          feedUrl: jsonFeedUrl,
          items
        };
      }
    }
  } catch (jsonErr) {
    // Continue to RSS fallback
    console.log('[Blogger Parser] JSON feed attempt failed, falling back to RSS:', jsonErr.message);
  }

  // Fallback 1: Standard RSS URL
  const rssCandidates = [
    base.includes('/feeds/') ? base : `${base}/feeds/posts/default?alt=rss`,
    base.includes('/feeds/') ? base : `${base}/feeds/posts/default`,
    base
  ];

  let lastError = null;
  for (const candidate of rssCandidates) {
    try {
      const feed = await rssParser.parseURL(candidate);
      if (feed && Array.isArray(feed.items) && feed.items.length) {
        const items = feed.items.map(item => {
          const link = (item.link || item.guid || '').trim();
          const id = item.id || item.guid || link;
          const title = (item.title || 'Untitled Post').trim();
          const contentHtml = item.content || item['content:encoded'] || item.summary || item.contentSnippet || '';
          const summary = cleanHtml(contentHtml, 320);
          const imageUrl = extractBloggerImage(item, contentHtml);

          return {
            id,
            title,
            link,
            published: item.pubDate || item.isoDate || new Date().toISOString(),
            summary,
            imageUrl
          };
        }).filter(it => it.link);

        return {
          source: 'RSS/Atom Parser',
          blogTitle: feed.title || 'Blogger Feed',
          feedUrl: candidate,
          items
        };
      }
    } catch (rssErr) {
      lastError = rssErr;
    }
  }

  throw new Error(`Could not fetch Blogger feed from "${rawUrl}": ${lastError ? lastError.message : 'Unknown feed format'}`);
}

module.exports = {
  fetchBloggerFeed,
  cleanHtml,
  escapeTelegramHtml,
  extractBloggerImage,
  normalizeUrl
};
