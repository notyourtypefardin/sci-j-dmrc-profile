# SCI J — DMRC Profile

## What this version adds
- Unique username generated for every new account: DMRC00001, DMRC00002, ...
- Password-based login.
- Passwords are stored as bcrypt hashes, not plain text.
- After first login, the user completes roll number, class and the previous application details.
- A social-profile-style "DMRC PROFILE" page is created.
- SQLite database (sci_j.db) stores accounts and profiles.
- Responsive red SCI J design.

## Run locally
1. Install Node.js.
2. Open this folder in Terminal.
3. Run:
   npm install
   npm start
4. Open:
   http://localhost:3000

The SQLite database file is created automatically on first start.

## Important for a real public website
This is a working starter backend/database. Before putting it online, change SESSION_SECRET, enable HTTPS, use secure cookies, add rate limiting/CSRF protection, and use a production database/backup strategy. Do not collect more personal information than necessary.

## Branding update
The supplied DMRC logo is used throughout the login, header, onboarding and profile views. The outer white background was made transparent. The site uses a red-and-black visual theme. Password minimum is 8 characters.

## Render deployment
This repository includes render.yaml for a Node/Express Web Service. Set a strong SESSION_SECRET in Render.

The current starter uses SQLite. Render's default filesystem is ephemeral, so SQLite data should not be treated as durable production storage unless the service has an appropriate persistent disk configured. For a real student-data deployment, migrate the database to a managed PostgreSQL service and add appropriate privacy/security controls before collecting real personal data.
