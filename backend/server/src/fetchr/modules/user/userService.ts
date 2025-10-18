import { inject, injectable } from 'inversify';
import { BaseService } from '../../base/service_injection/baseService';
import {
  Gender,
  MembershipType,
  SizeTop,
  UserProfile,
  UserRole,
  WhatBringsYouToFetchr,
} from '@fetchr/schema/base/base';
import { supabaseDb } from '../../base/database/supabaseDb';
import {
  convertDbGenderToGender,
  convertDbTopsSizeToSizeTop,
  convertDiscoveryMethodToDbDiscoveryMethod,
  convertGenderToDbGender,
  convertTopSizeToDbTopSize,
  convertDbRoleToUserRole,
  convertDbPlatformToPlatform,
  convertDbPaymentMethodStatusToPaymentMethodStatus,
  convertPaymentMethodStatusToDbPaymentMethodStatus,
  convertWhatBringsYouToFetchrToDbWhatBringsYouToFetchr,
  convertDbWhatBringsYouToFetchrToWhatBringsYouToFetchr,
} from '../../../shared/converters';
import {
  public_users as dbUserProfile,
  user_sizes as dbUserSizing,
  users as dbUser,
  user_devices as dbUserDevice,
} from '@prisma/client';
import { UpdateUserProfileRequest } from '@fetchr/schema/user/user';
import { RedisService } from '../../core/redis/redisService';
import crypto from 'crypto';
import { OpenAIService } from '../../core/open_ai/openaiService';
import { SlackService } from '../slack/slackService';
import { z } from 'zod';
import { OpenAIModel } from '@fetchr/schema/core/core';
import { getRequestUser } from '../../base/logging/requestContext';
import { ChatCompletionMessageParam } from 'openai/resources';
import { supabase } from '../../../supabase';
import { billingService, orderManagementService } from '../../base/service_injection/global';
import { StripeSubscription } from '@fetchr/schema/base/user_billing';
import { BillingService } from '../billing/billingService';

@injectable()
export class UserService extends BaseService {
  constructor(
    @inject(RedisService) private redisService: RedisService,
    @inject(OpenAIService) private openaiService: OpenAIService,
    @inject(SlackService) private slackService: SlackService,
    @inject(BillingService) private billingService: BillingService,
  ) {
    super('UserService');
  }

  async listProfiles(count: number = 100): Promise<UserProfile[]> {
    const profiles = await supabaseDb.public_users.findMany({
      take: count,
    });

    const userSizing = await supabaseDb.user_sizes.findMany({
      where: { id: { in: profiles.map(profile => profile.id) } },
    });

    const dbUsers = await supabaseDb.users.findMany({
      where: { id: { in: profiles.map(profile => profile.id) } },
    });

    const userDevices = await supabaseDb.user_devices.findMany({
      where: { user_id: { in: profiles.map(profile => profile.id) } },
    });

    const stripeSubscriptions = await Promise.all(
      profiles.map(profile => this.billingService.getStripeSubscription(profile.id)),
    );

    // Convert all profiles; also optionally cache each individually if desired
    return Promise.all(
      profiles.map(async (profile, index) => {
        // you could also get from redis here, but for demonstration, we skip
        const profileDevices = userDevices.filter(device => device.user_id === profile.id);
        const userProfile = await this.convertDbUserProfileToUserProfile(
          profile,
          dbUsers[index],
          userSizing[index],
          profileDevices,
          stripeSubscriptions[index],
        );
        // Optionally cache each user-profile if you'd like:
        await this.redisService.set<UserProfile>(`user_profile_${profile.id}`, userProfile);
        return userProfile;
      }),
    );
  }

  convertUserProfileToDbUserProfile(userProfile: UserProfile): {
    profile: Partial<dbUserProfile>;
    sizing: Partial<dbUserSizing>;
  } {
    if (!userProfile.name?.firstName || !userProfile.name?.lastName) {
      this.logService.warn(`User ${userProfile.id} has no name set`);
      throw new Error(`User ${userProfile.id} has no name set`);
    }

    return {
      profile: {
        id: userProfile.id,
        first_name: userProfile.name?.firstName ?? null,
        last_name: userProfile.name?.lastName ?? null,
        gender: convertGenderToDbGender(userProfile.metadata?.gender ?? Gender.GENDER_UNISEX),
        age: userProfile.metadata?.age ?? null,
        weight: userProfile.metadata?.weight ?? null,
        height: userProfile.metadata?.height ?? null,
        address_line_one: userProfile.address?.addressLineOne ?? null,
        address_line_two: userProfile.address?.addressLineTwo ?? null,
        address_city: userProfile.address?.city ?? null,
        address_state: userProfile.address?.state ?? null,
        address_country: userProfile.address?.country ?? null,
        address_postal_code: userProfile.address?.postalCode ?? null,
        onboarding_completed: userProfile.isOnboardingCompleted,
        email: userProfile.email ?? null,
        instagram_handle: userProfile.socialLinks?.instagramHandle ?? null,
        style_image_urls: userProfile.styleImageUrls ?? [],
        brands_selected: userProfile.favoriteBrands ?? [],
        generated_profile_description: userProfile.generatedProfileDescription?.description ?? null,
        generated_profile_description_hash: userProfile.generatedProfileDescription?.hash ?? null,
        generated_description_updated_at_num_preferences: userProfile.generatedProfileDescription
          ?.lastUpdatedAtNumProductPreferences
          ? BigInt(userProfile.generatedProfileDescription.lastUpdatedAtNumProductPreferences)
          : null,
        tried_to_populate_generated_bio_from_pending_register_table:
          userProfile.generatedProfileDescription?.didTriedToPopulateBioFromPendingRegisterTable ??
          false,
        chosen_first_order_query: userProfile.firstOrderQuery ?? null,
      },
      sizing: {
        id: userProfile.id,
        preferred_size_bottoms: userProfile.sizing?.bottoms ?? null,
        preferred_size_tops:
          userProfile.sizing?.tops !== undefined &&
          userProfile.sizing.tops !== SizeTop.SIZE_TOP_UNSPECIFIED &&
          userProfile.sizing.tops !== SizeTop.UNRECOGNIZED
            ? convertTopSizeToDbTopSize(userProfile.sizing.tops)
            : null,
        preferred_size_waist: userProfile.sizing?.waist,
        preferred_size_bust: userProfile.sizing?.bust,
        preferred_size_dress: userProfile.sizing?.dress,
        preferred_size_shoes: userProfile.sizing?.shoes,
        preferred_size_hips: userProfile.sizing?.hips,
        preferred_size_inseam: userProfile.sizing?.inseam,
        preferred_size_hips_approximate: userProfile.sizing?.hipsApproximate ?? false,
        preferred_size_inseam_approximate: userProfile.sizing?.inseamApproximate ?? false,
        preferred_size_waist_approximate: userProfile.sizing?.waistApproximate ?? false,
        preferred_size_bust_approximate: userProfile.sizing?.bustApproximate ?? false,
      },
    };
  }

