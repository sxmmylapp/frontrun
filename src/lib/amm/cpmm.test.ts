import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  yesProbability,
  noProbability,
  buyYesShares,
  buyNoShares,
  previewTrade,
  createMarketPool,
  payoutPerShare,
} from './cpmm';

function d(n: number | string): Decimal {
  return new Decimal(n);
}

describe('CPMM', () => {
  describe('createMarketPool', () => {
    it('creates equal pools from liquidity', () => {
      const pool = createMarketPool(d(1000));
      expect(pool.yesPool.toNumber()).toBe(500);
      expect(pool.noPool.toNumber()).toBe(500);
    });

    it('throws on zero liquidity', () => {
      expect(() => createMarketPool(d(0))).toThrow('Liquidity must be positive');
    });

    it('throws on negative liquidity', () => {
      expect(() => createMarketPool(d(-100))).toThrow('Liquidity must be positive');
    });
  });

  describe('yesProbability / noProbability', () => {
    it('returns 0.5 for equal pools', () => {
      const pool = { yesPool: d(500), noPool: d(500) };
      expect(yesProbability(pool).toNumber()).toBe(0.5);
      expect(noProbability(pool).toNumber()).toBe(0.5);
    });

    it('probabilities always sum to 1', () => {
      const pool = { yesPool: d(300), noPool: d(700) };
      const sum = yesProbability(pool).add(noProbability(pool));
      expect(sum.toNumber()).toBe(1);
    });

    it('higher noPool = higher YES probability', () => {
      const pool = { yesPool: d(200), noPool: d(800) };
      expect(yesProbability(pool).toNumber()).toBe(0.8);
      expect(noProbability(pool).toNumber()).toBe(0.2);
    });

    it('returns 0.5 for zero pools', () => {
      const pool = { yesPool: d(0), noPool: d(0) };
      expect(yesProbability(pool).toNumber()).toBe(0.5);
    });
  });

  describe('buyYesShares', () => {
    it('produces correct output for a standard bet', () => {
      const pool = createMarketPool(d(1000));
      const result = buyYesShares(pool, d(100));

      // k = 500 * 500 = 250000
      // newNoPool = 500 + 100 = 600
      // newYesPool = 250000 / 600 = 416.6666...
      // sharesReceived = 500 - 416.6666... = 83.3333...
      expect(result.sharesReceived.toDecimalPlaces(8).toNumber()).toBeCloseTo(
        83.33333333,
        6
      );
      expect(result.newNoPool.toNumber()).toBe(600);
      expect(
        result.newYesPool.toDecimalPlaces(8).toNumber()
      ).toBeCloseTo(416.66666667, 6);
    });

    it('maintains constant product invariant', () => {
      const pool = createMarketPool(d(1000));
      const kBefore = pool.yesPool.mul(pool.noPool);
      const result = buyYesShares(pool, d(50));
      const kAfter = result.newYesPool.mul(result.newNoPool);
      // k should be exactly preserved
      expect(kAfter.toDecimalPlaces(8).eq(kBefore.toDecimalPlaces(8))).toBe(true);
    });

    it('increases YES probability after buying YES', () => {
      const pool = createMarketPool(d(1000));
      const probBefore = yesProbability(pool);
      const result = buyYesShares(pool, d(100));
      expect(result.newYesProbability.gt(probBefore)).toBe(true);
    });

    it('shares received is always positive', () => {
      const pool = createMarketPool(d(1000));
      const result = buyYesShares(pool, d(1));
      expect(result.sharesReceived.gt(0)).toBe(true);
    });

    it('throws on zero token amount', () => {
      const pool = createMarketPool(d(1000));
      expect(() => buyYesShares(pool, d(0))).toThrow('Token amount must be positive');
    });

    it('throws on negative token amount', () => {
      const pool = createMarketPool(d(1000));
      expect(() => buyYesShares(pool, d(-10))).toThrow('Token amount must be positive');
    });
  });

  describe('buyNoShares', () => {
    it('produces correct output for a standard bet', () => {
      const pool = createMarketPool(d(1000));
      const result = buyNoShares(pool, d(100));

      // Symmetric to buyYesShares
      expect(result.sharesReceived.toDecimalPlaces(8).toNumber()).toBeCloseTo(
        83.33333333,
        6
      );
      expect(result.newYesPool.toNumber()).toBe(600);
    });

    it('maintains constant product invariant', () => {
      const pool = createMarketPool(d(1000));
      const kBefore = pool.yesPool.mul(pool.noPool);
      const result = buyNoShares(pool, d(75));
      const kAfter = result.newYesPool.mul(result.newNoPool);
      expect(kAfter.toDecimalPlaces(8).eq(kBefore.toDecimalPlaces(8))).toBe(true);
    });

    it('increases NO probability after buying NO', () => {
      const pool = createMarketPool(d(1000));
      const probBefore = noProbability(pool);
      const result = buyNoShares(pool, d(100));
      expect(result.newNoProbability.gt(probBefore)).toBe(true);
    });
  });

  describe('previewTrade', () => {
    it('returns same shares as actual trade', () => {
      const pool = createMarketPool(d(1000));
      const preview = previewTrade(pool, 'yes', d(50));
      const actual = buyYesShares(pool, d(50));
      expect(preview.sharesReceived.eq(actual.sharesReceived)).toBe(true);
    });

    it('works for NO side', () => {
      const pool = createMarketPool(d(1000));
      const preview = previewTrade(pool, 'no', d(50));
      const actual = buyNoShares(pool, d(50));
      expect(preview.sharesReceived.eq(actual.sharesReceived)).toBe(true);
    });
  });

  describe('payoutPerShare', () => {
    it('calculates correct payout', () => {
      // Total pool = 1000, winners hold 400 shares -> 2.5 tokens per share
      expect(payoutPerShare(d(1000), d(400)).toNumber()).toBe(2.5);
    });

    it('returns 0 when no winning shares', () => {
      expect(payoutPerShare(d(1000), d(0)).toNumber()).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles very small bet (dust)', () => {
      const pool = createMarketPool(d(1000));
      const result = buyYesShares(pool, d('0.001'));
      expect(result.sharesReceived.gt(0)).toBe(true);
      expect(result.newYesProbability.gt(0)).toBe(true);
      expect(result.newYesProbability.lt(1)).toBe(true);
    });

    it('handles large bet (90% of pool equivalent)', () => {
      const pool = createMarketPool(d(1000));
      const result = buyYesShares(pool, d(4500)); // Much larger than pool
      expect(result.sharesReceived.gt(0)).toBe(true);
      expect(result.newYesProbability.gt(0)).toBe(true);
      expect(result.newYesProbability.lt(1)).toBe(true);
      // YES probability should be very high after massive YES buy
      expect(result.newYesProbability.gt(d('0.9'))).toBe(true);
    });

    it('probability never reaches exactly 0 or 1', () => {
      const pool = createMarketPool(d(1000));
      // Even with extreme bet, probability stays bounded
      const result = buyYesShares(pool, d(1000000));
      expect(result.newYesProbability.lt(1)).toBe(true);
      expect(result.newYesProbability.gt(0)).toBe(true);
      expect(result.newNoProbability.lt(1)).toBe(true);
      expect(result.newNoProbability.gt(0)).toBe(true);
    });

    it('throws on zero pool values', () => {
      const pool = { yesPool: d(0), noPool: d(500) };
      expect(() => buyYesShares(pool, d(10))).toThrow(
        'Pool values must be positive'
      );
    });
  });

  describe('1,000-trade simulation — zero drift', () => {
    it('maintains invariant k across 1,000 alternating trades', () => {
      let pool = createMarketPool(d(10000));
      const k = pool.yesPool.mul(pool.noPool);

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 100) + 1);
        const side = i % 2 === 0 ? 'yes' : 'no';

        const result =
          side === 'yes'
            ? buyYesShares(pool, amount)
            : buyNoShares(pool, amount);

        pool = { yesPool: result.newYesPool, noPool: result.newNoPool };

        // k should be preserved to 8 decimal places
        const currentK = pool.yesPool.mul(pool.noPool);
        expect(
          currentK.toDecimalPlaces(8).eq(k.toDecimalPlaces(8))
        ).toBe(true);
      }
    });

    it('probability always stays between 0 and 1 across 1,000 random trades', () => {
      let pool = createMarketPool(d(10000));

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 500) + 1);
        const side = Math.random() > 0.5 ? 'yes' : 'no';

        const result =
          side === 'yes'
            ? buyYesShares(pool, amount)
            : buyNoShares(pool, amount);

        expect(result.newYesProbability.gte(0)).toBe(true);
        expect(result.newYesProbability.lte(1)).toBe(true);
        expect(result.newNoProbability.gte(0)).toBe(true);
        expect(result.newNoProbability.lte(1)).toBe(true);

        // Probabilities sum to 1
        const sum = result.newYesProbability.add(result.newNoProbability);
        expect(sum.toDecimalPlaces(10).eq(1)).toBe(true);

        pool = { yesPool: result.newYesPool, noPool: result.newNoPool };
      }
    });

    it('pool values remain positive across 1,000 trades', () => {
      let pool = createMarketPool(d(10000));

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 200) + 1);
        const side = Math.random() > 0.5 ? 'yes' : 'no';

        const result =
          side === 'yes'
            ? buyYesShares(pool, amount)
            : buyNoShares(pool, amount);

        expect(result.newYesPool.gt(0)).toBe(true);
        expect(result.newNoPool.gt(0)).toBe(true);
        expect(result.sharesReceived.gt(0)).toBe(true);

        pool = { yesPool: result.newYesPool, noPool: result.newNoPool };
      }
    });
  });
});
