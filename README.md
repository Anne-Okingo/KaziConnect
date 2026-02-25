# KaziConnect - Offline Job Board PWA

Built for the **"LOCAL FIRST: Build our Reality"** Hackathon.

## The Problem
Many job seekers in Kenya (especially in rural areas) face "internet poverty". They pay high travel costs to reach cybercafés or waste expensive mobile data on unstable connections.

## The Solution
KaziConnect is a Progressive Web App that follows a **Local-First** philosophy.
- **Offline Listings**: Browse downloaded jobs anywhere.
- **Queue Now, Sync Later**: Apply for jobs offline; they'll automatically submit when you reach connectivity.
- **Ultra-Lightweight**: Minimal data footprints and optimized asset caching.

## Tech Stack
- **Vanilla JS & HTML5**: Zero build step required for maximum portability.
- **IndexedDB**: Local data persistence.
- **Service Workers**: Offline asset caching (Cache API).
- **CSS3**: Premium, responsive mobile-first design.

## How to Run
1. Serve the project root directory using any local server (e.g., Python `http.server`, Live Server in VS Code).
2. Open in Chrome/Edge (recommended for PWA features).
3. Install as an app to see the full PWA experience.

## Demo Flow
1. **Load**: Open while online to fetch mock jobs.
2. **Offline**: Disconnect internet.
3. **Browse**: Search and filter jobs.
4. **Apply**: Submit an application.
5. **Sync**: Reconnect and see the application auto-submit.
