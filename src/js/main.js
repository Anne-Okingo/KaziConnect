/**
 * Main application logic for KaziConnect.
 */

const API_BASE_URL = '/api';

const state = {
    currentFilter: 'all',
    titleQuery: '',
    locationQuery: '',
    jobs: [],
    selectedJob: null,
    pendingCount: 0,
    currentView: 'jobs'
};

// --- Initialization ---

async function initApp() {
    try {
        await db.init();

        // Check if we have jobs; if not and online, fetch from API
        const localJobs = await db.getAllJobs();
        if (localJobs.length === 0 && navigator.onLine) {
            console.log('Fetching initial jobs from server...');
            try {
                const response = await fetch(`${API_BASE_URL}/jobs`);
                const jobs = await response.json();
                await db.saveJobs(jobs);
                state.jobs = jobs;
            } catch (err) {
                console.error('Initial job fetch failed:', err);
                state.jobs = [];
            }
        } else {
            state.jobs = localJobs;
        }

        updateConnectionStatus();
        updatePendingSyncBanner();
        updateJobSyncBanner();

        // Register Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
                .then(() => console.log('Service Worker Registered'))
                .catch(err => console.error('SW Registration Failed:', err));
        }

        // Background Sync Setup (if supported)
        if ('SyncManager' in window && navigator.onLine) {
            trySyncApplications();
            trySyncJobSubmissions();
        }

    } catch (err) {
        console.error('App init failed:', err);
    } finally {
        renderJobs();
    }
}

// --- UI Logic ---

function renderJobs() {
    const jobList = document.getElementById('job-list');
    const filteredJobs = state.jobs.filter(job => {
        const matchesFilter = state.currentFilter === 'all' || job.type === state.currentFilter;
        const matchesTitle = job.title.toLowerCase().includes(state.titleQuery.toLowerCase()) ||
            job.company.toLowerCase().includes(state.titleQuery.toLowerCase());
        const matchesLocation = job.location.toLowerCase().includes(state.locationQuery.toLowerCase());
        return matchesFilter && matchesTitle && matchesLocation;
    });

    document.getElementById('job-count').textContent = `${filteredJobs.length} jobs found`;

    if (filteredJobs.length === 0) {
        jobList.innerHTML = '<div class="empty-state"><p>No jobs found. Try adjusting your search.</p></div>';
        return;
    }

    jobList.innerHTML = filteredJobs.map(job => `
        <div class="job-card" onclick="openJobDetails(${job.id})">
            <span class="company">${job.company}</span>
            <h3>${job.title}</h3>
            <div class="job-meta">
                <span class="tag">${job.location}</span>
                <span class="tag">${job.type}</span>
            </div>
            <div class="job-footer">
                <span class="salary">${job.salary}</span>
                <span class="arrow">→</span>
            </div>
        </div>
    `).join('');
}

window.openJobDetails = async (id) => {
    const job = state.jobs.find(j => j.id === id);
    if (!job) return;

    const modal = document.getElementById('job-modal');
    const body = document.getElementById('modal-body');

    body.innerHTML = `
        <span class="company">${job.company}</span>
        <h2>${job.title}</h2>
        <div class="job-meta">
            <span class="tag">${job.location}</span>
            <span class="tag">${job.type}</span>
            <span class="tag">${job.salary}</span>
        </div>
        <div class="description" style="margin-top: 1.5rem">
            <p>${job.description}</p>
        </div>
    `;

    state.selectedJob = job;
    modal.classList.remove('hidden');
};

document.querySelector('.close-modal').onclick = () => {
    document.getElementById('job-modal').classList.add('hidden');
};

// --- Application Form ---

