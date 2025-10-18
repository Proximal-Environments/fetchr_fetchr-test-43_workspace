// Initialize Datadog tracer before any other imports
// import tracer from 'dd-trace';
// tracer.init({
//   logInjection: true,
//   runtimeMetrics: true,
//   profiling: true,
//   hostname: process.env.HOSTNAME || undefined,
//   service: 'fetchr-backend',
//   env: process.env.NODE_ENV || 'development',
//   url: 'https://us3.datadoghq.com',
// });

import dotenv from "dotenv";
dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env",
});

import { readFileSync } from "fs";
import { ClientError, createServer } from "nice-grpc";
import { ServerMiddleware } from "nice-grpc-common";
import { ExploreServer } from "./servers/exploreServer";
import { ExploreServiceDefinition } from "@fetchr/schema/explore/explore";
import { BaseServiceDefinition } from "@fetchr/schema/base/base";
import { BaseServer } from "./servers/baseServer";
import {
  ServerReflection,
  ServerReflectionService,
} from "nice-grpc-server-reflection";
import { CallContext, ServerError, ServerMiddlewareCall } from "nice-grpc";
import { UserServiceDefinition } from "./proto/user/user";
import { UserServer } from "./servers/userServer";
import { CartServer } from "./servers/cartServer";
import { CartServiceDefinition } from "./proto/cart/cart";
import { logService } from "./fetchr/base/logging/logService";
import { BillingServiceDefinition } from "@fetchr/schema/billing/billing";
import { BillingServer } from "./servers/billingServer";
import { OrderManagementServiceDefinition } from "@fetchr/schema/orderManagement/orderManagement";
import { OrderManagementServer } from "./servers/orderManagementServer";
import { NotificationsServiceDefinition } from "@fetchr/schema/notifications/notifications";
import { NotificationsServer } from "./servers/notificationsServer";

import {
  RequestContext,
  addToRequestMetadata,
  runWithRequestContextGenerator,
} from "./fetchr/base/logging/requestContext";
import { randomUUID } from "crypto";
import { convertUserRoleToDbRole } from "./shared/converters";
import { MockServer } from "./servers/mockServer";
import { MockServiceDefinition } from "./proto/mock/mock";
import { AdminServer } from "./fetchr/modules/admin/adminServer";
import { AdminServiceDefinition } from "@fetchr/schema/admin/admin";
import {
  initializeQueue,
  cleanup as cleanupQueue,
} from "./fetchr/modules/productScraper/productScraperQueue";
import "./socketServer";
import { hostname } from "./hostname";
import { AutomationServer } from "./servers/automationServer";
import { AutomationServiceDefinition } from "./proto/automation/automation";
import { DiscoveryServer } from "./servers/discoveryServer";
import { DiscoveryServiceDefinition } from "@fetchr/schema/discovery/discovery";
import { getUserFromAuthHeader } from "./auth";

// Track current server instance
let currentServer: ReturnType<typeof createServer> | null = null;
let isShuttingDown = false;
async function shutdownServer(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log("Starting graceful shutdown...");

  try {
    if (currentServer) {
      // Shutdown the gRPC server
      console.log("Shutting down gRPC server...");
      await currentServer.shutdown();
      currentServer = null;

      // Cleanup BullMQ queue
      await cleanupQueue();

      console.log("Shutdown completed successfully");
    }
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  } finally {
    isShuttingDown = false;
  }
}

