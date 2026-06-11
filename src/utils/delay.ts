export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function delaySeconds(seconds: number): Promise<void> {
  return delay(seconds * 1000);
}
