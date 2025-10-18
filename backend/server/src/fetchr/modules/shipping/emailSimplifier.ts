import * as cheerio from 'cheerio';

/**
 * Gets a formatted string of essential attributes from the parsed element data
 * @param elementData The element data from parseHtmlForImportantElements
 * @returns A string of formatted attributes
 */
export function getFormattedAttributes(elementData: {
  attributes: Record<string, string>;
}): string {
  return Object.entries(elementData.attributes)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
}

/**
 * Parses HTML and returns a simplified version with only the most important elements
 * @param htmlString The HTML string to parse
 * @returns A simplified HTML string with only the most important elements
 */
export function getSimplifiedHtml(htmlString: string): string {
  try {
    // Use cheerio to parse HTML
    const $ = cheerio.load(htmlString);

    // Helper function to clean text content
    const cleanText = (text: string): string => {
      return text
        .replace(/\s+/g, ' ') // Replace multiple spaces/newlines with single space
        .trim(); // Remove leading/trailing whitespace
    };

    // Function to check if text is just whitespace
    const isOnlyWhitespace = (text: string): boolean => {
      return !/\S/.test(text);
    };

    // Define importance criteria
    const importanceScores: Record<string, number> = {
      button: 10,
      a: 9,
      input: 8,
      select: 7,
      textarea: 7,
      form: 6,
      div: 2,
      span: 1,
    };

    // Essential attributes to collect
    const essentialAttributes = [
      'id',
      'class',
      'href',
      'src',
      'aria-label',
      'aria-name',
      'aria-role',
      'aria-description',
      'aria-expanded',
      'aria-haspopup',
      'type',
      'value',
    ];

    // Find all important elements
    const interactiveSelectors = [
      'button',
      'a[href]',
      'input',
      'select',
      'textarea',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="radio"]',
    ].join(',');

    // Also check for elements that might contain tracking information
    const trackingSelectors = [
      '[id*="track"]',
      '[class*="track"]',
      '[id*="shipping"]',
      '[class*="shipping"]',
      '[id*="order"]',
      '[class*="order"]',
      'h1',
      'h2',
      'h3',
    ].join(',');

    // Combine all selectors
    const combinedSelector = `${interactiveSelectors}, ${trackingSelectors}`;

    // Function to process an element and its children
    const processElement = ($context: cheerio.Cheerio<cheerio.Element>): string => {
      let result = '';

      // Get all direct child nodes (including text nodes)
      $context.contents().each((_, node: cheerio.Element) => {
        if (node.type === 'text' && node.data) {
          // Only add text if it's not purely whitespace
          const cleanedText = cleanText(node.data);
          if (!isOnlyWhitespace(cleanedText)) {
            result += cleanedText;
          }
        } else if (node.type === 'tag') {
          const $element = $(node);
          const matches = $element.is(combinedSelector);

          if (matches) {
            // This is a special element - process it
            const tagName = node.tagName?.toLowerCase() || 'div';
            let importance = importanceScores[tagName] || 0;

            // Calculate importance score
            const id = $element.attr('id') || '';
            const className = $element.attr('class') || '';
            if (id.includes('track') || className.includes('track')) importance += 5;
            if (id.includes('order') || className.includes('order')) importance += 3;
            if ($element.attr('id')) importance += 1;

            const text = $element.text().toLowerCase();
            if (text.includes('track') || text.includes('shipping')) importance += 4;
            if (text.includes('order')) importance += 2;
            if (/\b[a-z0-9]{8,}\b/i.test(text)) importance += 3;

            // Collect attributes
            const attrs: Record<string, string> = {};
            essentialAttributes.forEach(attr => {
              const value = $element.attr(attr);
              if (value) attrs[attr] = value;
            });
            attrs['data-importance'] = importance.toString();

            // Build attribute string
            const attrString = Object.entries(attrs)
              .map(([key, value]) => `${key}="${value}"`)
              .join(' ');

            // Recursively process children of special element
            const innerContent = processElement($element);
            result += `<${tagName} ${attrString}>${innerContent}</${tagName}>`;
          } else {
            // Not a special element - keep only tag name and process children
            const tagName = node.tagName?.toLowerCase() || 'div';
            result += `<${tagName}>` + processElement($element) + `</${tagName}>`;
          }
        }
      });

      return result;
    };

    // Process the entire body
    const processedHtml = processElement($('body'));
    return `<div class="simplified-email">${processedHtml}</div>`;
  } catch (error) {
    console.error('Error generating simplified HTML:', error);
    // Return the original HTML if parsing fails to ensure no content is lost
    return htmlString || `<div class="simplified-email">Failed to parse email content</div>`;
  }
}
