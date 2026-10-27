import { OrderSourceAdapter } from './base';
import { UnifiedOrder } from '@/lib/core/types';

export class SpsAdapter implements OrderSourceAdapter {
  async listNewOrders(): Promise<UnifiedOrder[]> {
    // TODO: Replace with SPS Transaction API or supported file ingestion.
    // Never store credentials in source control.
    return [];
  }
}
