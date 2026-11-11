import { describe, expect, it } from 'vitest';
import { DomainInvariantError } from '../../../src/domain/errors/DomainError.ts';
import { FanbaseAllocation } from '../../../src/domain/value_objects/FanbaseAllocation.ts';

describe('FanbaseAllocation', () => {
  it('calcula alocacao simultanea de VUs mantendo minimo de 1 VU por persona', () => {
    const alloc = FanbaseAllocation.fromScaleFactor(1);
    expect(alloc.minSupporters).toBe(14_000_000);
    expect(alloc.maxSupporters).toBe(17_500_000);
    expect(alloc.avgSupporters).toBe(15_750_000);
    expect(alloc.newsReaders).toBe(12);
    expect(alloc.matchdayLive).toBe(8);
    expect(alloc.searchers).toBe(5);
    expect(alloc.catalogMedia).toBe(4);
    expect(alloc.mobileApp).toBe(3);
    expect(alloc.protocolMatrix).toBe(3);
    expect(alloc.totalPeakVUs).toBe(35);
    expect(alloc.supportersPerPeakVu).toBe(450_000);

    const lowScale = FanbaseAllocation.fromScaleFactor(0.1);
    expect(lowScale.mobileApp).toBe(1);
    expect(lowScale.totalPeakVUs).toBe(6);

    const fractionalScale = FanbaseAllocation.fromScaleFactor(0.4);
    expect(fractionalScale.newsReaders).toBe(5);
    expect(fractionalScale.matchdayLive).toBe(3);
    expect(fractionalScale.searchers).toBe(2);
    expect(fractionalScale.catalogMedia).toBe(2);
    expect(fractionalScale.mobileApp).toBe(1);
    expect(fractionalScale.protocolMatrix).toBe(1);
    expect(fractionalScale.totalPeakVUs).toBe(14);
  });

  it('rejeita scaleFactor invalido', () => {
    expect(() => FanbaseAllocation.fromScaleFactor(0)).toThrow(DomainInvariantError);
    expect(() => FanbaseAllocation.fromScaleFactor(-1)).toThrow(DomainInvariantError);
    expect(() => FanbaseAllocation.fromScaleFactor(Number.NaN)).toThrow(DomainInvariantError);
  });
});
