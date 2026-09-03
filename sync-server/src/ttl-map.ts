/**
 * Map à durée de vie bornée, même pattern que `InMemoryRateLimiter` :
 * les entrées expirent et un sweep périodique les purge. Utilisé pour les
 * compteurs anti-brute-force et les cooldowns, qui sinon croîtraient sans
 * limite (fuite mémoire sur un service plafonné en RAM).
 *
 * Sémantique : `get` sur une entrée expirée renvoie `undefined` (l'entrée est
 * retirée) ; `set` (re)pose le TTL. Pour un compteur de tentatives dont la
 * cible a une durée de vie plus courte que le TTL choisi, une eviction ne fait
 * que réinitialiser le compteur d'une cible déjà morte — sans impact sécurité.
 */
export class TtlMap<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  private readonly sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly ttlMs: number,
    sweepIntervalMs = 300_000,
  ) {
    this.sweepTimer = setInterval(() => this.sweep(), sweepIntervalMs);
    if (this.sweepTimer && typeof this.sweepTimer === "object" && "unref" in this.sweepTimer) {
      (this.sweepTimer as { unref?: () => void }).unref?.();
    }
  }

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
}
