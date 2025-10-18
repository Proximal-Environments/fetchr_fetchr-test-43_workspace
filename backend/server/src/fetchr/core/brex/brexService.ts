import { injectable } from "inversify";
import axios from "axios";
import * as crypto from "crypto";
import { BaseService } from "../../base/service_injection/baseService";
import { Card } from "@fetchr/schema/base/base";
import { logService } from "../../base/logging/logService";
export interface BrexCardCreateParams {
  limitInDollars?: number;
  duration?: "ONE_TIME" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  reason?: string;
  lockAfterDate?: string;
}

export type BrexTerminateReason =
  | "DO_NOT_NEED_VIRTUAL_CARD"
  | "CARD_DAMAGED"
  | "CARD_LOST"
  | "CARD_NOT_RECEIVED"
  | "DO_NOT_NEED_PHYSICAL_CARD"
  | "FRAUD"
  | "OTHER";

/**
 * Interface for budget termination reason
 */
export enum BrexBudgetTerminateReason {
  BUDGET_NO_LONGER_NEEDED = "BUDGET_NO_LONGER_NEEDED",
  EMPLOYEE_LEFT = "EMPLOYEE_LEFT",
  ERROR_IN_SETUP = "ERROR_IN_SETUP",
  OTHER = "OTHER",
}

interface BrexCardOwner {
  type: "USER";
  user_id: string;
}

interface BrexCardSpendControls {
  spend_limit?: {
    amount?: number;
    currency?: string;
  };
  spend_available?: {
    amount?: number;
    currency?: string;
  };
  spend_duration?: "ONE_TIME" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  reason?: string;
  lock_after_date?: string;
}

interface BrexAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  phone_number?: string;
}

interface BrexCardResponse {
  id: string;
  owner: BrexCardOwner;
  status: "ACTIVE" | "INACTIVE" | "TERMINATED";
  last_four: string;
  card_name: string;
  card_type: "VIRTUAL" | "PHYSICAL";
  limit_type: "CARD" | "USER";
  spend_controls?: BrexCardSpendControls;
  billing_address?: BrexAddress;
  mailing_address?: BrexAddress;
  expiration_date: {
    month: number;
    year: number;
  };
  has_been_transferred: boolean;
  metadata?: Record<string, string>;
  budget_id?: string;
}

interface BrexCardDetailsResponse {
  id: string;
  number: string;
  cvv: string;
  expiration_date: {
    month: number;
    year: number;
  };
  holder_name: string;
}

interface BrexCardFullDetails extends BrexCardResponse {
  card_details?: BrexCardDetailsResponse;
}

@injectable()
export class BrexService extends BaseService {
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly DEFAULT_BUDGET_ID = "budget_cm9j47ba50bjk0g95njmbmb81";

  constructor() {
    super("BrexService", logService);

    this.apiUrl = "https://platform.brexapis.com";
    this.apiToken = process.env.BREX_API_TOKEN ?? "";

    if (!this.apiToken) {
      this.logService.error("Missing BREX_API_TOKEN environment variable");
    }
  }

  private getDefaultCardCreateParams(): BrexCardCreateParams {
    return {
      limitInDollars: 1000,
      duration: "ONE_TIME",
      lockAfterDate: this.calculateExpirationDate(7),
    };
  }

  private generateIdempotencyKey(): string {
    return crypto.randomUUID();
  }

