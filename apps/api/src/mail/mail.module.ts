import { Global, Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
export const MAILER = Symbol('MAILER');

/** Development fallback when SMTP isn't configured: messages go to the log. */
@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger('Mailer');
  async send(m: MailMessage): Promise<void> {
    this.logger.log({ to: m.to, subject: m.subject }, `\n${m.text}`);
  }
}

/** SMTP delivery (Mailpit locally; a transactional provider's SMTP relay in production). */
export class SmtpMailer implements Mailer, OnModuleDestroy {
  private readonly logger = new Logger('Mailer');
  private readonly transport: Transporter;
  constructor(private readonly config: AppConfig) {
    const smtp = config.smtp!;
    this.transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.pass ?? '' } } : {}),
    });
  }
  async send(m: MailMessage): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.MAIL_FROM,
        to: m.to,
        subject: m.subject,
        text: m.text,
      });
    } catch (err) {
      // Never leak delivery failures to callers (account-enumeration safe); log for operators.
      this.logger.error(
        { to: m.to, subject: m.subject, err: (err as Error).message },
        'Mail delivery failed',
      );
    }
  }
  onModuleDestroy() {
    this.transport.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: MAILER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Mailer =>
        config.smtp ? new SmtpMailer(config) : new ConsoleMailer(),
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
