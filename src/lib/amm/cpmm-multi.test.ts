import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  outcomeProbability,
  allProbabilities,
  buyShares,
  sellShares,
  previewMultiTrade,
  previewMultiSell,
  createMultiPool,
  totalPool,
} from './cpmm-multi';

function d(n: number | string): Decimal {
  return new Decimal(n);
}

function makePool(values: Record<string, number>): Map<string, Decimal> {
  const m = new Map<string, Decimal>();
  for (const [k, v] of Object.entries(values)) {
    m.set(k, d(v));
  }
  return m;
}

function computeK(pools: Map<string, Decimal>): Decimal {
  let k = d(1);
  for (const p of pools.values()) {
    k = k.mul(p);
  }
  return k;
}

describe('CPMM Multi', () => {
  describe('createMultiPool', () => {
    it('creates equal pools for 3 outcomes', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      expect(pool.get('a')!.toNumber()).toBe(300);
      expect(pool.get('b')!.toNumber()).toBe(300);
      expect(pool.get('c')!.toNumber()).toBe(300);
    });

    it('creates equal pools for 5 outcomes', () => {
      const pool = createMultiPool(d(1000), ['a', 'b', 'c', 'd', 'e']);
      expect(pool.get('a')!.toNumber()).toBe(200);
    });

    it('throws on zero liquidity', () => {
      expect(() => createMultiPool(d(0), ['a', 'b'])).toThrow('Liquidity must be positive');
    });

    it('throws on fewer than 2 outcomes', () => {
      expect(() => createMultiPool(d(100), ['a'])).toThrow('Need at least 2 outcomes');
    });

    it('throws on more than 10 outcomes', () => {
      const ids = Array.from({ length: 11 }, (_, i) => String(i));
      expect(() => createMultiPool(d(100), ids)).toThrow('Maximum 10 outcomes');
    });
  });

  describe('probabilities', () => {
    it('equal pools give equal probabilities', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const probs = allProbabilities(pool);
      for (const p of probs.values()) {
        expect(p.toDecimalPlaces(10).toNumber()).toBeCloseTo(1 / 3, 8);
      }
    });

    it('probabilities sum to 1 for 3 outcomes', () => {
      const pool = makePool({ a: 200, b: 400, c: 600 });
      const probs = allProbabilities(pool);
      let sum = d(0);
      for (const p of probs.values()) {
        sum = sum.add(p);
      }
      expect(sum.toDecimalPlaces(10).toNumber()).toBe(1);
    });

    it('probabilities sum to 1 for 5 outcomes', () => {
      const pool = makePool({ a: 100, b: 200, c: 300, d: 400, e: 500 });
      const probs = allProbabilities(pool);
      let sum = d(0);
      for (const p of probs.values()) {
        sum = sum.add(p);
      }
      expect(sum.toDecimalPlaces(10).toNumber()).toBe(1);
    });

    it('lower pool = higher probability', () => {
      const pool = makePool({ a: 100, b: 300, c: 500 });
      const probs = allProbabilities(pool);
      expect(probs.get('a')!.gt(probs.get('b')!)).toBe(true);
      expect(probs.get('b')!.gt(probs.get('c')!)).toBe(true);
    });

    it('outcomeProbability matches allProbabilities', () => {
      const pool = makePool({ a: 100, b: 300, c: 500 });
      const probs = allProbabilities(pool);
      expect(outcomeProbability(pool, 'a').eq(probs.get('a')!)).toBe(true);
      expect(outcomeProbability(pool, 'b').eq(probs.get('b')!)).toBe(true);
    });

    it('throws on unknown outcome', () => {
      const pool = makePool({ a: 100, b: 200 });
      expect(() => outcomeProbability(pool, 'z')).toThrow('Unknown outcome');
    });
  });

  describe('buyShares', () => {
    it('buying increases target probability', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const probBefore = outcomeProbability(pool, 'a');
      const result = buyShares(pool, 'a', d(100));
      expect(result.newProbabilities.get('a')!.gt(probBefore)).toBe(true);
    });

    it('shares received is positive', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const result = buyShares(pool, 'a', d(50));
      expect(result.sharesReceived.gt(0)).toBe(true);
    });

    it('maintains constant product invariant (3 outcomes)', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const kBefore = computeK(pool);
      const result = buyShares(pool, 'a', d(100));
      const kAfter = computeK(result.newPools);
      expect(kAfter.toDecimalPlaces(4).eq(kBefore.toDecimalPlaces(4))).toBe(true);
    });

    it('maintains constant product invariant (5 outcomes)', () => {
      const pool = createMultiPool(d(1000), ['a', 'b', 'c', 'd', 'e']);
      const kBefore = computeK(pool);
      const result = buyShares(pool, 'c', d(75));
      const kAfter = computeK(result.newPools);
      expect(kAfter.toDecimalPlaces(4).eq(kBefore.toDecimalPlaces(4))).toBe(true);
    });

    it('new probabilities sum to 1', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const result = buyShares(pool, 'a', d(100));
      let sum = d(0);
      for (const p of result.newProbabilities.values()) {
        sum = sum.add(p);
      }
      expect(sum.toDecimalPlaces(10).toNumber()).toBe(1);
    });

    it('non-target pools increase', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const result = buyShares(pool, 'a', d(100));
      // b and c pools should have increased
      expect(result.newPools.get('b')!.gt(pool.get('b')!)).toBe(true);
      expect(result.newPools.get('c')!.gt(pool.get('c')!)).toBe(true);
    });

    it('target pool decreases', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const result = buyShares(pool, 'a', d(100));
      expect(result.newPools.get('a')!.lt(pool.get('a')!)).toBe(true);
    });

    it('throws on zero amount', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      expect(() => buyShares(pool, 'a', d(0))).toThrow('Token amount must be positive');
    });

    it('throws on unknown outcome', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      expect(() => buyShares(pool, 'z', d(100))).toThrow('Unknown outcome');
    });
  });

  describe('sellShares', () => {
    it('sell returns positive tokens', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const buyResult = buyShares(pool, 'a', d(100));
      const sellResult = sellShares(buyResult.newPools, 'a', buyResult.sharesReceived);
      expect(sellResult.tokensReceived.gt(0)).toBe(true);
    });

    it('selling decreases target probability', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const buyResult = buyShares(pool, 'a', d(100));
      const probBefore = outcomeProbability(buyResult.newPools, 'a');
      const sellResult = sellShares(buyResult.newPools, 'a', d(20));
      expect(sellResult.newProbabilities.get('a')!.lt(probBefore)).toBe(true);
    });

    it('maintains constant product invariant', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const buyResult = buyShares(pool, 'a', d(100));
      const kBefore = computeK(buyResult.newPools);
      const sellResult = sellShares(buyResult.newPools, 'a', d(20));
      const kAfter = computeK(sellResult.newPools);
      expect(kAfter.toDecimalPlaces(4).eq(kBefore.toDecimalPlaces(4))).toBe(true);
    });

    it('new probabilities sum to 1 after sell', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const buyResult = buyShares(pool, 'a', d(100));
      const sellResult = sellShares(buyResult.newPools, 'a', d(30));
      let sum = d(0);
      for (const p of sellResult.newProbabilities.values()) {
        sum = sum.add(p);
      }
      expect(sum.toDecimalPlaces(10).toNumber()).toBe(1);
    });

    it('throws on zero shares', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      expect(() => sellShares(pool, 'a', d(0))).toThrow('Shares must be positive');
    });
  });

  describe('buy-sell roundtrip', () => {
    it('buy then sell all returns original tokens (3 outcomes)', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const buyResult = buyShares(pool, 'a', d(100));
      const sellResult = sellShares(buyResult.newPools, 'a', buyResult.sharesReceived);

      // Should get back ~100 tokens
      expect(sellResult.tokensReceived.toDecimalPlaces(4).toNumber()).toBeCloseTo(100, 2);

      // Pool should be back to original
      for (const [id, p] of pool) {
        expect(sellResult.newPools.get(id)!.toDecimalPlaces(4).toNumber()).toBeCloseTo(p.toNumber(), 2);
      }
    });

    it('buy then sell all returns original tokens (5 outcomes)', () => {
      const pool = createMultiPool(d(1000), ['a', 'b', 'c', 'd', 'e']);
      const buyResult = buyShares(pool, 'c', d(75));
      const sellResult = sellShares(buyResult.newPools, 'c', buyResult.sharesReceived);
      expect(sellResult.tokensReceived.toDecimalPlaces(4).toNumber()).toBeCloseTo(75, 2);
    });
  });

  describe('preview functions', () => {
    it('previewMultiTrade matches buyShares', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const preview = previewMultiTrade(pool, 'a', d(50));
      const actual = buyShares(pool, 'a', d(50));
      expect(preview.sharesReceived.eq(actual.sharesReceived)).toBe(true);
    });

    it('previewMultiSell matches sellShares', () => {
      const pool = createMultiPool(d(900), ['a', 'b', 'c']);
      const buyResult = buyShares(pool, 'a', d(100));
      const preview = previewMultiSell(buyResult.newPools, 'a', d(30));
      const actual = sellShares(buyResult.newPools, 'a', d(30));
      expect(preview.tokensReceived.eq(actual.tokensReceived)).toBe(true);
    });
  });

  describe('totalPool', () => {
    it('returns sum of all pools', () => {
      const pool = makePool({ a: 100, b: 200, c: 300 });
      expect(totalPool(pool).toNumber()).toBe(600);
    });
  });

  describe('10-outcome market', () => {
    it('handles 10 outcomes correctly', () => {
      const ids = Array.from({ length: 10 }, (_, i) => `o${i}`);
      const pool = createMultiPool(d(10000), ids);
      expect(pool.size).toBe(10);

      // Equal probabilities
      const probs = allProbabilities(pool);
      for (const p of probs.values()) {
        expect(p.toDecimalPlaces(10).toNumber()).toBeCloseTo(0.1, 8);
      }

      // Buy and verify
      const result = buyShares(pool, 'o3', d(100));
      expect(result.sharesReceived.gt(0)).toBe(true);

      // k preserved
      const kBefore = computeK(pool);
      const kAfter = computeK(result.newPools);
      expect(kAfter.toDecimalPlaces(2).eq(kBefore.toDecimalPlaces(2))).toBe(true);
    });
  });

  describe('1,000-trade simulation — zero drift (3 outcomes)', () => {
    it('maintains invariant k across 1,000 random trades', () => {
      const ids = ['a', 'b', 'c'];
      let pool = createMultiPool(d(9000), ids);
      const k = computeK(pool);

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 100) + 1);
        const outcomeId = ids[i % 3];
        const result = buyShares(pool, outcomeId, amount);
        pool = result.newPools;

        const currentK = computeK(pool);
        expect(currentK.toDecimalPlaces(2).eq(k.toDecimalPlaces(2))).toBe(true);
      }
    });

    it('probability always sums to 1 across 1,000 trades', () => {
      const ids = ['a', 'b', 'c'];
      let pool = createMultiPool(d(9000), ids);

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 200) + 1);
        const outcomeId = ids[Math.floor(Math.random() * 3)];
        const result = buyShares(pool, outcomeId, amount);

        let sum = d(0);
        for (const p of result.newProbabilities.values()) {
          expect(p.gt(0)).toBe(true);
          expect(p.lt(1)).toBe(true);
          sum = sum.add(p);
        }
        expect(sum.toDecimalPlaces(10).toNumber()).toBe(1);

        pool = result.newPools;
      }
    });

    it('pool values remain positive across 1,000 trades', () => {
      const ids = ['a', 'b', 'c'];
      let pool = createMultiPool(d(9000), ids);

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 200) + 1);
        const outcomeId = ids[Math.floor(Math.random() * 3)];
        const result = buyShares(pool, outcomeId, amount);

        for (const p of result.newPools.values()) {
          expect(p.gt(0)).toBe(true);
        }

        pool = result.newPools;
      }
    });
  });

  describe('1,000-trade simulation with sells (3 outcomes)', () => {
    it('maintains invariant k across buy and sell trades', () => {
      const ids = ['a', 'b', 'c'];
      let pool = createMultiPool(d(9000), ids);
      const k = computeK(pool);
      const sharesOut: Record<string, Decimal> = { a: d(0), b: d(0), c: d(0) };

      for (let i = 0; i < 1000; i++) {
        const action = Math.random();
        const outcomeId = ids[Math.floor(Math.random() * 3)];

        if (action < 0.7) {
          // Buy
          const amount = new Decimal(Math.floor(Math.random() * 100) + 1);
          const result = buyShares(pool, outcomeId, amount);
          sharesOut[outcomeId] = sharesOut[outcomeId].add(result.sharesReceived);
          pool = result.newPools;
        } else if (sharesOut[outcomeId].gt(1)) {
          // Sell some
          const maxSell = Decimal.min(sharesOut[outcomeId], d(50));
          const sellAmt = maxSell.mul(Decimal.random()).add(1).floor().clamp(1, maxSell);
          const result = sellShares(pool, outcomeId, sellAmt);
          sharesOut[outcomeId] = sharesOut[outcomeId].sub(sellAmt);
          pool = result.newPools;
        }

        const currentK = computeK(pool);
        expect(currentK.toDecimalPlaces(0).eq(k.toDecimalPlaces(0))).toBe(true);
      }
    });
  });
});
