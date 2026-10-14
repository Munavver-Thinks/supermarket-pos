/** Everything the drawer needs — deliberately not a full Customer, so a row from the
 *  outstanding list can open it without first being found in the customer list. */
export interface KhataTarget {
  id: string;
  name: string;
  phone: string | null;
  creditLimitPaise: number;
}
