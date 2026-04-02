import type { StealthConfig } from "@gramstep/shared";

export interface StealthModeService {
  calculateJitter(): number;
  applyTextVariation(text: string): string;
}

// Variation patterns: minor punctuation/spacing changes that don't alter meaning
const VARIATION_SUFFIXES = [
  "",
  " ",
  "\u200B", // zero-width space
  "。",
  ".",
  "！",
  "!",
];

const PUNCTUATION_PAIRS: Array<[string, string]> = [
  ["。", "。 "],
  ["、", "， "],
  ["！", "!"],
  ["？", "?"],
];

export function createStealthMode(config: StealthConfig): StealthModeService {
  return {
    calculateJitter(): number {
      if (!config.jitter_enabled) {
        return 0;
      }
      const min = config.jitter_min_seconds;
      const max = config.jitter_max_seconds;
      // Crypto-based random within [min, max]
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      const random = (array[0] ?? 0) / (0xFFFFFFFF + 1);
      return Math.floor(min + random * (max - min + 1));
    },

    applyTextVariation(text: string): string {
      if (!config.variation_enabled || text.length === 0) {
        return text;
      }

      // Apply a random minor variation:
      // 1. Add a random invisible/minor suffix
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);
      const suffixIndex = (array[0] ?? 0) % VARIATION_SUFFIXES.length;
      let result = text + (VARIATION_SUFFIXES[suffixIndex] ?? "");

      // 2. Optionally swap one punctuation mark (low probability)
      crypto.getRandomValues(array);
      if ((array[0] ?? 0) % 3 === 0) {
        for (const [from, to] of PUNCTUATION_PAIRS) {
          if (result.includes(from)) {
            // Only replace the first occurrence
            result = result.replace(from, to);
            break;
          }
        }
      }

      return result;
    },
  };
}
