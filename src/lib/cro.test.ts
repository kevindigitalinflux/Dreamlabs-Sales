import { describe, expect, it } from 'vitest';
import { croRejectionMessage, parseCroCompanies } from '../../supabase/functions/_shared/cro';

describe('parseCroCompanies', () => {
  it('maps CRO search rows', () => {
    const out = parseCroCompanies([{ company_num: 123456, company_name: 'ACME LIMITED', company_address_1: '1 Main St', company_address_2: 'Dublin', company_status_desc: 'Normal', eircode: 'D01 X2Y3' }]);
    expect(out).toEqual([{ company_number: '123456', name: 'ACME LIMITED', address: '1 Main St, Dublin', status: 'Normal', eircode: 'D01 X2Y3' }]);
  });
  it('is tolerant of junk', () => {
    expect(parseCroCompanies(null)).toEqual([]);
    expect(parseCroCompanies([{}])).toEqual([]);
  });
});

describe('croRejectionMessage', () => {
  it('maps CRO HTTP errors', () => {
    expect(croRejectionMessage(new Error('CRO HTTP 401'))).toBe('CRO rejected the key (HTTP 401)');
  });
  it('ignores other errors', () => {
    expect(croRejectionMessage(new Error('network down'))).toBeNull();
    expect(croRejectionMessage('CRO HTTP 401')).toBeNull();
  });
});
