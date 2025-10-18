import { AppEnvironment, UserProfile } from '@fetchr/schema/base/base';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { convertStringToAppEnvironment } from '../../../shared/converters';

export interface RequestContext {
  requestId: string;
  metadata: Record<string, unknown>;
}

export const storage = new AsyncLocalStorage<RequestContext>();

export async function runWithRequestContext<T>(
  fn: () => Promise<T>,
  context?: RequestContext,
): Promise<T> {
  const ctx: RequestContext = context ?? {
    requestId: randomUUID(),
    metadata: {},
  };
  return storage.run(ctx, fn);
}

export async function* runWithRequestContextGenerator<T>(
  fn: () => AsyncGenerator<T, T, undefined>,
  context?: RequestContext,
): AsyncGenerator<T, T, undefined> {
  const ctx: RequestContext = context ?? {
    requestId: randomUUID(),
    metadata: {},
  };

  const generator = fn();

  try {
    while (true) {
      const result = await storage.run(ctx, async () => {
        const next = await generator.next();
        return next;
      });

      if ((result as IteratorResult<T>).done) {
        return (result as IteratorResult<T>).value;
      }

      yield (result as IteratorResult<T>).value;
    }
  } catch (error) {
    await storage.run(ctx, async () => {
      await generator.throw?.(error);
    });
    throw error;
  } finally {
    await storage.run(ctx, async () => {
      if (generator.return) {
        await generator.return(undefined as T);
      }
    });
  }
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestUser(): UserProfile | undefined {
  const ctx = getRequestContext();
  return ctx?.metadata.user as UserProfile | undefined;
}

export function addToRequestMetadata(key: string, value: unknown): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.metadata[key] = value;
  }
}

export function getRequestAppStoreInformation():
  | {
      appEnvironment: AppEnvironment;
      appVersion: string;
    }
  | undefined {
  const ctx = getRequestContext();
  if (!ctx?.metadata.appEnvironment || !ctx?.metadata.appVersion) {
    return undefined;
  }

  return {
    appEnvironment: convertStringToAppEnvironment(ctx.metadata.appEnvironment as string),
    appVersion: ctx.metadata.appVersion as string,
  };
}

/**
 * Checks if the client app version is greater than the specified version.
 * Only enabled in production environment.
 *
 * @param requiredVersion The version to compare against (format: x.y.z)
 * @param requiredBuildNumber Optional build number to compare against
 * @param requiredOtaId Optional OTA update ID to compare against
 * @returns boolean indicating if the client version is greater than the required version
 */
export function greaterThanVersion_ONLY_ON_PROD(
  requiredVersion: string,
  requiredBuildNumber?: string,
  requiredOtaId?: string,
): boolean {
  const appInfo = getRequestAppStoreInformation();
  if (!appInfo) {
    // If we don't have app info, the request didn't come from the app.
    // So we should return true.
    return true;
  }

  // Only enable in production environment
  if (appInfo.appEnvironment !== AppEnvironment.APP_ENVIRONMENT_PROD) {
    return true;
  }

  // Parse the client version string
  // Example: "1.2.3 (45) [OTA: abcd1234]"
  const versionRegex = /^(\d+\.\d+\.\d+)\s*(?:\((\d+)\))?\s*(?:\[OTA:\s*([a-zA-Z0-9]+)\])?/;
  const match = appInfo.appVersion.match(versionRegex);

  if (!match) {
    return true;
  }

  const clientVersion = match[1];
  const clientBuildNumber = match[2] || '0';
  const clientOtaId = match[3] || '';

  // First compare semantic versions
  const clientParts = clientVersion.split('.').map(part => parseInt(part, 10));
  const requiredParts = requiredVersion.split('.').map(part => parseInt(part, 10));

  for (let i = 0; i < Math.max(clientParts.length, requiredParts.length); i++) {
    const clientPart = clientParts[i] || 0;
    const requiredPart = requiredParts[i] || 0;

    if (clientPart > requiredPart) {
      return true;
    }
    if (clientPart < requiredPart) {
      return false;
    }
  }

  // If versions are equal, check build number if provided
  if (requiredBuildNumber) {
    const clientBuildInt = parseInt(clientBuildNumber, 10);
    const requiredBuildInt = parseInt(requiredBuildNumber, 10);

    if (clientBuildInt > requiredBuildInt) {
      return true;
    }
    if (clientBuildInt < requiredBuildInt) {
      return false;
    }
  }

  // If build numbers are equal, check OTA ID if provided
  if (requiredOtaId && clientOtaId) {
    // For OTA IDs, we can only check if they're different, not "greater than"
    // So we'll return false if they're the same, true if client OTA is different
    return clientOtaId !== requiredOtaId;
  }

  // If we get here, versions are equal (and build numbers if checked)
  return false;
}

/**
 * Checks if the client app version is greater than or equal to the specified version.
 * Only enabled in production environment.
 *
 * @param requiredVersion The version to compare against (format: x.y.z)
 * @param requiredBuildNumber Optional build number to compare against
 * @param requiredOtaId Optional OTA update ID to compare against
 * @returns boolean indicating if the client version is greater than or equal to the required version
 */
export function greaterOrEqualToVersion_ONLY_ON_PROD(
  requiredVersion: string,
  requiredBuildNumber?: string,
  requiredOtaId?: string,
): boolean {
  const appInfo = getRequestAppStoreInformation();
  if (!appInfo) {
    // If we don't have app info, the request didn't come from the app.
    // So we should return true.
    return true;
  }

  // Only enable in production environment
  if (appInfo.appEnvironment === AppEnvironment.APP_ENVIRONMENT_DEV) {
    return true;
  }

  // Parse the client version string
  // Example: "1.2.3 (45) [OTA: abcd1234]"
  const versionRegex = /^(\d+\.\d+\.\d+)\s*(?:\((\d+)\))?\s*(?:\[OTA:\s*([a-zA-Z0-9]+)\])?/;
  const match = appInfo.appVersion.match(versionRegex);

  if (!match) {
    return true;
  }

  const clientVersion = match[1];
  const clientBuildNumber = match[2] || '0';
  const clientOtaId = match[3] || '';

  // First compare semantic versions
  const clientParts = clientVersion.split('.').map(part => parseInt(part, 10));
  const requiredParts = requiredVersion.split('.').map(part => parseInt(part, 10));

  for (let i = 0; i < Math.max(clientParts.length, requiredParts.length); i++) {
    const clientPart = clientParts[i] || 0;
    const requiredPart = requiredParts[i] || 0;

    if (clientPart > requiredPart) {
      return true;
    }
    if (clientPart < requiredPart) {
      return false;
    }
  }

  // If versions are equal, check build number if provided
  if (requiredBuildNumber) {
    const clientBuildInt = parseInt(clientBuildNumber, 10);
    const requiredBuildInt = parseInt(requiredBuildNumber, 10);

    if (clientBuildInt > requiredBuildInt) {
      return true;
    }
    if (clientBuildInt < requiredBuildInt) {
      return false;
    }
  }

  // If build numbers are equal, check OTA ID if provided
  if (requiredOtaId && clientOtaId) {
    // For OTA IDs, we can only check if they're different, not "greater than"
    // So we'll return true if they're the same (since this is greaterOrEqual)
    return clientOtaId === requiredOtaId;
  }

  // If we get here, versions are equal (and build numbers if checked)
  return true;
}
