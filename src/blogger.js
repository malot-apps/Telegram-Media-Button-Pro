const Parser = require('rss-parser');

const rssParser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; TelegramBloggerAutoPublisher/3.1; +https://telegram.org)'
  },
  timeout: 12000
});

/**
 * Strips HTML tags, removes styles/scripts, decodes common entities and trims text neatly.
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
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '--')
    .replace(/\s+/g, ' ')
    .trim();

  if (maxLength && text.length > maxLength) {
    const cut = text.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.7) {
      text = cut.slice(0, lastSpace).trim() + '...';
    } else {
      text = cut.trim() + '...';
    }
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
 * Extracts and upgrades the highest resolution image URL from Blogger entry or HTML snippet.
 */
function extractBloggerImage(entry = {}, contentHtml = '') {
  // 1. Check media$thumbnail (Blogger JSON)
  if (entry.media$thumbnail && entry.media$thumbnail.url) {
    let thumb = String(entry.media$thumbnail.url).replace(/&amp;/g, '&');
    thumb = thumb
      .replace(/\/s[0-9]+(-[a-zA-Z0-9_-]+)?\//, '/s1600/')
      .replace(/\/w[0-9]+-h[0-9]+[^/]*\//, '/s1600/');
    if (/^https?:\/\//i.test(thumb)) {
      return thumb;
    }
  }

  // 2. Check RSS media:thumbnail or thumbnail property
  const mediaThumb = entry['media:thumbnail']?.$?.url || entry['media:content']?.$?.url || entry.thumbnail;
  if (mediaThumb && /^https?:\/\//i.test(mediaThumb)) {
    let thumb = String(mediaThumb).replace(/&amp;/g, '&')
      .replace(/\/s[0-9]+(-[a-zA-Z0-9_-]+)?\//, '/s1600/')
      .replace(/\/w[0-9]+-h[0-9]+[^/]*\//, '/s1600/');
    return thumb;
  }

  // 3. Check enclosures
  if (entry.enclosure && entry.enclosure.url && /^https?:\/\//i.test(entry.enclosure.url)) {
    return entry.enclosure.url;
  }

  // 4. Scan HTML content for first <img> tag
  const htmlToSearch = (entry.content && entry.content.$t) || contentHtml || (typeof entry.content === 'string' ? entry.content : '') || '';
  const match = htmlToSearch.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]+)["']/i);
  if (match && match[1]) {
    let img = match[1].replace(/&amp;/g, '&');
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
        'User-Agent': 'Mozilla/5.0 (compatible; TelegramBloggerAutoPublisher/3.1)'
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
    console.log('[Blogger Parser] JSON feed attempt failed, falling back to RSS:', jsonErr.message);
  }

  // Fallback: Standard RSS/Atom URLs
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