document.getElementById('job-application-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!state.selectedJob) return;

    const application = {
        jobId: state.selectedJob.id,
        jobTitle: state.selectedJob.title,
        applicantName: document.getElementById('applicant-name').value,
        applicantPhone: document.getElementById('applicant-phone').value,
        applicantNotes: document.getElementById('applicant-notes').value,
        status: 'pending'
    };

    const submitBtn = document.getElementById('apply-btn');
    const originalBtnText = submitBtn.textContent;

    try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving...';

        await db.queueApplication(application);

        showToast(navigator.onLine ? 'Application sent! ✅' : 'Saved offline! Will sync when online. 📶');

        updatePendingSyncBanner();
        document.getElementById('job-modal').classList.add('hidden');
        document.getElementById('job-application-form').reset();

        if (navigator.onLine) {
            trySyncApplications();
        }
    } catch (err) {
        console.error('Failed to save application:', err);
        showToast('Error saving application.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
};

// --- Post Job Modal ---

document.getElementById('post-job-btn').onclick = () => {
    document.getElementById('post-job-modal').classList.remove('hidden');
};

document.getElementById('close-post-job-modal').onclick = () => {
    document.getElementById('post-job-modal').classList.add('hidden');
};

document.getElementById('post-job-form').onsubmit = async (e) => {
    e.preventDefault();

    const jobData = {
        title: document.getElementById('job-title-input').value.trim(),
        company: document.getElementById('job-company-input').value.trim(),
        location: document.getElementById('job-location-input').value.trim(),
        type: document.getElementById('job-type-input').value,
        salary: document.getElementById('job-salary-input').value.trim(),
        description: document.getElementById('job-description-input').value.trim()
    };

    const submitBtn = document.getElementById('post-job-submit-btn');
    const originalBtnText = submitBtn.textContent;

    try {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        if (navigator.onLine) {
            const response = await fetch(`${API_BASE_URL}/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(jobData)
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Server error');
            }

            await db.queueJobSubmission({ ...jobData, synced: true });
            showToast('Job submitted for review! ✅ It will appear once approved.');
        } else {
            await db.queueJobSubmission(jobData);
            showToast('Job saved offline! 📋 Will submit automatically when online.');
        }

        updateJobSyncBanner();
        document.getElementById('post-job-modal').classList.add('hidden');
        document.getElementById('post-job-form').reset();
    } catch (err) {
        console.error('Failed to submit job:', err);
        showToast('Error submitting job. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
};

// --- Sync & Network Logic ---

async function updateConnectionStatus() {
    const status = document.getElementById('connection-status');
    const isOnline = navigator.onLine;

    if (isOnline) {
        status.textContent = 'Online';
        status.className = 'status-badge online';

        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            const registration = await navigator.serviceWorker.ready;
            try {
                await registration.sync.register('sync-applications');
                await registration.sync.register('sync-jobs');
                console.log('Background Sync registered');
            } catch (err) {
                console.warn('Background Sync registration failed, falling back to manual', err);
                trySyncApplications();
                trySyncJobSubmissions();
            }
        } else {
            trySyncApplications();
            trySyncJobSubmissions();
        }
    } else {
        status.textContent = 'Offline';
        status.className = 'status-badge offline';
    }
}

async function updatePendingSyncBanner() {
    const banner = document.getElementById('sync-banner');
    const msg = document.getElementById('sync-message');
    const pending = await db.getPendingApplications();

    state.pendingCount = pending.length;

    if (pending.length > 0) {
        banner.classList.remove('hidden');
        msg.textContent = `You have ${pending.length} pending application(s). They will sync automatically.`;
    } else {
        banner.classList.add('hidden');
    }
}

async function updateJobSyncBanner() {
    const banner = document.getElementById('job-sync-banner');
    const msg = document.getElementById('job-sync-message');
    const pending = await db.getPendingJobSubmissions();

    if (pending.length > 0) {
        banner.classList.remove('hidden');
        msg.textContent = `You have ${pending.length} pending job post(s). They will sync automatically when online.`;
    } else {
        banner.classList.add('hidden');
    }
}

async function trySyncApplications(retryCount = 0) {
    if (!navigator.onLine) return;

    const pending = await db.getPendingApplications();
    if (pending.length === 0) return;

    const isBatteryLow = 'getBattery' in navigator ? (await navigator.getBattery()).level < 0.15 : false;
    const isDataSaver = navigator.connection ? navigator.connection.saveData : false;

    if (isBatteryLow || isDataSaver) {
        console.log('Sync deferred: Low battery or Data Saver active');
        showToast('Sync deferred for battery/data saving.');
        return;
    }

    console.log(`Syncing ${pending.length} application(s) (Attempt ${retryCount + 1})...`);

    for (const app of pending) {
        try {
            const response = await fetch(`${API_BASE_URL}/applications`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId: app.jobId,
                    jobTitle: app.jobTitle,
                    applicantName: app.applicantName,
                    applicantPhone: app.applicantPhone,
                    applicantNotes: app.applicantNotes
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Server error');
            }

            console.log(`Synced application for: ${app.jobTitle}`);
            await db.markAsSynced(app.id);
        } catch (err) {
            console.error('Failed to sync application:', err);
            if (retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`Retrying in ${delay / 1000}s...`);
                setTimeout(() => trySyncApplications(retryCount + 1), delay);
            }
            break;
        }
    }

    updatePendingSyncBanner();
}

async function trySyncJobSubmissions(retryCount = 0) {
    if (!navigator.onLine) return;

    const pending = await db.getPendingJobSubmissions();
    if (pending.length === 0) return;

    console.log(`Syncing ${pending.length} pending job submission(s) (Attempt ${retryCount + 1})...`);

    for (const job of pending) {
        try {
            const response = await fetch(`${API_BASE_URL}/jobs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: job.title,
                    company: job.company,
                    location: job.location,
                    type: job.type,
                    salary: job.salary,
                    description: job.description
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Server error');
            }

            console.log(`Synced job submission: ${job.title}`);
            await db.markJobSubmissionSynced(job.id);
        } catch (err) {
            console.error('Failed to sync job submission:', err);
            if (retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`Retrying in ${delay / 1000}s...`);
                setTimeout(() => trySyncJobSubmissions(retryCount + 1), delay);
            }
            break;
        }
    }

    updateJobSyncBanner();
}

