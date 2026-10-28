import { expect, it } from 'vitest';
import { extractTeamMembers, parseLeadPersonName } from '../../supabase/functions/_shared/deepFindRules';

it.each(['Kia Ora', 'Hello There', 'Good Morning', 'Good Evening', 'Dear Customer', 'Hey Everyone', 'Welcome Back'])('rejects greeting %s in every website representation', name => {
  expect(extractTeamMembers(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Person', name, jobTitle: 'Owner' })}</script><p>${name} | Owner</p>`)).toEqual([]);
  expect(parseLeadPersonName(name)).toBeNull();
});
it('retains real names with explicit roles', () => {
  expect(extractTeamMembers('<p>Jane Smith | Owner</p>')).toEqual([{name:'Jane Smith',role:'Owner'}]);
  expect(parseLeadPersonName('Jane Smith')).toMatchObject({first:'Jane',last:'Smith'});
});

it('rejects a greeting disguised with an honorific', () => { expect(parseLeadPersonName('Dr Kia Ora')).toBeNull(); });

it.each(['Mary Dear','John Hey','Jane Thanks','Alice Cheers','Hilary Hill','Hiroshi Tanaka'])('retains surname in %s', name => {
  expect(parseLeadPersonName(name)).not.toBeNull();
  expect(extractTeamMembers('<p>'+name+' | Owner</p>')).toEqual([{name,role:'Owner'}]);
});
