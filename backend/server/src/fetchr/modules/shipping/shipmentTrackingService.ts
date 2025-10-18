import { injectable } from 'inversify';
import { supabaseDb } from '../../base/database/supabaseDb';
import { logService } from '../../base/logging/logService';
import axios, { AxiosResponse } from 'axios';
import { shipment_status } from '@prisma/client';

// Types for 17track API responses
interface TrackingEvent {
  time_utc: string;
  time_iso: string;
  description: string;
}

interface Milestone {
  key_stage:
    | 'InfoReceived'
    | 'PickedUp'
    | 'Departure'
    | 'Arrival'
    | 'AvailableForPickup'
    | 'OutForDelivery'
    | 'Delivered'
    | 'Returning'
    | 'Returned';
  time_iso: string | null;
  time_utc: string | null;
  time_raw: {
    date: string | null;
    time: string | null;
    timezone: string | null;
  };
}

interface TimeMetrics {
  days_after_order: number;
  days_of_transit: number;
  days_of_transit_done: number;
  days_after_last_update: number;
  estimated_delivery_date?: {
    source: string;
    from: string;
    to: string;
  };
}

interface TrackInfo {
  latest_event: TrackingEvent;
  latest_status: {
    status: string;
    sub_status: string;
    sub_status_descr: string | null;
  };
  milestone?: Milestone[];
  time_metrics?: TimeMetrics;
}

interface AcceptedTracking {
  track_info: TrackInfo;
}

interface TrackingData {
  accepted?: Array<AcceptedTracking>;
  rejected?: Array<{
    error?: {
      code: number;
    };
  }>;
}

interface TrackingResponse {
  data: TrackingData;
}

// Types for Parcels.app API responses
interface ParcelsAppTrackingRequest {
  uuid: string;
  done: boolean;
  fromCache?: boolean;
  shipments?: ParcelsAppShipment[];
}

interface ParcelsAppShipment {
  trackingId: string;
  status: string;
  statusCode?: number;
  states?: Array<{
    status: string;
    location?: string;
    date: string;
    carrier?: number;
  }>;
  delivered_by?: string;
  lastState?: {
    status: string;
    location?: string;
    date: string;
    carrier?: number;
  };
  carriers?: string[];
  origin?: string;
  destination?: string;
  originCode?: string;
  destinationCode?: string;
  weight?: string;
  detectedCarrier?: {
    slug: string;
    name: string;
  };
  services?: Array<{
    slug: string;
    name: string;
  }>;
  attributes?: Array<{
    l: string;
    n?: string;
    val: string;
  }>;
  externalTracking?: Array<{
    slug: string;
    url: string;
    method: string;
    title?: string;
    trackingId?: string;
  }>;
}

const SEVENTEEN_TRACKING_API_KEY = process.env.SEVENTEEN_TRACKING_API_KEY as string;

const PARCELS_APP_API_KEY = process.env.PARCELS_APP_API_KEY as string;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DeliveryStatusEnum = ['Pending_Shipping', 'Shipping', 'Delivered'] as const;
type DeliveryStatus = (typeof DeliveryStatusEnum)[number];

interface TrackingResponseType {
  expected_delivery_date_start: string | null;
  expected_delivery_date_end: string | null;
  delivered_at: string | null;
  delivery_status: DeliveryStatus;
}

@injectable()
export class ShipmentTrackingService {
  public async registerTrackingNumberWith17Track(trackingNumber: string): Promise<void> {
    try {
      const response = await axios.post(
        'https://api.17track.net/track/v2.4/register',
        [{ number: trackingNumber }],
        {
          headers: {
            '17token': SEVENTEEN_TRACKING_API_KEY,
            'Content-Type': 'application/json',
          },
        },
      );

      // Check if the tracking number was actually accepted
      if (response.data?.data?.rejected?.length > 0) {
        const error = response.data.data.rejected[0].error;
        if (
          error.message.includes("don't need to repeat registration") ||
          error.message.includes('has been registered')
        ) {
          logService.info('Tracking number already registered', {
            metadata: { trackingNumber },
          });
          return;
        }
        logService.error('Failed to register tracking number', {
          metadata: {
            trackingNumber,
            errorCode: error?.code,
            errorMessage: error?.message,
            response: response.data,
          },
        });
        throw new Error(`Failed to register tracking number: ${error?.message}`);
      }

      logService.info('Successfully registered tracking number', {
        metadata: {
          trackingNumber,
          response: response.data,
        },
      });
    } catch (error) {
      logService.error('Error registering tracking number', {
        error,
        metadata: {
          trackingNumber,
          errorMessage: error.message,
          errorResponse: error.response?.data,
        },
      });
      throw error;
    }
  }

