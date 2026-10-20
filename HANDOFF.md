# Handoff

- I-1 fix (websiteSuspicion): a postcode now counts as contact proof only when name evidence is a 4+ letter abbreviation/slug or a real name token in title/footer, not a bare 3-letter initialism. 3-letter initials with phone/email proof behave as before. Tests added in src/lib/deepFindA2.test.ts.
