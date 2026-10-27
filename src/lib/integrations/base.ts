import { UnifiedOrder } from '@/lib/core/types';

export interface OrderSourceAdapter {
  listNewOrders(): Promise<UnifiedOrder[]>;
}

export interface OrderTargetAdapter {
  previewCreateOrder(order: UnifiedOrder): Promise<unknown>;
  createOrder(order: UnifiedOrder): Promise<{ externalId: string }>;
}

export interface DocumentArchiveAdapter {
  archiveOrderPacket(order: UnifiedOrder): Promise<{ url: string }>;
}
