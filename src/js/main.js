/**
 * Main application logic for KaziConnect.
 */

const API_BASE_URL = '/api';

const state = {
    currentFilter: 'all',
    titleQuery: '',
    locationQuery: '',
    jobs: [],
    pendingCount: 0
};

// --- Initialization ---

async function initApp() {
    try {
        await db.init();

        // Check if we have jobs, if not and online, fetch them from API
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

        // Register Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
                .then(() => console.log('Service Worker Registered'))
                .catch(err => console.error('SW Registration Failed:', err));
        }

        // Background Sync Setup (if supported)
        if ('SyncManager' in window && navigator.onLine) {
            trySyncApplications();
        }

    } catch (err) {
        console.error('App init failed:', err);
    } finally {
        // ALWAYS render (even if empty) to clear "Loading..." state
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

document.getElementById('job-application-form').onsubmit = async (e) => {
    e.preventDefault();
    console.log('Form Submit Triggered');
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

        // Optimistic UI: Act as if it worked immediately
        showToast(navigator.onLine ? 'Application sent!' : 'Saved offline! Will sync later.');

        updatePendingSyncBanner();
        document.getElementById('job-modal').classList.add('hidden');
        document.getElementById('job-application-form').reset();

        // Trigger sync in background
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

// --- Sync & Network Logic ---

async function updateConnectionStatus() {
    const status = document.getElementById('connection-status');
    const isOnline = navigator.onLine;

    if (isOnline) {
        status.textContent = 'Online';
        status.className = 'status-badge online';

        // Register for Background Sync if supported
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            const registration = await navigator.serviceWorker.ready;
            try {
                await registration.sync.register('sync-applications');
                console.log('Background Sync registered');
            } catch (err) {
                console.warn('Background Sync registration failed, falling back to manual', err);
                trySyncApplications();
            }
        } else {
            trySyncApplications();
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

async function trySyncApplications(retryCount = 0) {
    if (!navigator.onLine) return;

    const pending = await db.getPendingApplications();
    if (pending.length === 0) return;

    // Battery & Data Awareness (Hackathon Bonus)
    const isBatteryLow = 'getBattery' in navigator ? (await navigator.getBattery()).level < 0.15 : false;
    const isDataSaver = navigator.connection ? navigator.connection.saveData : false;

    if (isBatteryLow || isDataSaver) {
        console.log('Sync deferred: Low battery or Data Saver active');
        showToast('Sync deferred for battery/data saving.');
        return;
    }

    console.log(`Syncing ${pending.length} applications (Attempt ${retryCount + 1}) to server...`);

    for (const app of pending) {
        try {
            const response = await fetch(`${API_BASE_URL}/applications`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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

            console.log(`Successfully synced application for ${app.jobTitle}`);
            await db.markAsSynced(app.id);
        } catch (err) {
            console.error('Failed to sync application:', err);

            // Exponential Backoff (Hackathon Criterion)
            if (retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 1000;
                console.log(`Retrying in ${delay / 1000}s...`);
                setTimeout(() => trySyncApplications(retryCount + 1), delay);
            }
            break; // Stop current loop and wait for retry
        }
    }

    updatePendingSyncBanner();
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

document.getElementById('sync-now-btn').onclick = () => {
    console.log('Manual sync requested');
    trySyncApplications();
};

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

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

window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

// Start the app
document.addEventListener('DOMContentLoaded', initApp);
