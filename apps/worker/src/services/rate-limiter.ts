import type { MediaCategory } from "@gramstep/shared";

export const RATE_LIMITS = {
  /** text/image: 公式100の85% */
  TEXT_IMAGE_PER_SECOND: 85,
  /** audio_video: 公式10の85% */
  AUDIO_VIDEO_PER_SECOND: 8,
  /** デフォルト時間窓上限 */
  DEFAULT_HOURLY: 170,
} as const;

export interface RateUsage {
  currentSecond: number;
  maxPerSecond: number;
  currentHour: number;
  maxPerHour: number;
}

export interface RateLimiterService {
  canSend(accountId: string, mediaCategory: MediaCategory): Promise<boolean>;
  recordSend(accountId: string, mediaCategory: MediaCategory): Promise<void>;
  getUsage(accountId: string, mediaCategory?: MediaCategory): Promise<RateUsage>;
}

export interface RateLimiterDeps {
  hourlyLimitOverride?: number;
}

interface SecondBucket {
  count: number;
  /** Unix second (floor of Date.now()/1000) */
  second: number;
}

interface HourlyCounter {
  count: number;
  /** Unix hour (floor of Date.now()/3600000) */
  hour: number;
}

type BucketType = "text_image" | "audio_video";

function bucketTypeFor(mediaCategory: MediaCategory): BucketType {
  return mediaCategory === "audio_video" ? "audio_video" : "text_image";
}

function maxPerSecondFor(mediaCategory: MediaCategory): number {
  return mediaCategory === "audio_video"
    ? RATE_LIMITS.AUDIO_VIDEO_PER_SECOND
    : RATE_LIMITS.TEXT_IMAGE_PER_SECOND;
}

function currentSecond(): number {
  return Math.floor(Date.now() / 1000);
}

function currentHour(): number {
  return Math.floor(Date.now() / 3_600_000);
}

export function createRateLimiter(deps: RateLimiterDeps): RateLimiterService {
  const maxPerHour = deps.hourlyLimitOverride ?? RATE_LIMITS.DEFAULT_HOURLY;

  // Per-account, per-bucket-type second buckets
  const secondBuckets = new Map<string, SecondBucket>();
  // Per-account hourly counters (shared across all media types)
  const hourlyCounters = new Map<string, HourlyCounter>();

  function getSecondBucket(accountId: string, bucket: BucketType): SecondBucket {
    const key = `${accountId}:${bucket}`;
    const now = currentSecond();
    const existing = secondBuckets.get(key);
    if (existing && existing.second === now) {
      return existing;
    }
    const fresh: SecondBucket = { count: 0, second: now };
    secondBuckets.set(key, fresh);
    return fresh;
  }

  function getHourlyCounter(accountId: string): HourlyCounter {
    const now = currentHour();
    const existing = hourlyCounters.get(accountId);
    if (existing && existing.hour === now) {
      return existing;
    }
    const fresh: HourlyCounter = { count: 0, hour: now };
    hourlyCounters.set(accountId, fresh);
    return fresh;
  }

  return {
    async canSend(accountId, mediaCategory) {
      const bucket = getSecondBucket(accountId, bucketTypeFor(mediaCategory));
      const limit = maxPerSecondFor(mediaCategory);
      if (bucket.count >= limit) {
        return false;
      }

      const hourly = getHourlyCounter(accountId);
      if (hourly.count >= maxPerHour) {
        return false;
      }

      return true;
    },

    async recordSend(accountId, mediaCategory) {
      const bucket = getSecondBucket(accountId, bucketTypeFor(mediaCategory));
      bucket.count += 1;

      const hourly = getHourlyCounter(accountId);
      hourly.count += 1;
    },

    async getUsage(accountId, mediaCategory) {
      const cat = mediaCategory ?? "text";
      const bucket = getSecondBucket(accountId, bucketTypeFor(cat));
      const hourly = getHourlyCounter(accountId);

      return {
        currentSecond: bucket.count,
        maxPerSecond: maxPerSecondFor(cat),
        currentHour: hourly.count,
        maxPerHour: maxPerHour,
      };
    },
  };
}