  private async getTrackingInfo(trackingNumber: string): Promise<AxiosResponse<TrackingResponse>> {
    const trackPayload = [{ number: trackingNumber }];
    const trackResponse = await axios.post<TrackingResponse>(
      'https://api.17track.net/track/v2.4/gettrackinfo',
      trackPayload,
      {
        headers: {
          '17token': SEVENTEEN_TRACKING_API_KEY,
          'Content-Type': 'application/json',
        },
      },
    );
    return trackResponse;
  }

  private isRegistrationRequired(response: AxiosResponse<TrackingResponse>): boolean {
    return response.data?.data?.rejected?.[0]?.error?.code === -18019902;
  }

  private parseTrackingResponse(
    trackResponse: AxiosResponse<TrackingResponse>,
  ): TrackingResponseType {
    if (!trackResponse.data?.data?.accepted?.[0]?.track_info) {
      throw new Error('No tracking information found in response');
    }

    const trackInfo = trackResponse.data.data.accepted[0].track_info;
    const milestones = trackInfo.milestone || [];
    const timeMetrics = trackInfo.time_metrics || { estimated_delivery_date: undefined };

    // Find the delivered milestone if it exists
    const deliveredMilestone = milestones.find(m => m.key_stage === 'Delivered');
    const deliveredAt = deliveredMilestone?.time_iso
      ? this.formatDateString(deliveredMilestone.time_iso)
      : null;

    // Determine delivery status based on milestones and latest status
    let deliveryStatus: 'Pending_Shipping' | 'Shipping' | 'Delivered';

    if (deliveredMilestone?.time_iso) {
      deliveryStatus = 'Delivered';
    } else if (
      milestones.some(
        m =>
          (m.key_stage === 'PickedUp' ||
            m.key_stage === 'Departure' ||
            m.key_stage === 'Arrival' ||
            m.key_stage === 'OutForDelivery') &&
          m.time_iso,
      )
    ) {
      deliveryStatus = 'Shipping';
    } else {
      deliveryStatus = 'Pending_Shipping';
    }

    // Get expected delivery dates from time_metrics
    let expectedDeliveryDateStart = null;
    let expectedDeliveryDateEnd = null;

    if (timeMetrics.estimated_delivery_date) {
      if (timeMetrics.estimated_delivery_date.from) {
        expectedDeliveryDateStart = this.formatDateString(timeMetrics.estimated_delivery_date.from);
      }
      if (timeMetrics.estimated_delivery_date.to || timeMetrics.estimated_delivery_date.from) {
        expectedDeliveryDateEnd = this.formatDateString(
          timeMetrics.estimated_delivery_date.to || timeMetrics.estimated_delivery_date.from,
        );
      }
    }

    // If package is delivered, set expected dates to delivered date
    if (deliveryStatus === 'Delivered' && deliveredAt) {
      expectedDeliveryDateStart = deliveredAt;
      expectedDeliveryDateEnd = deliveredAt;
    }

    return {
      expected_delivery_date_start: expectedDeliveryDateStart,
      expected_delivery_date_end: expectedDeliveryDateEnd,
      delivered_at: deliveredAt,
      delivery_status: deliveryStatus,
    };
  }

  private getLatestEventTime(trackResponse: AxiosResponse<TrackingResponse>): Date | null {
    const latestEventTime =
      trackResponse.data?.data?.accepted?.[0]?.track_info?.latest_event?.time_utc;
    return latestEventTime ? new Date(latestEventTime) : null;
  }

  private prepareUpdateData(
    parsedTracking: TrackingResponseType,
    latestEventDate: Date,
  ): {
    expected_delivery_date_start: Date | null;
    expected_delivery_date_end: Date | null;
    delivered_at: Date | null;
    status: TrackingResponseType['delivery_status'];
    last_shipping_event_at: Date;
  } {
    return {
      expected_delivery_date_start: parsedTracking.expected_delivery_date_start
        ? new Date(parsedTracking.expected_delivery_date_start)
        : null,
      expected_delivery_date_end: parsedTracking.expected_delivery_date_end
        ? new Date(parsedTracking.expected_delivery_date_end)
        : null,
      delivered_at: parsedTracking.delivered_at ? new Date(parsedTracking.delivered_at) : null,
      status: parsedTracking.delivery_status,
      last_shipping_event_at: latestEventDate,
    };
  }

