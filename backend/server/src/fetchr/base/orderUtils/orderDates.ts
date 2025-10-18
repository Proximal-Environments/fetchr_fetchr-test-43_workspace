export interface OrderSuggestionDatesParams {
  isAutoAccepted: boolean;
  isOrderFetchrInitiated: boolean;
  hasValidPayment: boolean;
  isDraftSuggestion: boolean;
}

export interface OrderSuggestionDates {
  verifySuggestionsBy: Date | null;
  expireSuggestionsBy: Date | null;
}

export function getOrderSuggestionDates(params: OrderSuggestionDatesParams): OrderSuggestionDates {
  const { isAutoAccepted, isOrderFetchrInitiated, hasValidPayment, isDraftSuggestion } = params;

  if (!hasValidPayment) {
    return {
      verifySuggestionsBy: null,
      expireSuggestionsBy: null,
    };
  }

  if (isAutoAccepted) {
    return {
      verifySuggestionsBy: new Date(),
      expireSuggestionsBy: null,
    };
  }

  if (isDraftSuggestion) {
    return {
      verifySuggestionsBy: null,
      expireSuggestionsBy: null,
    };
  }

  const endOfDay = (days: number): Date =>
    new Date(new Date().setHours(23, 59, 59, 999) + days * 24 * 60 * 60 * 1000);

  if (isOrderFetchrInitiated) {
    return {
      verifySuggestionsBy: null,
      expireSuggestionsBy: endOfDay(7),
    };
  }

  return {
    verifySuggestionsBy: endOfDay(3),
    expireSuggestionsBy: null,
  };
}
