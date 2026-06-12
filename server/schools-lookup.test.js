const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCatchmentSchools } = require('./index');

test('resolveCatchmentSchools resolves primary and secondary schools in VIC spatially', async () => {
  // Coordinates for a property in Cheltenham, VIC
  const schools = await resolveCatchmentSchools('VIC', 'Cheltenham', -37.9645, 145.0345);
  
  assert.ok(Array.isArray(schools));
  assert.ok(schools.length > 0);
  
  const primary = schools.find(s => s.type === 'Primary');
  const secondary = schools.find(s => s.type === 'Secondary');
  
  assert.ok(primary, 'Should resolve a primary school');
  assert.ok(typeof primary.name === 'string' && primary.name.length > 0, 'Primary name should be valid string');
  assert.ok(primary.distance <= 1.0, `Primary distance (${primary.distance}) should be close`);
  
  assert.ok(secondary, 'Should resolve a secondary school');
  assert.ok(typeof secondary.name === 'string' && secondary.name.length > 0, 'Secondary name should be valid string');
  assert.ok(secondary.distance <= 3.0, `Secondary distance (${secondary.distance}) should be close`);
});

test('resolveCatchmentSchools falls back to nearest school for WA coordinates', async () => {
  // WA coordinates
  // ST JOSEPH'S COLLEGE is located near Albany (-34.9979, 117.902)
  const schools = await resolveCatchmentSchools('WA', 'Albany', -34.998, 117.902);
  
  assert.ok(Array.isArray(schools));
  assert.ok(schools.length > 0);
  
  const primary = schools.find(s => s.type === 'Primary');
  const secondary = schools.find(s => s.type === 'Secondary');
  
  assert.ok(primary, 'Should resolve nearest primary school in WA');
  assert.ok(secondary, 'Should resolve nearest secondary school in WA');
  assert.ok(primary.distance <= 1.0, 'St Joseph\'s Primary should be very close');
  assert.ok(secondary.distance <= 1.0, 'St Joseph\'s Secondary should be very close');
});

test('resolveCatchmentSchools falls back to suburb matching when coordinates are missing', async () => {
  const schools = await resolveCatchmentSchools('VIC', 'Cheltenham', null, null);
  
  assert.ok(Array.isArray(schools));
  assert.ok(schools.length > 0);
  
  const primary = schools.find(s => s.type === 'Primary');
  assert.ok(primary, 'Should fallback to suburb match');
  assert.equal(primary.distance, 0.5, 'Fallback distance should be set to 0.5');
});
