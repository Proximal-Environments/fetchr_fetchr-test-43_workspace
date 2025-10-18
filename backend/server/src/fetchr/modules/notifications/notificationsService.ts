import { injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import { supabaseDb } from '../../base/database/supabaseDb';
import { device_platform, user_devices } from '@prisma/client';
import { UserDevice } from '@fetchr/schema/notifications/notifications';
import { convertDbDevicePlatformToDevicePlatform } from '../../../shared/converters';
import * as Expo from 'expo-server-sdk';
import { NotificationPayload, NotificationType } from '../../../shared/notifications';

@injectable()
export class NotificationsService extends BaseService {
  private expo: Expo.Expo;

  constructor() {
    super('NotificationsService');
    this.expo = new Expo.Expo();
  }

  private convertDbDeviceToUserDevice(device: user_devices): UserDevice {
    return {
      id: device.id,
      userId: device.user_id,
      deviceToken: device.device_token,
      platform: convertDbDevicePlatformToDevicePlatform(device.platform),
      isActive: device.is_active,
      createdAt: Math.floor(device.created_at.getTime() / 1000),
      updatedAt: Math.floor(device.updated_at.getTime() / 1000),
    };
  }

  async registerDevice(
    userId: string,
    deviceToken: string,
    platform: device_platform,
  ): Promise<UserDevice> {
    try {
      const device = await supabaseDb.user_devices.upsert({
        where: {
          device_token: deviceToken,
        },
        create: {
          user_id: userId,
          device_token: deviceToken,
          platform,
        },
        update: {
          user_id: userId,
          platform,
          is_active: true,
          updated_at: new Date(),
        },
      });

      return this.convertDbDeviceToUserDevice(device);
    } catch (error) {
      this.logService.error('Error registering device', {
        metadata: { userId, deviceToken, platform },
        error,
      });
      throw error;
    }
  }

  async unregisterDevice(deviceToken: string, userId?: string): Promise<boolean> {
    try {
      await supabaseDb.user_devices.update({
        where: {
          device_token: deviceToken,
          ...(userId ? { user_id: userId } : {}),
        },
        data: {
          is_active: false,
          updated_at: new Date(),
        },
      });
      return true;
    } catch (error) {
      this.logService.error('Error unregistering device', {
        metadata: { deviceToken },
        error,
      });
      throw error;
    }
  }

  async listUserDevices(userId: string): Promise<UserDevice[]> {
    try {
      const devices = await supabaseDb.user_devices.findMany({
        where: {
          user_id: userId,
          is_active: true,
        },
      });

      return devices.map(device => this.convertDbDeviceToUserDevice(device));
    } catch (error) {
      this.logService.error('Error listing user devices', {
        metadata: { userId },
        error,
      });
      throw error;
    }
  }

  async sendNotification<T extends NotificationType>(
    notificationType: T,
    userId: string,
    payload: NotificationPayload[T],
  ): Promise<{
    success: boolean;
    successfulDevices: number;
    failedDevices: number;
    failedDeviceTokens: string[];
  }> {
    try {
      this.logService.info('Sending notification', {
        metadata: { notificationType, userId, payload },
      });
      const devices = await this.listUserDevices(userId);
      const messages: Expo.ExpoPushMessage[] = [];
      const invalidTokens: string[] = [];

      devices.forEach(device => {
        if (!Expo.Expo.isExpoPushToken(device.deviceToken)) {
          invalidTokens.push(device.deviceToken);
          return;
        }

        const { title, body, ...data } = payload;

        messages.push({
          to: device.deviceToken,
          title,
          body,
          data: {
            type: notificationType,
            ...data,
          },
        });
      });

      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets: Expo.ExpoPushTicket[] = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          this.logService.error('Error sending push notification chunk', {
            metadata: { userId, chunk },
            error,
          });
        }
      }

      const failedTickets = tickets.filter(
        ticket => ticket.status === 'error',
      ) as Expo.ExpoPushErrorTicket[];

      return {
        success: failedTickets.length === 0 && invalidTokens.length === 0,
        successfulDevices: tickets.length - failedTickets.length,
        failedDevices: failedTickets.length + invalidTokens.length,
        failedDeviceTokens: [
          ...invalidTokens,
          ...failedTickets.map(ticket => ticket.details?.error || 'Unknown error'),
        ],
      };
    } catch (error) {
      this.logService.error('Error sending notification', {
        metadata: { userId, notificationType, payload },
        error,
      });
      throw error;
    }
  }
}
