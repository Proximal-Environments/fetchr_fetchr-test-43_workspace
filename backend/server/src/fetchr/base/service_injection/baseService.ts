import { injectable, unmanaged } from 'inversify';
import 'reflect-metadata';
import { BaseServiceWithoutLog } from './baseServiceWithoutLogging';
import { logService, LogService } from '../logging/logService';

@injectable()
export abstract class BaseService extends BaseServiceWithoutLog {
  private readonly _logService: LogService;

  constructor(@unmanaged() serviceName: string, @unmanaged() _logService?: LogService) {
    super(serviceName);
    this._logService = _logService ?? logService;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  protected get logService() {
    return {
      error: (
        message: string,
        extras?: { metadata?: Record<string, unknown>; error?: Error },
      ): void => {
        this._logService.error(message, {
          ...extras,
          serviceName: this.serviceName,
        });
      },

      warn: (
        message: string,
        extras?: { metadata?: Record<string, unknown>; error?: Error },
      ): void => {
        this._logService.warn(message, {
          ...extras,
          serviceName: this.serviceName,
        });
      },

      info: (
        message: string,
        extras?: { metadata?: Record<string, unknown>; error?: Error },
      ): void => {
        this._logService.info(message, {
          ...extras,
          serviceName: this.serviceName,
        });
      },

      debug: (
        message: string,
        extras?: { metadata?: Record<string, unknown>; error?: Error },
      ): void => {
        this._logService.debug(message, {
          ...extras,
          serviceName: this.serviceName,
        });
      },

      critical: (
        message: string,
        extras?: { metadata?: Record<string, unknown>; error?: Error },
      ): void => {
        this._logService.critical(message, {
          ...extras,
          serviceName: this.serviceName,
        });
      },
    };
  }
}
