import { OrderTargetAdapter } from './base';
import { UnifiedOrder } from '@/lib/core/types';

export class FoodConnexAdapter implements OrderTargetAdapter {
  async previewCreateOrder(order: UnifiedOrder) {
    return {
      ExternalId: order.id,
      DateNeeded: order.requestedShipDate,
      PoNumber: order.externalPo,
      lines: order.lines.map(line => ({
        Item: { Id: line.internalItemId },
        Quantity: line.quantityCases,
        UOM: line.uom,
      }))
    };
  }

  async createOrder(_order: UnifiedOrder): Promise<{ externalId: string }> {
    throw new Error('LIVE WRITES DISABLED. Enable only after sandbox/approved test validation.');
  }
}
