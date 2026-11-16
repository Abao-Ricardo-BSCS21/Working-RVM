# FilCycle

**Plastic Recycling Vending Machine with Reward-Based Incentive System**

A full-stack recycling management platform for **Filamer Christian University (FCU)**, built as a BSCS thesis prototype. FilCycle enables students to recycle plastic bottles through IoT-enabled vending machines and earn redeemable reward points.

> Recycle Smart. Earn Rewards. Protect Tomorrow.

## Tech Stack

| Layer         | Technology                                                           |
| ------------- | -------------------------------------------------------------------- |
| Frontend      | Next.js 15, React, TypeScript, TailwindCSS, shadcn/ui, Framer Motion |
| Backend       | Next.js API Routes, Prisma ORM                                       |
| Database      | MySQL                                                                |
| Auth          | NextAuth (JWT, Role-Based, Email OTP)                                |
| Charts        | Recharts                                                             |
| Notifications | Sonner                                                               |

## Features

- **Role-based dashboards** — Administrator, Staff, Student
- **Bottle submission simulation** — Hardware abstraction layer for future IoT integration
- **Reward catalog & redemption** — Coffee vouchers, merchandise, cash, gift cards
- **Leaderboard** — Weekly, monthly, all-time with animated podium
- **Achievements** — Unlock badges for recycling milestones
- **Reports** — Export to PDF, Excel, CSV
- **Machine monitoring** — Simulated IoT dashboard
- **Notifications** — Real-time activity alerts
- **Dark/Light mode** — Modern SaaS UI with glassmorphism

## Prerequisites

- Node.js 18+
- MySQL (XAMPP recommended)
- npm

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and update if needed:

```env
DATABASE_URL="mysql://root:@localhost:3306/filcycle"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key"
JWT_SECRET="your-jwt-secret"

# Email OTP (mock = OTP printed in server console; smtp = real email)
EMAIL_PROVIDER="mock"
# SMTP_HOST="smtp.gmail.com"
# SMTP_PORT="587"
# SMTP_USER="your@gmail.com"
# SMTP_PASS="your-app-password"
# SMTP_FROM="FilCycle <noreply@filamer.edu>"
```

Test email: `node scripts/check-email.mjs` then `node scripts/test-email.mjs your@email.com`

### 3. Start MySQL

Start MySQL via XAMPP Control Panel, then create the database:

```sql
CREATE DATABASE filcycle CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. Run migrations and seed

For a fresh database, run setup:

```bash
npm run db:setup
```

The integer-key schema is not compatible with databases created using the old
string IDs. For a development database, back it up and run `npm run db:reset`
to rebuild and reseed it. This command permanently deletes the existing data;
do not use it on a database that must be preserved.

### 5. Start development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Demo Credentials

| Role          | Login             | Password   |
| ------------- | ----------------- | ---------- |
| Administrator | admin@filamer.edu | admin123   |
| Staff         | staff@filamer.edu | staff123   |
| Student       | 21-CCS1-0001      | student123 |

Students login with **Student ID** (not email).

## Project Structure

```
src/
├── app/                    # Next.js App Router pages & API routes
│   ├── admin/              # Administrator dashboard
│   ├── staff/              # Staff dashboard
│   ├── student/            # Student dashboard
│   └── api/                # REST API endpoints
├── components/
│   ├── ui/                 # Reusable UI components (shadcn-style)
│   ├── dashboard/          # Dashboard-specific components
│   ├── charts/             # Recharts wrappers
│   └── layout/             # Layout components
├── lib/
│   ├── hardware/           # IoT hardware abstraction (simulated)
│   ├── services/           # Business logic
│   ├── auth.ts             # NextAuth configuration
│   └── validations.ts      # Zod schemas
└── prisma/
    ├── schema.prisma       # Database schema
    └── seed.ts             # Seed data
```

## Hardware Integration (Arduino Uno + W5500)

The vending machine talks to this app over Ethernet. The Arduino cannot use `localhost` — that name only exists on the PC. It calls the PC's ethernet address instead.

```
Arduino Uno  --SPI-->  W5500  --ethernet cable-->  this PC (Next.js on port 3000)
```

Direct cable (no router):

1. Set the PC ethernet adapter to IPv4 `192.168.4.1`, mask `255.255.255.0`. Leave gateway blank.
2. Start the app with `npm run dev` (it listens on every network interface, port 3000).
3. If Windows Firewall asks, allow Node.js on private networks.
4. Open the sketch in `hardware/arduino-w5500/filcycle_w5500/filcycle_w5500.ino`, install the board **Ethernet** library if needed, and upload it.
5. On the student Recycle page, scan a barcode, then trigger pin 2 (bottle) or pin 3 (can). The page awards points while that scan session is open. The deposit is stored on the first machine whose status is ONLINE.

W5500 wiring (Uno hardware SPI):

| W5500 | Uno |
| ----- | --- |
| VCC   | 5V (use 3.3V if your module has no onboard regulator) |
| GND   | GND |
| MOSI  | D11 |
| MISO  | D12 |
| SCLK  | D13 |
| CS    | D10 |

D2 to GND means `BOTTLE`. D3 to GND means `CAN`. The Serial Monitor at 9600 baud also accepts `B`, `C`, or `P`.

The sketch calls:

```
GET /api/hardware/update?item=BOTTLE&key=filcycle-dev
```

`HARDWARE_KEY` in `.env` must match the sketch. A heartbeat (`item=PING`) every few seconds marks the link online on the Recycle page and Machine monitor.

Same-router setup: in the sketch set `USE_STATIC_IP` to `0` and set `serverIp` to the PC's LAN address (the address `ipconfig` shows, not `127.0.0.1`).

The on-screen **Insert Bottle** button still records a bottle without the Arduino.

## API Endpoints

| Method       | Endpoint               | Description                   |
| ------------ | ---------------------- | ----------------------------- |
| POST         | `/api/bottles/submit`  | Submit a bottle for recycling |
| GET          | `/api/dashboard/stats` | Admin dashboard statistics    |
| GET          | `/api/leaderboard`     | Leaderboard data              |
| GET/POST/PUT | `/api/rewards`         | Reward catalog & redemption   |
| GET          | `/api/transactions`    | Transaction history           |
| GET/PUT/POST | `/api/machine`         | Machine monitoring            |
| GET/POST     | `/api/hardware/update` | Arduino W5500 item ingest (`item=BOTTLE\|CAN\|PING`) |
| GET/PUT      | `/api/notifications`   | User notifications            |
| GET          | `/api/reports`         | Generate reports              |
| GET/POST     | `/api/students`        | Student management            |

## License

Academic thesis project — Filamer Christian University. Not for commercial use.
