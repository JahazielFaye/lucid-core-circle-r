export class QuickBooksAdapter {
  async previewInvoice() {
    return { mode: 'preview-only', message: 'QuickBooks integration not activated yet.' };
  }
}
