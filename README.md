# portfolio-backend

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Set `MONGODB_URI` to enable database-backed storage and the admin panel, and set
`ADMIN_KEY` to a long, private password for admin access. `JWT_SECRET` is
optional; when unset, the backend uses `ADMIN_KEY` to sign admin sessions.

`CLIENT_URL` is the comma-separated list of frontend origins allowed by CORS.
`GITHUB_TOKEN` enables importing repositories from GitHub. `GITHUB_API_URL`,
`SCREENSHOT_API`, and `PORT` have working defaults and only need changing when
using a non-default API endpoint or port.