  convertDbUserProfileToUserProfile(
    dbUserProfile: dbUserProfile,
    dbUser: dbUser,
    dbUserSizing: dbUserSizing | null,
    dbUserDevices: dbUserDevice[] | null,
    stripeSubscription: StripeSubscription | null,
  ): UserProfile {
    const gender = dbUserProfile.gender
      ? convertDbGenderToGender(dbUserProfile.gender)
      : Gender.GENDER_UNISEX;

    // if (gender === Gender.GENDER_UNISEX || gender === Gender.UNRECOGNIZED) {
    //   this.logService.warn(`User ${dbUserProfile.id} has no gender set`);
    // }

    return {
      id: dbUserProfile.id,
      metadata: {
        gender,
        age: dbUserProfile.age ?? undefined,
        weight: dbUserProfile.weight ?? undefined,
        height: dbUserProfile.height ?? undefined,
      },
      name: {
        firstName: dbUserProfile.first_name ?? undefined,
        lastName: dbUserProfile.last_name ?? undefined,
      },
      socialLinks: {
        instagramHandle: dbUserProfile.instagram_handle ?? undefined,
      },
      address: {
        addressLineOne: dbUserProfile.address_line_one ?? undefined,
        addressLineTwo: dbUserProfile.address_line_two ?? undefined,
        city: dbUserProfile.address_city ?? undefined,
        state: dbUserProfile.address_state ?? undefined,
        country: dbUserProfile.address_country ?? undefined,
        postalCode: dbUserProfile.address_postal_code ?? undefined,
      },
      styleImageUrls: dbUserProfile.style_image_urls ?? [],
      phoneNumber: dbUser.phone ?? undefined,
      isOnboardingCompleted: dbUserProfile.onboarding_completed,
      email: dbUserProfile.email ?? undefined,
      isPushNotificationsEnabled: !!dbUserProfile.expo_push_notification_token,
      createdAt: Math.floor(dbUserProfile.created_at.getTime() / 1000),
      role: convertDbRoleToUserRole(dbUserProfile.role),
      membershipType: MembershipType.MEMBERSHIP_TYPE_PRO,
      sizing: dbUserSizing
        ? {
            bottoms: dbUserSizing.preferred_size_bottoms ?? undefined,
            tops: dbUserSizing.preferred_size_tops
              ? convertDbTopsSizeToSizeTop(dbUserSizing.preferred_size_tops)
              : SizeTop.SIZE_TOP_UNSPECIFIED,
            waist: dbUserSizing.preferred_size_waist ?? undefined,
            bust: dbUserSizing.preferred_size_bust ?? undefined,
            hips: dbUserSizing.preferred_size_hips ?? undefined,
            inseam: dbUserSizing.preferred_size_inseam ?? undefined,
            dress: dbUserSizing.preferred_size_dress ?? undefined,
            shoes: dbUserSizing.preferred_size_shoes ?? undefined,
          }
        : undefined,
      favoriteBrands: dbUserProfile.brands_selected ?? [],
      generatedProfileDescription: {
        hash: dbUserProfile.generated_profile_description_hash ?? undefined,
        description: dbUserProfile.generated_profile_description ?? undefined,
        lastUpdatedAtNumProductPreferences:
          dbUserProfile.generated_description_updated_at_num_preferences
            ? Number(dbUserProfile.generated_description_updated_at_num_preferences)
            : undefined,
        didTriedToPopulateBioFromPendingRegisterTable:
          dbUserProfile.tried_to_populate_generated_bio_from_pending_register_table ?? false,
      },
      firstOrderQuery: dbUserProfile.chosen_first_order_query ?? undefined,
      devices:
        dbUserDevices?.map(device => ({
          deviceId: device.id,
          notificationEnabled: device.is_active,
          platform: convertDbPlatformToPlatform(device.platform),
        })) ?? [],
      billing: {
        stripeCustomerId: dbUserProfile.stripe_customer_id ?? undefined,
        paymentMethodStatus: convertDbPaymentMethodStatusToPaymentMethodStatus(
          dbUserProfile.payment_method_status,
        ),
        subscription: stripeSubscription
          ? {
              stripeSubscription,
            }
          : undefined,
      },
      preferencesAndQuirks: dbUserProfile.preferences_and_quirks ?? undefined,
      stylePickerProductIds: dbUserProfile.style_picker_product_ids ?? [],
      selfonboardedGeneratedStyleDescription:
        dbUserProfile.selfonboarded_generated_style_description
          ? JSON.stringify(dbUserProfile.selfonboarded_generated_style_description)
          : undefined,
      whatBringsYouToFetchr: convertDbWhatBringsYouToFetchrToWhatBringsYouToFetchr(
        dbUserProfile.what_brings_you_to_fetchr,
      ),
    };
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    let profile: UserProfile | null = null;
    try {
      // 1) Check if cached
      let cachedUserProfile = await this.redisService.get<UserProfile>(`user_profile_${userId}`);
      if (cachedUserProfile) {
        // this.logService.debug(`Returning cached user profile for userId=${userId}`);
        profile = cachedUserProfile;

        if (
          !cachedUserProfile.generatedProfileDescription
            ?.didTriedToPopulateBioFromPendingRegisterTable
        ) {
          cachedUserProfile = await this.tryToPopulatePostOnboardingInformation(cachedUserProfile);
        }

        // Refresh cache in the background
        void this.refreshUserProfileCache(userId);

        if (!cachedUserProfile.devices) {
          cachedUserProfile.devices = [];
        }

        return cachedUserProfile;
      }

      this.logService.info(`Fetching user profile for userId=${userId}`);

      const [userData, dbUser, userSizing, userDevices, stripeSubscription] = await Promise.all([
        supabaseDb.public_users.findUnique({
          where: { id: userId },
        }),
        supabaseDb.users.findUnique({
          where: { id: userId },
        }),
        supabaseDb.user_sizes.findUnique({
          where: { id: userId },
        }),
        supabaseDb.user_devices.findMany({
          where: { user_id: userId },
        }),
        billingService.getStripeSubscription(userId),
      ]);

      if (!userData || !dbUser) {
        this.logService.warn(`User ${userId} not found`, {
          metadata: { userData, dbUser, userSizing },
        });
        return null;
      }

      // Convert to domain object
      profile = this.convertDbUserProfileToUserProfile(
        userData,
        dbUser,
        userSizing,
        userDevices,
        stripeSubscription,
      );

      if (!profile.generatedProfileDescription?.didTriedToPopulateBioFromPendingRegisterTable) {
        profile = await this.tryToPopulatePostOnboardingInformation(profile);
      }

      // 2) Cache the result
      await this.redisService.set<UserProfile>(`user_profile_${userId}`, profile);

      this.logService.info(`Fetched user profile for userId=${userId}`, {
        metadata: { profile },
      });

      return profile;
    } catch (error) {
      this.logService.error(`Error fetching user ${userId}`, {
        metadata: { userId },
        error,
      });
      return null;
    } finally {
      //   // Run profile description update in background
      //   if (profile) {
      //     void (async (): Promise<void> => {
      //       try {
      //         if (!profile) {
      //           return;
      //         }
      //         const numProductPreferences =
      //           await this.productPreferenceService.getNumProductPreferencesForUser(userId);
      //         if (
      //           !profile.generatedProfileDescription?.hash ||
      //           profile.generatedProfileDescription.hash !== this.getUserProfileHash(profile) ||
      //           !profile.generatedProfileDescription.lastUpdatedAtNumProductPreferences ||
      //           profile.generatedProfileDescription.lastUpdatedAtNumProductPreferences <
      //             numProductPreferences - 10
      //         ) {
      //           const generatedProfileDescription = await this.updateNaturalLangaugeUserProfile(
      //             userId,
      //             profile,
      //           );
      //           profile.generatedProfileDescription = {
      //             hash: this.getUserProfileHash(profile),
      //             description: generatedProfileDescription,
      //           };
      //         }
      //       } catch (error) {
      //         this.logService.error('Error updating profile description in background', {
      //           metadata: { userId },
      //           error,
      //         });
      //       }
      //     }).bind(this)();
      //   }
    }
  }

