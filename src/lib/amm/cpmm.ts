/**
 * Constant Product Market Maker (CPMM) for binary and multi-outcome prediction markets.
 *
 * Binary formula: yesPool * noPool = k (constant product invariant)
 * Multi-outcome formula: product(pools[i]) = k (N-way constant product)
 *
 * All arithmetic uses decimal.js to prevent floating-point drift.
 * This module is pure math — no database or network calls.
 */
import Decimal from 'decimal.js';

// Configure decimal.js for high precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export type PoolState = {
  yesPool: Decimal;
  noPool: Decimal;
};

export type TradeResult = {
  sharesReceived: Decimal;
  newYesPool: Decimal;
  newNoPool: Decimal;
  newYesProbability: Decimal;
  newNoProbability: Decimal;
};

export type SellResult = {
  tokensReceived: Decimal;
  newYesPool: Decimal;
  newNoPool: Decimal;
  newYesProbability: Decimal;
  newNoProbability: Decimal;
};

/**
 * Get the current probability of YES outcome.
 * Formula: P(YES) = noPool / (yesPool + noPool)
 *
 * Intuition: When more people buy YES shares, yesPool decreases
 * and noPool increases, pushing the YES price up.
 */
export function yesProbability(pool: PoolState): Decimal {
  const total = pool.yesPool.add(pool.noPool);
  if (total.isZero()) return new Decimal('0.5');
  return pool.noPool.div(total);
}

/**
 * Get the current probability of NO outcome.
 * Formula: P(NO) = yesPool / (yesPool + noPool)
 */
export function noProbability(pool: PoolState): Decimal {
  const total = pool.yesPool.add(pool.noPool);
  if (total.isZero()) return new Decimal('0.5');
  return pool.yesPool.div(total);
}

/**
 * Buy YES shares with a given token amount.
 *
 * Mechanism: tokens are added to the NO pool, then the constant product
 * invariant determines how many YES shares come out of the YES pool.
 *
 * k = yesPool * noPool (before trade)
 * newNoPool = noPool + tokenAmount
 * newYesPool = k / newNoPool
 * sharesReceived = yesPool - newYesPool
 */
export function buyYesShares(
  pool: PoolState,
  tokenAmount: Decimal
): TradeResult {
  validateTradeInputs(pool, tokenAmount);

  const k = pool.yesPool.mul(pool.noPool);
  const newNoPool = pool.noPool.add(tokenAmount);
  const newYesPool = k.div(newNoPool);
  const sharesReceived = pool.yesPool.sub(newYesPool);

  const newPool = { yesPool: newYesPool, noPool: newNoPool };

  return {
    sharesReceived,
    newYesPool,
    newNoPool,
    newYesProbability: yesProbability(newPool),
    newNoProbability: noProbability(newPool),
  };
}

/**
 * Buy NO shares with a given token amount.
 *
 * Mechanism: tokens are added to the YES pool, then the constant product
 * invariant determines how many NO shares come out of the NO pool.
 */
export function buyNoShares(
  pool: PoolState,
  tokenAmount: Decimal
): TradeResult {
  validateTradeInputs(pool, tokenAmount);

  const k = pool.yesPool.mul(pool.noPool);
  const newYesPool = pool.yesPool.add(tokenAmount);
  const newNoPool = k.div(newYesPool);
  const sharesReceived = pool.noPool.sub(newNoPool);

  const newPool = { yesPool: newYesPool, noPool: newNoPool };

  return {
    sharesReceived,
    newYesPool,
    newNoPool,
    newYesProbability: yesProbability(newPool),
    newNoProbability: noProbability(newPool),
  };
}

/**
 * Calculate the projected payout for a hypothetical bet.
 * Returns shares that would be received without modifying any state.
 */
export function previewTrade(
  pool: PoolState,
  outcome: 'yes' | 'no',
  tokenAmount: Decimal
): { sharesReceived: Decimal; impliedProbability: Decimal } {
  const result =
    outcome === 'yes'
      ? buyYesShares(pool, tokenAmount)
      : buyNoShares(pool, tokenAmount);

  return {
    sharesReceived: result.sharesReceived,
    impliedProbability:
      outcome === 'yes' ? result.newYesProbability : result.newNoProbability,
  };
}

