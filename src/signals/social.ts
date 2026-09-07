/**
 * Social, done as velocity rather than volume.
 *
 * Total mentions are a lagging indicator — by the time a count is high, the move happened.
 * What carries information is the *second derivative*: mentions accelerating off a low base,
 * weighted by who is talking. So we don't trust any provider's "social score": we sample a
 * raw count on an interval and differentiate it ourselves. Any source that can answer
 * "how many quality mentions right now" plugs in unchanged.
 */

export interface SocialSample { at: number; mentions: number; qualityMentions: number }

export interface SocialSource {
  readonly name: string;
  /** Current mention counts for a token, or null when the source has no coverage. */
  sample(symbolOrAddress: string): Promise<{ mentions: number; qualityMentions: number } | null>;
}

/** Default. No social input rather than fabricated social input. */
export class NullSocialSource implements SocialSource {
  readonly name = "none";
  async sample() { return null; }
}

/**
 * Generic HTTP adapter. Point SOCIAL_API_URL at any endpoint that returns a mention count
 * (X API v2 recent counts, LunarCrush, TweetScout, your own scraper) and map it with
 * SOCIAL_MENTIONS_PATH / SOCIAL_QUALITY_PATH. Kept vendor-neutral on purpose: every one of
 * these APIs is paid, rate-limited, and changes shape, and none is worth coupling the bot to.
 */
export class HttpSocialSource implements SocialSource {
  readonly name = "http";
  private url: string;
  private key: string;
  private mentionsPath: string;
  private qualityPath: string;

  constructor(
    url: string,
    key = process.env.SOCIAL_API_KEY ?? "",
    mentionsPath = process.env.SOCIAL_MENTIONS_PATH ?? "mentions",
    qualityPath = process.env.SOCIAL_QUALITY_PATH ?? "quality_mentions",
  ) {
    this.url = url;
    this.key = key;
    this.mentionsPath = mentionsPath;
    this.qualityPath = qualityPath;
  }

  async sample(token: string) {
    try {
      const res = await fetch(this.url.replace("{token}", encodeURIComponent(token)), {
        headers: this.key ? { authorization: `Bearer ${this.key}` } : {},
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) return null;
      const body = await res.json();
      const mentions = Number(pluck(body, this.mentionsPath) ?? 0);
      const quality = Number(pluck(body, this.qualityPath) ?? mentions);
      return Number.isFinite(mentions) ? { mentions, qualityMentions: quality } : null;
    } catch { return null; }
  }
}

const pluck = (o: any, path: string) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

export interface Velocity {
  /** Mentions per minute, most recent interval. */
  rate: number;
  /** Change in that rate — the actual signal. */
  acceleration: number;
  /** Acceleration expressed in standard deviations of this token's own history. */
  z: number;
  samples: number;
}

/** Keeps a short per-token series and differentiates it. */
export class SocialTracker {
  private series = new Map<string, SocialSample[]>();
  private source: SocialSource;
  private keep: number;

  constructor(source: SocialSource, keep = 30) {
    this.source = source;
    this.keep = keep;
  }

  get enabled() { return this.source.name !== "none"; }

  async poll(token: string): Promise<Velocity | null> {
    const s = await this.source.sample(token);
    if (!s) return null;
    const arr = this.series.get(token) ?? [];
    arr.push({ at: Date.now(), mentions: s.mentions, qualityMentions: s.qualityMentions });
    while (arr.length > this.keep) arr.shift();
    this.series.set(token, arr);
    return velocity(arr);
  }

  latest(token: string): Velocity | null {
    const arr = this.series.get(token);
    return arr ? velocity(arr) : null;
  }
}

export function velocity(samples: SocialSample[]): Velocity | null {
  if (samples.length < 3) return null;
  const rates: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    const minutes = Math.max(1 / 60, (b.at - a.at) / 60_000);
    rates.push((b.qualityMentions - a.qualityMentions) / minutes);
  }
  const rate = rates.at(-1)!;
  const prev = rates.at(-2) ?? 0;
  const acceleration = rate - prev;

  const mean = rates.reduce((x, y) => x + y, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((x, y) => x + (y - mean) ** 2, 0) / rates.length) || 1;
  return { rate, acceleration, z: acceleration / sd, samples: samples.length };
}
