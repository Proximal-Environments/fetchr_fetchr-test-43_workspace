import dotenv from 'dotenv';
import { Stagehand } from '@browserbasehq/stagehand';

dotenv.config();

if (!process.env.BROWSERBASE_PROJECT_ID) {
  throw new Error('BROWSERBASE_PROJECT_ID is not set');
}

const stagehand = new Stagehand({
  env: 'LOCAL',
  waitForCaptchaSolves: true,
  selfHeal: true,
  browserbaseSessionCreateParams: {
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    proxies: true,
  },
  verbose: 2,
});

await stagehand.init();

await stagehand.page.goto(
  'https://www.aritzia.com/en/product/the-limitless-pant%E2%84%A2/115785.html?color=30654_1&size=8',
);

const agent = stagehand.agent({
  provider: 'openai',
  model: 'computer-use-preview',
});

await agent.execute('if there are any popups etc on the page, close them');

const result = await agent.execute(
  `Verify if this requirement is met - Do not look through reviews, just use the product page to make a conclusion:

If not sure about something, just say you're not sure.

Requirement: Not overwhelming on shorter frame

In your final message, say if the product is a good fit for the requirement.

Here is the scoring rubric:
70-100: Complete certainty - I am 100% confident this product meets the requirement exactly as specified (no risk of mismatch with our requirements)
60-69: Moderate certainty - I am somewhat confident but have some uncertainty (some risk of mismatch with our requirements)
50-59: Low certainty - I have major doubts about whether this meets the requirement (major risk of mismatch with our requirements)
0-49: No certainty - I cannot determine if this meets the requirement or am confident it does not
`,
);

console.log(JSON.stringify(result, null, 2));

// const result = await stagehand.page.extract({
//   instruction: 'How well does this product meet the requirement? Score out of 100',
//   schema: z.object({
//     thoughts: z.string(),
//     conclusion: z.string(),
//     supporting_information: z.string(),
//     score: z.number(),
//   }),
// });

// console.log(JSON.stringify(result, null, 2));
