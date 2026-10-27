export type CaseLabelData = {
  itemDescription: string;
  itemId: string | null;
  caseIdentifier: string;
  packDate: string;
  productionCode: string | null;
  netWeight: number;
  netWeightUom: string;
  gtin: string | null;
  /** A complete GS1 payload is required before a scannable barcode can be rendered. */
  gs1BarcodeValue: string | null;
  gs1HumanReadable: string | null;
};

/** Hardware-neutral boundary: a future scale/scanner/printer bridge can implement these adapters. */
export interface ProductionFloorAdapter {
  captureWeight(): Promise<number | null>;
  captureCaseIdentifier(): Promise<string | null>;
  printLabel(label: CaseLabelData): Promise<void>;
}

export function renderBrowserCaseLabel(label: CaseLabelData) {
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] || character));
  const unavailable = '<span class="unavailable">Not available</span>';
  const productionCode = label.productionCode ? escape(label.productionCode) : unavailable;
  const itemId = label.itemId ? escape(label.itemId) : unavailable;
  const hasCompleteGs1 = Boolean(label.gs1BarcodeValue && label.gs1HumanReadable);
  const barcode = hasCompleteGs1
    ? `<div class="barcode-data">GS1 barcode rendering is not configured</div><div class="gs1-human">${escape(label.gs1HumanReadable || '')}</div>`
    : '<div class="barcode-unavailable">GS1 barcode data unavailable</div><div class="gs1-human unavailable">No complete GS1 element string is available</div>';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Case label ${escape(label.caseIdentifier)}</title><style>@page{size:4in 2in;margin:0}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;padding:0;color:#000}.label{width:4in;height:2in;padding:.1in .14in;overflow:hidden;background:#fff}.top{display:grid;grid-template-columns:1fr .92in;gap:.08in;align-items:start}.field-label{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.02em}.item-id b{display:block;font-size:18px;line-height:1.05;margin-top:1px}.weight{display:grid;grid-template-columns:.33in 1fr;gap:4px;align-items:end;text-align:left}.weight span{font-size:10px;line-height:1.02;font-weight:700;text-transform:uppercase}.weight b{font-size:20px;line-height:1}.product{font-size:14px;font-weight:700;line-height:1.08;margin:7px 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.details{display:flex;justify-content:space-between;gap:10px;font-size:10px;font-weight:700}.details span{white-space:nowrap}.barcode{height:.54in;margin-top:6px;display:grid;align-content:center;text-align:center;border-top:1px solid #000;border-bottom:1px solid #000}.barcode-unavailable,.barcode-data{font-size:10px;font-weight:700;letter-spacing:.04em}.gs1-human{font-family:monospace;font-size:8px;margin-top:4px}.unavailable{font-style:italic;font-weight:500;color:#555;text-transform:none;letter-spacing:0}@media screen{body{padding:18px;background:#edf0ec}.label{box-shadow:0 2px 15px rgba(0,0,0,.16)}}</style></head><body><section class="label"><div class="top"><div class="item-id"><span class="field-label">Item ID:</span><b>${itemId}</b></div><div class="weight"><span>Net<br>Wg.<br>Lbs</span><b>${label.netWeight.toFixed(2)}</b></div></div><div class="product">${escape(label.itemDescription)}</div><div class="details"><span>Prod Code: ${productionCode}</span><span>PACK ON: ${escape(label.packDate)}</span></div><div class="barcode">${barcode}</div></section></body></html>`;
}

const wait = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

/** Opens and fully renders a standalone label document while the user gesture is still active. */
export function openBrowserCaseLabel(label: CaseLabelData): Window | null {
  const printWindow = window.open('', 'lucid-case-label', 'popup,width=480,height=360');
  if (!printWindow) return null;

  try {
    printWindow.document.open();
    printWindow.document.write(renderBrowserCaseLabel(label));
    printWindow.document.close();
    return printWindow;
  } catch {
    return null;
  }
}

/** Starts the browser print flow only after the standalone label has had a chance to render. */
export async function startBrowserCaseLabelPrint(printWindow: Window): Promise<boolean> {
  if (printWindow.closed) return false;

  await Promise.race([
    new Promise<void>(resolve => {
      if (printWindow.document.readyState === 'complete') resolve();
      else printWindow.addEventListener('load', () => resolve(), { once: true });
    }),
    wait(750),
  ]);

  if (printWindow.closed) return false;
  if (printWindow.document.fonts) {
    await Promise.race([printWindow.document.fonts.ready.then(() => undefined), wait(500)]);
  }
  await new Promise<void>(resolve => printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(() => resolve())));

  try {
    printWindow.focus();
    printWindow.print();
    return true;
  } catch {
    return false;
  }
}
