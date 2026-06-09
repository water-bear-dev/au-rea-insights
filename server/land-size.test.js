const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLandSize,
  getStreetSlug,
  getAllhomesPropertyUrl,
  extractLandSizeFromHtml,
  fetchLandSizeFromPropertyComAu,
  fetchLandSizeFromAllhomes,
  resolveLandSizeStrict,
  isPointInPolygon,
  findSchoolBySpatialLookup,
  calculateDistance,
  findBestSchoolMatch,
  resolveCatchmentSchools
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



test('isPointInPolygon correctly flags points inside and outside polygon', () => {
  const polygon = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0]
  ];
  assert.equal(isPointInPolygon([5, 5], polygon), true);
  assert.equal(isPointInPolygon([15, 5], polygon), false);
});

test('findSchoolBySpatialLookup matches zoned school name for VIC address point', () => {
  // Moorabbin Primary boundary polygon covers [145.025 to 145.050, -37.950 to -37.930]
  // 19A Katoomba St: lat -37.9361680, lon 145.0344201
  const primaryMatch = findSchoolBySpatialLookup(-37.9361680, 145.0344201, 'VIC', 'Primary');
  assert.equal(primaryMatch, 'Moorabbin Primary School');
  const secondaryMatch = findSchoolBySpatialLookup(-37.9361680, 145.0344201, 'VIC', 'Secondary');
  assert.equal(secondaryMatch, 'Sandringham College');
});

test('calculateDistance correctly calculates distance in km', () => {
  const distance = calculateDistance(-37.9361680, 145.0344201, -37.9419715, 145.0392712);
  assert.ok(distance > 0.5 && distance < 1.0);
});

test('resolveCatchmentSchools maps properties in Moorabbin zone correctly', () => {
  const schools = resolveCatchmentSchools('VIC', 'Hampton East', -37.9361680, 145.0344201);
  assert.ok(schools.some(s => s.name === 'Moorabbin Primary School' && s.type === 'Primary'));
  assert.ok(schools.some(s => s.name === 'Sandringham College' && s.type === 'Secondary'));
});

test('findSchoolBySpatialLookup matches zoned school name for NSW address point dynamically', () => {
  // Matthew Pearce boundary polygon covers [150.900 to 151.100, -33.800 to -33.600]
  // Coordinates: lat -33.76, lng 150.966
  const primaryMatch = findSchoolBySpatialLookup(-33.76, 150.966, 'NSW', 'Primary');
  assert.equal(primaryMatch, 'Matthew Pearce Public School');
});

test('findBestSchoolMatch fallback retrieves previous ranked year if current is unranked', () => {
  const fakeSchools = [
    { name: 'Mock School', assessedYear: 2024, ranking: null, type: 'Secondary' },
    { name: 'Mock School', assessedYear: 2023, ranking: 45, type: 'Secondary' },
    { name: 'Mock School', assessedYear: 2022, ranking: 42, type: 'Secondary' }
  ];
  const result = findBestSchoolMatch(fakeSchools, 'Mock School', 'Secondary');
  assert.equal(result.assessedYear, 2023);
  assert.equal(result.ranking, 45);
});
