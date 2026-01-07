const { URL } = require('url');
const https = require('https');
const http = require('http');

/**
 * Validate if a string is a valid URL
 */
function validateUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sanitize app name for use in filenames
 */
function sanitizeAppName(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
    .replace(/\s+/g, ' ')          // Normalize whitespace
    .trim()
    .substring(0, 50);             // Limit length
}

/**
 * Generate a unique app ID from URL
 */
function generateAppId(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/\./g, '-');
    const pathPart = url.pathname
      .replace(/\//g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .substring(0, 20);
    
    return `com.webnest.${hostname}${pathPart}`.toLowerCase();
  } catch {
    return `com.webnest.app-${Date.now()}`;
  }
}

/**
 * Fetch page title from URL
 */
function fetchPageTitle(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const protocol = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WebNest/1.0)',
        'Accept': 'text/html',
      },
      timeout: 10000,
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, urlString).href;
        
        fetchPageTitle(redirectUrl)
          .then(resolve)
          .catch(reject);
        return;
      }

      let body = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        body += chunk;
        // Stop reading after we have enough data (title is usually near the top)
        if (body.length > 50000) {
          res.destroy();
        }
      });

      res.on('end', () => {
        // Extract title from HTML
        const titleMatch = body.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          const title = titleMatch[1]
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .trim();
          resolve(title);
        } else {
          resolve(null);
        }
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.end();
  });
}

/**
 * Get app name from URL (tries to fetch page title, falls back to hostname)
 */
async function getAppNameFromUrl(urlString) {
  try {
    const title = await fetchPageTitle(urlString);
    if (title) {
      return sanitizeAppName(title);
    }
  } catch {
    // Failed to fetch title, use hostname
  }

  // Fallback to hostname
  try {
    const url = new URL(urlString);
    let name = url.hostname
      .replace(/^www\./, '')
      .split('.')[0];
    
    // Capitalize first letter
    name = name.charAt(0).toUpperCase() + name.slice(1);
    return name;
  } catch {
    return 'WebApp';
  }
}

/**
 * Get hostname from URL for display purposes
 */
function getHostname(urlString) {
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    return urlString;
  }
}

module.exports = {
  validateUrl,
  sanitizeAppName,
  generateAppId,
  getAppNameFromUrl,
  getHostname,
  fetchPageTitle,
};