/**
 * Create a new market with initial liquidity.
 * A 50/50 market starts with equal pools.
 *
 * @param liquidity - Total initial tokens to seed the market
 * @returns Initial pool state with equal YES/NO pools
 */
export function createMarketPool(liquidity: Decimal): PoolState {
  if (liquidity.lte(0)) {
    throw new Error('Liquidity must be positive');
  }
  const half = liquidity.div(2);
  return { yesPool: half, noPool: half };
}

/**
 * Calculate payout per share after market resolution.
 * Winners split the total pool proportionally to their shares.
 *
 * @param totalPool - Sum of yesPool + noPool at resolution
 * @param winningShares - Total shares held by all winners
 * @returns Tokens per share for winners
 */
export function payoutPerShare(
  totalPool: Decimal,
  winningShares: Decimal
): Decimal {
  if (winningShares.isZero()) return new Decimal(0);
  return totalPool.div(winningShares);
}

/**
 * Sell YES shares back into the pool.
 *
 * Mechanism: shares return to the YES pool, then the constant product
 * invariant determines how many tokens come out of the NO pool.
 *
 * k = yesPool * noPool (before trade)
 * newYesPool = yesPool + shares
 * newNoPool = k / newYesPool
 * tokensReceived = noPool - newNoPool
 */
export function sellYesShares(
  pool: PoolState,
  shares: Decimal
): SellResult {
  validateSellInputs(pool, shares);

  const k = pool.yesPool.mul(pool.noPool);
  const newYesPool = pool.yesPool.add(shares);
  const newNoPool = k.div(newYesPool);
  const tokensReceived = pool.noPool.sub(newNoPool);

  const newPool = { yesPool: newYesPool, noPool: newNoPool };

  return {
    tokensReceived,
    newYesPool,
    newNoPool,
    newYesProbability: yesProbability(newPool),
    newNoProbability: noProbability(newPool),
  };
}

/**
 * Sell NO shares back into the pool.
 *
 * Mechanism: shares return to the NO pool, then the constant product
 * invariant determines how many tokens come out of the YES pool.
 */
export function sellNoShares(
  pool: PoolState,
  shares: Decimal
): SellResult {
  validateSellInputs(pool, shares);

  const k = pool.yesPool.mul(pool.noPool);
  const newNoPool = pool.noPool.add(shares);
  const newYesPool = k.div(newNoPool);
  const tokensReceived = pool.yesPool.sub(newYesPool);

  const newPool = { yesPool: newYesPool, noPool: newNoPool };

  return {
    tokensReceived,
    newYesPool,
    newNoPool,
    newYesProbability: yesProbability(newPool),
    newNoProbability: noProbability(newPool),
  };
}

/**
 * Preview a sell operation without modifying state.
 * Returns the tokens the user would receive for selling their shares.
 */
export function previewSell(
  pool: PoolState,
  outcome: 'yes' | 'no',
  shares: Decimal
): { tokensReceived: Decimal; newYesProbability: Decimal; newNoProbability: Decimal } {
  const result =
    outcome === 'yes'
      ? sellYesShares(pool, shares)
      : sellNoShares(pool, shares);

  return {
    tokensReceived: result.tokensReceived,
    newYesProbability: result.newYesProbability,
    newNoProbability: result.newNoProbability,
  };
}

/**
 * Validate trade inputs. Throws on invalid state.
 */
function validateTradeInputs(pool: PoolState, tokenAmount: Decimal): void {
  if (tokenAmount.lte(0)) {
    throw new Error('Token amount must be positive');
  }
  if (pool.yesPool.lte(0) || pool.noPool.lte(0)) {
    throw new Error('Pool values must be positive');
  }
}

/**
 * Validate sell inputs. Throws on invalid state.
 */
function validateSellInputs(pool: PoolState, shares: Decimal): void {
  if (shares.lte(0)) {
    throw new Error('Shares must be positive');
  }
  if (pool.yesPool.lte(0) || pool.noPool.lte(0)) {
    throw new Error('Pool values must be positive');
  }
}

// =============================================================================
// Multi-outcome CPMM
// =============================================================================

/**
 * Pool state for a multi-outcome market.
 * Each element is the liquidity pool for one outcome.
 */
export type MCPoolState = {
  pools: Decimal[];
};

