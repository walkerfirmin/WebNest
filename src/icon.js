const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { promisify } = require('util');
const { exec } = require('child_process');

const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);
const execAsync = promisify(exec);

/**
 * Fetch data from a URL with redirect support
 */
function fetchUrl(urlString, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const protocol = url.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': options.accept || '*/*',
      },
      timeout: 15000,
    };

    const req = protocol.request(reqOptions, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, urlString).href;
        
        fetchUrl(redirectUrl, options)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          data: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || '',
        });
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
 * Parse HTML to find icon links
 */
function parseIconLinks(html, baseUrl) {
  const icons = [];
  
  // Match link tags with rel containing "icon"
  const linkRegex = /<link[^>]*>/gi;
  const matches = html.match(linkRegex) || [];

  for (const link of matches) {
    // Check if it's an icon link
    const relMatch = link.match(/rel=["']([^"']+)["']/i);
    if (!relMatch) continue;
    
    const rel = relMatch[1].toLowerCase();
    if (!rel.includes('icon')) continue;

    // Get href
    const hrefMatch = link.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;

    let href = hrefMatch[1];
    
    // Make absolute URL
    if (!href.startsWith('http')) {
      href = new URL(href, baseUrl).href;
    }

    // Get sizes if available
    const sizesMatch = link.match(/sizes=["']([^"']+)["']/i);
    let size = 0;
    if (sizesMatch) {
      const sizeStr = sizesMatch[1].split('x')[0];
      size = parseInt(sizeStr, 10) || 0;
    }

    // Get type if available
    const typeMatch = link.match(/type=["']([^"']+)["']/i);
    const type = typeMatch ? typeMatch[1] : '';

    // Prioritize apple-touch-icon (usually highest quality)
    const isAppleIcon = rel.includes('apple-touch-icon');
    
    icons.push({
      href,
      size,
      type,
      isAppleIcon,
      priority: isAppleIcon ? size + 1000 : size,
    });
  }

  // Also check for manifest
  const manifestMatch = html.match(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']/i);
  if (manifestMatch) {
    let manifestUrl = manifestMatch[1];
    if (!manifestUrl.startsWith('http')) {
      manifestUrl = new URL(manifestUrl, baseUrl).href;
    }
    return { icons, manifestUrl };
  }

  return { icons, manifestUrl: null };
}

/**
 * Parse web app manifest for icons
 */
async function parseManifest(manifestUrl) {
  try {
    const { data } = await fetchUrl(manifestUrl, { accept: 'application/json' });
    const manifest = JSON.parse(data.toString());
    
    if (!manifest.icons || !Array.isArray(manifest.icons)) {
      return [];
    }

    const baseUrl = new URL(manifestUrl);
    
    return manifest.icons.map(icon => {
      let href = icon.src;
      if (!href.startsWith('http')) {
        href = new URL(href, baseUrl).href;
      }

      // Parse size
      let size = 0;
      if (icon.sizes) {
        const sizeStr = icon.sizes.split('x')[0];
        size = parseInt(sizeStr, 10) || 0;
      }

      return {
        href,
        size,
        type: icon.type || '',
        purpose: icon.purpose || 'any',
        priority: size,
      };
    });
  } catch (error) {
    return [];
  }
}

/**
 * Get the best icon URL from a website
 */
async function getBestIconUrl(websiteUrl) {
  try {
    // Fetch the page HTML
    const { data } = await fetchUrl(websiteUrl, { accept: 'text/html' });
    const html = data.toString();

    // Parse icon links from HTML
    const { icons: htmlIcons, manifestUrl } = parseIconLinks(html, websiteUrl);

    // Try to get icons from manifest
    let manifestIcons = [];
    if (manifestUrl) {
      manifestIcons = await parseManifest(manifestUrl);
    }

    // Combine all icons
    const allIcons = [...htmlIcons, ...manifestIcons];

    // Sort by priority (size, with apple-touch-icon getting bonus)
    allIcons.sort((a, b) => b.priority - a.priority);

    // Return the best icon, or fallback to favicon.ico
    if (allIcons.length > 0) {
      return allIcons[0].href;
    }

    // Fallback to standard favicon.ico
    const url = new URL(websiteUrl);
    return `${url.protocol}//${url.hostname}/favicon.ico`;
  } catch (error) {
    // Fallback to favicon.ico
    const url = new URL(websiteUrl);
    return `${url.protocol}//${url.hostname}/favicon.ico`;
  }
}

/**
 * Download icon to a temporary location
 */
async function downloadIcon(iconUrl, tempDir) {
  try {
    const { data, contentType } = await fetchUrl(iconUrl);
    
    // Determine extension from content type or URL
    let ext = '.png';
    if (contentType.includes('svg')) {
      ext = '.svg';
    } else if (contentType.includes('ico') || iconUrl.endsWith('.ico')) {
      ext = '.ico';
    } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
      ext = '.jpg';
    } else if (iconUrl.endsWith('.svg')) {
      ext = '.svg';
    }

    await mkdirAsync(tempDir, { recursive: true });
    const iconPath = path.join(tempDir, `icon${ext}`);
    await writeFileAsync(iconPath, data);

    return {
      success: true,
      path: iconPath,
      extension: ext,
      size: data.length,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Convert icon to macOS .icns format using sips and iconutil
 */
async function convertToIcns(inputPath, outputPath) {
  const tempDir = path.join(path.dirname(outputPath), 'icon.iconset');
  
  try {
    await mkdirAsync(tempDir, { recursive: true });
    
    // Required sizes for iconset
    const sizes = [16, 32, 64, 128, 256, 512];
    
    for (const size of sizes) {
      const size2x = size * 2;
      
      // Standard resolution
      await execAsync(
        `sips -z ${size} ${size} "${inputPath}" --out "${path.join(tempDir, `icon_${size}x${size}.png`)}" 2>/dev/null`
      );
      
      // Retina resolution (if not exceeding 1024)
      if (size2x <= 1024) {
        await execAsync(
          `sips -z ${size2x} ${size2x} "${inputPath}" --out "${path.join(tempDir, `icon_${size}x${size}@2x.png`)}" 2>/dev/null`
        );
      }
    }
    
    // Convert iconset to icns
    await execAsync(`iconutil -c icns "${tempDir}" -o "${outputPath}"`);
    
    // Clean up iconset directory
    await execAsync(`rm -rf "${tempDir}"`);
    
    return { success: true, path: outputPath };
  } catch (error) {
    // Clean up on error
    try {
      await execAsync(`rm -rf "${tempDir}"`);
    } catch {}
    
    return { success: false, error: error.message };
  }
}

/**
 * Convert icon to Windows .ico format
 * Uses ImageMagick if available, otherwise keeps as PNG
 */
async function convertToIco(inputPath, outputPath) {
  try {
    // Check if ImageMagick is available
    await execAsync('which convert');
    
    // Convert to ICO with multiple sizes
    await execAsync(
      `convert "${inputPath}" -define icon:auto-resize=256,128,64,48,32,16 "${outputPath}"`
    );
    
    return { success: true, path: outputPath };
  } catch {
    // ImageMagick not available, copy as-is or use PNG
    try {
      fs.copyFileSync(inputPath, outputPath.replace('.ico', '.png'));
      return { success: true, path: outputPath.replace('.ico', '.png'), note: 'Saved as PNG (ImageMagick not available for ICO conversion)' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

/**
 * Prepare icon for the target platform
 */
async function prepareIcon(websiteUrl, outputDir, platform) {
  // Get best icon URL
  const iconUrl = await getBestIconUrl(websiteUrl);
  
  // Download the icon
  const tempDir = path.join(outputDir, '.icon-temp');
  const downloaded = await downloadIcon(iconUrl, tempDir);
  
  if (!downloaded.success) {
    return { success: false, error: `Failed to download icon: ${downloaded.error}` };
  }

  let result;
  
  switch (platform) {
    case 'darwin': {
      // Convert to .icns for macOS
      const icnsPath = path.join(outputDir, 'AppIcon.icns');
      
      // If it's SVG, we need to convert to PNG first
      if (downloaded.extension === '.svg') {
        try {
          const pngPath = path.join(tempDir, 'icon.png');
          // Try using qlmanage or sips for SVG conversion
          await execAsync(`qlmanage -t -s 1024 -o "${tempDir}" "${downloaded.path}" 2>/dev/null || sips -s format png "${downloaded.path}" --out "${pngPath}" 2>/dev/null`);
          downloaded.path = pngPath;
        } catch {
          // SVG conversion failed, try anyway
        }
      }
      
      result = await convertToIcns(downloaded.path, icnsPath);
      break;
    }
    
    case 'win32': {
      // Convert to .ico for Windows
      const icoPath = path.join(outputDir, 'app.ico');
      result = await convertToIco(downloaded.path, icoPath);
      break;
    }
    
    case 'linux': {
      // Use PNG for Linux
      const pngPath = path.join(outputDir, 'icon.png');
      
      if (downloaded.extension === '.png') {
        fs.copyFileSync(downloaded.path, pngPath);
        result = { success: true, path: pngPath };
      } else {
        // Try to convert to PNG using sips or ImageMagick
        try {
          await execAsync(`sips -s format png "${downloaded.path}" --out "${pngPath}" 2>/dev/null || convert "${downloaded.path}" "${pngPath}"`);
          result = { success: true, path: pngPath };
        } catch {
          // Just copy as-is
          fs.copyFileSync(downloaded.path, pngPath);
          result = { success: true, path: pngPath };
        }
      }
      break;
    }
    
    default:
      result = { success: false, error: `Unsupported platform: ${platform}` };
  }

  // Clean up temp directory
  try {
    await execAsync(`rm -rf "${tempDir}"`);
  } catch {}

  return result;
}

module.exports = {
  getBestIconUrl,
  downloadIcon,
  prepareIcon,
  convertToIcns,
  convertToIco,
};