  getUserProfileHash(userProfile: UserProfile): string {
    const everythingButGeneratedProfileDescription = {
      ...userProfile,
      generatedProfileDescription: undefined,
    };

    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(everythingButGeneratedProfileDescription))
      .digest('hex');

    return hash;
  }

  //   async updateNaturalLangaugeUserProfile(userId: string, profile: UserProfile): Promise<string> {
  //     this.logService.info(`Updating natural language user profile for userId=${userId}`);
  //     await this.redisService.del(`user_profile_${userId}`);
  //     const uuid = uuidv4();
  //     const chatHistory = new PersistedChatHistory(uuid);
  //     await chatHistory.init();
  //     await chatHistory.addMessage({
  //       role: 'system',
  //       content: `
  // You are a helpful assistant that generates a stylist guide description of a users fashion style. This description will be used to understand what the user likes / dislikes by a stylist.

  // Write the description in direct and active language. Write in third person.

  // Extract the following information at the least:
  // - Specific body parts / measurements to consider when styling the user
  // - Specific brands / stores / designers that the user might like
  // - Specific styles / silhouettes that the user might like
  // - Specific colors that the user might like

  // Do not include the product names or extract prefernces that are only mentioned once. Instead, find common patterns across the user profile images and preferences.
  // `,
  //     });

  //     await chatHistory.addMessage({
  //       role: 'user',
  //       content: [
  //         {
  //           type: 'text',
  //           text: `My Name: ${profile.name?.firstName}`,
  //         },
  //         ...profile.styleImageUrls.map((imageUrl, index) => ({
  //           type: 'image' as const,
  //           imageUrl,
  //           caption: `Profile Image ${index + 1}`,
  //         })),
  //       ],
  //     });

  //     const requests = await this.exploreRequestService.listRequests(userId, 1, 20);
  //     const requestsMessage =
  //       '\n\nMy Explore Requests:\n' +
  //       requests.map(r => `Request ${r.id}: ${r.generatedTitle}`).join('\n');
  //     await chatHistory.addMessage({
  //       role: 'user',
  //       content: requestsMessage,
  //     });

  //     const [preferences, numProductPreferences] = await Promise.all([
  //       this.productPreferenceService.getProductPreferencesForUser(userId),
  //       this.productPreferenceService.getNumProductPreferencesForUser(userId),
  //     ]);

  //     // Filter preferences to get 10 mixed likes/dislikes and all super likes
  //     const superLikes = preferences.filter(
  //       pref => pref.preference?.preferenceType === PreferenceType.SUPERLIKE,
  //     );

  //     const likes = preferences.filter(
  //       pref => pref.preference?.preferenceType === PreferenceType.LIKE,
  //     );

  //     const dislikes = preferences.filter(
  //       pref => pref.preference?.preferenceType === PreferenceType.DISLIKE,
  //     );

  //     // Randomly select 5 likes and 5 dislikes if available
  //     const selectedLikes = likes.sort(() => Math.random() - 0.5).slice(0, 20);
  //     const selectedDislikes = dislikes.sort(() => Math.random() - 0.5).slice(0, 20);

  //     // Add selected preferences to profile description
  //     const preferencesDescription = [
  //       ...superLikes.map(p => `I loved this product: ${p.productDetails?.generatedDescription}`),
  //       ...selectedLikes.map(p => `I like this product: ${p.productDetails?.generatedDescription}`),
  //       ...selectedDislikes.map(
  //         p => `I dislike this product: ${p.productDetails?.generatedDescription}`,
  //       ),
  //     ].join('\n');

  //     const preferencesMessage = '\n\nMy Product Preferences:\n' + preferencesDescription;
  //     await chatHistory.addMessage({
  //       role: 'user',
  //       content: preferencesMessage,
  //     });

  //     const { profile: generatedProfileDescription } = await this.openaiService.submitChatCompletion(
  //       await chatHistory.getOpenAiMessages(),
  //       {
  //         zodSchema: z.object({
  //           profile: z.string(),
  //         }),
  //         model: OpenAIModel.O1,
  //         // reasoningEffort: 'high',
  //       },
  //     );

  //     await supabaseDb.public_users.update({
  //       where: { id: userId },
  //       data: {
  //         generated_profile_description: generatedProfileDescription,
  //         generated_description_updated_at_num_preferences: numProductPreferences,
  //         generated_profile_description_hash: this.getUserProfileHash(profile),
  //       },
  //     });

  //     await this.redisService.set<UserProfile>(`user_profile_${userId}`, {
  //       ...profile,
  //       generatedProfileDescription: {
  //         description: generatedProfileDescription,
  //         hash: this.getUserProfileHash(profile),
  //         lastUpdatedAtNumProductPreferences: numProductPreferences,
  //       },
  //     });

  //     this.logService.info(`Updated natural language user profile for userId=${userId}`, {
  //       metadata: {
  //         userId,
  //         generatedProfileDescription,
  //       },
  //     });
  //     return generatedProfileDescription;
  //   }

  async getUserOrFail(userId: string): Promise<UserProfile> {
    const profile = await this.getProfile(userId);
    if (!profile) {
      throw new Error(`User with id ${userId} not found`);
    }
    return profile;
  }

  async createProfile(
    userId: string,
    profile: Omit<UserProfile, 'id' | 'isPushNotificationsEnabled' | 'createdAt' | 'billing'>,
  ): Promise<UserProfile> {
    this.logService.info(`Creating user ${userId}`, {
      metadata: { profile: { ...profile, id: userId } },
    });

    // Invalidate any cached profile if it exists
    await this.redisService.del(`user_profile_${userId}`);

    if (await supabaseDb.public_users.findUnique({ where: { id: userId } })) {
      this.logService.info(`User ${userId} already exists, updating existing profile + fetching`);
      const updateData: Partial<dbUserProfile> = {};
      if (profile.name?.firstName !== undefined) {
        updateData.first_name = profile.name.firstName;
      }
      if (profile.name?.lastName !== undefined) {
        updateData.last_name = profile.name.lastName;
      }
      if (profile.metadata?.gender !== undefined) {
        updateData.gender = convertGenderToDbGender(profile.metadata.gender);
      }

      await supabaseDb.public_users.update({
        where: { id: userId },
        data: updateData,
      });

      // Re-fetch updated version and cache it
      const updatedProfile = await this.getUserOrFail(userId);
      await this.redisService.set<UserProfile>(`user_profile_${userId}`, updatedProfile);
      return updatedProfile;
    }

    const [userData, userSizing, dbUser, userDevices, stripeSubscription] = await Promise.all([
      supabaseDb.public_users.create({
        data: {
          id: userId,
          first_name: profile.name?.firstName ?? '',
          last_name: profile.name?.lastName ?? '',
          gender: convertGenderToDbGender(profile.metadata?.gender ?? Gender.GENDER_MALE),
          instagram_handle: profile.socialLinks?.instagramHandle ?? null,
        },
      }),
      supabaseDb.user_sizes.create({
        data: {
          id: userId,
          preferred_size_bottoms: profile.sizing?.bottoms,
          preferred_size_tops: profile.sizing?.tops
            ? convertTopSizeToDbTopSize(profile.sizing.tops)
            : null,
          preferred_size_waist: profile.sizing?.waist,
          preferred_size_bust: profile.sizing?.bust,
          preferred_size_dress: profile.sizing?.dress,
          preferred_size_shoes: profile.sizing?.shoes,
        },
      }),
      supabaseDb.users.findUnique({
        where: { id: userId },
      }),
      supabaseDb.user_devices.findMany({
        where: { user_id: userId },
      }),
      billingService.getStripeSubscription(userId),
    ]);

    if (!dbUser) {
      throw new Error(`User ${userId} not found`);
    }

    const createdProfile = this.convertDbUserProfileToUserProfile(
      userData,
      dbUser,
      userSizing,
      userDevices,
      stripeSubscription,
    );
    // Cache the newly created profile
    await this.redisService.set<UserProfile>(`user_profile_${userId}`, createdProfile);

    return createdProfile;
  }

  async getUserGender(userId: string): Promise<Gender | null> {
    try {
      const userData = await supabaseDb.public_users.findUnique({
        where: { id: userId },
        select: { gender: true },
      });

      if (!userData?.gender) {
        return null;
      }

      return convertDbGenderToGender(userData.gender);
    } catch (error) {
      this.logService.error(`Error fetching user gender ${userId}: ${error}`);
      return null;
    }
  }

  async getUserGenderOrFail(userId: string): Promise<Gender> {
    const gender = await this.getUserGender(userId);
    if (!gender) {
      throw new Error(`User ${userId} has no gender set`);
    }
    return gender;
  }

  async getRequestUser(requestId: string): Promise<UserProfile | null> {
    try {
      const request = await supabaseDb.explore_requests.findUnique({
        where: { id: requestId },
        select: { user_id: true },
      });

      if (!request) {
        return null;
      }

      return this.getProfile(request.user_id);
    } catch (error) {
      this.logService.error(`Error fetching request user for request_id=${requestId}`, {
        metadata: { requestId },
        error,
      });
      return null;
    }
  }

  private async tryToPopulatePostOnboardingInformation(
    userProfile: UserProfile,
  ): Promise<UserProfile> {
    this.logService.info(
      `Trying to populate generated profile description for user ${userProfile.email} - ${userProfile.name?.firstName} ${userProfile.name?.lastName}`,
    );

    const pendingRegisterUserInfo = await supabaseDb.pending_register_user_info.findFirst({
      where: { email: userProfile.email },
    });

    if (pendingRegisterUserInfo?.generated_bio) {
      if (!userProfile.generatedProfileDescription) {
        userProfile.generatedProfileDescription = {
          description: pendingRegisterUserInfo.generated_bio,
        };
      } else {
        userProfile.generatedProfileDescription.description = pendingRegisterUserInfo.generated_bio;
        userProfile.generatedProfileDescription.didTriedToPopulateBioFromPendingRegisterTable =
          true;
      }

      let firstQueryChat: string | undefined = pendingRegisterUserInfo.first_chat_query ?? '';
      if (firstQueryChat.trim().length === 0) {
        firstQueryChat = undefined;
      }
      userProfile.firstOrderQuery = firstQueryChat;

      await supabaseDb.public_users.update({
        where: { id: userProfile.id },
        data: {
          generated_profile_description: pendingRegisterUserInfo.generated_bio,
          tried_to_populate_generated_bio_from_pending_register_table: true,
          chosen_first_order_query: firstQueryChat,
        },
      });

      this.logService.info(
        `Populated generated profile description for user ${userProfile.email} - ${userProfile.name?.firstName} ${userProfile.name?.lastName}`,
        {
          metadata: {
            userProfile,
            generatedBio: pendingRegisterUserInfo?.generated_bio,
            didTriedToPopulateBioFromPendingRegisterTable:
              userProfile.generatedProfileDescription
                ?.didTriedToPopulateBioFromPendingRegisterTable,
          },
        },
      );
    } else {
      this.logService.info(
        `No pending register user info found for user ${userProfile.email} - ${userProfile.name?.firstName} ${userProfile.name?.lastName}`,
      );
    }
    const update: Partial<dbUserProfile> = {};
    if (pendingRegisterUserInfo?.generated_bio) {
      update.generated_profile_description = pendingRegisterUserInfo.generated_bio;
    }
    update.tried_to_populate_generated_bio_from_pending_register_table = true;

    await supabaseDb.public_users.update({
      where: { id: userProfile.id },
      data: update,
    });

    return userProfile;
  }

  async updateProfile(
    userId: string,
    updates: Partial<Omit<UpdateUserProfileRequest, 'userId'>>,
  ): Promise<UserProfile> {
    try {
      this.logService.info(`Starting update profile for user ${userId}`, {
        metadata: {
          updates,
          userId,
        },
      });

      // Invalidate any cached profile
      await this.redisService.del(`user_profile_${userId}`);

      const updateData: Partial<dbUserProfile> = {};

      if (updates.firstName !== undefined) {
        updateData.first_name = updates.firstName;
      }
      if (updates.instagramHandle !== undefined) {
        updateData.instagram_handle = updates.instagramHandle;
      }
      if (updates.lastName !== undefined) {
        updateData.last_name = updates.lastName;
      }
      if (updates.gender !== undefined) {
        updateData.gender = convertGenderToDbGender(updates.gender);
      }
      if (updates.onboardingCompleted !== undefined) {
        updateData.onboarding_completed = updates.onboardingCompleted;
      }
      if (updates.age !== undefined) {
        updateData.age = updates.age;
      }
      if (updates.height !== undefined) {
        updateData.height = updates.height;
      }
      if (updates.weight !== undefined) {
        updateData.weight = updates.weight;
      }
      if (updates.discoveryMethod !== undefined) {
        updateData.discovery_method = convertDiscoveryMethodToDbDiscoveryMethod(
          updates.discoveryMethod,
        );
      }
      if (updates.address !== undefined) {
        updateData.address_line_one = updates.address?.addressLineOne;
        updateData.address_line_two = updates.address?.addressLineTwo;
        updateData.address_city = updates.address?.city;
        updateData.address_state = updates.address?.state;
        updateData.address_country = updates.address?.country;
        updateData.address_postal_code = updates.address?.postalCode;
      }
      if (updates.brandsSelected !== undefined && updates.brandsSelected.length > 0) {
        updateData.brands_selected = updates.brandsSelected;
      }
      if (updates.styleImageUrls !== undefined && updates.styleImageUrls.length > 0) {
        updateData.style_image_urls = updates.styleImageUrls;
      }
      if (updates.stylePickerProductIds !== undefined && updates.stylePickerProductIds.length > 0) {
        updateData.style_picker_product_ids = updates.stylePickerProductIds;
      }
      if (updates.whatBringsYouToFetchr !== undefined) {
        await this.handleCuratedBoxNotification(userId, updates);
        updateData.what_brings_you_to_fetchr =
          convertWhatBringsYouToFetchrToDbWhatBringsYouToFetchr(updates.whatBringsYouToFetchr);
      }
      if (updates.preferencesAndQuirks !== undefined) {
        updateData.preferences_and_quirks = updates.preferencesAndQuirks;
      }
      if (updates.paymentMethodStatus !== undefined) {
        updateData.payment_method_status = convertPaymentMethodStatusToDbPaymentMethodStatus(
          updates.paymentMethodStatus,
        );
      }
      if (updates.selfonboardedGeneratedStyleDescription !== undefined) {
        updateData.selfonboarded_generated_style_description = JSON.parse(
          updates.selfonboardedGeneratedStyleDescription,
        );
      }

      const sizingUpdateData = {
        ...(updates.userSizing?.bottoms !== undefined && {
          preferred_size_bottoms: updates.userSizing.bottoms,
        }),
        ...(updates.userSizing?.tops !== undefined && {
          preferred_size_tops: convertTopSizeToDbTopSize(updates.userSizing.tops),
        }),
        ...(updates.userSizing?.waist !== undefined && {
          preferred_size_waist: updates.userSizing.waist,
          preferred_size_waist_approximate: updates.userSizing.waistApproximate ?? false,
        }),
        ...(updates.userSizing?.bust !== undefined && {
          preferred_size_bust: updates.userSizing.bust,
          preferred_size_bust_approximate: updates.userSizing.bustApproximate ?? false,
        }),
        ...(updates.userSizing?.dress !== undefined && {
          preferred_size_dress: updates.userSizing.dress,
        }),
        ...(updates.userSizing?.shoes !== undefined && {
          preferred_size_shoes: updates.userSizing.shoes,
        }),
        ...(updates.userSizing?.hips !== undefined && {
          preferred_size_hips: updates.userSizing.hips,
          preferred_size_hips_approximate: updates.userSizing.hipsApproximate ?? false,
        }),
        ...(updates.userSizing?.inseam !== undefined && {
          preferred_size_inseam: updates.userSizing.inseam,
          preferred_size_inseam_approximate: updates.userSizing.inseamApproximate ?? false,
        }),
      };

      const [userData, userSizing, dbUser, userDevices, stripeSubscription] = await Promise.all([
        supabaseDb.public_users.update({
          where: { id: userId },
          data: updateData,
        }),
        // First check if user_sizes record exists
        supabaseDb.user_sizes
          .findUnique({
            where: { id: userId },
          })
          .then(async existingSizing => {
            if (existingSizing) {
              // If exists, just update
              return supabaseDb.user_sizes.update({
                where: { id: userId },
                data: sizingUpdateData,
              });
            } else {
              // If doesn't exist, create new
              return supabaseDb.user_sizes.create({
                data: { id: userId, ...sizingUpdateData },
              });
            }
          }),
        supabaseDb.users.findUnique({
          where: { id: userId },
        }),
        supabaseDb.user_devices.findMany({
          where: { user_id: userId },
        }),
        billingService.getStripeSubscription(userId),
      ]);

      if (!dbUser) {
        throw new Error(`User ${userId} not found`);
      }

      let updatedProfile = this.convertDbUserProfileToUserProfile(
        userData,
        dbUser,
        userSizing,
        userDevices,
        stripeSubscription,
      );

      if (
        !updatedProfile.generatedProfileDescription?.didTriedToPopulateBioFromPendingRegisterTable
      ) {
        updatedProfile = await this.tryToPopulatePostOnboardingInformation(updatedProfile);
      }

      // Re-cache updated profile
      await this.redisService.set<UserProfile>(`user_profile_${userId}`, updatedProfile);

      return updatedProfile;
    } catch (error) {
      this.logService.error(`Error updating user profile${userId}`, {
        metadata: { userId, updates },
        error,
      });
      throw error;
    }
  }

  async setPushNotificationsToken(userId: string, token: string | undefined): Promise<void> {
    // Invalidate cache
    await this.redisService.del(`user_profile_${userId}`);

    await supabaseDb.public_users.update({
      where: { id: userId },
      data: { expo_push_notification_token: token ?? null },
    });
    // Optionally re-cache the updated profile
    const updatedProfile = await this.getProfile(userId);
    if (updatedProfile) {
      await this.redisService.set<UserProfile>(`user_profile_${userId}`, updatedProfile);
    }
  }

  async getProfileByEmailOrFail(email: string): Promise<UserProfile> {
    const user = await supabaseDb.public_users.findFirst({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      throw new Error(`User with email ${email} not found`);
    }

    return this.getUserOrFail(user.id);
  }

  async deleteProfile(userId: string): Promise<void> {
    // Remove from cache
    await this.redisService.del(`user_profile_${userId}`);

    await orderManagementService.deleteUserOrders(userId);
    await supabaseDb.image_preferences.deleteMany({
      where: { user_id: userId },
    });

    await supabaseDb.explore_requests.deleteMany({
      where: { user_id: userId },
    });

    await supabaseDb.public_users
      .delete({
        where: { id: userId },
      })
      .catch(() => {
        this.logService.info('Public user not found when trying to delete', {
          metadata: { userId },
        });
      });

    await supabaseDb.users
      .delete({
        where: { id: userId },
      })
      .catch(() => {
        this.logService.info('User not found when trying to delete', {
          metadata: { userId },
        });
      });

    await supabaseDb.user_sizes
      .delete({
        where: { id: userId },
      })
      .catch(() => {
        this.logService.info('User sizes not found when trying to delete', {
          metadata: { userId },
        });
      });

    console.log('Deleting user from auth', { userId });

    await supabase.auth.admin
      .deleteUser(userId)
      .then(response => {
        this.logService.info('User deleted from auth', {
          metadata: { userId, response },
        });
      })
      .catch(() => {
        this.logService.info('User not found when trying to delete', {
          metadata: { userId },
        });
      });

    await supabaseDb.subscriptions
      .deleteMany({
        where: { user_id: userId },
      })
      .catch(() => {
        this.logService.info('Subscriptions not found when trying to delete', {
          metadata: { userId },
        });
      });
  }

  // Add this new method to refresh the cache in the background
  private async refreshUserProfileCache(userId: string): Promise<void> {
    try {
      // Fetch the latest data from the database
      const [userData, dbUser, userSizing, userDevices, stripeSubscription] = await Promise.all([
        supabaseDb.public_users.findUnique({
          where: { id: userId },
        }),
        supabaseDb.users.findUnique({
          where: { id: userId },
        }),
        supabaseDb.user_sizes.findUnique({
          where: { id: userId },
        }),
        supabaseDb.user_devices.findMany({
          where: { user_id: userId },
        }),
        billingService.getStripeSubscription(userId),
      ]);

      if (!userData || !dbUser) {
        this.logService.debug(`Background refresh: User ${userId} not found`);
        return;
      }

      // Convert to domain object
      const freshProfile = this.convertDbUserProfileToUserProfile(
        userData,
        dbUser,
        userSizing,
        userDevices,
        stripeSubscription,
      );

      // Update the cache with the fresh data
      await this.redisService.set<UserProfile>(`user_profile_${userId}`, freshProfile);
    } catch (error) {
      this.logService.error(`Error in background refresh for user ${userId}`, {
        metadata: { userId },
        error,
      });
    }
  }

  public async sendOnboardingNotification(user: UserProfile): Promise<void> {
    // Send notifications for users who haven't completed onboarding
    if (process.env.SLACK_ONBOARDING_NOTIFICATION_CHANNEL_ID && user) {
      try {
        await this.slackService.sendMessageWithUserInfo(
          process.env.SLACK_ONBOARDING_NOTIFICATION_CHANNEL_ID,
          '✅ *User Completed Onboarding*',
          {
            id: user.id,
            name: user.name,
            email: user.email,
            phoneNumber: user.phoneNumber,
          },
          {
            userLabel: 'User',
          },
        );
      } catch (error) {
        this.logService.error(`Failed to send onboarding notification for user ${user.id}`, {
          metadata: { userId: user.id },
          error,
        });
      }
    }
  }

  public async updateUserGeneratedProfile(userId: string, profile: string): Promise<void> {
    await supabaseDb.public_users.update({
      where: { id: userId },
      data: { generated_profile_description: profile },
    });

    // Invalidate cache for this user
    await this.redisService.del(`user_profile_${userId}`);
  }

  public async createPendingRegisterUserProfile(
    email: string,
    transcript: string,
    query: string,
  ): Promise<void> {
    this.logService.info('Creating pending register user profile', {
      metadata: { email, query },
    });
    const { styleProfile } = await this.openaiService.submitChatCompletion(
      [
        {
          role: 'system',
          content: `\
I will give you the transcript of a call between a stylist and a customer. Your job is to extract the customers style profile from the transcript. It's better to be general than specific.

You must include the following information (if mentioned) in the style profile:
- Age
- Gender
- Location
- Measurements
  - Height
  - Weight
  - Any clothing size measurements mentioned (bust, waist, hips, etc.)
  - Unique physical attributes (ie: long legs, short legs, etc.) mentioned that would help us infer clothing size
  - Their perfect size on their current clothing items (with all information mentioned included)
- Style
  - Users might have different styles for different occasions
- Current wardrobe
  - What is their current wardrobe? (In detail)
- Brand Preferences
- Color Preferences
- Are they looking for quality items that last long or are they looking for most fast fashion or both? Include all information about this.
- Main priorities when shopping / using our shopping app. Are they looking to:
  - Find hard to find items?
  - Find the best deals online?
  - Just look good?
  - Save time when shopping?
- What is their price range for shopping? If there is specific prices ranges for different types of items, include all of them.
- Are there specific styles / items the user likes or dislikes?
`,
        },
        {
          role: 'user',
          content: transcript,
        },
      ],
      {
        model: OpenAIModel.O1,
        zodSchema: z.object({
          styleProfile: z.string(),
        }),
      },
    );

    await supabaseDb.pending_register_user_info.upsert({
      where: { email },
      update: {
        transcript,
        first_chat_query: query.trim().length ? query : null,
        generated_bio: styleProfile,
      },
      create: {
        email,
        transcript,
        first_chat_query: query.trim().length ? query : null,
        generated_bio: styleProfile,
      },
    });

    this.logService.info('Pending register user profile created', {
      metadata: { email, query },
    });

    const existingUser = await supabaseDb.public_users.findFirst({
      where: { email },
    });

    if (existingUser) {
      this.logService.info(
        `Updating existing user ${existingUser.id} with generated bio from pending register`,
        {
          metadata: { userId: existingUser.id, email },
        },
      );

      await supabaseDb.public_users.update({
        where: { id: existingUser.id },
        data: {
          generated_profile_description: styleProfile,
          tried_to_populate_generated_bio_from_pending_register_table: true,
          chosen_first_order_query: query.trim().length ? query : null,
        },
      });

      // Invalidate cache for this user
      await this.redisService.del(`user_profile_${existingUser.id}`);
    }
  }

  async getProfiles(userIds: string[]): Promise<UserProfile[]> {
    const profiles = await supabaseDb.public_users.findMany({
      where: { id: { in: userIds } },
    });

    const userSizing = await supabaseDb.user_sizes.findMany({
      where: { id: { in: userIds } },
    });

    const dbUsers = await supabaseDb.users.findMany({
      where: { id: { in: userIds } },
    });

    const userDevices = await supabaseDb.user_devices.findMany({
      where: { user_id: { in: userIds } },
    });

    const stripeSubscriptions = await Promise.all(
      userIds.map(userId => billingService.getStripeSubscription(userId)),
    );

    // Create maps for efficient lookups
    const userSizingMap = new Map(userSizing.map(sizing => [sizing.id, sizing]));
    const dbUsersMap = new Map(dbUsers.map(user => [user.id, user]));
    const userDevicesMap = new Map<string, typeof userDevices>();
    const stripeSubscriptionsMap = new Map<string, StripeSubscription | null>();

    // Group devices by user_id
    userDevices.forEach(device => {
      const existingDevices = userDevicesMap.get(device.user_id);
      if (existingDevices) {
        existingDevices.push(device);
      } else {
        userDevicesMap.set(device.user_id, [device]);
      }
    });

    // Create stripe subscriptions map
    userIds.forEach((userId, index) => {
      stripeSubscriptionsMap.set(userId, stripeSubscriptions[index]);
    });

    return profiles
      .map(profile => {
        const profileDevices = userDevicesMap.get(profile.id) || [];
        const dbUser = dbUsersMap.get(profile.id);

        if (!dbUser) {
          this.logService.warn(`User ${profile.id} not found in users table`);
          return null;
        }

        return this.convertDbUserProfileToUserProfile(
          profile,
          dbUser,
          userSizingMap.get(profile.id) || null,
          profileDevices,
          stripeSubscriptionsMap.get(profile.id) || null,
        );
      })
      .filter((profile): profile is UserProfile => profile !== null);
  }

  async updateStripeCustomerId(userId: string, stripeCustomerId?: string): Promise<void> {
    const requestUser = getRequestUser();
    if (!requestUser) throw new Error('User not found');
    if (
      requestUser.role !== UserRole.USER_ROLE_ADMIN &&
      requestUser.role !== UserRole.USER_ROLE_STYLIST
    ) {
      throw new Error('Unauthorized');
    }

    await supabaseDb.public_users.update({
      where: { id: userId },
      data: { stripe_customer_id: stripeCustomerId ?? undefined },
    });

    // Invalidate cache for this user
    await this.redisService.del(`user_profile_${userId}`);
  }

  async analyzeUserStyle(userId: string): Promise<{
    coreBrands: string[];
    brandAnalysis: string;
    styleAnalysis: string;
    coreStickers: string[];
    preferencesAnalysis?: string;
  }> {
    this.logService.info(`Analyzing user style for userId=${userId}`, {
      metadata: { userId },
    });

    const userProfile = await this.getProfile(userId);
    if (!userProfile) {
      throw new Error(`User ${userId} not found`);
    }

    const stylePickerProducts = await supabaseDb.style_picker_products.findMany({
      where: {
        id: { in: userProfile.stylePickerProductIds },
      },
    });

    const STYLE_ANALYSIS_PROMPT: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `\
    You are a witty fashion expert who writes punchy, first-person insights that read just like these examples:
    
     • "You're drawn to elevated everyday brands like COS and Uniqlo" - brandAnalysis
     • "Your style is a mix of Old Money and Streetwear. We'll go for those classic yet slightly edgy looks." - styleAnalysis
     • "You prefer oversized fits with cropped length. You're also allergic to satin—got it, we'll steer clear." - preferencesAnalysis
    
    When you respond, output **only** valid JSON with the exact keys below:
    
    {
      "coreBrands":        string[]   // 2-3 brand names that suit them best
      "brandAnalysis":     string     // 1 fun sentence, same voice as above
      "styleAnalysis":     string     // 1 fun sentence, same voice as above
      "coreStickers":      string[]   // 1 sticker exact file_name;
      "preferencesAnalysis": string   // OPTIONAL, 1 fun sentence, same voice as above using information from preferencesAndQuirks, empty string if 
    }
    
    Guidelines
    - Address the user as "you," never "they."
    - Keep each sentence < 20 words, light, clever, and conversational.
    - If any field is unknown, return an empty string or empty array.
    - Do **not** add extra keys, commentary, or markdown—just the JSON.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `
    Gender: ${userProfile.metadata?.gender || 'Not specified'}
    Height: ${
      userProfile.metadata?.height ? `${userProfile.metadata.height} inches` : 'Not specified'
    }
    Weight: ${
      userProfile.metadata?.weight ? `${userProfile.metadata.weight} pounds` : 'Not specified'
    }
    What brings you to Fetchr: ${userProfile.whatBringsYouToFetchr || 'Not specified'}
    Preferences and Quirks: ${userProfile.preferencesAndQuirks || 'Not specified'}
    
    These are products that the user has liked:
    ${
      stylePickerProducts
        ?.map(product => {
          const fields = [];
          if (!product.file_name) return '';
          fields.push(product.file_name);
          if (product.description) fields.push(product.description);
          if (product.category) fields.push(`(${product.category})`);
          if (product.brand) fields.push(`by ${product.brand}`);
          return `- ${fields.join(' ')}`;
        })
        .join('\n') || 'No products selected'
    }`,
          },
          ...userProfile.styleImageUrls.map(imageUrl => ({
            type: 'image_url' as const,
            image_url: { url: imageUrl, detail: 'auto' as const },
          })),
        ],
      },
    ];

    this.logService.info('Submitting style analysis prompt to OpenAI', {
      metadata: { prompt: STYLE_ANALYSIS_PROMPT },
    });

    const { styleProfile } = await this.openaiService.submitChatCompletion(STYLE_ANALYSIS_PROMPT, {
      model: OpenAIModel.O1,
      zodSchema: z.object({
        styleProfile: z.object({
          coreBrands: z.array(z.string()),
          brandAnalysis: z.string(),
          styleAnalysis: z.string(),
          coreStickers: z.array(z.string()),
          preferencesAnalysis: z.string().optional(),
        }),
      }),
    });

    // Save the result to the database
    await this.updateProfile(userId, {
      selfonboardedGeneratedStyleDescription: JSON.stringify(styleProfile),
    });

    this.logService.info(`Style analysis completed and saved for userId=${userId}`, {
      metadata: { userId, styleProfile },
    });

    return styleProfile;
  }

  async clearUserCache(userId: string): Promise<void> {
    await this.redisService.del(`user_profile_${userId}`);
  }

  /**
   * Sends a Slack notification when a user selects "Get a Curated Box".
   */
  private async sendCuratedBoxSignupNotification(user: UserProfile): Promise<void> {
    if (process.env.SLACK_ONBOARDING_NOTIFICATION_CHANNEL_ID && user) {
      try {
        await this.slackService.sendMessageWithUserInfo(
          process.env.SLACK_ONBOARDING_NOTIFICATION_CHANNEL_ID,
          '🎁 *New Curated Box Request*',
          {
            id: user.id,
            name: user.name,
            email: user.email,
            phoneNumber: user.phoneNumber,
          },
          {
            userLabel: 'Customer',
          },
        );
      } catch (error) {
        this.logService.error(
          '[handleCuratedBoxNotificationAsync] Failed to send Curated Box signup notification',
          {
            metadata: { userId: user.id },
            error,
          },
        );
      }
    } else {
      this.logService.warn(
        '[handleCuratedBoxNotificationAsync] Possible Error: No notification sent because SLACK_ONBOARDING_NOTIFICATION_CHANNEL_ID is not set or user is not given',
        {
          metadata: { user },
        },
      );
    }
  }

  /**
   * Checks if user just selected curated box and sends notification asynchronously.
   * This runs in the background and doesn't block the main update flow.
   */
  private async handleCuratedBoxNotification(
    userId: string,
    updates: Partial<Omit<UpdateUserProfileRequest, 'userId'>>,
  ): Promise<void> {
    try {
      if (updates.whatBringsYouToFetchr === undefined) {
        return;
      }

      const previousUserRecord = await supabaseDb.public_users.findUnique({
        where: { id: userId },
        select: { what_brings_you_to_fetchr: true },
      });

      const previousEnum = convertDbWhatBringsYouToFetchrToWhatBringsYouToFetchr(
        previousUserRecord?.what_brings_you_to_fetchr ?? null,
      );
      if (
        previousEnum !== updates.whatBringsYouToFetchr &&
        updates.whatBringsYouToFetchr ===
          WhatBringsYouToFetchr.WHAT_BRINGS_YOU_TO_FETCHR_WORK_WITH_STYLIST
      ) {
        // Fetch current user profile for the notification
        const currentProfile = await this.getProfile(userId);
        if (currentProfile) {
          await this.sendCuratedBoxSignupNotification(currentProfile);
        }
      }
    } catch (error) {
      this.logService.error('Error in curated box notification handler', {
        metadata: { userId },
        error,
      });
    }
  }
}
