import { config } from 'dotenv';
config();
import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';

const stagehand = new Stagehand({
  env: 'BROWSERBASE',
  waitForCaptchaSolves: true,
  selfHeal: true,
  verbose: 2,
});

await stagehand.init();

await stagehand.page.goto('https://17track.net/en');

const agent = stagehand.agent({
  provider: 'anthropic',
  model: 'claude-3-7-sonnet-20250219',
});

await stagehand.page.act(`Fill tracking number "D10015856799982"`);

await agent.execute('click on the track button and wait for the results');

const result = await stagehand.page.extract({
  instruction: 'Extract the tracking information',
  schema: z.object({
    is_delivered: z.boolean(),
    expected_delivery_date_start: z.string().nullable(),
    expected_delivery_date_end: z.string().nullable(),
  }),
});

console.log(result);
