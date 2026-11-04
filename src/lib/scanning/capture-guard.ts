/** Pure scanner-input guardrails, kept independent of browser APIs for regression tests. */
export function shouldQueueNoSuffixScan(rapidCharacterCount: number) {
  return rapidCharacterCount >= 4;
}

export function isDuplicateScan(previous: { value: string; at: number } | null, value: string, now: number, cooldownMs = 900) {
  return Boolean(previous && previous.value === value && now - previous.at < cooldownMs);
}
