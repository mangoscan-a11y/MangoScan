# MangoScan Web

Dashboard web application for the MangoScan automated mango sorting system.

**Stack:** Vite + React + TypeScript + Tailwind CSS + shadcn/ui + Supabase

---

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)

---

## 1. Clone & install

```bash
git clone <repo-url>
cd MangoScan-Web
npm install
```

---

## 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Where to find it |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Project Settings → API → `service_role` secret key |

> **Never expose `SUPABASE_SERVICE_ROLE_KEY` in the browser.** It is only read by `scripts/simulator.ts`.

---

## 3. Apply database schema

In your Supabase project, open the **SQL Editor** and run the migration files in order:

1. `supabase/migrations/001_schema.sql` — tables, enums, indexes, view
2. `supabase/migrations/002_rls.sql` — RLS policies

Then create the **Storage bucket**:

- Go to **Storage** in the Supabase Dashboard
- Create a new bucket named `scan-images`
- Set it to **Public** (so image URLs work in the browser)

---

## 4. Seed sample data

In the **SQL Editor**, run `supabase/seed.sql`. This inserts:
- 3 mango varieties (Carabao, Indian, Mango Apple)
- 3 disease classes (Healthy, Anthracnose, Mango Scab)
- 30 sample scan sessions spread over the last 7 days

---

## 5. Create user accounts

MangoScan uses **Supabase Auth** for login. For each user:

1. Go to **Authentication → Users** in the Supabase Dashboard
2. Click **Add user** → set email + password
3. Copy the user's UUID
4. Run this in the SQL Editor (replace the placeholder values):

```sql
insert into profiles (id, username, full_name, role, email)
values
  ('<uuid-from-auth>', 'admin1', 'Admin User', 'admin', 'admin@example.com'),
  ('<uuid-from-auth>', 'operator1', 'Operator User', 'operator', 'operator@example.com'),
  ('<uuid-from-auth>', 'qa1', 'QA Evaluator', 'qa', 'qa@example.com');
```

Roles: `admin` (full access), `operator` (monitor + history), `qa` (analytics + review)

---

## 6. Run the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and log in with one of the accounts you created.

---

## 7. Run the scan simulator (optional)

The simulator inserts fake scan data into Supabase every 5 seconds, standing in for the real ESP32 + YOLOv8 pipeline:

```bash
npm run simulator
```

Press `Ctrl+C` to stop. The Live Monitor page auto-refreshes every 15 seconds and will reflect new data.

---

## 8. Run tests

```bash
npm test
```

---

## 9. Build for production

```bash
npm run build
```

Output goes to `dist/`. Deploy to any static host (Vercel, Netlify, Cloudflare Pages).

---

## Project structure

```
src/
  lib/              Supabase client, database types, utilities
  features/
    auth/           Login page, AuthProvider, useAuth
    monitor/        Live Monitor page (today's stats + latest scan)
    scans/          Scan History table + detail drawer
    analytics/      Charts and CSV export
    admin/
      users/        User profile management (admin only)
      varieties/    Mango variety CRUD (admin only)
      diseases/     Disease class CRUD (admin only)
    profile/        Current user profile page
  components/
    ui/             shadcn/ui primitives
    layout/         AppShell, Sidebar
  hooks/            useToast

supabase/
  migrations/       001_schema.sql, 002_rls.sql
  seed.sql          Sample data

scripts/
  simulator.ts      Scan simulator (requires service-role key)
```

---

## When hardware is connected

When the real ESP32 + YOLOv8 pipeline is ready, it will write to the same Supabase tables the simulator uses (`scan_sessions`, `scan_images`, `detection_result`, `sorting_logs`). No changes to the web app are needed — just stop the simulator and let the hardware write live data.
