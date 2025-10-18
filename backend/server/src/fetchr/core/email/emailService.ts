import { CreateEmailResponse, Resend } from 'resend';
import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { logService } from '../../base/logging/logService';

@injectable()
export class EmailService extends BaseService {
  private resend: Resend;

  constructor() {
    super('EmailService', logService);
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendEmail({
    to,
    subject,
    html,
    from = 'calvin@fetchr.so',
  }: {
    to: string;
    subject: string;
    html: string;
    avatar?: string;
    from?: string;
  }): Promise<CreateEmailResponse> {
    const response = await this.resend.emails.send({
      from,
      to,
      subject,
      html,
    });

    return response;
  }
}
