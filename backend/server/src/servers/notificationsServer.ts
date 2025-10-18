import {
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  UnregisterDeviceRequest,
  UnregisterDeviceResponse,
  ListUserDevicesRequest,
  ListUserDevicesResponse,
  NotificationsServiceImplementation,
  CheckDeviceNotificationStatusRequest,
  CheckDeviceNotificationStatusResponse,
} from '@fetchr/schema/notifications/notifications';
import { notificationsService } from '../fetchr/base/service_injection/global';
import { convertDevicePlatformToDbDevicePlatform } from '../shared/converters';
import { logService } from '../fetchr/base/logging/logService';

export class NotificationsServer implements NotificationsServiceImplementation {
  async registerDevice(request: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
    const device = await notificationsService.registerDevice(
      request.userId,
      request.deviceToken,
      convertDevicePlatformToDbDevicePlatform(request.platform),
    );
    return { device };
  }

  async unregisterDevice(request: UnregisterDeviceRequest): Promise<UnregisterDeviceResponse> {
    const success = await notificationsService.unregisterDevice(
      request.deviceToken,
      request.userId,
    );
    return { success };
  }

  async listUserDevices(request: ListUserDevicesRequest): Promise<ListUserDevicesResponse> {
    const devices = await notificationsService.listUserDevices(request.userId);
    return { devices };
  }

  async checkDeviceNotificationStatus(
    request: CheckDeviceNotificationStatusRequest,
  ): Promise<CheckDeviceNotificationStatusResponse> {
    try {
      logService.info('Checking device notification status', {
        metadata: {
          deviceToken: request.deviceToken,
          userId: request.userId,
        },
      });

      // Here we would check against a database or notification service
      // For now, let's assume we would check if this device is registered in the notifications database

      // Check if the specific user is registered with this device
      const isRegistered = await this.isDeviceRegisteredForUser(
        request.deviceToken,
        request.userId,
      );
      const lastActivityTimestamp = isRegistered ? Date.now() : 0;

      return {
        isRegistered,
        lastActivityTimestamp,
      };
    } catch (error) {
      logService.error('Error in checkDeviceNotificationStatus', { error });
      throw error;
    }
  }

  // Helper method to check if a device is registered for a specific user
  async isDeviceRegisteredForUser(deviceToken: string, userId: string): Promise<boolean> {
    try {
      // Get all active devices for this user
      const userDevices = await notificationsService.listUserDevices(userId);

      // Check if the provided device token exists in the user's active devices
      return userDevices.some(device => device.deviceToken === deviceToken && device.isActive);
    } catch (error) {
      logService.error('Error checking if device is registered for user', {
        metadata: { deviceToken, userId },
        error,
      });
      return false;
    }
  }
}
