/** Services customers can order. 'goods' and 'deliver' are kept in the dictionaries only so old jobs still show their labels. */
export const OFFERED_SERVICES = ['junk', 'moving', 'pro', 'towing'];

export const PRICE_BASE: Record<string, Record<number, number>> = {
  junk:{1:25000,2:45000,3:75000},
  moving:{1:60000,2:120000,3:250000},
  goods:{1:10000,2:20000},
  pro:{0:30000},
  towing:{1:40000,2:60000,3:100000},
  deliver:{1:8000,2:15000}
};
export const PRICE_BUMP: Record<string, Record<string, number>> = {
  junk:{appliances:5000, electronics:3000, leftover:10000},
  moving:{apartment:15000, house:40000},
  goods:{electronics:5000, furniture:10000},
  pro:{electrician:5000, plumber:5000, painter:4000},
  towing:{accident:15000, transport:-10000},
  deliver:{fragile:5000, package:2000}
};

/** Services without a size/scope step (the price is the base price at key 0 plus the category bump). */
export const NO_SIZE_SERVICES = ['pro'];
export function hasSizes(service: string | null): boolean { return !!service && !NO_SIZE_SERVICES.includes(service); }

export function priceFor(service: string, size: number | null, cat: string | null): number {
  const base = (PRICE_BASE[service] || {})[hasSizes(service) ? (size ?? 0) : 0] || 200;
  const bump = (PRICE_BUMP[service] || {})[cat ?? ''] || 0;
  return base + bump;
}
