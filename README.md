# fyns-fe

Next.js frontend for the GEOID platform.

## Environment variables

The app talks to two backend services. Both are read at **build time**
(`NEXT_PUBLIC_*`), so they must be set before building / deploying — changing
them afterwards requires a rebuild.

| Variable | Cluster (dev) | Local |
|---|---|---|
| `NEXT_PUBLIC_USER_SVC_URL` | `https://api.development.geoidresources.com` | `http://localhost:8081` |
| `NEXT_PUBLIC_ASSET_SVC_URL` | `https://api.development.geoidresources.com` | `http://localhost:8082` |

The value is just the **origin** — no path, no trailing slash. Each API client
appends its own prefix (`/user-svc/api/v1`, `/asset-svc/api/v1`), and the shared
GKE ingress routes `/user-svc` and `/asset-svc` to the respective services. In
the cluster both services sit behind the same ingress, so both vars share one origin.

### Local
Put them in `.env.local` (gitignored), then `npm run dev`.

### Vercel
Set both under **Project → Settings → Environment Variables** as **Plain** (not
Sensitive — `NEXT_PUBLIC_*` is exposed to the browser bundle) for the target
environments, then **redeploy** so the new values are inlined at build time.
