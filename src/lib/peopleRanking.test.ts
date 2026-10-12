import { describe, expect, it } from 'vitest';
import { decisionScore, rankPeople, webHintScore } from '../../supabase/functions/_shared/peopleRanking';

describe('decisionScore', () => {
  it('scores titles and seniority', () => {
    expect(decisionScore('Managing Director')).toBe(3);
    expect(decisionScore('Director of Lettings')).toBe(2);
    expect(decisionScore('Office Manager')).toBe(1);
    expect(decisionScore('Receptionist', 'senior')).toBe(1);
    expect(decisionScore('Founder', 'executive')).toBe(5);
    expect(decisionScore(null)).toBe(0);
    expect(decisionScore({ evil: true })).toBe(0);
  });
});

describe('rankPeople', () => {
  const people = [
    { first_name: 'Amy', last_name: 'Jones', title: 'Lettings Negotiator' },
    { first_name: 'David', last_name: 'Cox', title: 'Manager' },
    { first_name: 'Sara', last_name: 'Cox', title: 'Manager' },
    { first_name: 'Tom', last_name: 'Reed', title: 'Director' },
  ];
  it('puts decision makers first and uses web-named roles as a tie-breaker', () => {
    const ranked = rankPeople(people, [{ name: 'David Cox', role: 'Owner' }]);
    expect(ranked.map((p) => p.first_name)).toEqual(['David', 'Tom', 'Sara', 'Amy']);
  });
  it('keeps the original order without hints and never drops anyone', () => {
    expect(rankPeople(people).map((p) => p.first_name)).toEqual(['Tom', 'David', 'Sara', 'Amy']);
  });
  it('needs the same surname and first initial for a hint', () => {
    expect(webHintScore({ first_name: 'D', last_name: 'Cox' }, [{ name: 'David Cox', role: 'Director' }])).toBe(2);
    expect(webHintScore({ first_name: 'Sara', last_name: 'Cox' }, [{ name: 'David Cox', role: 'Director' }])).toBe(0);
    expect(webHintScore({ first_name: 'David', last_name: 'Cox' }, [{ name: 'David Cox', role: 'Bookkeeper' }])).toBe(1);
  });
});
