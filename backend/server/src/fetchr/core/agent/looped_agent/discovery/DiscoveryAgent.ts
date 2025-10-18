import { LoopedAgentConfig, ProcessToolResult, RunStepResultChunk } from '../LoopedAgent';

import { getGroqService, getOpenAIService, getPerfService } from '../../../lazyServices';
import { LoopedAgent } from '../LoopedAgent';
import { ToolUsageRequestType } from '../../../chat/types';
import { UserProfile } from '@fetchr/schema/base/base';
import { logService } from '../../../../base/logging/logService';
import { DISCOVERY_AGENT_PROMPT_DEFAULT } from '../../../../modules/discovery/discoveryPrompts';
import { FindProductsTool } from '../../../chat/tools/discovery/find_products_tool';
import { PresentProductsTool } from '../../../chat/tools/discovery/present_products_tool';

export class DiscoveryAgent extends LoopedAgent {
  protected override tools = [FindProductsTool, PresentProductsTool];

  private userProfile: UserProfile;

  constructor(
    config: LoopedAgentConfig & {
      userProfile: UserProfile;
    },
  ) {
    super({ ...config, name: 'DiscoveryAgent' });
    this.userProfile = config.userProfile;
    logService.info(
      `DiscoveryAgent constructed with tools: ${this.tools.join(', ')}. Waiting for initialization`,
      {
        metadata: {
          config,
          tools: this.tools.map(t => String(t)),
        },
        serviceName: 'DiscoveryAgent',
      },
    );
  }

  override async init(): Promise<void> {
    await super.init('discovery');
    logService.info('Initializing DiscoveryAgent', {
      metadata: {
        messages: this.chatHistory.getMessages(),
      },
      serviceName: 'DiscoveryAgent',
    });

    if (this.chatHistory.getMessages().length === 0) {
      this.chatHistory.addMessage({
        role: 'user',
        content: DISCOVERY_AGENT_PROMPT_DEFAULT,
      });
    } else {
      // Override first two messages
      this.chatHistory.messages[0] = {
        role: 'user',
        content: DISCOVERY_AGENT_PROMPT_DEFAULT,
      };
    }
    await this.chatHistory.updateMessagesInDb(true);

    logService.info('DiscoveryAgent initialized', {
      metadata: {
        messages: this.chatHistory.getMessages(),
      },
      serviceName: 'DiscoveryAgent',
    });
  }

  override async *processToolUsageRequest(
    toolUsageRequest: ToolUsageRequestType,
  ): AsyncGenerator<ProcessToolResult> {
    const perfService = await getPerfService();
    const openAIService = await getOpenAIService();
    void openAIService;
    const groqService = await getGroqService();
    void groqService;
    const perfHandle = perfService.start(
      `DiscoveryAgent.processToolUsageRequest.${toolUsageRequest.name}`,
    );
    try {
      logService.info(`Calling tool ${toolUsageRequest.name}`, {
        metadata: {
          toolUsage: toolUsageRequest,
        },
        serviceName: 'DiscoveryAgent',
      });
      const tool = this.tools.find(t => t.functionSchema.name === toolUsageRequest.name);
      if (!tool) {
        logService.error(`Tool ${toolUsageRequest.name} not found`, {
          metadata: { toolUsage: toolUsageRequest },
          serviceName: 'DiscoveryAgent',
        });
        yield { outcome: 'tool_not_found', request: toolUsageRequest };
        return;
      }
      switch (toolUsageRequest.name) {
        case 'find_products': {
          yield {
            outcome: 'tool_execution_non_blocking',
            request: toolUsageRequest,
          };
          return;
        }
        case 'present_products': {
          yield {
            outcome: 'tool_execution_outside_silent',
            request: toolUsageRequest,
          };
          return;
        }
        default:
          logService.error(`Tool processing for ${toolUsageRequest.name} not implemented`, {
            metadata: { toolUsage: toolUsageRequest },
            serviceName: 'DiscoveryAgent',
          });
          yield { outcome: 'tool_not_found', request: toolUsageRequest };
          return;
      }
    } finally {
      perfService.end(perfHandle);
    }
  }

  override async *processOutput(output: string): AsyncGenerator<RunStepResultChunk> {
    this.addMessage({
      role: 'assistant',
      content: output,
    });

    yield {
      status: 'error',
      error: new Error(
        'Output response is not supported (your message was not sent to the user). Instead use the message_user tool to send a message to the user.',
      ),
      shouldContinueAgent: true,
    };
  }
}

// When adding tools: Add to the tools array, make sure it's enabled then process it in processToolUsage
// When adding message type: Add to the ExploreRequest types in proto, update the type converters in utils and
//     make explore agent process it properly in the converters too.
