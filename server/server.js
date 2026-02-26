const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Support persistent disk on Render (DATA_DIR env var) or fall back to local
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'kaziconnect.db');

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the root directory (where index.html is)
app.use(express.static(path.join(__dirname, '..')));

// Database Setup
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database at:', DB_PATH);
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Jobs table with status for moderation
        db.run(`CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT NOT NULL,
            type TEXT NOT NULL,
            salary TEXT,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'approved'
        )`);

        // Migrate existing tables: add status column if it doesn't exist
        db.run(`ALTER TABLE jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`, (err) => {
            // Ignore "duplicate column" errors on existing DBs
        });

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
            if (row && row.count === 0) {
                const stmt = db.prepare("INSERT INTO jobs (title, company, location, type, salary, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)");
                const jobs = [
                    ['Agri-Tech Field Officer', 'Siaya Farmers Coop', 'Siaya County', 'rural', 'KES 25,000', 'Help smallholder farmers improve yields using modern techniques. Requires travel within the county.', 'approved'],
                    ['Matatu Fleet Manager', 'Nairobi Express', 'Nairobi', 'urban', 'KES 45,000', 'Manage route scheduling and driver performance. Must be familiar with Nairobi routes.', 'approved'],
                    ['Remote Data Entry', 'SkillHub Kenya', 'Remote', 'remote', 'KES 15,000', 'Register new graduates into the skills database. Flexible hours, works fully online.', 'approved'],
                    ['Pharmacy Assistant', 'MediCare Kayole', 'Kayole, Nairobi', 'urban', 'KES 30,000', 'Assist pharmacists in dispensing medicine and managing inventory.', 'approved'],
                    ['Community Educator', 'Bondo NGO', 'Bondo', 'rural', 'KES 20,000', 'Conduct workshops for youth on financial literacy and health.', 'approved'],
                    ['Delivery Rider', 'Haraka Logistics', 'Mombasa', 'urban', 'KES 28,000', 'Fast delivery across Mombasa island. Motorcycle license required.', 'approved']
                ];
                jobs.forEach(job => stmt.run(job));
                stmt.finalize();
                console.log('Database seeded with initial jobs.');
            }
        });
    });
}

// ==========================================
// PUBLIC API ENDPOINTS
// ==========================================

// Get all APPROVED jobs
app.get('/api/jobs', (req, res) => {
    db.all("SELECT * FROM jobs WHERE status = 'approved' ORDER BY id DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Submit a new job (goes into 'pending' for moderation)
app.post('/api/jobs', (req, res) => {
    const { title, company, location, type, salary, description } = req.body;

    if (!title || !company || !location || !type) {
        return res.status(400).json({ error: 'Missing required fields: title, company, location, type' });
    }

    const stmt = db.prepare(
        "INSERT INTO jobs (title, company, location, type, salary, description, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')"
    );
    stmt.run([title, company, location, type, salary || '', description || ''], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
            id: this.lastID,
            message: 'Job submitted for review. It will appear publicly once approved.'
        });
    });
    stmt.finalize();
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

// ==========================================
// ADMIN API ENDPOINTS (No auth for MVP)
// ==========================================

// Get ALL jobs including pending (admin view)
app.get('/api/admin/jobs', (req, res) => {
    db.all("SELECT * FROM jobs ORDER BY id DESC", [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

// Approve a pending job
app.patch('/api/admin/jobs/:id/approve', (req, res) => {
    const { id } = req.params;
    db.run("UPDATE jobs SET status = 'approved' WHERE id = ?", [id], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json({ message: `Job ${id} approved successfully.` });
    });
});

// Reject/remove a pending job
app.delete('/api/admin/jobs/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM jobs WHERE id = ?", [id], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json({ message: `Job ${id} deleted.` });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
