const DB_NAME = 'KaziConnectDB';
const DB_VERSION = 2;

/**
 * Handles all IndexedDB operations for KaziConnect.
 * Stores jobs for offline viewing and applications for background sync.
 */
class KaziDB {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;

                // Version 1 stores
                if (oldVersion < 1) {
                    if (!db.objectStoreNames.contains('jobs')) {
                        db.createObjectStore('jobs', { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains('applications')) {
                        db.createObjectStore('applications', { keyPath: 'id', autoIncrement: true });
                    }
                }

                // Version 2: Settings and versioning
                if (oldVersion < 2) {
                    if (!db.objectStoreNames.contains('settings')) {
                        const settingsStore = db.createObjectStore('settings', { keyPath: 'key' });
                        // Default settings
                        settingsStore.add({ key: 'syncFrequency', value: 'normal' }); // normal, low, high
                        settingsStore.add({ key: 'batteryAware', value: true });
                        settingsStore.add({ key: 'dataSaver', value: false });
                    }
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // --- Job Operations ---

    async saveJobs(jobs) {
        const tx = this.db.transaction('jobs', 'readwrite');
        const store = tx.objectStore('jobs');
        jobs.forEach(job => store.put(job));
        return new Promise((resolve) => tx.oncomplete = resolve);
    }

    async getAllJobs() {
        return new Promise((resolve) => {
            const tx = this.db.transaction('jobs', 'readonly');
            const store = tx.objectStore('jobs');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
        });
    }

    // --- Application Operations ---

    async queueApplication(application) {
        const tx = this.db.transaction('applications', 'readwrite');
        const store = tx.objectStore('applications');
        store.add({
            ...application,
            timestamp: Date.now(),
            synced: false
        });
        return new Promise((resolve) => tx.oncomplete = resolve);
    }

    async getPendingApplications() {
        return new Promise((resolve) => {
            const tx = this.db.transaction('applications', 'readonly');
            const store = tx.objectStore('applications');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result.filter(app => !app.synced));
        });
    }

    async markAsSynced(id) {
        // Instead of deleting, we could mark as synced, but for simplicity we'll delete
        const tx = this.db.transaction('applications', 'readwrite');
        const store = tx.objectStore('applications');
        store.delete(id);
        return new Promise((resolve) => tx.oncomplete = resolve);
    }

    // --- Settings Operations ---

    async getSetting(key) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('settings', 'readonly');
            const store = tx.objectStore('settings');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
        });
    }

    async setSetting(key, value) {
        const tx = this.db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        store.put({ key, value });
        return new Promise((resolve) => tx.oncomplete = resolve);
    }
}

// Global instance
const db = new KaziDB();
