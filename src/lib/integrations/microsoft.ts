import { DocumentArchiveAdapter } from './base';
import { UnifiedOrder } from '@/lib/core/types';

export class MicrosoftGraphAdapter implements DocumentArchiveAdapter {
  async archiveOrderPacket(_order: UnifiedOrder): Promise<{ url: string }> {
    // TODO: Microsoft Graph / SharePoint archival in centralization phase.
    return { url: 'not-configured' };
  }
}
