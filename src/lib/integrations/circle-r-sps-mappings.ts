import 'server-only';

/**
 * Temporary, manually maintained mapping records for proving the mapping engine.
 * Replace these sample records with Supabase-backed mappings in a future step.
 */
export type CircleRCustomerMapping = {
  spsTradingPartnerId: string;
  foodConnexCustomerId: string;
  foodConnexCustomerName: string;
};

export type CircleRShipToMapping = {
  spsLocationCode: string;
  foodConnexShipToId: string;
  foodConnexShipToName: string;
};

export type CircleRItemMapping = {
  vendorPartNumber?: string;
  buyerPartNumber?: string;
  gtin?: string;
  foodConnexItemId?: string;
  foodConnexItemNumber: string;
  foodConnexUom?: string;
  approvedCircleRPrice?: number;
};

export type CircleRMappingConfiguration = {
  customers: CircleRCustomerMapping[];
  shipTos: CircleRShipToMapping[];
  items: CircleRItemMapping[];
};

export const circleRMockMappings: CircleRMappingConfiguration = {
  customers: [
    {
      spsTradingPartnerId: 'CHENEY_BROTHERS_INC',
      foodConnexCustomerId: 'sample-customer-cheney-brothers',
      foodConnexCustomerName: 'Cheney Brothers Inc',
    },
  ],
  shipTos: [
    {
      spsLocationCode: 'RIVIERA',
      foodConnexShipToId: 'sample-ship-to-riviera',
      foodConnexShipToName: 'Riviera',
    },
  ],
  items: [
    {
      buyerPartNumber: '000000000010174082',
      vendorPartNumber: '99000',
      foodConnexItemId: 'sample-item-10174082',
      foodConnexItemNumber: '10174082',
      foodConnexUom: 'Case',
      approvedCircleRPrice: 4.99,
    },
    {
      buyerPartNumber: '000000000010133913',
      vendorPartNumber: '034281',
      foodConnexItemId: 'sample-item-10133913',
      foodConnexItemNumber: '10133913',
      foodConnexUom: 'Case',
      approvedCircleRPrice: 11.29,
    },
  ],
};
