import { Module } from '@nestjs/common';
import { NotificationDispatcher } from './dispatcher.js';
import { NotificationsController } from './notifications.controller.js';
import { EMAIL_SENDER, emailFromEnv, SMS_SENDER, smsFromEnv } from './senders.js';

@Module({
  controllers: [NotificationsController],
  providers: [
    { provide: EMAIL_SENDER, useFactory: emailFromEnv },
    { provide: SMS_SENDER, useFactory: smsFromEnv },
    NotificationDispatcher,
  ],
  exports: [NotificationDispatcher],
})
export class NotificationsModule {}
