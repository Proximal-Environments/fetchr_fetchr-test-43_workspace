import { UserRole } from '@fetchr/schema/base/base';
import { getRequestUser } from '../../base/logging/requestContext';
import { adminService, exploreService, userService } from '../../base/service_injection/global';
import {
  AdminServiceImplementation,
  ScrapeProductRequest,
  ScrapeProductResponse,
  GetScrapeStatusRequest,
  GetScrapeStatusResponse,
  ListProductUploadsRequest,
  ListProductUploadsResponse,
  CreatePendingRegisterUserProfileResponse,
  CreatePendingRegisterUserProfileRequest,
  SendMessageInChatRequest,
  SendMessageInChatResponse,
} from '@fetchr/schema/admin/admin';

export class AdminServer implements AdminServiceImplementation {
  async scrapeProduct(request: ScrapeProductRequest): Promise<ScrapeProductResponse> {
    const response = await adminService.scrapeProduct(request);
    return response;
  }

  async getScrapeStatus(request: GetScrapeStatusRequest): Promise<GetScrapeStatusResponse> {
    const response = await adminService.getScrapeStatus(request);
    return response;
  }

  async listProductUploads(
    request: ListProductUploadsRequest,
  ): Promise<ListProductUploadsResponse> {
    const response = await adminService.listProductUploads(request);
    return response;
  }

  async createPendingRegisterUserProfile(
    request: CreatePendingRegisterUserProfileRequest,
  ): Promise<CreatePendingRegisterUserProfileResponse> {
    const user = getRequestUser();
    if (
      !user ||
      (user.role !== UserRole.USER_ROLE_ADMIN && user.role !== UserRole.USER_ROLE_STYLIST)
    ) {
      throw new Error('User not found or is not an admin');
    }

    await userService.createPendingRegisterUserProfile(
      request.email,
      request.transcript,
      request.query,
    );
    return {
      result: {},
    };
  }

  async sendMessageInChat(request: SendMessageInChatRequest): Promise<SendMessageInChatResponse> {
    const user = getRequestUser();
    if (!user || user.role !== UserRole.USER_ROLE_ADMIN) {
      throw new Error('User not found or is not an admin');
    }

    await exploreService.sendAiMessageToChat(request.chatId, request.message);
    return {
      result: {},
    };
  }
}
