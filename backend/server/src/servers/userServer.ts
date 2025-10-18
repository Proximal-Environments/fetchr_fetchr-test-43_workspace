import {
  CreateUserProfileRequest,
  CreateUserProfileResponse,
  DeleteUserRequest,
  DeleteUserResponse,
  GetUserProfileRequest,
  GetUserProfileResponse,
  ListProfilesRequest,
  ListProfilesResponse,
  SendOnboardingNotificationRequest,
  SendOnboardingNotificationResponse,
  SetUserPushNotificationsTokenRequest,
  SetUserPushNotificationsTokenResponse,
  UpdateStripeCustomerIdRequest,
  UpdateStripeCustomerIdResponse,
  UpdateUserProfileRequest,
  UpdateUserProfileResponse,
  UploadWardrobePicturesRequest,
  UploadWardrobePicturesResponse,
  UserServiceImplementation,
  AnalyzeUserStyleRequest,
  AnalyzeUserStyleResponse,
} from '@fetchr/schema/user/user';
import { logService } from '../fetchr/base/logging/logService';
import { userService } from '../fetchr/base/service_injection/global';
import { UserRole } from '@fetchr/schema/base/base';
import { getRequestUser } from '../fetchr/base/logging/requestContext';

export class UserServer implements UserServiceImplementation {
  async createUserProfile(request: CreateUserProfileRequest): Promise<CreateUserProfileResponse> {
    const userProfile = await userService.createProfile(request.userId, {
      name: {
        firstName: request.firstName,
        lastName: request.lastName,
      },
      metadata: {
        gender: request.gender,
      },
      address: undefined,
      sizing: undefined,
      isOnboardingCompleted: false,
      role: UserRole.USER_ROLE_CUSTOMER,
      styleImageUrls: [],
      stylePickerProductIds: [],
      favoriteBrands: [],
      devices: [],
      generatedProfileDescription: {},
    });

    return { userProfile: userProfile };
  }

  async uploadWardrobePictures(
    request: UploadWardrobePicturesRequest,
  ): Promise<UploadWardrobePicturesResponse> {
    void request;
    // await userService.uploadWardrobePictures(request.userId, request.pictures);
    return { success: false };
  }

  async getUserProfile(request: GetUserProfileRequest): Promise<GetUserProfileResponse> {
    const userProfile = await userService.getProfile(request.userId);
    if (!userProfile) throw new Error('User not found');

    return { userProfile: userProfile };
  }

  async updateUserProfile(request: UpdateUserProfileRequest): Promise<UpdateUserProfileResponse> {
    logService.info('[UserServer] Received updateUserProfile profile request:', {
      metadata: {
        userId: request.userId,
        requestData: request,
      },
    });

    const userProfile = await userService.updateProfile(request.userId, request);
    return { userProfile: userProfile };
  }

  async setUserPushNotificationsToken(
    request: SetUserPushNotificationsTokenRequest,
  ): Promise<SetUserPushNotificationsTokenResponse> {
    await userService.setPushNotificationsToken(request.userId, request.token);
    return {};
  }

  async listProfiles(request: ListProfilesRequest): Promise<ListProfilesResponse> {
    const userProfiles = await userService.listProfiles(request.count);
    return { userProfiles: userProfiles };
  }

  async deleteUser(request: DeleteUserRequest): Promise<DeleteUserResponse> {
    const requestUser = getRequestUser();
    if (!requestUser) throw new Error('User not found');
    if (
      request.userId &&
      requestUser.id !== request.userId &&
      requestUser.role !== UserRole.USER_ROLE_ADMIN
    ) {
      throw new Error('Unauthorized');
    }

    await userService.deleteProfile(request.userId ?? requestUser.id);
    return {};
  }

  async sendOnboardingNotification(
    request: SendOnboardingNotificationRequest,
  ): Promise<SendOnboardingNotificationResponse> {
    void request;
    const user = getRequestUser();
    if (!user) throw new Error('User not found');
    await userService.sendOnboardingNotification(user);
    return {};
  }

  async updateStripeCustomerId(
    request: UpdateStripeCustomerIdRequest,
  ): Promise<UpdateStripeCustomerIdResponse> {
    await userService.updateStripeCustomerId(request.userId, request.stripeCustomerId);
    return {};
  }

  async analyzeUserStyle(request: AnalyzeUserStyleRequest): Promise<AnalyzeUserStyleResponse> {
    const result = await userService.analyzeUserStyle(request.userId);
    return {
      coreBrands: result.coreBrands,
      brandAnalysis: result.brandAnalysis,
      styleAnalysis: result.styleAnalysis,
      coreStickers: result.coreStickers,
      preferencesAnalysis: result.preferencesAnalysis,
    };
  }
}
