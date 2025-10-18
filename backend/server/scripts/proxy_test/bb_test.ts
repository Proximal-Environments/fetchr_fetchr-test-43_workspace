// import https from 'https';
// import http from 'http';
// import { chromium } from 'playwright-core';
// import dotenv from 'dotenv';

// dotenv.config();

// async function downloadSitemap(): Promise<void> {
//   // // Launch browser with proxy settings
//   // const browser = await chromium.launch({
//   //   proxy: {
//   //     server: 'http://brd.superproxy.io:33335',
//   //     username: 'brd-customer-hl_559cba6b-zone-fetch_residential_1',
//   //     password: 'ymmtqrhi4du1',
//   //   },
//   // });

//   // // Create a new context and page
//   // const context = await browser.newContext();
//   // const page = await context.newPage();

//   // // Navigate to mrporter's sitemap
//   // await page.goto('https://www.mrporter.com/sitemap_en-us.xml', {
//   //   timeout: 60000,
//   // });

//   // // Extract and save the content
//   // const sitemapContent = await page.content();
//   // fs.writeFileSync('mrporter_sitemap.xml', sitemapContent);

//   // // Clean up
//   // await context.close();
//   // await browser.close();

//   try {
//     const response = await fetch(
//       'https://assets.aritzia.com/image/upload/w_1800/f24_a03_120588_27400_on_a',
//       {
//         headers: {
//           'Proxy-Authorization':
//             'Basic ' +
//             Buffer.from('brd-customer-hl_559cba6b-zone-fetch_residential_1:ymmtqrhi4du1').toString(
//               'base64',
//             ),
//         },
//         // @ts-expect-error agent is not typed correctly. But it works.
//         agent:
//           new URL('http://brd.superproxy.io:33335').protocol === 'https:'
//             ? new https.Agent({
//                 // @ts-expect-error agent is not typed correctly. But it works.
//                 proxy: 'http://brd.superproxy.io:33335',
//               })
//             : new http.Agent({
//                 // @ts-expect-error agent is not typed correctly. But it works.
//                 proxy: 'http://brd.superproxy.io:33335',
//               }),
//       },
//     );
//     const data = await response.text();
//     console.log(data);
//   } catch (err) {
//     console.error(err);
//   }
// }

// async function createSession(useProxy: boolean): Promise<{ id: string }> {
//   const response = await fetch(`https://api.browserbase.com/v1/sessions`, {
//     method: 'POST',
//     headers: {
//       'x-bb-api-key': `${process.env.BROWSERBASE_API_KEY}`,
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify({
//       projectId: process.env.BROWSERBASE_PROJECT_ID,
//       proxies: useProxy
//         ? [
//             {
//               type: 'browserbase',
//               geolocation: {
//                 city: 'New York',
//                 state: 'NY',
//                 country: 'US',
//               },
//             },
//           ]
//         : false,
//       browserSettings: useProxy
//         ? {
//             fingerprint: {
//               devices: ['desktop'],
//               locales: ['en-US'],
//               operatingSystems: ['macos'],
//             },
//           }
//         : false,
//     }),
//   });
//   // console.log('[Response]', response);
//   const json = await response.json();
//   // console.log('[JSON]', json);
//   return json;
// }

// let countCorrect = 0;

// async function scrapeMrPorter(): Promise<void> {
//   const productUrl =
//     'https://www.mrporter.com/en-us/mens/product/salomon/sport/outdoor-shoes/acs-pro-rubber-trimmed-mesh-sneakers/1647597316584112';

//   const { id } = await createSession(true);
//   console.log('[Session ID]', id);

//   // Connect to the session with proxy
//   const browser = await chromium.connectOverCDP(
//     `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}&sessionId=${id}`,
//   );
//   const defaultContext = browser.contexts()[0];
//   const page = defaultContext.pages()[0];

//   // Increase timeout for proxy connection
//   await page.goto(productUrl, { timeout: 60000 });
//   const content = await page.content();
//   if (content.includes('Rubber-Trimmed')) {
//     countCorrect++;
//   }
//   console.log('[Content of page]', content);

//   await page.close();
//   await browser.close();
// }

// async function scrapeMultipleMrPorters(numScrapes: number = 100): Promise<void> {
//   try {
//     const scrapePromises = Array(numScrapes)
//       .fill(null)
//       .map(() =>
//         scrapeMrPorter().catch(error => {
//           console.error('Error in individual scrape:', error.message);
//           return null;
//         }),
//       );

//     console.log(`Starting ${numScrapes} concurrent scrapes...`);
//     const results = await Promise.all(scrapePromises);
//     const successfulScrapes = results.filter(result => result !== null).length;
//     console.log(`Completed ${successfulScrapes}/${numScrapes} scrapes successfully`);
//   } catch (error) {
//     console.error('Error in batch scraping:', error.message);
//   }
// }

// // // Run 100 concurrent scrapes
// // scrapeMultipleMrPorters(100)
// //   .catch(error => console.error('Fatal error:', error.message))
// //   .then(() => console.log('[Count Correct]', countCorrect));
// scrapeMrPorter()
//   .catch(error => console.error(error.message))
//   .then(() => console.log('[Count Correct]', countCorrect));
