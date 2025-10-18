import express, { Request, Response } from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
import {
  CreateExploreRequestRequest,
  CreateExploreRequestResponse,
  ProcessMessageRequest,
  ProcessMessageResponse,
  ReplyToChatRequest,
  ReplyToChatResponse,
} from '@fetchr/schema/explore/explore';
import { exploreService, userService } from './fetchr/base/service_injection/global';
import { supabase } from './supabase';
import {
  RequestContext,
  runWithRequestContextGenerator,
} from './fetchr/base/logging/requestContext';
import { convertUserRoleToDbRole } from './shared/converters';
import { hostname } from './hostname';
import { logService } from './fetchr/base/logging/logService';

const app = express();
const router: express.Router = express.Router();

// Create HTTP server
const server = http.createServer(app);

// Create Socket.IO server
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Handle Socket.IO connections
io.on('connection', async (socket: Socket) => {
  try {
    logService.info('Client connected');

    // Stream numbers
    // const interval = setInterval(() => {
    //   socket.emit('stream-numbers', { number: Math.random() });
    // }, 500);

    // Handle processMessage
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    socket.on('processMessage', async (data: ProcessMessageRequest) => {
      try {
        const headers = socket.handshake.headers;
        const requestId = (headers['x-request-id'] as string) ?? undefined;
        const appEnvironment = (headers['x-app-environment'] as string) ?? undefined;
        const appVersion = (headers['x-app-version'] as string) ?? undefined;
        const authHeader = socket.handshake.auth.token;
        const authToken = authHeader?.split(' ')[1];
        const {
          data: { user: userDb },
        } = await supabase.auth.getUser(authToken);
        const user = userDb ? await userService.getUserOrFail(userDb.id) : undefined;
        logService.info('user', { metadata: { user } });

        const ctx: RequestContext = {
          requestId: requestId as string,
          metadata: {
            method: 'processMessage',
            '@http.method': 'processMessage',
            parameters: JSON.stringify({}),
            startTime: new Date().toISOString(),
            context: 'request',
            hostname: hostname,
            userId: user?.id,
            userEmail: user?.email,
            user: user,
            userRole: user?.role ? convertUserRoleToDbRole(user.role) : undefined,
            appEnvironment,
            appVersion,
          },
        };

        logService.info('ctx', { metadata: { ctx } });

        const generator = runWithRequestContextGenerator<ProcessMessageResponse>(
          async function* (): AsyncGenerator<
            ProcessMessageResponse,
            ProcessMessageResponse,
            undefined
          > {
            const { requestId, message } = data;
            logService.info('requestId', { metadata: { requestId } });
            logService.info('message', { metadata: { message } });
            if (requestId && message) {
              yield* exploreService.processMessage({ requestId, message });
              logService.info('Completed processing message');
            }
            return {} as ProcessMessageResponse;
          },
          ctx,
        );

        logService.info('generator', { metadata: { generator } });

        for await (const response of generator) {
          socket.emit('processMessage', response);
        }

        logService.info('Finished with generator processMessage');
        socket.emit('finishProcessMessage');
        await new Promise(resolve => setTimeout(resolve, 100));

        socket.disconnect(true);
      } catch (error) {
        console.error('Unhandled error in socket connection:', error);
        socket.disconnect(true);
      }
    });

    socket.on('createExploreRequest', async (data: CreateExploreRequestRequest) => {
      try {
        console.log('Received createExploreRequest', data);
        const authHeader = socket.handshake.auth.token;
        const authToken = authHeader?.split(' ')[1];
        const {
          data: { user: userDb },
        } = await supabase.auth.getUser(authToken);
        const headers = socket.handshake.headers;
        const requestId = headers['x-request-id'] as string;
        const appEnvironment = (headers['x-app-environment'] as string) ?? undefined;
        const appVersion = (headers['x-app-version'] as string) ?? undefined;
        const user = userDb ? await userService.getUserOrFail(userDb.id) : undefined;
        console.log('user', user);

        const ctx: RequestContext = {
          requestId: requestId as string,
          metadata: {
            method: 'createExploreRequest',
            '@http.method': 'createExploreRequest',
            parameters: JSON.stringify({}),
            startTime: new Date().toISOString(),
            context: 'request',
            hostname: hostname,
            userId: user?.id,
            userEmail: user?.email,
            user: user,
            userRole: user?.role ? convertUserRoleToDbRole(user.role) : undefined,
            appEnvironment,
            appVersion,
          },
        };

        console.log('ctx', ctx);

        const generator = runWithRequestContextGenerator<CreateExploreRequestResponse>(
          async function* (): AsyncGenerator<
            CreateExploreRequestResponse,
            CreateExploreRequestResponse,
            undefined
          > {
            console.log('request data', data);
            if (data) {
              yield* exploreService.createExploreRequest(data);
              logService.info('Completed creating explore request');
            }
            return {} as CreateExploreRequestResponse; // Return a value of the expected type
          },
          ctx,
        );

        console.log('generator', generator);

        for await (const response of generator) {
          socket.emit('createExploreRequest', response);
        }

        logService.info('Finished with generator createExploreRequest');
        socket.emit('finishCreateExploreRequest');
        await new Promise(resolve => setTimeout(resolve, 100));

        socket.disconnect(true);
      } catch (error) {
        console.error('Unhandled error in socket connection:', error);
        socket.disconnect(true);
      }
    });

    socket.on('replyToChat', async (data: ReplyToChatRequest) => {
      try {
        console.log('Received replyToChat', data);
        const authHeader = socket.handshake.auth.token;
        const authToken = authHeader?.split(' ')[1];
        const {
          data: { user: userDb },
        } = await supabase.auth.getUser(authToken);
        const headers = socket.handshake.headers;
        const requestId = headers['x-request-id'] as string;
        const appEnvironment = (headers['x-app-environment'] as string) ?? undefined;
        const appVersion = (headers['x-app-version'] as string) ?? undefined;
        const user = userDb ? await userService.getUserOrFail(userDb.id) : undefined;
        console.log('user', user);

        const ctx: RequestContext = {
          requestId: requestId as string,
          metadata: {
            method: 'replyToChat',
            '@http.method': 'replyToChat',
            parameters: JSON.stringify({}),
            startTime: new Date().toISOString(),
            context: 'request',
            hostname: hostname,
            userId: user?.id,
            userEmail: user?.email,
            user: user,
            userRole: user?.role ? convertUserRoleToDbRole(user.role) : undefined,
            appEnvironment,
            appVersion,
          },
        };

        console.log('ctx', ctx);

        const generator = runWithRequestContextGenerator<ReplyToChatResponse>(
          async function* (): AsyncGenerator<ReplyToChatResponse, ReplyToChatResponse, undefined> {
            console.log('request data', data);
            if (data) {
              yield* exploreService.replyToChat(data);
              logService.info('Completed replying to chat');
            }
            return {} as ReplyToChatResponse;
          },
          ctx,
        );

        console.log('generator', generator);

        for await (const response of generator) {
          socket.emit('replyToChat', response);
        }

        logService.info('Finished with generator replyToChat');
        socket.emit('finishReplyToChat');
        await new Promise(resolve => setTimeout(resolve, 100));

        socket.disconnect(true);
      } catch (error) {
        console.error('Unhandled error in socket connection:', error);
        socket.disconnect(true);
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });
  } catch (error) {
    console.error('Unhandled error in socket connection:', error);
    socket.disconnect(true);
  }
});

// HTTP endpoint for streaming numbers (kept for backward compatibility)
router.get('/stream-numbers', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ number: Math.random() })}\n\n`);
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

export default router;

app.use('/express', router);

// Start the server on port 3002
server.listen(3002, () => {
  console.log('Express server listening on port 3002');
});
