/** How long someone has been on the platform: 190 000 ms → "3 min 10 s"; under a minute → "42 s". */
export function formatTimeOnPlatform(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds} s`;
  }
  return `${minutes} min ${seconds} s`;
}
