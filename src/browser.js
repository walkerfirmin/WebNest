const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Browser configurations for each platform
const BROWSER_CONFIGS = {
  chrome: {
    name: 'Google Chrome',
    id: 'chrome',
    paths: {
      darwin: [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ],
      win32: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      ],
      linux: [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ],
    },
    appFlag: '--app=',
    profileDir: {
      darwin: '~/Library/Application Support/Google/Chrome',
      win32: `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data`,
      linux: '~/.config/google-chrome',
    },
  },
  edge: {
    name: 'Microsoft Edge',
    id: 'edge',
    paths: {
      darwin: [
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ],
      win32: [
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ],
      linux: [
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/opt/microsoft/msedge/msedge',
      ],
    },
    appFlag: '--app=',
    profileDir: {
      darwin: '~/Library/Application Support/Microsoft Edge',
      win32: `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data`,
      linux: '~/.config/microsoft-edge',
    },
  },
  brave: {
    name: 'Brave Browser',
    id: 'brave',
    paths: {
      darwin: [
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      ],
      win32: [
        'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
      ],
      linux: [
        '/usr/bin/brave',
        '/usr/bin/brave-browser',
        '/snap/bin/brave',
        '/opt/brave.com/brave/brave',
      ],
    },
    appFlag: '--app=',
    profileDir: {
      darwin: '~/Library/Application Support/BraveSoftware/Brave-Browser',
      win32: `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\User Data`,
      linux: '~/.config/BraveSoftware/Brave-Browser',
    },
  },
  chromium: {
    name: 'Chromium',
    id: 'chromium',
    paths: {
      darwin: [
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ],
      win32: [
        'C:\\Program Files\\Chromium\\Application\\chrome.exe',
        `${process.env.LOCALAPPDATA}\\Chromium\\Application\\chrome.exe`,
      ],
      linux: [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
      ],
    },
    appFlag: '--app=',
    profileDir: {
      darwin: '~/Library/Application Support/Chromium',
      win32: `${process.env.LOCALAPPDATA}\\Chromium\\User Data`,
      linux: '~/.config/chromium',
    },
  },
  comet: {
    name: 'Comet Browser',
    id: 'comet',
    paths: {
      darwin: [
        '/Applications/Comet.app/Contents/MacOS/Comet',
        '/Applications/Comet Browser.app/Contents/MacOS/Comet Browser',
      ],
      win32: [
        'C:\\Program Files\\Comet\\Application\\comet.exe',
        'C:\\Program Files (x86)\\Comet\\Application\\comet.exe',
        `${process.env.LOCALAPPDATA}\\Comet\\Application\\comet.exe`,
        'C:\\Program Files\\Comet Browser\\Application\\comet.exe',
        `${process.env.LOCALAPPDATA}\\Comet Browser\\Application\\comet.exe`,
      ],
      linux: [
        '/usr/bin/comet',
        '/usr/bin/comet-browser',
        '/opt/comet/comet',
        '/snap/bin/comet',
      ],
    },
    appFlag: '--app=',
    profileDir: {
      darwin: '~/Library/Application Support/Comet',
      win32: `${process.env.LOCALAPPDATA}\\Comet\\User Data`,
      linux: '~/.config/comet',
    },
  },
  atlas: {
    name: 'Atlas Browser',
    id: 'atlas',
    paths: {
      darwin: [
        '/Applications/Atlas.app/Contents/MacOS/Atlas',
        '/Applications/Atlas Browser.app/Contents/MacOS/Atlas Browser',
      ],
      win32: [
        'C:\\Program Files\\Atlas\\Application\\atlas.exe',
        'C:\\Program Files (x86)\\Atlas\\Application\\atlas.exe',
        `${process.env.LOCALAPPDATA}\\Atlas\\Application\\atlas.exe`,
        'C:\\Program Files\\Atlas Browser\\Application\\atlas.exe',
        `${process.env.LOCALAPPDATA}\\Atlas Browser\\Application\\atlas.exe`,
      ],
      linux: [
        '/usr/bin/atlas',
        '/usr/bin/atlas-browser',
        '/opt/atlas/atlas',
        '/snap/bin/atlas',
      ],
    },
    appFlag: '--app=',
    profileDir: {
      darwin: '~/Library/Application Support/Atlas',
      win32: `${process.env.LOCALAPPDATA}\\Atlas\\User Data`,
      linux: '~/.config/atlas',
    },
  },
};

/**
 * Expand home directory in path
 */
function expandHomePath(filepath) {
  if (filepath.startsWith('~')) {
    return path.join(process.env.HOME || process.env.USERPROFILE, filepath.slice(1));
  }
  return filepath;
}

/**
 * Check if a browser exists at the given path
 */
async function browserExists(browserPath) {
  const expandedPath = expandHomePath(browserPath);
  
  return new Promise((resolve) => {
    fs.access(expandedPath, fs.constants.X_OK, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Find browser executable on the system
 */
async function findBrowserPath(browserConfig) {
  const platform = process.platform;
  const paths = browserConfig.paths[platform] || [];

  for (const browserPath of paths) {
    if (await browserExists(browserPath)) {
      return browserPath;
    }
  }

  // Try using 'which' or 'where' command as fallback
  try {
    const cmd = platform === 'win32' ? 'where' : 'which';
    const searchName = browserConfig.id === 'chrome' ? 'google-chrome' : browserConfig.id;
    
    const { stdout } = await execAsync(`${cmd} ${searchName}`);
    const foundPath = stdout.trim().split('\n')[0];
    
    if (foundPath && await browserExists(foundPath)) {
      return foundPath;
    }
  } catch {
    // Command failed, browser not in PATH
  }

  return null;
}

/**
 * Detect if a specific browser is installed
 */
async function detectBrowser(browserId) {
  const browserKey = browserId.toLowerCase();
  const browserConfig = BROWSER_CONFIGS[browserKey];

  if (!browserConfig) {
    return {
      found: false,
      error: `Unknown browser: ${browserId}. Supported browsers: ${Object.keys(BROWSER_CONFIGS).join(', ')}`,
    };
  }

  const browserPath = await findBrowserPath(browserConfig);

  if (browserPath) {
    return {
      found: true,
      name: browserConfig.name,
      id: browserConfig.id,
      path: browserPath,
      appFlag: browserConfig.appFlag,
      profileDir: expandHomePath(browserConfig.profileDir[process.platform] || ''),
    };
  }

  return {
    found: false,
    name: browserConfig.name,
    id: browserConfig.id,
  };
}

/**
 * Get list of all supported browsers and their availability
 */
async function getSupportedBrowsers() {
  const browsers = [];

  for (const [id, config] of Object.entries(BROWSER_CONFIGS)) {
    const browserPath = await findBrowserPath(config);
    browsers.push({
      id,
      name: config.name,
      available: !!browserPath,
      path: browserPath || null,
    });
  }

  return browsers;
}

module.exports = {
  detectBrowser,
  getSupportedBrowsers,
  BROWSER_CONFIGS,
  expandHomePath,
};