const errorLoggingMiddleware = (): ServerMiddleware => {
  return async function* <Request, Response>(
    call: ServerMiddlewareCall<Request, Response>,
    context: CallContext
  ): AsyncGenerator<Response, Response, undefined> {
    const startTime = Date.now();
    const requestId = context.metadata.get("x-request-id") ?? randomUUID();

    // Skip logging for health check and server reflection
    const skipLogging = false;
    // const skipLogging =
    //   call.method.path === '/base.BaseService/HealthCheck' ||
    //   call.method.path === '/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo';

    const authHeader = context.metadata.get("Authorization")?.split(" ")[1];
    const appEnvironment =
      context.metadata.get("x-app-environment") ?? undefined;
    const appVersion = context.metadata.get("x-app-version") ?? undefined;
    console.log("appEnvironment", appEnvironment);
    console.log("appVersion", appVersion);
    console.log("authHeader", authHeader);

    const user = await getUserFromAuthHeader(authHeader);

    // Create context once at the start with all request metadata
    const ctx: RequestContext = {
      requestId,
      metadata: {
        method: call.method.path,
        "@http.method": call.method.path,
        parameters: JSON.stringify(call.request),
        startTime,
        context: "request",
        hostname,
        userId: user?.id,
        userEmail: user?.email,
        user: user,
        userRole: user?.role ? convertUserRoleToDbRole(user.role) : undefined,
        appEnvironment,
        appVersion,
      },
    };

    // Wrap the entire request lifecycle in a single context
    return yield* runWithRequestContextGenerator<Response>(async function* () {
      try {
        // Log request start with consistent context (skip for certain paths)
        if (!skipLogging) {
          logService.info(`Received gRPC call: ${call.method.path}`);
        }

        // Process request and get response
        const result = (yield* call.next(call.request, context)) as Response;

        // Log successful completion with same context (skip for certain paths)
        const duration = Date.now() - startTime;
        addToRequestMetadata("duration", duration);
        addToRequestMetadata("status", "success");

        if (!skipLogging) {
          try {
            logService.info(`Completed gRPC call: ${call.method.path}`, {
              metadata: {
                response: result,
                duration,
                "@duration": duration,
              },
            });
          } catch (e) {
            console.error("Error logging final response:", e);
          }
        }

        return result;
      } catch (error) {
        // Log error with same context
        const duration = Date.now() - startTime;
        addToRequestMetadata("duration", duration);
        addToRequestMetadata("status", "error");

        if (error instanceof ServerError || error instanceof ClientError) {
          logService.error(
            `${error instanceof ServerError ? "Server" : "Client"} error in gRPC call`,
            {
              error,
              metadata: {
                code: error.code,
                message: error.message,
                duration,
              },
            }
          );
        } else {
          logService.error("Unexpected error in gRPC call", {
            error: error as Error,
            metadata: {
              message: error instanceof Error ? error.message : String(error),
              duration,
            },
          });
        }
        throw error;
      }
    }, ctx);
  };
};

async function startServer(): Promise<void> {
  // Cleanup any existing server instance (for hot reloading)
  await shutdownServer();

  // Initialize BullMQ queue
  initializeQueue();

  const server = createServer().use(errorLoggingMiddleware());
  currentServer = server;
  const exploreServer = new ExploreServer();
  const baseServer = new BaseServer();
  const userServer = new UserServer();
  const cartServer = new CartServer();
  const billingServer = new BillingServer();
  const orderManagementServer = new OrderManagementServer();
  const notificationsServer = new NotificationsServer();
  const mockServer = new MockServer();
  const adminServer = new AdminServer();
  const automationServer = new AutomationServer();
  const discoveryServer = new DiscoveryServer();

  server.add(ExploreServiceDefinition, exploreServer);
  server.add(BaseServiceDefinition, baseServer);
  server.add(UserServiceDefinition, userServer);
  server.add(CartServiceDefinition, cartServer);
  server.add(BillingServiceDefinition, billingServer);
  server.add(OrderManagementServiceDefinition, orderManagementServer);
  server.add(NotificationsServiceDefinition, notificationsServer);
  server.add(MockServiceDefinition, mockServer);
  server.add(AdminServiceDefinition, adminServer);
  server.add(AutomationServiceDefinition, automationServer);
  server.add(DiscoveryServiceDefinition, discoveryServer);

  server.add(
    ServerReflectionService,
    ServerReflection(readFileSync("protoset.bin"), [
      ExploreServiceDefinition.fullName,
      BaseServiceDefinition.fullName,
    ])
  );

  const port = process.env.EXPLORE_SERVER_PORT || 50053;
  const address = `0.0.0.0:${port}`;

  await server.listen(address);
  console.log(`Explore server listening on ${address}`);
}

// Handle graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Received SIGTERM signal, shutting down...");
  await shutdownServer();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT signal, shutting down...");
  await shutdownServer();
  process.exit(0);
});

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