  // New method for Parcels.app specific update data
  private prepareParcelsAppUpdateData(
    parsedTracking: TrackingResponseType,
    latestEventDate: Date,
  ): {
    expected_delivery_date_start: Date | null;
    expected_delivery_date_end: Date | null;
    delivered_at: Date | null;
    status: TrackingResponseType['delivery_status'];
    last_shipping_event_parcels_app_at: Date;
  } {
    return {
      expected_delivery_date_start: parsedTracking.expected_delivery_date_start
        ? new Date(parsedTracking.expected_delivery_date_start)
        : null,
      expected_delivery_date_end: parsedTracking.expected_delivery_date_end
        ? new Date(parsedTracking.expected_delivery_date_end)
        : null,
      delivered_at: parsedTracking.delivered_at ? new Date(parsedTracking.delivered_at) : null,
      status: parsedTracking.delivery_status,
      last_shipping_event_parcels_app_at: latestEventDate,
    };
  }

  async getShipmentStatusWith17Track(tracking_number: string): Promise<null | {
    status: shipment_status;
    delivered_at: Date | null;
    expected_delivery_date_start: Date | null;
    expected_delivery_date_end: Date | null;
  }> {
    try {
      const trackResponse = await this.getTrackingInfo(tracking_number);

      if (this.isRegistrationRequired(trackResponse)) {
        logService.info(
          `17Track - Tracking number requires registration, attempting to register then skip update. tracking number: ${tracking_number}`,
        );
        await this.registerTrackingNumberWith17Track(tracking_number);
        return null;
      }

      const latestEventDate = this.getLatestEventTime(trackResponse);

      if (!latestEventDate) {
        logService.error(
          `17Track - No shipping events found in response, skipping update. tracking number: ${tracking_number}`,
        );
        return null;
      }

      const parsedTracking = this.parseTrackingResponse(trackResponse);
      const convertedData = this.prepareUpdateData(parsedTracking, latestEventDate);

      logService.info(`17Track - Shipment information for tracking number: ${tracking_number}`, {
        metadata: {
          trackingNumber: tracking_number,
          updateData: convertedData,
        },
      });

      return {
        status: parsedTracking.delivery_status,
        delivered_at: convertedData.delivered_at,
        expected_delivery_date_start: convertedData.expected_delivery_date_start,
        expected_delivery_date_end: convertedData.expected_delivery_date_end,
      };
    } catch (error) {
      logService.error(
        `17Track - Error getting tracking status for tracking number: ${tracking_number}:`,
        {
          error,
          metadata: {
            trackingNumber: tracking_number,
            errorMessage: error.message,
            errorResponse: error.response?.data,
          },
        },
      );
      return null;
    }
  }

