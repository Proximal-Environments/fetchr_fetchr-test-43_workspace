import { injectable, unmanaged } from 'inversify';
import 'reflect-metadata';

@injectable()
export abstract class BaseServiceWithoutLog {
  protected readonly serviceName: string;

  constructor(@unmanaged() serviceName: string) {
    this.serviceName = serviceName;
  }
}
