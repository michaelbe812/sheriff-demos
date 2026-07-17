/** type:util may see type:types and type:util — never a domain. */
export const formatMoney = (amount: number): string =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(
    amount,
  );
