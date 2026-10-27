export type IntegrationStatus = 'healthy' | 'attention' | 'offline';

export type OrderLine = {
  externalSku: string;
  vendorItem?: string;
  internalItemId?: string;
  description: string;
  quantityCases: number;
  unitPrice?: number;
  uom: string;
};

export type UnifiedOrder = {
  id: string;
  externalPo: string;
  customer: string;
  shipTo: string;
  requestedShipDate?: string;
  requestedDeliveryDate?: string;
  orderedWeightLb?: number;
  source: 'SPS' | 'Manual' | 'Other';
  foodConnexOrder?: string;
  status: 'new' | 'mapped' | 'exception' | 'production' | 'shipment-ready' | 'complete';
  lines: OrderLine[];
};

export type PalletCase = {
  id: string;
  scannedCode: string;
  weightLb: number;
  itemId?: string;
  description?: string;
  scannedAt: string;
};

export type Pallet = {
  id: string;
  orderId: string;
  label: string;
  caseCount: number;
  weightLb: number;
  itemCount: number;
  status: 'building' | 'complete' | 'shipped';
  cases?: PalletCase[];
  completedAt?: string;
};
