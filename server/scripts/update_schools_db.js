const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'schools_db.json');
let schoolsDb = {};

try {
  schoolsDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
} catch (e) {
  console.error('Failed to load schools database:', e);
}

const STATES = ['vic', 'nsw', 'qld', 'wa', 'sa', 'tas', 'act', 'nt'];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeAndUpdate() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  for (let i = 0; i < STATES.length; i++) {
    const state = STATES[i];
    const stateUpper = state.toUpperCase();
    if (!schoolsDb[stateUpper]) {
      schoolsDb[stateUpper] = [];
    }

    // Wait 10 seconds before starting a new state to avoid 429 rate limits, except for the very first request
    if (i > 0) {
      console.log(`[Scraper] Pausing 10s before scraping ${stateUpper} to respect rate limits...`);
      await sleep(10000);
    }

    console.log(`[Scraper] Scraping ${stateUpper} Primary School Ratings...`);
    try {
      const url = `https://bettereducation.com.au/school/Primary/${state}/${state}_top_primary_schools.aspx`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      $('table tr').each((_, element) => {
        const cells = $(element).find('td');
        if (cells.length >= 10) {
          const rawSchoolField = $(cells[1]).text().trim();
          if (!rawSchoolField || (rawSchoolField.toLowerCase().includes('school') === false && rawSchoolField.toLowerCase().includes('primary') === false && rawSchoolField.toLowerCase().includes('college') === false && rawSchoolField.toLowerCase().includes('grammar') === false)) {
            return;
          }
          const schoolName = rawSchoolField.split(',')[0].trim();
          let suburbVal = '';
          const parts = rawSchoolField.split(',');
          if (parts.length > 1) {
            suburbVal = parts[1].trim();
          }
          
          const orderText = $(cells[0]).text().trim();
          const rankingVal = /^\d+$/.test(orderText) ? parseInt(orderText, 10) : null;
          
          const scoreText = $(cells[3]).text().trim();
          const scoreVal = /^\d+$/.test(scoreText) ? parseInt(scoreText, 10) : null;
          
          let sectorVal = $(cells[9]).text().trim();
          if (sectorVal.toLowerCase() === 'non-government') {
            sectorVal = 'Independent';
          } else if (sectorVal) {
            sectorVal = sectorVal.charAt(0).toUpperCase() + sectorVal.slice(1).toLowerCase();
          } else {
            sectorVal = 'Government';
          }

          if (schoolName && scoreVal) {
            const match = schoolsDb[stateUpper].find(s => s.type === 'Primary' && s.name.toLowerCase() === schoolName.toLowerCase());
            if (match) {
              match.score = scoreVal;
              if (rankingVal) match.ranking = rankingVal;
              if (suburbVal) match.suburb = suburbVal;
              match.sector = sectorVal;
              console.log(`[Scraper][${stateUpper}] Updated Primary ${schoolName} score: ${scoreVal}`);
            } else {
              const newSchool = {
                name: schoolName,
                type: 'Primary',
                ranking: rankingVal,
                score: scoreVal,
                assessedYear: 2024,
                sector: sectorVal
              };
              if (suburbVal) newSchool.suburb = suburbVal;
              schoolsDb[stateUpper].push(newSchool);
              console.log(`[Scraper][${stateUpper}] Added new Primary school: ${schoolName} (score: ${scoreVal})`);
            }
          }
        }
      });
    } catch (e) {
      console.error(`[Scraper][${stateUpper}] Failed scraping primary ratings:`, e.message);
    }

    // Wait 10 seconds between primary and secondary scrapings for the same state
    console.log(`[Scraper] Pausing 10s before scraping ${stateUpper} Secondary...`);
    await sleep(10000);

    console.log(`[Scraper] Scraping ${stateUpper} Secondary School Ratings...`);
    try {
      const url = `https://bettereducation.com.au/school/secondary/${state}/${state}_top_secondary_schools.aspx`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      $('table tr').each((_, element) => {
        const cells = $(element).find('td');
        if (cells.length >= 10) {
          const rawSchoolField = $(cells[1]).text().trim();
          if (!rawSchoolField || (rawSchoolField.toLowerCase().includes('school') === false && rawSchoolField.toLowerCase().includes('high') === false && rawSchoolField.toLowerCase().includes('college') === false && rawSchoolField.toLowerCase().includes('grammar') === false)) {
            return;
          }
          const schoolName = rawSchoolField.split(',')[0].trim();
          let suburbVal = '';
          const parts = rawSchoolField.split(',');
          if (parts.length > 1) {
            suburbVal = parts[1].trim();
          }
          
          const orderText = $(cells[0]).text().trim();
          const rankingVal = /^\d+$/.test(orderText) ? parseInt(orderText, 10) : null;
          
          const scoreText = $(cells[3]).text().trim();
          const scoreVal = /^\d+$/.test(scoreText) ? parseInt(scoreText, 10) : null;
          
          let sectorVal = $(cells[9]).text().trim();
          if (sectorVal.toLowerCase() === 'non-government') {
            sectorVal = 'Independent';
          } else if (sectorVal) {
            sectorVal = sectorVal.charAt(0).toUpperCase() + sectorVal.slice(1).toLowerCase();
          } else {
            sectorVal = 'Government';
          }

          if (schoolName && rankingVal) {
            const match = schoolsDb[stateUpper].find(s => s.type === 'Secondary' && s.name.toLowerCase() === schoolName.toLowerCase());
            if (match) {
              match.ranking = rankingVal;
              if (scoreVal) match.score = scoreVal;
              if (suburbVal) match.suburb = suburbVal;
              match.sector = sectorVal;
              console.log(`[Scraper][${stateUpper}] Updated Secondary ${schoolName} rank: ${rankingVal}`);
            } else {
              const newSchool = {
                name: schoolName,
                type: 'Secondary',
                ranking: rankingVal,
                score: scoreVal,
                assessedYear: 2024,
                sector: sectorVal
              };
              if (suburbVal) newSchool.suburb = suburbVal;
              schoolsDb[stateUpper].push(newSchool);
              console.log(`[Scraper][${stateUpper}] Added new Secondary school: ${schoolName} (rank: ${rankingVal})`);
            }
          }
        }
      });
    } catch (e) {
      console.error(`[Scraper][${stateUpper}] Failed scraping secondary ratings:`, e.message);
    }
  }

  // Save changes to database
  fs.writeFileSync(DB_PATH, JSON.stringify(schoolsDb, null, 2), 'utf8');
  console.log('[Scraper] Database update completed.');
}

scrapeAndUpdate();