  /**
   * Find a Brex user by their email address
   */
  async findUserByEmail(email: string): Promise<string> {
    try {
      const response = await axios({
        method: "GET",
        url: `${this.apiUrl}/v2/users`,
        params: { email },
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
        },
      });

      const users = response.data.items;
      if (!users || users.length === 0) {
        throw new Error(`No user found with email: ${email}`);
      }

      this.logService.info(`Found Brex user with email: ${email}`, {
        metadata: { userId: users[0].id },
      });

      return users[0].id;
    } catch (error) {
      this.logService.error("Failed to find Brex user", {
        metadata: { email },
        error: error as Error,
      });
      throw error;
    }
  }

  /**
   * Create a new virtual card for a user
   */
  async createTemporaryVirtualCard(
    {
      limitInDollars = 1000,
      duration = "ONE_TIME",
      lockAfterDate = this.calculateExpirationDate(7),
    }: BrexCardCreateParams = this.getDefaultCardCreateParams()
  ): Promise<{ id: string }> {
    const cardName = "Calvin Chen";
    const userId = await this.findUserByEmail("calvin@usecaptivated.com");
    try {
      const requestBody = {
        owner: {
          type: "USER",
          user_id: userId,
        },
        card_name: cardName,
        card_type: "VIRTUAL",
        limit_type: "CARD",
        spend_controls: {
          spend_limit: {
            amount: limitInDollars * 100,
            currency: "USD",
          },
          spend_duration: duration,
          lock_after_date: lockAfterDate,
          //   parent_budget_id: this.DEFAULT_BUDGET_ID,
        },
      };

      const response = await axios({
        method: "POST",
        url: `${this.apiUrl}/v2/cards`,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": this.generateIdempotencyKey(),
          Accept: "application/json",
        },
        data: requestBody,
      });

      this.logService.info("Created virtual card successfully", {
        metadata: {
          cardId: response.data.id,
          userId,
          cardName,
          //   budgetId: this.DEFAULT_BUDGET_ID,
        },
      });

      return response.data;
    } catch (error) {
      this.logService.error("Failed to create virtual card", {
        metadata: {
          userId,
          cardName,
          //   budgetId: this.DEFAULT_BUDGET_ID,
        },
        error: error as Error,
      });
      throw error;
    }
  }

  /**
   * Terminate an existing virtual card
   */
  async terminateCard(
    cardId: string,
    reason: BrexTerminateReason
  ): Promise<void> {
    try {
      await axios({
        method: "POST",
        url: `${this.apiUrl}/v2/cards/${cardId}/terminate`,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": this.generateIdempotencyKey(),
          Accept: "application/json",
        },
        data: { reason },
      });

      this.logService.info("Terminated card successfully", {
        metadata: { cardId, reason },
      });
    } catch (error) {
      this.logService.error("Failed to terminate card", {
        metadata: { cardId, reason },
        error: error as Error,
      });
      throw error;
    }
  }

  private async getCardWithBrexDetails(
    cardId: string,
    includeSensitiveDetails = false
  ): Promise<BrexCardFullDetails> {
    try {
      // Get basic card information
      const response = await axios({
        method: "GET",
        url: `${this.apiUrl}/v2/cards/${cardId}`,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
        },
      });

      const cardInfo: BrexCardFullDetails = response.data;

      // Validate and log address information
      if (cardInfo.billing_address) {
        this.logService.info("Card has billing address", {
          metadata: {
            cardId,
            city: cardInfo.billing_address.city,
            state: cardInfo.billing_address.state,
            country: cardInfo.billing_address.country,
          },
        });
      }

      if (cardInfo.mailing_address) {
        this.logService.info("Card has mailing address", {
          metadata: {
            cardId,
            city: cardInfo.mailing_address.city,
            state: cardInfo.mailing_address.state,
            country: cardInfo.mailing_address.country,
          },
        });
      }

      // If requested, fetch and attach sensitive card details
      if (includeSensitiveDetails) {
        try {
          const cardDetails = await this.getCardDetails(cardId);
          cardInfo.card_details = cardDetails;
        } catch (error) {
          this.logService.warn("Failed to fetch sensitive card details", {
            metadata: { cardId },
            error: error as Error,
          });
          // Continue without sensitive details
        }
      }

      this.logService.info("Retrieved card information successfully", {
        metadata: {
          cardId,
          cardName: cardInfo.card_name,
          lastFour: cardInfo.last_four,
          status: cardInfo.status,
          hasBillingAddress: !!cardInfo.billing_address,
          hasMailingAddress: !!cardInfo.mailing_address,
          includedSensitiveDetails: includeSensitiveDetails,
        },
      });

      return cardInfo;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const traceId = error.response?.headers["x-brex-trace-id"];

        if (status === 403) {
          this.logService.error(
            "Permission denied: Missing cards.readonly or cards scope",
            {
              metadata: { cardId },
              error: error as Error,
            }
          );
        } else {
          this.logService.error("Failed to get card information", {
            metadata: {
              cardId,
              status,
              traceId,
              errorMessage: error.response?.data?.message,
            },
            error: error as Error,
          });
        }
      } else {
        this.logService.error("Unexpected error getting card information", {
          metadata: { cardId },
          error: error as Error,
        });
      }
      throw error;
    }
  }

  /**
   * Get complete card information including metadata, addresses, and optional sensitive details
   * @param cardId The ID of the card
   * @param includeSensitiveDetails Whether to include sensitive card details (number, CVV)
   */
  async getCard(cardId: string): Promise<Card> {
    const cardInfo = await this.getCardWithBrexDetails(cardId, true);

    function addressToString(address: BrexAddress): string {
      const parts = [
        address.line1,
        address.line2,
        `${address.city}, ${address.state} ${address.postal_code}`,
      ].filter(Boolean);
      return parts.join(", ");
    }

    if (!cardInfo.card_details?.holder_name) {
      this.logService.error("Card details missing holder name", {
        metadata: { cardId },
      });
      throw new Error("Card details missing holder name");
    }

    if (!cardInfo.card_details?.number) {
      this.logService.error("Card details missing number", {
        metadata: { cardId },
      });
      throw new Error("Card details missing number");
    }

    if (!cardInfo.card_details?.cvv) {
      this.logService.error("Card details missing CVV", {
        metadata: { cardId },
      });
      throw new Error("Card details missing CVV");
    }

    if (!cardInfo.expiration_date) {
      this.logService.error("Card details missing expiration date", {
        metadata: { cardId },
      });
      throw new Error("Card details missing expiration date");
    }

    if (!cardInfo.budget_id) {
      this.logService.error("Card details missing budget ID", {
        metadata: { cardId },
      });
      throw new Error("Card details missing budget ID");
    }

    if (!cardInfo.billing_address) {
      this.logService.error("Card details missing billing address", {
        metadata: { cardId },
      });
      throw new Error("Card details missing billing address");
    }

    return {
      id: cardInfo.id,
      holderName: cardInfo.card_details?.holder_name ?? "",
      expirationDate: cardInfo.expiration_date,
      billingAddress: cardInfo.billing_address
        ? addressToString(cardInfo.billing_address)
        : "",
      mailingAddress: cardInfo.mailing_address
        ? addressToString(cardInfo.mailing_address)
        : "",
      cardNumber: cardInfo.card_details?.number ?? "",
      cvv: cardInfo.card_details?.cvv ?? "",
    };
  }

  /**
   * Get card number, CVV, and expiration date of a card by ID
   * @param cardId The ID of the card
   * @returns Card details including number, CVV, expiration date and holder name
   */
  private async getCardDetails(cardId: string): Promise<{
    id: string;
    number: string;
    cvv: string;
    expiration_date: {
      month: number;
      year: number;
    };
    holder_name: string;
  }> {
    try {
      const response = await axios({
        method: "GET",
        url: `${this.apiUrl}/v2/cards/${cardId}/pan`,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
        },
      });

      const cardDetails = response.data;
      if (
        !cardDetails.number ||
        !cardDetails.cvv ||
        !cardDetails.expiration_date ||
        !cardDetails.holder_name
      ) {
        throw new Error("Invalid card details response from Brex API");
      }

      this.logService.info("Retrieved card details successfully", {
        metadata: {
          cardId,
          lastFour: cardDetails.number.slice(-4),
          expirationMonth: cardDetails.expiration_date.month,
          expirationYear: cardDetails.expiration_date.year,
          holderName: cardDetails.holder_name,
        },
      });

      return {
        id: cardDetails.id,
        number: cardDetails.number,
        cvv: cardDetails.cvv,
        expiration_date: {
          month: cardDetails.expiration_date.month,
          year: cardDetails.expiration_date.year,
        },
        holder_name: cardDetails.holder_name,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const traceId = error.response?.headers["x-brex-trace-id"];

        if (status === 403) {
          this.logService.error(
            "Permission denied: Missing cards.readonly or cards scope",
            {
              metadata: { cardId },
              error: error as Error,
            }
          );
        } else {
          this.logService.error("Failed to get card details", {
            metadata: {
              cardId,
              status,
              traceId,
              errorMessage: error.response?.data?.message,
            },
            error: error as Error,
          });
        }
      } else {
        this.logService.error("Unexpected error getting card details", {
          metadata: { cardId },
          error: error as Error,
        });
      }
      throw error;
    }
  }

  /**
   * Lock an existing card
   * @param cardId The ID of the card to lock
   * @param reason The reason for locking the card
   * @param description Optional description for locking the card
   */
  async lockCard(
    cardId: string,
    reason: BrexTerminateReason = "DO_NOT_NEED_VIRTUAL_CARD",
    description?: string
  ): Promise<BrexCardResponse> {
    try {
      const response = await axios({
        method: "POST",
        url: `${this.apiUrl}/v2/cards/${cardId}/lock`,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": this.generateIdempotencyKey(),
          Accept: "application/json",
        },
        data: {
          reason,
          description,
        },
      });

      this.logService.info("Locked card successfully", {
        metadata: {
          cardId,
          reason,
          description,
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const traceId = error.response?.headers["x-brex-trace-id"];

        this.logService.error("Failed to lock card", {
          metadata: {
            cardId,
            reason,
            description,
            status,
            traceId,
            errorMessage: error.response?.data?.message,
          },
          error: error as Error,
        });
      } else {
        this.logService.error("Unexpected error locking card", {
          metadata: {
            cardId,
            reason,
            description,
          },
          error: error as Error,
        });
      }
      throw error;
    }
  }

  /**
   * Calculate an expiration date N months from now
   */
  calculateExpirationDate(months: number): string {
    const now = new Date();
    const expirationDate = new Date(
      now.getTime() + months * 30 * 24 * 60 * 60 * 1000
    );
    return expirationDate.toISOString().split("T")[0];
  }

  /**
   * Archive a spend limit
   * @param budgetId The ID of the spend limit to archive
   * @param reason The reason for archiving
   */
  async terminateSpendLimit(
    budgetId: string,
    reason: BrexBudgetTerminateReason
  ): Promise<void> {
    try {
      await axios({
        method: "POST",
        url: `${this.apiUrl}/v2/spend_limits/${budgetId}/archive`,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
          "Idempotency-Key": this.generateIdempotencyKey(),
          Accept: "application/json",
        },
      });

      this.logService.info("Archived spend limit successfully", {
        metadata: { spendLimitId: budgetId, reason },
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const traceId = error.response?.headers["x-brex-trace-id"];

        this.logService.error("Failed to archive spend limit", {
          metadata: {
            spendLimitId: budgetId,
            reason,
            status,
            traceId,
            errorMessage: error.response?.data?.message,
          },
          error: error as Error,
        });
      } else {
        this.logService.error("Unexpected error archiving spend limit", {
          metadata: { spendLimitId: budgetId, reason },
          error: error as Error,
        });
      }
      throw error;
    }
  }

  /**
   * Terminate both a card and its associated budget
   * @param cardId The ID of the card to terminate
   * @param budgetId The ID of the associated budget
   * @param cardReason The reason for card termination
   * @param budgetReason The reason for budget termination
   */
  async terminateCardWithSpendLimit(
    cardId: string,
    cardReason: BrexTerminateReason = "DO_NOT_NEED_VIRTUAL_CARD",
    budgetReason: BrexBudgetTerminateReason = BrexBudgetTerminateReason.BUDGET_NO_LONGER_NEEDED
  ): Promise<void> {
    try {
      const card = await this.getCardWithBrexDetails(cardId, true);
      // Terminate both in parallel for efficiency
      await Promise.all([
        this.terminateCard(cardId, cardReason),
        card.budget_id &&
          this.terminateSpendLimit(card.budget_id, budgetReason),
      ]);

      this.logService.info("Successfully terminated both card and budget", {
        metadata: {
          cardId,
          cardReason,
          budgetReason,
        },
      });
    } catch (error) {
      this.logService.error("Failed to terminate card and/or budget", {
        metadata: {
          cardId,
          cardReason,
          budgetReason,
        },
        error: error as Error,
      });
      throw error;
    }
  }

  /**
   * List all budgets with optional pagination
   * @param cursor Optional cursor for pagination
   * @param limit Optional limit for number of results per page
   * @returns List of budgets and next cursor if available
   */
  async listBudgets(
    cursor?: string,
    limit?: number
  ): Promise<{
    next_cursor?: string;
    items: Array<{
      budget_id: string;
      account_id: string;
      name: string;
      description: string;
      parent_budget_id: string;
      owner_user_ids: string[];
      period_recurrence_type: "MONTHLY" | "QUARTERLY" | "YEARLY" | "ONE_TIME";
      start_date?: string;
      end_date?: string;
      amount: {
        amount: number;
        currency: string;
      };
      spend_budget_status: "ACTIVE" | "ARCHIVED";
      limit_type: "HARD" | "SOFT";
    }>;
  }> {
    try {
      const params: Record<string, string | number> = {};
      if (cursor) params.cursor = cursor;
      if (limit) params.limit = limit;

      const response = await axios({
        method: "GET",
        url: `${this.apiUrl}/v2/budgets`,
        params,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
        },
      });

      this.logService.info("Retrieved budgets list successfully", {
        metadata: {
          itemCount: response.data.items?.length ?? 0,
          hasNextPage: !!response.data.next_cursor,
        },
      });

      return {
        next_cursor: response.data.next_cursor,
        items: response.data.items || [],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const traceId = error.response?.headers["x-brex-trace-id"];

        if (status === 403) {
          this.logService.error(
            "Permission denied: Missing budgets.readonly or budgets scope",
            {
              metadata: { cursor, limit },
              error: error as Error,
            }
          );
        } else {
          this.logService.error("Failed to list budgets", {
            metadata: {
              cursor,
              limit,
              status,
              traceId,
              errorMessage: error.response?.data?.message,
            },
            error: error as Error,
          });
        }
      } else {
        this.logService.error("Unexpected error listing budgets", {
          metadata: { cursor, limit },
          error: error as Error,
        });
      }
      throw error;
    }
  }

  /**
   * List all spend limits with optional pagination
   * @param cursor Optional cursor for pagination
   * @param limit Optional limit for number of results per page
   * @returns List of spend limits and next cursor if available
   */
  async listSpendLimits(
    cursor?: string,
    limit?: number
  ): Promise<{
    next_cursor?: string;
    items: Array<{
      budget_id: string;
      account_id: string;
      creator_user_id: string;
      name: string;
      description: string;
      parent_budget_id: string;
      owner_user_ids: string[];
      member_user_ids: string[];
      period_type: "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY" | "ONE_TIME";
      start_date?: string;
      end_date?: string;
      limit: {
        amount: number;
        currency: string;
      };
      budget_status: "APPROVED" | "ARCHIVED";
      limit_type: "HARD" | "SOFT";
      spend_type:
        | "BUDGET_PROVISIONED_CARDS_ONLY"
        | "NON_BUDGET_PROVISIONED_CARDS_ALLOWED";
      current_period_balance?: {
        start_date: string;
        end_date: string;
        balance: {
          amount: number;
          currency: string;
        };
      };
      limit_visibility: "SHARED" | "PRIVATE";
      budget_type: "BUDGET";
    }>;
  }> {
    try {
      const params: Record<string, string | number> = {};
      if (cursor) params.cursor = cursor;
      if (limit) params.limit = limit;

      const response = await axios({
        method: "GET",
        url: `${this.apiUrl}/v1/budgets`,
        params,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
        },
      });

      this.logService.info("Retrieved spend limits list successfully", {
        metadata: {
          itemCount: response.data.items?.length ?? 0,
          hasNextPage: !!response.data.next_cursor,
        },
      });

      return {
        next_cursor: response.data.next_cursor,
        items: response.data.items || [],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const traceId = error.response?.headers["x-brex-trace-id"];

        if (status === 403) {
          this.logService.error(
            "Permission denied: Missing budgets.readonly or budgets scope",
            {
              metadata: { cursor, limit },
              error: error as Error,
            }
          );
        } else {
          this.logService.error("Failed to list spend limits", {
            metadata: {
              cursor,
              limit,
              status,
              traceId,
              errorMessage: error.response?.data?.message,
            },
            error: error as Error,
          });
        }
      } else {
        this.logService.error("Unexpected error listing spend limits", {
          metadata: { cursor, limit },
          error: error as Error,
        });
      }
      throw error;
    }
  }
}
