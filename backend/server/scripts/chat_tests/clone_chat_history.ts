import { PersistedChatHistory } from '../../src/fetchr/core/chat/chatHistory';
import { exploreRequestService } from '../../src/fetchr/base/service_injection/global';
import { MessageUserRequestPayload } from '../../src/fetchr/core/chat/tools/explore/message_user_tool';

/**
 * Script to clone an explore request with its chat history up to a specific message
 *
 * When run, this script will:
 * 1. Get the original explore request
 * 2. Create a new explore request based on the original one
 * 3. Get the chat history from the original request
 * 4. Copy the chat history up until a specific message content is found
 * 5. Save the filtered chat history to the new explore request
 */

// Script configuration (change these values before running)
const config = {
  originalExploreRequestId: '759240f0-6d95-4dc1-ba99-428ec7968419',

  // The message content to stop at (clones all messages up to and including this one)
  // only really tested with message_user tool
  targetMessageContent: ' preferences for upscale daytime fits. Is there anything',

  userId: '70f31651-3282-46aa-9b25-34308ea44ba2',
};

/**
 * Main function to clone an explore request with its chat history up until a specific message
 */
async function cloneExploreRequestWithHistory(): Promise<void> {
  try {
    console.log(`Getting original explore request: ${config.originalExploreRequestId}`);

    // Get the original explore request
    const originalRequest = await exploreRequestService.getRequestOrFail(
      config.originalExploreRequestId,
    );

    if (!originalRequest) {
      throw new Error(`Explore request with ID ${config.originalExploreRequestId} not found`);
    }

    console.log(`Original request found with query: ${originalRequest.query}`);

    // Create a new request based on the original one
    const newRequest = {
      ...originalRequest,
      // Override user ID with target user ID
      userId: config.userId,
      // Ensure devIsDevOnly flag is carried over
      devIsDevOnly: originalRequest.devIsDevOnly || false,
    };

    console.log(`Creating new explore request for user: ${config.userId}`);

    // Insert the new request
    const createdRequest = await exploreRequestService.insertRequest(newRequest, config.userId);

    console.log(`New explore request created with ID: ${createdRequest.id}`);

    // Get the chat history for the original request
    console.log(`Getting chat history for original request`);
    const originalChatHistory = new PersistedChatHistory(config.originalExploreRequestId);
    await originalChatHistory.init();

    const allMessages = originalChatHistory.getMessages();
    console.log(`Original chat has ${allMessages.length} messages`);

    // Find the index of the message with the target content
    let targetMessageIndex = -1;

    for (let i = 0; i < allMessages.length; i++) {
      const message = allMessages[i];

      // Check if the message contains the target content
      if (typeof message.content === 'string') {
        if (message.content.includes(config.targetMessageContent)) {
          targetMessageIndex = i;
          break;
        }
      } else if (Array.isArray(message.content)) {
        // For message with content blocks, check each text block
        for (const block of message.content) {
          if (block.type === 'text' && block.text.includes(config.targetMessageContent)) {
            targetMessageIndex = i;
            break;
          }
          if (block.type === 'tool_use' && block.name === 'message_user') {
            if (block.payload.fetchrLLMToolType === 'message_user') {
              if (
                (block.payload as MessageUserRequestPayload).message.includes(
                  config.targetMessageContent,
                )
              ) {
                targetMessageIndex = i + 1; // need to include response from message_user tool
                break;
              }
            }
          }
        }
        if (targetMessageIndex !== -1) break;
      }
    }

    if (targetMessageIndex === -1) {
      console.log(
        `Warning: Message with content "${config.targetMessageContent}" not found. Will copy all messages.`,
      );
      targetMessageIndex = allMessages.length - 1;
    } else {
      console.log(`Found target message at index ${targetMessageIndex}`);
    }

    // Get the messages up to and including the target message
    const filteredMessages = allMessages.slice(0, targetMessageIndex + 1);
    console.log(`Filtered to ${filteredMessages.length} messages`);

    // Create a new chat history for the new request
    console.log(`Creating chat history for new request: ${createdRequest.id}`);
    const newChatHistory = new PersistedChatHistory(createdRequest.id);
    await newChatHistory.init();

    // Set the messages in the new chat history
    newChatHistory.messages = filteredMessages;

    // Update the new chat history in the database
    await newChatHistory.updateMessagesInDb();

    console.log(`Successfully cloned explore request with chat history up to the target message`);
    console.log(`New explore request ID: ${createdRequest.id}`);

    return;
  } catch (error) {
    console.error('Error cloning explore request:', error);
    throw error;
  }
}

// Run the script
cloneExploreRequestWithHistory()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
