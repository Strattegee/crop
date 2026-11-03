import { Module } from '@nestjs/common';
import { NotificationDispatcher } from './dispatcher.js';
import { NotificationsController } from './notifications.controller.js';
import { ExpiryReminders } from './reminders.js';
import { PushDevicesController } from './push-devices.controller.js';
import { EMAIL_SENDER, emailFromEnv, PUSH_SENDER, pushFromEnv, SMS_SENDER, smsFromEnv } from './senders.js';

@Module({
  controllers: [NotificationsController, PushDevicesController],
  providers: [
    { provide: EMAIL_SENDER, useFactory: emailFromEnv },
    { provide: SMS_SENDER, useFactory: smsFromEnv },
    { provide: PUSH_SENDER, useFactory: pushFromEnv },
    NotificationDispatcher,
    ExpiryReminders,
  ],
  exports: [NotificationDispatcher, ExpiryReminders],
})
export class NotificationsModule {}
