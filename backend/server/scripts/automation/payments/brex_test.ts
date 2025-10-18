import { brexService } from '../../../src/fetchr/base/service_injection/global';

// Example usage:
async function createCardForUser(): Promise<void> {
  try {
    // Create card
    // const spendLimits = await brexService.listSpendLimits();
    // console.log(spendLimits);
    const card = await brexService.createTemporaryVirtualCard();

    // Get card details
    const cardDetails = await brexService.getCard(card.id);
    console.log(cardDetails);

    await brexService.lockCard(card.id);

    // Later, terminate the card if needed
    await brexService.terminateCardWithSpendLimit(card.id, 'DO_NOT_NEED_VIRTUAL_CARD');
  } catch (error) {
    console.error('Failed to process Brex card operations:', error);
  }
}

createCardForUser();
