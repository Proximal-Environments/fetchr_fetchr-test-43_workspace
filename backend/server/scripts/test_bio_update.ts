import dotenv from 'dotenv';
import { exploreRequestService } from '../src/fetchr/base/service_injection/global';

dotenv.config();

const requestId = '85a203e5-c111-40a6-9bab-2c537612af13';
const exploreRequest = await exploreRequestService.getRequestOrFail(requestId);
await exploreRequestService.updateUserProfileFromRequest(requestId);

console.log(`[User Id] ${exploreRequest.userId}`);

/*
The customer prioritizes comfort and fit in their style, choosing clothes that fit well over following the latest fashion trends. They prefer classic, basic styles and are open to colors as long as they aren't too flashy. The customer primarily shops at Lululemon, valuing quality and longevity in clothing, and is willing to invest in pieces with these characteristics. They tend to avoid flashy, branded items like Gucci and face challenges finding pants that accommodate athletic calves. Their current shopping needs include T-shirts, shorts, pants, and long sleeve items suitable for nicer occasions. Budget-wise, the customer sets their limit around the Lululemon pricing range but is open to spending more for valuable items.

1. Comfort and Fit:
• Overall, comfort, fit, and ease of movement are top priorities. Clothes should fit well rather than strictly following the latest trends.
• Pants must accommodate athletic calves, addressing the challenge of finding comfortable leg fits.
• The customer frequently wears shorts year-round, preferring shorter inseams (around 5–7") for an easy, non-restrictive feel.

2. Style Preferences:
• Prefers classic, basic styles but is open to mixing vibrant colors or bold details—provided they aren’t too flashy.
• Enjoys short-sleeved items for a comfortable, striking look.
• Will occasionally consider eye-catching statement pieces (e.g., dramatic prints or graphics), but only if they remain tasteful.
• Comfortable with subtle or medium-bold patterns on shirts, seeking a moderate visual impact.

3. Branding and Logo Exposure:
• Leans toward minimal branding and avoids loud logos or flashy, high-end branded items (e.g., Gucci logos).
• Values unique or modern color-blocking and interesting design details over prominent brand names.

4. Shopping Habits and Preferred Retailers:
• Primarily shops at Lululemon, valuing quality, durability, and longevity in their clothing.
• Will invest in more expensive pieces if they provide substantial value in comfort and quality.
• Prefers to keep the budget around Lululemon’s pricing range but remains open to spending more on especially worthwhile items.

5. Current Needs:
• Looking for T-shirts, shorts, pants, and long-sleeve pieces suitable for slightly nicer occasions.
• Wants adaptable items that can transition from relaxed daily wear to more upscale settings when needed.

6. Color and Versatility:
• Embraces a variety of colors as long as they aren’t overly loud.
• Prioritizes clothes that work well in multiple scenarios, from casual to slightly dressy settings.
*/