export type MCTradeResult = {
  sharesReceived: Decimal;
  newPools: Decimal[];
  newProbabilities: Decimal[];
};

export type MCSellResult = {
  tokensReceived: Decimal;
  newPools: Decimal[];
  newProbabilities: Decimal[];
};

/**
 * Compute the constant product k = product of all pools.
 */
function mcProduct(pools: Decimal[]): Decimal {
  return pools.reduce((acc, p) => acc.mul(p), new Decimal(1));
}

/**
 * Compute probabilities for all outcomes in a multi-outcome CPMM.
 *
 * P(i) = (1/q_i) / sum(1/q_j for all j)
 *
 * This is the standard N-outcome CPMM probability formula and sums to 1.
 */
export function mcProbabilities(state: MCPoolState): Decimal[] {
  const { pools } = state;
  if (pools.length < 2) throw new Error('Need at least 2 outcomes');
  for (const p of pools) {
    if (p.lte(0)) throw new Error('Pool values must be positive');
  }
  const inverses = pools.map((p) => new Decimal(1).div(p));
  const sumInverses = inverses.reduce((a, b) => a.add(b), new Decimal(0));
  return inverses.map((inv) => inv.div(sumInverses));
}

/**
 * Buy shares of a specific outcome in a multi-outcome CPMM.
 *
 * Mechanism: tokens are added to every OTHER pool. The target pool is
 * adjusted downward to maintain the constant product invariant, and the
 * difference is the shares received.
 *
 * For each j ≠ outcomeIndex: newPool[j] = pool[j] + tokenAmount
 * k = product(pool[i])
 * newPool[outcomeIndex] = k / product(newPool[j] for j ≠ outcomeIndex)
 * sharesReceived = pool[outcomeIndex] - newPool[outcomeIndex]
 */
export function mcBuyShares(
  state: MCPoolState,
  outcomeIndex: number,
  tokenAmount: Decimal
): MCTradeResult {
  const { pools } = state;
  validateMCTradeInputs(pools, outcomeIndex, tokenAmount);

  const k = mcProduct(pools);
  const newPools = pools.map((p, i) =>
    i === outcomeIndex ? p : p.add(tokenAmount)
  );

  // Product of all pools except the target
  const otherProduct = newPools.reduce(
    (acc, p, i) => (i === outcomeIndex ? acc : acc.mul(p)),
    new Decimal(1)
  );

  newPools[outcomeIndex] = k.div(otherProduct);
  const sharesReceived = pools[outcomeIndex].sub(newPools[outcomeIndex]);

  const newState = { pools: newPools };

  return {
    sharesReceived,
    newPools,
    newProbabilities: mcProbabilities(newState),
  };
}

/**
 * Sell shares of a specific outcome back into the pool.
 *
 * Mechanism: shares return to the target pool. Then for each other pool,
 * we need to determine how many tokens come out. We maintain the constant
 * product invariant by removing equal tokens from all other pools.
 *
 * newPool[outcomeIndex] = pool[outcomeIndex] + shares
 * k = product(pool[i])
 * Each other pool shrinks equally: newPool[j] = x for all j ≠ outcomeIndex
 * where x^(N-1) * newPool[outcomeIndex] = k
 * Actually, that's not right — the pools aren't equal in general.
 *
 * Correct approach: tokens come out of all other pools equally.
 * newPool[j] = pool[j] - tokensReceived for j ≠ outcomeIndex
 * We solve for tokensReceived such that product(newPools) = k.
 *
 * newPool[outcomeIndex] * product(pool[j] - t for j ≠ outcomeIndex) = k
 * This is an (N-1)-degree polynomial. For practical use, we use
 * Newton's method to find t.
 */