let toastTimeout;
function showToast(message) {
    const toast = document.getElementById('toast');
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.classList.remove('hidden');
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 4000);
}

// --- Event Listeners ---

function setupEventListeners() {
    document.getElementById('sync-now-btn').onclick = () => {
        trySyncApplications();
    };

    document.getElementById('job-sync-now-btn').onclick = () => {
        trySyncJobSubmissions();
    };

    document.getElementById('job-title-search').oninput = (e) => {
        state.titleQuery = e.target.value;
        renderJobs();
    };

    document.getElementById('job-location-search').oninput = (e) => {
        state.locationQuery = e.target.value;
        renderJobs();
    };

    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.onclick = () => {
            document.querySelector('.filter-chip.active').classList.remove('active');
            chip.classList.add('active');
            state.currentFilter = chip.dataset.filter;
            renderJobs();
        };
    });

    document.getElementById('my-jobs-btn').onclick = () => {
        state.currentView = 'myJobs';
        document.getElementById('hero-section').classList.add('hidden');
        document.getElementById('filter-section').classList.add('hidden');
        document.getElementById('job-list-section').classList.add('hidden');
        document.getElementById('my-jobs-section').classList.remove('hidden');
        renderMyJobs();
    };

    document.getElementById('back-to-jobs-btn').onclick = () => {
        state.currentView = 'jobs';
        document.getElementById('hero-section').classList.remove('hidden');
        document.getElementById('filter-section').classList.remove('hidden');
        document.getElementById('job-list-section').classList.remove('hidden');
        document.getElementById('my-jobs-section').classList.add('hidden');
    };
}

window.addEventListener('online', () => {
    updateConnectionStatus();
    trySyncApplications();
    trySyncJobSubmissions();
});
window.addEventListener('offline', updateConnectionStatus);

async function renderMyJobs() {
    const myJobsList = document.getElementById('my-jobs-list');
    const postedJobs = await db.getAllJobSubmissions();

    if (postedJobs.length === 0) {
        myJobsList.innerHTML = '<div class="empty-state"><p>You haven\'t posted any jobs yet. Click "+ Post a Job" to get started!</p></div>';
        return;
    }

    myJobsList.innerHTML = postedJobs.map(job => `
        <div class="job-card ${job.synced ? '' : 'pending-sync'}">
            <div class="job-status-badge ${job.synced ? 'synced' : 'pending'}">
                ${job.synced ? '✓ Submitted' : '⏳ Pending Sync'}
            </div>
            <span class="company">${job.company}</span>
            <h3>${job.title}</h3>
            <div class="job-meta">
                <span class="tag">${job.location}</span>
                <span class="tag">${job.type}</span>
            </div>
            <div class="job-footer">
                <span class="salary">${job.salary || 'Not specified'}</span>
                <span class="timestamp">Posted ${new Date(job.timestamp).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');
}

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initApp();
});
