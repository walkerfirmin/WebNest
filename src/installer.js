const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { expandHomePath, BROWSER_CONFIGS } = require('./browser');
const { sanitizeAppName, generateAppId } = require('./utils');
const { prepareIcon } = require('./icon');

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);
const chmodAsync = promisify(fs.chmod);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const rmAsync = promisify(fs.rm);

/**
 * Get the default web app installation directory for each platform
 */
function getWebAppDirectory(browser) {
  const platform = process.platform;
  const browserId = browser.id;

  const directories = {
    darwin: {
      // macOS Chrome Apps location
      chrome: '~/Applications/Chrome Apps.localized',
      edge: '~/Applications/Edge Apps.localized',
      brave: '~/Applications/Brave Apps.localized',
      chromium: '~/Applications/Chromium Apps.localized',
      comet: '~/Applications/Comet Apps.localized',
      atlas: '~/Applications/Atlas Apps.localized',
    },
    win32: {
      // Windows uses Start Menu shortcuts
      chrome: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Chrome Apps`,
      edge: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Edge Apps`,
      brave: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Brave Apps`,
      chromium: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Chromium Apps`,
      comet: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Comet Apps`,
      atlas: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Atlas Apps`,
    },
    linux: {
      // Linux uses .desktop files in applications folder
      chrome: '~/.local/share/applications',
      edge: '~/.local/share/applications',
      brave: '~/.local/share/applications',
      chromium: '~/.local/share/applications',
      comet: '~/.local/share/applications',
      atlas: '~/.local/share/applications',
    },
  };

  const platformDirs = directories[platform];
  if (!platformDirs) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const dir = platformDirs[browserId] || platformDirs.chrome;
  return expandHomePath(dir);
}

/**
 * Create macOS .app bundle
 */
async function createMacOSApp({ url, appName, browser, appDir }) {
  const safeName = sanitizeAppName(appName);
  const appPath = path.join(appDir, `${safeName}.app`);
  const contentsPath = path.join(appPath, 'Contents');
  const macOSPath = path.join(contentsPath, 'MacOS');
  const resourcesPath = path.join(contentsPath, 'Resources');

  // Create directory structure
  await mkdirAsync(macOSPath, { recursive: true });
  await mkdirAsync(resourcesPath, { recursive: true });

  // Fetch and prepare icon
  let iconNote = '';
  try {
    const iconResult = await prepareIcon(url, resourcesPath, 'darwin');
    if (iconResult.success) {
      // Rename to AppIcon.icns if needed
      const iconPath = path.join(resourcesPath, 'AppIcon.icns');
      if (iconResult.path !== iconPath && fs.existsSync(iconResult.path)) {
        fs.renameSync(iconResult.path, iconPath);
      }
    } else {
      iconNote = 'Could not fetch icon from website. ';
    }
  } catch (error) {
    iconNote = 'Could not fetch icon from website. ';
  }

  // Create Info.plist with icon reference
  const bundleId = generateAppId(url);
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${safeName}</string>
    <key>CFBundleIdentifier</key>
    <string>${bundleId}</string>
    <key>CFBundleName</key>
    <string>${appName}</string>
    <key>CFBundleDisplayName</key>
    <string>${appName}</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.13</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>`;

  await writeFileAsync(path.join(contentsPath, 'Info.plist'), infoPlist);

  // Create launcher script
  const launcherScript = `#!/bin/bash
exec "${browser.path}" --app="${url}" "$@"
`;

  const launcherPath = path.join(macOSPath, safeName);
  await writeFileAsync(launcherPath, launcherScript);
  await chmodAsync(launcherPath, '755');

  // Register with Launch Services to make it appear in Spotlight
  try {
    await execAsync(`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${appPath}"`);
  } catch {
    // lsregister might fail on some systems, but app will still work
  }

  return {
    success: true,
    appPath,
    note: iconNote + 'The app should appear in Spotlight search. If not, try restarting Spotlight (killall mds).',
  };
}

/**
 * Create Windows shortcut (.lnk file)
 */
