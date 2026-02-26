const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Serve static files from the root directory (where index.html is)
app.use(express.static(path.join(__dirname, '..')));

// ==========================================
// DATABASE SETUP (Turso / libSQL)
// ==========================================
// For local development: uses a local SQLite file (no env vars needed)
// For production (Render): uses TURSO_DATABASE_URL + TURSO_AUTH_TOKEN env vars

const db = createClient(
    process.env.TURSO_DATABASE_URL
        ? {
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN
        }
        : {
            // Local fallback: file-based SQLite (same behaviour as before)
            url: `file:${path.join(__dirname, 'kaziconnect.db')}`
        }
);

async function initDb() {
    // Jobs table with status for moderation
    await db.execute(`CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        location TEXT NOT NULL,
        type TEXT NOT NULL,
        salary TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'approved'
    )`);

    // Applications table
    await db.execute(`CREATE TABLE IF NOT EXISTS applications (
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
    const { rows } = await db.execute("SELECT COUNT(*) as count FROM jobs");
    if (rows[0].count === 0) {
        const seedJobs = [
            ['Agri-Tech Field Officer', 'Siaya Farmers Coop', 'Siaya County', 'rural', 'KES 25,000', 'Help smallholder farmers improve yields using modern techniques. Requires travel within the county.', 'approved'],
            ['Matatu Fleet Manager', 'Nairobi Express', 'Nairobi', 'urban', 'KES 45,000', 'Manage route scheduling and driver performance. Must be familiar with Nairobi routes.', 'approved'],
            ['Remote Data Entry', 'SkillHub Kenya', 'Remote', 'remote', 'KES 15,000', 'Register new graduates into the skills database. Flexible hours, works fully online.', 'approved'],
            ['Pharmacy Assistant', 'MediCare Kayole', 'Kayole, Nairobi', 'urban', 'KES 30,000', 'Assist pharmacists in dispensing medicine and managing inventory.', 'approved'],
            ['Community Educator', 'Bondo NGO', 'Bondo', 'rural', 'KES 20,000', 'Conduct workshops for youth on financial literacy and health.', 'approved'],
            ['Delivery Rider', 'Haraka Logistics', 'Mombasa', 'urban', 'KES 28,000', 'Fast delivery across Mombasa island. Motorcycle license required.', 'approved']
        ];

        for (const job of seedJobs) {
            await db.execute({
                sql: "INSERT INTO jobs (title, company, location, type, salary, description, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
                args: job
            });
        }
        console.log('Database seeded with initial jobs.');
    }

    console.log('Database initialized successfully.');
}

// ==========================================
// PUBLIC API ENDPOINTS
// ==========================================

// Get all APPROVED jobs
app.get('/api/jobs', async (req, res) => {
    try {
        const { rows } = await db.execute("SELECT * FROM jobs WHERE status = 'approved' ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit a new job (goes into 'pending' for moderation)
app.post('/api/jobs', async (req, res) => {
    const { title, company, location, type, salary, description } = req.body;

    if (!title || !company || !location || !type) {
        return res.status(400).json({ error: 'Missing required fields: title, company, location, type' });
    }

    try {
        const result = await db.execute({
            sql: "INSERT INTO jobs (title, company, location, type, salary, description, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')",
            args: [title, company, location, type, salary || '', description || '']
        });
        res.status(201).json({
            id: Number(result.lastInsertRowid),
            message: 'Job submitted for review. It will appear publicly once approved.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit application
app.post('/api/applications', async (req, res) => {
    const { jobId, jobTitle, applicantName, applicantPhone, applicantNotes } = req.body;

    if (!jobId || !applicantName || !applicantPhone) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const result = await db.execute({
            sql: "INSERT INTO applications (jobId, jobTitle, applicantName, applicantPhone, applicantNotes) VALUES (?, ?, ?, ?, ?)",
            args: [jobId, jobTitle, applicantName, applicantPhone, applicantNotes]
        });
        res.status(201).json({ id: Number(result.lastInsertRowid), message: 'Application submitted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get applications (for admin/testing)
app.get('/api/applications', async (req, res) => {
    try {
        const { rows } = await db.execute("SELECT * FROM applications ORDER BY timestamp DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ADMIN API ENDPOINTS (No auth for MVP)
// ==========================================

// Get ALL jobs including pending (admin view)
app.get('/api/admin/jobs', async (req, res) => {
    try {
        const { rows } = await db.execute("SELECT * FROM jobs ORDER BY id DESC");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Approve a pending job
app.patch('/api/admin/jobs/:id/approve', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: "UPDATE jobs SET status = 'approved' WHERE id = ?",
            args: [id]
        });
        if (result.rowsAffected === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json({ message: `Job ${id} approved successfully.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reject/remove a job
app.delete('/api/admin/jobs/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await db.execute({
            sql: "DELETE FROM jobs WHERE id = ?",
            args: [id]
        });
        if (result.rowsAffected === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }
        res.json({ message: `Job ${id} deleted.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start server
initDb()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    });
