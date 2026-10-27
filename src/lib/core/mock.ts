import { UnifiedOrder, Pallet } from './types';

export const orders: UnifiedOrder[] = [
  {
    id: 'ord-4511771799',
    externalPo: '4511771799',
    customer: 'Cheney Brothers Inc',
    shipTo: 'Riviera',
    requestedShipDate: '2026-10-22',
    requestedDeliveryDate: '2026-10-24',
    orderedWeightLb: 1847.5,
    source: 'SPS',
    foodConnexOrder: '20929',
    status: 'exception',
    lines: [
      { externalSku: '000000000010174082', vendorItem: '99000', internalItemId: '10174082', description: 'D.D. Fully Cooked Pork Belly', quantityCases: 54, unitPrice: 4.99, uom: 'CS' },
      { externalSku: '000000000010133913', vendorItem: '034281', internalItemId: '10133913', description: 'D.D. Fully Cooked Beef Brisket', quantityCases: 50, unitPrice: 11.19, uom: 'CS' }
    ]
  }
];

export const pallets: Pallet[] = [
  { id: 'plt-001', orderId: 'ord-4511771799', label: 'Pallet 1', caseCount: 27, weightLb: 412.5, itemCount: 1, status: 'building' },
  { id: 'plt-002', orderId: 'ord-4511771799', label: 'Pallet 2', caseCount: 0, weightLb: 0, itemCount: 0, status: 'building' }
];