async function createWindowsApp({ url, appName, browser, appDir }) {
  const safeName = sanitizeAppName(appName);
  const shortcutPath = path.join(appDir, `${safeName}.lnk`);

  // Create the app directory if it doesn't exist
  await mkdirAsync(appDir, { recursive: true });

  // Fetch and prepare icon
  let iconPath = '';
  let iconNote = '';
  try {
    const iconResult = await prepareIcon(url, appDir, 'win32');
    if (iconResult.success) {
      iconPath = iconResult.path;
    } else {
      iconNote = 'Could not fetch icon from website. ';
    }
  } catch {
    iconNote = 'Could not fetch icon from website. ';
  }

  // Use PowerShell to create the shortcut
  const iconLine = iconPath ? `$Shortcut.IconLocation = "${iconPath.replace(/\\/g, '\\\\')},0"` : '';
  const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")
$Shortcut.TargetPath = "${browser.path.replace(/\\/g, '\\\\')}"
$Shortcut.Arguments = "--app=${url}"
$Shortcut.WorkingDirectory = "${path.dirname(browser.path).replace(/\\/g, '\\\\')}"
$Shortcut.Description = "${appName} - Web App"
${iconLine}
$Shortcut.Save()
`;

  // Write PowerShell script to temp file and execute
  const tempScript = path.join(process.env.TEMP, `webnest_${Date.now()}.ps1`);
  await writeFileAsync(tempScript, psScript);

  try {
    await execAsync(`powershell -ExecutionPolicy Bypass -File "${tempScript}"`);
    // Clean up temp script
    fs.unlinkSync(tempScript);
  } catch (error) {
    fs.unlinkSync(tempScript);
    throw new Error(`Failed to create shortcut: ${error.message}`);
  }

  return {
    success: true,
    appPath: shortcutPath,
    note: iconNote + 'The app should appear in the Start Menu search.',
  };
}

/**
 * Create Linux .desktop file
 */
async function createLinuxApp({ url, appName, browser, appDir }) {
  const safeName = sanitizeAppName(appName);
  const appId = generateAppId(url);
  const desktopFilePath = path.join(appDir, `${appId}.desktop`);

  // Create the app directory if it doesn't exist
  await mkdirAsync(appDir, { recursive: true });

  // Create icon directory and fetch icon
  const iconDir = expandHomePath('~/.local/share/icons/webnest');
  await mkdirAsync(iconDir, { recursive: true });
  
  let iconPath = 'web-browser';
  let iconNote = '';
  try {
    const iconResult = await prepareIcon(url, iconDir, 'linux');
    if (iconResult.success) {
      // Rename icon to match app ID
      const newIconPath = path.join(iconDir, `${appId}.png`);
      fs.renameSync(iconResult.path, newIconPath);
      iconPath = newIconPath;
    } else {
      iconNote = 'Could not fetch icon from website. ';
    }
  } catch {
    iconNote = 'Could not fetch icon from website. ';
  }

  // Create .desktop file content
  const desktopContent = `[Desktop Entry]
Version=1.0
Type=Application
Name=${appName}
Comment=${appName} - Web App created by WebNest
Exec="${browser.path}" --app="${url}"
Icon=${iconPath}
Terminal=false
Categories=Network;WebBrowser;
StartupWMClass=${safeName}
StartupNotify=true
`;

  await writeFileAsync(desktopFilePath, desktopContent);
  await chmodAsync(desktopFilePath, '755');

  // Update desktop database to register the app
  try {
    await execAsync('update-desktop-database ~/.local/share/applications/ 2>/dev/null || true');
  } catch {
    // update-desktop-database might not be available on all systems
  }

  return {
    success: true,
    appPath: desktopFilePath,
    note: iconNote + 'The app should appear in your application menu. You may need to log out and log back in for it to appear.',
  };
}

/**
 * Install web app based on platform
 */
async function installWebApp({ url, appName, browser }) {
  const platform = process.platform;
  const appDir = getWebAppDirectory(browser);

  // Ensure the app directory exists
  try {
    await mkdirAsync(appDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw new Error(`Failed to create app directory: ${error.message}`);
    }
  }

  const options = { url, appName, browser, appDir };

  switch (platform) {
    case 'darwin':
      return createMacOSApp(options);
    case 'win32':
      return createWindowsApp(options);
    case 'linux':
      return createLinuxApp(options);
    default:
      return {
        success: false,
        error: `Unsupported platform: ${platform}`,
      };
  }
}

/**
 * Get web app directory for a browser by ID
 */
function getWebAppDirectoryById(browserId) {
  const platform = process.platform;
  
  const directories = {
    darwin: {
      chrome: '~/Applications/Chrome Apps.localized',
      edge: '~/Applications/Edge Apps.localized',
      brave: '~/Applications/Brave Apps.localized',
      chromium: '~/Applications/Chromium Apps.localized',
      comet: '~/Applications/Comet Apps.localized',
      atlas: '~/Applications/Atlas Apps.localized',
    },
    win32: {
      chrome: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Chrome Apps`,
      edge: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Edge Apps`,
      brave: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Brave Apps`,
      chromium: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Chromium Apps`,
      comet: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Comet Apps`,
      atlas: `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Atlas Apps`,
    },
    linux: {
      chrome: '~/.local/share/applications',
      edge: '~/.local/share/applications',
      brave: '~/.local/share/applications',
      chromium: '~/.local/share/applications',
      comet: '~/.local/share/applications',
      atlas: '~/.local/share/applications',
    },
  };

  const platformDirs = directories[platform];
  if (!platformDirs) return null;

  const dir = platformDirs[browserId] || platformDirs.chrome;
  return expandHomePath(dir);
}

/**
 * Get browser display name from ID
 */
