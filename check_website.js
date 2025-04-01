const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// Create data directory if it doesn't exist
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Create a debug log file
const debugLogFile = path.join(dataDir, 'debug.log');
fs.writeFileSync(debugLogFile, `Debug log started at ${new Date().toISOString()}\n`);

function logDebug(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(debugLogFile, logMessage);
  console.log(message);
}

// Keywords to look for
const keywords = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
  "2:30"
];

logDebug(`Looking for keywords: ${keywords.join(', ')}`);

// Function to extract which keywords are present in the content
function findKeywords(content) {
  const found = [];
  for (const keyword of keywords) {
    // Use word boundary regex for exact matches
    const regex = new RegExp('\\b' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (regex.test(content)) {
      found.push(keyword);
      logDebug(`Found keyword: ${keyword}`);
    }
  }
  return Array.from(new Set(found)); // Remove duplicates
}

// Get previous keywords state
const previousKeywordsFile = path.join(dataDir, 'previous_keywords.json');
let previousKeywords = [];

if (fs.existsSync(previousKeywordsFile)) {
  try {
    previousKeywords = JSON.parse(fs.readFileSync(previousKeywordsFile, 'utf8'));
    logDebug(`Loaded previous keywords: ${JSON.stringify(previousKeywords)}`);
  } catch (error) {
    logDebug(`Error reading previous keywords: ${error.message}`);
    previousKeywords = [];
  }
} else {
  logDebug('No previous keywords file found, starting fresh');
}

// Main function to check the website
async function checkWebsite() {
  logDebug('Starting website check');
  
  // Create dummy files to ensure we have something to commit
  fs.writeFileSync(path.join(dataDir, 'last_check_time.txt'), new Date().toISOString());
  
  // Launch browser with stealth mode
  logDebug('Launching browser');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu'
    ]
  });
  
  try {
    logDebug('Creating new page');
    const page = await browser.newPage();
    
    // Set a realistic viewport
    await page.setViewport({ width: 1280, height: 800 });
    logDebug('Set viewport');
    
    // Set user agent to appear as a regular browser
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36');
    logDebug('Set user agent');
    
    // Navigate to the website
    logDebug(`Navigating to: ${process.env.WEBSITE_URL}`);
    await page.goto(process.env.WEBSITE_URL, {
      waitUntil: 'networkidle2', // Wait until network is idle
      timeout: 60000 // 60 seconds timeout
    });
    logDebug('Page loaded');
    
    // Wait some extra time for Angular to render content
    logDebug('Waiting for content to render...');
    await page.waitForTimeout(10000); // 10 second additional wait
    logDebug('Wait completed');
    
    // Extract page content
    logDebug('Extracting page content');
    const content = await page.content();
    logDebug(`Page content length: ${content.length} bytes`);
    
    // Save sample for debugging
    const sampleSize = Math.min(10000, content.length);
    fs.writeFileSync(path.join(dataDir, 'page_sample.txt'), content.substring(0, sampleSize));
    logDebug(`Saved first ${sampleSize} bytes of page content`);
    
    // Extract visible text for better keyword detection
    logDebug('Extracting visible text');
    const visibleText = await page.evaluate(() => {
      return document.body.innerText;
    });
    logDebug(`Visible text length: ${visibleText.length} bytes`);
    
    // Save visible text for debugging
    fs.writeFileSync(path.join(dataDir, 'visible_text.txt'), visibleText);
    logDebug('Saved visible text for debugging');
    
    // Take screenshot for debugging
    logDebug('Taking screenshot');
    await page.screenshot({ path: path.join(dataDir, 'screenshot.png'), fullPage: true });
    logDebug('Saved screenshot for debugging');
    
    // Find keywords
    logDebug('Finding keywords in visible text');
    const currentKeywords = findKeywords(visibleText);
    logDebug(`Keywords found: ${JSON.stringify(currentKeywords)}`);
    
    // Save current keywords state
    fs.writeFileSync(previousKeywordsFile, JSON.stringify(currentKeywords, null, 2));
    logDebug('Saved current keywords state');
    
    // Find newly appeared keywords
    const newKeywords = currentKeywords.filter(k => !previousKeywords.includes(k));
    logDebug(`New keywords: ${JSON.stringify(newKeywords)}`);
    
    // Determine if we should send notification
    const shouldNotify = newKeywords.length > 0;
    logDebug(`Should notify: ${shouldNotify}`);
    
    // Create notification message
    const notificationMessage = shouldNotify ? `Cages updated with ${newKeywords.join(', ')}` : '';
    
    // Set outputs for next steps
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `notify=${shouldNotify ? 'true' : 'false'}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `message=${notificationMessage}\n`);
    
    if (shouldNotify) {
      logDebug(`New slots available! Found: ${newKeywords.join(', ')}`);
    } else {
      logDebug('No new slots detected');
    }
    
  } catch (error) {
    logDebug(`Error during website check: ${error.message}`);
    console.error('Error during website check:', error);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'notify=false\n');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'message=Error checking website\n');
  } finally {
    logDebug('Closing browser');
    await browser.close();
    logDebug('Browser closed');
  }
}

// Run the check
checkWebsite();
