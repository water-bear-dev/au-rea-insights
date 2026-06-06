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

async function scrapeAndUpdate() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  for (const state of STATES) {
    const stateUpper = state.toUpperCase();
    if (!schoolsDb[stateUpper]) {
      schoolsDb[stateUpper] = [];
    }

    console.log(`[Scraper] Scraping ${stateUpper} Primary School Ratings...`);
    try {
      const url = `https://bettereducation.com.au/school/Primary/${state}/${state}_primary_school_rating.aspx`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      $('table tbody tr').each((_, element) => {
        const cells = $(element).find('td');
        if (cells.length >= 3) {
          let schoolName = '';
          let scoreVal = null;
          
          cells.each((_, cell) => {
            const text = $(cell).text().trim();
            if (/^[789]\d$|^100$/.test(text)) {
              scoreVal = parseInt(text, 10);
            } else if (text.toLowerCase().includes('primary') || text.toLowerCase().includes('school')) {
              schoolName = text.replace(/\s+/g, ' ');
            }
          });

          if (schoolName && scoreVal) {
            const match = schoolsDb[stateUpper].find(s => s.type === 'Primary' && s.name.toLowerCase() === schoolName.toLowerCase());
            if (match) {
              match.score = scoreVal;
              console.log(`[Scraper][${stateUpper}] Updated ${schoolName} score: ${scoreVal}`);
            }
          }
        }
      });
    } catch (e) {
      console.error(`[Scraper][${stateUpper}] Failed scraping primary ratings:`, e.message);
    }

    console.log(`[Scraper] Scraping ${stateUpper} Secondary School Ratings...`);
    try {
      const url = `https://bettereducation.com.au/school/secondary/${state}/${state}_secondary_school_rating.aspx`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      const $ = cheerio.load(response.data);
      
      $('table tbody tr').each((_, element) => {
        const cells = $(element).find('td');
        if (cells.length >= 3) {
          let schoolName = '';
          let rankingVal = null;
          
          cells.each((idx, cell) => {
            const text = $(cell).text().trim();
            if (idx === 0 && /^\d+$/.test(text)) {
              rankingVal = parseInt(text, 10);
            } else if (text.toLowerCase().includes('high') || text.toLowerCase().includes('college') || text.toLowerCase().includes('school')) {
              schoolName = text.replace(/\s+/g, ' ');
            }
          });

          if (schoolName && rankingVal) {
            const match = schoolsDb[stateUpper].find(s => s.type === 'Secondary' && s.name.toLowerCase() === schoolName.toLowerCase());
            if (match) {
              match.ranking = rankingVal;
              console.log(`[Scraper][${stateUpper}] Updated ${schoolName} rank: ${rankingVal}`);
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
