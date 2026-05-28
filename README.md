# GigTrack Pro

A full-stack profit tracker for gig workers — DoorDash, Uber, Uber Eats, Lyft, Instacart, Amazon Flex — with Stripe subscriptions and a mobile-ready PWA that installs on iPhone and Android like a real app.

---

## Quick Start (5 minutes)

### 1. Install Node.js
Download from https://nodejs.org — choose the **LTS** version. After installing, open Terminal (Mac) or Command Prompt (Windows) and verify:
```
node -v   # should show v18 or higher
npm -v
```

### 2. Open the project folder
```
cd gigtrack-pro
```

### 3. Install dependencies
```
npm install
```
This takes ~1–2 minutes on first run (compiles the SQLite driver).

### 4. Configure your environment
The `.env` file is already created with a secure JWT secret. You only need to fill in Stripe keys when you're ready.

### 5. Start the server
```
node server.js
```
You'll see:
```
🚀 GigTrack Pro running on http://localhost:3001
```

### 6. Open the app
- **On your computer**: http://localhost:3001
- **On iPhone/Android** (same Wi-Fi): open http://YOUR_COMPUTER_IP:3001
  - Find your IP: on Mac run `ipconfig getifaddr en0`, on Windows run `ipconfig` and look for IPv4

### 7. Install on your phone
Once the app loads in Safari (iPhone) or Chrome (Android), tap the share/install banner at the bottom to add it to your home screen like a real app.

---

## Setting Up Stripe (to charge users)

1. Create a free account at https://stripe.com
2. Go to **Developers → API keys** and copy your **Secret key** (starts with `sk_test_`) and **Publishable key** (starts with `pk_test_`)
3. Paste them into `.env`
4. Create two **Products** in Stripe:
   - **GigTrack Pro** — $9.99/month recurring
   - **GigTrack Business** — $19.99/month recurring
5. Copy each product's **Price ID** (starts with `price_`) and paste into `.env` as `STRIPE_PRICE_PRO` and `STRIPE_PRICE_BUSINESS`
6. Set up a webhook:
   - Go to **Developers → Webhooks → Add endpoint**
   - URL: `https://your-domain.com/api/billing/webhook` (or use [ngrok](https://ngrok.com) for local testing: `ngrok http 3001`)
   - Events to listen for: `checkout.session.completed`, `customer.subscription.deleted`
   - Copy the **Signing secret** into `.env` as `STRIPE_WEBHOOK_SECRET`

---

## Connecting Platforms

### DoorDash (CSV import)
DoorDash doesn't offer a public API — export your earnings instead:
1. Open the **DoorDash Dasher app** on your phone
2. Tap **Earnings** → scroll down → **Download CSV** (or "Export")
3. In GigTrack, go to **Connections** → **DoorDash** → **Upload CSV**

### Instacart (CSV import)
1. Open **Instacart Shopper app** → **Earnings** → **Download report**
2. In GigTrack, go to **Connections** → **Instacart** → **Upload CSV**

### Amazon Flex (CSV import)
1. Open the **Amazon Flex app** → **Activity** → tap the download icon
2. In GigTrack, go to **Connections** → **Amazon Flex** → **Upload CSV**

### Uber / Uber Eats (OAuth — requires developer credentials)
Uber OAuth requires registering as a developer. This is a one-time setup:

1. Go to https://developer.uber.com and sign in with your Uber account
2. Create a new app — set the redirect URI to: `http://localhost:3001/api/connect/uber/callback`
3. Copy the **Client ID** and **Client Secret** into `.env`
4. Restart the server, then tap **Connect** next to Uber in the app

### Lyft (OAuth — requires developer credentials)
1. Go to https://developer.lyft.com and sign in
2. Create an app — redirect URI: `http://localhost:3001/api/connect/lyft/callback`
3. Copy credentials into `.env`
4. Restart the server, then tap **Connect** next to Lyft in the app

> **Note:** Uber and Lyft OAuth apps require a review/approval process for production access. For personal use, developer-mode credentials work without approval.

---

## Project Structure

```
gigtrack-pro/
├── server.js              # Express app entry point
├── db.js                  # SQLite database setup and queries
├── .env                   # Your secret keys (never share this)
├── .env.example           # Template showing all required variables
├── package.json
│
├── middleware/
│   └── auth.js            # JWT verification + plan enforcement
│
├── routes/
│   ├── auth.js            # POST /signup, POST /login, GET /me, PUT /profile
│   ├── income.js          # CRUD + CSV import for all platforms
│   ├── expenses.js        # CRUD for business expenses
│   ├── mileage.js         # CRUD for trip mileage
│   ├── billing.js         # Stripe checkout, portal, webhooks
│   └── connect.js         # OAuth flows for Uber/Lyft, CSV for others
│
├── parsers/               # CSV import logic for each platform
│   ├── doordash.js        # Handles 3 different DoorDash CSV formats
│   ├── instacart.js
│   ├── ubereats.js
│   └── amazonflex.js
│
└── public/                # Static files served to the browser
    ├── index.html         # The entire PWA frontend (mobile-first)
    ├── manifest.json      # PWA install configuration
    ├── sw.js              # Service worker (offline support)
    ├── icon-192.png
    └── icon-512.png
```

---

## Subscription Plans

| Feature | Free | Pro ($9.99/mo) | Business ($19.99/mo) |
|---|---|---|---|
| Income, expenses, mileage tracking | ✓ | ✓ | ✓ |
| Tax estimates | ✓ | ✓ | ✓ |
| CSV import | ✓ | ✓ | ✓ |
| Uber / Lyft OAuth sync | — | ✓ | ✓ |
| All platform connections | — | ✓ | ✓ |
| Year-end export | — | ✓ | ✓ |
| Custom mileage rate | — | ✓ | ✓ |
| Monthly income goal | — | — | ✓ |

---

## Deploying Online (optional)

To make the app accessible from anywhere (not just your home Wi-Fi):

**Easiest option — Railway.app:**
1. Push the `gigtrack-pro` folder to a GitHub repo
2. Go to https://railway.app → **New Project → Deploy from GitHub**
3. Add all your `.env` variables in the Railway dashboard
4. Railway gives you a public HTTPS URL automatically

**Also works on:** Render.com, Fly.io, or any Linux VPS

---

## Tax Disclaimer

GigTrack Pro provides estimated tax calculations for informational purposes. The SE tax, federal, and state estimates are simplified and may not reflect your exact liability. Always consult a tax professional or use IRS-approved software for filing.

- SE Tax: 15.3% × 92.35% of net profit
- Federal: 12% bracket estimate (actual rate depends on total income)
- State: custom percentage you set in Account settings
- Mileage deduction: IRS standard rate (default $0.67/mile for 2024)

---

## Need Help?

Common issues:

**`npm install` fails on Windows** → Make sure you have Python and Visual Studio Build Tools installed. Run: `npm install --global windows-build-tools` (in an admin terminal)

**Port 3001 already in use** → Change `PORT=3002` in `.env`

**App won't install on iPhone** → Must open in **Safari** (not Chrome on iOS) for the install prompt to work

**CSV import says "no records found"** → Try downloading a fresh export from the platform app — the format sometimes varies by account type
# gigtrack-pro
# gigtrack-pro
# gigtrack-pro
