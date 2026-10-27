import 'server-only';

import type { NormalizedSpsPurchaseOrder } from './sps-po-normalizer';

/**
 * Manually verified Circle R business test data. This fixture is not retrieved
 * from the SPS Sandbox API and is used only to prove mapping behavior.
 */
export const circleRVerifiedPurchaseOrderFixture: NormalizedSpsPurchaseOrder = {
  source: 'sps',
  transactionType: 'PO',
  sourceFile: 'manual-fixture/PO-4511771799.json',
  purchaseOrderNumber: '4511771799',
  purchaseOrderDate: null,
  tradingPartnerId: 'CHENEY_BROTHERS_INC',
  purposeCode: null,
  poTypeCode: null,
  vendor: null,
  department: null,
  division: null,
  shipCompleteCode: null,
  currency: null,
  headerDates: [],
  billTo: {
    locationNumber: null,
    name: 'Cheney Brothers Inc',
    address1: null,
    address2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
  },
  shipTo: {
    locationNumber: 'RIVIERA',
    name: 'Riviera',
    alternateName: null,
    address1: null,
    address2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
  },
  lines: [
    {
      lineNumber: '1',
      buyerPartNumber: '000000000010174082',
      vendorPartNumber: '99000',
      gtin: null,
      consumerPackageCode: null,
      upcCaseCode: null,
      orderQty: 54,
      orderQtyUom: 'Case',
      purchasePrice: 4.99,
      description: null,
      lineDates: [],
    },
    {
      lineNumber: '2',
      buyerPartNumber: '000000000010133913',
      vendorPartNumber: '034281',
      gtin: null,
      consumerPackageCode: null,
      upcCaseCode: null,
      orderQty: 50,
      orderQtyUom: 'Case',
      purchasePrice: 11.19,
      description: null,
      lineDates: [],
    },
  ],
  headerQuantityTotal: 104,
  headerQuantityUom: 'Case',
  totalAmount: 828.96,
  totalLineItemNumber: 2,
  validation: {
    calculatedLineQuantity: 104,
    quantityMatchesHeader: true,
    calculatedExtendedPurchaseAmount: 828.96,
    reportedTotalAmount: 828.96,
  },
};
