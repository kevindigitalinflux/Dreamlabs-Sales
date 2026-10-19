import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScrapeSourceChoices } from '../components/scraper/ScrapeSourceChoices';

describe('scrape source checkbox group', () => {
  it('labels the group and checks both configured UK defaults', () => {
    const html = renderToStaticMarkup(createElement(ScrapeSourceChoices, {
      country: 'GB', sources: ['google_places', 'companies_house'],
      configured: { google_places: true, companies_house: true, cro: true }, onChange: () => {},
    }));
    expect(html).toContain('<legend');
    expect(html).toContain('Choose data sources');
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toContain('Ireland searches only');
    expect(html).toContain('aria-describedby="source-cro-reason"');
  });
  it('disables missing keys with a reason and enables CRO only in Ireland', () => {
    const html = renderToStaticMarkup(createElement(ScrapeSourceChoices, {
      country: 'IE', sources: ['google_places', 'companies_house', 'cro'],
      configured: { google_places: false, companies_house: true, cro: true }, onChange: () => {},
    }));
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('No key configured. Add one in Settings.');
    expect(html).toContain('UK searches only');
  });
});
