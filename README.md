# WebNest

A Node.js CLI application that creates desktop web apps from URLs using your favorite browser. Works on **macOS**, **Windows**, and **Linux**.

## Features

- 🌐 Create desktop apps from any URL
- 🔍 Apps appear in Spotlight (macOS), Start Menu (Windows), and app launchers (Linux)
- 🌍 Support for Chrome, Edge, Brave, and Chromium browsers
- 📝 Automatic page title detection for app naming
- ⚡ Fast and lightweight

## Installation

```bash
# Clone the repository
git clone https://github.com/walkerfirmin/WebNest.git
cd WebNest

# Install dependencies
npm install

# Link the CLI globally (optional)
npm link
```

## Usage

### Basic Usage

```bash
# Using npm
node src/index.js <url> --browser <browser>

# If globally linked
webnest <url> --browser <browser>
```

### Examples

```bash
# Create a GitHub desktop app using Chrome
webnest https://github.com --browser chrome

# Create a Spotify web app using Brave with a custom name
webnest https://open.spotify.com --browser brave --name "Spotify"

# Create a Twitter/X app using Edge
webnest https://x.com --browser edge --name "Twitter"

# Remove a web app
webnest remove "Spotify" --browser brave

# Remove an app from all browsers
webnest remove "GitHub" --all

# List all installed web apps
webnest installed
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-b, --browser <browser>` | Browser to use (chrome, edge, brave, chromium) | chrome |
| `-n, --name <name>` | Custom name for the app | Auto-detected from page title |
| `-l, --list-browsers` | List available browsers on the system | - |
| `-V, --version` | Show version number | - |
| `-h, --help` | Show help | - |

### Commands

| Command | Description |
|---------|-------------|
| `webnest <url>` | Create a web app from the URL |
| `webnest list` | List available browsers |
| `webnest installed` | List all installed web apps |
| `webnest remove <name>` | Remove a web app by name |

### List Available Browsers

```bash
webnest list
```

Output:
```
Available browsers for web app creation:

  ✓ Google Chrome   - /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  ✓ Brave Browser   - /Applications/Brave Browser.app/Contents/MacOS/Brave Browser
  ✗ Microsoft Edge  - Not installed
  ✗ Chromium        - Not installed
```

## App Locations

WebNest places apps in the standard locations used by browsers:

| Platform | Location |
|----------|----------|
| macOS | `~/Applications/Chrome Apps.localized/` (or Edge/Brave Apps.localized) |
| Windows | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Chrome Apps\` |
| Linux | `~/.local/share/applications/` |

## Supported Browsers

- **Google Chrome** - `chrome`
- **Microsoft Edge** - `edge`
- **Brave Browser** - `brave`
- **Chromium** - `chromium`

## How It Works

1. **macOS**: Creates a native `.app` bundle with a launcher script that opens the browser in app mode
2. **Windows**: Creates a `.lnk` shortcut in the Start Menu programs folder
3. **Linux**: Creates a `.desktop` file in the applications folder

## Requirements

- Node.js 14.0.0 or higher
- A supported Chromium-based browser installed

## License

Apache-2.0
