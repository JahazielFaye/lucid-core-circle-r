import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export type CameraDetector = { detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string; format?: string }>> };
export type CameraDetectorConstructor = { new(options: { formats: string[] }): CameraDetector; getSupportedFormats?: () => Promise<string[]> };

/** API presence alone is insufficient: a platform may expose only QR decoding. */
export async function selectCode128Detector(Native?: CameraDetectorConstructor): Promise<CameraDetector | null> {
  if (!Native?.getSupportedFormats) return null;
  try {
    const formats = await Promise.race([Native.getSupportedFormats(), new Promise<string[]>(resolve => setTimeout(() => resolve([]), 1500))]);
    if (!formats.includes('code_128')) return null;
    return new Native({ formats: formats.filter(format => ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'].includes(format)) });
  } catch { return null; }
}

export function cameraDecodeHints() {
  return new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX]],
    [DecodeHintType.TRY_HARDER, true],
    // Preserve the GS1 symbology prefix and embedded FNC1 separators.
    [DecodeHintType.ASSUME_GS1, true],
  ]);
}
