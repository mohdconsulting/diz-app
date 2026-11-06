/** Services customers can order. 'goods' and 'deliver' are kept in the dictionaries only so old jobs still show their labels. */
export const OFFERED_SERVICES = ['junk', 'moving', 'pro', 'towing'];

/** Services without a size/scope step. Customers always enter the price themselves, so there is no price table. */
export const NO_SIZE_SERVICES = ['pro'];
export function hasSizes(service: string | null): boolean { return !!service && !NO_SIZE_SERVICES.includes(service); }