export function mcSellShares(
  state: MCPoolState,
  outcomeIndex: number,
  shares: Decimal
): MCSellResult {
  const { pools } = state;
  validateMCSellInputs(pools, outcomeIndex, shares);

  const k = mcProduct(pools);
  const newTargetPool = pools[outcomeIndex].add(shares);

  // We need: newTargetPool * product(pools[j] - t, j ≠ outcomeIndex) = k
  // Solve for t using Newton's method.
  const otherPools = pools.filter((_, i) => i !== outcomeIndex);
  const targetProduct = k.div(newTargetPool); // product of other new pools must equal this

  // f(t) = product(otherPools[j] - t) - targetProduct = 0
  // f'(t) = -sum(product(otherPools[j] - t) / (otherPools[j] - t))
  let t = new Decimal(0);
  for (let iter = 0; iter < 100; iter++) {
    const terms = otherPools.map((p) => p.sub(t));
    // Ensure all terms are positive
    if (terms.some((term) => term.lte(0))) {
      t = t.mul(new Decimal('0.5')); // backtrack
      continue;
    }
    const prod = terms.reduce((a, b) => a.mul(b), new Decimal(1));
    const f = prod.sub(targetProduct);

    if (f.abs().lt(new Decimal('1e-15'))) break;

    // f'(t) = -sum(prod / term_j)
    const fPrime = terms
      .reduce((acc, term) => acc.add(prod.div(term)), new Decimal(0))
      .neg();

    if (fPrime.isZero()) break;

    const step = f.div(fPrime);
    t = t.sub(step);

    // Clamp t to be non-negative
    if (t.lt(0)) t = new Decimal(0);
  }

  const tokensReceived = t;
  const newPools = pools.map((p, i) => {
    if (i === outcomeIndex) return newTargetPool;
    return p.sub(tokensReceived);
  });

  const newState = { pools: newPools };

  return {
    tokensReceived,
    newPools,
    newProbabilities: mcProbabilities(newState),
  };
}

/**
 * Preview a multi-outcome trade without modifying state.
 */
export function mcPreviewTrade(
  state: MCPoolState,
  outcomeIndex: number,
  tokenAmount: Decimal
): { sharesReceived: Decimal; newProbabilities: Decimal[] } {
  const result = mcBuyShares(state, outcomeIndex, tokenAmount);
  return {
    sharesReceived: result.sharesReceived,
    newProbabilities: result.newProbabilities,
  };
}

/**
 * Preview a multi-outcome sell without modifying state.
 */
export function mcPreviewSell(
  state: MCPoolState,
  outcomeIndex: number,
  shares: Decimal
): { tokensReceived: Decimal; newProbabilities: Decimal[] } {
  const result = mcSellShares(state, outcomeIndex, shares);
  return {
    tokensReceived: result.tokensReceived,
    newProbabilities: result.newProbabilities,
  };
}

/**
 * Create a multi-outcome market pool with equal liquidity per outcome.
 *
 * @param liquidity - Total initial tokens to seed the market
 * @param numOutcomes - Number of outcomes (minimum 2, maximum 10)
 * @returns Initial pool state with equal pools
 */
export function createMCMarketPool(
  liquidity: Decimal,
  numOutcomes: number
): MCPoolState {
  if (liquidity.lte(0)) {
    throw new Error('Liquidity must be positive');
  }
  if (numOutcomes < 2 || numOutcomes > 10) {
    throw new Error('Number of outcomes must be between 2 and 10');
  }
  const perPool = liquidity.div(numOutcomes);
  return { pools: Array.from({ length: numOutcomes }, () => perPool) };
}

/**
 * Calculate total pool for a multi-outcome market (sum of all pools).
 */
export function mcTotalPool(state: MCPoolState): Decimal {
  return state.pools.reduce((a, b) => a.add(b), new Decimal(0));
}

function validateMCTradeInputs(
  pools: Decimal[],
  outcomeIndex: number,
  tokenAmount: Decimal
): void {
  if (tokenAmount.lte(0)) {
    throw new Error('Token amount must be positive');
  }
  if (pools.length < 2) {
    throw new Error('Need at least 2 outcomes');
  }
  if (outcomeIndex < 0 || outcomeIndex >= pools.length) {
    throw new Error('Invalid outcome index');
  }
  for (const p of pools) {
    if (p.lte(0)) throw new Error('Pool values must be positive');
  }
}

function validateMCSellInputs(
  pools: Decimal[],
  outcomeIndex: number,
  shares: Decimal
): void {
  if (shares.lte(0)) {
    throw new Error('Shares must be positive');
  }
  if (pools.length < 2) {
    throw new Error('Need at least 2 outcomes');
  }
  if (outcomeIndex < 0 || outcomeIndex >= pools.length) {
    throw new Error('Invalid outcome index');
  }
  for (const p of pools) {
    if (p.lte(0)) throw new Error('Pool values must be positive');
  }
}
