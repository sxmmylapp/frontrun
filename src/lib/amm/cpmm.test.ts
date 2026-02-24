import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  yesProbability,
  noProbability,
  buyYesShares,
  buyNoShares,
  sellYesShares,
  sellNoShares,
  previewTrade,
  previewSell,
  createMarketPool,
  payoutPerShare,
  mcProbabilities,
  mcBuyShares,
  mcSellShares,
  mcPreviewTrade,
  mcPreviewSell,
  createMCMarketPool,
  mcTotalPool,
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

  describe('sellYesShares', () => {
    it('produces correct output for a standard sell', () => {
      // After buying YES, sell them back
      const pool = createMarketPool(d(1000));
      const buyResult = buyYesShares(pool, d(100));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const sellResult = sellYesShares(afterBuy, buyResult.sharesReceived);

      // Selling all shares back should return ~100 tokens (the original cost)
      expect(sellResult.tokensReceived.toDecimalPlaces(8).toNumber()).toBeCloseTo(100, 6);
    });

    it('maintains constant product invariant', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyYesShares(pool, d(100));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const kBefore = afterBuy.yesPool.mul(afterBuy.noPool);
      const sellResult = sellYesShares(afterBuy, d(20));
      const kAfter = sellResult.newYesPool.mul(sellResult.newNoPool);
      expect(kAfter.toDecimalPlaces(8).eq(kBefore.toDecimalPlaces(8))).toBe(true);
    });

    it('decreases YES probability after selling YES', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyYesShares(pool, d(200));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const probBefore = yesProbability(afterBuy);
      const sellResult = sellYesShares(afterBuy, d(50));
      expect(sellResult.newYesProbability.lt(probBefore)).toBe(true);
    });

    it('tokens received is always positive', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyYesShares(pool, d(100));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const sellResult = sellYesShares(afterBuy, d(10));
      expect(sellResult.tokensReceived.gt(0)).toBe(true);
    });

    it('throws on zero shares', () => {
      const pool = createMarketPool(d(1000));
      expect(() => sellYesShares(pool, d(0))).toThrow('Shares must be positive');
    });

    it('throws on negative shares', () => {
      const pool = createMarketPool(d(1000));
      expect(() => sellYesShares(pool, d(-10))).toThrow('Shares must be positive');
    });
  });

  describe('sellNoShares', () => {
    it('produces correct output for a standard sell', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyNoShares(pool, d(100));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const sellResult = sellNoShares(afterBuy, buyResult.sharesReceived);

      // Selling all shares back should return ~100 tokens
      expect(sellResult.tokensReceived.toDecimalPlaces(8).toNumber()).toBeCloseTo(100, 6);
    });

    it('maintains constant product invariant', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyNoShares(pool, d(100));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const kBefore = afterBuy.yesPool.mul(afterBuy.noPool);
      const sellResult = sellNoShares(afterBuy, d(20));
      const kAfter = sellResult.newYesPool.mul(sellResult.newNoPool);
      expect(kAfter.toDecimalPlaces(8).eq(kBefore.toDecimalPlaces(8))).toBe(true);
    });

    it('decreases NO probability after selling NO', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyNoShares(pool, d(200));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const probBefore = noProbability(afterBuy);
      const sellResult = sellNoShares(afterBuy, d(50));
      expect(sellResult.newNoProbability.lt(probBefore)).toBe(true);
    });
  });

  describe('previewSell', () => {
    it('returns same tokens as actual sell for YES', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyYesShares(pool, d(100));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const preview = previewSell(afterBuy, 'yes', d(30));
      const actual = sellYesShares(afterBuy, d(30));
      expect(preview.tokensReceived.eq(actual.tokensReceived)).toBe(true);
    });

    it('returns same tokens as actual sell for NO', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyNoShares(pool, d(100));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const preview = previewSell(afterBuy, 'no', d(30));
      const actual = sellNoShares(afterBuy, d(30));
      expect(preview.tokensReceived.eq(actual.tokensReceived)).toBe(true);
    });
  });

  describe('buy-sell roundtrip', () => {
    it('buy then sell all returns original tokens', () => {
      const pool = createMarketPool(d(1000));
      const buyResult = buyYesShares(pool, d(100));
      const afterBuy = { yesPool: buyResult.newYesPool, noPool: buyResult.newNoPool };
      const sellResult = sellYesShares(afterBuy, buyResult.sharesReceived);
      // Pool should be back to original
      expect(sellResult.newYesPool.toDecimalPlaces(8).eq(d(500).toDecimalPlaces(8))).toBe(true);
      expect(sellResult.newNoPool.toDecimalPlaces(8).eq(d(500).toDecimalPlaces(8))).toBe(true);
    });

    it('sell after price moves gives different amount than original cost', () => {
      const pool = createMarketPool(d(1000));
      // User A buys YES
      const buyA = buyYesShares(pool, d(100));
      const afterA = { yesPool: buyA.newYesPool, noPool: buyA.newNoPool };
      // User B also buys YES, pushing price up
      const buyB = buyYesShares(afterA, d(100));
      const afterB = { yesPool: buyB.newYesPool, noPool: buyB.newNoPool };
      // User A sells — should get more than 100 tokens because price moved up
      const sellA = sellYesShares(afterB, buyA.sharesReceived);
      expect(sellA.tokensReceived.gt(d(100))).toBe(true);
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

  describe('1,000-trade simulation with sells — zero drift', () => {
    it('maintains invariant k across buy and sell trades', () => {
      let pool = createMarketPool(d(10000));
      const k = pool.yesPool.mul(pool.noPool);
      // Track outstanding shares for selling
      let yesSharesOut = new Decimal(0);
      let noSharesOut = new Decimal(0);

      for (let i = 0; i < 1000; i++) {
        const action = Math.random();

        if (action < 0.4) {
          // Buy YES
          const amount = new Decimal(Math.floor(Math.random() * 100) + 1);
          const result = buyYesShares(pool, amount);
          yesSharesOut = yesSharesOut.add(result.sharesReceived);
          pool = { yesPool: result.newYesPool, noPool: result.newNoPool };
        } else if (action < 0.8) {
          // Buy NO
          const amount = new Decimal(Math.floor(Math.random() * 100) + 1);
          const result = buyNoShares(pool, amount);
          noSharesOut = noSharesOut.add(result.sharesReceived);
          pool = { yesPool: result.newYesPool, noPool: result.newNoPool };
        } else if (action < 0.9 && yesSharesOut.gt(1)) {
          // Sell some YES shares
          const maxSell = Decimal.min(yesSharesOut, new Decimal(50));
          const sellAmt = maxSell.mul(Decimal.random()).add(1).floor().clamp(1, maxSell);
          const result = sellYesShares(pool, sellAmt);
          yesSharesOut = yesSharesOut.sub(sellAmt);
          pool = { yesPool: result.newYesPool, noPool: result.newNoPool };
        } else if (noSharesOut.gt(1)) {
          // Sell some NO shares
          const maxSell = Decimal.min(noSharesOut, new Decimal(50));
          const sellAmt = maxSell.mul(Decimal.random()).add(1).floor().clamp(1, maxSell);
          const result = sellNoShares(pool, sellAmt);
          noSharesOut = noSharesOut.sub(sellAmt);
          pool = { yesPool: result.newYesPool, noPool: result.newNoPool };
        }

        // k should be preserved
        const currentK = pool.yesPool.mul(pool.noPool);
        expect(
          currentK.toDecimalPlaces(6).eq(k.toDecimalPlaces(6))
        ).toBe(true);
      }
    });
  });
});

describe('Multi-outcome CPMM', () => {
  describe('createMCMarketPool', () => {
    it('creates equal pools for 3 outcomes', () => {
      const state = createMCMarketPool(d(900), 3);
      expect(state.pools.length).toBe(3);
      expect(state.pools[0].toNumber()).toBe(300);
      expect(state.pools[1].toNumber()).toBe(300);
      expect(state.pools[2].toNumber()).toBe(300);
    });

    it('creates equal pools for 4 outcomes', () => {
      const state = createMCMarketPool(d(1000), 4);
      expect(state.pools.length).toBe(4);
      expect(state.pools[0].toNumber()).toBe(250);
    });

    it('throws on zero liquidity', () => {
      expect(() => createMCMarketPool(d(0), 3)).toThrow('Liquidity must be positive');
    });

    it('throws on fewer than 2 outcomes', () => {
      expect(() => createMCMarketPool(d(1000), 1)).toThrow('Number of outcomes must be between 2 and 10');
    });

    it('throws on more than 10 outcomes', () => {
      expect(() => createMCMarketPool(d(1000), 11)).toThrow('Number of outcomes must be between 2 and 10');
    });
  });

  describe('mcProbabilities', () => {
    it('returns equal probabilities for equal pools', () => {
      const state = createMCMarketPool(d(900), 3);
      const probs = mcProbabilities(state);
      expect(probs.length).toBe(3);
      for (const p of probs) {
        expect(p.toDecimalPlaces(8).toNumber()).toBeCloseTo(1 / 3, 6);
      }
    });

    it('probabilities sum to 1', () => {
      const state = { pools: [d(200), d(400), d(600)] };
      const probs = mcProbabilities(state);
      const sum = probs.reduce((a, b) => a.add(b), d(0));
      expect(sum.toDecimalPlaces(10).toNumber()).toBeCloseTo(1, 8);
    });

    it('smaller pool = higher probability', () => {
      const state = { pools: [d(100), d(300), d(300)] };
      const probs = mcProbabilities(state);
      // Pool 0 is smallest, so its probability should be highest
      expect(probs[0].gt(probs[1])).toBe(true);
      expect(probs[1].eq(probs[2])).toBe(true);
    });

    it('throws on fewer than 2 outcomes', () => {
      expect(() => mcProbabilities({ pools: [d(100)] })).toThrow('Need at least 2 outcomes');
    });
  });

  describe('mcBuyShares', () => {
    it('produces correct output for a standard bet on 3-outcome market', () => {
      const state = createMCMarketPool(d(900), 3);
      const result = mcBuyShares(state, 0, d(100));

      // After buying outcome 0:
      // pool[1] = 300 + 100 = 400, pool[2] = 300 + 100 = 400
      // k = 300 * 300 * 300 = 27,000,000
      // newPool[0] = 27,000,000 / (400 * 400) = 168.75
      // shares = 300 - 168.75 = 131.25
      expect(result.newPools[1].toNumber()).toBe(400);
      expect(result.newPools[2].toNumber()).toBe(400);
      expect(result.newPools[0].toDecimalPlaces(2).toNumber()).toBe(168.75);
      expect(result.sharesReceived.toDecimalPlaces(2).toNumber()).toBe(131.25);
    });

    it('maintains constant product invariant', () => {
      const state = createMCMarketPool(d(900), 3);
      const kBefore = state.pools.reduce((a, b) => a.mul(b), d(1));
      const result = mcBuyShares(state, 1, d(50));
      const kAfter = result.newPools.reduce((a, b) => a.mul(b), d(1));
      expect(kAfter.toDecimalPlaces(6).eq(kBefore.toDecimalPlaces(6))).toBe(true);
    });

    it('increases probability of bought outcome', () => {
      const state = createMCMarketPool(d(900), 3);
      const probBefore = mcProbabilities(state)[0];
      const result = mcBuyShares(state, 0, d(100));
      expect(result.newProbabilities[0].gt(probBefore)).toBe(true);
    });

    it('probabilities sum to 1 after trade', () => {
      const state = createMCMarketPool(d(900), 3);
      const result = mcBuyShares(state, 2, d(50));
      const sum = result.newProbabilities.reduce((a, b) => a.add(b), d(0));
      expect(sum.toDecimalPlaces(10).toNumber()).toBeCloseTo(1, 8);
    });

    it('throws on zero token amount', () => {
      const state = createMCMarketPool(d(900), 3);
      expect(() => mcBuyShares(state, 0, d(0))).toThrow('Token amount must be positive');
    });

    it('throws on invalid outcome index', () => {
      const state = createMCMarketPool(d(900), 3);
      expect(() => mcBuyShares(state, 5, d(100))).toThrow('Invalid outcome index');
    });

    it('works with 4 outcomes', () => {
      const state = createMCMarketPool(d(1000), 4);
      const kBefore = state.pools.reduce((a, b) => a.mul(b), d(1));
      const result = mcBuyShares(state, 2, d(75));
      const kAfter = result.newPools.reduce((a, b) => a.mul(b), d(1));
      expect(kAfter.toDecimalPlaces(4).eq(kBefore.toDecimalPlaces(4))).toBe(true);
      expect(result.sharesReceived.gt(0)).toBe(true);
    });
  });

  describe('mcSellShares', () => {
    it('buy then sell all returns original tokens (roundtrip)', () => {
      const state = createMCMarketPool(d(900), 3);
      const buyResult = mcBuyShares(state, 0, d(100));
      const afterBuy = { pools: buyResult.newPools };
      const sellResult = mcSellShares(afterBuy, 0, buyResult.sharesReceived);

      // Should get back ~100 tokens
      expect(sellResult.tokensReceived.toDecimalPlaces(4).toNumber()).toBeCloseTo(100, 2);
    });

    it('maintains constant product invariant', () => {
      const state = createMCMarketPool(d(900), 3);
      const buyResult = mcBuyShares(state, 1, d(100));
      const afterBuy = { pools: buyResult.newPools };
      const kBefore = afterBuy.pools.reduce((a, b) => a.mul(b), d(1));
      const sellResult = mcSellShares(afterBuy, 1, d(20));
      const kAfter = sellResult.newPools.reduce((a, b) => a.mul(b), d(1));
      expect(kAfter.toDecimalPlaces(4).eq(kBefore.toDecimalPlaces(4))).toBe(true);
    });

    it('tokens received is positive', () => {
      const state = createMCMarketPool(d(900), 3);
      const buyResult = mcBuyShares(state, 0, d(100));
      const afterBuy = { pools: buyResult.newPools };
      const sellResult = mcSellShares(afterBuy, 0, d(10));
      expect(sellResult.tokensReceived.gt(0)).toBe(true);
    });

    it('throws on zero shares', () => {
      const state = createMCMarketPool(d(900), 3);
      expect(() => mcSellShares(state, 0, d(0))).toThrow('Shares must be positive');
    });
  });

  describe('mcPreviewTrade / mcPreviewSell', () => {
    it('preview returns same shares as actual trade', () => {
      const state = createMCMarketPool(d(900), 3);
      const preview = mcPreviewTrade(state, 1, d(50));
      const actual = mcBuyShares(state, 1, d(50));
      expect(preview.sharesReceived.eq(actual.sharesReceived)).toBe(true);
    });

    it('preview sell returns same tokens as actual sell', () => {
      const state = createMCMarketPool(d(900), 3);
      const buyResult = mcBuyShares(state, 0, d(100));
      const afterBuy = { pools: buyResult.newPools };
      const preview = mcPreviewSell(afterBuy, 0, d(30));
      const actual = mcSellShares(afterBuy, 0, d(30));
      expect(
        preview.tokensReceived.toDecimalPlaces(8).eq(actual.tokensReceived.toDecimalPlaces(8))
      ).toBe(true);
    });
  });

  describe('mcTotalPool', () => {
    it('sums all pools', () => {
      const state = createMCMarketPool(d(900), 3);
      expect(mcTotalPool(state).toNumber()).toBe(900);
    });

    it('reflects added tokens after trade', () => {
      const state = createMCMarketPool(d(900), 3);
      const result = mcBuyShares(state, 0, d(100));
      const newState = { pools: result.newPools };
      // Total pool increases by tokenAmount (tokens added to N-1 pools, fewer removed from 1)
      expect(mcTotalPool(newState).gt(d(900))).toBe(true);
    });
  });

  describe('1,000-trade simulation — multi-outcome zero drift', () => {
    it('maintains invariant k across 1,000 trades on a 3-outcome market', () => {
      let state = createMCMarketPool(d(9000), 3);
      const k = state.pools.reduce((a, b) => a.mul(b), d(1));

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 100) + 1);
        const outcomeIndex = i % 3;

        const result = mcBuyShares(state, outcomeIndex, amount);
        state = { pools: result.newPools };

        const currentK = state.pools.reduce((a, b) => a.mul(b), d(1));
        expect(
          currentK.toDecimalPlaces(4).eq(k.toDecimalPlaces(4))
        ).toBe(true);
      }
    });

    it('probabilities always sum to 1 and stay bounded across 1,000 random trades', () => {
      let state = createMCMarketPool(d(9000), 4);

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 200) + 1);
        const outcomeIndex = Math.floor(Math.random() * 4);

        const result = mcBuyShares(state, outcomeIndex, amount);

        for (const p of result.newProbabilities) {
          expect(p.gte(0)).toBe(true);
          expect(p.lte(1)).toBe(true);
        }

        const sum = result.newProbabilities.reduce((a, b) => a.add(b), d(0));
        expect(sum.toDecimalPlaces(8).toNumber()).toBeCloseTo(1, 6);

        state = { pools: result.newPools };
      }
    });

    it('pool values remain positive across 1,000 trades', () => {
      let state = createMCMarketPool(d(9000), 3);

      for (let i = 0; i < 1000; i++) {
        const amount = new Decimal(Math.floor(Math.random() * 100) + 1);
        const outcomeIndex = Math.floor(Math.random() * 3);

        const result = mcBuyShares(state, outcomeIndex, amount);

        for (const p of result.newPools) {
          expect(p.gt(0)).toBe(true);
        }
        expect(result.sharesReceived.gt(0)).toBe(true);

        state = { pools: result.newPools };
      }
    });
  });

  describe('reduces to binary CPMM for 2 outcomes', () => {
    it('gives same results as binary CPMM', () => {
      const binaryPool = createMarketPool(d(1000));
      const mcState = createMCMarketPool(d(1000), 2);

      const binaryResult = buyYesShares(binaryPool, d(100));
      const mcResult = mcBuyShares(mcState, 0, d(100));

      // Shares should match
      expect(
        mcResult.sharesReceived.toDecimalPlaces(8).eq(
          binaryResult.sharesReceived.toDecimalPlaces(8)
        )
      ).toBe(true);

      // Pools should match
      expect(
        mcResult.newPools[0].toDecimalPlaces(8).eq(
          binaryResult.newYesPool.toDecimalPlaces(8)
        )
      ).toBe(true);
      expect(
        mcResult.newPools[1].toDecimalPlaces(8).eq(
          binaryResult.newNoPool.toDecimalPlaces(8)
        )
      ).toBe(true);
    });
  });
});
