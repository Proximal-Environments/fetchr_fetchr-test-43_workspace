import { Stagehand } from '@browserbasehq/stagehand';

const CARD_INFO = `5556710016652647
449
01/2030
Navid Pour
1405 Ness Ave, unit 404, San Francisco, CA 94103`;

const userInfo = `Calvin Chen
Email

calvin@fetchr.so

Phone

Not available

Address


1550 Mission St, 1202, San Francisco, CA 94103

Gender

GENDER_MALE

Favorite Brands

Prada
Balenciaga
Dior
Bottega Veneta
Alexander McQueen
Loewe
Theory
Aime Leon Dore
Uniqlo
H&M
Zara
COS
Instagram

calvinchxn`;

const products = [
  {
    product_url: 'https://representclo.com/products/247-training-shorts-black',
    size: 'M',
  },
  {
    product_url: 'https://www.aloyoga.com/products/m6155r-5-repetition-short-anthracite',
    size: 'M',
  },
  {
    product_url: 'https://www.aloyoga.com/products/m6155r-5-repetition-short-anthracite',
    size: 'M',
  },
];

for (const product of products) {
  const stagehand = new Stagehand();
  await stagehand.init();
  await stagehand.page.goto(product.product_url);
  // @ts-expect-error - old code
  const agent = stagehand.page.agent({
    provider: 'openai',
    model: 'computer-use-preview',
  });

  const { success, message } = await agent.execute(`
Add this prouct with size ${product.size} to the cart

You might need to click buttons to expand and find the size option

Do not succeed if the size is not available
`);

  if (!success) {
    console.log(message);
    continue;
  }

  const { success: success2, message: message2 } = await agent.execute(`
Click on the cart icon and complete the checkout process with these details:

Ignore / kill modals that pop up if they don't have to do with the checkout process

- Email: ${userInfo}
- Shipping address: 123 Main St, New York, NY 10001

Use the following card info:
${CARD_INFO}
`);

  if (!success2) {
    console.log(message2);
    continue;
  }
}
