const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const NCBI_BASE = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi';

const NCBI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; GenomeSearchApp/1.0)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); 
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.post('/blast/submit', express.json(), async (req, res) => {
    const { sequence } = req.body;

    if (!sequence || !/^[ACGTNRYSWKMBDHV]+$/i.test(sequence)) {
        return res.status(400).json({ error: 'Invalid or missing DNA sequence.' });
    }

    const params = new URLSearchParams({
        CMD: 'Put',
        PROGRAM: 'blastn',
        DATABASE: 'nr',
        QUERY: sequence,
        SHORT_QUERY_ADJUST: 'true' // Fixes errors when testing with short sequences
    });

    try {
        const response = await fetch(`${NCBI_BASE}?${params}`, { headers: NCBI_HEADERS });
        if (!response.ok) return res.status(502).json({ error: `NCBI HTTP ${response.status}` });

        const text = await response.text();
        const ridMatch = text.match(/^\s*RID\s*=\s*([A-Z0-9]+)\s*$/m);

        if (!ridMatch) {
            return res.status(502).json({ error: 'Could not parse Request ID from NCBI.' });
        }
        res.json({ rid: ridMatch[1] });
    } catch (err) {
        res.status(502).json({ error: `Failed to reach NCBI: ${err.message}` });
    }
});

app.get('/blast/results', async (req, res) => {
    const { rid } = req.query;

    if (!rid || !/^[A-Z0-9]+$/i.test(rid)) {
        return res.status(400).json({ error: 'Invalid or missing RID.' });
    }

    const params = new URLSearchParams({
        CMD: 'Get',
        RID: rid,
        FORMAT_TYPE: 'JSON2',
        ALIGNMENT_VIEW: 'Pairwise' // Force NCBI to stay in standard alignment layout
    });

    try {
        const response = await fetch(`${NCBI_BASE}?${params}`, { headers: NCBI_HEADERS });
        if (!response.ok) return res.status(502).json({ error: `NCBI HTTP ${response.status}` });

        const text = await response.text();

        if (text.includes('Status=WAITING') || text.includes('Status=READYING')) {
            return res.json({ status: 'waiting' });
        }
        if (text.includes('Status=UNKNOWN')) {
            return res.status(404).json({ error: `RID ${rid} is unknown or expired.` });
        }

        const trimmed = text.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            // Log what was received to make debugging easier if NCBI drops an HTML error
            console.error("Received HTML response instead of JSON:", trimmed.substring(0, 300));
            return res.status(502).json({ error: 'Received non-JSON response from NCBI.' });
        }
        res.json({ status: 'done', data: JSON.parse(trimmed) });
    } catch (err) {
        res.status(502).json({ error: `Failed to reach NCBI: ${err.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