function getBrowserName(browserId) {
  const names = {
    chrome: 'Google Chrome',
    edge: 'Microsoft Edge',
    brave: 'Brave Browser',
    chromium: 'Chromium',
    comet: 'Comet Browser',
    atlas: 'Atlas Browser',
  };
  return names[browserId] || browserId;
}

/**
 * Uninstall/remove a web app
 */
async function uninstallWebApp(appName, browserId) {
  const platform = process.platform;
  const appDir = getWebAppDirectoryById(browserId);
  const browserName = getBrowserName(browserId);
  const safeName = sanitizeAppName(appName);

  if (!appDir) {
    return {
      success: false,
      error: `Unsupported platform: ${platform}`,
    };
  }

  try {
    // Check if app directory exists
    await statAsync(appDir);
  } catch {
    return {
      success: false,
      notFound: true,
      error: `No ${browserName} apps directory found`,
    };
  }

  let appPath;
  let found = false;

  switch (platform) {
    case 'darwin':
      // Look for .app bundle
      appPath = path.join(appDir, `${safeName}.app`);
      try {
        await statAsync(appPath);
        found = true;
      } catch {
        // Try case-insensitive search
        const files = await readdirAsync(appDir);
        const match = files.find(f => 
          f.toLowerCase() === `${safeName.toLowerCase()}.app`
        );
        if (match) {
          appPath = path.join(appDir, match);
          found = true;
        }
      }
      break;

    case 'win32':
      // Look for .lnk shortcut
      appPath = path.join(appDir, `${safeName}.lnk`);
      try {
        await statAsync(appPath);
        found = true;
      } catch {
        // Try case-insensitive search
        const files = await readdirAsync(appDir);
        const match = files.find(f => 
          f.toLowerCase() === `${safeName.toLowerCase()}.lnk`
        );
        if (match) {
          appPath = path.join(appDir, match);
          found = true;
        }
      }
      break;

    case 'linux':
      // Look for .desktop file (could be named with app ID)
      const files = await readdirAsync(appDir);
      const desktopMatch = files.find(f => {
        if (!f.endsWith('.desktop')) return false;
        const baseName = f.replace('.desktop', '');
        return baseName.toLowerCase().includes(safeName.toLowerCase()) ||
               f.toLowerCase().includes('webnest');
      });
      
      if (desktopMatch) {
        appPath = path.join(appDir, desktopMatch);
        // Verify it's a WebNest app by checking content
        try {
          const content = fs.readFileSync(appPath, 'utf8');
          if (content.includes(safeName) || content.includes('WebNest')) {
            found = true;
          }
        } catch {
          // Can't read file
        }
      }
      break;
  }

  if (!found) {
    return {
      success: false,
      notFound: true,
      error: `App "${appName}" not found in ${browserName} apps`,
    };
  }

  // Remove the app
  try {
    await rmAsync(appPath, { recursive: true, force: true });
    
    // On macOS, unregister from Launch Services
    if (platform === 'darwin') {
      try {
        await execAsync(`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "${appPath}" 2>/dev/null || true`);
      } catch {
        // lsregister might fail, but app is still removed
      }
    }

    // On Linux, update desktop database
    if (platform === 'linux') {
      try {
        await execAsync('update-desktop-database ~/.local/share/applications/ 2>/dev/null || true');
      } catch {
        // update-desktop-database might not be available
      }
    }

    return {
      success: true,
      appPath,
      browserName,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to remove app: ${error.message}`,
    };
  }
}

/**
 * List all installed web apps for a browser
 */
async function listInstalledApps(browserId) {
  const platform = process.platform;
  const appDir = getWebAppDirectoryById(browserId);
  const browserName = getBrowserName(browserId);
  const apps = [];

  if (!appDir) return apps;

  try {
    await statAsync(appDir);
  } catch {
    return apps;
  }

  try {
    const files = await readdirAsync(appDir);

    for (const file of files) {
      const filePath = path.join(appDir, file);
      
      switch (platform) {
        case 'darwin':
          if (file.endsWith('.app')) {
            const appName = file.replace('.app', '');
            apps.push({
              name: appName,
              path: filePath,
              browser: browserName,
              browserId,
            });
          }
          break;

        case 'win32':
          if (file.endsWith('.lnk')) {
            const appName = file.replace('.lnk', '');
            apps.push({
              name: appName,
              path: filePath,
              browser: browserName,
              browserId,
            });
          }
          break;

        case 'linux':
          if (file.endsWith('.desktop')) {
            // Read the desktop file to get the app name
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              const nameMatch = content.match(/^Name=(.+)$/m);
              if (nameMatch) {
                apps.push({
                  name: nameMatch[1],
                  path: filePath,
                  browser: browserName,
                  browserId,
                });
              }
            } catch {
              // Skip files we can't read
            }
          }
          break;
      }
    }
  } catch {
    // Directory read failed
  }

  return apps;
}

module.exports = {
  installWebApp,
  uninstallWebApp,
  listInstalledApps,
  getWebAppDirectory,
};
