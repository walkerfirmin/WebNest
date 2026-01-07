#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const { installWebApp, uninstallWebApp, listInstalledApps } = require('./installer');
const { detectBrowser, getSupportedBrowsers } = require('./browser');
const { validateUrl, getAppNameFromUrl } = require('./utils');

const VERSION = '1.0.0';

program
  .name('webnest')
  .description('Create desktop web apps from URLs using your favorite browser')
  .version(VERSION)
  .argument('<url>', 'URL of the website to create a desktop app from')
  .option('-b, --browser <browser>', 'Browser to use (chrome, edge, brave, comet, atlas)', 'chrome')
  .option('-n, --name <name>', 'Custom name for the app (defaults to website title)')
  .option('-l, --list-browsers', 'List available browsers on this system')
  .action(async (url, options) => {
    // Handle list browsers option
    if (options.listBrowsers) {
      await listAvailableBrowsers();
      return;
    }

    // Validate URL
    if (!validateUrl(url)) {
      console.error(chalk.red('Error: Invalid URL provided.'));
      console.error(chalk.yellow('Please provide a valid URL starting with http:// or https://'));
      process.exit(1);
    }

    const spinner = ora('Detecting browser...').start();

    try {
      // Detect browser
      const browserInfo = await detectBrowser(options.browser);
      
      if (!browserInfo.found) {
        spinner.fail(chalk.red(`Browser "${options.browser}" not found on this system.`));
        console.log(chalk.yellow('\nAvailable browsers:'));
        const browsers = await getSupportedBrowsers();
        browsers.forEach(b => {
          if (b.available) {
            console.log(chalk.green(`  ✓ ${b.name}`));
          }
        });
        process.exit(1);
      }

      spinner.text = `Using ${browserInfo.name}...`;
      
      // Get app name
      const appName = options.name || await getAppNameFromUrl(url);
      spinner.text = `Creating "${appName}" web app...`;

      // Install the web app
      const result = await installWebApp({
        url,
        appName,
        browser: browserInfo,
      });

      if (result.success) {
        spinner.succeed(chalk.green(`Successfully created "${appName}" web app!`));
        console.log(chalk.cyan(`\nApp location: ${result.appPath}`));
        console.log(chalk.gray('\nThe app should now be available in your system\'s app launcher.'));
        
        if (result.note) {
          console.log(chalk.yellow(`\nNote: ${result.note}`));
        }
      } else {
        spinner.fail(chalk.red(`Failed to create web app: ${result.error}`));
        process.exit(1);
      }
    } catch (error) {
      spinner.fail(chalk.red(`Error: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error);
      }
      process.exit(1);
    }
  });

// Handle list-browsers as standalone command
program
  .command('list')
  .description('List available browsers on this system')
  .action(async () => {
    await listAvailableBrowsers();
  });

// Remove/uninstall command
program
  .command('remove <name>')
  .alias('uninstall')
  .description('Remove a previously created web app')
  .option('-b, --browser <browser>', 'Browser that was used to create the app (chrome, edge, brave, comet, atlas)', 'chrome')
  .option('-a, --all', 'Remove app from all browser app directories')
  .action(async (name, options) => {
    await removeWebApp(name, options);
  });

// List installed apps command
program
  .command('installed')
  .description('List all web apps created by WebNest')
  .option('-b, --browser <browser>', 'Filter by browser (chrome, edge, brave, comet, atlas)')
  .action(async (options) => {
    await listWebApps(options);
  });

async function listAvailableBrowsers() {
  const spinner = ora('Detecting available browsers...').start();
  
  try {
    const browsers = await getSupportedBrowsers();
    spinner.stop();
    
    console.log(chalk.cyan('\nAvailable browsers for web app creation:\n'));
    
    browsers.forEach(browser => {
      if (browser.available) {
        console.log(chalk.green(`  ✓ ${browser.name.padEnd(15)} - ${browser.path}`));
      } else {
        console.log(chalk.gray(`  ✗ ${browser.name.padEnd(15)} - Not installed`));
      }
    });
    
    console.log(chalk.gray('\nUsage: webnest <url> --browser <browser-name>\n'));
  } catch (error) {
    spinner.fail(chalk.red(`Error detecting browsers: ${error.message}`));
    process.exit(1);
  }
}

async function removeWebApp(name, options) {
  const spinner = ora(`Searching for "${name}" web app...`).start();

  try {
    const browsers = options.all 
      ? ['chrome', 'edge', 'brave', 'chromium', 'comet', 'atlas']
      : [options.browser];

    let removedCount = 0;
    let errors = [];

    for (const browserId of browsers) {
      const result = await uninstallWebApp(name, browserId);
      
      if (result.success) {
        removedCount++;
        spinner.succeed(chalk.green(`Removed "${name}" from ${result.browserName} apps`));
        console.log(chalk.gray(`  Deleted: ${result.appPath}`));
      } else if (result.notFound) {
        // App not found for this browser, continue silently unless it's the only browser
        if (!options.all) {
          errors.push(result.error);
        }
      } else {
        errors.push(result.error);
      }
    }

    if (removedCount === 0) {
      spinner.fail(chalk.red(`Web app "${name}" not found.`));
      if (errors.length > 0) {
        errors.forEach(err => console.log(chalk.yellow(`  ${err}`)));
      }
      console.log(chalk.gray('\nTip: Use "webnest installed" to see all installed web apps.'));
      process.exit(1);
    } else if (removedCount > 0 && options.all) {
      console.log(chalk.green(`\n✓ Removed ${removedCount} instance(s) of "${name}"`));
    }
  } catch (error) {
    spinner.fail(chalk.red(`Error removing web app: ${error.message}`));
    process.exit(1);
  }
}

async function listWebApps(options) {
  const spinner = ora('Scanning for installed web apps...').start();

  try {
    const browsers = options.browser 
      ? [options.browser]
      : ['chrome', 'edge', 'brave', 'chromium', 'comet', 'atlas'];

    const allApps = [];

    for (const browserId of browsers) {
      const apps = await listInstalledApps(browserId);
      allApps.push(...apps);
    }

    spinner.stop();

    if (allApps.length === 0) {
      console.log(chalk.yellow('\nNo web apps found.'));
      console.log(chalk.gray('Create one with: webnest <url> --browser <browser>\n'));
      return;
    }

    console.log(chalk.cyan(`\nInstalled web apps (${allApps.length}):\n`));

    allApps.forEach(app => {
      console.log(chalk.green(`  ${app.name.padEnd(25)} - ${app.browser}`));
      console.log(chalk.gray(`    ${app.path}`));
    });

    console.log(chalk.gray('\nRemove with: webnest remove <name> --browser <browser>\n'));
  } catch (error) {
    spinner.fail(chalk.red(`Error listing web apps: ${error.message}`));
    process.exit(1);
  }
}

program.parse();
