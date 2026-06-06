const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'schools_db.json');
let schoolsDb = { VIC: [], NSW: [], QLD: [] };

try {
  schoolsDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
} catch (e) {
  console.error('Failed to load schools database:', e);
}

// Scrape ratings from Better Education and update the local database
async function scrapeAndUpdate() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  console.log('[Scraper] Scraping VIC Primary School Ratings...');
  try {
    const response = await axios.get('https://bettereducation.com.au/school/Primary/vic/vic_primary_school_rating.aspx', { headers, timeout: 10000 });
    const $ = cheerio.load(response.data);
    
    // Better Education tables typically use table rows with school names and overall scores
    $('table tbody tr').each((_, element) => {
      const cells = $(element).find('td');
      if (cells.length >= 3) {
        // Find cells containing school names and scores. Often columns are: Rank/Score | School Name | Suburb
        // Let's print out or search. Better Education has overall score or rating out of 100.
        let schoolName = '';
        let scoreVal = null;
        
        cells.each((_, cell) => {
          const text = $(cell).text().trim();
          // Detect numeric score (typically 80-100) or check column headers
          if (/^[789]\d$|^100$/.test(text)) {
            scoreVal = parseInt(text, 10);
          } else if (text.toLowerCase().includes('primary') || text.toLowerCase().includes('school')) {
            schoolName = text.replace(/\s+/g, ' ');
          }
        });

        if (schoolName && scoreVal) {
          // Find and update matching VIC school in schoolsDb
          const match = schoolsDb.VIC.find(s => s.type === 'Primary' && s.name.toLowerCase() === schoolName.toLowerCase());
          if (match) {
            match.score = scoreVal;
            console.log(`[Scraper] Updated ${schoolName} score: ${scoreVal}`);
          }
        }
      }
    });
  } catch (e) {
    console.error('[Scraper] Failed scraping primary ratings:', e.message);
  }

  console.log('[Scraper] Scraping VIC Secondary School Ratings...');
  try {
    const response = await axios.get('https://bettereducation.com.au/school/secondary/vic/vic_secondary_school_rating.aspx', { headers, timeout: 10000 });
    const $ = cheerio.load(response.data);
    
    $('table tbody tr').each((_, element) => {
      const cells = $(element).find('td');
      if (cells.length >= 3) {
        let schoolName = '';
        let rankingVal = null;
        
        cells.each((idx, cell) => {
          const text = $(cell).text().trim();
          // Detect ranking (usually first column)
          if (idx === 0 && /^\d+$/.test(text)) {
            rankingVal = parseInt(text, 10);
          } else if (text.toLowerCase().includes('high') || text.toLowerCase().includes('college') || text.toLowerCase().includes('school')) {
            schoolName = text.replace(/\s+/g, ' ');
          }
        });

        if (schoolName && rankingVal) {
          const match = schoolsDb.VIC.find(s => s.type === 'Secondary' && s.name.toLowerCase() === schoolName.toLowerCase());
          if (match) {
            match.ranking = rankingVal;
            console.log(`[Scraper] Updated ${schoolName} rank: ${rankingVal}`);
          }
        }
      }
    });
  } catch (e) {
    console.error('[Scraper] Failed scraping secondary ratings:', e.message);
  }

  // Save changes to database
  fs.writeFileSync(DB_PATH, JSON.stringify(schoolsDb, null, 2), 'utf8');
  console.log('[Scraper] Database update completed.');
}

scrapeAndUpdate();
