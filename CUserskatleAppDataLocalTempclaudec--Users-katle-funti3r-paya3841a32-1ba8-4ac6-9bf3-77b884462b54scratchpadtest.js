const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 1600 });
  await page.goto('http://localhost:3100', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: 'C:\Users\katle\AppData\Local\Temp\claude\c--Users-katle-funti3r-pay\a3841a32-1ba8-4ac6-9bf3-77b884462b54\scratchpad\landing.png', fullPage: true });
  
  // Check for key elements
  const heroTitle = await page.$('h2');
  const navButtons = await page.$$('.nav-btn');
  const features = await page.$$('.feature-card');
  
  console.log('Hero section present:', !!heroTitle);
  console.log('Nav buttons count:', navButtons.length);
  console.log('Feature cards count:', features.length);
  
  await browser.close();
})();