  // Parcels.app tracking methods
  public async registerTrackingNumberWithParcelsApp(
    trackingNumber: string,
    destinationCountry: string = 'United States',
  ): Promise<ParcelsAppTrackingRequest> {
    try {
      const response = await axios.post(
        'https://parcelsapp.com/api/v3/shipments/tracking',
        {
          shipments: [
            {
              trackingId: trackingNumber,
              destinationCountry,
            },
          ],
          language: 'en',
          apiKey: PARCELS_APP_API_KEY,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      console.log('Response: ', response.data);

      // Handle immediate response with tracking results (fromCache: true)
      if (response.data.shipments && response.data.done) {
        logService.info('Received immediate tracking results from Parcels.app cache', {
          metadata: {
            trackingNumber,
            fromCache: response.data.fromCache,
            response: response.data,
          },
        });
        return response.data as ParcelsAppTrackingRequest;
      }

      // Handle response with UUID for async tracking
      if (response.data.uuid) {
        logService.info('Successfully registered tracking number with Parcels.app', {
          metadata: {
            trackingNumber,
            uuid: response.data.uuid,
          },
        });
        return response.data as ParcelsAppTrackingRequest;
      }

      // If we don't have either shipments data or a UUID, something went wrong
      logService.error('Failed to register tracking number with Parcels.app: unexpected response', {
        metadata: {
          trackingNumber,
          response: response.data,
        },
      });
      throw new Error('Failed to register tracking number: Unexpected response format');
    } catch (error) {
      logService.error('Error registering tracking number with Parcels.app', {
        error,
        metadata: {
          trackingNumber,
          errorMessage: error.message,
          errorResponse: error.response?.data,
        },
      });
      throw error;
    }
  }

  private async getTrackingInfoFromParcelsApp(uuid: string): Promise<ParcelsAppTrackingRequest> {
    let retries = 0;
    const maxRetries = 5;
    const retryDelay = 2000; // 2 seconds

    while (retries < maxRetries) {
      try {
        const response = await axios.get<ParcelsAppTrackingRequest>(
          `https://parcelsapp.com/api/v3/shipments/tracking`,
          {
            params: {
              uuid,
              apiKey: PARCELS_APP_API_KEY,
            },
            headers: {
              Accept: 'application/json',
            },
          },
        );

        if (response.data.done) {
          return response.data;
        }

        // Not done yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retries++;
      } catch (error) {
        logService.error('Error getting tracking info from Parcels.app', {
          error,
          metadata: {
            uuid,
            errorMessage: error.message,
            errorResponse: error.response?.data,
          },
        });
        throw error;
      }
    }

    throw new Error(`Tracking info not available after ${maxRetries} retries`);
  }

  private parseParcelsAppResponse(trackingData: ParcelsAppTrackingRequest): TrackingResponseType {
    // Check if we have any shipments data

    console.log('Tracking data: ', JSON.stringify(trackingData, null, 2));

    if (!trackingData.shipments || trackingData.shipments.length === 0) {
      throw new Error('No shipment data found in Parcels.app response');
    }

    const shipment = trackingData.shipments[0];

    // Determine delivery status
    let deliveryStatus: 'Pending_Shipping' | 'Shipping' | 'Delivered' = 'Shipping';

    // Map status to our enum
    if (
      shipment.status === 'delivered' ||
      (shipment.lastState?.status && shipment.lastState.status.toLowerCase().includes('delivered'))
    ) {
      deliveryStatus = 'Delivered';
    } else if (
      shipment.status === 'pre_transit' ||
      shipment.states?.length === 0 ||
      !shipment.states ||
      shipment.status?.toLowerCase().includes('pending')
    ) {
      deliveryStatus = 'Pending_Shipping';
    }

    // Find delivered date if available
    let deliveredAt: string | null = null;
    if (deliveryStatus === 'Delivered' && shipment.lastState?.date) {
      deliveredAt = this.formatDateString(shipment.lastState.date);
    }
    // Get expected delivery date from delivered_by field if available
    const expectedDeliveryDate = shipment.delivered_by
      ? this.formatDateString(shipment.delivered_by)
      : null;

    return {
      expected_delivery_date_start: expectedDeliveryDate,
      expected_delivery_date_end: expectedDeliveryDate,
      delivered_at: deliveredAt,
      delivery_status: deliveryStatus,
    };
  }

  private formatDateString(dateStr: string): string {
    // Convert to YYYY-MM-DD format
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
  }

  private getLatestEventTimeFromParcelsApp(trackingData: ParcelsAppTrackingRequest): Date | null {
    if (!trackingData.shipments?.[0]) {
      return null;
    }

    const shipment = trackingData.shipments[0];

    // If we have a lastState with date, use that
    if (shipment.lastState?.date) {
      return new Date(shipment.lastState.date);
    }

    // Otherwise check states array
    if (shipment.states && shipment.states.length > 0) {
      // Sort states by date in descending order
      const sortedStates = [...shipment.states].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      return sortedStates.length > 0 ? new Date(sortedStates[0].date) : null;
    }

    return null;
  }

  async getShipmentStatusWithParcelsApp(tracking_number: string): Promise<null | {
    status: 'Pending_Shipping' | 'Shipping' | 'Delivered';
    delivered_at: Date | null;
    expected_delivery_date_start: Date | null;
    expected_delivery_date_end: Date | null;
  }> {
    try {
      // Register the tracking number to get a tracking request response
      const trackingResponse = await this.registerTrackingNumberWithParcelsApp(tracking_number);

      // Check if we need to fetch tracking data with an additional GET request
      let trackingData: ParcelsAppTrackingRequest;

      if (trackingResponse.uuid && !trackingResponse.done) {
        // We got a UUID but tracking is not done, need to fetch results
        logService.info('Got UUID, fetching tracking results', {
          metadata: {
            trackingNumber: tracking_number,
            uuid: trackingResponse.uuid,
          },
        });
        trackingData = await this.getTrackingInfoFromParcelsApp(trackingResponse.uuid);
      } else {
        // We already have the tracking data (from cache)
        trackingData = trackingResponse;
      }

      const latestEventDate = this.getLatestEventTimeFromParcelsApp(trackingData);

      if (!latestEventDate) {
        logService.info('No shipping events found in response, skipping update', {
          metadata: { trackingNumber: tracking_number },
        });
        return null;
      }

      const parsedTracking = this.parseParcelsAppResponse(trackingData);
      const convertedData = this.prepareParcelsAppUpdateData(parsedTracking, latestEventDate);

      logService.info(
        `Shipment information from Parcels.app for tracking number: ${tracking_number}`,
        {
          metadata: {
            trackingNumber: tracking_number,
            updateData: convertedData,
          },
        },
      );

      return {
        status: parsedTracking.delivery_status,
        delivered_at: convertedData.delivered_at,
        expected_delivery_date_start: convertedData.expected_delivery_date_start,
        expected_delivery_date_end: convertedData.expected_delivery_date_end,
      };
    } catch (error) {
      logService.error(
        `Parcels.app - Error updating tracking status for tracking number: ${tracking_number}:`,
        {
          error,
          metadata: {
            trackingNumber: tracking_number,
            errorMessage: error.message,
            errorResponse: error.response?.data,
          },
        },
      );
      return null;
    }
  }

  // Combined methods that try both services
  public async registerTrackingNumber(
    trackingNumber: string,
    destinationCountry: string = 'United States',
  ): Promise<void> {
    let parcelsAppError = null;
    let seventeenTrackError = null;

    // Try Parcels.app first
    try {
      await this.registerTrackingNumberWithParcelsApp(trackingNumber, destinationCountry);
    } catch (error) {
      parcelsAppError = error;
      logService.warn('Failed to register with Parcels.app, trying 17track as fallback', {
        metadata: {
          trackingNumber,
          error: error.message,
        },
      });
    }

    // Try 17track as fallback
    try {
      await this.registerTrackingNumberWith17Track(trackingNumber);
      return; // Success with fallback
    } catch (error) {
      seventeenTrackError = error;
    }

    // If both services failed, throw an error
    if (seventeenTrackError && parcelsAppError) {
      logService.error('Failed to register tracking number with both services', {
        metadata: {
          trackingNumber,
          parcelsAppError: parcelsAppError.message,
          seventeenTrackError: seventeenTrackError.message,
        },
      });
      throw new Error(
        `Failed to register tracking number: Parcels.app error: ${parcelsAppError.message}, 17track error: ${seventeenTrackError.message}`,
      );
    }
  }

  async updateShipmentStatus(shipment: {
    shipmentId: string;
    tracking_number: string;
  }): Promise<void> {
    const [parcelsAppStatus, seventeenTrackStatus] = await Promise.all([
      this.getShipmentStatusWithParcelsApp(shipment.tracking_number),
      this.getShipmentStatusWith17Track(shipment.tracking_number),
    ]);

    if (parcelsAppStatus && !seventeenTrackStatus) {
      await supabaseDb.shipment.update({
        where: { id: shipment.shipmentId },
        data: parcelsAppStatus,
      });
    } else if (seventeenTrackStatus && !parcelsAppStatus) {
      await supabaseDb.shipment.update({
        where: { id: shipment.shipmentId },
        data: seventeenTrackStatus,
      });
    } else if (parcelsAppStatus && seventeenTrackStatus) {
      const isDelivered =
        parcelsAppStatus.status === 'Delivered' || seventeenTrackStatus.status === 'Delivered';
      const deliveredAt = isDelivered
        ? parcelsAppStatus.delivered_at || seventeenTrackStatus.delivered_at
        : null;
      const updateData = {
        status: isDelivered ? 'Delivered' : parcelsAppStatus.status,
        delivered_at: deliveredAt,
        expected_delivery_date_start: isDelivered
          ? null
          : parcelsAppStatus.expected_delivery_date_start ||
            seventeenTrackStatus.expected_delivery_date_start,
        expected_delivery_date_end: isDelivered
          ? null
          : parcelsAppStatus.expected_delivery_date_end ||
            seventeenTrackStatus.expected_delivery_date_end,
      };

      await supabaseDb.shipment.update({
        where: { id: shipment.shipmentId },
        data: updateData,
      });
    } else {
      logService.error(
        `Could not get shipment status from either service for tracking number: ${shipment.tracking_number}`,
        {
          metadata: {
            shipmentId: shipment.shipmentId,
          },
        },
      );
    }
  }
}
