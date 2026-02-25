const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'kaziconnect.db');

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the root directory (where index.html is)
app.use(express.static(path.join(__dirname, '..')));

// Database Setup
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Jobs table
        db.run(`CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT NOT NULL,
            type TEXT NOT NULL,
            salary TEXT,
            description TEXT
        )`);

        // Applications table
        db.run(`CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jobId INTEGER,
            jobTitle TEXT,
            applicantName TEXT,
            applicantPhone TEXT,
            applicantNotes TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(jobId) REFERENCES jobs(id)
        )`);

        // Seed initial data if empty
        db.get("SELECT COUNT(*) as count FROM jobs", (err, row) => {
            if (row.count === 0) {
                const stmt = db.prepare("INSERT INTO jobs (title, company, location, type, salary, description) VALUES (?, ?, ?, ?, ?, ?)");
                const jobs = [
                    ['Agri-Tech Field Officer', 'Siaya Farmers Coop', 'Siaya County', 'rural', 'KES 25,000', 'Help smallholder farmers improve yields using modern techniques. Requires travel within the county.'],
                    ['Matatu Fleet Manager', 'Nairobi Express', 'Nairobi', 'urban', 'KES 45,000', 'Manage route scheduling and driver performance. Must be familiar with Nairobi routes.'],
                    ['Remote Data Entry', 'SkillHub Kenya', 'Remote', 'remote', 'KES 15,000', 'Register new graduates into the skills database. Flexible hours, works fully online.'],
                    ['Pharmacy Assistant', 'MediCare Kayole', 'Kayole, Nairobi', 'urban', 'KES 30,000', 'Assist pharmacists in dispensing medicine and managing inventory.'],
                    ['Community Educator', 'Bondo NGO', 'Bondo', 'rural', 'KES 20,000', 'Conduct workshops for youth on financial literacy and health.'],
                    ['Delivery Rider', 'Haraka Logistics', 'Mombasa', 'urban', 'KES 28,000', 'Fast delivery across Mombasa island. Motorcycle license required.']
                ];
                jobs.forEach(job => stmt.run(job));
                stmt.finalize();
                console.log('Database seeded with initial jobs.');
            }
        });
    });
}

// API Endpoints

// Get all jobs
app.get('/api/jobs', (req, res) => {
    db.all("SELECT * FROM jobs", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Submit application
app.post('/api/applications', (req, res) => {
    const { jobId, jobTitle, applicantName, applicantPhone, applicantNotes } = req.body;

    if (!jobId || !applicantName || !applicantPhone) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
    }

    const stmt = db.prepare("INSERT INTO applications (jobId, jobTitle, applicantName, applicantPhone, applicantNotes) VALUES (?, ?, ?, ?, ?)");
    stmt.run([jobId, jobTitle, applicantName, applicantPhone, applicantNotes], function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.status(201).json({ id: this.lastID, message: 'Application submitted successfully' });
    });
    stmt.finalize();
});

// Get applications (for admin/testing)
app.get('/api/applications', (req, res) => {
    db.all("SELECT * FROM applications ORDER BY timestamp DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
