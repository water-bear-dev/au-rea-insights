const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLandSize,
  getStreetSlug,
  getAllhomesPropertyUrl,
  extractLandSizeFromHtml,
  fetchLandSizeFromPropertyComAu,
  fetchLandSizeFromAllhomes,
  geminiRequestWithRetry,
  resolveLandSizeStrict
} = require('./index');

test('normalizeLandSize parses supported square meter formats', () => {
  assert.equal(normalizeLandSize('1,234 sqm'), '1234m²');
  assert.equal(normalizeLandSize('420 m2'), '420m²');
  assert.equal(normalizeLandSize('  321 square meters  '), '321m²');
});

test('normalizeLandSize parses values with approx suffix', () => {
  assert.equal(normalizeLandSize('188 m² approx.'), '188m²');
  assert.equal(normalizeLandSize('188m2 approximately'), '188m²');
});

test('getStreetSlug normalises unit slash and street suffix', () => {
  assert.equal(getStreetSlug('2/1 Main Street'), '2-1-main-st');
  assert.equal(getStreetSlug('99 River Parade'), '99-river-pde');
});

test('getAllhomesPropertyUrl builds direct property slug URL', () => {
  const url = getAllhomesPropertyUrl('VIC', 'Hampton East', '3188', '19A Katoomba Street');
  assert.equal(url, 'https://www.allhomes.com.au/19a-katoomba-street-hampton-east-vic-3188');
});

test('fetchLandSizeFromPropertyComAu returns verified value when present', async () => {
  const fakeAxios = {
    get: async () => ({ data: '<html><body>Land size 503m²</body></html>' })
  };
  const result = await fetchLandSizeFromPropertyComAu('VIC', 'Richmond', '3121', '12 Bridge Street', fakeAxios);
  assert.equal(result.status, 'verified');
  assert.equal(result.value, '503m²');
  assert.equal(result.source, 'property_com_au_text');
});

test('fetchLandSizeFromAllhomes returns verified value when present', async () => {
  const fakeAxios = {
    get: async () => ({ data: '<script>{"landSize":{"value":612}}</script>' })
  };
  const result = await fetchLandSizeFromAllhomes('VIC', 'Richmond', '3121', '12 Bridge Street', fakeAxios);
  assert.equal(result.status, 'verified');
  assert.equal(result.value, '612m²');
  assert.equal(result.source, 'allhomes_text');
});

test('extractLandSizeFromHtml parses allhomes-style block size with approx', () => {
  const html = '<div>Block size: 188 m² approx.</div>';
  assert.equal(extractLandSizeFromHtml(html), '188m²');
});

test('extractLandSizeFromHtml parses block size when value is split by tags', () => {
  const html = '<div>Block size: <strong>188</strong> m² <span>approx.</span></div>';
  assert.equal(extractLandSizeFromHtml(html), '188m²');
});

test('resolveLandSizeStrict falls back from realestate to property.com.au', async () => {
  const calls = [];
  const sleepCalls = [];
  const fakeAxios = {
    get: async (url) => {
      calls.push(url);
      if (url.includes('realestate.com.au')) {
        return { data: '<html><body>No land size</body></html>' };
      }
      if (url.includes('property.com.au')) {
        return { data: '<html><body>Block size: 740 sqm</body></html>' };
      }
      return { data: '<html><body>No land size</body></html>' };
    }
  };

  const result = await resolveLandSizeStrict(
    { state: 'VIC', suburb: 'Richmond', postcode: '3121', street: '12 Bridge Street' },
    {
      axiosInstance: fakeAxios,
      useGemini: false,
      waitMs: 5000,
      sleepFn: async (ms) => { sleepCalls.push(ms); }
    }
  );

  assert.equal(result.status, 'verified');
  assert.equal(result.value, '740m²');
  assert.equal(result.source, 'property_com_au_text');
  assert.ok(calls.some(url => url.includes('realestate.com.au')));
  assert.ok(calls.some(url => url.includes('property.com.au')));
  assert.deepEqual(sleepCalls, [5000]);
  assert.ok(Array.isArray(result.attempts));
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].step, 'realestate.com.au');
  assert.equal(result.attempts[0].landSize, null);
  assert.equal(result.attempts[1].step, 'property.com.au');
  assert.equal(result.attempts[1].landSize, '740m²');
});

test('resolveLandSizeStrict falls back to allhomes when first two sources fail', async () => {
  const calls = [];
  const sleepCalls = [];
  const fakeAxios = {
    get: async (url) => {
      calls.push(url);
      if (url.includes('allhomes.com.au')) {
        return { data: '<html><body>Land area 455 m2</body></html>' };
      }
      return { data: '<html><body>No structured value</body></html>' };
    }
  };

  const result = await resolveLandSizeStrict(
    { state: 'ACT', suburb: 'Turner', postcode: '2612', street: '10 Watson Street' },
    {
      axiosInstance: fakeAxios,
      useGemini: false,
      waitMs: 5000,
      sleepFn: async (ms) => { sleepCalls.push(ms); }
    }
  );

  assert.equal(result.status, 'verified');
  assert.equal(result.value, '455m²');
  assert.equal(result.source, 'allhomes_text');
  assert.ok(calls.some(url => url.includes('realestate.com.au')));
  assert.ok(calls.some(url => url.includes('property.com.au')));
  assert.ok(calls.some(url => url.includes('allhomes.com.au')));
  assert.deepEqual(sleepCalls, [5000, 5000]);
  assert.ok(Array.isArray(result.attempts));
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts[0].step, 'realestate.com.au');
  assert.equal(result.attempts[1].step, 'property.com.au');
  assert.equal(result.attempts[2].step, 'allhomes.com.au');
  assert.equal(result.attempts[2].landSize, '455m²');
});

test('geminiRequestWithRetry retries once on 429 and succeeds', async () => {
  let attempts = 0;
  const fakeAxios = {
    post: async () => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('rate limited');
        err.response = { status: 429 };
        throw err;
      }
      return { data: { ok: true } };
    }
  };

  const response = await geminiRequestWithRetry(
    'https://example.test',
    { contents: [] },
    fakeAxios,
    { maxAttempts: 2, baseDelayMs: 1 }
  );

  assert.deepEqual(response.data, { ok: true });
  assert.equal(attempts, 2);
});
